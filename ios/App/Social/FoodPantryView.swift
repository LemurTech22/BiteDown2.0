import SwiftUI

/// `FoodPantry`: other people's open listings (`GET /share`), filter All / Friends / Groups, Claim, and
/// "Claimed ›" for ones you already claimed.
struct FoodPantryView: View {
    let model: SocialModel
    @State private var filter: Filter = .all
    @State private var claiming: Set<String> = []
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    private let screen = AccessibilityID.Pantry.screen

    enum Filter: String, CaseIterable, Identifiable {
        case all = "All", friends = "Friends", groups = "Groups"
        var id: String { rawValue }
    }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                    Text("Shared by friends and groups").font(Theme.Fonts.sheetMeta).foregroundStyle(Theme.Colors.muted)
                    Picker("Show", selection: $filter) {
                        ForEach(Filter.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .frame(minHeight: Theme.Size.minTouch)
                    .accessibilityIdentifier(AccessibilityID.Pantry.filter)
                    if let banner = model.banner {
                        BannerView(style: .error, message: banner, dismiss: { model.banner = nil },
                                   identifiers: .init(container: AccessibilityID.Pantry.banner), horizontalInset: 0)
                    }
                }
                .listRowBackground(Color.clear).listRowInsets(EdgeInsets()).listRowSeparator(.hidden)
            }
            content
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Theme.Colors.ground.ignoresSafeArea())
        .navigationTitle("Shared food")
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier(screen)
        .refreshable { await model.loadPantry() }
        .task { await model.loadPantry() }
    }

    @ViewBuilder private var content: some View {
        switch model.pantry {
        case .loading:
            stateRow { SkeletonList(screen: "pantry") }
        case .failed(let e):
            stateRow { ErrorStateView(screen: "pantry", error: e) { Task { await model.loadPantry() } } }
        case .loaded(let all):
            let list = all.filter { l in
                switch filter {
                case .all: true
                case .friends: l.source.type == .friend
                case .groups: l.source.type == .group
                }
            }
            if list.isEmpty {
                stateRow {
                    EmptyStateView(screen: "pantry",
                                   title: all.isEmpty ? "Nothing shared yet" : "Nothing here",
                                   message: all.isEmpty ? "When friends or groups share food, it shows up here."
                                                        : "Try another filter to see more.",
                                   systemImage: "basket")
                }
            } else {
                Section { ForEach(list) { row($0) } }
            }
        }
    }

    private func stateRow<V: View>(@ViewBuilder _ view: () -> V) -> some View {
        Section {
            view().listRowBackground(Color.clear).listRowInsets(EdgeInsets()).listRowSeparator(.hidden)
        }
    }

    private func row(_ l: PantryListing) -> some View {
        let stacked = dynamicTypeSize.isAccessibilitySize
        let layout = stacked ? AnyLayout(VStackLayout(alignment: .leading, spacing: Theme.Spacing.s))
                             : AnyLayout(HStackLayout(spacing: Theme.Spacing.sm))
        return layout {
            HStack(spacing: Theme.Spacing.sm) {
                FoodGroupIcon(group: l.item.category.foodGroup)
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    Text(l.item.name).font(Theme.Fonts.rowTitle).foregroundStyle(Theme.Colors.ink)
                    HStack(spacing: Theme.Spacing.xs) {
                        Text("\(l.source.name) · \(quantity(l))").font(Theme.Fonts.meta).foregroundStyle(Theme.Colors.muted)
                        if let badge = ExpiryBadgeModel.make(expiry: l.item.predictedExpiry, freshness: nil) {
                            ExpiryBadge(model: badge)
                        }
                    }
                    if l.pickupSet == true || l.pickup != nil {
                        Label("Pickup spot set", systemImage: "mappin.and.ellipse")
                            .font(Theme.Fonts.meta.weight(.medium)).foregroundStyle(Theme.Colors.forest)
                            .accessibilityIdentifier(AccessibilityID.Pantry.pickupHint(l.id))
                    }
                }
                .accessibilityElement(children: .combine)
                if !stacked { Spacer(minLength: Theme.Spacing.xs) }
            }
            trailing(l)
        }
        .padding(.vertical, Theme.Spacing.xs)
        .listRowBackground(Theme.Colors.surface)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AccessibilityID.Pantry.row(l.id))
    }

    @ViewBuilder private func trailing(_ l: PantryListing) -> some View {
        if l.claimedByMe {
            NavigationLink(value: SocialRoute.claimed(l)) {
                Text("Claimed \(Image(systemName: "chevron.right"))")
                    .font(Theme.Fonts.badge).foregroundStyle(Theme.Colors.forest)
                    .frame(minWidth: Theme.Size.minTouch, minHeight: Theme.Size.minTouch)
                    .contentShape(Rectangle())
            }
            .fixedSize()
            .accessibilityLabel("Claimed. Show pickup details for \(l.item.name)")
            .accessibilityIdentifier(AccessibilityID.Pantry.claimed(l.id))
        } else {
            Button {
                claiming.insert(l.id)
                Task { await model.claim(l); claiming.remove(l.id) }
            } label: {
                Group { if claiming.contains(l.id) { ProgressView() } else { Text("Claim") } }
                    .font(Theme.Fonts.badge).foregroundStyle(Theme.Colors.onForest)
                    .padding(.horizontal, Theme.Spacing.m)
                    .frame(minWidth: Theme.Size.minTouch, minHeight: Theme.Size.minTouch)
                    .background(Theme.Colors.forest, in: Capsule())
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .disabled(claiming.contains(l.id))
            .accessibilityLabel("Claim \(l.item.name) from \(l.ownerName)")
            .accessibilityIdentifier(AccessibilityID.Pantry.claim(l.id))
        }
    }

    private func quantity(_ l: PantryListing) -> String {
        let q = l.item.quantity
        let n = q == q.rounded() ? String(Int(q)) : String(q)
        return "\(n) \(l.item.unit)"
    }
}
