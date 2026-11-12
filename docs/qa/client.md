# QA: Expo client (`client/`)

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
- Checks: `tsc` and `expo lint` clean; Jest 29 suites / 328 tests; backend `test_cors.py` + health + auth 16 passed.

**Not verified**: iPhone Safari on a real device; barcode and receipt camera flows on a device; Food Pantry claim and
Group detail with a second account; delete account; fontScale 2.0 on a device. Receipts need the ML service or Gemini
fallback (`docs/DECISIONS.md` 2026-10-11).
