import XCTest
@testable import FoodWasteReducer

final class ExpiryBadgeTests: XCTestCase {
    private func cal(_ tz: String) -> Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: tz)!
        return c
    }

    private func date(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 0, _ min: Int = 0, _ c: Calendar) -> Date {
        c.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: min))!
    }

    private func badge(_ expiryDay: (Int, Int, Int), now: Date, _ c: Calendar,
                       freshness: Freshness? = nil) -> ExpiryBadgeModel? {
        ExpiryBadgeModel.make(expiry: date(expiryDay.0, expiryDay.1, expiryDay.2, 0, 0, c),
                              freshness: freshness, now: now, calendar: c)
    }

    func testTodayTomorrowNDaysExpired() {
        let c = cal("America/Chicago")
        let now = date(2026, 10, 10, 14, 30, c)
        XCTAssertEqual(badge((2026, 10, 10), now: now, c)?.text, "Today")
        XCTAssertEqual(badge((2026, 10, 11), now: now, c)?.text, "Tomorrow")
        XCTAssertEqual(badge((2026, 10, 12), now: now, c)?.text, "2–3 days")
        XCTAssertEqual(badge((2026, 10, 24), now: now, c)?.text, "1–2 weeks")
        XCTAssertEqual(badge((2026, 10, 9), now: now, c)?.text, "Expired")
        XCTAssertEqual(badge((2026, 9, 1), now: now, c)?.text, "Expired")
    }

    func testStyles() {
        let c = cal("America/Chicago")
        let now = date(2026, 10, 10, 9, 0, c)
        XCTAssertEqual(badge((2026, 10, 10), now: now, c)?.style, .urgent)
        XCTAssertEqual(badge((2026, 10, 11), now: now, c)?.style, .urgent)
        XCTAssertEqual(badge((2026, 10, 9), now: now, c)?.style, .urgent)
        XCTAssertEqual(badge((2026, 10, 12), now: now, c)?.style, .later)
    }

    func testSemiFreshShowsUseSoonUnlessMoreUrgent() {
        let c = cal("America/Chicago")
        let now = date(2026, 10, 10, 9, 0, c)
        XCTAssertEqual(badge((2026, 10, 15), now: now, c, freshness: .semiFresh)?.text, "Use soon")
        XCTAssertEqual(badge((2026, 10, 15), now: now, c, freshness: .semiFresh)?.style, .useSoon)
        // Today and Expired outrank "Use soon".
        XCTAssertEqual(badge((2026, 10, 10), now: now, c, freshness: .semiFresh)?.text, "Today")
        XCTAssertEqual(badge((2026, 10, 8), now: now, c, freshness: .semiFresh)?.text, "Expired")
    }

    func testFreshDoesNotChangeBadge() {
        let c = cal("America/Chicago")
        let now = date(2026, 10, 10, 9, 0, c)
        XCTAssertEqual(badge((2026, 10, 15), now: now, c, freshness: .fresh)?.text, "4–5 days")
    }

    func testSpoiledShowsLooksOff() {
        let c = cal("America/Chicago")
        let now = date(2026, 10, 10, 9, 0, c)
        XCTAssertEqual(badge((2026, 10, 20), now: now, c, freshness: .spoiled)?.text, "Looks off")
        XCTAssertEqual(badge((2026, 10, 20), now: now, c, freshness: .spoiled)?.style, .urgent)
        XCTAssertNotEqual(badge((2026, 10, 20), now: now, c, freshness: .spoiled)?.text, "Check", "renamed in round 3")
    }

    func testNoExpiry() {
        let c = cal("UTC")
        let now = date(2026, 10, 10, 9, 0, c)
        XCTAssertNil(ExpiryBadgeModel.make(expiry: nil, freshness: nil, now: now, calendar: c))
        XCTAssertEqual(ExpiryBadgeModel.make(expiry: nil, freshness: .semiFresh, now: now, calendar: c)?.text, "Use soon")
    }

    func testAcrossMidnightSameExpiry() {
        let c = cal("America/Chicago")
        let expiry = date(2026, 10, 11, 0, 0, c)
        let before = date(2026, 10, 10, 23, 59, c)
        let after = date(2026, 10, 11, 0, 1, c)
        XCTAssertEqual(ExpiryBadgeModel.make(expiry: expiry, freshness: nil, now: before, calendar: c)?.text, "Tomorrow")
        XCTAssertEqual(ExpiryBadgeModel.make(expiry: expiry, freshness: nil, now: after, calendar: c)?.text, "Today")
        let next = date(2026, 10, 12, 0, 1, c)
        XCTAssertEqual(ExpiryBadgeModel.make(expiry: expiry, freshness: nil, now: next, calendar: c)?.text, "Expired")
    }

    func testTimeZonesGiveLocalDays() {
        // The same instant is Oct 10 in Honolulu and Oct 11 in Tokyo.
        let hon = cal("Pacific/Honolulu"), tok = cal("Asia/Tokyo")
        let instant = Date(timeIntervalSince1970: 1_791_700_000) // 2026-10-11 05:46 UTC
        let honDay = hon.dateComponents([.day], from: instant).day!
        let tokDay = tok.dateComponents([.day], from: instant).day!
        XCTAssertNotEqual(honDay, tokDay)
        let expiryHon = hon.date(from: DateComponents(year: 2026, month: 10, day: honDay))!
        XCTAssertEqual(ExpiryBadgeModel.make(expiry: expiryHon, freshness: nil, now: instant, calendar: hon)?.text, "Today")
        let expiryTok = tok.date(from: DateComponents(year: 2026, month: 10, day: tokDay))!
        XCTAssertEqual(ExpiryBadgeModel.make(expiry: expiryTok, freshness: nil, now: instant, calendar: tok)?.text, "Today")
    }

    func testDaylightSavingBoundaryStillCountsCalendarDays() {
        let c = cal("America/Chicago") // DST ends 2026-11-01
        let now = date(2026, 10, 31, 12, 0, c)
        XCTAssertEqual(badge((2026, 11, 2), now: now, c)?.text, "2–3 days")
        XCTAssertEqual(badge((2026, 11, 1), now: now, c)?.text, "Tomorrow")
    }

    func testAPIDateOnlyParsesToLocalMidnightSoBadgeMatches() throws {
        let c = cal("America/Chicago")
        let expiry = try XCTUnwrap(APIDate.parse("2026-10-12", calendar: c))
        let now = date(2026, 10, 10, 22, 0, c)
        XCTAssertEqual(ExpiryBadgeModel.make(expiry: expiry, freshness: nil, now: now, calendar: c)?.text, "2–3 days")
    }

    func testAccessibilityText() {
        XCTAssertEqual(ExpiryBadgeModel(kind: .today).accessibilityText, "Expires today")
        XCTAssertEqual(ExpiryBadgeModel(kind: .tomorrow).accessibilityText, "Expires tomorrow")
        XCTAssertEqual(ExpiryBadgeModel(kind: .exactDays(3)).accessibilityText, "Expires in 3 days")
        XCTAssertEqual(ExpiryBadgeModel(kind: .expired).accessibilityText, "Expired")
        XCTAssertEqual(ExpiryBadgeModel(kind: .useSoon).accessibilityText, "Use soon")
        XCTAssertTrue(ExpiryBadgeModel(kind: .looksOff).accessibilityText.hasPrefix("Looks off"))
        let range = ExpiryBadgeModel(kind: .estimated(days: 3)).accessibilityText
        XCTAssertFalse(range.contains("–"), "VoiceOver must not read an en dash: \(range)")
        XCTAssertTrue(range.contains("2 to 3 days"), range)
    }

    // MARK: Fridge polish: estimated ranges

    func testEstimatedRangeVocabularyAcrossBoundaries() {
        let c = cal("America/Chicago")
        let now = date(2026, 10, 10, 9, 0, c)
        func text(_ days: Int) -> String? {
            let e = c.date(byAdding: .day, value: days, to: c.startOfDay(for: now))!
            return ExpiryBadgeModel.make(expiry: e, freshness: nil, now: now, calendar: c)?.text
        }
        XCTAssertEqual(text(3), "2–3 days")
        XCTAssertEqual(text(7), "6–7 days")
        XCTAssertEqual(text(8), "1–2 weeks")
        XCTAssertEqual(text(14), "1–2 weeks")
        XCTAssertEqual(text(15), "2–3 weeks")
        XCTAssertEqual(text(21), "2–3 weeks")
        XCTAssertEqual(text(22), "3+ weeks")
        XCTAssertEqual(text(400), "3+ weeks")
        for d in 2...60 {
            let t = try! XCTUnwrap(text(d))
            XCTAssertFalse(t.contains(" day ") || t == "1 day", "day \(d): \(t)")
            XCTAssertFalse(t.isEmpty)
        }
    }

    /// A date the person typed is exact; only estimates become ranges.
    func testUserEnteredDateStaysExact() {
        let c = cal("America/Chicago")
        let now = date(2026, 10, 10, 9, 0, c)
        let e = date(2026, 10, 15, 0, 0, c)
        XCTAssertEqual(ExpiryBadgeModel.make(expiry: e, freshness: nil, estimated: false, now: now, calendar: c)?.text, "5 days")
        XCTAssertEqual(ExpiryBadgeModel.make(expiry: e, freshness: nil, estimated: true, now: now, calendar: c)?.text, "4–5 days")
    }

    func testOnePerRowStatusPriority() {
        let c = cal("America/Chicago")
        let now = date(2026, 10, 10, 9, 0, c)
        // Looks off beats expired; expired beats use soon.
        XCTAssertEqual(badge((2026, 10, 1), now: now, c, freshness: .spoiled)?.text, "Looks off")
        XCTAssertEqual(badge((2026, 10, 1), now: now, c, freshness: .semiFresh)?.text, "Expired")
        XCTAssertEqual(badge((2026, 10, 11), now: now, c, freshness: .semiFresh)?.text, "Tomorrow")
        XCTAssertEqual(badge((2026, 10, 30), now: now, c, freshness: .semiFresh)?.text, "Use soon")
    }

    func testSpokenPhraseNeverUsesTheDisplayDash() {
        for k: ExpiryBadgeModel.Kind in [.looksOff, .expired, .today, .tomorrow, .useSoon, .exactDays(4),
                                         .estimated(days: 3), .estimated(days: 10), .estimated(days: 30)] {
            let m = ExpiryBadgeModel(kind: k)
            XCTAssertFalse(m.accessibilityText.contains("–"), "\(k)")
            XCTAssertFalse(m.phrase.isEmpty)
        }
    }
}
