# BiteDown Expo client

Universal Expo SDK 58 / React Native / TypeScript client for Android, iOS, and web. Routes live in
`src/app/`; shared theme tokens live in `src/theme/`; the typed live and mock API clients live in
`src/api/`. The existing SwiftUI app in the repository's top-level `ios/` directory is separate.

## Requirements

- Node 22.13 or newer
- JDK 17 or newer
- Android SDK with platform-tools, emulator, compile SDK 37, and build-tools 37
- Docker Desktop for the local Flask + PostgreSQL/TimescaleDB backend
- Android 7 or newer on a phone (Expo SDK 58 minimum)

From the repository root, start the backend and verify it:

```powershell
docker compose up -d --build
Invoke-RestMethod http://127.0.0.1:5055/health
```

Install client dependencies:

```powershell
cd client
npm ci
```

Copy `.env.example` to `.env` for local overrides. `EXPO_PUBLIC_*` values are embedded in the app and
must never contain secrets. The default API is `http://localhost:5055`; Demo mode defaults to false.

## Android emulator

Create an Android Virtual Device in Android Studio, or use the `BiteDown_Pixel7_API36` AVD created during
setup. Start it, then run these commands in a terminal where Android `platform-tools` is on PATH:

```powershell
adb reverse tcp:5055 tcp:5055
npx expo run:android
```

`expo run:android` generates the native project, builds a debug app, installs it, and starts Metro. For
later JavaScript-only changes, use `npx expo start` instead. The debug build permits cleartext HTTP so it
can reach the API through `adb reverse`.

## Samsung or other Android phone over USB

1. Enable Developer options and USB debugging on the phone.
2. Connect it by USB, authorize the computer on the phone, and confirm with `adb devices`.
3. Run `adb reverse tcp:5055 tcp:5055` and then `npx expo run:android --device`.
4. Keep the backend running on `127.0.0.1:5055` on the PC. The phone uses `http://localhost:5055` through
   the USB reverse port forward.

## Debug settings and Demo mode

Use **Debug settings** on the placeholder Home screen to edit the server address or toggle Demo mode.
Both settings persist. Demo mode uses `MockApiClient` in memory and makes no backend or Gemini calls.

## iOS and web

- Web development: `npx expo start --web`
- JavaScript bundle checks for all targets: `npm run export:check`
- iOS native builds require Xcode locally or Expo Build in the cloud. The Expo iOS bundle identifier is
  `com.coderedorion.bitedown`; the top-level SwiftUI project is not changed.

## Standalone/release builds

Release builds disable Android cleartext traffic. Configure `EXPO_PUBLIC_API_BASE_URL` to a public HTTPS
Flask backend before building a standalone app; `localhost`, `adb reverse`, and the PC's Docker containers
are development-only. The backend and PostgreSQL/TimescaleDB database are not bundled into the app.

## Checks

```powershell
npx tsc --noEmit
npx expo lint
npx expo-doctor
```
