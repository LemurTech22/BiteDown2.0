import SwiftUI

/// Fridge tab (`Fridge` artboard, SCREENS #5): storage filter, items grouped by food group,
/// swipe → Remove, Undo toast, and the empty / loading / error states. Pull to refresh never
/// replays the stagger; it runs on each storage's first load only.
struct FridgeView: View {
    @Environment(AppEnvironment.self) private var env
    @MotionReduced private var reduceMotion
    @State private var model: FridgeModel
    @State private var removing: Item?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private let screen = AccessibilityID.Fridge.screen
    private let api: APIClient
    /// Opens the Add sheet (the empty state's "Add food").
    private let onAdd: () -> Void

    init(api: APIClient, onAdd: @escaping () -> Void = {}) {
        self.api = api
        self.onAdd = onAdd
        _model = State(initialValue: FridgeModel(api: api))
    }

    var body: some View {
        List {
            header
            content
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(Theme.Spacing.m)
        .scrollContentBackground(.hidden)
        .background(Theme.Colors.ground.ignoresSafeArea())
        .accessibilityIdentifier(AccessibilityID.Fridge.list)
        .refreshable { await model.refresh() }
        .safeAreaInset(edge: .top, spacing: 0) {
            if let banner = model.banner {
                FridgeBannerView(banner: banner) { model.banner = nil }
                    .padding(.vertical, Theme.Spacing.s)
                    .motionTransition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .motionAnimation(Theme.Motion.standard, value: model.banner?.id)
        .undoToast(item: $model.toast)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if model.isSelecting { selectBar }
        }
        .toolbar(model.isSelecting ? .hidden : .automatic, for: .tabBar)
        .motionAnimation(Theme.Motion.standard, value: model.isSelecting)
        .toolbar(.hidden, for: .navigationBar)
        .onAppear { model.showPendingToast() }  // a removal made from Item detail
        .task(id: model.storage) { await model.loadIfNeeded(model.storage) }
        // Sign-in, sign-out, a different user or a refreshed token: reset or reload. Not fired at launch.
        .onChange(of: env.auth.session) { old, new in
            Task { await model.sessionChanged(fromSession: old, toSession: new) }
        }
        .onReceive(NotificationCenter.default.publisher(for: .itemsDidChange)) { _ in Task { await model.refresh() } }
        // The Undo toast appears (and its countdown starts) only after the sheet has gone.
        .sheet(item: $removing, onDismiss: { model.showPendingToast() }) { item in
            RemoveSheet(item: item, loadPeople: { [api, id = item.id] in (try? await api.reachablePeople(itemId: id)) ?? [] }) { choice in
                model.remove(item, choice: choice, reduceMotion: reduceMotion)
            } close: {
                removing = nil
            }
        }
        .overlay(alignment: .topLeading) { probes }
    }

    // MARK: Header

    /// Title, Select and the storage filter scroll with the list (so AX5 text doesn't pin half the screen).
    private var header: some View {
        Section {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                titleRow
                StorageSegmentedControl(selection: $model.storage)
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: Theme.Spacing.s, leading: 0, bottom: 0, trailing: 0))
            .listRowSeparator(.hidden)
        }
    }

    private var titleRow: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: Theme.Spacing.xs))
            : AnyLayout(HStackLayout(spacing: Theme.Spacing.s))
        return layout {
            Text("Your food")
                .font(Theme.Fonts.screenTitle)
                .foregroundStyle(Theme.Colors.ink)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier(AccessibilityID.Fridge.title)
            if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: Theme.Spacing.s) }
            if model.isSelecting {
                Text(model.selection.count == 1 ? "1 selected" : "\(model.selection.count) selected")
                    .font(Theme.Fonts.rowTitle)
                    .foregroundStyle(Theme.Colors.muted)
                    .accessibilityAddTraits(.updatesFrequently)
                    .accessibilityIdentifier(AccessibilityID.Fridge.selectCount)
                headerButton("Done", id: AccessibilityID.Fridge.selectDone) { model.exitSelection() }
            } else if hasItems {
                headerButton("Select", id: AccessibilityID.Fridge.select) {
                    Haptics.selection()
                    model.enterSelection()
                }
            }
        }
    }

    private var hasItems: Bool {
        if case .content = model.state(for: model.storage) { return true }
        return false
    }

    private func headerButton(_ title: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(Theme.Fonts.button)
                .foregroundStyle(Theme.Colors.forest)
                .padding(.horizontal, Theme.Spacing.s)
                .frame(minWidth: Theme.Size.minTouch, minHeight: Theme.Size.minTouch)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }

    // MARK: Select bar

    /// FridgeSelect bottom bar: "Used them" / "Shared them" (batch). At AX sizes the buttons stack.
    private var selectBar: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(spacing: Theme.Spacing.s))
            : AnyLayout(HStackLayout(spacing: Theme.Spacing.s))
        let disabled = model.selection.isEmpty
        return layout {
            barButton("Used them", symbol: "checkmark", filled: true, id: AccessibilityID.Fridge.selectUsed) {
                Haptics.success()
                model.removeSelected(outcome: .used, reduceMotion: reduceMotion)
            }
            barButton("Shared them", symbol: "gift", filled: false, id: AccessibilityID.Fridge.selectShared) {
                Haptics.success()
                model.removeSelected(outcome: .donated, reduceMotion: reduceMotion)
            }
        }
        .disabled(disabled)
        .padding(Theme.Spacing.s)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: Theme.Size.selectBarCorner, style: .continuous))
        .padding(.horizontal, Theme.Spacing.sm + Theme.Spacing.xxs)
        .padding(.bottom, Theme.Spacing.s)
        .motionTransition(.move(edge: .bottom).combined(with: .opacity))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(model.selection.isEmpty ? "Actions" : "Actions for \(model.selection.count) selected")
        .accessibilityIdentifier(AccessibilityID.Fridge.selectBar)
    }

    private func barButton(_ title: String, symbol: String, filled: Bool, id: String,
                           action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(Theme.Fonts.button)
                .foregroundStyle(filled ? Theme.Colors.onForest : Theme.Colors.forest)
                .frame(maxWidth: .infinity, minHeight: Theme.Size.selectBarButton)
                .background(filled ? Theme.Colors.forest : Theme.Colors.surface,
                            in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
                .overlay {
                    if !filled {
                        RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                            .strokeBorder(Theme.Colors.border, lineWidth: Theme.Stroke.hairline)
                    }
                }
                .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }

    // MARK: Content

    @ViewBuilder private var content: some View {
        switch model.state(for: model.storage) {
        case .loading:
            stateRow { SkeletonList(screen: screen) }
        case .error(let error):
            stateRow {
                ErrorStateView(screen: screen, error: error) {
                    Task { await model.retry(model.storage) }
                }
            }
        case .empty:
            stateRow {
                EmptyStateView(screen: screen,
                               title: "Nothing in your \(model.storage.rawValue) yet",
                               message: "Snap a photo, scan a receipt or type what you bought.",
                               systemImage: model.storage == .freezer ? "snowflake" : "refrigerator",
                               actionTitle: "Add food", action: onAdd,
                               actionIdentifier: AccessibilityID.Fridge.emptyAdd)
            }
        case .content(let sections):
            ForEach(Array(sections.enumerated()), id: \.element.id) { sectionIndex, section in
                Section {
                    ForEach(section.items) { item in
                        row(item, staggerIndex: staggerIndex(sections, section: sectionIndex, item: item))
                    }
                } header: {
                    FridgeGroupHeader(section: section)
                        .staggeredAppearance(index: staggerIndex(sections, section: sectionIndex, item: nil),
                                             controller: model.stagger)
                }
            }
        }
    }

    @ViewBuilder private func row(_ item: Item, staggerIndex: Int) -> some View {
        let selected: Bool? = model.isSelecting ? model.selection.contains(item.id) : nil
        let base = FridgeItemRow(item: item, selected: selected,
                                 onToggle: { Haptics.selection(); model.toggleSelection(item.id) },
                                 onRemove: { presentRemove(item) })
            .staggeredAppearance(index: staggerIndex, controller: model.stagger)
            .listRowBackground(selected == true ? Theme.Colors.limeTint : Theme.Colors.surface)
            .listRowSeparatorTint(Theme.Colors.hairline)
        if model.isSelecting {
            base.listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: Theme.Spacing.m))
        } else {
            base
                .background(
                    NavigationLink {
                        ItemDetailView(item: item, onChange: { _ in Task { await model.refresh() } },
                                       onRemove: { item, choice in model.remove(item, choice: choice, reduceMotion: reduceMotion) })
                    } label: { EmptyView() }
                    .opacity(0)
                )
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                Button {
                    presentRemove(item)
                } label: {
                    Label("Remove", systemImage: "tray.and.arrow.up")
                }
                .tint(Theme.Colors.forest)
                .accessibilityIdentifier(AccessibilityID.Fridge.rowRemove(item.id))
            }
        }
    }

    /// Cross-fades between states; a single full-width row with no card behind it.
    private func stateRow<V: View>(@ViewBuilder _ view: () -> V) -> some View {
        Section {
            view()
                .motionTransition(.opacity)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
                .listRowSeparator(.hidden)
        }
    }

    /// Position in reading order (headers and rows together), so the first screenful staggers
    /// top to bottom. Items past the cap share the last delay (`Theme.Motion.staggerDelay`).
    private func staggerIndex(_ sections: [ItemSection], section: Int, item: Item?) -> Int {
        var index = 0
        for s in sections.prefix(section) { index += 1 + s.items.count }
        guard let item else { return index }
        return index + 1 + (sections[section].items.firstIndex(of: item) ?? 0)
    }

    private func presentRemove(_ item: Item) {
        removing = item
    }

    // MARK: DEBUG probes

    @ViewBuilder private var probes: some View {
        #if DEBUG
        if env.launch.useMockAPI {
            VStack(spacing: 0) {
                DebugProbe(id: AccessibilityID.Probe.staggerCount, value: "\(model.staggerRestarts)")
                if let recorder = env.hapticsRecorder {
                    DebugProbe(id: AccessibilityID.Probe.haptics, value: recorder.joined)
                }
            }
        }
        #endif
    }
}
