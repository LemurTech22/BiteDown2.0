import XCTest
import SwiftUI
@testable import FoodWasteReducer

/// VoiceOver / XCUITest-level facts of the Home pieces, read from the tree SwiftUI builds for a
/// hosted view: labels, ids, traits, 44 pt targets, closures firing, and the AX5 layout.
@MainActor
final class HomeAccessibilityTests: XCTestCase {
    private let minTouch: CGFloat = 44

    // MARK: Hosting helpers

    private var window: UIWindow?

    override func tearDown() {
        window?.isHidden = true
        window = nil
        super.tearDown()
    }

    private static let axEnabled: Bool = {
        guard let h = dlopen("/usr/lib/libAccessibility.dylib", RTLD_NOW),
              let sym = dlsym(h, "_AXSSetAutomationEnabled") else { return false }
        typealias Fn = @convention(c) (Bool) -> Void
        unsafeBitCast(sym, to: Fn.self)(true)
        return true
    }()

    private func leaves<V: View>(of view: V, size: DynamicTypeSize = .large, width: CGFloat = 402) throws -> [NSObject] {
        _ = Self.axEnabled
        let root = view
            .environment(\.dynamicTypeSize, size)
            .environment(\.reduceMotionOverride, true)
        let host = UIHostingController(rootView: root)
        let w = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 874))
        w.rootViewController = host
        w.makeKeyAndVisible()
        window = w
        host.view.setNeedsLayout()
        host.view.layoutIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.35))
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
        els.map { "\($0.accessibilityLabel ?? "nil")#\(identifier($0) ?? "nil")[v=\($0.accessibilityValue ?? "-") h=\($0.accessibilityHint ?? "-") t=\($0.accessibilityTraits.rawValue)]" }
            .joined(separator: ", ")
    }

    private func element(_ els: [NSObject], id: String, file: StaticString = #filePath, line: UInt = #line) throws -> NSObject {
        try XCTUnwrap(els.first { identifier($0) == id }, "no element #\(id) in: \(describe(els))", file: file, line: line)
    }

    private func element(_ els: [NSObject], label: String, file: StaticString = #filePath, line: UInt = #line) throws -> NSObject {
        try XCTUnwrap(els.first { $0.accessibilityLabel == label }, "no element '\(label)' in: \(describe(els))", file: file, line: line)
    }

    private func assertTouchTarget(_ o: NSObject, _ name: String, width: Bool = false, file: StaticString = #filePath, line: UInt = #line) {
        let f = o.accessibilityFrame
        XCTAssertGreaterThanOrEqual(f.height, minTouch - 0.5, "\(name) height \(f.height) < 44", file: file, line: line)
        if width { XCTAssertGreaterThanOrEqual(f.width, minTouch - 0.5, "\(name) width \(f.width) < 44", file: file, line: line) }
    }

    private func isButton(_ o: NSObject) -> Bool { o.accessibilityTraits.contains(.button) }

    private func header(savedKg: Double? = 9.94, name: String? = "Priya",
                        onSettings: @escaping () -> Void = {}, onImpact: @escaping () -> Void = {}) -> some View {
        HomeHeader(name: name, savedKg: savedKg, onOpenSettings: onSettings, onOpenImpact: onImpact)
            .padding(.horizontal, 20)
    }

    // MARK: Header: gear, no profile button

    func testHeaderHasASettingsGearAndNoProfileButton() throws {
        let els = try leaves(of: header())
        let gear = try element(els, id: AccessibilityID.Home.settings)
        XCTAssertEqual(gear.accessibilityLabel, "Settings")
        XCTAssertTrue(isButton(gear))
        assertTouchTarget(gear, "gear", width: true)
        let labels = els.compactMap(\.accessibilityLabel).map { $0.lowercased() }
        XCTAssertFalse(labels.contains { $0.contains("profile") || $0.contains("account") || $0.contains("avatar") },
                       "round 3: the profile button is gone: \(labels)")
    }

    func testGearFiresTheSettingsClosureAndOnlyThat() throws {
        var settings = 0, impact = 0
        let els = try leaves(of: header(onSettings: { settings += 1 }, onImpact: { impact += 1 }))
        XCTAssertTrue(try element(els, id: AccessibilityID.Home.settings).accessibilityActivate())
        XCTAssertEqual(settings, 1)
        XCTAssertEqual(impact, 0)
    }

    func testImpactPillFiresTheImpactClosure() throws {
        var impact = 0
        let els = try leaves(of: header(onImpact: { impact += 1 }))
        let pill = try element(els, id: AccessibilityID.Home.impactPill)
        XCTAssertTrue(isButton(pill))
        assertTouchTarget(pill, "pill")
        XCTAssertTrue(pill.accessibilityActivate())
        XCTAssertEqual(impact, 1)
    }

    func testGreetingIsAHeaderAndSaysHiName() throws {
        let els = try leaves(of: header())
        let g = try element(els, id: AccessibilityID.Home.greeting)
        XCTAssertEqual(g.accessibilityLabel, "Hi, Priya")
        XCTAssertTrue(g.accessibilityTraits.contains(.header))
        let anon = try leaves(of: header(name: nil))
        XCTAssertEqual(try element(anon, id: AccessibilityID.Home.greeting).accessibilityLabel, "Hi there")
    }

    // MARK: Impact pill

    func testPillShowsPoundsViaWeightFormatterAndSpeaksWords() throws {
        UserDefaults.standard.set("us", forKey: UnitSystem.storageKey)
        defer { UserDefaults.standard.removeObject(forKey: UnitSystem.storageKey) }
        let els = try leaves(of: header(savedKg: 9.6))
        let pill = try element(els, id: AccessibilityID.Home.impactPill)
        let spoken = try XCTUnwrap(pill.accessibilityLabel)
        XCTAssertTrue(spoken.contains("21.2 pounds"), spoken)
        XCTAssertTrue(spoken.lowercased().contains("saved"), spoken)
        XCTAssertFalse(spoken.contains(" lb"), "no abbreviation for VoiceOver: \(spoken)")
        XCTAssertFalse(spoken.contains("kg"), spoken)
        XCTAssertNotNil(pill.accessibilityHint)
    }

    func testPillFollowsTheUnitsPreference() throws {
        UserDefaults.standard.set("metric", forKey: UnitSystem.storageKey)
        defer { UserDefaults.standard.removeObject(forKey: UnitSystem.storageKey) }
        let els = try leaves(of: header(savedKg: 9.6))
        let spoken = try XCTUnwrap(try element(els, id: AccessibilityID.Home.impactPill).accessibilityLabel)
        XCTAssertTrue(spoken.contains("kilogram"), spoken)
        XCTAssertFalse(spoken.contains("pound"), spoken)
    }

    func testPillIsHiddenWhenImpactIsUnavailable() throws {
        let els = try leaves(of: header(savedKg: nil))
        XCTAssertFalse(els.contains { identifier($0) == AccessibilityID.Home.impactPill })
    }

    func testZeroSavedStillShowsAPill() throws {
        let els = try leaves(of: header(savedKg: 0))
        XCTAssertTrue(els.contains { identifier($0) == AccessibilityID.Home.impactPill }, "HomeEmpty keeps the pill: '0 lb saved'")
    }

    func testPillSitsBelowTheGreetingAtAX5() throws {
        let els = try leaves(of: header(), size: .accessibility5, width: 320)
        let greeting = try element(els, id: AccessibilityID.Home.greeting).accessibilityFrame
        let date = try element(els, id: AccessibilityID.Home.date).accessibilityFrame
        let pill = try element(els, id: AccessibilityID.Home.impactPill).accessibilityFrame
        let gear = try element(els, id: AccessibilityID.Home.settings).accessibilityFrame
        XCTAssertGreaterThanOrEqual(pill.minY, greeting.maxY - 0.5, "pill below the greeting at AX5")
        XCTAssertGreaterThanOrEqual(pill.minY, date.maxY - 0.5)
        XCTAssertLessThanOrEqual(pill.maxX, 320.5, "pill stays on screen")
        XCTAssertLessThanOrEqual(gear.maxX, 320.5, "gear stays on screen")
        XCTAssertGreaterThanOrEqual(gear.width, minTouch - 0.5)
        XCTAssertGreaterThanOrEqual(gear.height, minTouch - 0.5)
    }

    func testPillSharesTheGreetingRowAtDefaultSize() throws {
        let els = try leaves(of: header())
        let greeting = try element(els, id: AccessibilityID.Home.greeting).accessibilityFrame
        let pill = try element(els, id: AccessibilityID.Home.impactPill).accessibilityFrame
        XCTAssertLessThan(pill.minY, greeting.maxY, "default size: pill on the header row, not stacked")
    }

    // MARK: Tip

    func testTipIsOneElementWithADismissButton() throws {
        var dismissed = 0
        let msg = "Cilantro went in the bin 3 times in the last 30 days."
        let els = try leaves(of: HomeTipCard(message: msg, onDismiss: { dismissed += 1 }))
        let tip = try element(els, id: AccessibilityID.Home.tip)
        XCTAssertEqual(tip.accessibilityLabel, msg, "shown verbatim")
        XCTAssertFalse(isButton(tip))
        let x = try element(els, id: AccessibilityID.Home.tipDismiss)
        XCTAssertEqual(x.accessibilityLabel, "Dismiss tip")
        XCTAssertTrue(isButton(x))
        assertTouchTarget(x, "dismiss", width: true)
        XCTAssertTrue(x.accessibilityActivate())
        XCTAssertEqual(dismissed, 1)
    }

    func testTipDismissStaysOnScreenAndBigEnoughAtAX5() throws {
        let msg = String(repeating: "Spinach was forgotten twice before. ", count: 3).trimmingCharacters(in: .whitespaces)
        let els = try leaves(of: HomeTipCard(message: msg, onDismiss: {}), size: .accessibility5, width: 320)
        let x = try element(els, id: AccessibilityID.Home.tipDismiss)
        assertTouchTarget(x, "dismiss@AX5", width: true)
        XCTAssertLessThanOrEqual(x.accessibilityFrame.maxX, 320.5)
        XCTAssertEqual(try element(els, id: AccessibilityID.Home.tip).accessibilityLabel, msg, "wraps, never truncates")
    }

    // MARK: ServerError

    func testErrorCardTryAgainAndChangeFireTheirClosures() throws {
        var retried = 0, changed = 0
        let card = HomeErrorCard(host: "demo-xyz.trycloudflare.com", retry: { retried += 1 }, onChangeServer: { changed += 1 })
        let els = try leaves(of: card.padding(.horizontal, 20))
        let retry = try element(els, id: AccessibilityID.State.retry("home"))
        XCTAssertEqual(retry.accessibilityLabel, "Try again")
        XCTAssertTrue(isButton(retry))
        assertTouchTarget(retry, "Try again", width: true)
        let change = try element(els, id: AccessibilityID.Home.serverChange)
        XCTAssertTrue(isButton(change))
        assertTouchTarget(change, "Change", width: true)
        XCTAssertTrue(retry.accessibilityActivate())
        XCTAssertEqual(retried, 1); XCTAssertEqual(changed, 0)
        XCTAssertTrue(change.accessibilityActivate())
        XCTAssertEqual(changed, 1); XCTAssertEqual(retried, 1)
    }

    func testErrorCardNamesTheServerHostAndThatFoodCouldNotLoad() throws {
        let card = HomeErrorCard(host: "demo-xyz.trycloudflare.com", retry: {}, onChangeServer: {})
        let els = try leaves(of: card.padding(.horizontal, 20))
        let labels = els.compactMap(\.accessibilityLabel)
        XCTAssertTrue(labels.contains { $0.contains("Couldn't load your food") }, "\(labels)")
        XCTAssertTrue(labels.contains { $0.contains("demo-xyz.trycloudflare.com") }, "\(labels)")
    }

    func testErrorCardChangeIsLabelledForVoiceOver() throws {
        let els = try leaves(of: HomeErrorCard(host: "h.example", retry: {}, onChangeServer: {}))
        let label = try XCTUnwrap(try element(els, id: AccessibilityID.Home.serverChange).accessibilityLabel)
        XCTAssertTrue(label.contains("Change"), label)
        XCTAssertTrue(label.lowercased().contains("server"), "say what changes: \(label)")
    }

    func testErrorCardTargetsHoldAtAX5() throws {
        let card = HomeErrorCard(host: "demo-xyz-very-long-name.trycloudflare.com", retry: {}, onChangeServer: {})
        let els = try leaves(of: card.padding(.horizontal, 20), size: .accessibility5, width: 320)
        for id in [AccessibilityID.State.retry("home"), AccessibilityID.Home.serverChange] {
            let e = try element(els, id: id)
            assertTouchTarget(e, id, width: true)
            XCTAssertLessThanOrEqual(e.accessibilityFrame.maxX, 320.5, "\(id) on screen at AX5")
        }
    }

    func testOfflineBannerRetryFiresAndIsLargeEnough() throws {
        var n = 0
        let els = try leaves(of: HomeOfflineBanner(message: "Can't reach BiteDown. Check your connection.", retry: { n += 1 }).padding(.horizontal, 20))
        let retry = try element(els, id: AccessibilityID.Home.bannerRetry)
        XCTAssertEqual(retry.accessibilityLabel, "Try again")
        XCTAssertTrue(isButton(retry))
        assertTouchTarget(retry, "banner retry", width: true)
        XCTAssertTrue(retry.accessibilityActivate())
        XCTAssertEqual(n, 1)
        XCTAssertTrue(els.compactMap(\.accessibilityLabel).contains { $0.contains("Can't reach BiteDown") })
    }

    // MARK: Rows and cook card

    func testUseFirstRowIsOneStopWithNameQuantityAndExpiry() throws {
        let item = MockData.items(for: .fridge).first { $0.id == "item-chicken" }!
        var opened = 0
        let els = try leaves(of: HomeItemRow(item: item, onOpen: { opened += 1 }))
        XCTAssertEqual(els.count, 1, "one VoiceOver stop per row: \(describe(els))")
        let row = try element(els, id: AccessibilityID.Home.row("item-chicken"))
        let label = try XCTUnwrap(row.accessibilityLabel)
        XCTAssertTrue(label.contains("Chicken thighs"), label)
        XCTAssertTrue(label.contains("today"), "expiry text is part of the row, not colour alone: \(label)")
        assertTouchTarget(row, "row")
        XCTAssertTrue(row.accessibilityActivate())
        XCTAssertEqual(opened, 1)
    }

    func testCookCardIsOneButtonStopThatOpensTheRecipe() throws {
        var opened = 0
        let r = MockData.recipes[0]
        let els = try leaves(of: HomeCookCard(recipe: r, onOpen: { opened += 1 }).padding(.horizontal, 20))
        XCTAssertEqual(els.count, 1, describe(els))
        let card = try element(els, id: AccessibilityID.Home.cookCard)
        XCTAssertTrue(isButton(card))
        XCTAssertTrue((card.accessibilityLabel ?? "").contains(r.title))
        XCTAssertTrue(card.accessibilityActivate())
        XCTAssertEqual(opened, 1)
    }
}
