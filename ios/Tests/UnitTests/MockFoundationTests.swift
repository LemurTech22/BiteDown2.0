import XCTest
@testable import FoodWasteReducer

/// Every method the shared foundation added to `MockAPIClient`: it works, follows the API's rules and
/// honours the failure / delay `Behavior`.
final class MockFoundationTests: XCTestCase {
    private func mock(_ fixture: MockFixture = .fridge, _ b: MockAPIClient.Behavior = .init(delay: .zero)) -> MockAPIClient {
        MockAPIClient(fixture: fixture, behavior: b, signedIn: true)
    }

    private func assertServer(_ error: Error, _ status: Int, _ code: String, file: StaticString = #filePath, line: UInt = #line) {
        guard case .server(let s, let c, _)? = error as? APIError else {
            return XCTFail("expected server error \(status) \(code), got \(error)", file: file, line: line)
        }
        XCTAssertEqual(s, status, file: file, line: line)
        XCTAssertEqual(c, code, file: file, line: line)
    }

    private func expectThrows<T>(_ status: Int, _ code: String, file: StaticString = #filePath, line: UInt = #line,
                                 _ op: () async throws -> T) async {
        do { _ = try await op(); XCTFail("expected \(status) \(code)", file: file, line: line) }
        catch { assertServer(error, status, code, file: file, line: line) }
    }

    // MARK: Health, auth

    func testHealthMeAndGoogleSignIn() async throws {
        let c = mock()
        let ok = try await c.health()
        XCTAssertTrue(ok)
        let me = try await c.me()
        XCTAssertEqual(me.user.id, MockData.priya.id)
        let existing = try await c.googleSignIn(idToken: "any-token")
        XCTAssertFalse(existing.created)
        let created = try await c.googleSignIn(idToken: "new-google-user")
        XCTAssertTrue(created.created)
        XCTAssertEqual(created.session.user.email, "new.cougar@gmail.com")
        await expectThrows(400, "validation_error") { try await c.googleSignIn(idToken: "") }
    }

    func testGoogleSignInSignsInTheAuthStore() async throws {
        let store = await AuthStore(storage: InMemorySessionStorage(nil))
        let c = MockAPIClient(behavior: .init(delay: .zero), auth: store)
        _ = try await c.googleSignIn(idToken: "tok")
        let signedIn = await store.isSignedIn
        XCTAssertTrue(signedIn)
    }

    func testHealthWorksSignedOutAndAuthedCallsDoNot() async throws {
        let store = await AuthStore(storage: InMemorySessionStorage(nil))
        let c = MockAPIClient(behavior: .init(delay: .zero), auth: store)
        let ok = try await c.health()
        XCTAssertTrue(ok)
        do { _ = try await c.listFriends(); XCTFail("signed out must be unauthorized") }
        catch { XCTAssertEqual(error as? APIError, .unauthorized) }
    }

    // MARK: Batch remove / restore

    func testRemoveBatchUsedAndRestoreBatchRoundTrip() async throws {
        let c = mock()
        let removed = try await c.removeBatch(ids: ["item-eggs", "item-yogurt"], outcome: .used)
        XCTAssertEqual(removed.map(\.id), ["item-eggs", "item-yogurt"], "request order")
        XCTAssertTrue(removed.allSatisfy { $0.outcome == .used && $0.isRemoved })
        let active = try await c.listItems().allItems.map(\.id)
        XCTAssertFalse(active.contains("item-eggs"))
        let back = try await c.restoreBatch(ids: ["item-yogurt", "item-eggs"])
        XCTAssertEqual(back.map(\.id), ["item-yogurt", "item-eggs"])
        XCTAssertTrue(back.allSatisfy { !$0.isRemoved && $0.outcome == nil })
    }

    func testRemoveBatchValidation() async throws {
        let c = mock()
        await expectThrows(400, "validation_error") { try await c.removeBatch(ids: [], outcome: .used) }
        await expectThrows(400, "validation_error") { try await c.removeBatch(ids: ["item-eggs", "item-eggs"], outcome: .used) }
        await expectThrows(400, "validation_error") { try await c.removeBatch(ids: ["item-eggs"], outcome: .thrownOut) }
        let tooMany = (0..<101).map { "x\($0)" }
        await expectThrows(400, "validation_error") { try await c.removeBatch(ids: tooMany, outcome: .used) }
        await expectThrows(400, "validation_error") { try await c.removeBatch(ids: ["item-eggs"], outcome: .used, recipient: .none) }
        await expectThrows(400, "validation_error") { try await c.removeBatch(ids: ["item-eggs"], outcome: .used, recipient: .user("user-ana")) }
    }

    func testRemoveBatchIsAllOrNothing() async throws {
        let c = mock()
        await expectThrows(404, "not_found") { try await c.removeBatch(ids: ["item-eggs", "no-such-item"], outcome: .used) }
        let still = try await c.listItems().allItems.map(\.id)
        XCTAssertTrue(still.contains("item-eggs"), "a failed batch writes nothing")
        _ = try await c.removeItem(id: "item-yogurt", outcome: .used)
        await expectThrows(409, "already_removed") { try await c.removeBatch(ids: ["item-eggs", "item-yogurt"], outcome: .used) }
        let after = try await c.listItems().allItems.map(\.id)
        XCTAssertTrue(after.contains("item-eggs"))
    }

    func testRestoreBatchErrors() async throws {
        let c = mock()
        do { _ = try await c.restoreBatch(ids: ["item-eggs"]); XCTFail() }
        catch { XCTAssertEqual(error as? APIError, .notRemoved) }
        await expectThrows(404, "not_found") { try await c.restoreBatch(ids: ["ghost"]) }
        await expectThrows(400, "validation_error") { try await c.restoreBatch(ids: []) }
    }

    func testBatchDonatedFulfilsListingAndRestoreReopensIt() async throws {
        let c = mock()
        let donated = try await c.removeBatch(ids: ["item-spinach", "item-carrots"], outcome: .donated)
        XCTAssertEqual(donated.map { $0.share?.status }, [.fulfilled, .fulfilled])
        let listing = await c.social.listings.first { $0.id == "share-spinach" }
        XCTAssertEqual(listing?.status, .fulfilled)
        XCTAssertEqual(listing?.recipientId, MockData.friend.id, "omitted recipient: the claimer receives it")
        let back = try await c.restoreBatch(ids: ["item-spinach", "item-carrots"])
        XCTAssertEqual(back.map { $0.share?.status }, [.open, .open])
        let reopened = await c.social.listings.first { $0.id == "share-spinach" }
        XCTAssertEqual(reopened?.status, .open)
        XCTAssertNil(reopened?.recipientId)
        XCTAssertEqual(reopened?.claimedBy, MockData.friend.id, "claimed_by is kept")
    }

    // MARK: RecipientChoice semantics (donation-recipient contract)

    func testDonatedRecipientCases() async throws {
        // .default: the claimer. .none: nobody, even though claimed. .user: that person.
        var c = mock()
        _ = try await c.removeItem(id: "item-spinach", outcome: .donated, wasteReason: nil, recipient: .default)
        var l = await c.social.listings.first { $0.id == "share-spinach" }
        XCTAssertEqual(l?.recipientId, MockData.friend.id)

        c = mock()
        _ = try await c.removeItem(id: "item-spinach", outcome: .donated, wasteReason: nil, recipient: .none)
        l = await c.social.listings.first { $0.id == "share-spinach" }
        XCTAssertEqual(l?.status, .fulfilled)
        XCTAssertNil(l?.recipientId, "explicit null: the claim must not redirect the gift")

        c = mock()
        _ = try await c.removeItem(id: "item-spinach", outcome: .donated, wasteReason: nil, recipient: .user(MockData.ana.id))
        l = await c.social.listings.first { $0.id == "share-spinach" }
        XCTAssertEqual(l?.recipientId, MockData.ana.id, "an explicit person overrides the claimer")
    }

    func testRecipientOnlyWithDonated() async throws {
        let c = mock()
        await expectThrows(400, "validation_error") { try await c.removeItem(id: "item-eggs", outcome: .used, wasteReason: nil, recipient: .none) }
        await expectThrows(400, "validation_error") { try await c.removeItem(id: "item-eggs", outcome: .used, wasteReason: nil, recipient: .user("u")) }
        await expectThrows(400, "validation_error") { try await c.removeItem(id: "item-eggs", outcome: .thrownOut, wasteReason: .forgot, recipient: .none) }
        await expectThrows(400, "validation_error") { try await c.removeItem(id: "item-eggs", outcome: .thrownOut, wasteReason: nil, recipient: .default) }
        let still = try await c.listItems().allItems.map(\.id)
        XCTAssertTrue(still.contains("item-eggs"), "a rejected remove changes nothing")
    }

    func testDonatingToYourselfOrAStrangerIsRejected() async throws {
        let c = mock()
        await expectThrows(400, "validation_error") {
            try await c.removeItem(id: "item-spinach", outcome: .donated, wasteReason: nil, recipient: .user(MockData.priya.id))
        }
        await expectThrows(404, "not_found") {
            try await c.removeItem(id: "item-spinach", outcome: .donated, wasteReason: nil, recipient: .user("user-stranger"))
        }
    }

    // MARK: Receipt, barcode

    func testReceiptReturnsFullCandidatesWithPriceAndText() async throws {
        let r = try await mock().fromReceipt(imageData: Data([1]))
        XCTAssertGreaterThanOrEqual(r.candidates.count, 3)
        XCTAssertEqual(r.categorizedBy, "gemini")
        XCTAssertNotNil(r.total)
        for c in r.candidates {
            XCTAssertNotNil(c.receiptText); XCTAssertNotNil(c.price)
            XCTAssertNotNil(c.candidate.storage); XCTAssertNotNil(c.candidate.predictedExpiry)
        }
        XCTAssertEqual(Set(r.candidates.map(\.id)).count, r.candidates.count)
        XCTAssertGreaterThanOrEqual(try XCTUnwrap(r.total), r.candidates.compactMap(\.price).reduce(0, +) - 0.01, "total includes tax, never less than the lines")
    }

    func testReceiptPostsBackAsNewItems() async throws {
        let c = mock()
        let r = try await c.fromReceipt(imageData: Data([1]))
        let new = r.candidates.map { NewItem(candidate: $0.candidate, source: "receipt") }
        let created = try await c.createItems(new)
        XCTAssertEqual(created.count, r.candidates.count)
        XCTAssertTrue(created.allSatisfy { $0.source == "receipt" })
    }

    func testBarcodeKnownUnknownAndInvalid() async throws {
        let c = mock()
        let b = try await c.barcode("016000275287")
        XCTAssertEqual(b.candidate.name, "Cheerios")
        XCTAssertEqual(b.brand, "General Mills")
        XCTAssertEqual(b.quantityText, "18 oz")
        XCTAssertEqual(b.barcode, "016000275287")
        await expectThrows(404, "not_found") { try await c.barcode("999999999999") }
        await expectThrows(400, "validation_error") { try await c.barcode("12345") }          // 5 digits
        await expectThrows(400, "validation_error") { try await c.barcode("123456789012345") } // 15 digits
        await expectThrows(400, "validation_error") { try await c.barcode("12345a") }
    }

    func testPhotoNoneAppliesToReceiptAndPhoto() async throws {
        var b = MockAPIClient.Behavior(delay: .zero); b.photoFindsNothing = true
        let c = mock(.fridge, b)
        let photo = try await c.fromPhoto(imageData: Data([1]), mode: .fridge)
        XCTAssertTrue(photo.candidates.isEmpty)
        let receipt = try await c.fromReceipt(imageData: Data([1]))
        XCTAssertTrue(receipt.candidates.isEmpty)
    }

    // MARK: Share

    func testPantryListsOthersOpenListings() async throws {
        let c = mock()
        let l = try await c.listShares()
        XCTAssertEqual(l.count, 3)
        XCTAssertTrue(l.allSatisfy { $0.status == .open && $0.ownerId != MockData.priya.id })
        XCTAssertEqual(Set(l.map(\.source.type)), [.friend, .group])
        for e in l {
            if e.source.type == .group { XCTAssertNotNil(e.groupId) } else { XCTAssertNil(e.groupId) }
        }
    }

    func testClaimShareRules() async throws {
        let c = mock()
        let claimed = try await c.claimShare(id: "share-sourdough")
        XCTAssertEqual(claimed.claimedBy, MockData.priya.id)
        let mine = try await c.listShares().first { $0.id == "share-sourdough" }
        XCTAssertEqual(mine?.claimedByMe, true)
        await expectThrows(409, "already_claimed") { try await c.claimShare(id: "share-sourdough") }
        await expectThrows(409, "already_claimed") { try await c.claimShare(id: "share-apples") }
        await expectThrows(404, "not_found") { try await c.claimShare(id: "nope") }
    }

    func testCreateShareFriendsGroupAndConflicts() async throws {
        let c = mock()
        let friends = try await c.createShare(itemId: "item-eggs", groupId: nil)
        XCTAssertEqual(friends.status, .open)
        XCTAssertEqual(friends.audience, ListingAudience(friends: true))
        let items = try await c.listItems().allItems
        XCTAssertEqual(items.first { $0.id == "item-eggs" }?.share?.id, friends.id, "the item's share block updates")
        await expectThrows(409, "already_shared") { try await c.createShare(itemId: "item-eggs", groupId: nil) }
        await expectThrows(409, "already_shared") { try await c.createShare(itemId: "item-spinach", groupId: nil) }
        let group = try await c.createShare(itemId: "item-oatmilk", groupId: "group-moody")
        XCTAssertEqual(group.groupId, "group-moody")
        XCTAssertEqual(group.audience, ListingAudience(friends: false, groups: [GroupRef(id: "group-moody", name: "Moody Hall 4F")]))
        await expectThrows(404, "not_found") { try await c.createShare(itemId: "item-yogurt", groupId: "group-unknown") }
        await expectThrows(404, "not_found") { try await c.createShare(itemId: "ghost", groupId: nil) }
    }

    func testCreateShareOnRemovedItemIsConflict() async throws {
        let c = mock()
        _ = try await c.removeItem(id: "item-eggs", outcome: .used)
        await expectThrows(409, "already_removed") { try await c.createShare(itemId: "item-eggs", groupId: nil) }
    }

    func testCancelShareClearsItemShareAndClosesListing() async throws {
        let c = mock()
        let l = try await c.cancelShare(id: "share-carrots")
        XCTAssertEqual(l.status, .cancelled)
        let carrots = try await c.listItems().allItems.first { $0.id == "item-carrots" }
        XCTAssertNil(carrots?.share)
        await expectThrows(409, "listing_closed") { try await c.cancelShare(id: "share-carrots") }
        await expectThrows(404, "not_found") { try await c.cancelShare(id: "ghost") }
    }

    func testCancelledShareCanBeSharedAgain() async throws {
        let c = mock()
        _ = try await c.cancelShare(id: "share-carrots")
        let again = try await c.createShare(itemId: "item-carrots", groupId: nil)
        XCTAssertEqual(again.status, .open)
    }

    // MARK: Requests

    func testBoardIsOpenOnlyNewestFirst() async throws {
        let c = mock()
        let board = try await c.listRequests()
        XCTAssertTrue(board.allSatisfy { $0.status == .open })
        let dates = board.compactMap(\.createdAt)
        XCTAssertEqual(dates, dates.sorted(by: >))
        XCTAssertEqual(board.count, Set(board.map(\.id)).count, "each request once")
    }

    func testMyRequestsAreMineOnly() async throws {
        let c = mock()
        let mine = try await c.listMyRequests()
        XCTAssertFalse(mine.isEmpty)
        XCTAssertTrue(mine.allSatisfy { $0.authorId == MockData.priya.id && $0.source.type == .me })
    }

    func testCreateRequestAudiencesAndValidation() async throws {
        let c = mock()
        let r = try await c.createRequest(text: "  Need salt  ", friends: true, groupIds: ["group-moody", "group-ccs", "group-moody"])
        XCTAssertEqual(r.text, "Need salt", "trimmed")
        XCTAssertEqual(r.status, .open)
        XCTAssertEqual(r.source.type, .me)
        XCTAssertTrue(r.audiences.friends)
        XCTAssertEqual(r.audiences.groups.map(\.name), ["CougarCS Kitchen", "Moody Hall 4F"], "deduplicated and sorted by name")
        XCTAssertEqual(r.audiences.hiddenCount, 0, "the author sees every audience")
        XCTAssertEqual(r.groupId, "group-ccs", "deprecated fields mirror the first group")
        let board = try await c.listRequests()
        XCTAssertEqual(board.first?.id, r.id, "newest first")

        await expectThrows(400, "validation_error") { try await c.createRequest(text: "x", friends: false, groupIds: []) }
        await expectThrows(400, "validation_error") { try await c.createRequest(text: "   ", friends: true, groupIds: []) }
        await expectThrows(400, "validation_error") { try await c.createRequest(text: String(repeating: "a", count: 281), friends: true, groupIds: []) }
        await expectThrows(404, "not_found") { try await c.createRequest(text: "x", friends: false, groupIds: ["group-unknown"]) }
        let ok = try await c.createRequest(text: String(repeating: "a", count: 280), friends: true, groupIds: [])
        XCTAssertEqual(ok.text.count, 280)
    }

    func testFulfilAndCancelRequestRules() async throws {
        let c = mock()
        await expectThrows(403, "forbidden") { try await c.fulfilRequest(id: "req-lemon") }
        let f = try await c.fulfilRequest(id: "req-onion")
        XCTAssertEqual(f.status, .fulfilled)
        XCTAssertEqual(f.fulfilledBy, MockData.priya.id)
        XCTAssertEqual(f.fulfilledByName, "Priya")
        await expectThrows(409, "request_closed") { try await c.fulfilRequest(id: "req-onion") }
        let board = try await c.listRequests()
        XCTAssertFalse(board.contains { $0.id == "req-onion" })

        await expectThrows(403, "forbidden") { try await c.cancelRequest(id: "req-tortillas") }
        let x = try await c.cancelRequest(id: "req-lemon")
        XCTAssertEqual(x.status, .cancelled)
        await expectThrows(409, "request_closed") { try await c.cancelRequest(id: "req-lemon") }
        await expectThrows(404, "not_found") { try await c.fulfilRequest(id: "ghost") }
    }

    // MARK: Friends

    func testListFriendsThreeBuckets() async throws {
        let f = try await mock().listFriends()
        XCTAssertEqual(f.friends.count, 2); XCTAssertEqual(f.incoming.count, 1); XCTAssertEqual(f.outgoing.count, 1)
        XCTAssertTrue(f.friends.allSatisfy { $0.status == .accepted })
        XCTAssertTrue((f.incoming + f.outgoing).allSatisfy { $0.status == .pending })
    }

    func testRequestAcceptDeclineFlow() async throws {
        let c = mock()
        let sent = try await c.requestFriend(email: "  Devon@Example.com ")
        XCTAssertEqual(sent.status, .pending)
        var f = try await c.listFriends()
        XCTAssertTrue(f.outgoing.contains { $0.userId == sent.userId })

        await expectThrows(409, "request_pending") { try await c.requestFriend(email: "devon@example.com") }   // outgoing
        await expectThrows(409, "request_pending") { try await c.requestFriend(email: "jordan@example.com") }   // incoming
        await expectThrows(409, "already_friends") { try await c.requestFriend(email: "marcus@example.com") }
        await expectThrows(404, "not_found") { try await c.requestFriend(email: "nobody@example.com") }
        await expectThrows(400, "validation_error") { try await c.requestFriend(email: MockData.priya.email) }
        await expectThrows(400, "validation_error") { try await c.requestFriend(email: "  ") }

        let accepted = try await c.acceptFriend(userId: MockData.jordan.id)
        XCTAssertEqual(accepted.status, .accepted)
        f = try await c.listFriends()
        XCTAssertTrue(f.friends.contains { $0.userId == MockData.jordan.id })
        XCTAssertFalse(f.incoming.contains { $0.userId == MockData.jordan.id })
        await expectThrows(404, "not_found") { try await c.acceptFriend(userId: MockData.jordan.id) }
        await expectThrows(404, "not_found") { try await c.acceptFriend(userId: sent.userId) }   // only the target can accept
    }

    func testDeclineCancelAndUnfriendAreOneRelationship() async throws {
        let c = mock()
        try await c.declineFriend(userId: MockData.jordan.id)
        try await c.removeFriend(userId: MockData.sam.id)            // cancel a request you sent
        try await c.removeFriend(userId: MockData.marcusFull.id)     // unfriend
        let f = try await c.listFriends()
        XCTAssertEqual(f.incoming.count + f.outgoing.count, 0)
        XCTAssertEqual(f.friends.map(\.userId), [MockData.ana.id])
        do { try await c.removeFriend(userId: MockData.marcusFull.id); XCTFail("second delete is 404") }
        catch { assertServer(error, 404, "not_found") }
    }

    func testUnfriendingRemovesThemFromReachablePeople() async throws {
        let c = mock()
        let before = try await c.reachablePeople().map(\.id)
        XCTAssertTrue(before.contains(MockData.marcusFull.id))
        try await c.removeFriend(userId: MockData.marcusFull.id)
        let after = try await c.reachablePeople().map(\.id)
        XCTAssertFalse(after.contains(MockData.marcusFull.id))
    }

    // MARK: Groups

    func testListCreateJoinLeaveGroups() async throws {
        let c = mock()
        let groups = try await c.listGroups()
        XCTAssertEqual(groups.map(\.name), ["Moody Hall 4F", "CougarCS Kitchen"])

        let g = try await c.createGroup(name: "  Study crew ")
        XCTAssertEqual(g.name, "Study crew")
        XCTAssertEqual(g.role, .owner)
        XCTAssertEqual(g.memberCount, 1)
        XCTAssertEqual(g.inviteCode.count, 8)
        let allowed = Set("ABCDEFGHJKMNPQRSTUVWXYZ23456789")
        XCTAssertTrue(g.inviteCode.allSatisfy(allowed.contains), "invite alphabet has no 0 O 1 I L: \(g.inviteCode)")
        await expectThrows(400, "validation_error") { try await c.createGroup(name: "") }
        await expectThrows(400, "validation_error") { try await c.createGroup(name: String(repeating: "a", count: 61)) }

        let joined = try await c.joinGroup(inviteCode: "grdn-2345")
        XCTAssertEqual(joined.role, .member)
        XCTAssertEqual(joined.name, "Cougar Gardeners")
        await expectThrows(409, "already_member") { try await c.joinGroup(inviteCode: "GRDN2345") }
        await expectThrows(404, "not_found") { try await c.joinGroup(inviteCode: "ZZZZZZZZ") }

        try await c.leaveGroup(id: g.id)
        let after = try await c.listGroups().map(\.id)
        XCTAssertFalse(after.contains(g.id))
        do { try await c.leaveGroup(id: g.id); XCTFail() } catch { assertServer(error, 404, "not_found") }
    }

    func testJoinCodeIgnoresCaseSpacesAndDashes() async throws {
        let c = mock()
        let g = try await c.joinGroup(inviteCode: " gr dn-23 45 ")
        XCTAssertEqual(g.id, "group-garden")
    }

    func testLeavingAGroupTrimsYourOpenRequestAudiences() async throws {
        let c = mock()
        // req-lemon: friends + CougarCS. Leaving CougarCS drops that audience; friends keeps it open.
        try await c.leaveGroup(id: "group-ccs")
        let mine = try await c.listMyRequests().first { $0.id == "req-lemon" }
        XCTAssertEqual(mine?.status, .open)
        XCTAssertEqual(mine?.audiences.groups, [])
        XCTAssertEqual(mine?.audiences.friends, true)
    }

    func testLeavingTheOnlyAudienceCancelsTheRequest() async throws {
        let c = mock()
        let r = try await c.createRequest(text: "Only for the kitchen", friends: false, groupIds: ["group-ccs"])
        try await c.leaveGroup(id: "group-ccs")
        let mine = try await c.listMyRequests().first { $0.id == r.id }
        XCTAssertEqual(mine?.status, .cancelled)
        let board = try await c.listRequests()
        XCTAssertFalse(board.contains { $0.id == r.id })
    }

    func testGroupDetailAndPantry() async throws {
        let c = mock()
        let d = try await c.groupDetail(id: "group-moody")
        XCTAssertEqual(d.group.name, "Moody Hall 4F")
        XCTAssertEqual(d.members.count, d.group.memberCount, "member_count matches the roster")
        XCTAssertEqual(d.members.filter { $0.role == .owner }.count, 1)
        let ccs = try await c.groupDetail(id: "group-ccs")
        XCTAssertEqual(ccs.members.count, ccs.group.memberCount)
        let p = try await c.groupPantry(id: "group-ccs")
        XCTAssertFalse(p.isEmpty)
        XCTAssertTrue(p.allSatisfy { $0.item.groupId == "group-ccs" && $0.addedBy != nil })
        let exp = p.compactMap(\.item.predictedExpiry)
        XCTAssertEqual(exp, exp.sorted(), "by predicted_expiry")
        await expectThrows(404, "not_found") { try await c.groupDetail(id: "group-unknown") }
        await expectThrows(404, "not_found") { try await c.groupPantry(id: "group-unknown") }
    }

    func testEmptyFixtureHasNoSocialData() async throws {
        let c = mock(.empty)
        let friends = try await c.listFriends()
        XCTAssertEqual(friends, .empty)
        let groups = try await c.listGroups()
        XCTAssertTrue(groups.isEmpty)
        let shares = try await c.listShares()
        XCTAssertTrue(shares.isEmpty)
        let board = try await c.listRequests()
        XCTAssertTrue(board.isEmpty)
        let people = try await c.reachablePeople()
        XCTAssertTrue(people.isEmpty)
        let joined = try await c.joinGroup(inviteCode: "GRDN2345")
        XCTAssertEqual(joined.name, "Cougar Gardeners")
    }

    // MARK: People

    func testReachablePeopleMarkTheClaimerOnce() async throws {
        let people = try await mock().reachablePeople(itemId: "item-spinach")
        XCTAssertEqual(people.filter { $0.isClaimer == true }.map(\.id), [MockData.marcusFull.id])
        XCTAssertEqual(Set(people.map(\.id)).count, people.count)
        XCTAssertTrue(people.contains { $0.kind == .groupMember })
        XCTAssertFalse(people.contains { $0.id == MockData.priya.id }, "you can't hand food to yourself")
    }

    // MARK: Impact / recipes fixtures follow the wave-2 contract

    func testImpactFixtureInvariantsForEveryRange() async throws {
        let c = mock()
        for range in ImpactRange.allCases {
            let i = try await c.impact(range: range)
            XCTAssertEqual(i.saved.count, i.used.count + i.donated.count, "\(range)")
            XCTAssertEqual(i.saved.kg, i.used.kg + i.donated.kg, accuracy: 0.011, "\(range)")
            XCTAssertEqual(i.saved.money, i.used.money + i.donated.money, accuracy: 0.011, "\(range)")
            let total = i.saved.count + i.wasted.count
            XCTAssertEqual(i.wasteRate, total == 0 ? 0 : Double(i.wasted.count) / Double(total), accuracy: 0.011, "\(range)")
            XCTAssertEqual(Set(i.wasteReasons.map(\.reason)), Set(WasteReason.allCases), "all four reasons, always")
            XCTAssertEqual(i.wasteReasons.count, 4)
            XCTAssertEqual(i.wasteReasons.map(\.count), i.wasteReasons.map(\.count).sorted(by: >), "sorted by count desc")
            XCTAssertEqual(i.wasteReasons.map(\.count).reduce(0, +), i.wasted.count)
            if i.wasted.count > 0 { XCTAssertEqual(i.wasteReasons.map(\.share).reduce(0, +), 1, accuracy: 0.02) }
            XCTAssertEqual(i.last6Weeks.count, 6, "\(range)")
            XCTAssertEqual(i.last6Weeks.map(\.week), i.last6Weeks.map(\.week).sorted())
            XCTAssertTrue(i.last6Weeks.allSatisfy { $0.saved == $0.used + $0.donated })
            if range == .all { XCTAssertNil(i.previous) } else { XCTAssertNotNil(i.previous, "\(range)") }
            XCTAssertEqual(i.range, range.rawValue)
        }
    }

    func testRecipeFixturesHaveObjectsServingsAndANilMacros() async throws {
        let r = try await mock().recipesSuggest(maxResults: 10, dietary: nil)
        XCTAssertEqual(r.count, 3)
        XCTAssertTrue(r.allSatisfy { !$0.usesItems.isEmpty && $0.usesItems.allSatisfy { !$0.itemId.isEmpty } })
        XCTAssertTrue(r.contains { $0.servings == nil }, "a recipe without servings is covered")
        XCTAssertTrue(r.contains { $0.macros == nil }, "a recipe without macros is covered")
        XCTAssertTrue(r.allSatisfy(\.macrosEstimated))
        let first = try await mock().recipesSuggest(maxResults: 1, dietary: nil)
        XCTAssertEqual(first.count, 1)
        let ids = Set(try await mock().listItems().allItems.map(\.id))
        for u in r.flatMap(\.usesItems) { XCTAssertTrue(ids.contains(u.itemId), "\(u.itemId) is one of the caller's items") }
    }

    // MARK: Behavior: failures and delays reach every new method

    private func allNewCalls(_ c: MockAPIClient) -> [(String, () async throws -> Void)] {
        [("health", { _ = try await c.health() }),
         ("me", { _ = try await c.me() }),
         ("googleSignIn", { _ = try await c.googleSignIn(idToken: "t") }),
         ("removeBatch", { _ = try await c.removeBatch(ids: ["item-eggs"], outcome: .used) }),
         ("restoreBatch", { _ = try await c.restoreBatch(ids: ["item-eggs"]) }),
         ("fromReceipt", { _ = try await c.fromReceipt(imageData: Data([1])) }),
         ("barcode", { _ = try await c.barcode("016000275287") }),
         ("listShares", { _ = try await c.listShares() }),
         ("createShare", { _ = try await c.createShare(itemId: "item-eggs", groupId: nil) }),
         ("cancelShare", { _ = try await c.cancelShare(id: "share-carrots") }),
         ("claimShare", { _ = try await c.claimShare(id: "share-sourdough") }),
         ("listRequests", { _ = try await c.listRequests() }),
         ("listMyRequests", { _ = try await c.listMyRequests() }),
         ("createRequest", { _ = try await c.createRequest(text: "x", friends: true, groupIds: []) }),
         ("fulfilRequest", { _ = try await c.fulfilRequest(id: "req-onion") }),
         ("cancelRequest", { _ = try await c.cancelRequest(id: "req-lemon") }),
         ("listFriends", { _ = try await c.listFriends() }),
         ("requestFriend", { _ = try await c.requestFriend(email: "devon@example.com") }),
         ("acceptFriend", { _ = try await c.acceptFriend(userId: MockData.jordan.id) }),
         ("declineFriend", { try await c.declineFriend(userId: MockData.jordan.id) }),
         ("removeFriend", { try await c.removeFriend(userId: MockData.ana.id) }),
         ("listGroups", { _ = try await c.listGroups() }),
         ("createGroup", { _ = try await c.createGroup(name: "G") }),
         ("joinGroup", { _ = try await c.joinGroup(inviteCode: "GRDN2345") }),
         ("groupDetail", { _ = try await c.groupDetail(id: "group-ccs") }),
         ("groupPantry", { _ = try await c.groupPantry(id: "group-ccs") }),
         ("reachablePeople", { _ = try await c.reachablePeople() }),
         ("leaveGroup", { try await c.leaveGroup(id: "group-ccs") })]
    }

    func testEveryNewMethodSucceedsWithDefaultBehavior() async throws {
        for (name, call) in allNewCalls(mock()) {
            do { try await call() } catch { XCTFail("\(name) threw \(error)") }
        }
    }

    func testFailNetworkReachesEveryNewMethodAndCountsTheCall() async throws {
        var b = MockAPIClient.Behavior(delay: .zero); b.failNetwork = true
        let c = mock(.fridge, b)
        for (name, call) in allNewCalls(c) {
            do { try await call(); XCTFail("\(name) ignored failNetwork") }
            catch let e as APIError { if case .network = e {} else { XCTFail("\(name): \(e)") } }
            let n = await c.calls(to: name)
            XCTAssertEqual(n, 1, "\(name) is counted under its own name")
        }
    }

    func testPerMethodFailureKeyedByMethodName() async throws {
        for name in allNewCalls(mock()).map(\.0) {
            let c = mock()
            await c.setFailure(.server(status: 500, code: "internal_error", message: "boom"), for: name)
            let call = try XCTUnwrap(allNewCalls(c).first { $0.0 == name }).1
            do { try await call(); XCTFail("\(name) ignored its failure key") }
            catch { assertServer(error, 500, "internal_error") }
        }
    }

    func testFailureOnOneMethodLeavesOthersWorking() async throws {
        let c = mock()
        await c.setFailure(.server(status: 502, code: "upstream_unavailable", message: "x"), for: "barcode")
        _ = try await c.listFriends()
        _ = try await c.fromReceipt(imageData: Data([1]))
        await expectThrows(502, "upstream_unavailable") { try await c.barcode("016000275287") }
    }

    func testFailFirstThenSucceedsOnNewMethods() async throws {
        var b = MockAPIClient.Behavior(delay: .zero); b.failFirst["listRequests"] = 1; b.failFirst["listFriends"] = 2
        let c = mock(.fridge, b)
        do { _ = try await c.listRequests(); XCTFail() } catch {}
        let board = try await c.listRequests()
        XCTAssertFalse(board.isEmpty)
        for _ in 0..<2 { do { _ = try await c.listFriends(); XCTFail() } catch {} }
        _ = try await c.listFriends()
    }

    func testPerMethodDelayIsHonoured() async throws {
        var b = MockAPIClient.Behavior(delay: .zero); b.delays["listShares"] = .milliseconds(250)
        let c = mock(.fridge, b)
        let t0 = Date()
        _ = try await c.listShares()
        XCTAssertGreaterThanOrEqual(Date().timeIntervalSince(t0), 0.2)
        let t1 = Date()
        _ = try await c.listFriends()
        XCTAssertLessThan(Date().timeIntervalSince(t1), 0.2, "other methods keep the base delay")
    }

    func testGlobalDelayAppliesToNewMethods() async throws {
        let c = mock(.fridge, .init(delay: .milliseconds(120)))
        let t0 = Date()
        _ = try await c.reachablePeople()
        XCTAssertGreaterThanOrEqual(Date().timeIntervalSince(t0), 0.1)
    }

    func testCancellingASlowCallThrowsCancellation() async throws {
        var b = MockAPIClient.Behavior(delay: .zero); b.delays["listRequests"] = .seconds(30)
        let c = mock(.fridge, b)
        let task = Task { try await c.listRequests() }
        try await Task.sleep(for: .milliseconds(50))
        task.cancel()
        do { _ = try await task.value; XCTFail() } catch { XCTAssertTrue(error is CancellationError, "\(error)") }
    }

    func testExpiredSessionSignsOutOnAuthedCallsButNotHealthOrGoogle() async throws {
        let store = await AuthStore(storage: InMemorySessionStorage(AuthSession(token: "t", user: MockData.priya)))
        var b = MockAPIClient.Behavior(delay: .zero); b.expiredSession = true
        let c = MockAPIClient(behavior: b, auth: store, signedIn: true)
        let ok = try await c.health()
        XCTAssertTrue(ok, "/health is unauthenticated")
        do { _ = try await c.listFriends(); XCTFail() } catch { XCTAssertEqual(error as? APIError, .unauthorized) }
        let signedIn = await store.isSignedIn
        XCTAssertFalse(signedIn, "a 401 signs the user out")
    }

    func testThrownOutFailureOnlyAffectsThrownOut() async throws {
        var b = MockAPIClient.Behavior(delay: .zero); b.failThrownOut = .network("offline")
        let c = mock(.fridge, b)
        do { _ = try await c.removeItem(id: "item-eggs", outcome: .thrownOut, wasteReason: .forgot, recipient: .default); XCTFail() } catch {}
        _ = try await c.removeItem(id: "item-eggs", outcome: .used, wasteReason: nil, recipient: .default)
        _ = try await c.removeBatch(ids: ["item-yogurt"], outcome: .used)
    }
}
