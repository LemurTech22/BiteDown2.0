import SwiftUI
import Observation

/// What the person picked in the remove sheet.
struct RemoveChoice: Equatable, Sendable {
    var outcome: RemoveOutcome
    var wasteReason: WasteReason?
    /// Donated only (ruling #78): `.default` omits `recipient_id` (the server credits the claimer),
    /// `.none` sends `null` ("Someone not on BiteDown"), `.user(id)` names a reachable person.
    var recipient: RecipientChoice = .default
}

/// Inline error banner (`fridge.remove.error`): a failed remove or undo was rolled back, or a
/// refresh failed while content is on screen.
struct FridgeBanner: Identifiable {
    let id = UUID()
    var message: String
    /// nil hides "Try again" (e.g. the 10-minute restore window has passed).
    var retry: (() -> Void)?
}

/// State for the Fridge tab: items per storage, grouped by food group, multi-select, and
/// optimistic removal (single or batch) with Undo and rollback. Views animate through
/// `withMotion`, so Reduce Motion is honoured.
///
/// Concurrency rules:
/// - Operations on one item id run one at a time, in the order they were issued (`enqueue`), so a
///   restore never overlaps the remove it undoes.
/// - A refresh that lands while a remove/restore is in flight (or settled after the refresh began)
///   is reconciled against `reconcile`: removed ids stay out, restored ids are re-inserted once.
/// - `reconcile`, the op tails and the removal records are pruned as soon as they can no longer matter.
@MainActor
@Observable
final class FridgeModel {
    enum ScreenState {
        case loading
        case error(Error)
        case empty
        case content([ItemSection])
    }

    private struct Location {
        let storage: Storage
        let group: FoodGroup
        let index: Int
    }

    /// What a refresh must respect for one id until the server has caught up.
    private struct Reconcile {
        enum Kind { case removed, restored(Item, Location) }
        var kind: Kind
        /// The `loadSeq` when the last operation on the id finished; nil while one is in flight.
        /// Only a load that *started* after this can be trusted, and prunes the entry.
        var settledAfterLoad: Int?
    }

    /// Which items of one user action the server did not remove (shared by its items), so Undo can skip their restore.
    private final class RemovalRecord { var failedIds: Set<String> = [] }

    private struct Tail {
        let token: UUID
        let task: Task<Void, Never>
    }

    var storage: Storage = .fridge {
        // A selection never survives a segment change: the count and bar actions cover visible rows only.
        didSet { if storage != oldValue { selection = [] } }
    }
    var toast: UndoToastItem?
    /// The Undo toast for a removal made from the sheet, held until the sheet has dismissed so the
    /// full 5 s window is visible (`showPendingToast()`). The removal itself is not delayed.
    private var pendingToast: UndoToastItem?
    var banner: FridgeBanner?
    let stagger = StaggerController()
    /// DEBUG probe `debug.stagger.count`: staggers run on a storage's first load only.
    private(set) var staggerRestarts = 0

    // Multi-select (FridgeSelect).
    private(set) var isSelecting = false
    private(set) var selection: Set<String> = []

    private(set) var sections: [Storage: [ItemSection]] = [:]
    private var errors: [Storage: Error] = [:]
    private var everLoaded: Set<Storage> = []
    private var reconcile: [String: Reconcile] = [:]
    private var tails: [String: Tail] = [:]
    private var loadSeq = 0
    private var activeLoads = 0
    /// Bumped when the signed-in user changes (or signs out). Every load, remove, restore and queued
    /// operation captures it at the start and drops its result if it moved, so a late completion
    /// from the previous identity can't touch the new user's lists.
    private(set) var generation = 0
    private let api: APIClient

    init(api: APIClient) { self.api = api }

    func state(for storage: Storage) -> ScreenState {
        if let secs = sections[storage] { return secs.isEmpty ? .empty : .content(secs) }
        if let e = errors[storage] { return .error(e) }
        return .loading
    }

    // MARK: Loading

    /// Loads `storage` if it has never loaded (first appearance of that segment).
    func loadIfNeeded(_ storage: Storage) async {
        guard sections[storage] == nil, errors[storage] == nil else { return }
        await load(storage, isRefresh: false)
    }

    /// Retry from the error state: back to the skeleton, then load.
    func retry(_ storage: Storage) async {
        errors[storage] = nil
        await load(storage, isRefresh: false)
    }

    func refresh() async { await load(storage, isRefresh: true) }

    /// The session changed (sign-in, sign-out, 401, different user, token refresh).
    /// - A different user, or none: everything per-user is dropped (lists, errors, selection, queued
    ///   operations, toast, banner). Signed out shows `.unauthorized` on every storage; a new user
    ///   loads the visible storage (one stagger restart). The other storages load when selected.
    /// - The same user with a new token: items stay, errors clear, and the visible storage loads only
    ///   if it isn't already showing items.
    func sessionChanged(fromSession old: AuthSession?, toSession new: AuthSession?) async {
        if let old, let new, old.user.id == new.user.id, old.token == new.token { return }
        await sessionChanged(from: old?.user, to: new?.user)
    }

    /// Same as above by user: the same user means the token changed (token refresh).
    func sessionChanged(from old: User?, to new: User?) async {
        if let old, let new, old.id == new.id {
            errors = [:]
            await loadIfNeeded(storage)
            return
        }
        guard old != nil || new != nil else { return }
        generation += 1
        sections = [:]
        errors = [:]
        everLoaded = []
        isSelecting = false
        selection = []
        // In-flight operations of the previous user are NOT cancelled (that would abort their request
        // and lose the change); the generation guards drop their results. Forgetting the tails keeps new
        // operations from queueing behind them.
        tails = [:]
        reconcile = [:]
        pendingToast = nil
        toast = nil
        banner = nil
        guard new != nil else {
            for s in Storage.allCases { errors[s] = APIError.unauthorized }
            return
        }
        await load(storage, isRefresh: false)
    }

    private func load(_ storage: Storage, isRefresh: Bool) async {
        let gen = generation
        loadSeq += 1
        let seq = loadSeq
        activeLoads += 1
        defer { activeLoads -= 1 }
        do {
            let listing = try await api.listItems(storage: storage, groupBy: .foodGroup)
            guard gen == generation else { return }
            var fresh = Self.grouped(listing)
            applyReconcile(to: &fresh, storage: storage)
            pruneReconcile(upTo: seq)
            let isFirst = !everLoaded.contains(storage)
            everLoaded.insert(storage)
            // Stagger only on a storage's first load, never on refresh. Restart before the rows exist.
            if isFirst && !fresh.isEmpty {
                stagger.restart()
                staggerRestarts += 1
            }
            sections[storage] = fresh
            errors[storage] = nil
            selection = selection.filter { item(id: $0) != nil }
        } catch is CancellationError {
            return
        } catch {
            if (error as? URLError)?.code == .cancelled { return }
            guard gen == generation else { return }
            if sections[storage] == nil {
                errors[storage] = error
            } else if isRefresh {
                banner = FridgeBanner(message: "Couldn't refresh. \(error.localizedDescription)") { [weak self] in
                    guard let self else { return }
                    Task { await self.refresh() }
                }
            }
        }
    }

    /// Removed ids stay out (the listing may predate the server accepting the remove); restored ids
    /// that the listing predates are put back exactly once.
    private func applyReconcile(to fresh: inout [ItemSection], storage: Storage) {
        for (id, entry) in reconcile {
            switch entry.kind {
            case .removed:
                for i in fresh.indices { fresh[i].items.removeAll { $0.id == id } }
                fresh.removeAll { $0.items.isEmpty }
            case .restored(let item, let location):
                guard location.storage == storage,
                      !fresh.contains(where: { $0.items.contains { $0.id == id } }) else { continue }
                fresh.insertItem(item, group: location.group, index: location.index)
            }
        }
    }

    /// Drops entries whose operation finished before the load numbered `seq` started.
    private func pruneReconcile(upTo seq: Int) {
        for (id, entry) in reconcile {
            if let settled = entry.settledAfterLoad, seq > settled { reconcile[id] = nil }
        }
    }

    private static func grouped(_ listing: ItemListing) -> [ItemSection] {
        switch listing {
        case .grouped(let sections): return sections.filter { !$0.items.isEmpty }
        case .flat(let items):
            return FoodGroup.allCases.compactMap { g in
                let inGroup = items.filter { $0.foodGroup == g }
                return inGroup.isEmpty ? nil : ItemSection(foodGroup: g, items: inGroup)
            }
        }
    }

    // MARK: Per-item operation queue

    /// Runs `work` after every earlier operation on any of `ids` has finished.
    private func enqueue(_ ids: [String], _ work: @escaping @MainActor () async -> Void) {
        let prior = ids.compactMap { tails[$0]?.task }
        let token = UUID()
        let gen = generation
        let task = Task { @MainActor [weak self] in
            for p in prior { await p.value }
            guard self?.generation == gen else { return }   // the session changed while queued
            await work()
            self?.operationFinished(ids, token: token)
        }
        let tail = Tail(token: token, task: task)
        for id in ids { tails[id] = tail }
    }

    /// The last operation on an id is done: nothing queued behind it, so the tracking can go.
    private func operationFinished(_ ids: [String], token: UUID) {
        for id in ids where tails[id]?.token == token {
            tails[id] = nil
            guard var entry = reconcile[id] else { continue }
            if activeLoads == 0 {
                reconcile[id] = nil     // no refresh in flight, so none can be stale
            } else {
                entry.settledAfterLoad = loadSeq
                reconcile[id] = entry
            }
        }
    }

    // MARK: Removal

    /// Optimistic removal from the sheet: the row goes now, the toast offers Undo for 5 s, and the
    /// request runs in the background. A failure puts the row back and shows the banner.
    /// `showToastNow` is for a removal made without a sheet (the banner's "Try again"): the Undo toast
    /// shows at once instead of waiting for a sheet dismissal that never comes, and nothing stays pending.
    func remove(_ item: Item, choice: RemoveChoice, reduceMotion: Bool, showToastNow: Bool = false) {
        if showToastNow { pendingToast = nil }
        perform([item], message: "\(item.name) removed", holdToast: !showToastNow,
                failure: { _ in "Couldn't remove \(item.name). It's back in your list." }, reduceMotion: reduceMotion,
                retry: { [weak self] in
                    guard let self, let current = self.item(id: item.id) else { return }
                    self.remove(current, choice: choice, reduceMotion: reduceMotion, showToastNow: true)
                },
                remote: { api in
                    _ = try await api.removeItem(id: item.id, outcome: choice.outcome,
                                                 wasteReason: choice.wasteReason, recipient: choice.recipient)
                })
    }

    /// Batch removal (`used` or `donated`). "Shared them" never names a recipient: the server credits
    /// each listing's claimer, or nobody.
    func removeBatch(_ items: [Item], outcome: RemoveOutcome, reduceMotion: Bool) {
        let n = items.count
        let noun = n == 1 ? "1 item" : "\(n) items"
        let message = outcome == .used ? "\(noun) marked used" : (n == 1 ? "1 item shared" : "\(n) items shared")
        let ids = items.map(\.id)
        perform(items, message: message, holdToast: false,
                failure: { k in k == 1 ? "Couldn't update that item. It's back in your list."
                                       : "Couldn't update \(k) items. They're back in your list." },
                isBatch: true, reduceMotion: reduceMotion,
                retry: { [weak self] in
                    guard let self else { return }
                    let current = ids.compactMap { self.item(id: $0) }
                    guard !current.isEmpty else { return }
                    self.removeBatch(current, outcome: outcome, reduceMotion: reduceMotion)
                },
                remote: { api in
                    _ = try await api.removeBatch(ids: ids, outcome: outcome, recipient: .default)
                })
    }

    /// Removes the selected items as one batch and leaves select mode.
    func removeSelected(outcome: RemoveOutcome, reduceMotion: Bool) {
        let items = selectedItems
        guard !items.isEmpty else { return }
        exitSelection()
        removeBatch(items, outcome: outcome, reduceMotion: reduceMotion)
    }

    /// `failure` gets the number of items that came back. A batch whose request fails with 409
    /// `already_removed` is settled against the server's listing (`settleBatch`): remove-batch is atomic,
    /// so a 409 means that request removed nothing. A body we can't read after a 2xx did commit.
    private func perform(_ items: [Item], message: String, holdToast: Bool, failure: @escaping (Int) -> String,
                         isBatch: Bool = false, reduceMotion: Bool,
                         retry: @escaping () -> Void, remote: @escaping @Sendable (APIClient) async throws -> Void) {
        let located = items.compactMap { item in location(of: item.id).map { (item: item, location: $0) } }
        guard !located.isEmpty else { return }
        let ids = located.map(\.item.id)
        banner = nil
        for id in ids { reconcile[id] = Reconcile(kind: .removed, settledAfterLoad: nil) }
        withMotion(Theme.Motion.standard, reduceMotion: reduceMotion) { for id in ids { delete(id) } }
        let record = RemovalRecord()
        let toastItem = UndoToastItem(message: message, itemIds: Set(ids)) { [weak self] in
            self?.undo(located, record: record, failureName: located.count == 1 ? located[0].item.name : nil,
                       reduceMotion: reduceMotion)
        }
        if holdToast { pendingToast = toastItem } else { toast = toastItem }
        let api = self.api
        let gen = generation
        enqueue(ids) { [weak self] in
            do {
                try await remote(api)
            } catch {
                guard let self, self.generation == gen else { return }
                // A 2xx whose body we couldn't read did commit (remove-batch is atomic), so the removal
                // stands and Undo still restores. A single remove's 409 `already_removed` stands too.
                if error.isDecodingFailure || (!isBatch && error.isAlreadyRemoved) { return }
                if isBatch && error.isAlreadyRemoved {
                    await self.settleBatch(located, gen: gen, record: record, failure: failure, retry: retry,
                                           reduceMotion: reduceMotion)
                    return
                }
                self.markFailed(located, record: record, failure: failure, retry: retry, reduceMotion: reduceMotion)
            }
        }
    }

    private func markFailed(_ located: [(item: Item, location: Location)], record: RemovalRecord,
                            failure: (Int) -> String, retry: @escaping () -> Void, reduceMotion: Bool) {
        record.failedIds.formUnion(located.map(\.item.id))
        removeFailed(located, failure: failure(located.count), retry: retry, reduceMotion: reduceMotion)
    }

    /// A batch got 409 `already_removed`. remove-batch is atomic, so this request removed nothing: its
    /// Undo toast goes and every id is marked failed, so Undo can never restore them. Items the server
    /// still lists come back with the banner (retry covers those only; no banner if Undo already put them
    /// back). Items it no longer lists were removed elsewhere and end hidden, even if Undo had already
    /// re-inserted them. If the server can't be asked, nothing is assumed: every item comes back.
    private func settleBatch(_ located: [(item: Item, location: Location)], gen: Int, record: RemovalRecord,
                             failure: (Int) -> String, retry: @escaping () -> Void, reduceMotion: Bool) async {
        var active: Set<String> = []
        do {
            for storage in Set(located.map(\.location.storage)) {
                let listing = try await api.listItems(storage: storage, groupBy: .foodGroup)
                active.formUnion(Self.grouped(listing).flatMap(\.items).map(\.id))
            }
        } catch {
            guard generation == gen else { return }
            markFailed(located, record: record, failure: failure, retry: retry, reduceMotion: reduceMotion)
            return
        }
        guard generation == gen else { return }
        let all = Set(located.map(\.item.id))
        record.failedIds.formUnion(all)
        if let held = pendingToast, held.itemIds.isSubset(of: all) { pendingToast = nil }
        if let shown = toast, shown.itemIds.isSubset(of: all) { toast = nil }
        let gone = located.filter { !active.contains($0.item.id) }
        if !gone.isEmpty {
            withMotion(Theme.Motion.standard, reduceMotion: reduceMotion) {
                for (item, _) in gone {
                    // Undo already re-inserted it, but the server no longer has it active: hide it again.
                    if case .restored = reconcile[item.id]?.kind {
                        reconcile[item.id] = nil
                        delete(item.id)
                    }
                }
            }
        }
        let stillActive = located.filter { active.contains($0.item.id) }
        guard !stillActive.isEmpty else { return }
        markFailed(stillActive, record: record, failure: failure, retry: retry, reduceMotion: reduceMotion)
    }

    /// Called once the remove sheet has finished dismissing: the toast (and its countdown) starts now.
    func showPendingToast() {
        guard let pending = pendingToast else { return }
        pendingToast = nil
        toast = pending
    }

    private func removeFailed(_ located: [(item: Item, location: Location)], failure: String,
                              retry: @escaping () -> Void, reduceMotion: Bool) {
        let ids = Set(located.map(\.item.id))
        var undone = true
        withMotion(Theme.Motion.standard, reduceMotion: reduceMotion) {
            for (item, location) in located {
                if case .removed = reconcile[item.id]?.kind {
                    undone = false
                    reconcile[item.id] = nil
                    insert(item, at: location)
                }
            }
        }
        // A toast that still covers items the server did remove stays, so they can be undone.
        if let held = pendingToast, held.itemIds.isSubset(of: ids) { pendingToast = nil }
        if let shown = toast, shown.itemIds.isSubset(of: ids) { toast = nil }
        guard !undone else { return }   // already back via Undo; nothing to report
        Haptics.error()
        showBanner(failure, retry: retry)
    }

    /// Undo: the rows come back now; the restore runs after the removal settles. A failed restore
    /// removes the rows again and shows the banner.
    private func undo(_ located: [(item: Item, location: Location)], record: RemovalRecord,
                      failureName: String?, reduceMotion: Bool) {
        banner = nil
        let ids = located.map(\.item.id)
        withMotion(Theme.Motion.standard, reduceMotion: reduceMotion) {
            for (item, location) in located {
                reconcile[item.id] = Reconcile(kind: .restored(item, location), settledAfterLoad: nil)
                insert(item, at: location)
            }
        }
        let api = self.api
        let gen = generation
        enqueue(ids) { [weak self] in
            // Items whose removal never reached the server have nothing to restore.
            guard let self else { return }
            for id in record.failedIds { self.reconcile[id] = nil }
            let live = located.filter { !record.failedIds.contains($0.item.id) }
            guard !live.isEmpty else { return }
            let liveIds = live.map(\.item.id)
            do {
                let restored = liveIds.count == 1 ? [try await api.restoreItem(id: liveIds[0])]
                                                  : try await api.restoreBatch(ids: liveIds)
                guard self.generation == gen else { return }
                self.applyRestored(restored)
            } catch {
                guard self.generation == gen else { return }
                self.restoreFailed(live, record: record, failureName: failureName, error: error,
                                   reduceMotion: reduceMotion)
            }
        }
    }

    /// Swaps in the server's version of each restored item. Re-inserts one that a refresh dropped,
    /// unless the person has since removed it again.
    private func applyRestored(_ restored: [Item]) {
        for item in restored {
            guard case .restored(_, let location) = reconcile[item.id]?.kind else { continue }
            if let current = self.location(of: item.id), var secs = sections[current.storage],
               let si = secs.firstIndex(where: { $0.foodGroup == current.group }) {
                secs[si].items[current.index] = item
                sections[current.storage] = secs
            } else {
                insert(item, at: location)
            }
        }
    }

    private func restoreFailed(_ located: [(item: Item, location: Location)], record: RemovalRecord,
                               failureName: String?, error: Error, reduceMotion: Bool) {
        // 409 not_removed: the items are already active, so the restored rows are right. No banner.
        if (error as? APIError) == .notRemoved { return }
        var changed = false
        withMotion(Theme.Motion.standard, reduceMotion: reduceMotion) {
            for (item, _) in located {
                if case .restored = reconcile[item.id]?.kind {
                    changed = true
                    reconcile[item.id] = Reconcile(kind: .removed, settledAfterLoad: nil)
                    delete(item.id)
                }
            }
        }
        guard changed else { return }
        Haptics.error()
        let expired = (error as? APIError) == .restoreWindowExpired
        let subject = failureName ?? "These items"
        let verb = failureName == nil ? "stay" : "stays"
        let stillRemoved = failureName == nil ? "are still removed" : "is still removed"
        showBanner(expired ? "It's too late to undo. \(subject) \(verb) removed."
                           : "Couldn't undo. \(subject) \(stillRemoved).",
                   retry: expired ? nil : { [weak self] in
                       self?.undo(located, record: record, failureName: failureName, reduceMotion: reduceMotion)
                   })
    }

    private func showBanner(_ message: String, retry: (() -> Void)?) {
        banner = FridgeBanner(message: message, retry: retry)
        AccessibilityNotification.Announcement(message).post()
    }

    // MARK: Selection

    func enterSelection() {
        guard !isSelecting else { return }
        banner = nil
        selection = []
        isSelecting = true
    }

    func exitSelection() {
        isSelecting = false
        selection = []
    }

    func toggleSelection(_ id: String) {
        if selection.contains(id) { selection.remove(id) } else { selection.insert(id) }
    }

    /// The selected items on screen, in order.
    private var selectedItems: [Item] {
        (sections[storage] ?? []).flatMap(\.items).filter { selection.contains($0.id) }
    }

    // MARK: List editing

    private func item(id: String) -> Item? {
        sections.values.lazy.flatMap { $0 }.flatMap(\.items).first { $0.id == id }
    }

    private func location(of id: String) -> Location? {
        for (storage, secs) in sections {
            for s in secs {
                if let i = s.items.firstIndex(where: { $0.id == id }) {
                    return Location(storage: storage, group: s.foodGroup, index: i)
                }
            }
        }
        return nil
    }

    private func delete(_ id: String) {
        for (storage, secs) in sections {
            let updated = secs.compactMap { s -> ItemSection? in
                var s = s
                s.items.removeAll { $0.id == id }
                return s.items.isEmpty ? nil : s
            }
            if updated != secs { sections[storage] = updated }
        }
    }

    /// Idempotent: does nothing if the item is already listed.
    private func insert(_ item: Item, at location: Location) {
        guard self.item(id: item.id) == nil, var secs = sections[location.storage] else { return }
        secs.insertItem(item, group: location.group, index: location.index)
        sections[location.storage] = secs
    }
}

private extension Array where Element == ItemSection {
    /// Inserts into the item's food-group section (created in `FoodGroup` order if missing).
    mutating func insertItem(_ item: Item, group: FoodGroup, index: Int) {
        if let si = firstIndex(where: { $0.foodGroup == group }) {
            self[si].items.insert(item, at: Swift.min(index, self[si].items.count))
        } else {
            append(ItemSection(foodGroup: group, items: [item]))
            let order = FoodGroup.allCases
            sort { (order.firstIndex(of: $0.foodGroup) ?? 0) < (order.firstIndex(of: $1.foodGroup) ?? 0) }
        }
    }
}

/// Text shared by the Fridge row and the remove sheets.
enum ItemText {
    /// "1.4 lb", "5 oz", or just "8" for pieces.
    static func quantity(_ item: Item) -> String {
        let n = item.quantity.formatted(.number.precision(.fractionLength(0...1)))
        return item.unit == "piece" ? n : "\(n) \(item.unit)"
    }

    /// Row meta line: the quantity only. The badge is the row's one status (DESIGN_SYSTEM Principle 1).
    static func meta(_ item: Item) -> String { quantity(item) }

    /// Lower-case expiry phrase for running text, e.g. "expires tomorrow". Keyed on the badge kind.
    static func expiryPhrase(_ item: Item) -> String? {
        ExpiryBadgeModel.make(for: item)?.phrase
    }

    static func hasOpenListing(_ item: Item) -> Bool { item.share?.status == .open }

    /// "Veggies · 5 oz · expires tomorrow · on Share"
    static func sheetMeta(_ item: Item) -> String {
        var parts = [item.foodGroup.displayName, quantity(item)]
        if let e = expiryPhrase(item) { parts.append(e) }
        if hasOpenListing(item) { parts.append("on Share") }
        return parts.joined(separator: " · ")
    }
}

private extension Error {
    /// A 2xx whose body couldn't be decoded: the request succeeded on the server.
    var isDecodingFailure: Bool {
        if case .decoding = self as? APIError { return true }
        return false
    }

    /// 409 `already_removed`.
    var isAlreadyRemoved: Bool { (self as? APIError)?.code == "already_removed" }
}
