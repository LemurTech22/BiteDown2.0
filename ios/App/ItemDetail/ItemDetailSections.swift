import SwiftUI
import PhotosUI

// Building blocks of Item detail and ItemShared: the field rows, "Check again", "What to look for"
// and the Food Pantry cards.

/// One row in the field card: label left, control right, hairline under it.
struct DetailRow<Content: View>: View {
    let label: String
    var showsDivider = true
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: Theme.Spacing.sm) {
                Text(label).font(Theme.Fonts.body).foregroundStyle(Theme.Colors.inkSecondary)
                Spacer(minLength: Theme.Spacing.s)
                content()
            }
            .padding(.horizontal, Theme.Spacing.m)
            .frame(minHeight: Theme.Size.detailRow)
            .accessibilityElement(children: .contain)
            if showsDivider { Divider().overlay(Theme.Colors.hairline) }
        }
    }
}

/// "estimated" / "from photo" chip.
struct DetailChip: View {
    let text: String
    var body: some View {
        Text(text)
            .font(Theme.Fonts.meta.weight(.semibold)).foregroundStyle(Theme.Colors.forest)
            .padding(.horizontal, Theme.Spacing.s).padding(.vertical, Theme.Spacing.xxs)
            .background(Theme.Colors.limeTint, in: RoundedRectangle(cornerRadius: Theme.Spacing.s, style: .continuous))
    }
}

/// The five field rows plus "Check again" (the white card on both artboards).
struct ItemFieldsCard: View {
    @Bindable var model: ItemDetailModel
    @Binding var photoSelection: PhotosPickerItem?

    var body: some View {
        VStack(spacing: 0) {
            DetailRow(label: "Quantity") {
                HStack(spacing: Theme.Spacing.xs) {
                    TextField("0", text: $model.quantityText)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                        .frame(minWidth: Theme.Size.minTouch, maxWidth: 80, minHeight: Theme.Size.minTouch)
                        .accessibilityLabel("Amount")
                        .accessibilityIdentifier(AccessibilityID.ItemDetail.quantity)
                    TextField("unit", text: $model.unit)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .frame(minWidth: Theme.Size.minTouch, maxWidth: 80, minHeight: Theme.Size.minTouch)
                        .accessibilityLabel("Unit")
                        .accessibilityIdentifier(AccessibilityID.ItemDetail.unit)
                }
                .font(Theme.Fonts.rowTitle).foregroundStyle(Theme.Colors.ink)
            }
            DetailRow(label: "Food group") {
                Picker("Food group", selection: $model.foodGroup) {
                    ForEach(FoodGroup.allCases, id: \.self) { Text($0.displayName).tag($0) }
                }
                .pickerStyle(.menu).labelsHidden()
                .frame(minHeight: Theme.Size.minTouch)
                .accessibilityIdentifier(AccessibilityID.ItemDetail.foodGroup)
            }
            DetailRow(label: "Stored in") {
                Picker("Stored in", selection: $model.storage) {
                    ForEach(Storage.allCases, id: \.self) { Text($0.displayName).tag($0) }
                }
                .pickerStyle(.menu).labelsHidden()
                .frame(minHeight: Theme.Size.minTouch)
                .accessibilityIdentifier(AccessibilityID.ItemDetail.storage)
            }
            DetailRow(label: "Use by") {
                HStack(spacing: Theme.Spacing.s) {
                    if let expiry = model.expiry {
                        DatePicker("Use by", selection: Binding(get: { expiry }, set: { model.expiry = $0 }),
                                   displayedComponents: .date)
                            .labelsHidden()
                            .frame(minHeight: Theme.Size.minTouch)
                            .accessibilityIdentifier(AccessibilityID.ItemDetail.expiry)
                        if model.item.expirySource != "user" { DetailChip(text: "estimated") }
                    } else {
                        Button("Set a date") { model.expiry = Calendar.current.date(byAdding: .day, value: 7, to: Date()) }
                            .font(Theme.Fonts.rowTitle).foregroundStyle(Theme.Colors.forest)
                            .frame(minHeight: Theme.Size.minTouch)
                            .accessibilityIdentifier(AccessibilityID.ItemDetail.expiry)
                    }
                }
            }
            DetailRow(label: "Freshness", showsDivider: false) {
                HStack(spacing: Theme.Spacing.s) {
                    Text(model.item.freshness.map(ItemDetailModel.freshnessLabel) ?? "Not checked")
                        .font(Theme.Fonts.rowTitle).foregroundStyle(Theme.Colors.ink)
                    if model.item.freshnessCheckedAt != nil { DetailChip(text: "from photo") }
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier(AccessibilityID.ItemDetail.freshness)
            }
            CheckAgainButton(model: model, selection: $photoSelection)
                .padding(.horizontal, Theme.Spacing.m)
                .padding(.top, Theme.Spacing.s).padding(.bottom, Theme.Spacing.sm)
        }
        .background(Theme.Colors.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
    }
}

/// "Check again": pick a photo, re-read freshness. Only `freshness` is PATCHed; the photo isn't stored.
struct CheckAgainButton: View {
    let model: ItemDetailModel
    @Binding var selection: PhotosPickerItem?

    var body: some View {
        PhotosPicker(selection: $selection, matching: .images, photoLibrary: .shared()) {
            HStack(spacing: Theme.Spacing.s) {
                if model.isChecking { ProgressView() } else { Image(systemName: "camera").accessibilityHidden(true) }
                Text(model.isChecking ? "Checking…" : "Check again")
            }
            .font(Theme.Fonts.badge).foregroundStyle(Theme.Colors.forest)
            .frame(maxWidth: .infinity, minHeight: Theme.Size.minTouch)
            .background(Theme.Colors.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.input, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: Theme.Radius.input, style: .continuous)
                .strokeBorder(Theme.Colors.border, lineWidth: Theme.Stroke.hairline) }
            .contentShape(Rectangle())
        }
        .disabled(model.isChecking)
        .accessibilityHint("Choose a photo to re-check how fresh this looks")
        .accessibilityIdentifier(AccessibilityID.ItemDetail.checkAgain)
    }
}

/// Static signs per food group.
struct WhatToLookForSection: View {
    let group: FoodGroup

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.stack) {
            Text("What to look for")
                .font(Theme.Fonts.cardHeading).foregroundStyle(Theme.Colors.ink)
                .accessibilityAddTraits(.isHeader)
            ForEach(WhatToLookFor.signs(for: group), id: \.self) { sign in
                HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.s) {
                    Text("•").accessibilityHidden(true)
                    Text(sign)
                }
                .font(Theme.Fonts.callout).foregroundStyle(Theme.Colors.inkSecondary)
                .accessibilityElement(children: .combine)
            }
            Text(WhatToLookFor.disclaimer).font(Theme.Fonts.meta).foregroundStyle(Theme.Colors.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Theme.Spacing.xs)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AccessibilityID.ItemDetail.lookFor)
    }
}

/// "Add a pickup spot" / the saved spot, as a 44 pt row.
struct PickupRow: View {
    let pickup: Pickup?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Theme.Spacing.sm) {
                Image(systemName: "mappin.and.ellipse").accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 0) {
                    Text(pickup == nil ? "Add a pickup spot" : "Pickup spot")
                        .font(Theme.Fonts.rowTitle)
                    if let pickup {
                        Text(pickup.title).font(Theme.Fonts.meta).foregroundStyle(Theme.Colors.muted).lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.right").font(Theme.Fonts.meta).foregroundStyle(Theme.Colors.muted)
                    .accessibilityHidden(true)
            }
            .foregroundStyle(Theme.Colors.forest)
            .frame(minHeight: Theme.Size.minTouch)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(AccessibilityID.ItemDetail.pickupRow)
    }
}

/// Item detail's share card: the switch (a 44 pt control), who can see it, "Not claimed yet", pickup row.
struct ShareSwitchCard: View {
    let model: ItemDetailModel
    let onSwitch: (Bool) -> Void
    let onPickup: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                Text("Share with friends").font(Theme.Fonts.cardHeading).foregroundStyle(Theme.Colors.ink)
                Spacer()
                Toggle("Share with friends", isOn: Binding(get: { model.isShared }, set: onSwitch))
                    .labelsHidden()
                    .tint(Theme.Colors.forest)
                    .frame(minWidth: Theme.Size.shareSwitchWidth, minHeight: Theme.Size.minTouch)
                    .contentShape(Rectangle())
                    .disabled(model.isSharing)
                    .accessibilityLabel("Share with friends")
                    .accessibilityIdentifier(AccessibilityID.ItemDetail.shareSwitch)
            }
            Group {
                if model.isShared {
                    (Text("Visible to: ") + Text(model.audienceSummary).bold().foregroundStyle(Theme.Colors.ink)
                        + Text(" · Not claimed yet"))
                } else {
                    Text("Off. Turn on to offer it to friends or a group.")
                }
            }
            .font(Theme.Fonts.callout).foregroundStyle(Theme.Colors.muted)
            .accessibilityIdentifier(AccessibilityID.ItemDetail.shareStatus)
            Divider().overlay(Theme.Colors.hairline).padding(.horizontal, -Theme.Spacing.m)
            PickupRow(pickup: model.pickup, action: onPickup)
        }
        .padding(.horizontal, Theme.Spacing.m).padding(.vertical, Theme.Spacing.sm)
        .background(Theme.Colors.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
    }
}

/// ItemShared's "Shared with friends" card: audience, who claimed it, the pickup spot with a map
/// preview and "Open in Maps".
struct SharedPantryCard: View {
    let model: ItemDetailModel
    let onPickup: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Label("Shared with friends", systemImage: "gift")
                .font(Theme.Fonts.cardHeading).foregroundStyle(Theme.Colors.ink)
                .accessibilityAddTraits(.isHeader)
            HStack(spacing: Theme.Spacing.sm) {
                Image(systemName: "person.2").foregroundStyle(Theme.Colors.muted).accessibilityHidden(true)
                Text("Shared with")
                Spacer()
                Text(model.audienceSummary).bold().foregroundStyle(Theme.Colors.ink)
            }
            .font(Theme.Fonts.body).foregroundStyle(Theme.Colors.inkSecondary)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(AccessibilityID.ItemDetail.sharedAudience)
            if let claimer = model.claimer {
                Label("Claimed by \(claimer.name)", systemImage: "person.fill")
                    .font(Theme.Fonts.rowTitle).foregroundStyle(Theme.Colors.forest)
                    .padding(.horizontal, Theme.Spacing.sm)
                    .frame(maxWidth: .infinity, minHeight: Theme.Size.detailRow, alignment: .leading)
                    .background(Theme.Colors.limeTint, in: RoundedRectangle(cornerRadius: Theme.Radius.input, style: .continuous))
                    .accessibilityIdentifier(AccessibilityID.ItemDetail.sharedClaimer)
            }
            Divider().overlay(Theme.Colors.hairline).padding(.horizontal, -Theme.Spacing.m)
            pickupBlock
        }
        .padding(.horizontal, Theme.Spacing.m).padding(.vertical, Theme.Spacing.sm)
        .background(Theme.Colors.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
    }

    @ViewBuilder private var pickupBlock: some View {
        HStack {
            GroupHeaderText(text: "Pickup spot").accessibilityAddTraits(.isHeader)
            Spacer()
            Button(model.pickup == nil ? "Add" : "Edit", action: onPickup)
                .font(Theme.Fonts.rowTitle).foregroundStyle(Theme.Colors.forest)
                .frame(minWidth: Theme.Size.minTouch, minHeight: Theme.Size.minTouch, alignment: .trailing)
                .accessibilityLabel(model.pickup == nil ? "Add pickup spot" : "Edit pickup spot")
                .accessibilityIdentifier(AccessibilityID.ItemDetail.sharedPickupEdit)
        }
        if let pickup = model.pickup {
            HStack(spacing: Theme.Spacing.sm) {
                if pickup.hasPin {
                    PickupMapPreview(pickup: pickup, width: Theme.Size.pickupThumb, height: Theme.Size.pickupThumb)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.input, style: .continuous))
                }
                VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                    let place = pickup.placeName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                    if !place.isEmpty {
                        Text(place).font(Theme.Fonts.rowTitle).foregroundStyle(Theme.Colors.ink)
                    } else if pickup.trimmedNote == nil {
                        Text("Dropped pin").font(Theme.Fonts.rowTitle).foregroundStyle(Theme.Colors.ink)
                    }
                    if let note = pickup.trimmedNote {
                        Text(note)
                            .font(place.isEmpty ? Theme.Fonts.body : Theme.Fonts.callout)
                            .foregroundStyle(place.isEmpty ? Theme.Colors.ink : Theme.Colors.inkSecondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(AccessibilityID.ItemDetail.sharedPickup)
            if pickup.hasPin {
                Button { PickupMaps.open(pickup) } label: {
                    Label("Open in Maps", systemImage: "map")
                        .font(Theme.Fonts.badge).foregroundStyle(Theme.Colors.forest)
                        .frame(maxWidth: .infinity, minHeight: Theme.Size.minTouch)
                        .background(Theme.Colors.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.input, style: .continuous))
                        .overlay { RoundedRectangle(cornerRadius: Theme.Radius.input, style: .continuous)
                            .strokeBorder(Theme.Colors.border, lineWidth: Theme.Stroke.hairline) }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open \(pickup.title) in Maps")
                .accessibilityIdentifier(AccessibilityID.ItemDetail.sharedOpenInMaps)
            }
        } else {
            Text("No pickup spot yet. Add one so \(model.claimer?.name ?? "they") knows where to find it.")
                .font(Theme.Fonts.callout).foregroundStyle(Theme.Colors.muted)
        }
    }
}
