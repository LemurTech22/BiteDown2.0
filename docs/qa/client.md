# QA: Expo client (`client/`)

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
