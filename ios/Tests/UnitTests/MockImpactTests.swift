import XCTest
@testable import FoodWasteReducer

/// The mock's Impact follows the items: removing food moves it, Undo moves it back. This is what makes the
/// demo path (add food, remove it as Used, open Impact) show a real change on `-UITestMockAPI`.
final class MockImpactTests: XCTestCase {
    private func client(_ fixture: MockFixture = .fridge) -> MockAPIClient {
        MockAPIClient(fixture: fixture, behavior: .init(delay: .zero), signedIn: true)
    }

    /// The `empty` seed the way the app builds it for `-UITestSeed empty`: same fixture, same behaviour flags.
    private func emptySeedClient() -> MockAPIClient {
        var behavior = LaunchConfiguration(arguments: ["-UITestMockAPI", "-UITestSeed", "empty"]).mockBehavior
        behavior.delay = .zero
        return MockAPIClient(fixture: MockFixture(name: "empty"), behavior: behavior, signedIn: true)
    }

    /// Contract invariants that must survive any removal or Undo (`GET /impact`, wave-2 shape).
    private func assertConsistent(_ i: Impact, _ context: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(i.saved.count, i.used.count + i.donated.count, "saved = used + donated: \(context)", file: file, line: line)
        XCTAssertEqual(i.saved.kg, i.used.kg + i.donated.kg, accuracy: 0.011, "saved kg: \(context)", file: file, line: line)
        XCTAssertEqual(i.saved.money, i.used.money + i.donated.money, accuracy: 0.011, "saved money: \(context)", file: file, line: line)
        let total = i.saved.count + i.wasted.count
        XCTAssertEqual(i.wasteRate, total == 0 ? 0 : Double(i.wasted.count) / Double(total), accuracy: 0.011, "waste rate: \(context)", file: file, line: line)
        XCTAssertEqual(i.wasteReasons.count, 4, "all four reasons, always: \(context)", file: file, line: line)
        XCTAssertEqual(Set(i.wasteReasons.map(\.reason)), Set(WasteReason.allCases), context, file: file, line: line)
        XCTAssertEqual(i.wasteReasons.map(\.count), i.wasteReasons.map(\.count).sorted(by: >), "sorted by count desc: \(context)", file: file, line: line)
        XCTAssertEqual(i.wasteReasons.map(\.count).reduce(0, +), i.wasted.count, "reasons add up to wasted: \(context)", file: file, line: line)
        if i.wasted.count > 0 {
            XCTAssertEqual(i.wasteReasons.map(\.share).reduce(0, +), 1, accuracy: 0.02, "reason shares: \(context)", file: file, line: line)
        }
        XCTAssertEqual(i.last6Weeks.count, 6, context, file: file, line: line)
        XCTAssertTrue(i.last6Weeks.allSatisfy { $0.saved == $0.used + $0.donated }, "weekly saved = used + donated: \(context)", file: file, line: line)
    }

    private func stat(_ reason: WasteReason, in i: Impact) -> WasteReasonStat {
        i.wasteReasons.first { $0.reason == reason }!
    }

    // MARK: Used

    func testRemovingAsUsedIncreasesSaved() async throws {
        for range in ImpactRange.allCases {
            let c = client()
            let before = try await c.impact(range: range)
            _ = try await c.removeItem(id: "item-eggs", outcome: .used)
            let after = try await c.impact(range: range)
            let ctx = "\(range)"
            XCTAssertEqual(after.saved.count, before.saved.count + 1, ctx)
            XCTAssertEqual(after.used.count, before.used.count + 1, ctx)
            XCTAssertGreaterThan(after.saved.kg, before.saved.kg, ctx)
            XCTAssertGreaterThan(after.used.kg, before.used.kg, ctx)
            XCTAssertGreaterThan(after.saved.money, before.saved.money, ctx)
            XCTAssertGreaterThan(after.saved.co2eKg, before.saved.co2eKg, ctx)
            XCTAssertEqual(after.donated, before.donated, "a Used removal leaves Donated alone: \(ctx)")
            XCTAssertEqual(after.wasted, before.wasted, "a Used removal leaves Wasted alone: \(ctx)")
            XCTAssertEqual(after.wasteReasons, before.wasteReasons, ctx)
            XCTAssertLessThanOrEqual(after.wasteRate, before.wasteRate, "more saved never raises the waste rate: \(ctx)")
            XCTAssertEqual(after.previous, before.previous, "the previous window does not move: \(ctx)")
            XCTAssertEqual(after.last6Weeks.last?.saved, (before.last6Weeks.last?.saved ?? 0) + 1, "this week's bucket: \(ctx)")
            XCTAssertEqual(after.last6Weeks.last?.used, (before.last6Weeks.last?.used ?? 0) + 1, "this week's bucket: \(ctx)")
            XCTAssertEqual(Array(after.last6Weeks.dropLast()), Array(before.last6Weeks.dropLast()), "earlier weeks do not move: \(ctx)")
            assertConsistent(after, ctx)
        }
    }

    func testRemovingAsDonatedIncreasesSavedAndDonatedButNotUsed() async throws {
        for range in ImpactRange.allCases {
            let c = client()
            let before = try await c.impact(range: range)
            _ = try await c.removeItem(id: "item-eggs", outcome: .donated)
            let after = try await c.impact(range: range)
            let ctx = "\(range)"
            XCTAssertEqual(after.saved.count, before.saved.count + 1, ctx)
            XCTAssertEqual(after.donated.count, before.donated.count + 1, ctx)
            XCTAssertGreaterThan(after.saved.kg, before.saved.kg, ctx)
            XCTAssertGreaterThan(after.donated.kg, before.donated.kg, ctx)
            XCTAssertEqual(after.used, before.used, ctx)
            XCTAssertEqual(after.wasted, before.wasted, ctx)
            XCTAssertEqual(after.last6Weeks.last?.donated, (before.last6Weeks.last?.donated ?? 0) + 1, ctx)
            assertConsistent(after, ctx)
        }
    }

    // MARK: Thrown out

    func testThrowingOutIncreasesWastedWithItsReason() async throws {
        for range in ImpactRange.allCases {
            for reason in WasteReason.allCases {
                let c = client()
                let before = try await c.impact(range: range)
                _ = try await c.removeItem(id: "item-bananas", outcome: .thrownOut, wasteReason: reason)
                let after = try await c.impact(range: range)
                let ctx = "\(range) \(reason.rawValue)"
                XCTAssertEqual(after.wasted.count, before.wasted.count + 1, ctx)
                XCTAssertGreaterThan(after.wasted.kg, before.wasted.kg, ctx)
                XCTAssertGreaterThan(after.wasted.money, before.wasted.money, ctx)
                XCTAssertGreaterThan(after.wasted.co2eKg, before.wasted.co2eKg, ctx)
                XCTAssertEqual(after.saved, before.saved, "a thrown-out item is not saved: \(ctx)")
                XCTAssertEqual(after.used, before.used, ctx)
                XCTAssertEqual(after.donated, before.donated, ctx)
                XCTAssertGreaterThan(after.wasteRate, before.wasteRate, "more wasted raises the waste rate: \(ctx)")
                XCTAssertEqual(stat(reason, in: after).count, stat(reason, in: before).count + 1, "its reason counts it: \(ctx)")
                XCTAssertGreaterThan(stat(reason, in: after).kg, stat(reason, in: before).kg, ctx)
                for other in WasteReason.allCases where other != reason {
                    XCTAssertEqual(stat(other, in: after).count, stat(other, in: before).count, "\(other.rawValue) unchanged: \(ctx)")
                }
                XCTAssertEqual(after.last6Weeks.last?.wasted, (before.last6Weeks.last?.wasted ?? 0) + 1, "this week's bucket: \(ctx)")
                assertConsistent(after, ctx)
            }
        }
    }

    // MARK: Undo

    func testRestoreReturnsImpactExactlyToTheBaseline() async throws {
        let removals: [(RemoveOutcome, WasteReason?)] = [(.used, nil), (.donated, nil), (.thrownOut, .forgot), (.thrownOut, .expired)]
        for range in ImpactRange.allCases {
            for (outcome, reason) in removals {
                let c = client()
                let baseline = try await c.impact(range: range)
                _ = try await c.removeItem(id: "item-chicken", outcome: outcome, wasteReason: reason)
                let moved = try await c.impact(range: range)
                let ctx = "\(range) \(outcome.rawValue) \(reason?.rawValue ?? "-")"
                XCTAssertNotEqual(moved, baseline, "the removal moved Impact: \(ctx)")
                _ = try await c.restoreItem(id: "item-chicken")
                let restored = try await c.impact(range: range)
                XCTAssertEqual(restored, baseline, "Undo returns every field to the baseline: \(ctx)")
            }
        }
    }

    func testRestoreOfOneOfTwoRemovalsLeavesTheOther() async throws {
        let a = client(), b = client()
        _ = try await a.removeItem(id: "item-eggs", outcome: .used)
        _ = try await a.removeItem(id: "item-chicken", outcome: .thrownOut, wasteReason: .forgot)
        _ = try await a.restoreItem(id: "item-eggs")
        _ = try await b.removeItem(id: "item-chicken", outcome: .thrownOut, wasteReason: .forgot)
        for range in ImpactRange.allCases {
            let both = try await a.impact(range: range)
            let only = try await b.impact(range: range)
            XCTAssertEqual(both, only, "restoring eggs leaves exactly the chicken removal: \(range)")
        }
    }

    func testRemovingTheSameItemAgainAfterUndoCountsOnce() async throws {
        let c = client()
        let baseline = try await c.impact(range: .month)
        _ = try await c.removeItem(id: "item-eggs", outcome: .used)
        _ = try await c.restoreItem(id: "item-eggs")
        _ = try await c.removeItem(id: "item-eggs", outcome: .used)
        let after = try await c.impact(range: .month)
        XCTAssertEqual(after.saved.count, baseline.saved.count + 1)
        XCTAssertEqual(after.used.count, baseline.used.count + 1)
    }

    // MARK: Batch (Fridge "Used them")

    func testBatchRemovalAndRestoreMoveImpactLikeSingleOnes() async throws {
        let c = client()
        let baseline = try await c.impact(range: .month)
        _ = try await c.removeBatch(ids: ["item-eggs", "item-chicken"], outcome: .used)
        let moved = try await c.impact(range: .month)
        XCTAssertEqual(moved.saved.count, baseline.saved.count + 2)
        XCTAssertEqual(moved.used.count, baseline.used.count + 2)
        XCTAssertGreaterThan(moved.saved.kg, baseline.saved.kg)
        assertConsistent(moved, "batch")
        _ = try await c.restoreBatch(ids: ["item-eggs", "item-chicken"])
        let restored = try await c.impact(range: .month)
        XCTAssertEqual(restored, baseline)
    }

    // MARK: Rejected removals change nothing

    func testRejectedAndRepeatedRemovalsDoNotMoveImpact() async throws {
        let c = client()
        let baseline = try await c.impact(range: .all)
        // thrown_out needs a reason; unknown id; reason on a non-thrown_out outcome.
        _ = try? await c.removeItem(id: "item-eggs", outcome: .thrownOut)
        _ = try? await c.removeItem(id: "nope", outcome: .used)
        _ = try? await c.removeItem(id: "item-eggs", outcome: .used, wasteReason: .expired)
        let untouched = try await c.impact(range: .all)
        XCTAssertEqual(untouched, baseline, "rejected removals left Impact alone")

        _ = try await c.removeItem(id: "item-eggs", outcome: .used)
        let once = try await c.impact(range: .all)
        _ = try? await c.removeItem(id: "item-eggs", outcome: .used)   // 409 already_removed
        let twice = try await c.impact(range: .all)
        XCTAssertEqual(twice, once, "a repeated removal is not counted twice")
    }

    func testRestoringAnActiveItemDoesNotMoveImpact() async throws {
        let c = client()
        let baseline = try await c.impact(range: .all)
        _ = try? await c.restoreItem(id: "item-eggs")   // 409 not_removed
        let after = try await c.impact(range: .all)
        XCTAssertEqual(after, baseline)
    }

    // MARK: Empty seed

    func testEmptySeedStartsAtZeroAndARemovalMakesImpactNonZero() async throws {
        let c = emptySeedClient()
        var baselines: [ImpactRange: Impact] = [:]
        for range in ImpactRange.allCases {
            let zero = try await c.impact(range: range)
            XCTAssertEqual(zero.saved, .zero, "empty seed starts at zero: \(range)")
            XCTAssertEqual(zero.wasted, .zero, "\(range)")
            XCTAssertEqual(zero.wasteRate, 0, "\(range)")
            baselines[range] = zero
        }
        let created = try await c.createItems([NewItem(name: "Bananas", estPrice: 2, estWeightKg: 0.4)])
        let id = try XCTUnwrap(created.first?.id)
        for range in ImpactRange.allCases {
            let afterAdd = try await c.impact(range: range)
            XCTAssertEqual(afterAdd, baselines[range], "adding food alone does not move Impact: \(range)")
        }

        _ = try await c.removeItem(id: id, outcome: .used)
        for range in ImpactRange.allCases {
            let i = try await c.impact(range: range)
            XCTAssertEqual(i.saved.count, 1, "\(range)")
            XCTAssertEqual(i.used.count, 1, "\(range)")
            XCTAssertGreaterThan(i.saved.kg, 0, "\(range)")
            XCTAssertEqual(i.wasted, .zero, "\(range)")
            XCTAssertEqual(i.wasteRate, 0, "\(range)")
            assertConsistent(i, "empty + used \(range)")
        }

        _ = try await c.restoreItem(id: id)
        for range in ImpactRange.allCases {
            let i = try await c.impact(range: range)
            XCTAssertEqual(i, baselines[range], "Undo returns the empty seed to zero: \(range)")
        }

        _ = try await c.removeItem(id: id, outcome: .thrownOut, wasteReason: .forgot)
        for range in ImpactRange.allCases {
            let i = try await c.impact(range: range)
            XCTAssertEqual(i.saved, .zero, "\(range)")
            XCTAssertEqual(i.wasted.count, 1, "\(range)")
            XCTAssertGreaterThan(i.wasted.kg, 0, "\(range)")
            XCTAssertEqual(stat(.forgot, in: i).count, 1, "\(range)")
            XCTAssertEqual(i.wasteRate, 1, accuracy: 0.011, "all of it wasted: \(range)")
            assertConsistent(i, "empty + thrown out \(range)")
        }
    }
}
