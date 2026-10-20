import SwiftUI

/// Greeting, the settings gear (replaces the profile button, round 3) and the Impact pill.
/// At accessibility sizes the pill drops below the greeting row (Home pill below the greeting).
struct HomeHeader: View {
    let name: String?
    /// kg saved in the last 30 days; nil hides the pill (error state, or impact unavailable).
    let savedKg: Double?
    let onOpenSettings: () -> Void
    let onOpenImpact: () -> Void

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @AppStorage(UnitSystem.storageKey) private var units: UnitSystem = .us

    private var stacked: Bool { dynamicTypeSize.isAccessibilitySize }

    var body: some View {
        if stacked {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                HStack(alignment: .top, spacing: Theme.Spacing.sm) {
                    greeting
                    Spacer(minLength: 0)
                    gear
                }
                pill
            }
        } else {
            HStack(alignment: .bottom, spacing: Theme.Spacing.sm) {
                greeting
                Spacer(minLength: Theme.Spacing.s)
                gear
                pill
            }
        }
    }

    private var greeting: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
            Text(Date.now.formatted(.dateTime.weekday(.wide).month(.abbreviated).day()))
                .font(Theme.Fonts.body)
                .foregroundStyle(Theme.Colors.muted)
                .accessibilityIdentifier(AccessibilityID.Home.date)
            Text(name.map { "Hi, \($0)" } ?? "Hi there")
                .font(Theme.Fonts.screenTitle)
                .foregroundStyle(Theme.Colors.ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier(AccessibilityID.Home.greeting)
        }
    }

    private var gear: some View {
        Button(action: onOpenSettings) {
            Image(systemName: "gearshape")
                .font(.title3.weight(.medium))
                .foregroundStyle(Theme.Colors.forest)
                .frame(width: Theme.Size.minTouch, height: Theme.Size.minTouch)
                .background(Theme.Colors.surface, in: Circle())
                .overlay(Circle().strokeBorder(Theme.Colors.border, lineWidth: 1))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Settings")
        .accessibilityIdentifier(AccessibilityID.Home.settings)
    }

    @ViewBuilder private var pill: some View {
        if let savedKg {
            let f = WeightFormatter(system: units)
            Button(action: onOpenImpact) {
                HStack(spacing: Theme.Spacing.stack) {
                    Image(systemName: "leaf").accessibilityHidden(true)
                    Text("\(f.string(kg: savedKg)) saved")
                        .lineLimit(stacked ? nil : 1)
                }
                // IOS-43: keep the pill on one line on 375 pt phones; the greeting wraps instead.
                // At accessibility sizes the pill sits on its own row and wraps inside the width.
                .fixedSize(horizontal: !stacked, vertical: stacked)
                .font(Theme.Fonts.badge)
                .foregroundStyle(Theme.Colors.onLime)
                .padding(.horizontal, Theme.Spacing.sm)
                .frame(minHeight: Theme.Size.minTouch)
                .background(Theme.Colors.lime, in: Capsule())
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .layoutPriority(1)
            .accessibilityLabel("\(f.spoken(kg: savedKg)) saved in the last 30 days")
            .accessibilityHint("Opens Impact")
            .accessibilityIdentifier(AccessibilityID.Home.impactPill)
        }
    }
}
