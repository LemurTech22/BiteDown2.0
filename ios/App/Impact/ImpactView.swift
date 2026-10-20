import SwiftUI

/// Impact dashboard (`ImpactRange` artboard, SCREENS #16/#35): Week / Month / All, led by food saved
/// in lb, with carbon emissions as a secondary line, tiles, the used/donated split, items per week
/// (Swift Charts), waste reasons and a this-vs-last-period card. Empty, loading and error states.
///
/// Entry point for Home's "saved" pill: `ImpactView(api: env.api)`, pushed or presented. The Back
/// button uses `dismiss`, so either works.
struct ImpactView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var model: ImpactModel

    private let screen = AccessibilityID.Impact.screen

    init(api: APIClient) {
        _model = State(initialValue: ImpactModel(api: api))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.m) {
                header
                rangePicker
                content
                    .motionAnimation(Theme.Motion.quick, value: stateKey)
            }
            .padding(.horizontal, Theme.Spacing.gutter)
            .padding(.bottom, Theme.Spacing.l)
        }
        .scrollIndicators(.hidden)
        .background(Theme.Colors.ground.ignoresSafeArea())
        .refreshable { await model.refresh() }
        .toolbar(.hidden, for: .navigationBar)
        .task { await model.loadIfNeeded() }
        .accessibilityIdentifier(AccessibilityID.Impact.scroll)
        // Screen root: its own container element, so `impact` marks the screen while the scroll view and
        // every child keep their own identifiers (same pattern as the hero card).
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(screen)
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Button { dismiss() } label: {
                Image(systemName: "chevron.left")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Theme.Colors.forest)
                    .frame(width: Theme.Size.minTouch, height: Theme.Size.minTouch)
                    .background(Theme.Colors.surface, in: Circle())
                    .overlay(Circle().strokeBorder(Theme.Colors.border, lineWidth: Theme.Stroke.hairline))
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Back")
            .accessibilityIdentifier(AccessibilityID.Impact.back)
            Text("Your impact")
                .font(Theme.Fonts.screenTitle)
                .foregroundStyle(Theme.Colors.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier(AccessibilityID.Impact.title)
        }
        .padding(.top, Theme.Spacing.s)
    }

    private var rangePicker: some View {
        Picker("Range", selection: $model.range) {
            ForEach(ImpactRange.allCases, id: \.self) { r in
                Text(ImpactFormat.title(r)).tag(r)
            }
        }
        .pickerStyle(.segmented)
        .controlSize(.large)
        .frame(minHeight: Theme.Size.minTouch)
        .onChange(of: model.range) { _, _ in Haptics.selection() }
        .accessibilityIdentifier(AccessibilityID.Impact.range)
    }

    // MARK: Content

    /// Drives the cross-fade only when the kind of state changes, not on every refresh.
    private var stateKey: String {
        switch model.state {
        case .loading: "loading"
        case .error: "error"
        case .empty: "empty-\(model.range.rawValue)"
        case .content: "content"
        }
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .loading:
            ImpactSkeleton().motionTransition(.opacity)
        case .error(let error):
            ErrorStateView(screen: screen, error: error) { Task { await model.retry() } }
                .motionTransition(.opacity)
        case .empty:
            EmptyStateView(screen: screen,
                           title: model.range == .all ? "No impact yet" : "Nothing \(model.range == .week ? "this week" : "this month") yet",
                           message: "Use, share or throw out food from your fridge and your impact shows up here.",
                           systemImage: "leaf")
                .motionTransition(.opacity)
        case .content(let impact):
            VStack(alignment: .leading, spacing: Theme.Spacing.m) {
                ImpactHeroCard(impact: impact, range: model.range)
                ImpactTiles(impact: impact, range: model.range)
                ImpactSplitCard(used: impact.used.count, donated: impact.donated.count)
                ImpactWeeklyChart(weeks: impact.last6Weeks, alreadyRevealed: model.chartRevealed) {
                    model.chartRevealed = true
                }
                ImpactReasonsSection(reasons: impact.wasteReasons, wastedCount: impact.wasted.count)
                if let periods = ImpactFormat.comparePeriods(model.range), let previous = impact.previous {
                    ImpactCompareCard(currentKg: impact.wasted.kg, previousKg: previous.wasted.kg, periods: periods)
                }
            }
            .motionTransition(.opacity)
        }
    }
}
