import Foundation

/// Mock implementations of the Food Pantry, request board, friends, groups and people endpoints.
/// Rules mirror docs/API.md (status codes and error codes), so error states are testable offline.
extension MockAPIClient {
    private var me: User { signedInUser ?? MockData.priya }

    private func ownerAudience(groupId: String?) -> ListingAudience {
        guard let groupId, let g = social.groups.first(where: { $0.id == groupId }) else { return ListingAudience(friends: true) }
        return ListingAudience(groups: [GroupRef(id: g.id, name: g.name)])
    }

    // MARK: Share

    func listShares() async throws -> [PantryListing] {
        try await gate("listShares")
        return social.pantry.filter { $0.status == .open }
    }

    func createShare(itemId: String, groupId: String?) async throws -> Listing {
        try await gate("createShare")
        guard let i = items.firstIndex(where: { $0.id == itemId }) else { throw notFound() }
        if items[i].ownerId != me.id { throw forbidden("That isn't your item.") }
        if items[i].groupId != nil { throw validation("Group pantry items can't be shared.") }
        if items[i].isRemoved { throw conflict("already_removed", "Already removed.") }
        if items[i].share?.status == .open {
            throw conflict("already_shared", "That item is already shared.")
        }
        if let groupId {
            guard social.groups.contains(where: { $0.id == groupId }) else { throw notFound("Group") }
        }
        defer { nextID += 1 }
        let listing = Listing(id: "share-new-\(nextID)", itemId: itemId, ownerId: me.id, groupId: groupId, status: .open,
                              recipientId: nil, claimedBy: nil, createdAt: Date(), fulfilledAt: nil,
                              audience: ownerAudience(groupId: groupId))
        social.listings.append(listing)
        items[i].share = ItemShare(id: listing.id, status: .open, claimedBy: nil)
        return listing
    }

    func cancelShare(id: String) async throws -> Listing {
        try await gate("cancelShare")
        guard let l = social.listings.firstIndex(where: { $0.id == id }) else { throw notFound("Listing") }
        guard social.listings[l].status == .open else { throw conflict("listing_closed", "That listing is closed.") }
        social.listings[l].status = .cancelled
        if let i = items.firstIndex(where: { $0.share?.id == id }) { items[i].share = nil }
        return social.listings[l]
    }

    func claimShare(id: String) async throws -> Listing {
        try await gate("claimShare")
        guard let p = social.pantry.firstIndex(where: { $0.id == id }) else { throw notFound("Listing") }
        if social.pantry[p].ownerId == me.id { throw validation("You can't claim your own listing.") }
        if social.pantry[p].claimedByMe { throw conflict("already_claimed", "You already claimed this.") }
        guard social.pantry[p].status == .open else { throw conflict("listing_closed", "That listing is closed.") }
        social.pantry[p].claimedByMe = true
        let e = social.pantry[p]
        return Listing(id: e.id, itemId: e.itemId, ownerId: e.ownerId, groupId: e.groupId, status: .open, recipientId: nil,
                       claimedBy: me.id, createdAt: e.createdAt, fulfilledAt: nil, audience: nil)
    }

    // MARK: Requests

    func listRequests() async throws -> [HelpRequest] {
        try await gate("listRequests")
        return social.requests.filter { $0.status == .open }.sorted { ($0.createdAt ?? .distantPast) > ($1.createdAt ?? .distantPast) }
    }

    func listMyRequests() async throws -> [HelpRequest] {
        try await gate("listMyRequests")
        return social.requests.filter { $0.authorId == me.id }.sorted { ($0.createdAt ?? .distantPast) > ($1.createdAt ?? .distantPast) }
    }

    func createRequest(text: String, friends: Bool, groupIds: [String]) async throws -> HelpRequest {
        try await gate("createRequest")
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (1...280).contains(trimmed.count) else { throw validation("Text must be 1-280 characters.") }
        var seen = Set<String>()
        let unique = groupIds.filter { seen.insert($0).inserted }
        guard friends || !unique.isEmpty else { throw validation("Choose at least one audience.") }
        let groups = try unique.map { id -> GroupRef in
            guard let g = social.groups.first(where: { $0.id == id }) else { throw notFound("Group") }
            return GroupRef(id: g.id, name: g.name)
        }
        defer { nextID += 1 }
        let sortedGroups = groups.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        let r = HelpRequest(id: "req-new-\(nextID)", authorId: me.id, authorName: me.displayName, text: trimmed, status: .open,
                            fulfilledBy: nil, fulfilledByName: nil, createdAt: Date(),
                            audiences: RequestAudiences(friends: friends, groups: sortedGroups), source: RequestSourceInfo(type: .me, name: me.displayName),
                            groupId: sortedGroups.first?.id, groupName: sortedGroups.first?.name)
        social.requests.insert(r, at: 0)
        return r
    }

    func fulfilRequest(id: String) async throws -> HelpRequest {
        try await gate("fulfilRequest")
        guard let i = social.requests.firstIndex(where: { $0.id == id }) else { throw notFound("Request") }
        if social.requests[i].authorId == me.id { throw forbidden("You can't fulfil your own request.") }
        guard social.requests[i].status == .open else { throw conflict("request_closed", "That request is closed.") }
        social.requests[i].status = .fulfilled
        social.requests[i].fulfilledBy = me.id
        social.requests[i].fulfilledByName = me.displayName
        return social.requests[i]
    }

    func cancelRequest(id: String) async throws -> HelpRequest {
        try await gate("cancelRequest")
        guard let i = social.requests.firstIndex(where: { $0.id == id }) else { throw notFound("Request") }
        if social.requests[i].authorId != me.id { throw forbidden("Only the author can cancel a request.") }
        guard social.requests[i].status == .open else { throw conflict("request_closed", "That request is closed.") }
        social.requests[i].status = .cancelled
        return social.requests[i]
    }

    // MARK: Friends

    func listFriends() async throws -> FriendsResponse {
        try await gate("listFriends")
        return social.friends
    }

    /// Finds the accounts in `MockSocialState.directory` (marcus@, ana@, devon@, jordan@, sam@, taylor@example.com).
    func requestFriend(email: String) async throws -> Friend {
        try await gate("requestFriend")
        let key = email.trimmingCharacters(in: .whitespaces).lowercased()
        guard !key.isEmpty else { throw validation("email is required.") }
        if key == me.email { throw validation("You can't add yourself.") }
        guard let user = social.directory[key] else { throw notFound("No BiteDown account with that email") }
        if social.friends.friends.contains(where: { $0.userId == user.id }) { throw conflict("already_friends", "You're already friends.") }
        if social.friends.outgoing.contains(where: { $0.userId == user.id }) || social.friends.incoming.contains(where: { $0.userId == user.id }) {
            throw conflict("request_pending", "A request is already pending.")
        }
        let f = Friend(userId: user.id, displayName: user.displayName, status: .pending, createdAt: Date())
        social.friends.outgoing.append(f)
        return f
    }

    func acceptFriend(userId: String) async throws -> Friend {
        try await gate("acceptFriend")
        guard let i = social.friends.incoming.firstIndex(where: { $0.userId == userId }) else { throw notFound("Friend request") }
        var f = social.friends.incoming.remove(at: i)
        f.status = .accepted
        social.friends.friends.append(f)
        return f
    }

    func declineFriend(userId: String) async throws {
        try await gate("declineFriend")
        try dropFriend(userId)
    }

    func removeFriend(userId: String) async throws {
        try await gate("removeFriend")
        try dropFriend(userId)
    }

    private func dropFriend(_ userId: String) throws {
        let before = social.friends.friends.count + social.friends.incoming.count + social.friends.outgoing.count
        social.friends.friends.removeAll { $0.userId == userId }
        social.friends.incoming.removeAll { $0.userId == userId }
        social.friends.outgoing.removeAll { $0.userId == userId }
        if before == social.friends.friends.count + social.friends.incoming.count + social.friends.outgoing.count {
            throw notFound("Friendship")
        }
        social.people.removeAll { $0.id == userId && $0.kind == .friend }
    }

    // MARK: Groups

    func listGroups() async throws -> [SharingGroup] {
        try await gate("listGroups")
        return social.groups
    }

    func createGroup(name: String) async throws -> SharingGroup {
        try await gate("createGroup")
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (1...60).contains(trimmed.count) else { throw validation("Name must be 1-60 characters.") }
        defer { nextID += 1 }
        let alphabet = Array("ABCDEFGHJKMNPQRSTUVWXYZ23456789")
        let code = String((0..<8).map { alphabet[($0 * 7 + nextID * 3) % alphabet.count] })
        let g = SharingGroup(id: "group-new-\(nextID)", name: trimmed, role: .owner, memberCount: 1, inviteCode: code,
                             createdBy: me.id, createdAt: Date())
        social.groups.append(g)
        social.members[g.id] = [GroupMember(userId: me.id, displayName: me.displayName, role: .owner, joinedAt: Date())]
        return g
    }

    func joinGroup(inviteCode: String) async throws -> SharingGroup {
        try await gate("joinGroup")
        let code = inviteCode.uppercased().filter { !$0.isWhitespace && $0 != "-" }
        if social.groups.contains(where: { $0.inviteCode == code }) { throw conflict("already_member", "You're already in that group.") }
        guard var g = social.joinable[code] else { throw notFound("Group") }
        g.role = .member
        g.memberCount += 1
        social.joinable[code] = nil
        social.groups.append(g)
        social.members[g.id] = [GroupMember(userId: me.id, displayName: me.displayName, role: .member, joinedAt: Date())]
        return g
    }

    func leaveGroup(id: String) async throws {
        try await gate("leaveGroup")
        guard social.groups.contains(where: { $0.id == id }) else { throw notFound("Group") }
        social.groups.removeAll { $0.id == id }
        social.members[id]?.removeAll { $0.userId == me.id }
        // Your open requests lose this audience; one whose only audience was this group is cancelled.
        for r in social.requests.indices where social.requests[r].authorId == me.id && social.requests[r].status == .open {
            social.requests[r].audiences.groups.removeAll { $0.id == id }
            let a = social.requests[r].audiences
            if !a.friends && a.groups.isEmpty { social.requests[r].status = .cancelled }
        }
    }

    func groupDetail(id: String) async throws -> GroupDetail {
        try await gate("groupDetail")
        guard let g = social.groups.first(where: { $0.id == id }) else { throw notFound("Group") }
        return GroupDetail(group: g, members: social.members[id] ?? [])
    }

    func groupPantry(id: String) async throws -> [PantryItem] {
        try await gate("groupPantry")
        guard social.groups.contains(where: { $0.id == id }) else { throw notFound("Group") }
        return (social.groupPantry[id] ?? []).sorted { ($0.item.predictedExpiry ?? .distantFuture) < ($1.item.predictedExpiry ?? .distantFuture) }
    }

    // MARK: People

    /// Like the server: `is_claimer` is true only for the person who claimed `itemId`'s open listing
    /// (the owner's own item); no item, no claim, or an unclaimed listing means all false.
    func reachablePeople(itemId: String?) async throws -> [Person] {
        try await gate("reachablePeople")
        let claimer = items.first(where: { $0.id == itemId })
            .flatMap { $0.share?.status == .open ? $0.share?.claimedBy?.id : nil }
        return social.people.map { person in
            var p = person
            p.isClaimer = person.id == claimer
            return p
        }
    }
}
