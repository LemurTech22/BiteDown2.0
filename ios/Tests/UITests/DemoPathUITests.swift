import XCTest

/// Demo-path identifiers. They mirror `AccessibilityID.Add`, `.PhotoReview`, `.ItemDetail`, `.Home` and `.Impact`.
private enum DID {
    static let hero = "add.hero"
    static let review = "photoreview"
    static func toss(_ i: Int) -> String { "photoreview.toss.\(i)" }
    static let confirm = "photoreview.confirm"
    static let detail = "itemdetail"
    static let detailBadge = "itemdetail.badge"
    static let detailExpiry = "itemdetail.expiry"
    static let detailRemove = "itemdetail.remove"
    static let impactPill = "home.impact"
    /// `impact` (AccessibilityID.Impact.screen) is not attached to ImpactView yet; the title marks the screen.
    static let impact = "impact.title"
    static let impactValue = "impact.hero.value"
}

/// The merge-gate demo path on the mock API, end to end: Add → photo → review → add → Fridge →
/// open the new item (expiry shown) → remove it as Used → Home's Impact pill → the Impact screen loads.
/// The removal is checked in the Fridge (the row disappears). The Impact step is navigation only: the mock's
/// Impact is a fixed fixture (`MockData.impact`) that removals never change, so it can't prove that removing
/// an item updates Impact. That needs a removal-aware mock first.
/// Runs in the PR Smoke plan. Waits are generous upper bounds for slow CI runners, never speed checks.
final class DemoPathUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    func testDemoPath() {
        // Default `fridge` seed (the `empty` seed also zeroes Impact). Created mock items get ids `item-new-<n>`.
        let app = XCUIApplication.mockSignedIn(RemoveArgs.undoWindow)
        XCTAssertTrue(app.tab(ID.add).waitForExistence(timeout: 20), "tab bar missing")

        // Add → Snap a photo (the mock uses a stand-in photo; no camera in the Simulator).
        app.tab(ID.add).tap()
        XCTAssertTrue(app.addSheet.waitForExistence(timeout: 10), "Add sheet did not open")
        let hero = app.any(DID.hero)
        XCTAssertTrue(hero.waitForExistence(timeout: 10), "Snap a photo tile missing")
        hero.tap()

        // Review: mock finds spinach, bananas, strawberries (spoiled, index 2) and yogurt.
        XCTAssertTrue(app.any(DID.review).waitForExistence(timeout: 20), "PhotoReview did not appear")
        attachScreenshot(app, name: "demo-review")
        let toss = app.buttons[DID.toss(2)]
        XCTAssertTrue(toss.waitForExistence(timeout: 10), "Toss button for the spoiled item missing")
        toss.tap()
        let confirm = app.buttons[DID.confirm]
        XCTAssertTrue(confirm.waitForExistence(timeout: 10), "confirm button missing")
        XCTAssertTrue(waitFor(confirm, "isEnabled == true", timeout: 10), "confirm stayed disabled")
        XCTAssertTrue(confirm.label.hasPrefix("Add "), "confirm label '\(confirm.label)'")
        confirm.tap()
        XCTAssertTrue(app.any(DID.review).waitForNonExistence(timeout: 20), "review did not close after adding")
        XCTAssertTrue(app.addSheet.waitForNonExistence(timeout: 10), "Add sheet did not close")

        // Fridge → the new row.
        app.tab(ID.fridge).tap()
        let newRow = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier MATCHES %@", #"fridge\.row\.item-new-[0-9]+"#)).firstMatch
        XCTAssertTrue(newRow.waitForExistence(timeout: 20), "no new item in the Fridge")
        let rowID = newRow.identifier
        XCTAssertTrue(app.reveal(newRow), "new row not reachable")
        XCTAssertTrue(app.any(rowID + ".badge").exists, "new row has no expiry badge")
        attachScreenshot(app, name: "demo-fridge")
        newRow.tap()

        // Item detail: an expiry is shown (a date picker, not the "Set a date" button).
        XCTAssertTrue(app.any(DID.detail).waitForExistence(timeout: 10), "Item detail did not open")
        let expiry = app.any(DID.detailExpiry)
        XCTAssertTrue(expiry.waitForExistence(timeout: 10), "expiry missing in Item detail")
        XCTAssertNotEqual(expiry.label, "Set a date", "new item has no expiry date")
        XCTAssertTrue(app.any(DID.detailBadge).exists, "expiry badge missing in Item detail")
        attachScreenshot(app, name: "demo-detail")

        // Remove as Used.
        // Typed query (a Button): an `.any` query over the whole Item detail tree can time out on a busy runner.
        let remove = app.buttons[DID.detailRemove]
        XCTAssertTrue(remove.waitForExistence(timeout: 15), "Remove button missing")
        for _ in 0..<6 where !remove.isHittable { app.swipeUp() }
        remove.tap()
        XCTAssertTrue(app.any(FID.sheet).waitForExistence(timeout: 10), "remove.sheet did not open")
        app.any(FID.outcome("used")).tap()
        XCTAssertTrue(app.any(FID.sheet).waitForNonExistence(timeout: 10), "remove sheet stayed open")
        XCTAssertTrue(app.any(DID.detail).waitForNonExistence(timeout: 10), "Item detail stayed open")
        XCTAssertTrue(app.any(rowID).waitForNonExistence(timeout: 10), "removed row still in the Fridge")

        // Home → Impact pill → the Impact screen loads with a value. Navigation only: the mock's Impact is a
        // static fixture, so this does not check that the Used removal above changed it.
        app.tab(ID.home).tap()
        let pill = app.any(DID.impactPill)
        XCTAssertTrue(pill.waitForExistence(timeout: 15), "Impact pill missing on Home")
        pill.tap()
        XCTAssertTrue(app.any(DID.impact).waitForExistence(timeout: 15), "Impact did not open")
        let value = app.any(DID.impactValue)
        XCTAssertTrue(value.waitForExistence(timeout: 15), "Impact hero value missing")
        XCTAssertNotNil(value.label.range(of: #"\d"#, options: .regularExpression), "Impact screen loaded without a value: '\(value.label)'")
        attachScreenshot(app, name: "demo-impact")
    }

    private func waitFor(_ element: XCUIElement, _ predicate: String, timeout: TimeInterval) -> Bool {
        let e = XCTNSPredicateExpectation(predicate: NSPredicate(format: predicate), object: element)
        return XCTWaiter().wait(for: [e], timeout: timeout) == .completed
    }
}
