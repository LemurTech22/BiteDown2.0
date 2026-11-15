# QA: Expo client (`client/`)

## 2026-11-13: Undo panel + Recently removed QA

Scope: HEAD `0c093b9b4ec73e5022d104fc3fcb9dc51201a500`, read with `git show HEAD`, against
`docs/DECISIONS.md` (2026-11-13 Undo panel decision), `docs/design/SCREENS.md` rows 34/43,
the restore bullets in `docs/API.md`, and the domain, motion and accessibility rules in `CLAUDE.md`.
Added 30 QA cases in `src/__tests__/qa-undo-panels-test.tsx`,
`src/__tests__/qa-undo-fridge-test.tsx` and `src/__tests__/qa-undo-recently-removed-test.tsx`.
Updated the two used/donated partial-409 cases in `qa-pr1-removal-session-test.tsx` for the
one-panel rule. Only QA tests and this new section were changed; no feature code or git writes.

| Area | Checked / result |
|---|---|
| Eight-second panels | Single and batch panels remain at 7,999 ms and disappear at 8,000 ms. Dismiss hides immediately without reversing the removal; the item stays restorable through Recently removed. PASS. |
| Accessibility timing | Native screen-reader detection keeps both panels indefinitely; unresolved detection also blocks expiry. A screen-reader change wins over a stale initial query, and subscriptions are removed. With `Platform.OS = 'web'` and `isScreenReaderEnabled` mocked to resolve true, both timers still expire at eight seconds. PASS. |
| Pending/failure | Both real Fridge restore paths block duplicate taps, keep panels beyond the deadline while pending and failed, show an inline alert and Try again, and restore exact Impact on retry. Component cases also verify Dismiss remains available after failure. PASS. |
| Replace-on-new | Single replaces single, batch replaces single, batch replaces batch, and single replaces batch. The old timer cannot dismiss its replacement. Only the newest panel is visible; its Undo works and all older removals remain available via Recently removed. Restoring all returns the original items and full Impact exactly. PASS. |
| CL-10 partial 409 | Used/donated conflicts still leave only active items selected with the exact retry message. Retry sends only the remaining ID and replaces the older panel. The visible batch Undo restores the latest removal and intermediate Impact; Put back in Recently removed restores the older removal and original full Impact. The lost-response recovery regression also passes. PASS. |
| Recently removed | Real route export checked. Plain/sectioned responses are fetched with `include_removed: true`, flattened, sorted newest first across storage, and filtered at seven days; active, invalid-date, exact-cutoff and older rows are excluded. Just-inside and slightly future server timestamps remain visible. Outcome/relative-time labels match the spec. PASS. |
| Put back / Impact | Used, donated and thrown-out removals at 6 days 23 h restore the same ID and original storage, clear removal metadata, and return every week/month/all Impact field exactly with unrelated history preserved. Donation reopens the listing. Polite success text, success/error haptics, duplicate-tap blocking, inline failure/retry, and an expiry 409 while a row is open are covered. Mock single/batch refusals at 7 days + 1 minute change neither inventory nor Impact. PASS. |
| Screen states / navigation | Loading skeleton, load error with working retry, specified empty copy, and the empty state after restoring the last row pass. The Fridge header entry navigates to `/removed`, including with empty inventory. PASS. |
| Targets / motion | Dismiss and the Fridge entry have explicit 44 x 44 pt styles; Undo, Put back and retry buttons have labelled button roles and minimum height >=44 pt. Entrance animations are short opacity fades (<=0.5 s), with no movement/countdown loop. Fridge scenarios run with Reduce Motion enabled. PASS for component/style evidence. |

Bugs: no new client defects reproduced; CL-30 through CL-39 remain unused. Backend exact-cutoff
mismatch BE-53 is recorded in `docs/qa/backend.md`; the client mock and filter exclude that age.

### Commands

Run from `client/`:

| Command | Result |
|---|---|
| `npx jest src/__tests__/qa-undo-panels-test.tsx src/__tests__/qa-undo-recently-removed-test.tsx src/__tests__/qa-undo-fridge-test.tsx src/__tests__/qa-pr1-removal-session-test.tsx --runInBand` | PASS, exit 0: 4 suites, 36 tests, 0 snapshots. |
| `npx tsc --noEmit` | PASS, exit 0. |
| `npx eslint src` | PASS, exit 0 after correcting a render-purity issue in the QA harness. |
| `npx jest` | PASS, exit 0: 38 suites, 527 tests, 0 snapshots. Includes the demo path and existing feature regressions. |

These are Jest/component and mock-service results. Web timing was exercised through the explicit
platform branch, not an actual browser. Native screen readers, device hit bounds, AX5 text sizing,
visual contrast, real animation playback and live-service client integration remain unverified.
No Android/iOS build, browser export or device run was performed.

**Verdict: PASS**

## 2026-11-13: PR #1 full QA

Scope: `git diff origin/main...HEAD`, `feat/expo-android` at `fb5e08a`, against `CLAUDE.md`
and `docs/API.md`. Formal QA of the rest of PR #1; the checkpoint 18 sign-off below is preserved.
Added only `client/src/__tests__/qa-pr1-removal-session-test.tsx` and this section.
Feature code, other documentation and iOS files were not edited. All git commands were read-only.
Re-verified CL-10/CL-11 on 2026-11-13 at fix commit `25cf826` (HEAD), read with `git show HEAD`.
Updated only this section and `client/src/__tests__/qa-pr1-removal-session-test.tsx`.

| Area | Result |
|---|---|
| Merge-gate demo path | **PASS.** `src/__tests__/demo-path-test.tsx:44` runs login, camera photo, mock expiry prediction, candidate save, Fridge removal, Impact and Undo through real routes with one `MockApiClient`. It asserts the photo/enrichment payload, predicted date, one removal, increased Impact, restored food, and exact full Impact equality with the pre-add baseline (`:155`); network fetch is forbidden. Every required step already has coverage, so no duplicate demo test was needed. |
| Removal coverage | **PASS on re-verification.** Existing component tests cover all three outcomes, required throw-away reasons, recipient omission/null/selection, error/retry, single-item lost responses, Undo deadlines and Reduce Motion. Existing batch tests cover used/donated and exact Impact restoration. The CL-10 lost-response regression now passes. Added used/donated partial-409 regressions: only the still-active item stays selected with the exact retry message; retry sends only its ID, dismisses selection, and provides a separate Undo. Each Undo restores its own items and exact full Impact baseline. |
| Backend diff and domain rules | Read all changes under `backend/app`: CORS/configuration, photo candidate merging, Gemini fallback and storage expiry re-estimation. No migration changes. Changed behavior matches the documented contract in the reviewed paths. Also traced unchanged removal/restore and listing/request visibility code: row locks, one remove event in the removal transaction, donation fulfilment, restore event deletion/listing reopening, accepted-friend/current-group checks and invisible-resource 404s. **Source review only; backend tests were not run and the test DB was not accessed.** |
| Client contract and data states | Sampled live request paths/payloads, photo candidate round trip, item editing/pickup, Home, Fridge, Impact, Recipes and Social. Loading skeletons, empty states and retryable errors are present in sampled data flows; the existing suite exercises them. **CL-11 fixed/verified:** personal inventory (including removed/sectioned queries) and full week/month/all Impact are isolated between accounts; cross-account personal removal is forbidden. Signing back into the first account preserves its food and Impact. No additional confirmed production API mismatch found in the sample. |
| Fresh Demo-mode account | **PASS.** The existing settings test enables Demo mode while signed out, creates an account and logs back in using the mock. A new QA test verifies fresh-account seeding: two friends, one group with the current user as a member, one group food item, two shares and two requests. Personal inventory and Impact remain empty. Removing/restoring seeded group food succeeds and restores the item and full Impact exactly. |
| Accessibility, motion and theme | Sampled shared buttons, item actions, filters, sheets, skeletons, form errors and Impact animations. Sampled button/action targets use the 44 pt token or larger; styles use centralized theme tokens. Sheets select fades for Reduce Motion, skeletons stop pulsing, charts fade and counters show final values. This is source/component evidence, not device hit-bound, contrast, AX5 or screen-reader certification. |
| Secrets and scripts | No credential/private-key pattern found in scanned client source/config/public files, scripts or backend app files. Public service URLs and the EAS project identifier are configuration identifiers. Read the new tunnel/publish scripts without running them; `serve_public.ps1` parses with zero PowerShell syntax errors. Public tunnel, publishing and watchdog behavior were not exercised. |
| iOS | Entire iOS diff read: UI/accessibility labels, one comment, mock error wording and matching test expectations only. Enum raw values, identifiers and logic remain unchanged. String/interpolation edits are Swift-valid by inspection. **iOS was not built; compilation and Smoke remain unverified.** |

### Bugs

| ID | Severity | Location | Repro | Re-verification at `25cf826` |
|---|---|---|---|---|
| CL-10 | high | `client/src/features/fridge/fridge-screen.tsx:110` | Select two items, choose Used them, let `removeBatch` commit and then lose its response; press Try again. Also select two items, remove only one through another request, then attempt the selected batch. | **Fixed/verified.** The lost-response retry reconciles both removed items, dismisses selection and offers working Undo; Impact counts each removal once and restores exactly. In the partial conflict, the batch returns `409 already_removed` without changing Impact. The removed item disappears and gets Undo; the active item remains checked with `1 selected` and "Some items were already removed. Try again to remove the rest." Retry removes only the remaining ID and clears selection/error. Separate Undo actions restore both foods and exact intermediate/original full Impact. Verified for used and donated outcomes. |
| CL-11 | medium | `client/src/api/mock-client.ts:148`, `:263`, `:420`, `:829` | In one Demo-mode client/session, create account A with two foods and remove one; sign in/create account B. Fetch inventory and Impact, or remove A's remaining personal food. Run the two `CL-11` QA tests. | **Fixed/verified.** B has empty personal inventory, empty removed/sectioned inventory and exact empty full Impact responses for week/month/all, including charts. Removing A's personal food returns `403 forbidden`. Logging back into A preserves its remaining food and removal count. **Demo-mode verification; no production backend account leak demonstrated.** |

### Commands

Original QA run from `client/` on 2026-11-13, before the fix:

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **PASS**, exit 0, including the new QA tests. |
| `npx expo lint` | **PASS**, exit 0, including the new QA tests. |
| `npx jest --runInBand` before adding regressions | **PASS**, exit 0: 32 suites, 465 tests, 0 snapshots. Includes the complete demo path. |
| `npx jest src/__tests__/qa-pr1-removal-session-test.tsx --runInBand` | **FAIL**, exit 1: three reproduced failures for CL-10/CL-11. Assertions describe the required behavior; tests are not skipped or inverted to accept defects. |
| `npx jest --runInBand` final | **FAIL**, exit 1: 32 suites passed, 1 failed; 465 tests passed, 3 failed, 468 total; 0 snapshots. Only the three new QA regressions fail. |
| `npx expo export -p web --output-dir <external scratch>` | **PASS**, exit 0: 1,067 modules, 28 assets, 32 web bundles. `../../mldata` does not exist from `client/`, so used `%TEMP%/bitedown-pr1-qa-20261113-7e39a1-web`. Confirmed generated `index.html`, then deleted only that newly created directory; absence verified. |

Re-verification from `client/` on 2026-11-13 at `25cf826`, after adding the QA coverage:

| Command | Result |
|---|---|
| `npx jest src/__tests__/qa-pr1-removal-session-test.tsx --runInBand` | **PASS**, exit 0: 1 suite, 6 tests, 0 snapshots. Original CL-10/CL-11 regressions, both partial-conflict outcomes and fresh-account seeding pass. |
| `npx tsc --noEmit` | **PASS**, exit 0. |
| `npx eslint src` | **PASS**, exit 0. |
| `npx jest` | **PASS**, exit 0: 33 suites, 471 tests, 0 snapshots. Includes the routed photo/expiry/removal/Impact demo path with exact full Impact restoration and the Demo-mode enable/signup/login test. |

No backend tests, backend runtime calls, Android build or device checks were performed.
The earlier web export establishes bundling, not browser interaction or live-service correctness;
it was not repeated for this re-verification. **iOS not built**; compilation and Smoke remain unverified.

**Verdict: PASS**

## 2026-11-13: checkpoint 18 QA

Scope: `git diff db62ed7..322431e` on `feat/expo-android`; checked against the 2026-11-13
sharing/storage/wording decision, `docs/API.md` PATCH contract and `CLAUDE.md`.
Added `src/api/__tests__/qa-cp18-expiry-test.ts` and
`src/features/social/__tests__/qa-cp18-sharing-test.tsx`. Feature code was not changed.
Re-verified fix commit `12847b9` (HEAD) on `feat/expo-android` on 2026-11-13.
Updated only stale QA assertions for the expanded owner-card label and the row switch's
`accessibilityState.checked`; added a CL-3 web component regression. Non-QA tests were not changed.

| Area | Result |
|---|---|
| You're sharing | Active personal open shares only, including claimed shares; sectioned responses flattened; removed/group/closed/unshared items excluded. All filter only. Own-only data suppresses the empty state; Friends/Groups have their own empty states. Either request failing shows an error, never an empty state; retry restores both sections. Item navigation and external claim/retry still work, retaining own shares. |
| Accessibility/theme/motion | Header role, card/filter/claim labels and token-based target sizes checked. Move destinations are at least 44 pt; re-estimate is one labelled, initially off switch on a Pressable row at least 44 pt high; estimated items show the caption instead. Web component tests verify label and row presses toggle the checked state and opt-in is sent. The visual Switch is hidden from accessibility and web focus, with pointer events delegated to the row. User date retained with switch off; failed move retry retains the selection. Reduce Motion selects a fade. New styling uses theme tokens; no added decorative animation. Owner-card label includes quantity and claimant. CL-1 and CL-3 fixed/verified in source and component tests. |
| Expiry mirror | 528 category/storage/boundary comparisons pass against the same expected cases used by backend QA (all six directed pairs across 11 categories; null, expired, today, short and overlong remaining life). Existing tests cover user-date opt-in, explicit-date precedence, final category, no-ops and non-boolean rejection. Late-night America/Chicago calendar-day regression passes; CL-2 fixed/verified. |
| Wording/identifiers | Shared food, Share with friends, Shared with friends, Group food and Staples verified in the diff and client tests; storage still reads Pantry. No remaining old UI label found in client or iOS source. Residual old wording is in comments/test descriptions and the mock's group-item validation error (`src/api/mock-client.ts:485`), treated as the decision's server-error exception. Existing API values, routes, testIDs and iOS accessibilityIdentifiers are unchanged. |

### Bugs

| ID | Severity | Location | Repro | Re-verification at `12847b9` |
|---|---|---|---|---|
| CL-1 | medium | `client/src/features/social/pantry-screen.tsx:72` | Return an open own share for Rice, 1 kg, claimed by Ana Rivera; render Shared food, All. Run the `CL-1` QA test. | **Fixed/verified.** The explicit card label now includes `2.2 lb` and `Claimed by Ana Rivera`; the unclaimed label includes quantity and `Not claimed yet`. Claimant/quantity and retry/navigation tests pass. Native screen-reader behavior was not exercised. See [React Native accessibility](https://reactnative.dev/docs/accessibility#accessibilitylabel). |
| CL-2 | medium | `client/src/api/mock-client.ts:993`; compare `backend/app/services/expiry.py:39` | At `2026-11-13T23:30:00-06:00` on an America/Chicago host, move default-dated meat (expiry `2026-11-15`) from fridge to freezer. Run the `CL-2` QA test. | **Fixed/verified.** The mock uses the local calendar date and returns `2027-05-12`, matching the backend contract for Nov 13 + 180 days, rather than the former UTC-based `2027-05-13`. The late-night regression and all 528 boundary comparisons pass. |
| CL-3 | medium | `client/src/features/fridge/move-sheet.tsx:62` | On web, open Move for a user-dated item and activate `Re-estimate expiry for the new spot` from its label or row. Previously only the 40x20 visual Switch responded; its 44 pt wrapper was not tappable. | **Fixed/verified in source and component tests.** One Pressable row has role `switch`, a label, checked/disabled state and minimum height 44 pt. The new QA regression verifies one accessible switch, label/row presses in both directions and the enabled opt-in payload. HEAD's existing tests also verify the hidden visual wrapper's `pointerEvents="none"`, `aria-hidden` and web `inert`, plus disabled behavior while pending. Browser hit bounds were not measured. |

### Commands

Initial run: `npx jest` **FAIL** (exit 1): **30 suites passed, 2 failed; 458 tests passed,
2 failed, 460 total**. The failures were CL-1 and CL-2; typecheck and lint passed.

Re-run on 2026-11-13 from `client/`: `npx tsc --noEmit` **PASS** (exit 0);
`npx eslint src` **PASS** (exit 0); `npx jest` **PASS** (exit 0):
**32 suites passed; 465 tests passed, 465 total; 0 snapshots**. CL-1, CL-2 and CL-3 pass.

iOS build is not verified here. Device rendering, AX5 layout, browser/device hit bounds and VoiceOver/TalkBack
are not verified here; accessibility evidence above is from source and component tests.

**Verdict: PASS**

## 2026-11-13: final pre-showcase pass on `feat/expo-android` (orchestrator checks; not a formal QA PASS)
Independent read-only audits by Codex and OpenCode (`glm-5.3`) agreed on the top risks; each fix was reviewed by Claude.
Rulings: `docs/DECISIONS.md` 2026-11-13. Runbook: `docs/SHOWCASE.md`.

**Fixed**
- No way to change the server or turn on Demo mode before sign-in: **Server settings** link on welcome, login,
  signup and the launch error screen.
- Fresh installs could sign up against the bundled default before `api-config.json` arrived; config never refreshed
  while the app stayed open; loopback addresses were accepted from remote config in release builds.
- Home: a slow or failing Gemini recipe call blocked or errored the whole screen.
- Remove: a retry after a lost response hit 409 `already_removed` and dead-ended (now success + Undo).
- Barcode on web could hang with no way out (Type it instead always visible). Web photos uploaded at full size
  (now 2048 px JPEG; 413 has a clear message). Batch Undo vanished after 5 s.
- API: 4 threads let slow Gemini calls block login/Fridge (now 12); a Gemini 429/503/timeout failed the request even
  though another model answered in 1 s (fallback chain); fridge photos listed every instance as its own row (merged).
- `serve_public.ps1`: an overloaded API rotated a working tunnel; a failed publish killed the tunnel; CORS check read
  `.env` text instead of the running API; `eas-cli@latest` unpinned.

**Verified**
- Client: `tsc` and `expo lint` clean; Jest 30 suites / 419 tests. Web export builds (3.9 MB).
- Backend: Gemini-related tests 321 passed with `.env` overrides cleared (`test_app_reads_env` reads the local `.env`
  `GEMINI_TIMEOUT_S=20`, so it only passes without it, as in CI); from-photo tests 50 passed.
- Live API on this PC: photo + enrich 5.6 s, text 0.9 s, recipes 1.9 s, receipt 3.8 s; 8 concurrent photo scans
  2.5-7 s each while 8 concurrent `GET /items` took about 10 ms. CORS preflight from `https://bitedown.expo.app` passes.
- Production web bundle in Chrome against the local API: welcome (Server settings link), log in as the demo account,
  Home (recipe card loads after the rest), Fridge, Remove (Used it), Impact 3.2 → 3.7 lb, Undo restores 3.2 lb exactly.

**Final review (Claude, after the OpenCode review was stopped for low memory):** whole diff `17d0723..69c9742`. Fixed:
enrichment could fall back after a 25 s timeout and pass the 75 s photo timeout; the watchdog could `Stop-Process` a
dead tunnel's PID again after a failed restart (now checks `HasExited`); the address screen title is now
**Server settings**. Gemini fallback tests 63 passed, photo/timeout tests 108 passed; live photo + enrich 5.2 s (7
enriched), recipes 2.1 s on the rebuilt API. No other defects found.

**Not verified:** the new APK on a device; the public tunnel and `eas deploy` (owner step); iPhone Safari on a real
device; camera flows on a real phone.

## 2026-11-12: showcase hardening on `feat/expo-android` (orchestrator checks; not a formal QA PASS)
Independent checks: two read-only audits (Codex, OpenCode `glm-5.3`) agreed on the defects below; an OpenCode read-only
review covered the whole night's diff. Device checks ran on the Android emulator (Expo Go, Pixel 7 API 36) and in Chrome
(web build) against the local backend.

**Fixed tonight**
- Web build crashed on launch: `useAnimatedValue` is missing in react-native-web (local hook now).
- Web: every request failed with "Illegal invocation" (global `fetch` called as a method).
- Web: no CORS on the API (allowlist `CORS_ORIGINS`, 9 backend tests).
- iOS/web: pickup "Open in Maps" used Android-only `geo:` links (platform-specific `mapsUrl()`).
- Keyboard covered inputs on auth, item detail, pickup, photo review, settings, Friends & groups (iOS).
- `bitedown://friend/<code>` and `bitedown://group/<code>` hit "unmatched route" (routes added).
- Large font: recipient row overflowed; session-error retry unreachable.
- Server errors weren't reported on Home, Impact, Recipes, Social, Connect, Scan, Group.
- Fridge rows were tall (full-width "Move to…"); now compact, Remove visible, Move on swipe-left / a11y action.
- App icon, adaptive icon, splash and favicon were Expo template art (now the BiteDown leaf).

**Verified by hand**
- Android (Expo Go): log in; Add by text (Gemini parses 2 and 4 items, saves); compact Fridge; Remove → Used it →
  Undo toast; Impact shows 1.3 lb saved; Recipes (with "needs a few things"); Social, Food Pantry, Your requests,
  Settings load with their empty states.
- Web (Chrome): welcome, sign up through CORS, Home.
- Checks: `tsc` and `expo lint` clean; Jest 29 suites / 369 tests; backend full suite (not slow) 2968 passed, 4 skipped,
  7 xfailed, with `test_be22_peak_memory_…` deselected: it imports the Unix-only `resource` module, so it can only run on
  Linux/macOS (pre-existing, not a regression).
- OpenCode review of the whole diff: CORS, redirects, secrets, fetch binding clean; 4 defects found and fixed
  (Funnel left on after Ctrl-C; deep-link code lost at sign-in, now an allowlisted `next`; Move invisible on web;
  unescaped `geo:` label). Pinned Add button on review screens verified on the emulator.

**Not verified**: iPhone Safari on a real device; barcode and receipt camera flows on a device; Food Pantry claim and
Group detail with a second account; delete account; fontScale 2.0 on a device. Receipts need the ML service or Gemini
fallback (`docs/DECISIONS.md` 2026-10-11).

## Undo pause, overlay, sheet width, Remove icon (uncommitted, 2026-11-14)

**Initial verdict: FAIL; superseded by the re-check below.** Reviewed the current files against the supplied specification without running Git. Feature code and existing tests were not edited. The original findings and validation history are retained below with current bug statuses.

### Findings

- **CL-12 — Ruled by design.** The original regression expected web screen-reader detection to retain the panel. The orchestrator ruling below supersedes that expectation: the web timer runs, focus on either panel button pauses it, and Recently removed with Put back is the untimed path for seven days. Updated regressions assert expiry at exactly 8,000 ms on web despite a mocked positive screen-reader query; focus retains both panel types beyond that deadline and blur resumes with the two-second minimum. On iOS and Android, a positive native screen-reader query retains both panels beyond 60 seconds. These are mocked component checks; physical screen-reader playback is unverified.

- **CL-13 — Medium — Fixed/verified; original finding: single-item overlay has a transparent descendant that intercepts taps.** `src/features/fridge/fridge-screen.tsx:274` and `:324` in the original review. The outer overlay was `box-none`, but the nested ScrollView retained default `auto` hit testing and added an empty eight-point bottom content strip. Repro: remove a single item, scroll a remaining row underneath that strip, then tap its visible content in the transparent strip. The original regression failed its pass-through contract. Re-check below verifies the updated contract. Actual coordinate hit testing, including rounded transparent corners, remains unverified in Jest.

- **CL-14 — Medium — Fixed/verified; original finding: batch Undo has no overflow path under the overlay's height cap.** `src/features/fridge/fridge-screen.tsx:271` and `:322`; `src/features/fridge/batch-undo-toast.tsx:22` and `:33` in the original review. Batch content was a direct, non-scrolling child. Its minimum unwrapped vertical content is 132 points (24 padding + 44 header target + 8 gap + 56 Undo target), before wrapped labels or errors. Repro recipe: use a short landscape viewport with large system text, remove a batch, then fail Undo to add an error. Content could overflow the 40%-capped measured overlay and exceed the reserved list padding. Re-check below verifies the shared scroll container and measurement contract. Physical layout and tap outcomes remain unverified; Jest does not calculate Yoga layout.

### Coverage and limits

- Added `src/__tests__/qa-undo-pause-lifecycle-test.tsx`: timer/subscription cleanup in running, paused and blocked states; accessibility query resolution after unmount; latest dismissal callback; duplicate/unmatched pause events; three simultaneous pause reasons and the two-second resume minimum; responder termination on either button with a balanced touch pointer leave; focused/pressed/hovered panel replacement; CL-12 regressions for both panel types.
- Added `src/__tests__/qa-undo-overlay-sheets-test.tsx`: measured overlay padding at two heights for single/batch panels, unchanged list viewport style, Undo/Dismiss handler reachability, CL-13 regression, Remove icon/name/testID/44-point target on iOS/Android/web, conditional Recently removed message spacing, and all seven sheet width/centering contracts on iOS/web.
- Read the shared hook, both panels, FadeIn, AppButton, Fridge screen/row, Recently removed screen, width helper, and remove/move/discard/pickup/offer/settings-delete/friend-added sheet call sites. The helper uses `width: '100%'`, the theme's 520-point cap, and `alignSelf: 'center'`; every requested call site applies it. Width assertions prove layout inputs, not actual phone/tablet measurements.
- Existing tests additionally cover eight-second expiry, remaining time above the resume minimum, each individual button interaction, hover/focus overlap, native screen-reader changes, pending/error retention, immediate Dismiss, labels/roles and minimum target heights.
- No timer leak or post-unmount dismissal was identified in source review or the corrected lifecycle tests. Neither button is individually removed during loading: AppButton replaces its child with a spinner while preserving the Pressable; removing the entire panel runs hook cleanup. Native pointer cancellation emits pointer leave in the installed renderer, and Pressability termination releases the press. The cancellation test supplies those native events; browser/device event delivery is unverified.
- Hardware hover, pointer exit missed by the operating system/browser, real focus transfer, VoiceOver/TalkBack/browser screen-reader navigation, transparent-region hit testing, last-row clearance after real scrolling, font scaling and physical phone sheet width remain unverified. A direct `fireEvent.press` proves handler wiring, not that a physical tap passes through another view.

### Validation

- `npx tsc --noEmit`: PASS on the final test files.
- `npm run lint`: PASS on the final test files.
- `npx jest --runInBand`: run exactly once, after initial test authoring. **41 suites / 602 tests: 39 suites passed, 2 failed; 591 tests passed, 11 failed; 0 snapshots.** All 39 pre-existing suites (559 tests) passed. Of the 11 failures, three reproduce CL-12/CL-13; eight were QA harness assertions that incorrectly treated all renderer/fake-clock work as leaked application timers.
- Corrected only the new QA assertions to track the actual eight-second timeout handle, its cancellation, subscription removal, and post-unmount callback behavior. Then ran `npx jest --runInBand --runTestsByPath src/__tests__/qa-undo-pause-lifecycle-test.tsx src/__tests__/qa-undo-overlay-sheets-test.tsx`: **43 tests: 40 passed, 3 failed; 2 suites failed; 0 snapshots.** Lifecycle file: 20 passed / 2 failed; overlay/sheets file: 20 passed / 1 failed. The three remaining failures are the two CL-12 panel variants and the CL-13 pass-through assertion. They are ordinary failing tests, not skipped or expected failures.
- The full suite was not repeated after the QA assertion correction, preserving the requested one-full-run limit. Its raw counts above describe that run; they are not presented as a full-suite result for the corrected files. Final targeted results cover all 43 new tests. No feature fix was applied.

Original next step: address the reported issues and verify the physical interaction/layout cases above. Current statuses are in the re-check below. CL-15 through CL-19 are unused.

**Orchestrator ruling (2026-11-14), CL-12: by design, not a bug.** The web cannot detect a screen reader (react-native-web's `isScreenReaderEnabled()` always resolves `true`), so the web timer runs. Focus on the panel or its buttons now pauses it (fix 1), and Recently removed with Put back is the untimed path for 7 days. QA updates its CL-12 regression to this ruling. CL-13 and CL-14 go back to the builder.

### Re-check (2026-11-14)

**Verdict: PASS** for source/component verification.

- **CL-12: ruled by design.** Both panels expire at eight seconds on web; focus on either button pauses expiry, and blur resumes with the two-second minimum. Native screen-reader-on cases retain both panels on iOS/Android. Recently removed remains the seven-day untimed path.
- **CL-13: fixed/verified.** Overlay, ScrollView and content-container styles all use `pointerEvents: 'box-none'`, with no empty bottom padding strip. Both panel types retain working Undo and Dismiss. The Jest ScrollView stub does not apply `contentContainerStyle` to its synthetic child, so the test checks that supplied style explicitly.
- **CL-14: fixed/verified.** Both panel types, including restore-error content, live inside the single scrollable container under the 40% cap. List padding follows measured overlay height when growing and shrinking, and resets after dismissal/restoration. Failed-panel replacement in both directions and successful retry pass. No new defect reproduced; **CL-15–CL-19 unused**.
- Remove icon/name/testID/44-point target, conditional message spacing and all seven sheet width contracts remain passing.

Final checks from `client/`: `npx tsc --noEmit` **PASS**, exit 0; `npm run lint` **PASS**, exit 0; full `npx jest --runInBand` run **once** after final test edits: **41/41 suites, 619/619 tests passed, 0 failed, 0 snapshots**, exit 0. Final targeted check: **2/2 suites, 56/56 tests passed** (lifecycle **30**, overlay/sheets **26**), 0 snapshots.

Only this document and the two assigned QA test files were edited; no Git commands were run. Physical hit testing, real overflow/font-scale layout, device sheet widths and screen-reader playback remain unverified.

## Item photos client QA (2026-11-14)

**Verdict: FAIL — CL-15 reproduced.** Added three QA test files; no feature code, builder tests, backend files, or git commands touched.

**CL-15 — Medium — [item-thumb.tsx:36](client/src/components/ui/item-thumb.tsx:36):** With Reduce Motion off, load a photo, then refresh its URL with a new signature. Cache and React identity remain stable, but the image still requests a **150 ms fade**. Expected: no repeat fade. [Expo SDK 58 documents transitions on source changes](https://docs.expo.dev/versions/v58.0.0/sdk/image/#transition).

Other checks passed: fallback order across requested surfaces, token retention/drop behavior, URL resolution, matcher cases, accessibility props, and all **87 SVGs plus the licence**. CL-16–CL-19 remain unused.

Final checks:

- Typecheck: **PASS**
- Lint: **PASS**
- Full Jest, run once: **45 suites passed, 1 failed; 772 tests passed, 1 failed; 773 total; 0 snapshots**
- New QA tests: **69 passed, 1 failed**

Device rendering, screen-reader playback, and measured hit bounds remain unverified.

_Written by client QA (Codex); appended by the orchestrator because the QA sandbox could not write outside `client/`._

### Re-check (2026-11-14)

**Verdict: FAIL — CL-15 fixed; CL-16 (low) reproduced.** Re-checked the current fix identified as `0eaf79b` without running Git. Only the assigned QA test and report files were changed.

- **CL-15: FIXED / PASS.** With Reduce Motion off, the first photo requests the theme's **150 ms** transition; immediately after its `onLoad`, transition is **0**. Re-signing that key repeatedly preserves **0**, including subsequent load events. A different photo requests **150 ms** once, then **0** after loading and signature renewal. Reduce Motion keeps **0** throughout loads, signature changes, different photos, errors and retries. A failed photo retries with a fresh signature both before its first successful load and after an earlier successful load; the latter retains transition **0**.
- **CL-16: OPEN / FAIL — returning to an earlier loaded key repeats the fade.** In the same mounted `ItemThumb`, load A, switch to B and load B, then return to A with a fresh signature. Expected **0** for the already loaded key; actual **150 ms**. `client/src/components/ui/item-thumb.tsx:28,38–39` stores only the most recently loaded key: B's `onLoad` overwrites A. This affects a thumbnail whose photo changes A → B → A; ordinary signature renewal is fixed. Regression: `CL-16: returning to an already loaded cache key does not fade it again` in `client/src/__tests__/qa-item-photos-thumb.tsx`. No feature fix applied. CL-17–CL-19 remain unused.

Exact final results from `client/`:

- `npx tsc --noEmit`: **PASS**, exit **0**.
- `npm run lint`: **PASS**, exit **0**.
- Targeted `npx jest --runInBand --runTestsByPath src/__tests__/qa-item-photos-thumb.tsx`: **42 passed, 1 failed, 43 total; 1 failed suite; 0 snapshots**. The sole failure is CL-16. The initial targeted run exposed missing native-event payloads in the new QA tests; those test-only harness errors were corrected before the final targeted and full runs.
- Full `npx jest --runInBand`, run **once** after final test edits: **45 suites passed, 1 failed, 46 total; 777 tests passed, 1 failed, 778 total; 0 skipped, 0 snapshots**, exit **1**, **41.454 s**. The sole failure is CL-16.

`EXPO_NO_DOTENV=1` disabled dotenv loading. No Git commands, `.env` reads, or live Gemini/ML calls were used. Assertions verify component events and the transition props passed to Expo Image; native animation rendering, device cache behavior and screen-reader playback remain unverified. Transition semantics were checked against the [Expo SDK 58 Image documentation](https://docs.expo.dev/versions/v58.0.0/sdk/image/#transition).

### Re-check 2 (2026-11-14)

**Verdict: PASS** for source/component verification. Re-checked the session-wide photo-key cache in the current worktree without running Git. Only `client/src/__tests__/qa-item-photos-thumb.tsx` and this report were edited; feature code and builder tests were not changed.

- **CL-15: FIXED / PASS.** A never-shown photo requests the theme's **150 ms** transition, then **0** after its successful load. Repeated signature renewal keeps **0**; a different never-shown photo fades once. Reduce Motion keeps **0** across loads, signature renewal, photo changes, errors and retries. An error followed by a fresh signature retries both before and after an earlier successful load, preserving the expected first-load/already-shown transition.
- **CL-16: FIXED / PASS.** A → B → A retains **0** for A after both photos loaded. Unmounting and remounting an already-shown photo retains **0**, with either the original or a fresh signature. The session remembers exactly **500** distinct keys; remembering an existing key neither evicts nor refreshes its insertion order. Key **501** evicts only the oldest key. A retained key still requests **0**; the evicted photo requests **150 ms** once when shown again, then **0**, with the cache remaining bounded at **500**.
- **Test isolation / mocks: PASS.** `client/package.json` wires `jest.setup.ts` through `setupFilesAfterEnv`. The setup imports only `resetLoadedPhotosForTests` from `loaded-photos.ts`, which has no imports or re-exports; it does not preload `ItemThumb`, theme, motion, Expo Image, or their real implementations. Two consecutive QA cases leave a remembered key behind and verify that the next test starts with an empty session, relying on the global setup rather than a local reset. Test-file theme and motion mocks remain replaceable and control the rendered transition. Existing mocked component/flow tests also pass in the full suite.
- No new client defect reproduced; **CL-17–CL-19 remain unused**.

Exact final results from `client/`, with `EXPO_NO_DOTENV=1`:

| Command | Result |
|---|---|
| `npx jest --runInBand --runTestsByPath src/__tests__/qa-item-photos-thumb.tsx` | **PASS**, exit **0**: **1/1 suite, 49/49 tests passed**, 0 failed, 0 snapshots; **2.186 s**. Includes six new QA cases. |
| `npx tsc --noEmit` | **PASS**, exit **0**. |
| `npm run lint` | **PASS**, exit **0**. |
| `npx jest --runInBand` — full suite, run **once** after final test edits | **PASS**, exit **0**: **46/46 suites, 784/784 tests passed**, 0 failed, 0 skipped, 0 snapshots; **59.244 s**. |

No Git commands, `.env` reads, or live Gemini/ML calls were used. Checks establish cache behavior, component events and Expo Image transition props. Native animation playback, device image caching, physical hit bounds and screen-reader playback remain unverified. The transition interpretation follows the [Expo SDK 58 Image documentation](https://docs.expo.dev/versions/v58.0.0/sdk/image/#transition).
## Save closes with notice QA (2026-11-14)

**Verdict: FAIL.** CL-17 reproduces stale Save completion after leaving Item detail.

Scope: owner request dated 2026-11-14, requested commit `8ecf5c8`. Examined the current
worktree's Item detail, pickup sheet, notice provider, root layout and theme tokens.
Revision identity was not independently verified; no Git commands were run.
Added only `client/src/features/item/__tests__/qa-save-notice-test.tsx` (12 cases) and this
section. Feature code and builder tests were not edited.

### Bugs

| ID | Severity | File:line | Repro and observed behavior |
|---|---|---|---|
| CL-17 | High | `client/src/features/item/item-detail-screen.tsx:102`–`:107`; also `:89` and `:91` | Delay `updateItem`, press Save, press the still-enabled Back button, and unmount Item detail while retaining the app provider. Resolve Save. The stale screen calls `router.back()` again, or `router.replace('/fridge')` without history, and publishes a success notice/haptic. This can dismiss the user's destination. Alternatively change the route ID while retaining the detail component, wait for Apples to load, then resolve the earlier Spinach Save: the form becomes Spinach and navigates away. All three regressions fail. The load request has an invalidation guard, but Save and the mutation catch/finally do not: they call state setters after the await without checking unmount/current item. Post-unmount setter calls are source evidence; no React warning is used as proof. |

CL-18 and CL-19 remain unused. These lifecycle variants share one underlying defect.
Next step: the feature owner guards mutation completion and state updates against an
unmounted/stale detail screen, then re-runs the CL-17 regressions.

### Coverage

| Area | Result |
|---|---|
| Successful Save / double press | PASS: duplicate presses while the response is pending and another press before route teardown cause one update, one success haptic and one navigation. Both back history and `/fridge` fallback pass. The app-wide notice survives removal of its originating screen. |
| Failure then success | PASS: inline alert and Try again, edited name retained, no departure/notice on error, one successful retry with the exact saved-name notice. Error then success haptic order verified. |
| Check again / Share | PASS: pending photo analysis and share creation disable Save and suppress its request. Completing those operations never navigates or publishes a Save notice. A later explicit Save after Check again closes once. Existing builder tests also cover Share off and photo retry/cancel without navigation. |
| Pickup sheet | PASS for modal/handler evidence: pending Done blocks duplicate requests, Cancel and native request-close; completion closes only the sheet and does not navigate or publish a Save notice. A later explicit Save closes detail. Pickup uses its own pending state, so the underlying Save is not disabled by pickup; the presented modal blocks user access to it. Physical modal interception remains unverified. |
| Removed items | PASS: already-removed detail has no Save action. Removing an item elsewhere while its editor is open yields inline Item not found / Try again with no navigation or notice, including retry. |
| Notice accessibility / placement | PASS for component/style evidence: polite live region, one line, `pointerEvents: 'none'` in the container style, absolute top 0, safe-area top/left/right edges, centered 100% width capped at the 520-point app column. Root layout places the provider outside the router stack and inside SafeAreaProvider. |
| Notice deadline / cleanup / motion | PASS: existing 8-case notice suite verifies presence at 2,999 ms, removal at 3,000 ms, replacement (including identical text) resetting the deadline, old timeout cancellation, animation stop on replacement/unmount, timer cleanup on provider unmount, and no fade with Reduce Motion. Changing Reduce Motion does not reset the deadline. |
| Theme / long names | PASS for tokens/text props: notice uses `forest` / `onForest`; calculated text contrast is 9.02:1 light and 9.94:1 dark. A 199-character name retains full notice text with the success meaning first, one-line truncation and the default tail ellipsis. Actual ellipsis placement and accessibility announcement playback remain unverified. |

### Validation

Run from `client/`, with final QA test contents:

| Command | Result |
|---|---|
| `npx tsc --noEmit` | PASS, exit 0. |
| `npm run lint` | PASS, exit 0. |
| `npx jest src/features/item/__tests__/qa-save-notice-test.tsx src/components/notice/__tests__/notice-test.tsx --runInBand` | FAIL, exit 1: 2 suites total (1 passed, 1 failed); 20 tests total (17 passed, 3 failed); 0 snapshots. New QA: 9 passed / 3 failed; existing notice suite: 8 passed. |
| `npx jest --runInBand` | Run exactly once. FAIL, exit 1: 43 suites total (42 passed, 1 failed); 641 tests total (638 passed, 3 failed); 0 skipped, 0 snapshots. All 629 pre-existing tests pass. Only the three new CL-17 regressions fail. |

Results are Jest/component and mock-service checks. No live API, browser interaction,
Android/iOS build, device haptic, native hit test, screen-reader playback or large-text
layout was exercised. The stale route-ID case simulates component reuse; actual router
reuse behavior on a device is unverified. No feature fix was applied.

### Re-check (2026-11-14)

**Verdict: FAIL.** The three original CL-17 regressions now pass, but two residual
lifecycle defects reproduce as CL-18 and CL-19.

Read the current worktree's `shown = useRef({ mounted, id })` guard and ID-change
reset in `item-detail-screen.tsx`. Revision identity remains unverified; no Git
commands were run. Extended only `client/src/features/item/__tests__/qa-save-notice-test.tsx`
from 12 to 18 cases and appended this re-check. Feature code and builder tests were
not edited. The earlier FAIL and unused-ID statements above describe the original run.

| ID | Status | Evidence / remaining defect |
|---|---|---|
| CL-17 | **Fixed/verified for the three original cases.** | Resolving Save after Back and detail unmount produces no further navigation, notice or haptic, both with history and with `/fridge` fallback. Resolving the old Save while the reused component shows Apples preserves Apples and produces no navigation, notice or haptic. The success guard returns before the Save state setters. `perform()` still reaches its unguarded `finally` state setter; complete post-unmount setter suppression is not established. |
| CL-18 | **Open, high.** `client/src/features/item/item-detail-screen.tsx:66`–`:70`, `:110`–`:121`. | Start a delayed Save on item A with name "Earlier saved name", route the retained detail component to B, then back to A before resolving the request. Resolve the old A Save: it replaces the current form name, publishes "Saved changes to Earlier saved name", emits a success haptic and navigates back. Checking only the current ID accepts a request from an earlier visit when that ID matches again; visit invalidation is missing. One failing regression at `qa-save-notice-test.tsx:264`. |
| CL-19 | **Open, medium.** `client/src/features/item/item-detail-screen.tsx:92`–`:99`. | Start a delayed Save, then unmount detail or reuse it for Apples; reject the old request. Unmount still emits an error haptic. Apples receives an unrelated "Old item save failed" inline error / Try again and an error haptic. Neither case navigates or publishes a success notice. Rejection bypasses the success-only guard and reaches the unguarded `perform()` catch/finally. Two failing regressions at `qa-save-notice-test.tsx:294`. |

| Requested confirmation | Result |
|---|---|
| Save twice on the same item after returning | **PASS** for completed requests: save A, switch the same component to B and save B, return to A and save A again. Three updates, three notices/haptics and three departures, tested with history and without. Repeated taps during each closing interval cannot resubmit. The separate pending-request round trip fails as CL-18 above. |
| `closing` resets when ID changes | **PASS:** both B's Save and A's second Save succeed on the retained component after an earlier successful Save set `closing`. Source resets it in the `[id]` effect at line 69. |
| Remove / Share / Check again | **PASS:** added Remove → Used it → Undo coverage preserves detail without Save navigation/notice, restores the form and leaves Save enabled. Existing QA covers pending Share/Check again blocking Save, no Save notice/departure on completion and a later explicit Save after Check again. Unchanged builder tests for sharing on/off, photo patch/retry/cancel, removal/handoff and pickup also pass in the full run. |
| Other original Save / notice coverage | **PASS:** all 12 original QA cases pass, including success/double press, inline failure/retry, pickup isolation, removed items and long-name notice. Existing notice coverage also passes in the full run. |

Run from `client/`, after adding all six new cases:

| Command | Result |
|---|---|
| `npx jest src/features/item/__tests__/qa-save-notice-test.tsx --runInBand` | FAIL, exit 1: 1 suite failed; 18 tests total (15 passed, 3 failed); 0 snapshots. Then expanded failure assertions to report all stale effects together; no cases added or removed. |
| `npx tsc --noEmit` | PASS, exit 0, with final QA test contents. |
| `npm run lint` | PASS, exit 0, with final QA test contents. |
| `npx jest --runInBand` | Run exactly once for this re-check, with final QA test contents. FAIL, exit 1: **43 suites total (42 passed, 1 failed); 647 tests total (644 passed, 3 failed); 0 skipped, 0 snapshots.** QA Save suite: **18 total (15 passed, 3 failed)**. All **629 tests outside this QA file pass**. Only CL-18 (one case) and CL-19 (two cases) fail. |

Next steps: the feature owner invalidates Saves across route visits, including return
to the same ID, and guards stale rejection/state cleanup; then re-run these regressions.
No feature fix was applied. Evidence is source, Jest/component and mock-service only.
Actual router reuse, live API, browser/device interaction, Android/iOS builds, device
haptics, native hit testing, screen-reader playback and large-text layout remain unverified.

### Re-check 2 (2026-11-14)

**Verdict: FAIL** against the requested guarantee that an invalidated mutation performs
no state updates. **All requested behavioral regressions pass.** The remaining discrepancy
is source-confirmed: `client/src/features/item/item-detail-screen.tsx:101` still executes
`finally { working.current = false; setPending(false); }` unconditionally. A stale Save's
success returns at lines 114–115, or its rejection returns at line 98, but both still
execute this cleanup, including after unmount. The visit guard therefore suppresses
stale form/error/haptic/notice/navigation effects, but does not suppress every stale
state setter as described in the request. No React warning or new user-visible failure
is claimed as evidence for this remaining CL-17 requirement.

Read the current worktree's visit counter, `[id]` setup/cleanup, `perform()` and `save()`.
Revision identity remains unverified; no Git commands were run. Extended only
`client/src/features/item/__tests__/qa-save-notice-test.tsx` from **18 to 24 cases** and
appended this subsection. Feature code and builder tests were not edited.

| ID | Status | Evidence |
|---|---|---|
| CL-17 | **Original behavior fixed/verified; state-cleanup requirement remains open.** | All three original regressions pass: late success after Back/unmount stays silent with history and with the `/fridge` fallback; late success on reused detail preserves Apples without departure, notice or haptic. `save()` returns before its form setters. The unconditional `perform()` finally at line 101 still calls `setPending(false)` after invalidation/unmount, as detailed above. |
| CL-18 | **Fixed/verified.** | A → B → A while A's Save is pending no longer accepts the old response. The current name is retained with no notice, haptic or navigation. Both stale resolution and stale rejection across that round trip are covered; a deliberate current-visit Save afterward succeeds exactly once. |
| CL-19 | **Stale error/haptic behavior fixed/verified.** | Rejecting after unmount or after switching to Apples produces no inline mutation error, error haptic, notice or navigation. Added rejection after A → B → A also stays silent and permits a subsequent current Save. The shared state-cleanup discrepancy is tracked under CL-17 rather than as a new ID. |

| Additional confirmation | Result |
|---|---|
| Current Save after stale settlement | **PASS, four added cases:** stale resolve/reject, each on B and after returning to A. The active item's name survives settlement; the next Save sends the current ID and edited name, emits one success haptic/notice and navigates once. Duplicate taps during that request and after closing cannot resubmit. |
| Working/pending recovery | **PASS** in those four cases: after stale settlement, mutation loading is absent, the name field is editable and Save is enabled. A new Save actually issues a request, proving `working` is released; while it is pending, loading returns and duplicate submission is blocked. Its completion clears loading and restores editing. These checks establish recovery after settlement, not independent concurrent mutations across visits. |
| React StrictMode double effects | **PASS, two added cases**, with and without back history. An effect probe inside the same StrictMode root asserts actual `setup → cleanup → setup` replay. The current visit still submits, displays a genuine current-request error, recovers pending state, retries with the edited name and closes once with the correct notice/haptic. Duplicate taps remain blocked. |
| Existing coverage | **PASS:** all 18 earlier QA cases, including failure/retry, repeated completed visits, Share/Check again, pickup isolation, Remove/Undo, removed items and long names. All 629 tests outside this QA file also pass in the full run. |

Run from `client/`, with final QA test contents:

| Command | Result |
|---|---|
| `npx jest src/features/item/__tests__/qa-save-notice-test.tsx --runInBand` | **PASS**, exit 0: **1/1 suite, 24/24 tests passed; 0 failed, 0 snapshots.** An earlier targeted run had 22 passed / 2 failed because the new StrictMode assertions targeted the error container, which also contains Try again. Corrected only those assertions to target its alert; the effect-replay assertions already passed. |
| `npx tsc --noEmit` | **PASS**, exit 0. |
| `npm run lint` | **PASS**, exit 0. |
| `npx jest --runInBand` | Run **exactly once** for this re-check, after final test edits. **PASS**, exit 0: **43/43 suites, 653/653 tests passed; 0 failed, 0 skipped, 0 snapshots.** QA Save suite: **24/24 passed**; outside that file: **629/629 passed**. |

Next step: the feature owner resolves the mismatch between unconditional mutation
cleanup and the requested no-stale-state guarantee while preserving the verified
working/pending recovery. No additional defect was assigned a new ID, and no feature
fix was applied. These are source, Jest/component and mock-service results; actual
router reuse, live API, browser/device interaction, Android/iOS builds, device haptics,
native hit testing, screen-reader playback and large-text layout remain unverified.

**Orchestrator ruling (2026-11-14), Re-check 2:** the `setPending(false)` / `working.current = false` reset after a stale save settles is **by design**, not a defect. It is the "flags recover" requirement: without it the current visit stays blocked as busy, and on an unmounted screen it is a no-op. The brief's "no state" wording meant item data, errors, haptics, notices and navigation. With CL-17, CL-18 and CL-19 passing and Jest 43 suites / 653 green, the save-closes-with-notice change is **PASS**.


## Read-and-confirm redesign QA (2026-11-14)

**Verdict: FAIL.** Three reproduced findings, **CL-20–CL-22**, account for four failing regression cases. **CL-23–CL-29 remain unused.** The obsolete global-Save/inline-candidate tests have been rewritten for sheets; their failures are no longer caused by removed controls.

Scope: the 2026-11-14 owner ruling in `docs/DECISIONS.md`, requested commit `a7f56fd` and its subsequent merge, checked against the files present in this worktree. Commit/branch identity was **not independently verified**, because no Git commands were run. Changes in this pass are confined to this report and:

- `client/src/features/item/__tests__/qa-save-notice-test.tsx` — rewritten, **36 cases**.
- `client/src/__tests__/qa-item-photos-flows.tsx` — **26 cases**; photo review now edits through sheets, deselects the excluded candidate, and verifies the crop token in the Add payload. Text/barcode/receipt cases also edit through sheets.
- `client/src/__tests__/qa-confirm-ui-test.tsx` — new, **46 cases**.
- `client/src/__tests__/qa-confirm-web-test.tsx` — new, **2 cases**, using real React Native Web components and React DOM in jsdom.

Feature code and builder tests were not edited. No live API, Gemini/ML call, dependency installation, commit, push or PR was performed.

### Findings

| ID | Severity | File:line | Reproduction and evidence |
|---|---|---|---|
| **CL-20** | **Medium** | `client/src/components/ui/food-summary.tsx:77`–`:79`; `client/src/features/item/item-detail-screen.tsx:94`, `:99`, `:200` | Delay A's Stored-in PATCH, then reuse the mounted detail component for item B while the sheet is open. B's detail and sheet values appear. Resolve **or reject** A's request: the sheet on B closes. The visit guard correctly suppresses item-data/error/notice/haptic changes, but returns a fulfilled `Promise<void>` for both stale outcomes. `FoodEditSheet.save()` then unconditionally calls `close()`, whose callback clears the current `editing` state. The sheet is keyed only by field, and its own completion has no visit guard. **Two failing cases** at `qa-save-notice-test.tsx:197`. This is component-reuse evidence; actual router reuse on a device is unverified. |
| **CL-21** | **High** | `client/src/features/add/candidate-editor.tsx:29`–`:30`, `:43`; `client/src/features/add/candidate-review.tsx:62`–`:63`, `:98` | In review, open a previously fresh candidate, choose Freshness → **Looks off**, then return to review. The exported draft has `freshness: 'spoiled'`, but stays outside Looks spoiled and has no Toss/Keep controls. `needsSpoiledDecision()` returns false and `draftError()` is undefined, so the shared Add validation accepts it without a disposition. Classification and validation inspect `candidate.freshness`, ignoring the edited `draft.freshness` which is sent to create. **One failing case** at `qa-confirm-ui-test.tsx:149`. The common draft/validation path is used by photo, text, barcode and receipt; this regression exercises the shared component and serializer, rather than making four live creates. |
| **CL-22** | **Medium** | `client/src/components/ui/fade-in.tsx:15`–`:24`; `client/src/features/add/candidate-review.tsx:75`; `client/src/components/ui/food-summary.tsx:44` | Enable Reduce Motion and show or update summary/review content. `FadeIn` still starts at opacity **0** and calls `Animated.timing` for **150 ms**. It never reads Reduce Motion; review only sets the stagger delay to zero. Thus the redesigned rows/header continue fading despite the preference. **One failing case** at `qa-confirm-ui-test.tsx:234`, with the preference mocked true, observes one animation and initial opacity 0. Sheet slide-to-fade substitution and notice motion handling pass separately. Device animation playback is unverified. |

CL-17/18/19's former stale item-data, stale error/haptic, notice and navigation regressions pass for sheet saves. CL-20 tracks the newly exposed sheet-close side effect separately. The earlier orchestrator ruling permitting pending/working flag cleanup after stale settlement remains respected; it is not reported as a defect.

### Coverage and limits

| Area | Result |
|---|---|
| Save-on-pick, isolated choices, retry and double taps | **PASS:** storage/group/freshness sheets contain only that choice, issue one request while pending, close after success and stay in Item detail. A current failure retains the sheet with an inline alert and Try again repeating the exact patch; error then success haptics occur once each. Cancel/request-close and other options cannot dismiss or change a pending sheet. **CL-20** covers the distinct route-change lifecycle. |
| Visit lifecycle | **PASS** for stale success/failure after unmount, after Back plus destination teardown (with history and `/fridge` fallback), on B and after A → B → A. Current item data survives, with no stale errors, haptics, notices or navigation, and a subsequent current-visit save succeeds. Completed A → B → A saves also work. StrictMode cases assert actual setup/cleanup/setup replay and current failure/retry recovery. **FAIL** for the stale sheet close in CL-20. |
| Success notice | **PASS:** exact saved-name text, one 3,000 ms notice deadline per save, one success haptic, polite live region, touch-transparent container, one-line long-name text, survives origin teardown, present at 2,999 ms and absent at 3,000 ms. Existing provider tests (**8/8**) also pass, including replacement/deadline cleanup and Reduce Motion. Spoken announcements and visual ellipsis remain unverified. |
| Other detail actions / removed items | **PASS:** Share on/off, pickup Done, Check again, Remove and Undo never navigate or post a sheet-save notice. Pickup blocks duplicate Done/cancellation while pending. Already-removed items expose no editable rows. Removal elsewhere makes the pending edit fail inline and retain retry. |
| Storage re-estimation | **PASS, 7 cases:** Stored-in and Move issue identical patches and produce matching mock-service dates/sources for estimated dates, user dates retained by default, explicit re-estimation, expired estimated/user dates, freezing, thawing meat with a two-day cap, and fridge → pantry. Storage-only requests omit `predicted_expiry`, so they do not suppress server re-estimation. These are client/mock results; live backend re-estimation was not exercised. |
| Estimated / expired dates | **PASS:** re-confirming the same date omits the date field and preserves estimated status. Choosing another date makes it user-sourced and removes estimated; re-confirming that user date does not restore estimated. Candidate drafts retain the crop token and analogous date-source behavior. Past dates, including 2000-02-29, save literally and retain the Expired explanation. |
| Name & amount | **PASS:** empty/whitespace name; zero, negative, empty, nonnumeric and infinite quantity; and blank unit cannot submit. A 200-character name, decimal quantity and trimmed unit save once. Fields retain platform font scaling and have no text truncation in the summary. **Acceptance interpretation:** no global Item detail Save remains; Name & amount still has a sheet-local Save at `food-summary.tsx:114`. That control was exercised explicitly, not claimed absent. If “No Save button” also prohibits the multi-field sheet's submit control, that wording needs an owner ruling. |
| Candidate warnings, sorting, selection and Add | **PASS:** null confidence is unflagged, 0.49/0 flagged, 0.5 unflagged; non-food is flagged even at high confidence. Warning includes words and a decorative icon. Equal-priority order is stable before/after edits, independently within food and Looks spoiled sections, for all four add sources. Receipt non-food starts deselected; the other sources retain selection. Original spoiled candidates still require Toss/Keep and reselection after Toss clears the decision. **CL-21** covers newly edited spoilage. Add actions are outside the scrolling candidates in every add flow. Photo and single-photo payloads retain the edited candidate's `photo_token`, omit preview URLs and exclude the deselected token; other add methods send no token. |
| Calendar boundaries and local dates | **PASS:** Jan 31 → February in leap/non-leap years; leap-day → March; December → January and back; Tomorrow across leap day/year end and both 2026 Chicago DST changes. Host timezone verified as **America/Chicago**; spring offsets **360 → 300 minutes**, fall **300 → 360 minutes**. Local YYYY-MM-DD values and one-day relative labels remain correct. Today ring/hint are independent of selected day; past days remain selectable; cells have 44-point minimum dimensions. |
| Accessibility / web / native | **PASS for tested evidence:** “Stored in, Fridge” plus button role; all five summary rows have ≥44-point minHeight, untruncated text and scaling enabled; selected/disabled states; modal scope and 520-point column cap. Real React Native Web/jsdom tests establish initial focus inside, focus containment, Escape dismissal, focus restoration and pending Escape/Cancel blocking. CSS animation completion is dispatched explicitly because jsdom does not play CSS animations. Native iOS/Android request-close handlers are tested with native component mocks; native screen-reader focus/escape, touch interception and physical target sizes remain unverified. |
| Contrast / motion | **PASS:** light and dark ink/secondary/muted/error text against surface/ground, and onForest against forest, meet calculated AA **4.5:1**; today's ring meets **3:1**. Sheet Reduce Motion uses fade instead of slide. **FAIL:** shared content FadeIn, CL-22. Calculations and props do not establish device rendering or 200% Dynamic Type layout. |

Documentation checked against Expo **SDK 58** from `client/package.json`: [versioned SDK reference](https://docs.expo.dev/versions/v58.0.0/), [React Native accessibility](https://reactnative.dev/docs/accessibility), and [Modal behavior](https://reactnative.dev/docs/modal). These inform interpretation of roles and modal props; test results above come from the worktree itself.

### Exact validation results

All commands ran from `client/` with `EXPO_NO_DOTENV=1`. No test edits followed the full-suite run.

| Command / scope | Result |
|---|---|
| `npx tsc --noEmit` | **PASS**, exit **0**, final test contents. |
| `npm run lint` | **BLOCKED**, exit **1**: ESLint `import/no-unresolved` attempts a case-sensitivity directory scan and receives **EPERM: scandir `C:\Users\Frankinstyle`**, first reported in untouched `src/__tests__/demo-path-test.tsx:4`. This is an environment limitation, not a claimed feature defect. |
| `npx eslint src/features/item/__tests__/qa-save-notice-test.tsx src/__tests__/qa-item-photos-flows.tsx src/__tests__/qa-confirm-ui-test.tsx src/__tests__/qa-confirm-web-test.tsx --no-cache --rule 'import/no-unresolved: [2, {"caseSensitive": false}]'` | **PASS**, exit **0**. QA files checked with only the blocked directory-case scan disabled. |
| `npx eslint . --no-cache --rule 'import/no-unresolved: [2, {"caseSensitive": false}]'` | **PASS**, exit **0**, full client. Import resolution stays enabled; this is a qualified fallback, not a successful unmodified `npm run lint`. |
| Targeted final QA run: `npx jest --runInBand --silent --no-color --runTestsByPath src/features/item/__tests__/qa-save-notice-test.tsx src/__tests__/qa-confirm-ui-test.tsx src/__tests__/qa-confirm-web-test.tsx src/__tests__/qa-item-photos-flows.tsx` | **FAIL**, exit **1**: **4 suites** (2 passed, 2 failed), **110 tests** (**106 passed, 4 failed**), 0 snapshots; **13.208 s**. |
| Full `npx jest --runInBand` (executed **once**, with `--json --silent --no-color` reporting flags; JSON summarized in memory) | **FAIL**, exit **1**: **52 suites** (**50 passed, 2 failed**), **897 tests** (**893 passed, 4 failed**), **0 skipped**, **0 todo**, **0 snapshots**; **69.616 s**. |

Final full-run breakdown:

| Suite | Passed | Failed | Total |
|---|---:|---:|---:|
| `features/item/__tests__/qa-save-notice-test.tsx` | 34 | 2 (CL-20 success/failure) | 36 |
| `__tests__/qa-confirm-ui-test.tsx` | 44 | 2 (CL-21, CL-22) | 46 |
| `__tests__/qa-confirm-web-test.tsx` | 2 | 0 | 2 |
| `__tests__/qa-item-photos-flows.tsx` | 26 | 0 | 26 |
| All other suites, untouched in this pass | 787 | 0 | 787 |
| **Total** | **893** | **4** | **897** |

Next steps: guard sheet completion across visits, apply spoilage classification/validation to the effective edited freshness, and make shared content fades respect Reduce Motion; then re-check CL-20–CL-22. Full native builds, real-browser layout, device accessibility/haptics, 200% text layout and live service behavior remain unverified. The unmodified lint command also needs an environment with permission for its parent-directory scan. No feature fix was applied.

### Re-check (2026-11-14)

**Verdict: PASS for source, component and mock-service checks.** All four original failing
regressions now pass. **CL-20–CL-22 are fixed/verified; CL-23–CL-29 remain unused.**
The earlier FAIL and command results above describe the previous pass and are preserved.
Revision/branch identity remains **unverified**: no Git commands were run.

Read the current sheet completion/visit guards, effective candidate freshness, FadeIn,
notice provider and Fridge clearance lifecycle, shared sheets, tab layout and Jest setup.
Changed only this report and four allowed QA files: extended `qa-save-notice-test.tsx`
and `qa-confirm-ui-test.tsx`; added `qa-confirm-notice-test.tsx` and
`qa-accessibility-listener-test.tsx` under `client/src/__tests__/`.
Feature code and builder tests were not edited.

| ID | Status | Re-check evidence |
|---|---|---|
| CL-20 | **Fixed/verified.** | Stale success and rejection return `false`; the sheet closes only when its save result is not `false`. Four QA cases cover A → B and A → B → A. Settlement preserves the current sheet and item with no stale notice, error, navigation or haptic. Pending clears, the retained sheet accepts a deliberate current-item PATCH, then closes and acknowledges exactly once. |
| CL-21 | **Fixed/verified.** | Classification, Toss/Keep rendering, validation and serialization use effective edited freshness. The original fresh → Looks off regression passes. Four added cases, one per photo/text/receipt/barcode source, exercise both Keep and Toss followed by a Fresh edit: the decision clears, the spoiled section/actions disappear, validation accepts fresh, and the payload is fresh. Changing back to Looks off requires a new decision. Toss still deselects the item. |
| CL-22 | **Fixed/verified.** | With Reduce Motion true, FadeIn has opacity 1 and starts no timing animation. The new QA listener case uses the real motion hook, delivers `reduceMotionChanged(true)` and observes full opacity, then verifies subscription removal on unmount. The existing builder test for stopping an in-flight fade when the preference changes also passes in the full suite. |
| CL-23–CL-29 | **Unused.** | No additional confirmed client defect assigned. |

| Requested area | Result and limits |
|---|---|
| Notice placement and interaction | **PASS for tested evidence.** Four added cases cover single/batch Undo with Reduce Motion on/off. The notice is absolute, centered, capped at 520 points, anchored at `tabBar + measured overlay height + spacing.sm`, and uses bottom/side safe-area edges without a top edge. Its container stays `pointerEvents: none`; text remains one polite live region, not an alert. Both real Undo and Dismiss paths are exercised while it is present. A sibling tab-button callback remains callable. These are props/component checks, not physical coordinate hit testing of navigator tabs. |
| Notice during overlay height changes | **PASS for lifecycle checks.** Measurements 160 → 240 → 240 → 120 update only the reserved bottom clearance. The same notice node remains mounted, its animation sequence does not restart, and its original 3,000 ms deadline survives measurement changes, overlay dismissal/restoration and Fridge teardown. Clearance returns to the tab-bar baseline after the overlay disappears. Position follows height changes directly; there is no animated repositioning. **Visible jump-free movement remains unverified on a browser/device.** |
| Themed shared sheets | **PASS.** Two added rendered cases verify light/dark EditSheet and DateSheet panels actually use `theme.colors.surface` and retain every `bottomSheetPanelStyle` property (full width, 520-point cap, centered). DateSheet delegates to EditSheet. Rendered heading/month/selected-date colors match the theme; calculated normal, muted and selected text contrast is ≥4.5:1. Existing broader ink/secondary/muted/error contrast checks also pass. Device rendering and large-text layout remain unverified. |
| `AccessibilityInfo.addEventListener` wrapper | **PASS within the Jest contract.** Two QA cases execute the actual setup file against controlled delegates. The wrapper forwards the exact event and callback, returns the same subscription, permits partial-spy fallthrough/restoration without recursion, and propagates registration, callback and removal errors. An undefined subscription stays undefined; no fallback subscription or catch conceals it. The real-hook QA case separately verifies event delivery and cleanup. The preset's underlying listener is still a no-op mock: native event delivery and supported-event validation are not established by default mock behavior. The wrapper adds no suppression of those failures. See the [official subscription contract](https://reactnative.dev/docs/accessibilityinfo#addeventlistener). |

Final validation ran from `client/` with `EXPO_NO_DOTENV=1`:

| Command | Exact result |
|---|---|
| `npx tsc --noEmit` | **PASS**, exit **0**, final QA test contents. |
| `npm run lint` | **PASS**, exit **0**, unmodified command; the previous EPERM did not recur. |
| `npx jest --runInBand --silent --no-color --runTestsByPath src/features/item/__tests__/qa-save-notice-test.tsx src/__tests__/qa-confirm-ui-test.tsx src/__tests__/qa-confirm-notice-test.tsx src/__tests__/qa-accessibility-listener-test.tsx src/__tests__/qa-confirm-web-test.tsx src/__tests__/qa-item-photos-flows.tsx` | **PASS**, exit **0**: **6/6 suites, 125/125 tests**, **0 failed**, **0 snapshots**; **16.108 s**. |
| Full `npx jest --runInBand` | Executed **exactly once**, after final QA test edits and checks. **PASS**, exit **0**: **55/55 suites, 920/920 tests**, **0 failed**, **0 snapshots**; **45.777 s**. |

Full-run breakdown (no QA test edits followed that run):

| Suite / scope | Passed | Failed | Total |
|---|---:|---:|---:|
| `features/item/__tests__/qa-save-notice-test.tsx` | 38 | 0 | 38 |
| `__tests__/qa-confirm-ui-test.tsx` | 52 | 0 | 52 |
| `__tests__/qa-confirm-notice-test.tsx` | 4 | 0 | 4 |
| `__tests__/qa-accessibility-listener-test.tsx` | 3 | 0 | 3 |
| `__tests__/qa-confirm-web-test.tsx` | 2 | 0 | 2 |
| `__tests__/qa-item-photos-flows.tsx` | 26 | 0 | 26 |
| Other 49 suites | 795 | 0 | 795 |
| **Total** | **920** | **0** | **920** |

Early targeted failures were confined to an incomplete animation stub in the new QA
harness; it was replaced with a forwarding spy. Type errors in that harness were also
corrected before the final checks. No failing feature expectation was removed or inverted.
No live API, browser layout run, Android/iOS build, native screen-reader/haptic playback,
physical hit testing or 200% text run was performed. Those checks, including visible
notice movement as Undo changes height, remain the next verification step.
