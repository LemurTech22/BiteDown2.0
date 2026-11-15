import SwiftUI

enum SocialRoute: Hashable {
    case pantry, mine, claimed(PantryListing)
}

/// Social tab entry (`Social` artboard): header with the Connect button, the Food Pantry widget and the
/// requests board. Connect itself is built elsewhere; `onOpenConnect` is wired by the owner of that screen.
struct SocialView: View {
    @Environment(AppEnvironment.self) private var env
    var onOpenConnect: () -> Void = {}

    var body: some View {
        SocialBoardView(api: env.api, onOpenConnect: onOpenConnect)
    }
}

struct SocialBoardView: View {
    @State private var model: SocialModel
    @State private var offering: HelpRequest?
    @State private var composing = false
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @MotionReduced private var reduceMotion
    let api: APIClient
    let onOpenConnect: () -> Void

    init(api: APIClient, onOpenConnect: @escaping () -> Void) {
        self.api = api
        self.onOpenConnect = onOpenConnect
        _model = State(initialValue: SocialModel(api: api))
    }

    private var compact: Bool { dynamicTypeSize.isAccessibilitySize }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Spacing.sheetSection) {
                    header
                    if let banner = model.banner {
                        BannerView(style: .error, message: banner, retry: { Task { await model.refresh() } },
                                   dismiss: { model.banner = nil },
                                   identifiers: .init(container: AccessibilityID.Social.banner), horizontalInset: 0)
                    }
                    PantryWidget(state: model.pantry)
                    requestsHeader
                    board
                }
                .padding(.horizontal, Theme.Spacing.gutter)
                .padding(.bottom, Theme.Spacing.l)
            }
            .background(Theme.Colors.ground.ignoresSafeArea())
            .refreshable { await model.refresh() }
            .toolbar(.hidden, for: .navigationBar)
            .accessibilityIdentifier(AccessibilityID.Social.screen)
            .navigationDestination(for: SocialRoute.self) { route in
                switch route {
                case .pantry: FoodPantryView(model: model)
                case .mine: MyRequestsView(model: model)
                case .claimed(let l): ClaimedItemView(listing: l)
                }
            }
        }
        .task { await model.loadIfNeeded() }
        .sheet(item: $offering) { request in
            FulfilConfirmSheet(request: request) {
                try await model.fulfil(request, reduceMotion: reduceMotion)
            }
            .presentationDetents([.medium, .large])
            .presentationCornerRadius(Theme.Radius.sheet)
        }
        .sheet(isPresented: $composing) {
            RequestComposerView(api: api) { text, selection, groups in
                try await model.post(text: text, selection: selection, groups: groups)
            }
            .presentationCornerRadius(Theme.Radius.sheet)
        }
    }

    // MARK: Header

    private var header: some View {
        HStack {
            Text("Social")
                .font(Theme.Fonts.screenTitle)
                .foregroundStyle(Theme.Colors.ink)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier(AccessibilityID.Social.title)
            Spacer()
            Button(action: onOpenConnect) {
                Image(systemName: "person.badge.plus")
                    .font(Theme.Fonts.cardHeading)
                    .foregroundStyle(Theme.Colors.lime)
                    .frame(width: Theme.Size.minTouch, height: Theme.Size.minTouch)
                    .background(Theme.Colors.forestChip, in: Circle())
                    .contentShape(Circle())
            }
            .accessibilityLabel("Add friends or groups")
            .accessibilityIdentifier(AccessibilityID.Social.connect)
        }
        .padding(.top, Theme.Spacing.s)
    }

    private var requestsHeader: some View {
        HStack(spacing: Theme.Spacing.xs) {
            Text("Requests")
                .font(Theme.Fonts.section)
                .foregroundStyle(Theme.Colors.ink)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier(AccessibilityID.Social.requestsTitle)
            Spacer()
            NavigationLink(value: SocialRoute.mine) {
                Text("Yours")
                    .font(Theme.Fonts.rowTitle)
                    .foregroundStyle(Theme.Colors.forest)
                    .padding(.horizontal, Theme.Spacing.s)
                    .frame(minHeight: Theme.Size.minTouch)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("Your requests")
            .accessibilityIdentifier(AccessibilityID.Social.yours)
            Button { composing = true } label: {
                Image(systemName: "plus")
                    .font(Theme.Fonts.badge)
                    .foregroundStyle(Theme.Colors.lime)
                    .frame(width: Theme.Size.addGlyphCircle, height: Theme.Size.addGlyphCircle)
                    .background(Theme.Colors.forestChip, in: Circle())
                    .frame(width: Theme.Size.minTouch, height: Theme.Size.minTouch)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("Ask for something")
            .accessibilityIdentifier(AccessibilityID.Social.ask)
        }
    }

    // MARK: Board

    @ViewBuilder private var board: some View {
        switch model.requests {
        case .loading:
            noteGrid { ForEach(0..<4, id: \.self) { _ in NoteSkeleton() } }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Loading")
                .accessibilityIdentifier(AccessibilityID.State.loading("social"))
        case .failed(let error):
            ErrorStateView(screen: "social", error: error) { Task { await model.loadRequests() } }
        case .loaded(let list) where list.isEmpty:
            EmptyStateView(screen: "social", title: "No requests right now",
                           message: "Ask your friends and groups for an egg, a lemon, or anything else you're short on.",
                           systemImage: "note.text", actionTitle: "Ask for something") { composing = true }
        case .loaded(let list):
            noteGrid {
                ForEach(Array(list.enumerated()), id: \.element.id) { index, request in
                    RequestNoteCard(request: request, index: index, tilted: !compact) { offering = request }
                        .transition(.opacity)
                }
            }
            .accessibilityIdentifier(AccessibilityID.Social.board)
        }
    }

    private func noteGrid<C: View>(@ViewBuilder _ content: () -> C) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: Theme.Spacing.sm, alignment: .top),
                                 count: compact ? 1 : 2),
                  spacing: Theme.Spacing.sm) { content() }
    }
}

// MARK: - Pantry widget

private struct PantryWidget: View {
    let state: Load<[PantryListing]>
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var open: [PantryListing] { (state.value ?? []).filter { !$0.claimedByMe } }

    var body: some View {
        NavigationLink(value: SocialRoute.pantry) {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                HStack {
                    VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                        Text("Shared food").font(Theme.Fonts.section).foregroundStyle(Theme.Colors.ink)
                        Text(subtitle).font(Theme.Fonts.sheetMeta).foregroundStyle(Theme.Colors.inkSecondary)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").font(Theme.Fonts.rowTitle).foregroundStyle(Theme.Colors.forest)
                }
                tiles
            }
            .padding(Theme.Spacing.m)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.Colors.lime, in: RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier(AccessibilityID.Social.pantryWidget)
    }

    private var subtitle: String {
        switch state {
        case .loading: "Looking for shared food"
        case .failed: "Couldn't load right now"
        case .loaded: open.isEmpty ? "Nothing shared yet" : "Shared by friends and groups"
        }
    }

    private var label: String {
        switch state {
        case .loaded where !open.isEmpty:
            "Shared food, \(open.count) \(open.count == 1 ? "item" : "items") shared by friends and groups"
        default: "Shared food, \(subtitle)"
        }
    }

    @ViewBuilder private var tiles: some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: Theme.Spacing.s), count: dynamicTypeSize.isAccessibilitySize ? 2 : 4)
        switch state {
        case .loading:
            LazyVGrid(columns: columns, spacing: Theme.Spacing.s) {
                ForEach(0..<4, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                        .fill(Theme.Colors.surface.opacity(0.6)).frame(height: Theme.Size.pantryTilePlaceholder).shimmering()
                }
            }
        case .failed: EmptyView()
        case .loaded:
            if !open.isEmpty {
                let shown = open.count > 4 ? Array(open.prefix(3)) : open
                LazyVGrid(columns: columns, spacing: Theme.Spacing.s) {
                    ForEach(shown) { l in
                        VStack(spacing: Theme.Spacing.stack) {
                            FoodGroupIcon(group: l.item.category.foodGroup, tile: Theme.Size.pantryTile)
                            Text(l.item.name).font(Theme.Fonts.badge).foregroundStyle(Theme.Colors.ink)
                                .lineLimit(1)
                        }
                        .padding(.vertical, Theme.Spacing.s).padding(.horizontal, Theme.Spacing.xs)
                        .frame(maxWidth: .infinity)
                        .background(Theme.Colors.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
                    }
                    if open.count > shown.count {
                        VStack(spacing: Theme.Spacing.xxs) {
                            Text("+\(open.count - shown.count)").font(Theme.Fonts.section).foregroundStyle(Theme.Colors.forest)
                            Text("more").font(Theme.Fonts.badge).foregroundStyle(Theme.Colors.forest)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Theme.Colors.ground, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
                    }
                }
            }
        }
    }
}

private struct NoteSkeleton: View {
    var body: some View {
        RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
            .fill(Theme.Colors.limeTint)
            .frame(height: Theme.Size.noteMin)
            .shimmering()
    }
}
