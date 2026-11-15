import XCTest

/// Fridge polish (round 3 / canvas v53): Shared it + Given to, Select → batch remove → BatchUndo,
/// no search button, RemoveReason, empty state action, Reduce Motion, AX5 select bar.
enum PID {
    static let select = "fridge.select", done = "fridge.select.done", count = "fridge.select.count"
    static let bar = "fridge.select.bar", used = "fridge.select.used", shared = "fridge.select.shared"
    static func pick(_ id: String) -> String { "fridge.row.\(id).select" }
    static let given = "remove.given", givenMenu = "remove.given.menu", removeDone = "remove.done"
    static let listing = "remove.listing", badge = "remove.badge", emptyAdd = "fridge.empty.add"
    static let reasonList = "removereason.list", reasonTitle = "removereason.title"
}

final class FridgePolishUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private let ax5 = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]

    private func launch(_ extra: [String] = []) -> XCUIApplication {
        XCUIApplication.fridge(extra + RemoveArgs.undoWindow)
    }
    /// XCUITest reports frames inside a presented sheet about 4% small (a 68 pt tile reads 65.3 on the
    /// 17 Pro). Exact sizes are asserted on the hosted view in `FridgePolishAccessibilityTests`; here
    /// a sheet frame must reach `pts` less that 5% slack.
    private func sheetMin(_ pts: CGFloat) -> CGFloat { pts * 0.95 }
    private func text(_ el: XCUIElement) -> String { (el.value as? String).flatMap { $0.isEmpty ? nil : $0 } ?? el.label }

    /// The header (Select, Done, count) scrolls with the list: bring it back into view (AX5 rows are tall).
    @discardableResult
    private func header(_ app: XCUIApplication, _ el: XCUIElement) -> XCUIElement {
        for _ in 0..<8 where !el.exists || !el.isHittable { app.any(FID.list).swipeDown(velocity: .fast) }
        return el
    }
    private func count(_ app: XCUIApplication) -> String { header(app, app.any(PID.count)).label }

    private func enterSelect(_ app: XCUIApplication) {
        let b = app.buttons[PID.select]
        XCTAssertTrue(b.waitForExistence(timeout: 5), "Select button missing")
        b.tap()
        XCTAssertTrue(app.buttons[PID.done].waitForExistence(timeout: 3), "Done missing in select mode")
    }
    private func pick(_ app: XCUIApplication, _ ids: [String]) {
        for id in ids {
            let r = app.buttons[PID.pick(id)]
            XCTAssertTrue(app.reveal(r), "select row \(id) missing")
            r.tap()
        }
    }

    // MARK: Search button is gone (Fridge, FridgeEmpty, FridgeSelect, BatchUndo)

    func testNoSearchButtonAnywhere() {
        let app = launch()
        XCTAssertTrue(app.fridgeRow("item-chicken").waitForExistence(timeout: 5))
        func noSearch(_ where_: String) {
            XCTAssertEqual(app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'search'")).count, 0, "\(where_): search button present")
            XCTAssertFalse(app.any("fridge.search").exists, where_)
            XCTAssertFalse(app.searchFields.firstMatch.exists, where_)
        }
        noSearch("Fridge")
        XCTAssertTrue(app.buttons[PID.select].exists, "Select stays")
        enterSelect(app)
        noSearch("FridgeSelect")
        pick(app, ["item-chicken"])
        app.buttons[PID.used].tap()
        XCTAssertTrue(app.toast.waitForExistence(timeout: 10))
        noSearch("BatchUndo")
        let e = XCUIApplication.fridge(["-UITestSeed", "empty"])
        XCTAssertTrue(e.any(FID.empty).waitForExistence(timeout: 5))
        XCTAssertEqual(e.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'search'")).count, 0, "FridgeEmpty")
    }

    // MARK: Empty state

    func testEmptyStateHasAddFoodAndNoSelect() {
        let app = XCUIApplication.fridge(["-UITestSeed", "empty"])
        XCTAssertTrue(app.any(FID.empty).waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons[PID.select].exists, "nothing to select in an empty fridge")
        let add = app.buttons[PID.emptyAdd]
        XCTAssertTrue(add.waitForExistence(timeout: 3), "Add food button missing")
        XCTAssertEqual(add.label, "Add food")
        XCTAssertGreaterThanOrEqual(add.frame.height, 44)
        add.tap()
        XCTAssertTrue(app.addSheet.waitForExistence(timeout: 5), "Add food should open the Add sheet")
    }

    // MARK: Select → FridgeSelect

    func testSelectModeChromeAndCounts() {
        let app = launch()
        enterSelect(app)
        XCTAssertEqual(count(app), "0 selected")
        XCTAssertFalse(app.buttons[PID.select].exists)
        XCTAssertTrue(app.any(PID.bar).waitForExistence(timeout: 3), "bottom bar missing")
        XCTAssertFalse(app.tabBars.firstMatch.isHittable, "the bar replaces the tab bar")
        XCTAssertFalse(app.buttons[PID.used].isEnabled, "no selection → Used them disabled")
        XCTAssertFalse(app.buttons[PID.shared].isEnabled)
        pick(app, ["item-chicken"])
        XCTAssertEqual(count(app), "1 selected")
        XCTAssertTrue(app.buttons[PID.used].isEnabled)
        pick(app, ["item-eggs", "item-spinach"])
        XCTAssertEqual(count(app), "3 selected")
        // The lazy list drops far rows at AX5, so the per-row state is read only while the row is reachable.
        if app.reveal(app.buttons[PID.pick("item-eggs")]) {
            XCTAssertEqual(app.buttons[PID.pick("item-eggs")].value as? String, "Selected", "state is spoken, not only coloured")
            app.buttons[PID.pick("item-eggs")].tap()
            XCTAssertEqual(count(app), "2 selected")
            if app.reveal(app.buttons[PID.pick("item-eggs")]) {
                XCTAssertEqual(app.buttons[PID.pick("item-eggs")].value as? String, "Not selected")
            }
        } else {
            app.buttons[PID.pick("item-spinach")].tap()
            XCTAssertEqual(count(app), "2 selected")
        }
        XCTAssertEqual(app.buttons[PID.used].label, "Used them")
        XCTAssertEqual(app.buttons[PID.shared].label, "Shared them")
        for b in [PID.used, PID.shared] { XCTAssertGreaterThanOrEqual(app.buttons[b].frame.height, 44) }
        attachScreenshot(app, name: "fridge-select")
        app.buttons[PID.done].tap()
        XCTAssertTrue(app.buttons[PID.select].waitForExistence(timeout: 3))
        XCTAssertTrue(app.any(PID.bar).waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.fridgeRow("item-chicken").exists, "Done removes nothing")
        // A fresh Select starts empty.
        enterSelect(app)
        XCTAssertEqual(count(app), "0 selected")
    }

    /// Switching storage while selecting must not leave a hidden selection that "Used them" would act on.
    func testSwitchingStorageDoesNotKeepAHiddenSelection() {
        let app = launch()
        enterSelect(app)
        pick(app, ["item-chicken"])
        XCTAssertEqual(count(app), "1 selected")
        app.any(FID.storage("pantry")).tap()
        XCTAssertTrue(app.any(FID.empty).waitForExistence(timeout: 10))
        let hiddenCount = app.any(PID.count).exists || app.any(FID.list).exists ? count(app) : "none"
        let usedEnabled = app.buttons[PID.used].exists && app.buttons[PID.used].isEnabled
        XCTAssertTrue(hiddenCount == "0 selected" || hiddenCount == "none" || !usedEnabled,
                      "IOS-19: '\(hiddenCount)' with Used them enabled while the selected row is on another storage tab")
    }

    func testSelectDoesNotOpenSwipeRemoveOrSheet() {
        let app = launch()
        enterSelect(app)
        pick(app, ["item-chicken"])
        XCTAssertFalse(app.any(FID.sheet).exists, "tapping a select row must not open the sheet")
        XCTAssertFalse(app.buttons[FID.rowRemove("item-chicken")].exists)
    }

    // MARK: remove-batch → BatchUndo → restore-batch

    func testUsedThemThenUndoRestoresAllRows() {
        let app = launch([RemoveArgs.recordHaptics])
        enterSelect(app)
        pick(app, ["item-chicken", "item-eggs", "item-spinach"])
        app.buttons[PID.used].tap()
        for id in ["item-chicken", "item-eggs", "item-spinach"] {
            XCTAssertTrue(app.fridgeRow(id).waitForNonExistence(timeout: 10), "\(id) did not leave")
        }
        XCTAssertTrue(app.toast.waitForExistence(timeout: 10), "BatchUndo toast missing")
        XCTAssertEqual(app.any(ID.toastMessage).label, "3 items marked used")
        XCTAssertTrue(header(app, app.buttons[PID.select]).waitForExistence(timeout: 3), "leaves select mode")
        XCTAssertFalse(app.any(PID.bar).exists)
        attachScreenshot(app, name: "batch-undo")
        app.buttons[ID.toastButton].tap()
        for id in ["item-chicken", "item-eggs", "item-spinach"] {
            XCTAssertTrue(app.reveal(app.fridgeRow(id), timeout: 10), "Undo did not restore \(id)")
        }
        XCTAssertFalse(app.any(RemoveArgs.removeError).waitForExistence(timeout: 2))
        // Refresh keeps them (restore-batch reached the mock server).
        app.any(FID.list).swipeDown(velocity: .slow)
        XCTAssertTrue(app.reveal(app.fridgeRow("item-chicken"), timeout: 10))
        XCTAssertFalse(haptics(app).contains("error"))
    }

    func testSharedThemClaimedAndUnclaimedThenUndo() {
        let app = launch(RemoveArgs.listingSeed)
        enterSelect(app)
        pick(app, ["item-spinach", "item-carrots"])
        app.buttons[PID.shared].tap()
        XCTAssertTrue(app.fridgeRow("item-spinach").waitForNonExistence(timeout: 10))
        XCTAssertTrue(app.toast.waitForExistence(timeout: 10))
        XCTAssertEqual(app.any(ID.toastMessage).label, "2 items shared")
        app.buttons[ID.toastButton].tap()
        XCTAssertTrue(app.reveal(app.fridgeRow("item-spinach"), timeout: 10))
        XCTAssertTrue(app.reveal(app.fridgeRow("item-carrots"), timeout: 10))
    }

    func testBatchFailureRollsBackWithBanner() {
        let app = launch(["-UITestFailBatch"])
        enterSelect(app)
        pick(app, ["item-chicken", "item-eggs"])
        app.buttons[PID.used].tap()
        XCTAssertTrue(app.any(RemoveArgs.removeError).waitForExistence(timeout: 10), "no rollback banner")
        XCTAssertTrue(app.reveal(app.fridgeRow("item-chicken"), timeout: 10))
        XCTAssertTrue(app.reveal(app.fridgeRow("item-eggs"), timeout: 10))
        XCTAssertFalse(app.toast.exists, "no toast for a failed batch")
    }

    // MARK: Remove sheet: Shared it + Given to

    func testSheetOutcomeGroupLabelledAndNoVisibleHeading() {
        let app = launch()
        openRemove(app, item: "item-eggs")
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label == 'What happened to it?'")).count, 0,
                       "round 3: no visible heading")
        let group = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'What happened to it?'")).firstMatch
        XCTAssertTrue(group.exists, "the VoiceOver group label must remain")
        XCTAssertEqual(app.any(FID.outcome("used")).label, "Used it")
        XCTAssertEqual(app.any(FID.outcome("donated")).label, "Shared it")
        XCTAssertEqual(app.any(FID.outcome("thrown_out")).label, "Threw it away")
        for o in ["used", "donated", "thrown_out"] {
            XCTAssertGreaterThanOrEqual(app.any(FID.outcome(o)).frame.height, sheetMin(68), "\(o) tile is 68 pt")
        }
        // No captions.
        for s in ["Counts as food saved", "Closes your Share listing", "Counts as waste"] {
            XCTAssertFalse(app.staticTexts[s].exists, "caption '\(s)' should be gone")
        }
        XCTAssertFalse(app.any(PID.given).exists, "Given to is hidden until Shared it")
        attachScreenshot(app, name: "remove-sheet-light-or-dark")
    }

    func testListingBadgeAndExpiryBadgeInSheetHeader() {
        let app = launch(RemoveArgs.listingSeed)
        openRemove(app, item: "item-spinach")
        XCTAssertTrue(app.any(PID.listing).exists, "shared badge on the icon when listed")
        XCTAssertEqual(app.any(PID.listing).label, "Shared with friends")
        XCTAssertEqual(app.any(PID.badge).label, "Expires tomorrow")
        app.buttons[FID.cancel].tap()
        XCTAssertTrue(app.any(FID.sheet).waitForNonExistence(timeout: 10))
        openRemove(app, item: "item-eggs")
        XCTAssertFalse(app.any(PID.listing).exists, "no badge without a listing")
    }

    /// Claimer first, then the others in order, then "Someone not on BiteDown"; one menu.
    func testGivenToMenuOrderAndSelection() {
        let app = launch(RemoveArgs.listingSeed)
        openRemove(app, item: "item-spinach")
        app.any(FID.outcome("donated")).tap()
        XCTAssertTrue(app.any(PID.given).waitForExistence(timeout: 3))
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: PID.givenMenu).count, 1, "exactly one Given-to menu")
        let menu = app.buttons[PID.givenMenu].exists ? app.buttons[PID.givenMenu] : app.any(PID.givenMenu)
        XCTAssertGreaterThanOrEqual(menu.frame.height, sheetMin(44))
        XCTAssertEqual(menu.value as? String, "Marcus Ojeda")
        menu.tap()
        let expected = ["Marcus Ojeda", "Ana Reyes", "Devon Park", "Jordan Kim", "Someone not on BiteDown"]
        _ = app.buttons["Marcus Ojeda"].firstMatch.waitForExistence(timeout: 3)
        let found = expected.compactMap { name -> (String, CGFloat)? in
            let m = app.buttons[name].firstMatch
            return m.exists ? (name, m.frame.minY) : nil
        }
        // At AX5 on the SE the system menu is taller than the screen: only a prefix is on screen. The
        // entries that are shown must still be in order (see IOS-21 for the clipped last entry).
        let clipped = found.count < expected.count
        XCTAssertEqual(found.map(\.0), Array(expected.prefix(found.count)), "menu entries out of order: \(found)")
        XCTAssertGreaterThanOrEqual(found.count, clipped ? 2 : 5, "too few entries on screen: \(found)")
        attachScreenshot(app, name: "remove-sheet-given-open")
        // Menus can open upward (reverse order), so accept ascending or descending, never mixed.
        let ys = found.map(\.1)
        XCTAssertTrue(ys == ys.sorted() || ys == ys.sorted(by: >), "menu order not monotonic: \(found)")
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label CONTAINS 'claimed it'")).firstMatch.exists, "(claimed it) suffix is gone")
        if !clipped {
            if ys == ys.sorted() { XCTAssertEqual(found.first?.0, "Marcus Ojeda") }
            else { XCTAssertEqual(found.last?.0, "Someone not on BiteDown") }
        }
        app.buttons["Ana Reyes"].firstMatch.tap()
        XCTAssertEqual(menu.value as? String, "Ana Reyes")
        // Done removes it; the sheet closes.
        app.buttons[PID.removeDone].tap()
        XCTAssertTrue(app.fridgeRow("item-spinach").waitForNonExistence(timeout: 10))
        XCTAssertTrue(app.toast.waitForExistence(timeout: 10))
    }

    func testGivenToSomeoneNotOnBiteDown() throws {
        let app = launch(RemoveArgs.listingSeed)
        openRemove(app, item: "item-spinach")
        app.any(FID.outcome("donated")).tap()
        let menu = app.buttons[PID.givenMenu].exists ? app.buttons[PID.givenMenu] : app.any(PID.givenMenu)
        XCTAssertTrue(menu.waitForExistence(timeout: 3))
        menu.tap()
        let nobody = app.buttons["Someone not on BiteDown"].firstMatch
        guard nobody.waitForExistence(timeout: 3) else {
            // AX5 on the SE: the system menu is taller than the screen (IOS-21), so the entry is off screen.
            throw XCTSkip("Someone not on BiteDown is clipped off the menu at this text size")
        }
        nobody.tap()
        XCTAssertEqual(menu.value as? String, "Someone not on BiteDown")
        app.buttons[PID.removeDone].tap()
        XCTAssertTrue(app.fridgeRow("item-spinach").waitForNonExistence(timeout: 10))
    }

    func testSharedItCanBeCancelledAndUsedItStillActsInOneTap() {
        let app = launch()
        openRemove(app, item: "item-eggs")
        app.any(FID.outcome("donated")).tap()
        XCTAssertTrue(app.any(PID.given).waitForExistence(timeout: 3))
        app.buttons[FID.cancel].tap()
        XCTAssertTrue(app.any(FID.sheet).waitForNonExistence(timeout: 10))
        XCTAssertTrue(app.reveal(app.fridgeRow("item-eggs"), timeout: 5), "Cancel after Shared it removes nothing")
        XCTAssertFalse(app.toast.exists)
        openRemove(app, item: "item-eggs")
        app.any(FID.outcome("used")).tap()   // no Done needed
        XCTAssertTrue(app.fridgeRow("item-eggs").waitForNonExistence(timeout: 10))
    }

    func testDoneTwiceDoesNotRemoveTwice() {
        let app = launch()
        openRemove(app, item: "item-eggs")
        app.any(FID.outcome("donated")).tap()
        let done = app.buttons[PID.removeDone]
        XCTAssertTrue(done.waitForExistence(timeout: 3))
        done.tap()
        if done.exists && done.isHittable { done.tap() }
        XCTAssertTrue(app.fridgeRow("item-eggs").waitForNonExistence(timeout: 10))
        XCTAssertFalse(app.any(RemoveArgs.removeError).waitForExistence(timeout: 2), "a double Done must not raise already_removed")
    }

    // MARK: RemoveReason

    func testRemoveReasonScreen() {
        let app = launch([RemoveArgs.recordHaptics])
        openRemove(app, item: "item-strawberries")
        app.any(FID.outcome("thrown_out")).tap()
        XCTAssertTrue(app.any(PID.reasonTitle).waitForExistence(timeout: 10))
        XCTAssertEqual(app.any(PID.reasonTitle).label, "Why was it thrown out?")
        XCTAssertTrue(app.staticTexts["Strawberries"].exists || app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'trawberries'")).count > 0, "item name under the title")
        XCTAssertTrue(app.any(PID.reasonList).exists, "grouped list")
        let order = ["expired", "forgot", "didnt_like", "other"]
        let labels = ["Expired", "Forgot about it", "Didn't like it", "Other"]
        var ys: [CGFloat] = []
        for (r, l) in zip(order, labels) {
            let t = app.any(FID.reason(r))
            XCTAssertTrue(t.exists, r)
            XCTAssertEqual(t.label, l)
            XCTAssertGreaterThanOrEqual(t.frame.height, sheetMin(68), "\(r) row is 68 pt (v53)")
            ys.append(t.frame.minY)
        }
        XCTAssertEqual(ys, ys.sorted())
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'quick question'")).firstMatch.exists)
        attachScreenshot(app, name: "remove-reason")
        // Native back returns to the outcome step.
        let back = app.navigationBars.buttons.firstMatch
        XCTAssertTrue(back.exists, "native back button")
        back.tap()
        XCTAssertTrue(app.any(FID.outcome("used")).waitForExistence(timeout: 5), "back to the outcome tiles")
        XCTAssertTrue(app.fridgeRow("item-strawberries").exists, "nothing removed by going back")
        app.any(FID.outcome("thrown_out")).tap()
        app.any(FID.reason("forgot")).tap()
        XCTAssertTrue(app.fridgeRow("item-strawberries").waitForNonExistence(timeout: 10))
        XCTAssertTrue(app.toast.waitForExistence(timeout: 10))
    }

    // MARK: Row polish

    func testRowsShowOneStatusAndQuantityOnlyMeta() {
        let app = launch()
        XCTAssertTrue(app.fridgeRow("item-chicken").waitForExistence(timeout: 5))
        XCTAssertTrue(app.reveal(app.any(FID.badge("item-strawberries"))))
        XCTAssertEqual(app.any(FID.badge("item-strawberries")).label, "Looks off, may be spoiled")
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'photo check'")).count, 0)
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label == 'Check'")).count, 0)
        XCTAssertTrue(app.reveal(app.any(FID.badge("item-yogurt"))))
        // Estimated ranges, never a bare "N days" for an estimate.
        let b = app.any(FID.badge("item-yogurt"))
        XCTAssertTrue(b.label.hasPrefix("Expires in about"), b.label)
    }

    func testSwipeActionIsStillRemove() {
        let app = launch()
        openRemove(app, item: "item-chicken")
        XCTAssertTrue(app.any(FID.sheet).exists)
    }

    // MARK: Reduce Motion

    func testSelectAndBatchWorkUnderReduceMotion() {
        let app = launch([RemoveArgs.reduceMotion])
        enterSelect(app)
        pick(app, ["item-chicken", "item-eggs"])
        let barY = app.any(PID.bar).frame.minY
        app.buttons[PID.used].tap()
        XCTAssertTrue(app.toast.waitForExistence(timeout: 10))
        let a = app.toast.frame
        Thread.sleep(forTimeInterval: 0.6)
        XCTAssertEqual(a.minY, app.toast.frame.minY, accuracy: 0.5, "toast moved under Reduce Motion")
        XCTAssertGreaterThan(barY, 0)
        app.buttons[ID.toastButton].tap()
        XCTAssertTrue(app.reveal(app.fridgeRow("item-chicken"), timeout: 10))
    }

    func testReduceMotionSharedItGivenToAppearsInPlace() {
        let app = launch([RemoveArgs.reduceMotion] + RemoveArgs.listingSeed)
        openRemove(app, item: "item-spinach")
        app.any(FID.outcome("donated")).tap()
        XCTAssertTrue(app.any(PID.given).waitForExistence(timeout: 3))
        Thread.sleep(forTimeInterval: 0.6)   // the sheet re-fits its detent; the row itself must not slide
        let frame1 = app.any(PID.given).frame
        Thread.sleep(forTimeInterval: 0.4)
        XCTAssertEqual(frame1.minY, app.any(PID.given).frame.minY, accuracy: 0.5, "Given to row slid")
    }

    // MARK: AX5

    func testAX5SelectBarButtonsStackAndFitOnScreen() {
        let app = launch(ax5)
        enterSelect(app)
        pick(app, ["item-chicken"])
        let used = app.buttons[PID.used], shared = app.buttons[PID.shared]
        XCTAssertTrue(used.waitForExistence(timeout: 3) && shared.exists)
        attachScreenshot(app, name: "fridge-select-ax5")
        XCTAssertGreaterThanOrEqual(shared.frame.minY, used.frame.maxY - 1, "AX5: bar buttons stack vertically: \(used.frame) \(shared.frame)")
        XCTAssertEqual(used.frame.minX, shared.frame.minX, accuracy: 2, "stacked buttons share a column")
        for b in [used, shared] {
            XCTAssertGreaterThanOrEqual(b.frame.height, 44)
            XCTAssertLessThanOrEqual(b.frame.maxX, app.frame.maxX + 0.5)
            XCTAssertGreaterThanOrEqual(b.frame.minX, -0.5)
            XCTAssertTrue(b.isHittable, "\(b.label) not hittable at AX5")
        }
        XCTAssertLessThanOrEqual(shared.frame.maxY, app.frame.maxY)
        // Header: Select/Done and count stay on screen.
        XCTAssertTrue(app.buttons[PID.done].exists)
        app.buttons[PID.used].tap()
        XCTAssertTrue(app.toast.waitForExistence(timeout: 10))
    }

    func testAX5BadgesDoNotWrapAndSheetFits() {
        let app = launch(ax5 + RemoveArgs.listingSeed)
        let sb = app.any(FID.badge("item-strawberries"))
        XCTAssertTrue(app.reveal(sb))
        XCTAssertLessThanOrEqual(sb.frame.maxX, app.frame.maxX + 0.5, "badge clipped \(sb.frame)")
        // One line: height stays well under two lines of AX5 text (>= 2x44).
        XCTAssertLessThan(sb.frame.height, 90, "badge looks wrapped: \(sb.frame)")
        openRemove(app, item: "item-spinach")
        let badge = app.any(PID.badge)
        XCTAssertTrue(badge.exists)
        XCTAssertLessThanOrEqual(badge.frame.maxX, app.frame.maxX + 0.5)
        XCTAssertLessThan(badge.frame.height, 90)
        app.any(FID.outcome("donated")).tap()
        XCTAssertTrue(app.any(PID.given).waitForExistence(timeout: 3))
        attachScreenshot(app, name: "remove-sheet-given-ax5")
        let menu = app.buttons[PID.givenMenu].exists ? app.buttons[PID.givenMenu] : app.any(PID.givenMenu)
        XCTAssertGreaterThanOrEqual(menu.frame.height, sheetMin(44))
        XCTAssertLessThanOrEqual(menu.frame.maxX, app.frame.maxX + 0.5, "Given-to value clipped at AX5: \(menu.frame)")
        XCTAssertTrue(app.buttons[PID.removeDone].exists)
        XCTAssertGreaterThanOrEqual(app.buttons[PID.removeDone].frame.height, sheetMin(44))
    }

    private func haptics(_ app: XCUIApplication) -> [String] {
        let probe = app.any(RemoveArgs.hapticsProbe)
        guard probe.exists else { return [] }
        let v = (probe.value as? String) ?? probe.label
        return v.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty && $0 != "none" }
    }
}
