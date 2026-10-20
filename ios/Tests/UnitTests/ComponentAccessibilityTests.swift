import XCTest
import SwiftUI
@testable import FoodWasteReducer

/// Accessibility of the shared components, read from the tree SwiftUI builds for a hosted view
/// (same technique as `SkeletonAccessibilityTests`): labels, values, traits, identifiers and 44 pt targets.
@MainActor
final class ComponentAccessibilityTests: XCTestCase {
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
        window?.isHidden = true
        window = nil
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

    // MARK: BannerView

    private func banner(_ style: BannerStyle = .error, message: String = "Couldn't remove Chicken thighs.",
                        retry: Bool = true, dismiss: Bool = true, retryTitle: String = "Try again",
                        onRetry: @escaping () -> Void = {}, onDismiss: @escaping () -> Void = {}) -> BannerView {
        BannerView(style: style, message: message, retryTitle: retryTitle,
                   retry: retry ? onRetry : nil, dismiss: dismiss ? onDismiss : nil,
                   identifiers: BannerIdentifiers(container: "test.banner", retry: "test.banner.retry", dismiss: "test.banner.dismiss"))
    }

    func testBannerMessageIsReadVerbatimWithoutIconNoise() throws {
        for style in [BannerStyle.error, .warning, .info, .success] {
            let els = try leaves(of: banner(style, retry: false, dismiss: false))
            let msg = try element(els, label: "Couldn't remove Chicken thighs.")
            XCTAssertFalse(isButton(msg), "\(style): the message is not a button")
            XCTAssertEqual(els.count, 1, "\(style) without actions is one stop: \(describe(els))")
            XCTAssertFalse(els.contains { ($0.accessibilityLabel ?? "").contains("triangle") || ($0.accessibilityLabel ?? "").contains("circle") },
                           "SF Symbol names must not be spoken")
        }
    }

    func testBannerRetryAndDismissAreLabelledButtonsWithIdentifiers() throws {
        let els = try leaves(of: banner())
        let retry = try element(els, id: "test.banner.retry")
        XCTAssertEqual(retry.accessibilityLabel, "Try again")
        XCTAssertTrue(isButton(retry))
        let dismiss = try element(els, id: "test.banner.dismiss")
        XCTAssertEqual(dismiss.accessibilityLabel, "Dismiss", "the icon-only button needs a label")
        XCTAssertTrue(isButton(dismiss))
    }

    func testBannerTargetsAre44() throws {
        let els = try leaves(of: banner())
        assertTouchTarget(try element(els, id: "test.banner.retry"), "retry", width: true)
        assertTouchTarget(try element(els, id: "test.banner.dismiss"), "dismiss", width: true)
    }

    func testBannerTargetsStay44AtAX5AndNarrowWidth() throws {
        let els = try leaves(of: banner(message: "Couldn't remove Chicken thighs. Check your connection and try again."),
                             size: .accessibility5, width: 320)
        let retry = try element(els, id: "test.banner.retry")
        let dismiss = try element(els, id: "test.banner.dismiss")
        assertTouchTarget(retry, "retry@AX5", width: true)
        assertTouchTarget(dismiss, "dismiss@AX5", width: true)
        XCTAssertLessThanOrEqual(retry.accessibilityFrame.maxX, 320.5, "retry stays on screen at AX5")
        XCTAssertLessThanOrEqual(dismiss.accessibilityFrame.maxX, 320.5, "dismiss stays on screen at AX5")
        XCTAssertGreaterThanOrEqual(retry.accessibilityFrame.minX, -0.5)
    }

    func testBannerStacksButtonsUnderMessageAtAccessibilitySizes() throws {
        let els = try leaves(of: banner(message: "Couldn't remove Chicken thighs."), size: .accessibility5)
        let msg = try element(els, label: "Couldn't remove Chicken thighs.")
        let retry = try element(els, id: "test.banner.retry")
        XCTAssertGreaterThanOrEqual(retry.accessibilityFrame.minY, msg.accessibilityFrame.maxY - 1,
                                    "at AX sizes the actions sit below the message")
    }

    func testBannerCustomRetryTitleAndOnlyRetry() throws {
        let els = try leaves(of: banner(dismiss: false, retryTitle: "Undo"))
        XCTAssertNoThrow(try element(els, label: "Undo"))
        XCTAssertFalse(els.contains { identifier($0) == "test.banner.dismiss" })
    }

    func testBannerDefaultIdentifiersDeriveFromContainer() throws {
        let b = BannerView(style: .warning, message: "Heads up", retry: {}, dismiss: {},
                           identifiers: BannerIdentifiers(container: "x.banner"))
        let els = try leaves(of: b)
        XCTAssertNoThrow(try element(els, id: "x.banner.retry"))
        XCTAssertNoThrow(try element(els, id: "x.banner.dismiss"))
    }

    func testBannerActionsFireWhenActivated() throws {
        var retried = 0, dismissed = 0
        let els = try leaves(of: banner(onRetry: { retried += 1 }, onDismiss: { dismissed += 1 }))
        XCTAssertTrue(try element(els, id: "test.banner.retry").accessibilityActivate())
        XCTAssertTrue(try element(els, id: "test.banner.dismiss").accessibilityActivate())
        XCTAssertEqual(retried, 1); XCTAssertEqual(dismissed, 1)
    }

    func testBannerStylesAreDistinctBySymbolNotJustColour() {
        let symbols = [BannerStyle.error, .warning, .info, .success].map(\.systemImage)
        XCTAssertEqual(Set(symbols).count, 4, "colour is never the only cue")
    }

    // MARK: FormField

    private func field(error: String?, id: String = "test.field") -> some View {
        FormField(label: "Email", error: error, identifier: id) {
            TextField("you@example.com", text: .constant(""))
                .frame(minHeight: 44)
        }
    }

    func testFormFieldControlCarriesLabelAndIdentifier() throws {
        let els = try leaves(of: field(error: nil))
        let ctl = try element(els, id: "test.field")
        XCTAssertEqual(ctl.accessibilityLabel, "Email", "the visible label is the control's label")
        XCTAssertTrue((ctl.accessibilityHint ?? "").isEmpty, "no error, no hint: \(ctl.accessibilityHint ?? "nil")")
        XCTAssertFalse(els.contains { identifier($0) == "test.field.error" })
    }

    func testFormFieldLabelIsNotAlsoAStandaloneStop() throws {
        let els = try leaves(of: field(error: nil))
        XCTAssertEqual(els.filter { $0.accessibilityLabel == "Email" }.count, 1, "label spoken once: \(describe(els))")
    }

    func testFormFieldErrorIsSpokenAsHintOnTheControl() throws {
        let els = try leaves(of: field(error: "Enter a valid email."))
        let ctl = try element(els, id: "test.field")
        XCTAssertEqual(ctl.accessibilityHint, "Error: Enter a valid email.")
        XCTAssertEqual(ctl.accessibilityLabel, "Email")
    }

    /// UI tests assert inline errors by identifier. The component names `<id>.error`; it must be
    /// findable, which an `accessibilityHidden` text is not.
    func testFormFieldErrorIdentifierIsQueryable() throws {
        let els = try leaves(of: field(error: "Enter a valid email."))
        let err = els.first { identifier($0) == "test.field.error" }
        XCTAssertNotNil(err, "`test.field.error` is not in the accessibility tree, so XCUITest cannot find it: \(describe(els))")
    }

    func testFormTextFieldMinimumHeightAndIdentifier() throws {
        struct Host: View {
            @State var text = ""
            var body: some View { FormTextField(label: "Password", text: $text, error: nil, identifier: "auth.password", isSecure: true) }
        }
        let els = try leaves(of: Host())
        let ctl = try element(els, id: "auth.password")
        XCTAssertEqual(ctl.accessibilityLabel, "Password")
        assertTouchTarget(ctl, "password field")
    }

    func testFormTextFieldAtAX5StillHas44AndFitsWidth() throws {
        struct Host: View {
            @State var text = ""
            var body: some View { FormTextField(label: "Display name", text: $text, error: "Required.", identifier: "auth.name") }
        }
        let els = try leaves(of: Host(), size: .accessibility5, width: 320)
        let ctl = try element(els, id: "auth.name")
        assertTouchTarget(ctl, "name field @AX5")
        XCTAssertLessThanOrEqual(ctl.accessibilityFrame.maxX, 320.5)
        XCTAssertEqual(ctl.accessibilityHint, "Error: Required.")
    }

    // MARK: PermissionCard

    private func card(_ kind: PermissionKind, alternative: String? = nil, onAlt: @escaping () -> Void = {},
                      onSettings: @escaping () -> Void = {}) -> PermissionCard {
        PermissionCard(kind: kind, alternativeTitle: alternative, alternative: alternative == nil ? nil : onAlt, openSettings: onSettings)
    }

    func testPermissionCardCopyForEveryKind() throws {
        for kind in PermissionKind.allCases {
            let els = try leaves(of: card(kind))
            let title = try element(els, label: kind.title)
            XCTAssertTrue(title.accessibilityTraits.contains(.header), "\(kind) title is a heading")
            XCTAssertTrue(els.contains { $0.accessibilityLabel == kind.message }, "\(kind): message is readable: \(describe(els))")
            XCTAssertFalse(kind.message.isEmpty)
        }
    }

    func testPermissionCardOpenSettingsButton() throws {
        var opened = 0
        let els = try leaves(of: card(.camera, onSettings: { opened += 1 }))
        let b = try element(els, id: AccessibilityID.Permission.openSettings("camera"))
        XCTAssertEqual(b.accessibilityLabel, "Open Settings")
        XCTAssertTrue(isButton(b))
        assertTouchTarget(b, "Open Settings", width: true)
        XCTAssertTrue(b.accessibilityActivate())
        XCTAssertEqual(opened, 1)
    }

    func testPermissionCardAlternativeOnlyWhenProvided() throws {
        var alt = 0
        var els = try leaves(of: card(.microphone))
        XCTAssertFalse(els.contains { identifier($0) == AccessibilityID.Permission.alternative("microphone") })
        els = try leaves(of: card(.microphone, alternative: "Type it instead", onAlt: { alt += 1 }))
        let b = try element(els, id: AccessibilityID.Permission.alternative("microphone"))
        XCTAssertEqual(b.accessibilityLabel, "Type it instead")
        XCTAssertTrue(isButton(b))
        assertTouchTarget(b, "alternative", width: true)
        XCTAssertTrue(b.accessibilityActivate())
        XCTAssertEqual(alt, 1)
    }

    func testPermissionCardAlternativeNeedsBothTitleAndAction() throws {
        let titleOnly = PermissionCard(kind: .speech, alternativeTitle: "Type it", alternative: nil, openSettings: {})
        XCTAssertFalse(try leaves(of: titleOnly).contains { identifier($0) == AccessibilityID.Permission.alternative("speech") })
    }

    func testPermissionCardIdentifiersPerKindAreDistinctAndConventional() {
        XCTAssertEqual(AccessibilityID.Permission.card("camera"), "permission.camera")
        XCTAssertEqual(AccessibilityID.Permission.openSettings("speech"), "permission.speech.settings")
        XCTAssertEqual(AccessibilityID.Permission.alternative("microphone"), "permission.microphone.alternative")
        XCTAssertEqual(Set(PermissionKind.allCases.map(\.rawValue)), ["camera", "microphone", "speech"])
    }

    func testPermissionCardIconIsHiddenFromVoiceOverAndAX5Targets() throws {
        let els = try leaves(of: card(.camera, alternative: "Type it instead"), size: .accessibility5, width: 320)
        XCTAssertFalse(els.contains { ($0.accessibilityLabel ?? "").contains("camera.fill") })
        assertTouchTarget(try element(els, id: AccessibilityID.Permission.openSettings("camera")), "settings@AX5", width: true)
        assertTouchTarget(try element(els, id: AccessibilityID.Permission.alternative("camera")), "alt@AX5", width: true)
    }

    func testPermissionCardCopyMentionsTheWayOut() {
        for kind in PermissionKind.allCases {
            XCTAssertTrue(kind.message.contains("Settings"), "\(kind): says where to turn it on")
            XCTAssertTrue(kind.message.lowercased().contains("typ"), "\(kind): offers the typed alternative, not a dead end")
        }
    }

    // MARK: AudienceChecklist

    private final class Box { var selection = AudienceSelection() }

    private struct ChecklistHost: View {
        let groups: [SharingGroup]
        var friendCount: Int? = 2
        let box: Box
        @State private var selection: AudienceSelection
        init(groups: [SharingGroup], friendCount: Int? = 2, initial: AudienceSelection = AudienceSelection(), box: Box) {
            self.groups = groups; self.friendCount = friendCount; self.box = box
            _selection = State(initialValue: initial)
        }
        var body: some View {
            AudienceChecklist(groups: groups, friendCount: friendCount, selection: $selection)
                .onChange(of: selection) { _, new in box.selection = new }
        }
    }

    private func groups() -> [SharingGroup] {
        [SharingGroup(id: "g1", name: "Moody Hall 4F", role: .member, memberCount: 4, inviteCode: "AAAAAAAA", createdBy: nil, createdAt: nil),
         SharingGroup(id: "g2", name: "Solo House", role: .owner, memberCount: 1, inviteCode: "BBBBBBBB", createdBy: nil, createdAt: nil)]
    }

    func testChecklistRowsAreCombinedButtonsWithTitleAndSubtitle() throws {
        let els = try leaves(of: ChecklistHost(groups: groups(), box: Box()))
        let friends = try element(els, id: AccessibilityID.Audience.friends)
        XCTAssertTrue(friends.accessibilityLabel?.contains("Friends") == true, describe(els))
        XCTAssertTrue(friends.accessibilityLabel?.contains("2 friends") == true, "subtitle is part of the label: \(friends.accessibilityLabel ?? "nil")")
        XCTAssertTrue(isButton(friends))
        let g1 = try element(els, id: AccessibilityID.Audience.group("g1"))
        XCTAssertTrue(g1.accessibilityLabel?.contains("Moody Hall 4F") == true)
        XCTAssertTrue(g1.accessibilityLabel?.contains("4 members") == true)
        let g2 = try element(els, id: AccessibilityID.Audience.group("g2"))
        XCTAssertTrue(g2.accessibilityLabel?.contains("1 member") == true && g2.accessibilityLabel?.contains("1 members") == false,
                      "singular: \(g2.accessibilityLabel ?? "nil")")
    }

    func testChecklistSingularFriend() throws {
        let els = try leaves(of: ChecklistHost(groups: [], friendCount: 1, box: Box()))
        let f = try element(els, id: AccessibilityID.Audience.friends)
        XCTAssertTrue(f.accessibilityLabel?.contains("1 friend") == true && f.accessibilityLabel?.contains("1 friends") == false)
    }

    func testChecklistNoFriendCountOmitsSubtitle() throws {
        let els = try leaves(of: ChecklistHost(groups: [], friendCount: nil, box: Box()))
        XCTAssertEqual(try element(els, id: AccessibilityID.Audience.friends).accessibilityLabel, "Friends")
    }

    func testChecklistValueAndSelectedTraitFollowSelection() throws {
        let box = Box()
        let initial = AudienceSelection(friends: true, groupIds: ["g2"])
        let els = try leaves(of: ChecklistHost(groups: groups(), initial: initial, box: box))
        let friends = try element(els, id: AccessibilityID.Audience.friends)
        let g1 = try element(els, id: AccessibilityID.Audience.group("g1"))
        let g2 = try element(els, id: AccessibilityID.Audience.group("g2"))
        XCTAssertEqual(friends.accessibilityValue, "Selected")
        XCTAssertTrue(friends.accessibilityTraits.contains(.selected))
        XCTAssertEqual(g2.accessibilityValue, "Selected")
        XCTAssertTrue(g2.accessibilityTraits.contains(.selected))
        XCTAssertEqual(g1.accessibilityValue, "Not selected", "state is spoken, not only drawn")
        XCTAssertFalse(g1.accessibilityTraits.contains(.selected))
    }

    func testChecklistRowsAre44TallAndFullWidth() throws {
        let els = try leaves(of: ChecklistHost(groups: groups(), box: Box()))
        for id in [AccessibilityID.Audience.friends, AccessibilityID.Audience.group("g1"), AccessibilityID.Audience.group("g2")] {
            let r = try element(els, id: id)
            assertTouchTarget(r, id, width: true)
        }
    }

    func testChecklistRowsStay44AndOnScreenAtAX5() throws {
        let els = try leaves(of: ChecklistHost(groups: groups(), box: Box()), size: .accessibility5, width: 320)
        for id in [AccessibilityID.Audience.friends, AccessibilityID.Audience.group("g1")] {
            let r = try element(els, id: id)
            assertTouchTarget(r, "\(id)@AX5", width: true)
            XCTAssertLessThanOrEqual(r.accessibilityFrame.maxX, 320.5, "\(id) fits the screen")
            XCTAssertGreaterThanOrEqual(r.accessibilityFrame.minX, -0.5)
        }
    }

    func testChecklistActivationTogglesSelection() throws {
        let box = Box()
        let els = try leaves(of: ChecklistHost(groups: groups(), box: box))
        let friends = try element(els, id: AccessibilityID.Audience.friends)
        XCTAssertTrue(friends.accessibilityActivate())
        RunLoop.main.run(until: Date().addingTimeInterval(0.2))
        XCTAssertTrue(box.selection.friends, "activate selects")
        XCTAssertTrue(try element(els, id: AccessibilityID.Audience.group("g1")).accessibilityActivate())
        RunLoop.main.run(until: Date().addingTimeInterval(0.2))
        XCTAssertEqual(box.selection.groupIds, ["g1"])
        XCTAssertTrue(try element(els, id: AccessibilityID.Audience.group("g1")).accessibilityActivate())
        RunLoop.main.run(until: Date().addingTimeInterval(0.2))
        XCTAssertEqual(box.selection.groupIds, [], "activate again deselects")
    }

    func testChecklistHintShownOnlyWhileNothingSelected() throws {
        var els = try leaves(of: ChecklistHost(groups: groups(), box: Box()))
        let hint = try element(els, id: AccessibilityID.Audience.hint)
        XCTAssertEqual(hint.accessibilityLabel, "Choose at least one.")
        els = try leaves(of: ChecklistHost(groups: groups(), initial: AudienceSelection(friends: true), box: Box()))
        XCTAssertFalse(els.contains { identifier($0) == AccessibilityID.Audience.hint })
    }

    func testChecklistWithNoGroupsStillOffersFriends() throws {
        let els = try leaves(of: ChecklistHost(groups: [], box: Box()))
        XCTAssertNoThrow(try element(els, id: AccessibilityID.Audience.friends))
        XCTAssertEqual(els.filter { (identifier($0) ?? "").hasPrefix("audience.group.") }.count, 0)
    }

    func testAudienceSelectionModel() {
        var s = AudienceSelection()
        XCTAssertTrue(s.isEmpty)
        s.friends = true
        XCTAssertFalse(s.isEmpty)
        s = AudienceSelection(friends: false, groupIds: ["g2", "g1"])
        XCTAssertFalse(s.isEmpty)
        XCTAssertEqual(s.orderedGroupIds(in: groups()), ["g1", "g2"], "stable order that follows the groups list, not Set order")
        XCTAssertEqual(AudienceSelection(groupIds: ["gone"]).orderedGroupIds(in: groups()), [], "ids not in the list are dropped")
    }

    func testChecklistIdentifiersAreStable() {
        XCTAssertEqual(AccessibilityID.Audience.list, "audience.list")
        XCTAssertEqual(AccessibilityID.Audience.friends, "audience.friends")
        XCTAssertEqual(AccessibilityID.Audience.group("abc"), "audience.group.abc")
        XCTAssertEqual(AccessibilityID.Audience.hint, "audience.hint")
    }

    // MARK: WeightText follows the Units preference

    func testWeightTextSpeaksUnitsAndFollowsPreference() throws {
        let d = UserDefaults.standard
        let previous = d.object(forKey: UnitSystem.storageKey)
        defer { if let previous { d.set(previous, forKey: UnitSystem.storageKey) } else { d.removeObject(forKey: UnitSystem.storageKey) } }

        d.set("us", forKey: UnitSystem.storageKey)
        var els = try leaves(of: WeightText(kg: 0.64))
        XCTAssertEqual(els.first?.accessibilityLabel, "1.4 pounds")

        d.set("metric", forKey: UnitSystem.storageKey)
        els = try leaves(of: WeightText(kg: 0.64))
        XCTAssertEqual(els.first?.accessibilityLabel, "640 grams", "switching the preference changes the next render")
    }
}
