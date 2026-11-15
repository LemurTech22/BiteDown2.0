# Design

The live canvas for the key screens, made with Claude's Design canvas and following taste-skill's
rules, is at
**https://claude.ai/artifact/2M3dg2Yzb8fhyTL9CcvKoC**. (Since 2026-11-14 the canvas lives in the owner's account; the earlier one,
`ALmB8FYKGrayhDQXqvoncx`, belonged to another organisation and is no longer updated.) It's private, so the owner has to share it
before teammates can open it. The source of every artboard is mirrored in `screens/`. These are
`.dc.html` mockups, **not SwiftUI**. iOS translates them into native views using
`ios/App/Theme.swift`, the code mirror of [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md).

Design read: a consumer iOS utility for students and shared households. Calm and practical, with a
fresh-produce palette and native iOS conventions (sheets, swipe actions, segmented controls,
system body type).

| Screen | Artboard | Status |
|---|---|---|
| Sign in (sign up / log in, green buttons with light text) | `screens/Main.dc.html` | approved 2026-10-10 |
| Home + tab bar (Home, Recipes, + Add, Fridge, Social) | `screens/Home.dc.html` | approved 2026-10-10 |
| Fridge / Pantry list (segmented storage, expiry badges, swipe to remove, spoilage flag) | `screens/Fridge.dc.html` | approved 2026-10-10 |
| Removal sheet, step 1: outcome (used / shared, with Given to / threw away) | `screens/RemoveSheet.dc.html` | approved 2026-10-10 |
| Removal sheet, step 2: waste reason (one tap) | `screens/RemoveReason.dc.html` | approved 2026-10-10 |
| Add sheet (fridge photo, one item, type/say, barcode, receipt) | `screens/AddSheet.dc.html` | approved 2026-10-10 |
| Social (Food Pantry widget, sticky-note requests, + friends/groups) | `screens/Social.dc.html` | approved 2026-10-10 |
| Impact Dashboard (food-saved hero in lb, CO₂e line, saved/money, weekly chart, waste reasons) | `screens/Impact.dc.html` | approved 2026-10-10 |
| Add: review photo results (detected items, predicted expiry, spoilage flag, untick to skip) | `screens/PhotoReview.dc.html` | approved 2026-10-10 |
| Recipes tab (filters, best match using expiring items, more suggestions) | `screens/Recipes.dc.html` | approved 2026-10-10 |
| Sign up (Google / email) | `screens/SignUp.dc.html` | added 2026-10-10 |
| Log in (Google / email, inline error state) | `screens/LogIn.dc.html` | added 2026-10-10 |
| Item detail / edit, Type or say it, Receipt review, Barcode result, Recipe detail, Food Pantry, Ask for something, Friends & groups, Group, Profile & settings | `screens/*.dc.html` | added 2026-10-10 (idea audit), see [`SCREENS.md`](SCREENS.md) |

**Approval:** ✅ **Approved by the owner on 2026-10-10** (relayed through the Mac session), including feedback rounds 1–2, the native glass tab bar, "Use soon" and the colourful food-group icons. Wave 2 (iOS) has started. Changes requested
on the canvas get mirrored back into `screens/` and `DESIGN_SYSTEM.md`.

## Owner feedback round 1 (2026-10-10), applied
- **Sign in:** less empty space. A value-points card now sits between the headline and the buttons.
- **Fridge:** items are grouped by **food group** (protein, veggies, fruit, ...), each with an icon. No emoji. Home's list uses the same icons.
- **Photo review:** every detected item has a **quantity stepper**. Expiry moved into the meta line.
- **Recipes:** **macros** per serving (kcal / protein / carbs / fat) on the best match, and kcal + protein on the other suggestions.

These need two backend additions (see `docs/API.md` once built):
- `food_group` on items and candidates.
- `macros` on recipe suggestions.

## Owner decisions, 2026-10-10 (round 2)
- **Native glass tab bar**, with Add as a tab. All tabbed artboards are updated.
- **`semi_fresh` is a product feature.** Food that's fine but should be eaten soon gets a **"Use soon"** badge on the Fridge, and "ripe, use soon" on photo review.
- **Food-group icons are colourful**, and the removal sheet header uses them too.
- **Approved on 2026-10-10.** Wave 2 started.

## Sign-in (owner decision, 2026-10-10)
- **Email and Google only.** Sign in with Apple was removed, because it can't be signed without a paid Apple Developer team.
- The landing screen keeps **Sign up / Log in** (green, as in the brief), then "or continue with", then a full-width **Continue with Google**. Sign up and Log in put Google first, then the email form.
- **Use Google's official button**: the Google Sign-In SDK button, or one built strictly to Google's branding guidelines (white, `#747775` border, `#1F1F1F` text, the official four-colour "G"). The mockups show the mark.
- Email: labels above the fields, a show-password toggle, the "At least 8 characters" hint, and inline errors under the field (Log in shows the error state). Forgot-password is **deferred**.

## Keeping the canvas in sync during Wave 2
The **orchestrator owns the canvas** and `docs/design/`, so there's a single writer and no publish conflicts. When an iOS PR deviates from an artboard, for a platform reason or a new state, the PR description includes a **"Design delta"** section: the artboard, what changed and why, plus a Simulator screenshot in `docs/qa/ios/`. The orchestrator updates the canvas and `screens/` to match when it merges the PR.

## Interaction notes for iOS
[`SCREENS.md`](SCREENS.md) is the per-screen contract and wins over this section; these are the cross-screen patterns.
- **Removal is one or two taps.** Swipe left on a row to reveal **Remove**, which opens the sheet.
  *Used it* finishes in one tap. *Shared it* shows a **Given to** menu (the claimer, friends, fellow
  group members, or "Someone not on BiteDown"; it defaults to the claimer, else "Someone not on
  BiteDown"), then Done. *Threw it away* pushes the reason list, where one tap finishes. A 5 s Undo
  follows. The Fridge's **Select** button opens multi-select (Used them / Shared them).
- **Tab bar (decided):** the native iOS 26 glass `TabView`. **Add is a tab** that presents the Add sheet and doesn't change the selected tab. There's no raised button.
- **Photo review** is the demo path's middle step. Snap your fridge → `POST /items/from-photo` →
  this screen → `POST /items`. Spoiled items sit in a **Looks spoiled** section with inline **Toss
  it** / **Keep it**, and "Add N" stays disabled until each is decided. Every other item is a
  `DetectedItemRow`, ticked by default, with one badge (an expiry range, "Use soon", or "Not sure"
  for low confidence) and a quantity stepper. No footer caption about estimates: the ranges already
  read as estimates. The primary button counts the ticked items.
- **Recipes** come from `POST /recipes/suggest`, opening on **Only what I have**. The best match is
  the hero card, with chips naming each expiring item it uses and how soon it expires ("Spinach ·
  Tomorrow"). The other suggestions are rows with a "Uses N" badge. A "You'll need" line shows only
  once "Only what I have" is off.
- The **Food Pantry** widget previews three food tiles and "+N more". Tapping it pushes Food Pantry.
- **Request notes** use two alternating fills and a slight rotation (±1.2° max). The header row
  always names the source (friend or group).
- The **Impact** chart is a stacked bar per week: saved (bottom) and thrown out (top), with a 2 pt
  surface gap. Values are labeled above each bar because the orange fails 3:1 against white.
  Build it with Swift Charts and add selection for per-week detail.
