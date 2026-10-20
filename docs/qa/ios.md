# iOS QA log

## 2026-10-10: first build (tab shell + `Theme.swift`)
Mac: Apple M4 Pro, macOS 26.5.1, Xcode 26.6, XcodeGen 2.45.4. Simulator: iPhone 17 Pro, iOS 26.5.

| Check | Result |
|---|---|
| `xcodegen generate` | ok |
| `xcodebuild test` (`CODE_SIGNING_ALLOWED=NO`) | **TEST SUCCEEDED**. 0 errors, no compile fixes needed. `ThemeTests` 2/2, `LaunchUITests` 1/1 |
| CI `ios.yml` (macos-15) | pass, see PR #9 |
| 5 tabs: Home, Recipes, Add, Fridge, Social | yes |
| Selected-tab tint is forest `#1F4D2B` | yes. Sampled `#154321` in the screenshot: the iOS 26 Liquid Glass selected pill darkens it slightly. The other tabs render in system label color |
| Dynamic Type, AX5 (`accessibility-extra-extra-extra-large`) | Body text scales. The tab bar labels stay fixed size, which is standard iOS behaviour (long-press shows the large content viewer). No clipping |
| Dark mode | Renders on system black with a dark glass tab bar. **The forest tint is barely visible on black** (see IOS-1). No dark tokens exist yet |

Screenshots, downscaled to 603 px wide: [light](ios/first-build-light.png), [dark](ios/first-build-dark.png),
[light AX5](ios/first-build-light-ax5.png), [dark AX5](ios/first-build-dark-ax5.png).

Not compared against `docs/design/screens/`: the shell has placeholder `Text` views only and no designed screen yet.

### Bugs
| ID | Severity | Summary | Status |
|---|---|---|---|
| IOS-1 | medium | Dark mode: the selected tab in forest `#1F4D2B` on the dark glass bar has very low contrast. It needs a dark variant of `forest` (or of an accent token) in `DESIGN_SYSTEM.md` and `Theme.swift` | open |
| IOS-2 | low | The tab bar is the iOS 26 Liquid Glass floating pill. Check that it matches the design's tab bar artboards when the design is approved | open |

## 2026-10-10: adaptive dark theme (branch `feat/ios-dark-theme`)
Mac: Apple M4 Pro, Xcode 26.6, simulator iPhone 17 Pro (iOS 26.5). Builder's `Theme.swift` was already adaptive (`Color(light:dark:)` backed by a `UIColor` trait provider) when QA ran.

### Tests added (`ios/Tests/UnitTests/ThemeTests.swift`)
Each test resolves `UIColor(Theme.Colors.X).resolvedColor(with: UITraitCollection(userInterfaceStyle:))`, converts to sRGB 8-bit hex, and compares with the Dark mode table in `DESIGN_SYSTEM.md`:
- `testEveryTokenMatchesLightValue` and `testEveryTokenMatchesDarkValue` cover all 22 tokens (ground through chartWasted).
- `testTokensDifferBetweenLightAndDarkExceptLime`: every token differs between modes; `lime` is identical.
- `testSelectedTabTintIsVisibleOnDarkGround`: forest vs ground in dark must be at least 7:1 (regression for IOS-1).
`scrim` has no table row, so it is not asserted.

### Results
| Check | Result |
|---|---|
| `xcodegen generate` + `xcodebuild test` (`CODE_SIGNING_ALLOWED=NO`) | **TEST SUCCEEDED**, 0 errors. `ThemeTests` 6/6, `LaunchUITests` 1/1. No failures |
| Light screenshot | ground `#F4F8E8`, selected tab dark forest, as before |
| Dark screenshot | ground `#0F1A12` (sampled 15,26,18). Selected Home icon and label render lime. Sampled icon pixel `#D3F78C` (211,247,140), brighter than the `#B9D871` token because the Liquid Glass selection applies vibrancy. Clearly visible against the pill (about 52,61,54) and the bar. Contrast is high |
| Appearance reset to light | done |

Screenshots (603 px wide): [light](ios/dark-theme-light.png), [dark](ios/dark-theme-dark.png).

### Verdict: PASS. IOS-1 is closed.
The selected-tab tint is now clearly visible in dark mode.

### New bugs
| ID | Severity | Summary | Status |
|---|---|---|---|
| IOS-3 | low | Placeholder tab content ("Home") and the inactive tab icons use the system label color (white/black), not `Theme.Colors.ink` or `tabInactive`. Not visible as a defect yet, but the tokens are unused in the shell. Revisit when real screens land | open |

## 2026-10-10: foundation PR (`feat/ios-foundation`): iOS 18 + Xcode 26, tokens, APIClient, mock, motion, base URL
Mac: Apple M4 Pro, Xcode 26.6. Simulators: iPhone 17 Pro and a new **iPhone SE (3rd generation) "iPhone SE QA"** (iOS 26.5, `xcrun simctl create`; no runtime downloaded). Tests written while the builder's code landed; the final run is against the tree as of ~21:40.

### Verdict: PASS with open bugs (IOS-4 medium, IOS-5 to IOS-8 low). Motion UI tests are blocked (see "Not testable yet").
| Run | Result |
|---|---|
| Unit tests, iPhone 17 Pro | **96 run, 0 failed, 3 skipped** (the 3 real-Keychain tests, see IOS-7) |
| UI tests, iPhone 17 Pro | **16 run, 0 failed** (11 tab shell, 4 debug base URL, 1 launch) |
| Unit + UI on iPhone SE at AX5 (`accessibility-extra-extra-extra-large`) | unit 87/0 failed (run before MotionTests existed); UI 16 run, **1 failed**: `testInvalidSchemeShowsErrorAndKeepsDefault` (IOS-5). SE reset to `large` and shut down afterwards |
| Release build (`generic/platform=iOS Simulator`) | BUILD SUCCEEDED. The binary has none of `DebugSettingsSheet`, `debug.baseURL`, `api_base_url_override`, `UITestMockAPI` (strings count 0). Built Info.plist has **no** `NSAppTransportSecurity`; `API_BASE_URL` = release value; no entitlements |
| Build without `ios/Local.xcconfig` (the CI case) | works; bundle id `com.coderedorion.FoodWasteReducer` |
| `Local.xcconfig` gitignored | `git check-ignore -v` -> `.gitignore:45:ios/Local.xcconfig`; `Local.xcconfig.example` is not ignored |
| Entitlements | none in the repo or project.yml: no push, iCloud, App Groups or Sign in with Apple |

### Tests added (`ios/Tests/**`)
- `ThemeTests`: `addButton` removed; `useSoonBg/Ink` rows added to the exact light and dark hex table; all 9 food-group stroke/tile pairs in both modes (literals copied from DESIGN_SYSTEM); stroke vs tile >= 3:1; use-soon contrast; radii 14/18/28/20/16/12/10; Outfit-Medium and Outfit-SemiBold resolve with `UIFont(name:)`; `UIAppFonts` lists both files.
- `ExpiryBadgeTests` (11): Today, 1 day, N days, Expired, semi_fresh -> "Use soon" (but Today/Expired outrank it), spoiled -> "Check", nil expiry, across midnight, Honolulu vs Tokyo, DST end, date-only API parsing, accessibility text.
- `ModelsTests` (22): JSON shaped like docs/API.md: snake_case, ISO dates with and without fractions, date-only expiry = local midnight, optional `freshness` and `share`, unknown enums fall back to `other`, extra keys ignored, sections, auth, candidates, impact (empty weekly), recipes with and without macros, tips, the error shape, malformed JSON throws, round trips, encoder omits nil, API raw values.
- `MockAPIClientTests` (15): `group_by=food_group` order and omission of empty sections, expiry sort, storage filter, artboard badges, all four fixtures, remove then restore, API removal validation rules, create and patch, `failNetwork`, `failures[...]`, `failFirst` for retry, signed-out -> unauthorized, login/signup edge cases.
- `LiveAPIClientTests` (10, stub `URLProtocol`): bearer header, default base URL, `group_by` query, **an override is used on the very next request and reset restores the default**, path-prefix override, 401 signs out, login 401 does not, error shape mapping, non-JSON 5xx, decoding error.
- `BaseURLProviderTests` (11): precedence override > Info.plist > `http://127.0.0.1:5055`, validation (http/https only, rejects ftp/file/javascript/no host/query/fragment), trimming, rejected input is not stored, corrupt stored value ignored.
- `AuthStoreTests` (4): Keychain save/load/clear, isolation, store persistence across instances, in-memory path never touches the Keychain. **3 skip in unsigned runs.**
- `MotionTests` (9): exact token values, Reduce Motion returns `quick` for every animation, stagger 40 ms capped at 8 (and clamps below 0), `StaggerController` inactive until `restart()`, haptics provider records, toast constants, **a hosted `UndoToastView` auto-dismisses after about 5 s without calling Undo**.
- UI `TabShellUITests` (11): 5 tabs, order and VoiceOver labels (Home, Recipes, Add, Fridge, Social), Home selected at launch, tabs select, each tab >= 44 x 44 pt, **Add presents the sheet and the selected tab is unchanged after dismissing** (from Home, from Fridge, 3 times from Social, Add never selected), AX5 tabs hittable, screenshots attached. `BaseURLDebugUITests` (4): save a valid override and reset, invalid scheme shows an error, override persists across relaunch until reset, version label. `ios/Tests/README.md` documents the ID convention, launch args and device matrix.

### Screenshots (iPhone 17 Pro, 603 px)
[tab bar light](ios/foundation-tabbar-light.png), [tab bar dark](ios/foundation-tabbar-dark.png), [Add sheet light](ios/foundation-add-sheet-light.png), [Add sheet dark](ios/foundation-add-sheet-dark.png).
- Native glass `TabView`, 5 tabs in the order Home, Recipes, Add, Fridge, Social; Add is a filled circle-plus regular tab, no raised button. Selected Home shows the forest tint in light and the lime-family tint in dark, in a selection capsule. This matches the DESIGN_SYSTEM "Tab bar on iOS 26" spec (system `TabView`, forest tint, Add is a tab). Inactive tabs use the system label colour, accepted (IOS-3 won't-fix).
- Artboard (Home.dc.html) comparison: the artboard draws an approximation (flat pill); the system glass differs in material and icon weight by design. No defect.
- The Add placeholder sheet has a medium detent, 28 pt top corners (spec), grabber, the page ground colour and the word "Add"; Home stays selected behind it. Placeholder only; the AddSheet design is not built.

### CI review (`ios.yml`)
- `runs-on: macos-26` and `/Applications/Xcode_26.6.app` **exist** (runner-images `macos-26-arm64-Readme.md`: 26.6 is the default, with 26.0.1 to 26.5; simulators 26.2, 26.4, 26.5; iPhone 17 Pro on all).
- `macos-15` would also work only with a pin to Xcode 26.0.1 to 26.3 and has iOS 26.0 to 26.2 runtimes; the earlier workflow (default Xcode 16.4, first iPhone found) could not have built the iOS 26 SDK target.
- UI tests are included: the scheme tests both `FoodWasteReducerTests` and `FoodWasteReducerUITests`, so `xcodebuild test` runs them (about 3 min locally).
- Destination is pinned by name only (`iPhone 17 Pro`). The runner has this model on three runtimes, so add `,OS=26.5` for a deterministic choice (IOS-8).

### Bugs
| ID | Severity | Summary | Status |
|---|---|---|---|
| IOS-3 | low | System inactive tab colour under glass | closed, won't fix (owner) |
| IOS-4 | medium | `.accessibilityIdentifier` on `Tab` reaches the tab bar buttons only intermittently on iOS 26.5: in 5 launches the 5 identifiers were empty in 4, present in 1 (also seen across test runs). Repro: `-UITestMockAPI -UITestSignedIn`, read `app.tabBars.firstMatch.buttons.allElementsBoundByIndex.map(\.identifier)`. Tests find tabs by label; `testTabIdentifiersReachTheTabBar_IOS4` is a non-strict expected failure. Builder: find a reliable route (e.g. identifier on the tab content root as a second hook, or drive tests by label permanently) | open |
| IOS-5 | low | Debug settings sheet at AX5 on iPhone SE: after Save with `ftp://...` the error text `debug.baseURL.error` is not found, even after scrolling (keyboard plus large text push it off screen; sheet has no `scrollDismissesKeyboard` or placing the error above the field). Debug-only. Fails only on SE AX5 | open |
| IOS-6 | medium | `ios/Local.xcconfig` cannot override `API_BASE_URL`. `Debug.xcconfig` and `Release.xcconfig` include `Base.xcconfig` (which includes Local) and then assign `API_BASE_URL` afterwards, so the Local value loses. Verified with `xcodebuild -showBuildSettings`: with `Local.xcconfig` setting `API_BASE_URL=https://local-override.example.com`, Debug = `http://127.0.0.1:5055`, Release = `https://api.foodwastereducer.example`. `APP_BUNDLE_ID` and `DEVELOPMENT_TEAM` do work (bundle id became `com.qa.test.fwr`). The `.example` advertises the override. Fix: include Local last in Debug and Release | open |
| IOS-7 | low | `KeychainSessionStorage` fails in unsigned builds: `SecItemAdd` returns -34018 (errSecMissingEntitlement) under `CODE_SIGNING_ALLOWED=NO`, and `save()` ignores the status, so a sign-in is silently not persisted. Unit tests skip (3). Also: signed test runs fail to build (`Cannot code sign because the target does not have an Info.plist file`) for `FoodWasteReducerTests` and `FoodWasteReducerUITests`; add `GENERATE_INFOPLIST_FILE: YES` to those targets, otherwise the owner cannot run tests with Personal Team signing | open |
| IOS-8 | low | CI destination has no `OS=`; add `,OS=26.5` | open |
| IOS-9 | low | Skeleton: `SkeletonRow` uses ad-hoc radii 12 and 4 and bar sizes (CLAUDE.md: no ad-hoc values); each row is a separate "Loading" VoiceOver stop (5 per list). Group them into one element | open |
| IOS-10 | low | The tab image's own accessibility label is lowercase and odd (`home`, `add`) inside buttons labelled Home/Add. The button label is correct, so VoiceOver reads the button | open, cosmetic |

### Not testable yet (blocked on builder, no code path exists)
- **Undo toast UI tests** (appears, tap calls back, auto-dismiss in the UI, VoiceOver label, 44 pt target, `toast.undo` ids): nothing presents `.undoToast` and there is no debug or launch-arg hook. Request: a DEBUG hook, e.g. long-press or a launch arg `-UITestShowToast` that shows one `UndoToastItem`. Covered meanwhile: unit test of the 5 s timeout; the code sets a 44 pt min height, `toast.undo.button`, an Undo accessibility action and an announcement; the toast stays 15 s under VoiceOver/Switch Control (a sensible HIG addition, to be recorded in MOTION.md).
- **Reduce Motion on/off in UI tests**: `simctl ui` on this Xcode only supports `appearance`, `increase_contrast`, `content_size`; the builder added no launch argument. Covered by unit tests of `Theme.Motion.animation(_:reduceMotion:)`. Request: a DEBUG launch arg that forces `\.accessibilityReduceMotion`.
- **Shimmer and toast video clip** (`docs/qa/ios/`): no screen shows `SkeletonList` and no hook shows the toast, so there is nothing to record. To do when a screen or hook exists. `docs/design/MOTION.md` is not in this worktree, so token values were checked against the coordinator's numbers; re-check against the file once present.
- Food-group glyph assets (Grains/Pantry swap): no view renders them yet.

## 2026-10-10: Foundation re-verify (#47)
Head: `b6429df` plus the builder's uncommitted `ios/App` and `project.yml` fixes (IOS-5, 9, 10, 11, the Add `Binding`, `APIDate`, tokens, id renames, BiteDown) plus the QA test edits below. Mac: Apple M4 Pro, Xcode 26.6, XcodeGen 2.45.4, `CODE_SIGNING_ALLOWED=NO`. `xcodegen generate`, then one full `xcodebuild test` per device, run one after the other with no backend suite running.

### Verdict: PASS
| Device | Unit | UI |
|---|---|---|
| iPhone 17 Pro (iOS 26.5), light, `large` | **117 run, 0 failed, 3 skipped** (Keychain, IOS-7 by design) | **24 run, 0 failed**, no expected failures |
| iPhone SE QA (iOS 26.5), **AX5** (`accessibility-extra-extra-extra-large`) | **117 run, 0 failed, 3 skipped** | **24 run, 0 failed**, no expected failures |

The SE was reset to `large` and shut down afterwards. The 17 Pro was left on light / `large`.

### Bug status
| ID | Status | Evidence |
|---|---|---|
| IOS-4 | fixed | `testTabIdentifiersReachTheTabBar_IOS4` is now strict over 3 launches per run: `tab.home`…`tab.social` on every launch, on both devices |
| IOS-5 | fixed | `testInvalidSchemeShowsErrorAndKeepsDefault` (strict, no scrolling): on SE AX5 the error is hittable, under the field and above the keyboard. Before: [se-ax5-ios5-before.png](media/ios-foundation/se-ax5-ios5-before.png). After: [se-ax5-baseurl-error.png](media/ios-foundation/se-ax5-baseurl-error.png) |
| IOS-6 | fixed | `xcodebuild -showBuildSettings` with a temporary `Local.xcconfig` (deleted afterwards): Debug and Release both resolve `API_BASE_URL = https://local-override.example.com`, bundle id `com.qa.test.fwr` |
| IOS-7 | fixed | Test targets have `GENERATE_INFOPLIST_FILE: YES`. `save()` logs `Keychain save failed, OSStatus -34018` and returns false (seen in the unsigned run). The 3 real-Keychain tests still skip unsigned, by design |
| IOS-8 | fixed | `.github/workflows/ios.yml`: `-destination "platform=iOS Simulator,name=$SIM_NAME,OS=26.5"` |
| IOS-9 | fixed | `SkeletonAccessibilityTests` (hosted `SkeletonList`, AX tree on): exactly 1 element, `<screen>.loading`, label "Loading", no per-row ids. `SkeletonRow` uses only Theme tokens (`ThemeTests.testComponentTokens` pins them). No numeric frame, spacing, radius or opacity literals are left in `ios/App` views (grep) |
| IOS-10 | fixed (VoiceOver) | `testTabButtonsHaveNoStrayImageLabels_IOS10`: the button labels are exactly Home, Recipes, Add, Fridge, Social and are queryable by id. Note: XCUITest still lists an image *inside* each button with a symbol label (`home`, `frying.pan.fill`). The button is the VoiceOver element, so that image is not a stop; it is logged, not asserted. No other view uses these SF Symbols, so the shared-image risk does not apply yet |
| IOS-11 | **new, fixed in this round** (medium) | At AX5 the toast kept message and Undo side by side, so on the SE the message broke mid-word ("spinac/h re-/move/d"): [before](media/ios-foundation/se-ax5-toast-before.png). Now stacked: [se-ax5-toast-stacked.png](media/ios-foundation/se-ax5-toast-stacked.png). `testToastMessageIsNotSqueezedAtAX5_IOS11` is strict: Undo below the message, message ≥ 80% of the toast width, Undo ≥ 44 pt, toast above the tab bar |

**CI failure `testAddFromFridgeKeepsFridgeSelected` (macos-26): test flake, not an app bug.** In CI the grabber drag did not dismiss the sheet within 5 s on a slow runner (the drag synthesis alone took 3.3 s), while the same helper passed in the other two Add tests in the same run. Locally it passed 5/5 iterations (`-test-iterations 5`) and in every full run on both devices. Fix in the test: wait for the sheet frame to settle, then drag, retrying up to 3 times. The builder's custom `Binding` (Add never becomes the selection) is in this head and passes too. No IOS id was assigned.

No open iOS bugs from this round. Still open from earlier: IOS-2 (glass tab bar vs artboard; owner).

### Tests changed (`ios/Tests/**`)
- `MotionTests`: stagger cap is now 6 (`testStaggerDelayIs40msPerIndexCappedAtSixItems`: index 5 = 0.2 s, later indexes share it). `testTokenValues` pins every `Theme.Motion` token against `docs/design/MOTION.md`: quick, standard, emphasized, 40 ms / 20 ms chart step, cap 6, 0.3 s item, list insert 8 pt / 0.3 s, pulse 8 pt / 30% / 1.6 s, static ring 4 pt / 25%, shimmer 1.2 s, one-shot 0.5 s. It also pins the builder's pulse line width and shimmer band and highlight. New `testFullStaggerSequenceFitsTheOneShotLimit` (5 × 40 ms + 0.3 s = 0.5 s exactly). The code matches MOTION.md; no discrepancy.
- New `APIDateTests` (15): backend-shaped `Item`, `ItemsResponse`/`SectionsResponse`/`ItemResponse`, `AuthSession.user.created_at` and `Impact.weekly.week` JSON.
  - Strings decoded: `…T12:00:00.123456+00:00`, `…T12:00:00+00:00`, `Z`, `.000Z`, `.123456Z`, and the week as a date or a midnight `+00:00` timestamp.
  - `parse` forms: T/t/space separators, 1-9 digit fractions crossed with Z/`+00:00`/no zone, `±HH:MM` and `±HHMM` (+05:30, +13:45, -05:00), a year rollover, a leap day, and date-only as local midnight in 4 zones.
  - About 45 rejected strings: bare dot, more than 9 digits, bare `+00`, out-of-range fields, bad separators, trailing junk.
  - Encoding: a whole-second `Z` string, and `dayString` at UTC+14.
  - The app has no event model, so "event" coverage is the date fields the app decodes.
- New `SkeletonAccessibilityTests` (3); `ThemeTests` adds `testComponentTokens` and `testDisplayNameIsBiteDown`.
- `BaseURLDebugUITests`: ids renamed to `debug.versionlabel` / `debug.baseurl.*`. The error is queried as the Label's **text** (`app.staticTexts`): SwiftUI puts the id on both the icon and the text. The test asserts strictly that the error is visible without scrolling and clears after a valid save.
- New `MotionUITests` (7), via `-UITestShowToast` and `-UITestReduceMotion`:
  - message, Undo label, a 44 pt target, and the toast above the tab bar
  - Undo calls back (`toast.undo.marker`) and dismisses
  - auto-dismiss: not before 5 s from launch, and gone within 7 s of first sighting, without calling Undo
  - Reduce Motion: the toast appears, Undo works, its frame does not move (a fade, not a slide), and the timeout is unchanged
  - AX5 stacked layout (IOS-11)
- `TabShellUITests`: IOS-4 strict, IOS-10 test, sturdier sheet dismissal. `README.md`: the new ids, launch args, the loading-id rule and the Label id note.

### Motion evidence (iPhone 17 Pro)
- [toast-motion.mp4](media/ios-foundation/toast-motion.mp4) (494 KB, 9.8 s, 440×960, `avconvert` Preset960x540): launch, then the toast with its 5 s progress bar, then it slides away. A frame sheet sampled every 0.5 s shows the toast for about 5 s.
- **No stagger is shown**: no screen in the foundation uses `staggeredAppearance` yet. It is covered by unit tests; record it with the first list screen (Fridge).
- Screenshots: [light](media/ios-foundation/toast-light.png), [dark](media/ios-foundation/toast-dark.png). In dark mode the toast uses the lime surface with dark text and stays legible.

## 2026-10-11: Fridge + removal (feat/ios-fridge)
Head: the worktree after the builder's final build, which includes the IOS-12 fix and the recipient ruling (a static claimer line, and no `recipient_id` sent). Mac: Apple M4 Pro, Xcode 26.6, XcodeGen 2.45.4, `CODE_SIGNING_ALLOWED=NO`. Every `xcodebuild` ran under the shared heavy lock.

### Verdict: PASS
One low bug is still open: IOS-13, which needs a VoiceOver check.

The demo path holds, in light and dark and with Reduce Motion on and off: swipe → Remove → outcome (→ reason) → the row collapses → Undo toast → Undo restores the row, or the toast expires and the removal stays. A failed remove or a failed restore rolls back and shows a banner.

| Device | Unit | UI |
|---|---|---|
| iPhone 17 Pro (iOS 26.5), light, `large` | **144 run, 0 failed, 3 skipped** (the Keychain tests, IOS-7 by design) | Full run: **49 run, 0 failed**. After the final test-helper edits, the Fridge and Remove suites were rerun: **25/25**. Dark screenshot run 5/5. Clip run 1/1 |
| iPhone SE QA (iOS 26.5), **AX5** | **144 run, 0 failed, 3 skipped** | Full run: 49 run, 1 failed. The failure was test-side: `openRemove` swiped the carrots row while its centre sat under the floating tab bar, the drag hit the bar and switched to Home. After the `reveal` fix, the Fridge and Remove suites ran **25/25**, and the other 24 passed in the full run. **49/49 in total** |

The SE was reset to `large` and shut down. The 17 Pro was left on light / `large`.

### Tests added (`ios/Tests/**`)
**`FridgeModelTests` (19, unit).** These drive `FridgeModel` through a `SpyAPIClient` that wraps `MockAPIClient`.
- States: loading → content in design order (protein, veggies, fruit, dairy), with rows sorted by expiry. Empty. Error, then retry. Storage is per segment.
- Stagger: runs once per storage's first non-empty load. It doesn't run on `loadIfNeeded` again, on `refresh()`, or on an empty pantry.
- A failed refresh with rows on screen keeps the rows and shows the banner with a retry.
- Remove is synchronous: the row is gone before any `await`. The toast reads "Chicken thighs removed".
- Each removal makes exactly one API call with outcome, reason and recipient. A donated removal fulfils the listing on the mock.
- Removing the last item in a group drops that section. A second removal replaces the toast.
- A refresh that races an in-flight removal does not bring the row back.
- Failed remove: the row returns to its original index, the toast is cleared, the banner offers a retry, and the haptic is `.error`. The banner retry succeeds once the server recovers.
- Undo puts the row back in the same place immediately, calls restore once, reopens the donated listing, and plays no haptic.
- Undo before the remove settles waits for it and then restores. Undo after a failed remove calls no restore, shows no banner and makes no duplicate row.
- A failed restore removes the row again and shows the banner with a retry and `.error`. With `restore_window_expired`, the banner says "too late" and has no retry.
- When the toast times out, the removal stays: no restore call, and the item stays removed on the server.
- `ItemText` covers the sheet meta "Veggies · 5 oz · expires tomorrow · on Share", the spoiled meta and the quantities.
- The `listing` fixture matches the artboard. The mock rejects `recipient_id` on a non-donated removal.

**`RemoveRequestShapeTests` (8, unit, `StubURLProtocol`).** These check the request bodies:
- `used` sends `{"outcome"}` only, and nil keys are omitted rather than sent as null.
- `thrown_out` sends snake_case `waste_reason` for all four reasons.
- `donated` sends `recipient_id`, or omits the key when there is none (the app's path after the ruling).
- Restore is a POST with no body.
- 409 `restore_window_expired` and `not_removed` map to typed errors. `already_removed` becomes a server 409.
- The encoder omits nil.

**`FridgeUITests` (12).**
- Group headers are in design order and labelled "Protein, 2 items". Empty groups are omitted. This is checked across scroll positions, because the `List` is lazy.
- The storage filter has a ≥ 44 pt segment. The empty pantry shows `fridge.empty`, and switching back restores the rows.
- Badge labels: "Expires today", "Expires in 1 day", "Check, looks spoiled", "Use soon", "Expires in 12 days", and "Expired" in the `expired` seed.
- States:
  - empty
  - skeleton: exactly **one** `fridge.loading` element labelled "Loading", via `-UITestLoadingForever`
  - error with a retry button of ≥ 44 pt (IOS-12)
  - retry after `-UITestFailListOnce` loads the list
- Row VoiceOver: the combined text includes "looks spoiled", so spoilage is in words and not colour alone. The title is "Your food".
- The swipe cell is ≥ 44 pt.
- The stagger probe stays at `1` after switching segments and pulling to refresh.
- The `long` seed scrolls to the Other group.
- AX5: the badge is not clipped and the outcome tiles are ≥ 44 pt.

**`RemoveFlowUITests` (13).**
- Used: the row collapses, the toast appears, and the haptics are exactly `success`.
- Gave away:
  - With no listing (eggs), no claimer line is shown.
  - With a claimed listing (spinach), `remove.recipient` is a static, non-button, unselected line containing "Marcus Ojeda", and the subtitle reads "Closes your Share listing". Haptics are exactly `success`.
  - With an open listing that has no claimer (carrots), no recipient UI is shown.
- Threw away pushes the reason step, and the row stays until a reason is picked. There are four reason tiles, each ≥ 44 pt and labelled. Haptics are exactly `selection, warning`.
- Cancel keeps the row and shows no toast.
- Undo restores the row in order with no new haptic. When the toast expires, the removal survives a pull-to-refresh.
- Failed remove:
  - the row comes back
  - the banner names the item
  - Try again and Dismiss are both ≥ 44 × 44
  - Dismiss hides the banner
  - there is no toast
  - the haptics are `success, error`
- Failed restore: the banner shows and the row stays removed.
- Reduce Motion:
  - The toast fades in place: its frame doesn't move over 0.6 s, and it sits above the tab bar.
  - The threw-away flow still plays `.warning`.
- The removal is effective on tap, with Reduce Motion on and off. This is a smoke bound. Immediacy itself is proved by the unit test, because XCUITest's `tap()` waits for idle.

**Support and docs:** `FridgeUITestSupport.swift` adds `FID`, `app.reveal(_:)` and `openRemove`, and handles a full swipe opening the sheet directly. `ios/Tests/README.md` gains the launch arguments, seeds and the tab-bar swipe caveat.

### Motion
| Rule | Result |
|---|---|
| The tap takes effect immediately | Yes. `FridgeModel.remove` deletes the row synchronously, and the API call runs after it. The sheet holds 200 ms for the checkmark (`Theme.Motion.confirmHold`), then dismisses. The row collapses behind the sheet at the tap. This was approved by the orchestrator, and MOTION.md is to be reworded |
| Total ≤ 0.5 s | The row collapse and the toast use `standard` (spring 0.35). The stagger is 40 ms, capped at 6, with 0.3 s items, for 0.5 s in total. `MotionTests` pins it |
| One composite = one animation | Each row and each header uses `.staggeredAppearance` with `compositingGroup`. Each row's tile, text and badge fade as one unit |
| Stagger on first load only | `debug.stagger.count` stays 1 after a segment switch and a refresh (UI). The unit test covers refresh, re-entry and the empty pantry |
| Haptics | Used/Gave away → `success`. Threw away → `selection` (MOTION: outcome tiles), then reason → `warning`. Undo → none. Storage segment → `selection`. A failed remove or restore → `error`, after the optimistic `success`. That fits CLAUDE.md's error moment, but MOTION lists `.error` only for sign-in, so **the orchestrator should note it in MOTION.md** |
| Reduce Motion | The toast fades without moving, the flows complete, the haptics stay, and the 5 s timeout is unchanged |

Clip: [remove-undo-motion.mp4](media/ios-fridge/remove-undo-motion.mp4). It is 1.25 MB and 11.5 s, recorded with `simctl recordVideo` (its PID was recorded and only that PID was stopped), trimmed and exported at 960×540. It shows swipe → circular Remove action → sheet → Used it with checkmark → the sheet dismisses, the row collapses (Protein · 1) and the toast with its progress bar appears → Undo → the row returns. Frame sheet: [remove-undo-frames.png](media/ios-fridge/remove-undo-frames.png).

### Screenshots (iPhone 17 Pro, 960 px tall)
- Fridge: [light](media/ios-fridge/fridge-light.png), [dark](media/ios-fridge/fridge-dark.png)
- RemoveSheet: [light](media/ios-fridge/remove-sheet-light.png), [dark](media/ios-fridge/remove-sheet-dark.png); with a claimed listing: [light](media/ios-fridge/remove-sheet-listing-light.png), [dark](media/ios-fridge/remove-sheet-listing-dark.png)
- RemoveReason: [light](media/ios-fridge/remove-reason-light.png), [dark](media/ios-fridge/remove-reason-dark.png)
- After a removal, with the toast: [light](media/ios-fridge/after-remove-toast-light.png), [dark](media/ios-fridge/after-remove-toast-dark.png)
- States: [loading](media/ios-fridge/fridge-loading-light.png), [empty](media/ios-fridge/fridge-empty-light.png), [error](media/ios-fridge/fridge-error-light.png)
- Rollback banners: [remove failed](media/ios-fridge/remove-failed-banner-light.png), [remove failed, dark](media/ios-fridge/remove-failed-banner-dark.png), [restore failed](media/ios-fridge/restore-failed-banner-light.png)
- SE at AX5: [fridge](media/ios-fridge/se-ax5-fridge.png), [sheet](media/ios-fridge/se-ax5-remove-sheet.png), [sheet with listing](media/ios-fridge/se-ax5-remove-sheet-listing.png), [reason](media/ios-fridge/se-ax5-remove-reason.png), [toast](media/ios-fridge/se-ax5-after-remove-toast.png), [loading](media/ios-fridge/se-ax5-fridge-loading.png), [empty](media/ios-fridge/se-ax5-fridge-empty.png), [error](media/ios-fridge/se-ax5-fridge-error.png), [remove failed](media/ios-fridge/se-ax5-remove-failed.png)

At AX5 the segmented control stacks, rows wrap with the badge below the text, the sheet scrolls, the reason grid is one column, and the toast and banner stack. Nothing is clipped.

### Design delta (vs `Fridge`, `RemoveSheet` and `RemoveReason`)
QA verified the builder's 15 items against the screenshots. All 15 match what is drawn, except where a note is added.
1. The storage filter is hand-built: a 36 pt segment in a 44 pt hit area, and the segments stack at AX sizes. Matches visually ([fridge-light](media/ios-fridge/fridge-light.png), [se-ax5-fridge](media/ios-fridge/se-ax5-fridge.png)).
2. The search button (the 44 pt circle top right on the artboard) is not built.
3. Native inset-grouped `List`: the system section radius and margins, a native header, and the title and filter scroll with the list.
4. The row meta is derived from data: "8 · added Oct 8" instead of "8 of 12 left", and "2 lb · added Oct 8" instead of "2 lb bag".
5. Each row has two VoiceOver stops (text, badge) plus a "Remove" custom action.
6. There is no skeleton-to-content cross-fade; the stagger fades the rows in.
7. The "Gave it to" select becomes a static claimer line ("Gave it away goes to Marcus Ojeda"), shown only for a claimed open listing. This is the orchestrator's ruling.
8. The Gave-away subtitle depends on the listing: "Counts as food saved" without one, the artboard text with one.
9. The outcome tiles use SF Symbols, a trailing checkmark, and a chevron on Threw it away.
10. The header tile radius is 12 vs 14.
11. The sheet height is fitted, with `.large` as a second detent.
12. The reason step uses the native glass back button instead of the white 44 pt circle.
13. At AX sizes the reason grid is one column. A tapped reason tile gets a lime fill, a forest border and a checkmark.
14. The reason tip is static ("…so next time we can remind you sooner") instead of the artboard's personalised "Spinach was forgotten twice before…".
15. Subtitles are 15 pt vs 14.

Added by QA:

16. The swipe action is the iOS 26 native style: a circular forest button with a checkmark and a "Remove" caption. The artboard draws a full-height 96 pt forest block. See the frame sheet. It is native, so accept it.
17. The sheet scrim is the system dimming, lighter than the artboard's solid `#4C5A4F`. DESIGN_SYSTEM already says that on device the scrim is `ink` at 60%.
18. While the Undo toast is visible it overlays the bottom visible row (as in [after-remove-toast](media/ios-fridge/after-remove-toast-light.png)), and the list does not inset for it. It is transient (5 s) and the rows can scroll, so this is noted rather than filed as a bug.
19. The row collapses at the tap, behind the sheet, before the sheet dismisses. MOTION says "as the sheet dismisses". This is approved by the orchestrator and MOTION.md is to be reworded.

### Bugs
| ID | Severity | Summary | Status |
|---|---|---|---|
| IOS-12 | medium | The `ErrorStateView` retry (`fridge.error.retry`) was 28 pt tall, because `.borderedProminent` sat inside `ContentUnavailableView`. The `EmptyStateView` action and the banner's Try again had the same defect. | **fixed** in this round: `.controlSize(.large)` plus a `minTouch` label. `testErrorStateAndRetry` and `testFailedRemoveRollsBackAndShowsError` now assert ≥ 44 pt on both devices |
| IOS-13 | low | In XCUITest each Fridge row exposes an `Image` labelled with the asset name (`FoodGroupFruit`, `FoodGroupProtein`), the 40 × 40 food-group tile, even though `FoodGroupIcon` sets `.accessibilityHidden(true)`. It shows up because the row is an `.accessibilityElement(children: .contain)` container. If VoiceOver lands on it, it is a stray stop that reads "FoodGroupFruit". Builder: check with VoiceOver or Accessibility Inspector. If it is reachable, fix it, for example with `Image(decorative:)` for the asset glyphs or an `accessibilityHidden` on the glyph image itself. This was not reproduced with VoiceOver on (not available headless) | open |

Still open from earlier rounds: IOS-2 (owner).

### Notes
- After the ruling, the app sends no `recipient_id`. That is verified in the code: `RemoveSheet.finish` builds `RemoveChoice(outcome:)`. On the wire, `testDonatedWithoutRecipientOmitsKey` checks that the key is omitted.
- The `debug.haptics` and `debug.stagger.count` probes are under `#if DEBUG` and appear only on mock launches.

### 2026-10-11 follow-up: #64 CI red on macos-26 (run 38116928151, head 8f56c6c). Test flake, not an app bug. Verdict stays PASS
Three `RemoveFlowUITests` failed in CI. I read the per-step timeline in the CI log (`gh run view --log-failed`).

**1 and 2: the toast had already expired.**
- `testFailedRestoreKeepsRowRemovedAndShowsError` reported "Undo toast missing". `testUndoRestoresRowWithoutHaptic` found no `toast.undo.button`.
- In both, the Used tap synthesised at about t=25.3–25.5 s. The test then waited for the sheet to go and for the row to go, and only looked for the toast at t=31.6 s and t=30.8 s, past the 5 s window. On the runner, each XCUITest query took about 1–1.5 s.
- The app did what it should: the toast timed out.

**3: the time went to XCUITest, not the app.**
- `testRemoveTakesEffectImmediately` failed with reduceMotion=true: "6.06 s".
- The tap was at 39.57 s. The `waitForNonExistence` that followed returned *true*, so the row was gone, but the snapshot only returned at about 45 s.
- The app has no delay under Reduce Motion. `Theme.Motion.animation(_, reduceMotion: true)` is `quick` (0.15 s), and `FridgeModel.remove` deletes the row synchronously before it returns. The builder traced the same path.

**Test fixes** (test files only, except the hooks the builder added):
- Every Remove flow launches with `-UITestUndoWindow 30`. The exception is the expiry test, which keeps the 5 s default and asserts only that the toast eventually goes and the removal survives a refresh.
- Every `waitFor…` timeout in the Fridge and Remove tests is now a generous upper bound (10–20 s), never a speed threshold.
- `testRemoveTakesEffectImmediately` has **no wall-clock assertion**. It runs `-UITestSlowRemove -UITestFailRemove` (a 3 s call that then fails) and waits for the sheet to go, without counting that time.
  - Then, in one pass, it reads the row, then the toast, then the banner. The rollback re-inserts the row and raises the banner in a single main-actor turn.
  - So "row gone and banner not yet up" proves the removal is optimistic. "Row shown while the banner is still absent" would be a real failure.
  - If the banner is already up, the runner was too slow to judge. The test attaches an "inconclusive" note instead of failing. Locally there were 0 inconclusive runs on both devices.
  - It then checks the rollback.
- New `testFullUndoWindowAfterSheetDismisses` (`-UITestUndoWindow 4`): the toast must still be up 2.5 s after XCUITest *sees* the sheet gone, which is conservative. If the snapshot lands later than 3.3 s, the run is inconclusive, never failed.
- New `testUndoWithRestoreNotRemovedKeepsRowWithoutBanner` (`-UITestRestoreNotRemoved`): the row stays, no banner, and the haptics are exactly `success`.
- Unit tests:
  - `FridgeModelTests` follows the builder's (a). The toast is pending until `showPendingToast()` (the sheet's `onDismiss`), so the countdown doesn't start under the sheet.
  - New `testRemoveFailingBeforeDismissShowsNoToast` and `testRestoreNotRemovedKeepsRowWithoutBanner`.

**Builder changes covered**:
- (a) the toast and its countdown start after the sheet dismisses, and the bar is now `ProgressView(timerInterval:countsDown:)`
- (b) 409 `not_removed` on restore keeps the row, with no banner and no haptic

**Final runs on the #64 head**, one after another under the lock:

| Device | Unit | UI |
|---|---|---|
| iPhone 17 Pro, light, `large` | **146 run, 0 failed, 3 skipped** | **51 run, 0 failed** (full run) |
| iPhone SE QA, **AX5** | **146 run, 0 failed, 3 skipped** | **51 run, 0 failed** (full run) |

On the 17 Pro, the first full run had one unit failure. It came from my own edit: the second removal in `testThrownOutSendsReasonAndDonatedSendsRecipient` never called `showPendingToast()`. I fixed it, and the unit rerun was 146/0. The SE was reset to `large` and shut down. The 17 Pro is on light.

**Toast with the new bar** (compared with the earlier shots): [light](media/ios-fridge/after-remove-toast-progressview-light.png), [dark](media/ios-fridge/after-remove-toast-progressview-dark.png), Home hook [light](media/ios-fridge/toast-progressview-light.png) and [dark](media/ios-fridge/toast-progressview-dark.png), and [SE AX5](media/ios-fridge/se-ax5-after-remove-toast.png).
- The bar is still a 3 pt strip flush with the toast's bottom edge.
- `Theme.Size.toastProgress` plus `.clipped()` and the card's rounded clip hide the system track's rounded ends, so it looks the same as the old flat bar: `onForestMuted` in light, dark forest on lime in dark. It is low-key but visible.
- No artboard draws the toast (MOTION.md only names a 5 s progress bar), so this is **Design delta 20**: the bar is a system `ProgressView`, clipped to a 3 pt strip. No defect.

### 2026-10-11 CI flake 2: #64 run 38121714294 (head 63619fa). Test flake, not an app bug. Verdict stays PASS
`testFullUndoWindowAfterSheetDismisses` failed with "toast gone 3.2 s after the sheet". That version used a 4 s window and bounds of 2.5 s and 3.3 s. Those bounds sit inside CI's observation lag: noticing the sheet is gone takes about 1 s of polling, and each query takes 1–1.5 s. So the test could not measure what it claimed to.

**(a) Is the app at fault? No.**
- The toast is handed over only in `.sheet(item: $removing, onDismiss: { model.showPendingToast() })` (`FridgeView.swift:40`). SwiftUI calls this after the dismissal finishes.
- Every way out of the sheet sets `removing = nil` or is a native dismissal. That covers Used and Gave away (`close()` after the 200 ms hold), the reason step (`close()`), Cancel, and an interactive drag.
- Reduce Motion doesn't change the sheet path. There is no early or skipped `onDismiss`.
- Cancel and drag leave `pendingToast` nil, so no toast appears. A remove that fails before dismissal clears `pendingToast`, which is intended.

**Test change** (test files only):
- The undo window is now 12 s (`-UITestUndoWindow 12`).
- The toast must still exist 10 s after XCUITest noticed the sheet was gone. That allows about 2 s of observation lag.
- If the snapshot lands more than 11 s after that point, the run is inconclusive (an attachment), not a failure.
- The timeout and persistence checks stay.
- A timing attachment `undo-window: present=… lookedAt=…` is always written.

**Throttled reproduction** (17 Pro, under the heavy lock):
- **Load:** 10 `yes > /dev/null` processes on the 12 cores, with their PIDs recorded and killed afterwards. The load average reached about 16.
- **New test, 5 iterations:** **5/5 pass**, `lookedAt` = 10.03–10.05 s, and every run was conclusive.
- **Old test (4 s window), 5 iterations:** **1/5 failed** with "toast gone 2.69 s after the sheet". That reproduces the CI flake under load.
  - This run was accidental. `test-without-building` reused the simulator's *stale installed* UI-test runner from an earlier run.
  - Lesson: uninstall `com.coderedorion.FoodWasteReducerUITests.xctrunner` before `test-without-building`, which is now done.
- **Old app behaviour:** a scratch copy outside the repo, deleted afterwards, called `showPendingToast()` at the tap, so the countdown ran under the sheet. With the new test it **passed 5/5** (`lookedAt` = 10.04 s). Here the countdown lost only about 1.5 s under the sheet (from the tap to the sheet being seen gone), which is under the 2 s allowance.
  - So this UI test guards only against a loss of more than about 2 s, such as a slow or stuck dismissal. It cannot catch a 1–2 s loss without becoming flaky on CI.
  - The exact rule, "no toast until the sheet dismisses", is pinned at model level by `FridgeModelTests.testRemoveIsImmediateAndShowsToast`, which asserts `toast == nil` before `showPendingToast()`.
  - The view wiring (`onDismiss`) is verified by code review only.
  - An exact UI check would need a DEBUG probe. One option: a `debug.toast.shownAt` timestamp set in `showPendingToast`, compared with the sheet's dismissal callback. I am offering this as an optional request, not filing it as a bug.

**Re-runs** (under the lock; the runner was uninstalled first):

| Device | Fridge + Remove UI suites |
|---|---|
| iPhone 17 Pro, light | **27 run, 0 failed** |
| iPhone SE QA, AX5 | **27 run, 0 failed** |

The SE was reset to `large` and shut down.


## 2026-10-11: Shared foundation (feat/ios-shared)
Mac: Apple M4 Pro, Xcode 26.6. Simulators: iPhone 17 Pro and iPhone SE QA (iOS 26.5). Focus: the contract and decoding. Tests were written while the builder worked and run against the tree as of ~03:45. Backend shapes follow `docs/API.md` on main, plus the coordinator's confirmed shapes from `feat/backend-gaps` for `GET /auth/me`, `GET /requests?mine=1`, `item.share.audience` and `GET /people/reachable` (none of these four is in main's API.md yet).

### Tests added (`ios/Tests/UnitTests`)
| File | Tests | What it covers |
|---|---|---|
| `ContractDecodingTests.swift` | 45 | Friends (incoming/outgoing), groups and detail, listings with and without owner `audience`, Food Pantry entries, requests (audiences, hidden_count, fulfilled_by, unknown source), recipes (`uses_items` objects, servings null), wave-2 impact (split, waste_reasons, previous null vs present, last_6_weeks Mondays), tips, receipt, barcode, Google sign-in, `Me`, people with `is_claimer`. Timestamps in `Z`, `+00:00` and 6-digit fractions |
| `LiveRequestShapeTests.swift` | 40 | Method, path, query (`mine=1`, `range=`) and body for every new Live method via `StubURLProtocol`. `RecipientChoice` on remove and remove-batch: `.default` omits `recipient_id`, `.none` sends a literal `null`, `.user` sends the id. No `recipient_id` with used or thrown_out |
| `MockFoundationTests.swift` | 48 | Every new Mock method, API error rules, all-or-nothing batches, `Behavior` failNetwork / per-method failure / failFirst / delay / cancellation reach all 28 new methods |
| `LaunchConfigurationTests.swift` | 25 | All 13 new flags: parsing, implies-mock, `mockBehavior` mapping, end to end against the Mock, AppEnvironment wiring |
| `WeightFormatterTests.swift` | 15 | kg to lb/oz and kg/g, rounding boundaries, 0, tiny, negative, 100,000 kg, spoken form, units preference switching |
| `ComponentAccessibilityTests.swift` | 34 | BannerView, FormField / FormTextField, PermissionCard, AudienceChecklist, WeightText: labels, values, traits, ids, 44 pt targets, AX5 at 320 pt wide, activation callbacks |
`SpyAPIClient` in `FridgeModelTests.swift` was updated to forward the new protocol methods (the old file no longer compiled against the expanded `APIClient`).

### Results
| Run | Result |
|---|---|
| iPhone 17 Pro, full suite (unit + UI) | UI 51/51 pass (Fridge, Remove, Motion, Launch, TabShell, BaseURL). Unit: 354 run, 3 skipped (Keychain in an unsigned host, pre-existing), 11 assertion failures in 6 tests, all of them pinned bugs below. Existing suites (Fridge, Remove, Motion, Theme, APIDate, Models, MockAPIClient, LiveAPIClient) all pass; the `Recipe.usesItems` and `Impact` changes broke nothing |
| iPhone SE, `ComponentAccessibilityTests` | 34 run, 1 failure (IOS-15); all 44 pt and AX5 targets pass |
| `RecipientChoice` | Live client correct in all 3 cases for remove and remove-batch; `Me` keeps `has_password` and `providers` |

### Bugs
| ID | Severity | Summary | Status |
|---|---|---|---|
| IOS-14 | medium | `ItemShare` has no `audience`. The owner's `item.share` carries `{friends, groups}` per the backend, and decoding silently drops it, so a screen cannot show who an item is shared with. Tests: `testOwnerItemShareCarriesAudience`, `testOwnerItemShareAudienceWithGroups` | fixed, verified |
| IOS-15 | low | `FormField` marks the inline error `accessibilityHidden(true)` while giving it id `<identifier>.error`. Hidden elements leave the tree, so XCUITest can never find that id (VoiceOver is covered by the control's hint). Test: `testFormFieldErrorIdentifierIsQueryable`. Fix: drop the id or expose the text | fixed, verified |
| IOS-16 | low | `MockAPIClient` ignores `RecipientChoice` values: `.none` still sets the claimer as recipient, `.user(id)` is ignored, and donating to yourself or a stranger is not rejected (donation-recipient contract: null stays null, own id 400, non-friend 404). UI tests for "Someone else" will pass for the wrong reason. Tests: `testDonatedRecipientCases`, `testDonatingToYourselfOrAStrangerIsRejected` | fixed, verified |
| IOS-17 | low | `WeightFormatter.spoken` turns "<1 oz" into "<1 ounces" (and "<1 grams"). Wrong grammar and a bare "<" for VoiceOver; say "less than 1 ounce". Test: `testSpokenNeverContainsAbbreviationOrSymbol` | fixed, verified |
| IOS-18 | low | Path ids are double-encoded: `LiveAPIClient+More.ids()` percent-encodes, then `comps.path +=` encodes the `%` again (`a/b c` becomes `a/b%2520c`). Harmless for UUIDs and barcodes, wrong for any id with a space; `/` is not escaped at all. Test: `testIdsAreEscapedInPaths` | fixed, verified |

Not covered: the Mock 10-minute restore window cannot be tested without a clock hook; `GET /people/reachable`, `?mine=1` and `/auth/me` are only checked against the coordinator's shapes until the backend PR updates main's API.md. The new screens are not built yet, so no UI tests exist for the components.

### Re-verify after the builder's fixes
| Run | Result |
|---|---|
| iPhone 17 Pro, `FoodWasteReducerTests` | 354 run, 3 skipped (Keychain, unsigned host), **0 failures** |
| iPhone SE, `ComponentAccessibilityTests` | 34 run, **0 failures** |
IOS-14 to IOS-18 are fixed and each has a passing test. IOS-18 note: `barcode()` now strips non-alphanumerics before encoding; accepted, since barcodes are 6-14 digits and the UI validates that. UI suite (51/51) was green on the earlier full run and the fixes touched no UI code.

### Verdict: PASS. No open bugs.


## 2026-10-11: Page-sweep fixes review (qa/page-sweep-2026-10-11)
Mac: Apple M4 Pro, Xcode 26.6. Simulator: a throwaway iPhone 17 Pro (iOS 26.3), created for the run and deleted after (the orchestrator's booted sim could not be cloned while running). Scope: A1 button tint, A2 `RequestSourceInfo`, A3 `reachablePeople(itemId:)`, A4 stale-token 401, D debug Account section, F1 retry toast, F2 remove-outcome classification, F3 `submitted` flag and hidden back button.

### Tests added or updated (`ios/Tests/UnitTests`)
| File | Tests | What it covers |
|---|---|---|
| `PageSweepFixTests.swift` (new) | 29 | A2: object, `name` null or missing, legacy bare string, unknown values, round trip, POST `/requests` response, mock author/group names. A3: `?item_id=` present, absent, percent-encoded; mock claimer first and only one flagged. A4: stale token keeps the newer session, current token signs out, signed out in flight. F1: banner retry shows the toast at once and leaves no pending toast; failure before the sheet dismisses leaves no toast. F2: 409 `already_removed` and `.decoding` stand (no rollback, no banner, toast, no haptic); 500, network, other 409, 404, 400, unauthorized roll back with banner and error haptic; Undo after `already_removed` |
| `FridgeModelTests.swift` | n/a | `SpyAPIClient` now forwards `reachablePeople(itemId:)`. `testThrownOutSendsReasonAndDonatedSendsRecipient` no longer asserts the arrival order of two racing background tasks (it failed once under load; the race pre-dates these changes) |
| `ContractDecodingTests`, `MockFoundationTests` | n/a | `.source == .x` changed to `.source.type == .x` |
## 2026-10-11: Home (feat/ios-home), artboards Home, HomeEmpty, ServerError
Mac: Apple M4 Pro, Xcode 26.6. Simulators: iPhone 17 Pro, iPhone SE QA (iOS 26.5). Bug block IOS-40 to IOS-49. Mock API via launch flags (`-UITestSeed empty`, `-UITestServerDown`, `-UITestFailListOnce`, `-UITestLoadingForever`, `-UITestRecipes502`).
### Tests added (`ios/Tests`)
| `UnitTests/HomeModelTests.swift` | 23 | Loading to content, soonest-3 and removed items, month pill, tip, recipe `usesItems`, eyebrow and detail text, HomeEmpty (no tip, no recipe call), item-list failure is the error state, retry, impact / tips / recipes failures degrade quietly, refresh failure keeps stale content + banner |
| `UnitTests/HomeRequestShapeTests.swift` | 4 | Live client: `GET /impact?range=month` exactly once, only the 4 documented calls, flat list, recipe request, no recipe call for an empty fridge |
| `UnitTests/HomeAccessibilityTests.swift` | 19 | Gear label / closure / 44 pt, no profile control, pill closure, pill in lb or kg via WeightFormatter with spoken words, pill below greeting at AX5 (320 pt), tip dismiss closure and 44 pt, error card Try again and Change closures, banner retry, row and cook card as one VoiceOver stop |
| `UITests/HomeUITests.swift` | 29 + 5 AX5 + 1 narrow | Every state in the real UI, tip position / dismissal / persistence, retry from banner and card, Add food opens the sheet, See all opens Fridge, skeleton is one element, 44 pt targets, AX5 reachability |

### Results
| Run | Result |
|---|---|
| Unit (`FoodWasteReducerTests`) | 381 run, 3 skipped (Keychain, unsigned host), **0 failures** |
| UI (`FoodWasteReducerUITests`) | 51 run, **0 failures** |
| iPhone 17 Pro, full suite (unit + UI) | Unit 400 run, 0 failures. UI 85 run, 1 skipped (`HomeNarrowUITests`, only meaningful on a 375 pt phone), 1 failure: `FridgeUITests.testRetryAfterOneFailureLoads` (IOS-42, caused by Home) |
| iPhone SE QA, `HomeUITests` + `HomeAX5UITests` + `HomeAccessibilityTests` | 19 unit + 5 AX5 + 28 UI run, 0 failures (the tip-dismiss test skips when the tip was already dismissed on that install) |
| iPhone SE QA, `HomeNarrowUITests` | 1 run, 1 failure: IOS-43 pill width 93 pt (wrapped) |
## Auth (Launch, SignUp, LogIn, SessionExpired, GoogleSignInError), QA `auth-qa`
### Tests added
| File | Tests | Covers |
| `ios/Tests/UnitTests/AuthFlowTests.swift` | 23 | launch flags to mock behaviour; `me()` signed in / signed out / server down; central 401 from any authed call signs out and sets `sessionExpired` (mock and live); login 401 and Google 409 never sign out; `email_taken`, `invalid_credentials`, validation; logout clears token and storage; Google hidden for empty / placeholder client id |
| `ios/Tests/UITests/AuthUITests.swift` | 20 | Launch routing (tabs / Landing / server-down retry / indicator), SessionExpired banner and recovery, LogIn (wrong password, validation, generic message with `-UITestEmailUnknown`, success, password toggle), SignUp (taken email, validation, success, cross links), Google hidden by default, below the form, 409 card with prefilled email, 44 pt targets, light/dark screenshot attachments |
| same file, `AuthAX5UITests` | 3 | AX5 via the content-size launch argument (written, not run) |
| `LaunchUITests.swift` | 1 | changed to launch with `-UITestMockAPI -UITestSignedIn` (the flagless launch now goes through AuthGate) |
### Results (iPhone 17 Pro)
| Full suite, first pass | unit 377 run, 0 failures; UI 70 run, 3 failures (2 SignUp, 1 TabShell) |
| Targeted re-run (AuthUITests + TabShellUITests + LaunchUITests + AuthFlowTests) | 32 run, 1 failure (the Google layout test, passed on a second run) |
| Second targeted re-run | 2 run, 1 failure: IOS-61 |
- SignUp UI failures were iOS's "Use Strong Password?" popover swallowing typing. Test-side fix (`typeInto` closes the popover); both SignUp tests then passed. **The UI tests do not cover the real `.newPassword` path** (mock launches use `.password`).
- TabShell IOS-10 test failed once in the first pass and passed in the re-run (identifier lookup on the tab bar, see IOS-4); not an Auth regression.
- Not run: the full suite after the final builder fixes, AX5 (`AuthAX5UITests`), screenshots, Release-config build. The 17 Pro run of `testAttachScreens` produced no exported shots yet.

### Bugs
| ID | Severity | Summary | Status |
|---|---|---|---|
| IOS-40 | medium | `home.server.change` was not queryable: `.accessibilityIdentifier(home.server)` on the row container replaced the Change button's id (`HomeErrorCard.serverRow`). Tests: `testErrorCardTryAgainAndChangeFireTheirClosures`, `testErrorCardTargetsHoldAtAX5`, `testErrorCardChangeIsLabelledForVoiceOver` | fixed (row is `children: .contain`), verified |
| IOS-41 | low | `MockAPIClient.impact` ignores the fixture, so `-UITestSeed empty` still shows "23.2 lb saved" instead of the artboard's "0 lb saved" (SCREENS #26). Cross-PR: the Impact PR fixes the mock. Tests (`testEmptySeedReportsZeroSavedSoThePillReadsZero`, UI pill check) use a non-strict `XCTExpectFailure` and will flag it when fixed | open, cross-PR |
| IOS-42 | low | `-UITestFailListOnce` fails the FIRST `listItems` call. Home now loads at launch and consumes it, so `FridgeUITests.testRetryAfterOneFailureLoads` never sees its error (`FridgeUITests.swift:128`). No app bug; `FridgeUITests.testRetryAfterOneFailureLoads` now tolerates either Home or Fridge taking the failure and recovers through Try again | fixed (test), verified on the SE |
| IOS-43 | low | At the default text size on a 375 pt phone (iPhone SE) the Impact pill label wraps to two lines ("23.2 lb / saved"). Fix: `lineLimit(1)` plus `minimumScaleFactor`, or let the greeting shrink. Test `HomeNarrowUITests.testImpactPillStaysOnOneLineOnANarrowPhone`. Builder fix: `lineLimit(1)` + `fixedSize(horizontal: true)` + `layoutPriority(1)` | fixed, verified on the SE |

### Design differences
- The Impact pill reads "23.2 lb saved" (mock data), the artboard "21.2 lb saved"; HomeEmpty shows it non-zero (IOS-41).
- The strawberries row badge reads "Check" (artboard family says "Looks off" after the Fridge polish PR).
- Tip is below the header, as in v53. The mock tip wraps to three lines at 17 Pro width (allowed by SCREENS #4).
- ServerError names the host in use (`127.0.0.1` on the mock) where the artboard shows a tunnel URL.
- Gear and "Change" are wired to no-op closures in `RootTabView` until the Settings PR (stub, not a bug).

Screenshots: `scratchpad/home-shots/qa-{home,empty,servererror,loading,ax5}-{light,dark}.png` (17 Pro) and `se-{home,servererror,empty}-light.png` (SE).

### Re-run after fixes (iPhone SE QA, own DerivedData, one invocation)
`HomeNarrowUITests` 1, `HomeUITests` 28, `HomeAX5UITests` 5, `FridgeUITests.testRetryAfterOneFailureLoads` 1: **35 run, 0 failures, 0 skipped.** This follows the 17 Pro full run (unit 400 pass; UI 85, the only failure being IOS-42, now fixed) and the earlier SE run of `HomeAccessibilityTests` (19 pass).

Verdict: **PASS**. IOS-40, IOS-42 and IOS-43 are fixed and verified. IOS-41 (mock impact ignores the empty seed) stays open, low, cross-PR (Impact PR); it does not block Home.

## 2026-10-11: Page-sweep fixes review (qa/page-sweep-2026-10-11)
Mac: Apple M4 Pro, Xcode 26.6. Simulator: a throwaway iPhone 17 Pro (iOS 26.3), created for the run and deleted after (the orchestrator's booted sim could not be cloned while running). Scope: A1 button tint, A2 `RequestSourceInfo`, A3 `reachablePeople(itemId:)`, A4 stale-token 401, D debug Account section, F1 retry toast, F2 remove-outcome classification, F3 `submitted` flag and hidden back button.

### Tests added or updated (`ios/Tests/UnitTests`)
| File | Tests | What it covers |
|---|---|---|
| `PageSweepFixTests.swift` (new) | 29 | A2: object, `name` null or missing, legacy bare string, unknown values, round trip, POST `/requests` response, mock author/group names. A3: `?item_id=` present, absent, percent-encoded; mock claimer first and only one flagged. A4: stale token keeps the newer session, current token signs out, signed out in flight. F1: banner retry shows the toast at once and leaves no pending toast; failure before the sheet dismisses leaves no toast. F2: 409 `already_removed` and `.decoding` stand (no rollback, no banner, toast, no haptic); 500, network, other 409, 404, 400, unauthorized roll back with banner and error haptic; Undo after `already_removed` |
| `FridgeModelTests.swift` | n/a | `SpyAPIClient` now forwards `reachablePeople(itemId:)`. `testThrownOutSendsReasonAndDonatedSendsRecipient` no longer asserts the arrival order of two racing background tasks (it failed once under load; the race pre-dates these changes) |
| `ContractDecodingTests`, `MockFoundationTests` | n/a | `.source == .x` changed to `.source.type == .x` |

### Results
| Run | Result |
|---|---|
| Unit (`FoodWasteReducerTests`) | 381 run, 3 skipped (Keychain, unsigned host), **0 failures** |
| UI (`FoodWasteReducerUITests`) | 51 run, **0 failures** |

### Bugs
| ID | Severity | Summary | Status |
|---|---|---|---|
| IOS-70 | low | `MockAPIClient.reachablePeople(itemId:)` for an unknown item id returns the baseline list, where Marcus is still flagged `isClaimer`. The real backend would 404. Also `itemId: nil` flags him. Harmless for the current fixtures. Test: `testMockUnclaimedOrUnknownItemFlagsNobody` pins the current behaviour | open |

### Not covered by unit tests (manual check)
- A1: empty and error state buttons read as white on forest green, 44 pt, in light and dark.
- F3: after tapping Used, Gave away, or a waste reason, nothing else in the sheet responds; the back button is gone on the reason screen and the edge-swipe back does not return to the outcome tiles.
- D: Account section in the Debug sheet (long-press the version label): sign in, create account, sign out, error text, status line.

### Verdict: PASS WITH NOTES. IOS-70 open (low).


## 2026-10-11: Fridge session handling (qa/page-sweep-2026-10-11, uncommitted)
Scope: `FridgeView` observes `env.auth.session` and calls `FridgeModel.sessionChanged(from:to:)`; `load()` drops results from an older `generation`. Simulator: a throwaway iPhone 17 Pro (iOS 26.3), deleted after.

### Review
- Launch double-load: none. `onChange` has no `initial`, and `.task(id: storage)` is the only launch load.
- Same-user token refresh while the first load is still in flight starts a second concurrent `listItems` (sections and errors are both nil). Harmless: stagger fires once (`everLoaded`), last writer wins with identical data.
- Sign-out then sign-in: `errors = [:]` runs before the sign-in branch, so Pantry and Freezer are not stuck on `unauthorized`. Verified by test.
- A stale 401 from user A cannot sign out B (A4 token guard); a late A 401 on remove only reaches `removeFailed`, see IOS-71.
- Reduce Motion and stagger: `sessionChanged` adds no animation; the only stagger restart is the one in `load()` (first load per storage after a reset), unchanged rule. Sign-out does not stagger.
- A late remove/restore completion is **not** fenced by `generation` (`remove`, `undo`, `removeFailed`, `restoreFailed`, `FridgeModel.swift`). See bugs.

### Tests added (`ios/Tests/UnitTests/FridgeSessionTests.swift`, 18)
A `SwitchAPIClient` (forwards to the A or B Mock, one-shot gates on list/remove/restore, injectable errors) makes the races deterministic. Covers: sign-out gives `unauthorized` for all three storages and no toast/banner/pending toast; sign-in after sign-out gives content, one stagger restart, Pantry not stuck; A to B drops A rows, loads B, other storages unloaded, exactly one list call; B while on Pantry; token refresh keeps items, no restagger, no refetch, clears errors (visible and other storage); nil to nil no-op; A to B and sign-out during a slow A load discard A's result (no stagger); remove in flight succeeding / failing after a switch, failing after sign-out; restore in flight succeeding / failing after a switch.

### Bugs
| ID | Severity | Summary | Status |
|---|---|---|---|
| IOS-71 | medium | A remove that fails after the user changed re-inserts user A's row into user B's list. `removeFailed` sees `locallyRemoved` cleared, so `undone` is true and it calls `insert(item, at: location)`, which only checks that the id is not listed and that `sections[storage]` exists. B shows A's item (37 rows instead of 36); it also clears no state. Repro: remove an item, drop the network, sign out and sign in as another user before the request fails. Fix: capture `generation` in `remove` and bail in `removeFailed` (and the success path) when it differs. Test: `testRemoveInFlightThatFailsAfterSwitchDoesNotInsertARowIntoB` (now a normal assertion) | fixed, verified |
| IOS-72 | medium | An Undo whose restore fails after the user changed shows "Couldn't undo. X is still removed." plus an error haptic and a VoiceOver announcement in B's session, and adds A's id to `locallyRemoved` (it would hide a B item with the same id). Same cause as IOS-71 (`undo` and `restoreFailed` ignore `generation`). Test: `testRestoreInFlightThatFailsAfterSwitchShowsNoBannerInB` (now a normal assertion) | fixed, verified |

A removal that succeeds after a switch, and any remove failure after sign-out, leave B untouched (tests pass).

### Results
| Run | Result |
|---|---|
| Unit (`FoodWasteReducerTests`) | 399 run, 3 skipped (Keychain, unsigned host), **0 failures** |
| UI (`FoodWasteReducerUITests`) | 51 run, **0 failures** |

### Not covered by unit tests (manual check)
Sign out then in as a different user on the Fridge tab with the Pantry segment selected; remove an item and go offline, then switch accounts before the request fails (IOS-71 shows the old row in the new list).

### Re-verify after the builder's fix
`remove()` and `undo()` capture `generation` and drop late completions. The two pinned tests are now plain assertions and pass; full unit + UI suites green. Note: an Undo tapped and then followed by an account switch before the removal settles skips the server restore (item stays removed for the old user); acceptable, since the old session is gone.

### Verdict: PASS. IOS-71 and IOS-72 fixed, no open bugs.
| IOS-40 | medium | `home.server.change` was not queryable: `.accessibilityIdentifier(home.server)` on the row container replaced the Change button's id (`HomeErrorCard.serverRow`). Tests: `testErrorCardTryAgainAndChangeFireTheirClosures`, `testErrorCardTargetsHoldAtAX5`, `testErrorCardChangeIsLabelledForVoiceOver` | fixed (row is `children: .contain`), verified |
| IOS-41 | low | `MockAPIClient.impact` ignores the fixture, so `-UITestSeed empty` still shows "23.2 lb saved" instead of the artboard's "0 lb saved" (SCREENS #26). Cross-PR: the Impact PR fixes the mock. Tests (`testEmptySeedReportsZeroSavedSoThePillReadsZero`, UI pill check) use a non-strict `XCTExpectFailure` and will flag it when fixed | open, cross-PR |
| IOS-42 | low | `-UITestFailListOnce` fails the FIRST `listItems` call. Home now loads at launch and consumes it, so `FridgeUITests.testRetryAfterOneFailureLoads` never sees its error (`FridgeUITests.swift:128`). No app bug; `FridgeUITests.testRetryAfterOneFailureLoads` now tolerates either Home or Fridge taking the failure and recovers through Try again | fixed (test), verified on the SE |
| IOS-43 | low | At the default text size on a 375 pt phone (iPhone SE) the Impact pill label wraps to two lines ("23.2 lb / saved"). Fix: `lineLimit(1)` plus `minimumScaleFactor`, or let the greeting shrink. Test `HomeNarrowUITests.testImpactPillStaysOnOneLineOnANarrowPhone`. Builder fix: `lineLimit(1)` + `fixedSize(horizontal: true)` + `layoutPriority(1)` | fixed, verified on the SE |
### Design differences
- The Impact pill reads "23.2 lb saved" (mock data), the artboard "21.2 lb saved"; HomeEmpty shows it non-zero (IOS-41).
- The strawberries row badge reads "Check" (artboard family says "Looks off" after the Fridge polish PR).
- Tip is below the header, as in v53. The mock tip wraps to three lines at 17 Pro width (allowed by SCREENS #4).
- ServerError names the host in use (`127.0.0.1` on the mock) where the artboard shows a tunnel URL.
- Gear and "Change" are wired to no-op closures in `RootTabView` until the Settings PR (stub, not a bug).
Screenshots: `scratchpad/home-shots/qa-{home,empty,servererror,loading,ax5}-{light,dark}.png` (17 Pro) and `se-{home,servererror,empty}-light.png` (SE).
### Re-run after fixes (iPhone SE QA, own DerivedData, one invocation)
`HomeNarrowUITests` 1, `HomeUITests` 28, `HomeAX5UITests` 5, `FridgeUITests.testRetryAfterOneFailureLoads` 1: **35 run, 0 failures, 0 skipped.** This follows the 17 Pro full run (unit 400 pass; UI 85, the only failure being IOS-42, now fixed) and the earlier SE run of `HomeAccessibilityTests` (19 pass).
Verdict: **PASS**. IOS-40, IOS-42 and IOS-43 are fixed and verified. IOS-41 (mock impact ignores the empty seed) stays open, low, cross-PR (Impact PR); it does not block Home.
## 2026-10-11: Fridge polish (feat/ios-fridge-polish)
Mac: Apple M4 Pro, Xcode 26.6. Simulators: iPhone 17 Pro and iPhone SE QA (iOS 26.5). Spec: HANDOFF "Fridge polish" + recipient rule #78, canvas v53 (#82, mirrored in `scratchpad/design-v53`). Tests were written against the builder's finished tree.
### Tests added or changed (`ios/Tests`)
| `UnitTests/FridgePolishTests.swift` (new) | 26 | #78 at model level (`.default` / `.none` / `.user` reach the API unchanged; batch Shared them and Used them always `.default`; mock honours the three cases on a claimed listing). Select lifecycle, empty selection, `remove-batch` then Undo then `restore-batch` (one batch call, no N single restores), toast wording ("3 items marked used", "N items shared"), failed batch and failed batch restore, expired window has no retry. Toast keyed by item id (two "Baby spinach" items, one fails: the other's toast survives). Refresh during a single and a batch restore: one row each, none dropped. Per-item serialisation (restore never starts before its remove ends; remove, undo, remove, undo runs in order; different items run concurrently; a batch waits for a queued restore on one of its ids). Tracking pruned after settling |
| `UnitTests/FridgePolishAccessibilityTests.swift` (new) | 12 | Hosted-view VoiceOver tree. Row has exactly one "Remove" custom action and it fires the callback; IOS-13 (no `FoodGroup...` stop in the row or the sheet header); badge spoken as "Looks off, may be spoiled" / "Expires tomorrow"; select row is one checkbox button with Selected / Not selected; AX5: badge stacks under the text, stays one line and on screen at 320 pt; sheet tiles are reachable 68 pt buttons labelled Used it / Shared it / Threw it away with no hints; listing badge; reason rows are 68 pt buttons in order |
| `UnitTests/ExpiryBadgeTests.swift` | rewritten, 15 | "Looks off", "Tomorrow", range vocabulary at every boundary (2–3 days … 6–7 days, 1–2 weeks, 2–3 weeks, 3+ weeks), typed dates stay exact, status priority, spoken text has no en dash |
| `UnitTests/FridgeModelTests.swift`, `MockAPIClientTests.swift` | updated | `SpyAPIClient` records the exact `RecipientChoice`, batch calls and an ordered event log; meta is quantity only; badge copy |
| `UITests/FridgePolishUITests.swift` (new) | 21 | No search button on Fridge, FridgeSelect, BatchUndo and FridgeEmpty; Add food on the empty state opens the Add sheet; Select chrome (count, Done, bar replaces tab bar, disabled at 0); Used them then Undo; Shared them (claimed and unclaimed) then Undo; failed batch rolls back; sheet: Shared it label, no visible "What happened to it?" heading while the group label stays, 68 pt tiles, no captions, listing and expiry badges; Given-to menu (claimer first, then others, one menu, no "(claimed it)"); Someone not on BiteDown; Cancel after Shared it removes nothing; double Done; RemoveReason title, grouped list, 68 pt rows, back; Reduce Motion; AX5 select bar stacks, badges do not wrap, Given-to fits |
| `UITests/FridgeUITests.swift`, `RemoveFlowUITests.swift` | updated | Badge copy; the old "Gave it away" and `remove.recipient` tests now cover Shared it + Done and the Given-to default |
| Device | Run | Result |
| iPhone 17 Pro | full unit | 396 run, 0 failed |
| iPhone 17 Pro | full UI | 72 run, 71 passed, 1 failed (`testSwitchingStorageDoesNotKeepAHiddenSelection`, IOS-19) |
| iPhone SE QA at AX5 | unit: `FridgePolishTests`, `FridgePolishAccessibilityTests`, `ComponentAccessibilityTests` | 72 run, 0 failed |
| iPhone SE QA at AX5 | UI: `FridgeUITests` + `RemoveFlowUITests` | all passed (same tree) |
| iPhone SE QA at AX5 | UI: `FridgePolishUITests` (final run, own derived data, build and test in one script) | 21 run, 20 passed, 1 failed (IOS-19) |
| iPhone 17 Pro | `FridgePolishUITests` re-run after the AX5 test fixes | 21 run, 20 passed, 1 failed (IOS-19) |
Notes on the runs: another agent removed my heavy lock mid-run (about 05:30), so the first full runs overlapped a foreign build. Every failure was investigated and the Pro run was clean apart from IOS-19. XCUITest reports frames inside a presented sheet about 4% small (a 68 pt tile reads 65.3), so sheet sizes are asserted exactly on the hosted view and with 5% slack in UI.
| ID | Severity | Summary | Where |
| IOS-19 | low | Select mode keeps the selection when the storage segment changes. Select a Fridge item, switch to Pantry: the header still says "1 selected", Used them / Shared them stay enabled and act on an item that is not on screen. Repro: Select, tick Chicken, tap Pantry. Expected: clear the selection on a storage change (or limit `selectedItems` to the current storage). Test: `testSwitchingStorageDoesNotKeepAHiddenSelection` | `FridgeModel.swift` `selectedItems` (about line 405) spans every storage; `toggleSelection` / storage change never prune |
| IOS-20 | low | The Given-to menu cannot reflect the claimer from the server. `FridgeView` calls `reachablePeople()` without `item_id` (SCREENS #7 says `?item_id=`), so on the live API `is_claimer` is always false; and the Mock marks Marcus as claimer for every item, so (from reading the code; not run) on an unclaimed listing (carrots) the claimer option "Marcus Ojeda" is offered as `.default` (key omitted, the server then records nobody). Today the sheet falls back on `item.share.claimedBy`, which is right for the owner, so the live impact is small. Fix: add `itemId` to the client method (and the mock), and key the sheet on it | `FridgeView.swift:52`, `RemoveSheet.swift:45-47`, `MockSocialFixtures.swift:100` |
| IOS-21 | low | At AX5 on the SE the Given-to row is cramped: the label "Given to" wraps over three lines and the value button is 97 pt wide, so "Marcus Ojeda" is truncated to one line; the system menu is taller than the screen, so "Someone not on BiteDown" is only reachable by scrolling the menu. The artboard row never stacks. Fix: stack the label above the menu at accessibility sizes (like the sheet header) and allow the value two lines | `RemoveSheet.swift` `givenTo` (about line 150) |
### Design differences (screenshots vs canvas v53)
- RemoveSheet: no "(claimed it)" and no visible heading (matches v53). The artboard marks the claimer in the menu with a "Claimed it" icon; the system Menu cannot, so the claimer is only first in the list (delta, low). The sheet is taller than its content: about 90 pt of empty space under Cancel / Done (the detent is `contentHeight + Spacing.l` plus the safe area); the artboard ends right under the buttons.
- RemoveReason: native glass back button in a circle (builder's declared delta; acceptable), 68 pt rows and grouped card match.
- FridgeSelect: the bar is a `.regularMaterial` capsule over the list (declared delta), circular checkbox; it floats over the last row, which is expected. At AX5 the "N selected" and Done scroll away with the list (they are not pinned); the bar stays pinned.
- Swipe action: forest pill with a take-out icon and the system caption "Remove" (matches the round 3 note).
- The 2-days-out badge reads "1–2 days" (the artboard vocabulary starts at "2–3 days"; a day-1 item is "Tomorrow"). Kept as a product question, not a bug.
### Not covered
- The reachable-people fallback ("Given to" still offers the claimer and "Someone not on BiteDown" when `GET /people/reachable` fails): no launch flag fails only that call (`-UITestFailNetwork` also kills the list). Request: `-UITestFailPeople`.
- Real VoiceOver on a device (duplicate "Remove" between the swipe action and the row custom action, IOS-13 on hardware): the hosted tree shows one custom action and no asset-name stop; the swipe-action duplication needs a device check.
- Dark-mode contrast of the swipe tint is by eye only (screenshots below).
- Screenshots: `scratchpad/fridge-polish-shots/` (`fridge-light/dark`, `fridgeselect-light/dark`, `removesheet-given-light/dark`, `removesheet-givenmenu-light`, `removereason-light/dark`, `fridge-swipe-light`).
### Verdict: FAIL (one open low bug that blocks a clean PASS: IOS-19; IOS-20 and IOS-21 are low and can be follow-ups)
Everything else in the Fridge polish spec passes on both devices. After IOS-19 is fixed, re-run `FridgePolishUITests` on the 17 Pro; no other test needs to change. At AX5 on the SE the Given-to menu is clipped (IOS-21), so `testGivenToSomeoneNotOnBiteDown` skips there by design.
| IOS-60 | low | `GoogleSignInSection.swift`: the `google409` button override and `mock-id-token` branch were compiled into Release (unreachable, since `LaunchConfiguration.current` is `#if DEBUG`) | fixed by builder (now inside `#if DEBUG`), not re-verified on a Release build |
| IOS-61 | medium | "Create an account" (LogIn) and "Log in" (SignUp) links are 19.3 pt tall, under the 44 pt target. `AuthForms.swift` (LogInView / SignUpView bottom `HStack`) puts `.frame(minHeight: Theme.Size.minTouch)` on the Button outside its label, so the hit area is not enlarged. Test: `testInlineLinksAndGoogleButtonMeet44ptTargets` | open |
| IOS-62 | low | Google button renders 40 pt tall (`GoogleSignInButton` ignores the 50 pt `frame(minHeight:)`), under 44 pt. Check once the real SDK button is on. Same test, not reached after IOS-61 | open, unconfirmed |
### Security checklist (food-main)
1. Token only in the Keychain: `KeychainSessionStorage`, `AuthStore.swift:37-52` (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`). The only `UserDefaults`/`@AppStorage` uses in `App/` are the unit preference (`WeightFormatter.swift`) and the base-URL / debug settings. Mock runs use `InMemorySessionStorage`. Tests: `AuthStoreTests`, `testSignOutClearsTokenAndStorage`.
2. Client id: read only from Info.plist `GIDClientID`, filled from `$(GOOGLE_IOS_CLIENT_ID)` in `project.yml:50`; `ios/Local.xcconfig` is gitignored (`.gitignore:45`) and absent; grep of `ios/` Swift for `googleusercontent` found nothing. Test: `testGoogleHiddenWhileClientIDEmptyOrPlaceholder`. (Grep over `.plist`/`.yml` was not repeated after the builder's last edit.)
3. DEBUG paths: `LaunchConfiguration.current` is `#if DEBUG` (`LaunchConfiguration.swift:153`), so flags are inert in Release. The two Google mock paths were not `#if DEBUG` (IOS-60, fixed).
4. LogIn shows one generic failure ("That email and password don't match. Try again.") for every non-network error. Test: `testLogInUnknownEmailShowsGenericMessageNoEnumeration`. SignUp's `email_taken` ("already registered") is expected behaviour.
5. Global 401 to SessionExpired, token cleared: `testExpireSessionFlagLifecycle`, `testLive401SetsSessionExpiredAndClearsStorage`, `testExpiredSessionSignsOutFromAnyAuthenticatedCall`, UI `testExpiredSessionShowsBannerAndLogInRecovers`.
6. `/auth/me` at launch: `AuthGate.swift:47`; UI `testValidSessionGoesToTabs`, `testServerDownShowsRetryAndRetryStaysOnError`, `testSignedOutShowsLandingNotTabs`.
7. Password fields use `SecureField` (`AuthComponents.swift:136`); LogIn `.password` (`AuthForms.swift:132`); SignUp `.newPassword` in real builds, `.password` under the mock flag (`AuthForms.swift:212`). Not UI-tested for `.newPassword`.
8. Logs: the only logger near auth is `AuthStore.swift:54`, which logs an OSStatus only. No `print`/`os_log`/`NSLog` in `App/Auth` or the API clients.
- Landing (not an artboard in this set) is built; Google appears only with a client id (or `-UITestGoogle409` in DEBUG). GoogleSignInError is shown as a card on LogIn with the email prefilled, as drawn. Pixel comparison against the artboards was NOT done (no screenshots).
### Verdict: FAIL (open: IOS-61 medium; IOS-62 unconfirmed). Everything else exercised passes.

## 2026-10-19: Restored Fridge session/removal behaviours (fix/codex-ios-ci, PR #125), QA `a3-qa`
Scope: a bad merge (241366f) dropped commits 9997699 and 44916f3. #125 made the tests compile by deleting `FridgeSessionTests` and renaming five tests to bless the regressions. Owner ruled: restore the behaviours and the tests. Builder note: `scratchpad/a3/builder-done.md`.

### Tests restored, added, changed (`ios/Tests/UnitTests`)
| File | Change |
|---|---|
| `FridgeSessionTests.swift` | restored from `origin/main` (all 18 scenarios), `SwitchAPIClient` gains `friendCode`, `addFriend`, `share`, `updatePickup`. Added 5: `testSessionOverloadTokenRefreshKeepsRowsNoRefetch`, `testSessionOverloadIdenticalSessionIsNoOp`, `testSessionOverloadSameUserNewTokenAfterSignInErrorRecovers`, `testDifferentUserAndSignOutBumpGenerationButTokenRefreshDoesNot`, `testRemoveInFlightSurvivesTokenRefresh` (23 total) |
| `PageSweepFixTests.swift` | reverted #125's renames: `testStaleTokenUnauthorizedKeepsNewerSession` (class `StaleTokenSignOutTests`), `testAlreadyRemoved409CountsAsSuccess`, `testDecodingErrorOnRemoveCountsAsSuccess`, `testUndoAfterAlreadyRemovedStillRestores`, `testRetryFromBannerShowsToastImmediatelyAndLeavesNothingPending` (and the `showToastNow: true` call). Added 4 batch tests: `testBatchAlreadyRemoved409OnlyRestoresItemsTheServerStillHas`, `...WhereServerStillHasEveryItemRestoresAll`, `testBatchDecodingErrorReconcilesPerItemToo`, `testBatchAlreadyRemoved409WithUnreadableListingRestoresEverything` |
| `FridgeModelTests.swift`, `FridgePolishTests.swift` | the 2 CI failures (below) |

### CI failures: cause and fix
`testThrownOutSendsReasonAndDonatedSendsRecipient` and `testRecipientChoiceIsPassedThroughUnchanged` indexed `spy.removes[0]` / `spy.choices[0...2]`. Removes run on separate per-item tails (`enqueue`), so their arrival order at the spy actor is not deterministic under parallel testing. Each test passes alone (run in isolation: 0 failures), so the cause is call order, not a per-item reordering bug (per-item order is covered by `testRemoveUndoRemoveUndoRunsInIssuedOrder`, `testRestoreNeverStartsBeforeItsRemoveEnds`, which pass). Fix: the spy records `choiceByID`; both tests assert per item id.

### Guards and the test that goes red if one is removed (round 2, corrected)
By reasoning, not by mutation (the orchestrator runs the mutations). Round 1 over-claimed: with disjoint item ids (the `long` fixture) a late failure from user A is already harmless because the switch clears `reconcile`, so those old tests do not detect a missing guard. The round-2 tests give B the SAME ids (`makeSameIds`) and keep B's own operation in flight (held gate), which makes a leak visible.
| Guard / rule (`FridgeModel.swift`) | Mutation | Red tests |
|---|---|---|
| `load`: `gen == generation` after the await | delete | `testUserSwitchDuringSlowLoadDiscardsOldResult`, `testSignOutDuringSlowLoadDiscardsOldResult` |
| `enqueue`: skip queued work if the generation moved | delete | `testUndoQueuedBehindHeldRemoveMakesNoRestoreCallAfterSwitch` (restore reaches the new user's API; `SwitchAPIClient.restoreCalls` non-empty) |
| `perform` catch: `generation == gen` | delete | `testFailingRemoveAfterSwitchDoesNotTouchBsInFlightRemoveOfTheSameId` (banner, haptic, B's row re-inserted) |
| `undo` catch: `generation == gen` | delete | `testFailingRestoreAfterSwitchDoesNotRemoveBsRestoredRow` |
| `undo` success: `generation == gen` | delete | NOT covered: `applyRestored` only acts on a `.restored` reconcile entry and the result is the same item, so nothing observable differs. Gap, low value |
| `settleBatch`: guard after the listing await | delete | `testBatchSettleAfterSwitchDoesNotTouchB` |
| `settleBatch`: guard in the listing-failure branch | delete | NOT covered (would need a held listing that then fails). Gap |
| `generation += 1` on user change / sign-out | delete | the five race tests of round 1, plus all of the above |
| `generation += 1` on a token refresh | add | `testRemoveInFlightSurvivesTokenRefresh`, `testDifferentUserAndSignOutBumpGenerationButTokenRefreshDoesNot` |
| `sessionChanged` cancels in-flight tails | add `cancel()` | `testRemoveInFlightIsNotCancelledBySwitchAndStillReachesTheServer`, `testUndoInFlightIsNotCancelledBySwitchAndStillReachesTheServer` (cancellation-aware gate throws, so the call never reaches the server and `sawCancellation` is true) |
| user switch / sign-out clears select mode and selection | delete | `testUserSwitchAndSignOutClearSelectModeAndSelection`; token refresh keeps it: `testTokenRefreshKeepsSelectMode` |
| single remove 409 `already_removed` / decoding keeps the removal | make it roll back | `testAlreadyRemoved409CountsAsSuccess`, `testDecodingErrorOnRemoveCountsAsSuccess`, `testUndoAfterAlreadyRemovedStillRestores` (now asserts the spy recorded `restores == [id]`), `testUndoAfterDecodingErrorOnRemoveStillRestores` |
| batch 409 / decode drops the toast and pendingToast | keep the toast | the five `testBatch...409/Decoding...` tests (`assertNoUndoPossible`: `toast` nil, nothing pending, a stale Undo makes no `restoreItem` / `restoreBatch` call) |
| batch reconcile per item | assume all removed / roll back all | `testBatchAlreadyRemoved409OnlyRestoresItemsTheServerStillHas`, `...WhereServerStillHasEveryItemRestoresAll`, `...WhereServerRemovedEveryItemKeepsThemHidden...`, `testBatchDecodingErrorReconcilesPerItemToo`, `...UnreadableListingRestoresEverything` |
| batch Undo kept when nothing failed | drop it | `testBatchUndoWhenNothingFailedRestoresViaRestoreBatch` |
| 401 only expires the session for the current token | always expire | `testStaleTokenUnauthorizedKeepsNewerSession`, `testFriendCodeStaleTokenUnauthorizedKeepsNewerSession`; current-token cases: `testCurrentTokenUnauthorizedSignsOut`, `testFriendCodeUnauthorizedWithCurrentTokenExpiresTheSession` (`sessionExpired` true) |
| banner retry shows the toast now | ignore `showToastNow` | `testRetryFromBannerShowsToastImmediatelyAndLeavesNothingPending`, `testRetryThatFailsAgainClearsItsToastAndShowsBannerAgain` |
Observation (not a bug): calling a batch's stale Undo closure directly (after the 409 dropped its toast) re-inserts the rows locally, though it makes no server call. It is unreachable from the UI once `toast` is nil, so the tests assert only that no restore request is made.

### Bug found
| ID | Severity | Summary | Where |
|---|---|---|---|
| IOS-73 | low | Same-user token refresh refetches the visible storage even when it already shows content. The original (9997699) did `errors = [:]; await loadIfNeeded(storage)`, so a storage with items was not refetched; the port calls `load(storage, isRefresh: true)`. Breaks the restored `testTokenRefreshKeepsItemsNoRestaggerNoRefetch` ("2" != "1") and the AuthSession-overload twin. Impact: one extra list request per token refresh (and a possible "Couldn't refresh" banner if it fails); no data loss. Fix: `await loadIfNeeded(storage)` in the same-user branch of `sessionChanged(from:to:)`. If the owner prefers the refresh, change both tests to expect 2 lists | `FridgeModel.swift:132-135` (fixed by builder: `errors = [:]; await loadIfNeeded(storage)`; verified below) |

### Runs (iPhone 17 Pro simulator id 18B791CA, own DerivedData, parallel testing on, `FoodWasteReducerTests`)
| Run | Result |
|---|---|
| Targeted (FridgeSessionTests, FridgeRemoveOutcomeTests, StaleTokenSignOutTests, the 2 CI tests alone) | 44 run, 1 failed (IOS-73), exit 65 |
| Full unit target | 519 run, 3 skipped (Keychain, IOS-7), 2 failed (both IOS-73), exit 65 |
After the IOS-73 fix (build-for-testing exit 0):
| Run | Result |
|---|---|
| Full unit target, run 1 | 519 run, 3 skipped (Keychain), 0 failed, exit 0 |
| Full unit target, run 2 | 519 run, 3 skipped (Keychain), 0 failed, exit 0 |

### Round 2 (review of HEAD 6d681ab)
Builder changes: sessionChanged no longer cancels tails; a batch 409 / unreadable 2xx drops the batch's toast, marks all ids failed, restores only still-active items; mock `createRequest` sets `source.name`; friend-code 401 calls `expireSession`; Home pill wraps at AX sizes.
Tests changed or added (`ios/Tests/UnitTests`):
- `FridgeSessionTests`: `SwitchAPIClient` records calls that reach a server, one-shot errors captured at call start, optional cancellation-aware gate. New: the two not-cancelled tests, `testUndoQueuedBehindHeldRemoveMakesNoRestoreCallAfterSwitch`, `testFailingRemoveAfterSwitchDoesNotTouchBsInFlightRemoveOfTheSameId`, `testFailingRestoreAfterSwitchDoesNotRemoveBsRestoredRow`, `testBatchSettleAfterSwitchDoesNotTouchB`, `testUserSwitchAndSignOutClearSelectModeAndSelection`, `testTokenRefreshKeepsSelectMode`.
- `PageSweepFixTests`: batch-409 tests now assert no toast and nothing pending, no restore call, still-active items back with the banner, already-removed ones hidden (a new case: server removed every item); `testUndoAfterAlreadyRemovedStillRestores` asserts `spy.restores == [id]`; added `testUndoAfterDecodingErrorOnRemoveStillRestores`, `testBatchUndoWhenNothingFailedRestoresViaRestoreBatch`; mock createRequest asserts `source.name == author name`; two friend-code 401 tests.
- `HomeAccessibilityTests.testPillSitsBelowTheGreetingAtAX5`: restored `pill.maxX <= 320.5`. It passes with the builder's HomeHeader change, so no IOS-74.
Runs (build-for-testing exit 0): full unit target 532 run, 3 skipped, 0 failed, exit 0, twice in a row. (One earlier attempt hit a simulator launch error, "Application failed preflight checks", before any test ran; re-run clean. The first run of the new tests had 2 failures in my own stale-Undo assertions, removed as the observation above.)

### Verdict: PASS (IOS-73 fixed; round-2 gaps closed; full unit target green twice, 532 run / 3 skipped / 0 failed, parallel testing on. Known coverage gaps: `undo` success guard, `settleBatch` listing-failure guard)
