import Foundation

/// One `remove` event the mock recorded this session. Mirrors the backend's `food_events` row for a
/// removal: the weight, price and CO2e are snapshotted from the item at removal time, so a later edit
/// does not change them, and a restore deletes the event (docs/API.md `POST /items/:id/restore`).
struct MockImpactEvent: Sendable, Hashable {
    let itemId: String
    let time: Date
    let outcome: RemoveOutcome
    let wasteReason: WasteReason?
    let kg: Double
    let money: Double
    let co2eKg: Double
}

/// Makes the mock's `GET /impact` removal-aware (`MockAPIClient.impact(range:)`): the fixture stays the
/// baseline, and each item removed through the mock adds its contribution on top. The maths mirror the
/// backend: `routes/insights.py` sums `est_weight_kg`, `est_price` and `co2e_kg` per outcome
/// (`saved` = used + donated, `wasted` = thrown_out), and `services/impact.py` supplies the weight
/// estimate and CO2e factors. Pure functions, so they are safe from any isolation context.
enum MockImpact {
    // MARK: Event from an item (services/impact.py)

    /// kg CO2e per kg of food (Poore & Nemecek 2018 category averages), same table as the backend.
    static func co2ePerKg(_ category: FoodCategory) -> Double {
        switch category {
        case .produceLeafy: 0.5
        case .produceHardy: 0.7
        case .dairy: 4.5
        case .meat: 15.0
        case .seafood: 6.0
        case .bakery: 1.4
        case .eggs: 4.7
        case .leftovers: 3.0
        case .pantryDry: 1.5
        case .frozen: 2.5
        case .other: 2.0
        }
    }

    /// Typical mass of one "piece" per category, kg.
    static func pieceKg(_ category: FoodCategory) -> Double {
        switch category {
        case .produceLeafy: 0.25
        case .produceHardy: 0.2
        case .dairy: 0.5
        case .meat: 0.45
        case .seafood: 0.3
        case .bakery: 0.4
        case .eggs: 0.06
        case .leftovers: 0.4
        case .pantryDry: 0.5
        case .frozen: 0.5
        case .other: 0.3
        }
    }

    private static let unitKg: [String: Double] = [
        "kg": 1.0, "g": 0.001, "lb": 0.4536, "lbs": 0.4536, "oz": 0.02835,
        "l": 1.0, "liter": 1.0, "litre": 1.0, "ml": 0.001, "gallon": 3.785, "cup": 0.24,
    ]

    /// `estimate_weight_kg`: used only when the item carries no `estWeightKg`.
    static func estimateWeightKg(category: FoodCategory, quantity: Double, unit: String?) -> Double {
        var q = quantity
        let u = (unit ?? "piece").trimmingCharacters(in: .whitespaces).lowercased()
        if let perUnit = unitKg[u] { return round4(q * perUnit) }
        if u == "dozen" { q *= 12 }
        return round4(q * pieceKg(category))
    }

    /// The event a removal of `item` writes. Weight falls back to the estimate like the backend; a missing
    /// price counts as 0 (SQL `sum` skips NULLs).
    static func event(for item: Item, outcome: RemoveOutcome, wasteReason: WasteReason?, at time: Date) -> MockImpactEvent {
        let kg = item.estWeightKg ?? estimateWeightKg(category: item.category, quantity: item.quantity, unit: item.unit)
        return MockImpactEvent(itemId: item.id, time: time, outcome: outcome, wasteReason: wasteReason,
                               kg: kg, money: item.estPrice ?? 0, co2eKg: round4(kg * co2ePerKg(item.category)))
    }

    // MARK: Fold events into a baseline

    /// `base` plus the `events` that fall in `range`. With no events in range the baseline is returned
    /// untouched, so Undo leaves Impact exactly as it was. `previous` is the earlier window, which a
    /// removal made now never touches, so it stays as the fixture has it.
    static func apply(_ all: [MockImpactEvent], to base: Impact, range: ImpactRange,
                      now: Date = Date(), calendar: Calendar = .current) -> Impact {
        let events = all.filter { inWindow($0.time, range: range, now: now) }
            .sorted { ($0.time, $0.itemId) < ($1.time, $1.itemId) }
        guard !events.isEmpty else { return base }

        let used = events.filter { $0.outcome == .used }
        let donated = events.filter { $0.outcome == .donated }
        let thrown = events.filter { $0.outcome == .thrownOut }

        var result = base
        result.used = adding(used, to: base.used)
        result.donated = adding(donated, to: base.donated)
        result.saved = adding(used + donated, to: base.saved)
        result.wasted = adding(thrown, to: base.wasted)
        let total = result.saved.count + result.wasted.count
        result.wasteRate = total == 0 ? 0 : round2(Double(result.wasted.count) / Double(total))
        result.wasteReasons = reasons(base.wasteReasons, adding: thrown, wastedCount: result.wasted.count)

        var cal = calendar
        cal.firstWeekday = 2
        for e in events {
            let week = cal.dateInterval(of: .weekOfYear, for: e.time)?.start ?? cal.startOfDay(for: e.time)
            let isSaved = e.outcome != .thrownOut
            if let i = result.last6Weeks.firstIndex(where: { cal.isDate($0.week, inSameDayAs: week) }) {
                if e.outcome == .used { result.last6Weeks[i].used += 1 }
                if e.outcome == .donated { result.last6Weeks[i].donated += 1 }
                if isSaved { result.last6Weeks[i].saved += 1 } else { result.last6Weeks[i].wasted += 1 }
            }
            if let i = result.weekly.firstIndex(where: { cal.isDate($0.week, inSameDayAs: week) }) {
                if isSaved { result.weekly[i].saved += 1 } else { result.weekly[i].wasted += 1 }
            } else {
                result.weekly.append(WeeklyBucket(week: week, saved: isSaved ? 1 : 0, wasted: isSaved ? 0 : 1))
                result.weekly.sort { $0.week < $1.week }
            }
        }
        return result
    }

    // MARK: Helpers

    /// week = last 7 days, month = last 30, all = everything (docs/API.md `/impact`).
    private static func inWindow(_ time: Date, range: ImpactRange, now: Date) -> Bool {
        switch range {
        case .all: true
        case .week: time >= now.addingTimeInterval(-7 * 86_400)
        case .month: time >= now.addingTimeInterval(-30 * 86_400)
        }
    }

    private static func adding(_ events: [MockImpactEvent], to totals: ImpactTotals) -> ImpactTotals {
        ImpactTotals(count: totals.count + events.count,
                     kg: round2(totals.kg + events.reduce(0) { $0 + $1.kg }),
                     money: round2(totals.money + events.reduce(0) { $0 + $1.money }),
                     co2eKg: round2(totals.co2eKg + events.reduce(0) { $0 + $1.co2eKg }))
    }

    /// Always all four reasons, sorted by count desc with ties in enum order, `share` of `wastedCount`.
    private static func reasons(_ base: [WasteReasonStat], adding thrown: [MockImpactEvent], wastedCount: Int) -> [WasteReasonStat] {
        let order = WasteReason.allCases
        let merged = order.enumerated().map { (index, reason) -> (Int, WasteReasonStat) in
            var stat = base.first { $0.reason == reason }
                ?? WasteReasonStat(reason: reason, count: 0, kg: 0, money: 0, co2eKg: 0, share: 0)
            let mine = thrown.filter { $0.wasteReason == reason }
            stat.count += mine.count
            stat.kg = round2(stat.kg + mine.reduce(0) { $0 + $1.kg })
            stat.money = round2(stat.money + mine.reduce(0) { $0 + $1.money })
            stat.co2eKg = round2(stat.co2eKg + mine.reduce(0) { $0 + $1.co2eKg })
            stat.share = wastedCount == 0 ? 0 : round2(Double(stat.count) / Double(wastedCount))
            return (index, stat)
        }
        return merged.sorted { $0.1.count != $1.1.count ? $0.1.count > $1.1.count : $0.0 < $1.0 }.map(\.1)
    }

    private static func round2(_ v: Double) -> Double { (v * 100).rounded() / 100 }
    private static func round4(_ v: Double) -> Double { (v * 10_000).rounded() / 10_000 }
}
