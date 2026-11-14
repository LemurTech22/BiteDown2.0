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
mismatch BE-52 is recorded in `docs/qa/backend.md`; the client mock and filter exclude that age.

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
