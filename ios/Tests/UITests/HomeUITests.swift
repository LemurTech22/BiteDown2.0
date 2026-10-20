import XCTest

/// Home identifiers. They mirror `AccessibilityID.Home` and `.State` in the app.
enum HID {
    static let screen = "home", date = "home.date", greeting = "home.greeting", settings = "home.settings"
    static let pill = "home.impact", tip = "home.tip", tipDismiss = "home.tip.dismiss"
    static let useFirst = "home.usefirst", seeAll = "home.seeall", addFood = "home.addfood"
    static func row(_ id: String) -> String { "home.row.\(id)" }
    static let cookCard = "home.cook.card", cookEmpty = "home.cook.empty"
    static let banner = "home.banner", bannerRetry = "home.banner.retry"
    static let server = "home.server", serverChange = "home.server.change"
    static let empty = "home.empty", error = "home.error", retry = "home.error.retry", loading = "home.loading"
    /// Impact, opened by the pill (`AccessibilityID.Impact`).
    static let impact = "impact", impactBack = "impact.back", impactHeroValue = "impact.hero.value"
    /// `@AppStorage` key of the dismissed tip message.
    static let dismissedKey = "home.dismissedTip"
    static let ax5 = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
}

extension XCUIApplication {
    /// Any element type with this identifier (SwiftUI picks the type; do not assume).
    func home(_ id: String) -> XCUIElement { descendants(matching: .any)[id].firstMatch }

    /// Launch on the mock, signed in. The tip is shown regardless of earlier dismissals unless the
    /// test is about persistence: `-home.dismissedTip ""` overrides the stored value for this launch.
    static func home(_ extra: [String] = [], showTip: Bool = true) -> XCUIApplication {
        XCUIApplication.mockSignedIn((showTip ? ["-\(HID.dismissedKey)", ""] : []) + extra)
    }

    /// Wait for the Home screen's first state to settle (greeting is on screen in every state).
    @discardableResult func waitForHome(timeout: TimeInterval = 10) -> Bool {
        home(HID.greeting).waitForExistence(timeout: timeout)
    }

    /// Swipe the Home scroll view until `element` is hittable (SE, AX5).
    @discardableResult
    func scrollHome(to element: XCUIElement, maxSwipes: Int = 8) -> Bool {
        let scroll = scrollViews.firstMatch
        var n = 0
        while !(element.exists && element.isHittable) && n < maxSwipes {
            scroll.swipeUp(velocity: .slow); n += 1
        }
        return element.exists && element.isHittable
    }
}

final class HomeUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    // MARK: Content

    func testHomeShowsGreetingGearPillAndSections() throws {
        let app = XCUIApplication.home()
        XCTAssertTrue(app.waitForHome())
        XCTAssertEqual(app.home(HID.greeting).label, "Hi, Priya")
        XCTAssertTrue(app.home(HID.date).exists)
        XCTAssertTrue(app.home(HID.settings).exists)
        XCTAssertTrue(app.home(HID.pill).waitForExistence(timeout: 5))
        XCTAssertTrue(app.home(HID.useFirst).waitForExistence(timeout: 5))
        XCTAssertTrue(app.home(HID.cookCard).waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Use these first"].exists)
        XCTAssertTrue(app.staticTexts["Cook tonight"].exists)
        XCTAssertTrue(app.home(HID.seeAll).exists)
        attachScreenshot(app, name: "Home")
    }

    func testUseFirstListsTheThreeSoonestExpiringItems() {
        let app = XCUIApplication.home()
        XCTAssertTrue(app.home(HID.row("item-chicken")).waitForExistence(timeout: 10))
        XCTAssertTrue(app.home(HID.row("item-spinach")).exists)
        XCTAssertTrue(app.home(HID.row("item-strawberries")).exists)
        XCTAssertFalse(app.home(HID.row("item-bananas")).exists, "only three rows")
        XCTAssertFalse(app.home(HID.row("item-eggs")).exists)
        let ys = ["item-chicken", "item-spinach", "item-strawberries"].map { app.home(HID.row($0)).frame.minY }
        XCTAssertEqual(ys, ys.sorted(), "soonest first, top to bottom")
        let chicken = app.home(HID.row("item-chicken")).label
        XCTAssertTrue(chicken.contains("Chicken thighs") && chicken.lowercased().contains("today"), chicken)
    }

    func testRowsAreAtLeast44ptTall() {
        let app = XCUIApplication.home()
        XCTAssertTrue(app.home(HID.row("item-chicken")).waitForExistence(timeout: 10))
        for id in ["item-chicken", "item-spinach", "item-strawberries"] {
            XCTAssertGreaterThanOrEqual(app.home(HID.row(id)).frame.height, 43.5, id)
        }
    }

    func testImpactPillShowsTheMonthInPoundsAndIsATappableButton() {
        let app = XCUIApplication.home()
        let pill = app.home(HID.pill)
        XCTAssertTrue(pill.waitForExistence(timeout: 10))
        // Mock month in lb via WeightFormatter (Units default is US), spoken as words.
        XCTAssertNotNil(pill.label.range(of: #"^\d+(\.\d)? pounds saved"#, options: .regularExpression), pill.label)
        XCTAssertTrue(pill.label.contains("30 days"), pill.label)
        XCTAssertTrue(pill.isHittable)
        XCTAssertGreaterThanOrEqual(pill.frame.height, 43.5)
        // The pill opens Impact full screen (a cover over the tabs) and Back returns to Home.
        pill.tap()
        XCTAssertTrue(app.home(HID.impact).waitForExistence(timeout: 15), "the pill did not open Impact")
        XCTAssertTrue(app.home(HID.impactHeroValue).waitForExistence(timeout: 15), "Impact opened without its hero value")
        let back = app.buttons[HID.impactBack]
        XCTAssertTrue(back.waitForExistence(timeout: 10), "Impact has no Back button")
        back.tap()
        XCTAssertTrue(app.home(HID.impact).waitForNonExistence(timeout: 10), "Impact stayed open after Back")
        XCTAssertTrue(app.home(HID.pill).waitForExistence(timeout: 10), "Home did not come back")
    }

    func testCookTonightCardShowsTheRecipeAndWhatItUses() {
        let app = XCUIApplication.home()
        let card = app.home(HID.cookCard)
        XCTAssertTrue(card.waitForExistence(timeout: 10))
        XCTAssertTrue(card.label.contains("Chicken and spinach skillet"), card.label)
        XCTAssertTrue(card.label.contains("Uses 2 items expiring this week"), card.label)
        XCTAssertTrue(card.label.contains("25 min"), card.label)
        XCTAssertTrue(card.label.contains("2 servings"), card.label)
    }

    func testSeeAllGoesToTheFridgeTab() {
        let app = XCUIApplication.home()
        let seeAll = app.home(HID.seeAll)
        XCTAssertTrue(seeAll.waitForExistence(timeout: 10))
        XCTAssertGreaterThanOrEqual(seeAll.frame.height, 43.5)
        seeAll.tap()
        XCTAssertTrue(app.home("fridge.title").waitForExistence(timeout: 5) || app.home("fridge.list").waitForExistence(timeout: 5))
    }

    func testTappingARowDoesNotLeaveHome() {
        let app = XCUIApplication.home()
        let row = app.home(HID.row("item-chicken"))
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()   // Item detail is a later PR
        XCTAssertTrue(app.home(HID.greeting).exists)
    }

    // MARK: Header

    func testSettingsGearIsLabelledSettingsAndNoProfileButtonExists() {
        let app = XCUIApplication.home()
        XCTAssertTrue(app.waitForHome())
        let gear = app.buttons[HID.settings]
        XCTAssertTrue(gear.exists)
        XCTAssertEqual(gear.label, "Settings")
        XCTAssertTrue(gear.isHittable)
        XCTAssertGreaterThanOrEqual(gear.frame.width, 43.5)
        XCTAssertGreaterThanOrEqual(gear.frame.height, 43.5)
        let profile = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'profile' OR label CONTAINS[c] 'account' OR identifier CONTAINS[c] 'profile'"))
        XCTAssertEqual(profile.count, 0, "round 3: the profile button is replaced by the gear")
        gear.tap()   // Settings is a later PR: tapping must not crash or leave Home.
        XCTAssertTrue(app.home(HID.greeting).exists)
    }

    func testPillAndGearShareTheGreetingRowAtDefaultSize() {
        let app = XCUIApplication.home()
        XCTAssertTrue(app.home(HID.pill).waitForExistence(timeout: 10))
        let pill = app.home(HID.pill).frame, gear = app.home(HID.settings).frame
        XCTAssertLessThan(abs(pill.midY - gear.midY), 24, "pill and gear share the header row: pill \(pill), gear \(gear)")
        XCTAssertGreaterThan(pill.minX, gear.maxX - 1, "pill to the right of the gear")
    }

    // MARK: Tip

    func testTipIsAboveTheSectionsBelowTheHeaderAndIsAnObservation() throws {
        let app = XCUIApplication.home()
        let tip = app.home(HID.tip)
        XCTAssertTrue(tip.waitForExistence(timeout: 10))
        XCTAssertGreaterThan(tip.frame.minY, app.home(HID.greeting).frame.maxY - 1)
        XCTAssertLessThan(tip.frame.maxY, app.home(HID.useFirst).frame.minY, "tip above Use these first")
        XCTAssertLessThan(tip.frame.maxY, app.staticTexts["Use these first"].frame.minY)
        let text = tip.label
        XCTAssertFalse(text.isEmpty)
        XCTAssertLessThanOrEqual(text.count, 100, "GET /tips lines run up to 100 characters")
        let advice = ["you should", "try ", "make sure", "don't forget", "remember to", "consider "]
        XCTAssertFalse(advice.contains { text.lowercased().contains($0) }, "observation only, not advice: \(text)")
    }

    /// Runs WITHOUT the `-home.dismissedTip ""` override (it shadows the stored value, so a tap could
    /// never hide the tip). Needs a fresh install: skipped when an earlier run already dismissed it.
    func testDismissingTheTipRemovesItAndTheListMovesUp() throws {
        let app = XCUIApplication.home(showTip: false)
        XCTAssertTrue(app.home(HID.useFirst).waitForExistence(timeout: 10))
        let tip = app.home(HID.tip)
        try XCTSkipUnless(tip.waitForExistence(timeout: 3), "tip already dismissed on this install")
        let before = app.home(HID.useFirst).frame.minY
        let x = app.buttons[HID.tipDismiss]
        XCTAssertEqual(x.label, "Dismiss tip")
        XCTAssertGreaterThanOrEqual(x.frame.width, 43.5)
        XCTAssertGreaterThanOrEqual(x.frame.height, 43.5)
        x.tap()
        let gone = NSPredicate(format: "exists == false")
        wait(for: [expectation(for: gone, evaluatedWith: tip)], timeout: 5)
        XCTAssertLessThan(app.home(HID.useFirst).frame.minY, before)
    }

    /// Dismissal persists across launches. Runs WITHOUT the `-home.dismissedTip ""` override, which
    /// shadows the stored value. The first launch dismisses (when the tip is still there), the
    /// second launch must not show it.
    func testTipDismissalPersistsAcrossLaunches() {
        var app = XCUIApplication.home(showTip: false)
        XCTAssertTrue(app.waitForHome())
        _ = app.home(HID.useFirst).waitForExistence(timeout: 10)
        if app.home(HID.tip).waitForExistence(timeout: 3) { app.buttons[HID.tipDismiss].tap() }
        XCTAssertFalse(app.home(HID.tip).waitForExistence(timeout: 1), "dismissed")
        app.terminate()
        app = XCUIApplication.home(showTip: false)
        XCTAssertTrue(app.waitForHome())
        XCTAssertTrue(app.home(HID.useFirst).waitForExistence(timeout: 10))
        XCTAssertFalse(app.home(HID.tip).waitForExistence(timeout: 2), "still dismissed after a relaunch")
    }

    func testNoTipOnFirstUse() {
        let app = XCUIApplication.home(["-UITestSeed", "empty"])
        XCTAssertTrue(app.home(HID.empty).waitForExistence(timeout: 10))
        XCTAssertFalse(app.home(HID.tip).exists)
    }

    // MARK: HomeEmpty

    func testHomeEmptyShowsAddFoodCardPlaceholderAndZeroPill() {
        let app = XCUIApplication.home(["-UITestSeed", "empty"])
        XCTAssertTrue(app.home(HID.empty).waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Add food and we'll show what to use first"].exists)
        XCTAssertTrue(app.staticTexts["Recipes appear once you've added a few items"].exists)
        XCTAssertTrue(app.home(HID.cookEmpty).exists)
        XCTAssertFalse(app.home(HID.cookCard).exists)
        XCTAssertFalse(app.home(HID.seeAll).exists, "nothing to see all of")
        XCTAssertFalse(app.home(HID.tip).exists)
        XCTAssertFalse(app.home(HID.error).exists)
        let add = app.buttons[HID.addFood]
        XCTAssertTrue(app.scrollHome(to: add))
        XCTAssertGreaterThanOrEqual(add.frame.height, 43.5)
        let pill = app.home(HID.pill)
        XCTAssertTrue(pill.exists)
        XCTExpectFailure("IOS-41: mock impact ignores the empty seed", strict: false)
        XCTAssertTrue(pill.label.hasPrefix("0 "), "artboard: '0 lb saved', got '\(pill.label)'")
        attachScreenshot(app, name: "HomeEmpty")
    }

    func testAddFoodOpensTheAddSheet() {
        let app = XCUIApplication.home(["-UITestSeed", "empty"])
        let add = app.buttons[HID.addFood]
        XCTAssertTrue(add.waitForExistence(timeout: 10))
        add.tap()
        XCTAssertTrue(app.addSheet.waitForExistence(timeout: 5))
    }

    // MARK: Loading

    func testLoadingShowsASingleSkeletonElementUnderTheHeader() {
        let app = XCUIApplication.home(["-UITestLoadingForever"])
        XCTAssertTrue(app.waitForHome())
        let loading = app.home(HID.loading)
        XCTAssertTrue(loading.waitForExistence(timeout: 5))
        XCTAssertEqual(loading.label, "Loading")
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: HID.loading).count, 1, "one VoiceOver stop")
        XCTAssertFalse(app.home(HID.useFirst).exists)
        XCTAssertFalse(app.home(HID.error).exists)
        XCTAssertFalse(app.home(HID.empty).exists)
        XCTAssertTrue(app.staticTexts["Use these first"].exists)
        XCTAssertTrue(app.home(HID.settings).exists, "the gear works while loading")
        attachScreenshot(app, name: "HomeLoading")
    }

    func testSlowNetworkShowsSkeletonThenContent() {
        let app = XCUIApplication.home(["-UITestSlowNetwork"])
        XCTAssertTrue(app.home(HID.loading).waitForExistence(timeout: 5))
        XCTAssertTrue(app.home(HID.useFirst).waitForExistence(timeout: 15))
        XCTAssertFalse(app.home(HID.loading).exists)
    }

    // MARK: ServerError

    func testServerDownShowsBannerErrorCardServerRowAndNoStaleParts() {
        let app = XCUIApplication.home(["-UITestServerDown"])
        XCTAssertTrue(app.home(HID.error).waitForExistence(timeout: 10))
        XCTAssertTrue(app.home(HID.banner).exists)
        XCTAssertTrue(app.staticTexts["Can't reach BiteDown. Check your connection."].exists)
        XCTAssertTrue(app.staticTexts["Couldn't load your food"].exists)
        XCTAssertTrue(app.buttons[HID.bannerRetry].exists)
        XCTAssertTrue(app.buttons[HID.retry].exists)
        XCTAssertTrue(app.home(HID.server).exists)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Using '")).firstMatch.exists, "names the server in use")
        XCTAssertTrue(app.buttons[HID.serverChange].exists)
        XCTAssertFalse(app.home(HID.pill).exists, "no stale number")
        XCTAssertFalse(app.home(HID.tip).exists)
        XCTAssertFalse(app.home(HID.useFirst).exists)
        XCTAssertFalse(app.home(HID.cookCard).exists)
        XCTAssertTrue(app.home(HID.settings).exists, "settings stay reachable: that is where the server address lives")
        attachScreenshot(app, name: "ServerError")
    }

    func testServerErrorButtonsAreTappable44ptTargets() {
        let app = XCUIApplication.home(["-UITestServerDown"])
        XCTAssertTrue(app.home(HID.error).waitForExistence(timeout: 10))
        for id in [HID.bannerRetry, HID.retry, HID.serverChange] {
            let b = app.buttons[id]
            XCTAssertTrue(app.scrollHome(to: b), id)
            XCTAssertGreaterThanOrEqual(b.frame.height, 43.5, id)
            XCTAssertGreaterThanOrEqual(b.frame.width, 43.5, id)
        }
        XCTAssertEqual(app.buttons[HID.serverChange].label, "Change server address")
    }

    func testChangeServerDoesNotCrashAndKeepsTheErrorUp() {
        let app = XCUIApplication.home(["-UITestServerDown"])
        let change = app.buttons[HID.serverChange]
        XCTAssertTrue(change.waitForExistence(timeout: 10))
        change.tap()   // Settings › Debug "Server address" lands with the Settings PR; the closure is wired in RootTabView.
        XCTAssertTrue(app.home(HID.greeting).exists)
    }

    func testTryAgainOnTheErrorCardRecovers() {
        let app = XCUIApplication.home(["-UITestFailListOnce"])
        XCTAssertTrue(app.home(HID.error).waitForExistence(timeout: 10))
        app.buttons[HID.retry].tap()
        XCTAssertTrue(app.home(HID.useFirst).waitForExistence(timeout: 10))
        XCTAssertFalse(app.home(HID.error).exists)
        XCTAssertFalse(app.home(HID.banner).exists)
        XCTAssertTrue(app.home(HID.pill).exists)
        XCTAssertTrue(app.home(HID.row("item-chicken")).exists)
    }

    func testTryAgainOnTheBannerRecovers() {
        let app = XCUIApplication.home(["-UITestFailListOnce"])
        XCTAssertTrue(app.home(HID.error).waitForExistence(timeout: 10))
        app.buttons[HID.bannerRetry].tap()
        XCTAssertTrue(app.home(HID.useFirst).waitForExistence(timeout: 10))
        XCTAssertFalse(app.home(HID.banner).exists)
    }

    func testTryAgainWhileStillDownStaysOnTheErrorState() {
        let app = XCUIApplication.home(["-UITestServerDown"])
        XCTAssertTrue(app.home(HID.error).waitForExistence(timeout: 10))
        app.buttons[HID.retry].tap()
        XCTAssertTrue(app.home(HID.error).waitForExistence(timeout: 10), "back on the error card after the retry fails")
        XCTAssertTrue(app.scrollHome(to: app.buttons[HID.retry]))
    }

    func testOnlyTheItemListFailingIsTheServerError() {
        let app = XCUIApplication.home(["-UITestFailList"])
        XCTAssertTrue(app.home(HID.error).waitForExistence(timeout: 10))
        XCTAssertTrue(app.home(HID.banner).exists)
    }

    // MARK: Secondary calls degrade quietly

    func testRecipes502ShowsAMutedCookCardNotAnError() {
        let app = XCUIApplication.home(["-UITestRecipes502"])
        XCTAssertTrue(app.home(HID.useFirst).waitForExistence(timeout: 10))
        XCTAssertTrue(app.home(HID.cookEmpty).waitForExistence(timeout: 5))
        XCTAssertFalse(app.home(HID.cookCard).exists)
        XCTAssertFalse(app.home(HID.error).exists)
        XCTAssertFalse(app.home(HID.banner).exists)
    }

    // MARK: Regression: the placeholder hooks the shell tests rely on

    func testVersionLabelAndUndoToastHooksStillWorkOnHome() {
        let app = XCUIApplication.home(["-UITestShowToast"])
        XCTAssertTrue(app.buttons[ID.versionLabel].waitForExistence(timeout: 10) || app.home(ID.versionLabel).waitForExistence(timeout: 5))
        XCTAssertTrue(app.toast.waitForExistence(timeout: 5))
        app.buttons[ID.toastButton].tap()
        XCTAssertTrue(app.home(ID.toastMarker).waitForExistence(timeout: 5))
    }

    func testReturningToHomeFromAnotherTabKeepsTheContent() {
        let app = XCUIApplication.home()
        XCTAssertTrue(app.home(HID.row("item-chicken")).waitForExistence(timeout: 10))
        app.tab(ID.fridge).tap()
        app.tab(ID.home).tap()
        XCTAssertTrue(app.home(HID.row("item-chicken")).waitForExistence(timeout: 5))
        XCTAssertFalse(app.home(HID.loading).exists)
    }

    func testPullToRefreshKeepsTheContent() {
        let app = XCUIApplication.home()
        let row = app.home(HID.row("item-chicken"))
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        let scroll = app.scrollViews.firstMatch
        scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2))
            .press(forDuration: 0.1, thenDragTo: scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8)))
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        XCTAssertFalse(app.home(HID.error).exists)
    }
}

/// Accessibility sizes. Run on the iPhone SE QA simulator; also forced here through the launch argument.
final class HomeAX5UITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    func testPillDropsBelowTheGreetingAtAX5() {
        let app = XCUIApplication.home(HID.ax5)
        let pill = app.home(HID.pill)
        XCTAssertTrue(pill.waitForExistence(timeout: 10))
        let greeting = app.home(HID.greeting).frame
        XCTAssertGreaterThanOrEqual(pill.frame.minY, greeting.maxY - 1, "pill below the greeting")
        XCTAssertGreaterThanOrEqual(pill.frame.height, 43.5)
        XCTAssertLessThanOrEqual(pill.frame.maxX, app.frame.maxX + 1)
        let gear = app.home(HID.settings).frame
        XCTAssertGreaterThanOrEqual(gear.width, 43.5)
        XCTAssertLessThanOrEqual(gear.maxX, app.frame.maxX + 1)
        attachScreenshot(app, name: "HomeAX5")
    }

    func testContentIsReachableAtAX5() {
        let app = XCUIApplication.home(HID.ax5)
        XCTAssertTrue(app.home(HID.useFirst).waitForExistence(timeout: 10))
        for id in [HID.seeAll, HID.row("item-chicken"), HID.cookCard] {
            let el = app.home(id)
            XCTAssertTrue(app.scrollHome(to: el), "\(id) reachable by scrolling")
            XCTAssertLessThanOrEqual(el.frame.maxX, app.frame.maxX + 1, id)
        }
    }

    func testTipDismissIsReachableAndOnScreenAtAX5() {
        let app = XCUIApplication.home(HID.ax5)
        let x = app.buttons[HID.tipDismiss]
        XCTAssertTrue(x.waitForExistence(timeout: 10))
        XCTAssertTrue(app.scrollHome(to: x))
        XCTAssertGreaterThanOrEqual(x.frame.width, 43.5)
        XCTAssertLessThanOrEqual(x.frame.maxX, app.frame.maxX + 1)
        XCTAssertEqual(app.home(HID.tip).label.isEmpty, false, "text is never dropped at AX5")
    }

    func testServerErrorControlsAreReachableAtAX5() {
        let app = XCUIApplication.home(HID.ax5 + ["-UITestServerDown"])
        XCTAssertTrue(app.home(HID.error).waitForExistence(timeout: 10))
        for id in [HID.bannerRetry, HID.retry, HID.serverChange] {
            let b = app.buttons[id]
            XCTAssertTrue(app.scrollHome(to: b), "\(id) reachable")
            XCTAssertGreaterThanOrEqual(b.frame.height, 43.5, id)
            XCTAssertLessThanOrEqual(b.frame.maxX, app.frame.maxX + 1, id)
        }
        attachScreenshot(app, name: "ServerErrorAX5")
    }

    func testHomeEmptyAddFoodReachableAtAX5() {
        let app = XCUIApplication.home(HID.ax5 + ["-UITestSeed", "empty"])
        XCTAssertTrue(app.home(HID.empty).waitForExistence(timeout: 10))
        XCTAssertTrue(app.scrollHome(to: app.buttons[HID.addFood]))
    }
}

/// Narrow phones at the default text size (run on the iPhone SE QA simulator; skipped on wider ones).
final class HomeNarrowUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    /// IOS-43: the pill text must stay on one line ("23.2 lb saved"), also on a 375 pt phone.
    func testImpactPillStaysOnOneLineOnANarrowPhone() throws {
        let app = XCUIApplication.home()
        let pill = app.home(HID.pill)
        XCTAssertTrue(pill.waitForExistence(timeout: 10))
        try XCTSkipIf(app.frame.width > 380, "only meaningful on a 375 pt phone")
        // One line of "23.2 lb saved" + icon + padding is about 150 pt wide; wrapped, the pill squeezes to ~95 pt.
        XCTAssertGreaterThanOrEqual(pill.frame.width, 130, "pill label wrapped to two lines: \(pill.frame)")
    }
}
