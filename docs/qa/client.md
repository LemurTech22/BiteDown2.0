# QA: Expo client (`client/`)

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
