import XCTest
import SwiftUI
@testable import FoodWasteReducer

/// VoiceOver tree of the polished Fridge row and Remove sheets, read from a hosted view (same
/// technique as `ComponentAccessibilityTests`). Covers: the "Remove" custom action exactly once,
/// IOS-13 (no stray asset-name stop), badge spoken text, select-mode checkbox semantics, the
/// reachable sheet tiles and the group label "What happened to it?".
@MainActor
final class FridgePolishAccessibilityTests: XCTestCase {
    private var window: UIWindow?
    override func tearDown() { window?.isHidden = true; window = nil; super.tearDown() }

    private static let axEnabled: Bool = {
        guard let h = dlopen("/usr/lib/libAccessibility.dylib", RTLD_NOW),
              let sym = dlsym(h, "_AXSSetAutomationEnabled") else { return false }
        typealias Fn = @convention(c) (Bool) -> Void
        unsafeBitCast(sym, to: Fn.self)(true)
        return true
    }()

    private func leaves<V: View>(of view: V, size: DynamicTypeSize = .large, width: CGFloat = 402, height: CGFloat = 874) throws -> [NSObject] {
        _ = Self.axEnabled
        let root = view.environment(\.dynamicTypeSize, size).environment(\.reduceMotionOverride, true)
        let host = UIHostingController(rootView: root)
        let w = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: height))
        w.rootViewController = host
        w.makeKeyAndVisible()
        window = w
        host.view.setNeedsLayout(); host.view.layoutIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.5))
        var out: [NSObject] = []
        collect(host.view, into: &out)
        if out.isEmpty { throw XCTSkip("SwiftUI exposed no accessibility elements in this host") }
        return out
    }

    private func collect(_ node: NSObject, into out: inout [NSObject]) {
        if node.isAccessibilityElement { out.append(node); return }
        var children: [NSObject] = []
        if let els = node.accessibilityElements as? [NSObject], !els.isEmpty {
            children = els
        } else {
            let n = node.accessibilityElementCount()
            if n != NSNotFound, n > 0 { children = (0..<n).compactMap { node.accessibilityElement(at: $0) as? NSObject } }
            if children.isEmpty, let v = node as? UIView { children = v.subviews }
        }
        for c in children { collect(c, into: &out) }
    }

    private func identifier(_ o: NSObject) -> String? {
        if let id = (o as? UIAccessibilityIdentification)?.accessibilityIdentifier { return id }
        let sel = NSSelectorFromString("accessibilityIdentifier")
        guard o.responds(to: sel) else { return nil }
        return o.perform(sel)?.takeUnretainedValue() as? String
    }
    private func describe(_ els: [NSObject]) -> String {
        els.map { "\($0.accessibilityLabel ?? "nil")#\(identifier($0) ?? "nil")[v=\($0.accessibilityValue ?? "-") t=\($0.accessibilityTraits.rawValue) a=\($0.accessibilityCustomActions?.map(\.name) ?? [])]" }
            .joined(separator: " | ")
    }
    private func items() async -> [String: Item] {
        let all = await MockAPIClient(fixture: .listing, behavior: .init(delay: .zero)).currentItems()
        return Dictionary(uniqueKeysWithValues: all.map { ($0.id, $0) })
    }
    private func fixture(_ id: String) async throws -> Item {
        let all = await items()
        return try XCTUnwrap(all[id], id)
    }
    private func actions(_ o: NSObject) -> [String] { o.accessibilityCustomActions?.map(\.name) ?? [] }

    // MARK: Row (normal mode)

    func testRowHasExactlyOneRemoveCustomAction() async throws {
        let item = try await fixture("item-chicken")
        let els = try leaves(of: FridgeItemRow(item: item))
        let allActions = els.flatMap(actions)
        XCTAssertEqual(allActions.filter { $0 == "Remove" }.count, 1, "VoiceOver rotor must offer Remove once: \(describe(els))")
        let text = try XCTUnwrap(els.first { ($0.accessibilityLabel ?? "").contains("Chicken") }, describe(els))
        XCTAssertTrue(actions(text).contains("Remove"), "the Remove action lives on the name/meta element: \(describe(els))")
    }

    func testRowRemoveActionInvokesTheCallback() async throws {
        let item = try await fixture("item-chicken")
        var removed = 0
        let els = try leaves(of: FridgeItemRow(item: item, onRemove: { removed += 1 }))
        let action = try XCTUnwrap(els.flatMap { $0.accessibilityCustomActions ?? [] }.first { $0.name == "Remove" })
        XCTAssertTrue(action.actionHandler?(action) ?? false, "handler should report handled")
        XCTAssertEqual(removed, 1)
    }

    /// IOS-13: no stop reads an asset name such as "FoodGroupProtein".
    func testRowHasNoAssetNameStop() async throws {
        for id in ["item-chicken", "item-spinach", "item-strawberries", "item-yogurt"] {
            let item = try await fixture(id)
            let els = try leaves(of: FridgeItemRow(item: item))
            XCTAssertFalse(els.contains { ($0.accessibilityLabel ?? "").contains("FoodGroup") },
                           "IOS-13: asset name exposed for \(id): \(describe(els))")
            XCTAssertLessThanOrEqual(els.count, 2, "a row is at most two stops (text + badge): \(describe(els))")
        }
    }

    func testBadgeIsSpokenInWordsNotColour() async throws {
        let spoiled = try await fixture("item-strawberries")
        let els = try leaves(of: FridgeItemRow(item: spoiled))
        XCTAssertTrue(els.contains { ($0.accessibilityLabel ?? "") == "Looks off, may be spoiled" }, describe(els))
        let tomorrow = try await fixture("item-spinach")
        let els2 = try leaves(of: FridgeItemRow(item: tomorrow))
        XCTAssertTrue(els2.contains { ($0.accessibilityLabel ?? "") == "Expires tomorrow" }, describe(els2))
    }

    func testRowTextIsNameThenQuantityOnly() async throws {
        let item = try await fixture("item-chicken")
        let els = try leaves(of: FridgeItemRow(item: item))
        let text = try XCTUnwrap(els.first { ($0.accessibilityLabel ?? "").contains("Chicken") })
        XCTAssertEqual(text.accessibilityLabel?.contains("1.4 lb"), true, text.accessibilityLabel ?? "nil")
        XCTAssertFalse((text.accessibilityLabel ?? "").lowercased().contains("photo"), "one status per row")
    }

    func testRowStacksBadgeUnderTextAtAX5AndBadgeStaysOneLine() async throws {
        let item = try await fixture("item-strawberries")
        let els = try leaves(of: FridgeItemRow(item: item), size: .accessibility5, width: 320)
        let text = try XCTUnwrap(els.first { ($0.accessibilityLabel ?? "").contains("Strawberries") })
        let badge = try XCTUnwrap(els.first { ($0.accessibilityLabel ?? "").hasPrefix("Looks off") })
        XCTAssertGreaterThanOrEqual(badge.accessibilityFrame.minY, text.accessibilityFrame.maxY - 1,
                                    "AX5: badge sits under the text: text \(text.accessibilityFrame) badge \(badge.accessibilityFrame)")
        XCTAssertLessThanOrEqual(badge.accessibilityFrame.maxX, 320.5, "badge not clipped")
        // One line of badge text at AX5 is far shorter than two: it would be ~2x if "Looks off" wrapped.
        let one = try leaves(of: FridgeItemRow(item: item), size: .accessibility5, width: 800)
        let wide = try XCTUnwrap(one.first { ($0.accessibilityLabel ?? "").hasPrefix("Looks off") })
        XCTAssertEqual(badge.accessibilityFrame.height, wide.accessibilityFrame.height, accuracy: 1,
                       "badge wrapped at 320 pt: \(badge.accessibilityFrame.height) vs \(wide.accessibilityFrame.height)")
    }

    // MARK: Row (select mode)

    func testSelectRowIsOneCheckboxButtonWithState() async throws {
        let item = try await fixture("item-eggs")
        for on in [false, true] {
            let els = try leaves(of: FridgeItemRow(item: item, selected: on))
            XCTAssertEqual(els.count, 1, "select row is a single stop: \(describe(els))")
            let row = els[0]
            XCTAssertTrue(row.accessibilityTraits.contains(.button))
            XCTAssertEqual(row.accessibilityValue, on ? "Selected" : "Not selected", "colour is not the only cue")
            XCTAssertTrue((row.accessibilityLabel ?? "").hasPrefix("Select Eggs"), row.accessibilityLabel ?? "nil")
            XCTAssertEqual(identifier(row), "fridge.row.item-eggs.select")
            XCTAssertFalse(actions(row).contains("Remove"), "no Remove action while selecting")
            XCTAssertGreaterThanOrEqual(row.accessibilityFrame.height, 43.5)
        }
    }

    // MARK: Remove sheet

    private func sheet(_ item: Item, people: [Person] = []) -> some View {
        RemoveSheet(item: item, loadPeople: { people }, onRemove: { _ in }, close: {})
    }

    func testSheetTilesAreReachableButtonsInOneLabelledGroup() async throws {
        let item = try await fixture("item-spinach")
        let els = try leaves(of: sheet(item), height: 900)
        for (title, id) in [("Used it", "remove.outcome.used"), ("Shared it", "remove.outcome.donated"),
                            ("Threw it away", "remove.outcome.thrown_out")] {
            let tile = try XCTUnwrap(els.first { identifier($0) == id }, "tile \(id) not reachable: \(describe(els))")
            XCTAssertEqual(tile.accessibilityLabel, title)
            XCTAssertTrue(tile.accessibilityTraits.contains(.button), id)
            XCTAssertGreaterThanOrEqual(tile.accessibilityFrame.height, 67.5, "\(id) is a 68 pt tile")
            XCTAssertTrue((tile.accessibilityHint ?? "").isEmpty, "no captions → no hints: \(tile.accessibilityHint ?? "")")
        }
        XCTAssertFalse(els.contains { ($0.accessibilityLabel ?? "") == "Gave it away" })
        XCTAssertFalse(els.contains { ($0.accessibilityLabel ?? "").contains("FoodGroup") }, "IOS-13 in the sheet header")
    }

    func testSheetHasNoVisibleHeadingButTheGroupIsLabelled() async throws {
        let item = try await fixture("item-eggs")
        let els = try leaves(of: sheet(item), height: 900)
        // Tiles are not combined into one stop: the label sits on the container, not on a static text.
        XCTAssertFalse(els.contains { ($0.accessibilityLabel ?? "") == "What happened to it?" && $0.accessibilityTraits.contains(.staticText) },
                       "no visible heading: \(describe(els))")
        let tiles = els.filter { (identifier($0) ?? "").hasPrefix("remove.outcome.") }
        XCTAssertEqual(tiles.count, 3, describe(els))
    }

    func testSheetListingBadgeIsLabelledAndHeaderBadgeSpoken() async throws {
        let item = try await fixture("item-spinach")
        let els = try leaves(of: sheet(item), height: 900)
        XCTAssertTrue(els.contains { identifier($0) == "remove.listing" && $0.accessibilityLabel == "Shared with friends" }, describe(els))
        XCTAssertTrue(els.contains { identifier($0) == "remove.badge" && $0.accessibilityLabel == "Expires tomorrow" }, describe(els))
        let unlisted = try await fixture("item-eggs")
        XCTAssertFalse(try leaves(of: sheet(unlisted), height: 900).contains { identifier($0) == "remove.listing" })
    }

    func testSheetHeaderStacksAtAX5() async throws {
        let item = try await fixture("item-spinach")
        let els = try leaves(of: sheet(item), size: .accessibility5, width: 320, height: 1400)
        let badge = try XCTUnwrap(els.first { identifier($0) == "remove.badge" })
        let title = try XCTUnwrap(els.first { identifier($0) == "remove.title" })
        XCTAssertGreaterThanOrEqual(badge.accessibilityFrame.minY, title.accessibilityFrame.maxY - 1, "AX5 header stacks")
        XCTAssertLessThanOrEqual(badge.accessibilityFrame.maxX, 320.5)
    }

    // MARK: Reason screen

    func testReasonRowsAre68ptButtonsInOrder() async throws {
        let item = try await fixture("item-strawberries")
        let els = try leaves(of: RemoveReasonView(item: item, onReason: { _ in }, close: {}), height: 900)
        let rows = ["expired", "forgot", "didnt_like", "other"].compactMap { r in els.first { identifier($0) == "remove.reason.\(r)" } }
        XCTAssertEqual(rows.count, 4, describe(els))
        XCTAssertEqual(rows.map { $0.accessibilityLabel ?? "" }, ["Expired", "Forgot about it", "Didn't like it", "Other"])
        XCTAssertEqual(rows.map { $0.accessibilityFrame.minY }, rows.map { $0.accessibilityFrame.minY }.sorted())
        for r in rows {
            XCTAssertGreaterThanOrEqual(r.accessibilityFrame.height, 67.5, "v53: 68 pt rows, got \(r.accessibilityFrame.height)")
            XCTAssertTrue(r.accessibilityTraits.contains(.button))
        }
        let title = els.first { identifier($0) == "removereason.title" }
        XCTAssertEqual(title?.accessibilityLabel, "Why was it thrown out?")
        XCTAssertTrue(title?.accessibilityTraits.contains(.header) ?? false)
    }
}
