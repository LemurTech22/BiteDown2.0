import SwiftUI

/// "Share with": pick Friends or one group, then Share. The API takes one audience per listing.
struct ShareAudienceSheet: View {
    let groups: [SharingGroup]
    let loading: Bool
    let error: Error?
    let retry: () -> Void
    let confirm: (ShareAudience) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var choice: ShareAudience = .friends

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Spacing.s) {
                    Text("Who can claim it?")
                        .font(Theme.Fonts.rowTitle).foregroundStyle(Theme.Colors.ink)
                        .accessibilityAddTraits(.isHeader)
                    row(title: "Friends", subtitle: "Everyone you're connected with", systemImage: "person.2.fill",
                        isOn: choice == .friends, id: AccessibilityID.ItemDetail.audienceFriends) { choice = .friends }
                    ForEach(groups) { g in
                        let option = ShareAudience.group(id: g.id, name: g.name)
                        row(title: g.name, subtitle: g.memberCount == 1 ? "1 member" : "\(g.memberCount) members",
                            systemImage: "house.fill", isOn: choice == option,
                            id: AccessibilityID.ItemDetail.audienceGroup(g.id)) { choice = option }
                    }
                    if loading {
                        ProgressView().frame(maxWidth: .infinity, minHeight: Theme.Size.minTouch)
                    } else if error != nil {
                        HStack {
                            Text("Couldn't load your groups.").font(Theme.Fonts.meta).foregroundStyle(Theme.Colors.urgentInk)
                            Spacer()
                            Button("Try again", action: retry).font(Theme.Fonts.badge)
                                .frame(minHeight: Theme.Size.minTouch)
                        }
                    }
                    Button {
                        confirm(choice)
                        dismiss()
                    } label: {
                        Text("Share")
                            .font(Theme.Fonts.button).foregroundStyle(Theme.Colors.onForest)
                            .frame(maxWidth: .infinity, minHeight: Theme.Size.primaryButton)
                            .background(Theme.Colors.forest, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .padding(.top, Theme.Spacing.s)
                    .accessibilityIdentifier(AccessibilityID.ItemDetail.audienceConfirm)
                }
                .padding(.horizontal, Theme.Spacing.gutter)
                .padding(.vertical, Theme.Spacing.m)
            }
            .background(Theme.Colors.ground.ignoresSafeArea())
            .navigationTitle("Share with friends")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.accessibilityIdentifier(AccessibilityID.ItemDetail.audienceCancel)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(Theme.Radius.sheet)
        .presentationBackground(Theme.Colors.ground)
        .accessibilityIdentifier(AccessibilityID.ItemDetail.audienceSheet)
    }

    /// Single-choice row: a filled radio plus the "Selected" trait, so colour isn't the only cue.
    private func row(title: String, subtitle: String, systemImage: String, isOn: Bool, id: String,
                     action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: Theme.Spacing.sm) {
                Image(systemName: systemImage).foregroundStyle(Theme.Colors.forestMid)
                    .frame(width: Theme.Size.avatarGlyph).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                    Text(title).font(Theme.Fonts.rowTitle).foregroundStyle(Theme.Colors.ink)
                    Text(subtitle).font(Theme.Fonts.meta).foregroundStyle(Theme.Colors.muted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: isOn ? "largecircle.fill.circle" : "circle")
                    .font(Theme.Fonts.sheetTitle)
                    .foregroundStyle(isOn ? Theme.Colors.forest : Theme.Colors.muted)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, Theme.Spacing.sm).padding(.vertical, Theme.Spacing.s)
            .frame(minHeight: Theme.Size.minTouch)
            .background(isOn ? Theme.Colors.limeTint : Theme.Colors.surface,
                        in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .strokeBorder(isOn ? Theme.Colors.forest : Theme.Colors.border,
                              lineWidth: isOn ? Theme.Stroke.selected : Theme.Stroke.hairline) }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isOn ? [.isSelected] : [])
        .accessibilityIdentifier(id)
    }
}
