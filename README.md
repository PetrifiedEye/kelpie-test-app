# kelpie-test-app

React Native client for the Kelpie statement-import test. It is an Expo development build (SDK 58, React Native 0.88) with TypeScript. Routes live in `src/app`. Expo Go is not a valid run: the review is a native build.

The local mock and fixtures live in `../mobile-engineer-kit`. Do not change that kit. Node.js 20 or newer is required. This checkout was exercised with Node.js 24.22.2.

## Clean checkout

From a fresh clone of this repository, with no `node_modules` and no generated `android/` or `ios/` directory:

```bash
cd mobile-engineer-kit
npm start
```

The mock listens on `http://127.0.0.1:8787`. It has no install step. Leave that process running.

In a second terminal:

```bash
cd mobile-engineer-kit
npm run fixtures:oversize
npm test

cd ../kelpie-test-app
npm install
npm test
npm run lint
npx expo run:android
```

`npx expo run:android` generates `android/` (gitignored), installs the development build, and starts Metro. Package name: `com.kelpie.testtask`. Later launches can use `npx expo start` and the already installed development build.

These changes were not tested on iOS. A Mac can still try them with the iOS Simulator development build attached to the [v1.0.0 GitHub release](https://github.com/PetrifiedEye/kelpie-test-app/releases/tag/v1.0.0) (`kelpie-test-app-ios-simulator.tar.gz`). See [Platforms](#platforms).

An Android emulator reaches the host mock at `http://10.0.2.2:8787`. An iOS simulator uses `http://127.0.0.1:8787`. Those are the defaults when `expo.extra.mockApiUrl` in `app.json` is empty. `adb reverse` is not required for the emulator default.

A physical device cannot use those loopback addresses. Start the mock on the LAN and set the client URL before opening the app:

```bash
# mobile-engineer-kit, PowerShell
$env:HOST = "0.0.0.0"
npm start
```

```json
"extra": { "mockApiUrl": "http://<this-computer-lan-ip>:8787" }
```

Reload the development build after changing `mockApiUrl`. If that field is empty on a physical device, the client falls back to `http://192.168.0.192:8787`, which is only the LAN address of the machine used while writing this app. Replace it. Do not expose the mock to the internet.

On Windows PowerShell, `curl` is an alias of `Invoke-WebRequest`. The diagnostic commands below use `curl.exe`.

## Tests

Recorded on 3 November 2026 on Windows 11 (build 26200), Node.js 24.22.2.

| Suite | Command | Result |
| --- | --- | --- |
| Client | `npm test` in `kelpie-test-app` | 14 suites, 57 tests, all passed |
| Mock kit | `npm test` in `mobile-engineer-kit` | 6 tests, all passed |

Client tests cover the saved idempotency key, one job after a lost acknowledgement, a stale revision, a failed delete, and local rejection of `spoofed.pdf` and a file over 10 MiB. They talk to the kit mock, not a substituted in-UI client.

## Platforms

| Platform | What ran | Result |
| --- | --- | --- |
| Android | Development build `com.kelpie.testtask` on an Android emulator (Pixel 10a) on this Windows host | The app opened. A ready report (two charges, 151.99 AUD/мес.) and the Diagnostics screen were captured in `artifacts/ready-details.png` and `artifacts/diagnostics.png`. The acceptance matrix is in [artifacts/matrix/android-matrix.mkv](artifacts/matrix/android-matrix.mkv). The emulator system-image version was not recorded. |
| iOS | Nothing on this host | Changes in this checkout were not tested on iOS. There is no iOS recording. A Mac can install the simulator development build from the GitHub release and connect it to Metro. |

The Android recording covers the happy path, local rejection of `spoofed.pdf` and `oversize.csv` before any POST, `lost_ack` followed by a relaunch, `stale_status`, and `delete_failure`. Stills from the same run are in `artifacts/matrix/`.

### iOS on a Mac

Changes in this checkout were not tested on iOS. There is no iOS recording. A Mac with Xcode can still try them.

The EAS `development-simulator` profile produced `kelpie-test-app-ios-simulator.tar.gz` on the [v1.0.0 release](https://github.com/PetrifiedEye/kelpie-test-app/releases/tag/v1.0.0), from commit `d0bac64`. Build log: [30e5c1f9-1017-492e-9bad-c4575f17c905](https://expo.dev/accounts/yab-personal/projects/kelpie-test-task/builds/30e5c1f9-1017-492e-9bad-c4575f17c905). The archive is an unsigned Expo development client for the iOS Simulator. It is not a build for a physical iPhone, and it was not launched as part of this review.

On macOS, with Xcode and a booted iOS Simulator:

1. Download `kelpie-test-app-ios-simulator.tar.gz`.
2. Unpack it and install the app:

```bash
tar -xzf kelpie-test-app-ios-simulator.tar.gz
xcrun simctl install booted kelpietestapp.app
```

3. Check out this release.
4. Start the mock from `mobile-engineer-kit` with `npm start`.
5. In `kelpie-test-app`, run `npm install`, then `npx expo start`.
6. Open the installed app in the Simulator and connect to the bundler URL.

`npx expo run:ios` compiles a new native app and does not use this archive. Expo Go cannot load this project.

## Permissions

The import itself needs a network path to the mock and a one-time read of the file the person picks.

- `INTERNET` is required.
- The system document picker supplies the selected file. The app does not ask for photo, camera, location, or contacts access. On Android 13 and newer the picker grants temporary read access to that URI. `READ_EXTERNAL_STORAGE` is declared only up to SDK 32 for older picker behavior.
- The private cache copy does not need public storage. `WRITE_EXTERNAL_STORAGE` (max SDK 32), `VIBRATE`, and `SYSTEM_ALERT_WINDOW` are present on the generated Android manifest from Expo and the development client. This import flow does not use them.
- iOS has no extra usage-description keys in `app.json`. That is not evidence the iOS build was checked.

## Where the file copy lives

The picker is opened with `copyToCacheDirectory: false`. Bytes are read in chunks, stopped before a file can pass 10 MiB, and checked for a `%PDF-` signature or the CSV header `date,description,amount`. A rejected file is never posted.

The accepted copy is one file under the app cache directory `statement-imports/<uuid>.statement`:

- Android: `/data/user/0/com.kelpie.testtask/cache/statement-imports/`
- iOS (expected, not run): the app `Library/Caches/statement-imports/` directory

The original document, including an Android `content://` URI, is not deleted. A temporary picker file under `tmp`, `Inbox`, or `DocumentPicker` is deleted after the private copy is made. Anything outside `statement-imports/` is left alone.

That private copy is removed when validation fails, when **Cancel** is pressed on the confirmation screen, when **Choose another file** clears the operation, and as soon as the mock assigns a job id. Operation metadata (keys, phase, file name, size, and the report once it exists) stays in AsyncStorage under `kelpie.operation.v1` until the operation is cleared. Logs do not include file bytes, the file name, or charge descriptions.

## How to remove it

- Before send: **Cancel** deletes the cache file and the saved operation.
- After a job exists: the cache file is already deleted. **Delete statement** removes the import only after a later GET returns `deleted`. **Choose another file** clears the saved operation.
- To wipe a stuck operation and any leftover cache file: clear the app's storage, or uninstall it. On a connected Android emulator or device:

```bash
adb shell pm clear com.kelpie.testtask
```

Clearing app storage does not delete the person's original file, and it does not reset the mock. Reset the mock separately from Diagnostics, or:

```bash
curl.exe -X POST http://127.0.0.1:8787/__test/reset
```

## Diagnostics

The in-app Diagnostics screen calls the local mock. Switching `happy`, `lost_ack`, `stale_status`, or `delete_failure` does not require an app source change. The screen shows scenario counters only.

The same switch can be made from the host while the mock is running:

```bash
curl.exe -X POST http://127.0.0.1:8787/__test/scenario -H "Content-Type: application/json" -d "{\"mode\":\"lost_ack\"}"
curl.exe http://127.0.0.1:8787/__test/state
curl.exe -X POST http://127.0.0.1:8787/__test/reset
```

Fixtures to pick are `mobile-engineer-kit/fixtures/statement.csv`, `statement.pdf`, `spoofed.pdf`, and `oversize.csv` (created by `npm run fixtures:oversize`).
