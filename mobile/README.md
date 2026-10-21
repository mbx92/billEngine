# billengine_mobile

Android-first Flutter client for the Billing Infra control plane (Nuxt 4 API in
`../server`). It mirrors the web console screens and reuses the same REST
endpoints, so a session cookie issued by Better Auth on the web also works here.

## Prerequisites

Tools installed on this machine (user-level env vars already point at them):

| Tool | Version | Path |
| --- | --- | --- |
| Flutter SDK | 3.47.7 (Dart 3.13.5) | `D:\dev\sdks\flutter` |
| Android SDK | platform 36, build-tools 36.0.0 | `D:\dev\sdks\android-sdk` |
| JDK | Temurin 21.0.12 | `C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot` |

`JAVA_HOME`, `ANDROID_HOME`, `ANDROID_SDK_ROOT` plus the Flutter / `platform-tools`
/ `cmdline-tools` / `emulator` binaries are persisted on the user `PATH`, so a
fresh terminal only needs:

```bash
flutter --version
flutter doctor
```

One benign warning remains: a stray `C:\adb\adb.exe` sits next to the SDK's
`platform-tools\adb.exe`. Delete (or rename) it if device detection ever
misbehaves.

### Emulator

`billengine_pixel7` (Pixel 7, API 36, `google_apis` x86_64) is registered:

```bash
flutter emulators --launch billengine_pixel7
flutter run
```

## Run

The default control-plane address is `http://10.0.2.2:3000`, which is how the
Android emulator reaches the Nuxt dev server on the host machine.

```bash
# Terminal 1 – API
cd .. && npm run dev

# Terminal 2 – app
flutter pub get
flutter run
```

Point the app at another host (physical device on the same LAN, staging, …)
from the login screen: **Alamat server** → *Base URL*. The value persists in
`flutter_secure_storage` and is replayed on the next launch.

Plain HTTP is only allowed in debug builds (see
`android/app/src/debug/AndroidManifest.xml`). Release builds require HTTPS, so
a device build must target a TLS-terminated host.

## What is included

| Area | Screens |
| --- | --- |
| Auth | Email/password sign-in, cookie session restore, role-aware routing |
| Commercial | Dashboard, customers, plans, services, invoices (+ detail), payments, reports |
| Infrastructure | Applications & releases, resources, templates, deployments, database clusters, backups, tunnels, servers |
| System | Users (super admin only), settings, activity log & job runs |
| Customer portal | Overview, invoices (+ detail), services, account |

Screens read from a shared typed layer, so nothing talks to HTTP directly:

- `lib/core/api_client.dart` — cookie-jar HTTP client, honours `Set-Cookie`
  from Better Auth.
- `lib/services/api_service.dart` — one method per endpoint under `server/api/`,
  returning typed models from `lib/models/`.
- `lib/core/list_controller.dart` — `ListController`, `ItemController`,
  `ActionController` for paging, retry and pending state.
- `lib/state/` — `AuthController`, `SettingsController`, `PortalController`,
  `InvoiceDetailController` exposed through `provider`.

Formatting (`lib/core/formatters.dart`) mirrors `shared/utils/billing-display.ts`
so money, dates and status labels read the same on both clients. Monetary values
and byte counts stay `String`s end-to-end because the API serialises
PostgreSQL `bigint`/`numeric` at the boundary.

## Project layout

```
lib/
  core/      api client, session store, formatters, theme, controllers
  models/    JSON mapping for every schema in shared/schemas
  routes/    GoRouter table with role guards
  services/  typed API surface + platform file saver
  state/     provider controllers
  ui/        screens (admin/, portal/), shells, shared widgets
test/        widget smoke test
```

## Checks

```bash
dart analyze     # must stay clean
flutter test
```

## Notes

- PDF invoices are downloaded through `FileSaver` (`path_provider` +
  `open_filex`) so the in-app preview hands off to the platform viewer.
- `Icons.apps_outlined` is used for the infrastructure "Applications" entry;
  `Icons.deployed_code` is not available in the bundled Material icon set.
