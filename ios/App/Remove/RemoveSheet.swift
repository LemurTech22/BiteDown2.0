import SwiftUI

/// Remove: outcome (`RemoveSheet` artboard, SCREENS #7). Three tiles, no captions.
/// - *Used it*: one tap. The caller removes the row and calls the API, the checkmark shows with a
///   `.success` haptic, then the sheet dismisses.
/// - *Shared it*: shows as selected and reveals a **Given to** menu, then **Done** removes it.
///   The menu lists the listing's claimer first (`.default`: no `recipient_id`), then the other
///   reachable people (`.user`), then "Someone not on BiteDown" (`.none`: `null`), ruling #78.
/// - *Threw it away*: pushes natively to the reason step.
struct RemoveSheet: View {
    let item: Item
    /// `GET /people/reachable`. A failure should return `[]`: the menu still offers its two defaults.
    let loadPeople: () async -> [Person]
    let onRemove: (RemoveChoice) -> Void
    let close: () -> Void

    @State private var chosen: RemoveOutcome?
    @State private var finished = false
    @State private var showReason = false
    @State private var people: [Person] = []
    /// The person's explicit pick in the Given-to menu; nil until they choose (ruling #78: the
    /// untouched state encodes `.default`, so the key is omitted).
    @State private var picked: RecipientChoice?
    @State private var closeTask: Task<Void, Never>?
    @State private var contentHeight: CGFloat = Theme.Size.removeSheetEstimate
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    init(item: Item, loadPeople: @escaping () async -> [Person] = { [] },
         onRemove: @escaping (RemoveChoice) -> Void, close: @escaping () -> Void) {
        self.item = item
        self.loadPeople = loadPeople
        self.onRemove = onRemove
        self.close = close
    }

    private var hasListing: Bool { ItemText.hasOpenListing(item) }

    // MARK: Recipient options

    private struct Option: Identifiable {
        let choice: RecipientChoice
        let name: String
        var id: RecipientChoice { choice }
    }

    private var options: RecipientOptions { RecipientOptions(item: item, people: people, picked: picked) }
    private var recipient: RecipientChoice { options.resolved }
    private var pickBinding: Binding<RecipientChoice> {
        Binding(get: { options.displayed }, set: { picked = $0 })
    }
    private var personOptions: [RecipientOptions.Option] { options.people }
    private var nobody: RecipientOptions.Option { options.nobody }
    private var selectedName: String { options.displayedName }

    // MARK: Body

    var body: some View {
        NavigationStack {
            ScrollView {
                content
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
            }
            .scrollBounceBehavior(.basedOnSize)
            .background(Theme.Colors.ground)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(isPresented: $showReason) {
                RemoveReasonView(item: item) { reason in
                    finished = true
                    onRemove(RemoveChoice(outcome: .thrownOut, wasteReason: reason))
                } close: { close() }
            }
        }
        .presentationDetents([.height(contentHeight), .large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(Theme.Radius.sheet)
        .presentationBackground(Theme.Colors.ground)
        .accessibilityIdentifier(AccessibilityID.Remove.sheet)
        .task { people = await loadPeople() }
        .onDisappear { closeTask?.cancel() }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sheetSection) {
            header
            VStack(spacing: Theme.Spacing.tileGap) {
                RemoveOutcomeTile(outcome: .used, isChosen: chosen == .used) {
                    finish(RemoveChoice(outcome: .used))
                }
                RemoveOutcomeTile(outcome: .donated, isChosen: chosen == .donated) {
                    guard !finished else { return }
                    Haptics.selection()
                    withMotion(Theme.Motion.standard, reduceMotion: reduceMotion) { chosen = .donated }
                }
                RemoveOutcomeTile(outcome: .thrownOut, isChosen: false, leadsOn: true) {
                    guard !finished else { return }
                    Haptics.selection()
                    showReason = true
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("What happened to it?")
            if chosen == .donated {
                givenTo
                    .motionTransition(.opacity.combined(with: .move(edge: .top)))
                HStack(spacing: Theme.Spacing.tileGap) {
                    cancelButton
                    doneButton
                }
            } else {
                cancelButton
            }
        }
        .padding(.horizontal, Theme.Spacing.gutter)
        .padding(.top, Theme.Spacing.l)
        .padding(.bottom, Theme.Spacing.s)
    }

    @MotionReduced private var reduceMotion

    // MARK: Header

    private var header: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: Theme.Spacing.s))
            : AnyLayout(HStackLayout(spacing: Theme.Spacing.sm))
        let badge = ExpiryBadgeModel.make(for: item)
        return layout {
            FoodGroupIcon(group: item.foodGroup, tile: Theme.Size.sheetHeaderTile)
                .overlay(alignment: .bottomTrailing) {
                    if hasListing { listingBadge }
                }
            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                Text(item.name)
                    .font(Theme.Fonts.sheetTitle)
                    .foregroundStyle(Theme.Colors.ink)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier(AccessibilityID.Remove.title)
                Text(ItemText.quantity(item))
                    .font(Theme.Fonts.sheetMeta)
                    .foregroundStyle(Theme.Colors.muted)
            }
            .frame(maxWidth: dynamicTypeSize.isAccessibilitySize ? nil : .infinity, alignment: .leading)
            if let badge {
                ExpiryBadge(model: badge)
                    .accessibilityIdentifier(AccessibilityID.Remove.badge)
            }
        }
    }

    /// The item is on the Food Pantry: a small people badge on the icon tile (artboard).
    private var listingBadge: some View {
        Circle()
            .fill(Theme.Colors.forest)
            .overlay { Circle().strokeBorder(Theme.Colors.ground, lineWidth: Theme.Stroke.selected) }
            .frame(width: Theme.Size.listingBadge, height: Theme.Size.listingBadge)
            .overlay {
                Image(systemName: "person.2.fill")
                    .resizable().scaledToFit()
                    .padding(Theme.Spacing.xs + Theme.Spacing.xxs)
                    .foregroundStyle(Theme.Colors.onForest)
            }
            .offset(x: Theme.Spacing.xs, y: Theme.Spacing.xs)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("On your Food Pantry")
            .accessibilityIdentifier(AccessibilityID.Remove.listingBadge)
    }

    // MARK: Given to

    private var givenTo: some View {
        let stacked = dynamicTypeSize.isAccessibilitySize
        let layout = stacked
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: Theme.Spacing.xs))
            : AnyLayout(HStackLayout(spacing: Theme.Spacing.sm))
        return layout {
            Text("Given to")
                .font(Theme.Fonts.body)
                .foregroundStyle(Theme.Colors.ink)
            if !stacked { Spacer(minLength: Theme.Spacing.s) }
            Menu {
                if !personOptions.isEmpty {
                    Section {
                        Picker("Given to", selection: pickBinding) {
                            ForEach(personOptions) { Text($0.name).tag($0.choice) }
                        }
                        .pickerStyle(.inline)
                    }
                }
                Section {
                    Picker("Given to", selection: pickBinding) {
                        Text(nobody.name).tag(nobody.choice)
                    }
                    .pickerStyle(.inline)
                }
            } label: {
                HStack(spacing: Theme.Spacing.xs + Theme.Spacing.xxs) {
                    Text(selectedName)
                        .font(Theme.Fonts.rowTitle)
                        .lineLimit(stacked ? nil : 1)
                        .multilineTextAlignment(.leading)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(Theme.Fonts.meta.weight(.semibold))
                        .accessibilityHidden(true)
                }
                .foregroundStyle(Theme.Colors.forest)
                .padding(.horizontal, Theme.Spacing.s + Theme.Spacing.xxs)
                .frame(minWidth: Theme.Size.minTouch, minHeight: Theme.Size.minTouch)
                .contentShape(Rectangle())
            }
            .accessibilityLabel("Given to")
            .accessibilityValue(selectedName)
            .accessibilityIdentifier(AccessibilityID.Remove.givenMenu)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.leading, Theme.Spacing.m)
        .padding(.trailing, Theme.Spacing.xs)
        .frame(minHeight: Theme.Size.minTouch + Theme.Spacing.s)
        .background(Theme.Colors.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .strokeBorder(Theme.Colors.border, lineWidth: Theme.Stroke.hairline)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AccessibilityID.Remove.given)
    }

    // MARK: Buttons

    private var cancelButton: some View {
        Button {
            close()
        } label: {
            Text("Cancel")
                .font(Theme.Fonts.rowTitle)
                .foregroundStyle(Theme.Colors.forest)
                .frame(maxWidth: .infinity, minHeight: Theme.Size.sheetTextButton)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(AccessibilityID.Remove.cancel)
    }

    private var doneButton: some View {
        Button {
            finish(RemoveChoice(outcome: .donated, recipient: recipient))
        } label: {
            Text("Done")
                .font(Theme.Fonts.rowTitle)
                .foregroundStyle(Theme.Colors.onForest)
                .frame(maxWidth: .infinity, minHeight: Theme.Size.sheetTextButton)
                .background(Theme.Colors.forest, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
                .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(AccessibilityID.Remove.done)
    }

    /// The removal happens now; the sheet waits only long enough for the checkmark to land
    /// (`Theme.Motion.confirmHold`).
    private func finish(_ choice: RemoveChoice) {
        guard !finished else { return }
        finished = true
        chosen = choice.outcome
        Haptics.success()
        onRemove(choice)
        // Cancelled if the sheet goes away first, so it can't close a newer sheet.
        closeTask = Task {
            try? await Task.sleep(for: Theme.Motion.confirmHold)
            guard !Task.isCancelled else { return }
            close()
        }
    }
}

/// The Given-to choices for one item (ruling #78). The untouched state is `.default` (no
/// `recipient_id`); `.none` ("Someone not on BiteDown", sent as `null`) and `.user(id)` only after
/// an explicit pick. The claimer comes from the listing or from `is_claimer` on the loaded people.
struct RecipientOptions {
    struct Option: Identifiable {
        let choice: RecipientChoice
        let name: String
        var id: RecipientChoice { choice }
    }

    let item: Item
    let reachable: [Person]
    let picked: RecipientChoice?

    init(item: Item, people: [Person], picked: RecipientChoice? = nil) {
        self.item = item
        self.reachable = people
        self.picked = picked
    }

    var claimerId: String? {
        guard ItemText.hasOpenListing(item) else { return nil }
        return item.share?.claimedBy?.id ?? reachable.first(where: { $0.isClaimer == true })?.id
    }

    /// What `RemoveChoice.recipient` gets: the pick, else `.default`.
    var resolved: RecipientChoice { picked ?? .default }

    /// The menu's checked entry: the pick, else the claimer, else "Someone not on BiteDown" (which
    /// still resolves to `.default` until picked).
    var displayed: RecipientChoice { picked ?? (claimerId != nil ? .default : .none) }

    /// Claimer first (`.default`), then everyone else (`.user`).
    var people: [Option] {
        var out: [Option] = []
        if let claimerId {
            let name = reachable.first(where: { $0.id == claimerId })?.displayName ?? item.share?.claimedBy?.name ?? "Claimer"
            out.append(Option(choice: .default, name: name))
        }
        out += reachable.filter { $0.id != claimerId }.map { Option(choice: .user($0.id), name: $0.displayName) }
        return out
    }
    let nobody = Option(choice: .none, name: "Someone not on BiteDown")

    var displayedName: String { (people + [nobody]).first { $0.choice == displayed }?.name ?? nobody.name }
}
