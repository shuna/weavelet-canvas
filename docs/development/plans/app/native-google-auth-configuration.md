# Rebuilt iOS Google authentication configuration

GoogleAuthentication uses the OS authentication browser with S256 PKCE and state, then URLSession for the installed-app code exchange and refresh. Credentials are a single Keychain item accessible when unlocked on this device. There is no native client secret, backend cookie reuse, or token in persisted chat/sync snapshots.

Configure the built application Info.plist:

- `GOOGLE_CLIENT_ID`: Google Cloud OAuth **iOS** client ID registered to this application's bundle identifier. The Web application's client ID is not a substitute.
- `GOOGLE_REDIRECT_SCHEME`: reverse the dot-separated client ID components, for example `com.googleusercontent.apps.FAKE-ios` for the explicitly fake example `FAKE-ios.apps.googleusercontent.com`.
- `CFBundleURLTypes` → `CFBundleURLSchemes`: register the same scheme. The callback URI is exactly `<scheme>:/oauth2redirect` (one slash, no host).

The project reads both values from the corresponding Xcode build settings into `ios-rebuild/WeaveletPilot/Info.plist`. The default client ID is empty and the default URL scheme is an unconfigured placeholder; the app remains usable and disables Google sign-in until a valid pair is supplied. Settings → Google sync opens the native connection screen.

Register the native client in the same Google Cloud project as the Web client and enable Drive API there. Normal Web/native sync requests only `https://www.googleapis.com/auth/drive.file`. This scope reaches files created/opened with this app or explicitly granted to it; authenticating the same Google account alone does not grant arbitrary Drive folders. Existing Web encrypted datasets require access granted to this app/project. Native authentication must not widen scope or silently create another dataset when access is missing. Existing SyncSession validates dataset metadata and asks the user to select/confirm/unlock a dataset; authentication only supplies bearer tokens. The old ios2 `drive.appdata` storage is a separate scope/location and is not used here.

Startup may pass `nil` configuration: `GoogleAuthentication` then reports `isConfigured == false`, and sign-in/token acquisition throws a configuration error without reading Keychain. The UI should not add a client-ID text field. Read configuration with `GoogleAuthenticationConfiguration.bundled()` and inject it at the composition boundary. A configured Keychain read failure is surfaced rather than silently replacing credentials.

`signIn(presentationAnchor:)` owns its OS browser until completion, `cancelSignIn()` cancels it, `disconnect()` clears the local credential, and `token(force:) async throws -> String` supplies DriveTransport's token closure. The existing DriveTransport retries a 401 once with `force: true`. Cancellation/reauthentication invalidate pending results; failed Keychain writes do not publish newly issued credentials. Revoked refresh grants clear the local credential and require sign-in. Disconnect is local removal, not a Google account-wide revocation request.

No live credential, browser sign-in, or network request was used to develop the tests. Real iOS client registration, consent, Catalyst callback delivery, and pre-existing Web dataset grants remain integration checks.

The app's settings screen now connects authentication, dataset selection/creation, unlock, manual sync/download, conflict resolution and interrupted-save recovery. Recovery uses a durable journal and requires explicit resolution when local data changed after the interrupted operation. The UI was checked with the client unconfigured; this does not establish live authentication or online compatibility.

References: [Google installed-app OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

## Old iOS Google snapshot migration

The optional native migration action requests `https://www.googleapis.com/auth/drive.appdata` in a separate, memory-only PKCE authentication session. It never loads or replaces the normal sync Keychain credential. The Google grant permits appData management; the migration implementation itself issues only GET requests and does not update/delete the old source. Its fixed locator comes from `src/utils/legacyIOSSync.ts`, derived from the old native writer: `appDataFolder`, `weavelet-canvas-sync.wvlt`, newest `modifiedTime` first. The existing container decoder and selection/confirmation import are reused. Downloaded original bytes remain available for export during the connection lifetime even when decoding fails; the old remote file remains unchanged.

Google's [appData documentation](https://developers.google.com/workspace/drive/api/guides/appdata) states that only the application that created appData can access it. Registering a new native OAuth client or choosing the same account does not prove access to the old application's hidden data. Old application/project access must be established during real-account verification. Empty discovery is reported as not found and does not create an empty replacement. No new client ID, old-project mapping, or live migration success is implied by isolated tests. Web's current normal authentication/BFF scopes are unchanged; exported `.wvlt` files can use the existing Web import path.
