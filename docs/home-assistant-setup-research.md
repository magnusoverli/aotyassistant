# Easier Home Assistant setup: investigation

Researched **2026-10-16** against this application's source, **Home Assistant Core 2026.10.0**, **Supervisor 2026.10.2**, and **Music Assistant 2.10.6**. The original investigation follows the implementation summary below.

## Implementation status

- Implemented default-role Supervisor discovery, optional guest override, effective-port/LAN detection, bounded MA mDNS discovery and protected-file verification (`src/supervisor.ts`, `src/ma-discovery.ts`, `src/setup.ts`). Saved guest origins are preserved; only Supervisor-derived candidates can automatically relocate a saved same-ID server. mDNS cannot authorize forwarding a saved token to another address.
- Implemented Connect/Reconnect, one-time browser-bound callback state, app-specific tokens, expiry display, same-server source/destination retention, and token/separate-login-address fallback (`src/ma-authorization.ts`, `web/settings.ts`).
- Implemented dedicated Supervisor-only Ingress, prefixed assets/navigation/API/SSE, iframe policy, scoped login cookies and canonical guest links (`src/ingress.ts`, `src/http.ts`, `web/paths.ts`).
- Added automatic startup, readiness watchdog support, coordinated hot backups, labels/translations, icon and installation button.
- Added two-architecture GHCR release automation. The source manifest remains active until a public image exists; the workflow produces the prebuilt manifest after publishing. See [releasing](home-assistant-releases.md).
- Retained direct MA integration: Core-only credential handoff, unsupported Services API registration, private HA storage and a redundant custom integration are not used.

See [current installation instructions](../DOCS.md). Future-tense wording below records the original investigation. Real HAOS testing uses the owner's replacement installation at `10.69.6.39`; its Core 2026.10.1, Supervisor 2026.10.2 and MA 2.10.6/schema 65 were confirmed, with MA onboarding initially incomplete.

### Live acceptance so far

- Installed version **0.2.1** on HAOS. Default-role discovery returns the correct published guest port, internal media candidates and MA server identity. The existing guest origin is preserved.
- **Open web UI** now returns the host desk through real Supervisor Ingress. The settings page loads its prefixed assets and API calls. Supervisor requires `ingress_entry: host`, without a leading slash.
- MA's `onboard_done: false` does not prevent authentication; music sources and players can be added later. Removed the unnecessary application-side sign-in block.
- A real Supervisor partial hot backup of 0.2.1 completed (`4bbf2b54`), and the app returned healthy with writes resumed. A pre-upgrade backup is also available (`6c51869a`).
- Packaged-container checks passed, including audio uploads, backup write coordination and private-list/cover recovery from a restored data volume.
- Browser Connect reaches HA's authorization page. Successful live sign-in, Reconnect and MA media fetching remain pending valid interactive login credentials. Public prebuilt-image publication is also pending.

## Conclusion

The realistic target is **install → open inside Home Assistant → connect the discovered Music Assistant server → choose a speaker → share the QR code**. Supervisor can eliminate most address/configuration work. Music Assistant's browser login can eliminate manual token creation and copying. A supported, completely silent credential handoff to this separate app was not found.

Prioritize:

1. Supervisor-assisted server/address discovery and automatic media connectivity checks.
2. A **Connect Music Assistant** browser authorization flow.
3. Home Assistant Ingress for the host desk/settings, retaining direct guest/display access.
4. Prebuilt images, installation links, and sensible lifecycle defaults.

**Version assumptions matter:** Core, Supervisor, and MA have independent versions. Core 2026.10.0 does not guarantee a particular MA API or Supervisor feature. “Music Assistant installed” also does not guarantee that its HA integration is configured, that MA onboarding is complete, or that it runs on this same Supervisor. Detect those conditions rather than adding hidden prerequisites. This app currently permits real playback only with MA schema 65 (`src/music-assistant.ts`).

## Current setup friction

| Current implementation | Opportunity |
| --- | --- |
| `config.yaml`: `ingress: false`, fixed default guest URL, manual boot | Open inside HA and derive deployment addresses instead of asking users to edit them. |
| `DOCS.md`: manual guest origin and port reconciliation | Read the effective port mapping from Supervisor. |
| `web/settings.ts`: server URL and pasted MA token | Discover the server and use MA's own login page. |
| `src/integrations.ts`: saved guest/media origins and an existing real MA fetch check | Extend the existing candidate selection instead of creating a second address system. |
| `Dockerfile` and `config.yaml`: build from source on the user's machine | Publish versioned amd64/aarch64 images. |
| Automatic speaker inventory already exists | Preserve it; make speaker choice the main remaining configuration decision. |

## 1. Supervisor discovery: useful without broad management access

Use a small server-side Supervisor client with a fixed `http://supervisor` origin and `SUPERVISOR_TOKEN`. Do not route these requests through the existing user-configurable MA transport, which deliberately rejects `supervisor`. Keep the token entirely server-side and separate from MA credentials.

Suggested permissions:

```yaml
homeassistant: "2026.10.0"
hassio_api: true
hassio_role: default
```

The minimum Core version is a packaging policy, not a Supervisor version constraint. Neither `manager` nor `admin` is needed for the proposed information reads. `homeassistant_api: true` is optional only if we actually add Core API functionality; it is not required for direct MA access.

### Useful endpoints and their actual access constraints

| Endpoint | Use | Access/qualification |
| --- | --- | --- |
| `GET /info` | Supervisor/Core versions and host name | Available to apps with their injected token even without general Supervisor API access. |
| `GET /addons/self/info` | Own internal hostname/IP and effective `network["3000/tcp"]` mapping | Also available through the self-information exception. Never assume the published host port equals 3000. |
| `GET /network/info` | Primary host LAN interface/address candidates | Allowed by `hassio_api: true` with the default role. Use host interfaces, not the Docker bridge address. |
| `GET /supervisor/info` | In the inspected v1 implementation, installed app summaries include slug, repository and state | Default role can read it. The embedded app list is legacy/deprecated; feature-detect and retain a fallback. The v2 info response does not supply that list. |
| `GET /addons/<slug>/info` | Identify MA, inspect whether it is running, and obtain connection hints | Default role can read info. Other apps' options are redacted; do not expect credentials here. |
| `GET /addons` | Generic installed-app enumeration | **Not allowed by the inspected default-role rules.** Do not casually request manager access just for this convenience. |
| `GET /discovery` or `/discovery/<uuid>` | MA's discovery payload includes credentials for HA | **Core-only** in the inspected Supervisor. This is not an app-to-app credential discovery API. |

The communication documentation lists `/discovery*` among middleware exceptions, but the discovery handlers independently enforce `require_home_assistant`. The handler restriction is decisive. Giving an app the role named `homeassistant` does not make it Home Assistant Core. [S1–S4]

### Finding Music Assistant

For MA on the same Supervisor:

1. Use available installed-app summaries to identify MA candidates, then inspect their info. Account for stable/beta/local installations; do not identify a server solely by display name or a hard-coded repository hash.
2. Use network information and app metadata to generate a bounded set of API candidates. The official MA app uses **host networking**. A generated container hostname is therefore not a universally valid address; HA documents aliases as the portable mechanism across host-networked apps.
3. Probe candidates with MA's unauthenticated `/info`; confirm server identity, onboarding and API compatibility. Port 8095 is a starting hint, not an immutable configuration. MA also has an internal listener normally on 8094; neither listener removes the need for MA authentication.
4. Present one discovered server directly, or a chooser if there are multiple. Keep manual URL entry as a fallback when Supervisor cannot enumerate candidates or MA uses an unadvertised custom configuration.

For externally hosted MA, `_mass._tcp.local.` Zeroconf advertisements expose its URL and server identity. This is a reasonable secondary discovery mechanism, but LAN multicast is not guaranteed to reach this app's bridge network or cross VLANs. Do not enable host networking solely to promise universal discovery. Supervisor cannot enumerate an external MA Docker deployment. [S1, S5–S7]

Persist MA's `server_id` alongside the connection. Automatic IP changes and reauthorization should preserve an existing source binding only after validating the same server; replacing MA must not silently bind saved music to another catalogue. Currently `src/integrations.ts` uses URL equality when deciding whether to preserve that binding, so this requires deliberate migration logic.

## 2. Replace token copy/paste with browser authorization

This is supported by the actual HA 2026.10.0 MA config flow, not merely a proposed OAuth integration. HA sends the user to:

```text
<MA browser origin>/login?return_url=<encoded callback with state>&device_name=Albums%20of%20the%20Year
```

MA redirects back with `code=<session token>`. The client then authenticates to MA and invokes **`auth/token/create`** with an application-specific name to create its own long-lived token. In MA 2.10.6 these tokens last **one year** and do not auto-renew; guest accounts cannot create them. [S5, S8–S10]

Recommended UX:

- **Music Assistant found — Connect**.
- Open MA's login at a browser-reachable address. MA handles its configured login providers; users may still need to sign in. Do not promise that being signed into HA makes this step silent.
- Complete authorization on the backend, persist the app-specific token in the existing protected settings file, and immediately load speakers.
- Offer **Reconnect** for expired/revoked credentials without forcing Disconnect and losing the source binding/destination.
- Keep manual token entry under advanced setup for unsupported MA versions or unusual network arrangements.

Important implementation details:

- This is MA's redirect-login protocol, **not** a standard OAuth authorization-code/token exchange. The `code` value itself is a credential. Use unpredictable, single-use, expiring state bound to the initiating browser, selected MA server and settings revision.
- Use a dedicated callback handler, suppress credential-bearing URL logging, and immediately redirect to a clean settings URL. The callback response should be non-cacheable with no referrer or third-party assets.
- A normal existing app cookie uses `SameSite=Strict`; do not assume it will accompany a cross-site login return. Design a narrowly scoped login transaction cookie/state mechanism appropriate for the callback and test it.
- Separate the **backend API address** from the **browser login address**. Internal Supervisor DNS/IP may work for Node but not the user's browser.
- Prototype top-level/new-window authorization with HA Ingress and Companion App webviews. Do not simply embed MA's login inside the host iframe and assume redirects/cookies work.
- MA accepts local redirect destinations and can request consent for external destinations. Use its supported validation rather than assuming a custom public hostname will always redirect silently.

### Why not reuse HA's automatically created MA token?

The official MA integration already receives `host`, `port`, and `auth_token` through Supervisor discovery. However, that handoff is specifically for Core, and Core's saved integration credentials are not a supported public credential-export interface. `SUPERVISOR_TOKEN` is not an MA access token. `auth_api: true` validates HA user credentials; it does not obtain an MA token.

MA's trusted Ingress user headers are accepted only on its internal listener from the Supervisor proxy address. A sibling app cannot obtain SSO by sending `X-Remote-User-*` headers itself. Reading HA `.storage`, another app's database/options, or spoofing these headers is not a suitable integration strategy. [S3, S5, S11]

## 3. Automatically choose application addresses

Keep three concepts separate: **HA host UI**, **guest/display origin**, and **MA media-fetch origin**.

### Guest/display origin

- First preserve a user-saved origin or explicit deployment override.
- Otherwise derive an HTTP candidate from the primary host LAN address and the effective published app port. A host-name candidate can be offered when resolution is confirmed; do not assume `homeassistant.local` on every installation.
- Treat a disabled mapping as “Guest access needs a published port,” not a successful configuration. For multiple plausible interfaces, show a short chooser rather than guessing a VPN address.
- On first setup, a single valid Supervisor-derived candidate can prefill the QR/link configuration. Keep a simple edit/confirm control; backend reachability does not prove a phone on guest Wi-Fi can reach it.
- Once configured, do not silently change the public origin on every startup: browser credentials and private-list access are origin-dependent.
- Never use `window.location.origin` from Ingress as the guest address: that is the HA origin. Do not carry HA's HTTPS scheme or port 8123 onto the separate HTTP listener.

This would make the add-on's `guest_url` an optional advanced override instead of a mandatory installation step. Remove the hard-coded default only together with startup/schema changes in `src/config.ts`.

### MA media-fetch origin

Try the app's Supervisor-provided internal hostname/IP with **container port 3000**, then appropriate host-LAN candidates. Internal communication can avoid depending on a public mapping when MA runs on the same host. External MA usually needs the LAN candidate instead.

Feed these into the existing protected synthetic-file diagnostic in `src/addressing.ts` and `src/integrations.ts`. Only retain a candidate after MA actually fetches and resolves the file. Preserve manual overrides, revision checks and playback guards. Re-discover transient container addresses after restart. Do not publish internal candidates as QR links or expose capability URLs to browsers.

No additional file sharing framework is required. Keeping private uploads in this app's `/data` and serving scoped URLs preserves the existing privacy model better than moving them into HA's globally browsable `/media`. [S1, S2]

## 4. Add Ingress for the host interface

Ingress supplies HA authentication, a sidebar panel, and access through the HA URL without making users remember another address. It is a strong UX improvement for **Host desk / Connections & settings**. Guest phones and the public display should retain their normal direct links; they should not require HA accounts. [S12]

Suggested shape, after implementing Ingress support:

```yaml
ingress: true
ingress_port: 8099
ingress_entry: /host
ingress_stream: true
panel_icon: mdi:album
panel_title: Albums of the Year
panel_admin: true
ports:
  3000/tcp: 3000
```

Use a dedicated, unpublished Ingress listener/proxy on 8099 that accepts only the Supervisor proxy; retain 3000 for the existing direct interface/media routes. `panel_admin` controls panel visibility, not authorization on the separately published port. Ingress would not protect the deliberately open LAN host controls unless their access policy is separately changed.

This is **not a manifest-only change**. Current blockers:

- `src/http.ts` sends `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'`, preventing the HA iframe.
- Vite assets, navigation, API requests, redirects and SSE URLs use root-relative paths. Introduce a trusted Ingress base path throughout `vite.config.ts`, `web/navigation.ts`, `web/request.ts`, `web/main.ts` and related controllers.
- Host/Origin validation currently accepts the configured guest origin/local setup hosts, not the Ingress request context. Add a separate trusted-proxy-aware path; do not globally enable trust of forwarded headers.
- Scope cookies to the appropriate Ingress prefix and handle HTTPS accurately on that listener. Keep participant identity on the canonical guest origin rather than unintentionally splitting it across HA and LAN URLs.
- Streaming events must remain unbuffered. Test reconnects and upload/proxy limits if exposing participant pages through Ingress later.
- `web/addressing-panel.ts` currently uses the browser origin as a suggestion; explicitly suppress that behavior inside Ingress.

## 5. Other useful framework features

| Opportunity | Recommendation |
| --- | --- |
| Prebuilt multi-architecture images | High value: publish versioned amd64/aarch64 images to GHCR and set `image` in `config.yaml`. Removes local TypeScript/native dependency builds and makes installation much quicker. Existing Node/Alpine packaging can remain. [S13] |
| My Home Assistant installation links | Add an **Add repository** button using `https://my.home-assistant.io/redirect/supervisor_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmagnusoverli%2Faotyassistant`. It opens the user's HA flow; it does not silently install/start the app. [S14] |
| Start on boot | After HAOS acceptance, default new installs to `boot: auto`. Existing explicit preferences should remain. Starting the app must continue to perform no playback/volume writes. |
| Watchdog | Add a local-process readiness URL and configure Supervisor's watchdog. Existing `/api/health` always returns HTTP 200 and sits behind Host validation; adapt those semantics first. MA being offline should not cause a restart loop. |
| Startup dependencies | `startup: application` does not guarantee MA readiness. Use bounded read-only retries/backoff and show “Waiting for Music Assistant” without preventing the host UI from opening. |
| Backups | `/data` already participates in app backups. Verify consistency across settings, preparation JSON and uploads. Prefer coordinated snapshot hooks for hot backups; cold backups interrupt the app and should not be selected casually. |
| Friendly configuration | Hide advanced overrides from the primary setup flow; supply configuration labels/translations and an app icon. Remove the demo-only playback selector from normal setup if it adds no user choice. |
| Bashio / HA base images | Optional helpers, not prerequisites. Node can call Supervisor directly. Migrating to Bashio/s6 solely for discovery would add packaging work without an end-user benefit. |
| Supervisor Services API | It currently advertises MQTT/MySQL, not a generic MA credential broker. `services: [music_assistant:need]` would not implement this dependency. [S1] |
| A custom HA integration / HACS | Consider later for HA entities, automations, or a Core-side bridge. It adds a second component/install path and is unnecessary for the main setup improvements. |

### Could the built-in HA MA integration eliminate MA authorization entirely?

With `homeassistant_api: true`, this app could call HA through `http://supervisor/core/api` using its injected token. If the HA MA integration is already configured, search and playback actions then use Core's existing connection without another manually supplied credential.

That is viable for a **simpler controller**, but it is not a drop-in transport for this application. The 2026.10.0 `music_assistant.get_queue` implementation returns a selected set of queue fields and does not return the explicit `ended` flag used by our natural-end logic. HA actions also do not provide a general proxy for every MA command used by exact-recording validation, queue ownership, uploaded-file resolution and artwork access. Replacing the current adapter would require a full parity investigation and substantial changes, not just switching a URL. Installation of the MA server alone does not install this integration. [S15, S16]

For truly zero-interaction authorization with the current full functionality, pursue an explicit upstream MA app-registration/credential-delegation mechanism or a maintained Core-side bridge. Neither is part of the inspected plug-and-play Supervisor interfaces.

## Proposed delivery order and acceptance

1. **Discovery/addressing foundation:** add the small Supervisor adapter and a “Detected setup” summary; retain manual overrides and current token fallback. Validate remapped/disabled ports, stable/beta/multiple MA servers, delayed MA startup, and external MA. Keep host UI available when discovery fails.
2. **Browser authorization:** implement Connect/Reconnect with one-time state and backend token creation. Test denied/cancelled login, expired tokens, guest-account rejection, stale settings revisions, and preserved source identity/private lists.
3. **Ingress:** implement path/iframe/proxy/cookie support, then enable the manifest options. Test direct guest/display routes alongside Ingress, HA HTTPS/remote access, Companion App login return, and long-lived SSE. Confirm QR links never point at HA Ingress.
4. **Distribution/lifecycle:** publish images, add the install button, verify backup/restore and versioned updates, then choose automatic startup and watchdog defaults.

Desired first-run screen:

```text
Music Assistant       Found: <server name>          [Connect]
Speaker / group       <available destinations>       [Use speaker]
Guest links           <detected LAN origin>          [Edit]
Uploaded audio        Checking… / Ready
                                                    [Open host desk]
```

After successful authorization, addresses and file verification should normally need no typing. Speaker selection remains an intentional choice, and music still starts only from an explicit Play action. Live HAOS testing is necessary to establish that this experience works; the findings above are documentation/source-based.

## Sources

- **S1:** [HA app communication: networking, API tokens and Services API](https://developers.home-assistant.io/docs/apps/communication/).
- **S2:** [Supervisor API endpoints](https://developers.home-assistant.io/docs/api/supervisor/endpoints/) and [app configuration](https://developers.home-assistant.io/docs/apps/configuration/).
- **S3:** Supervisor 2026.10.2 [API permission middleware](https://github.com/home-assistant/supervisor/blob/2026.10.2/supervisor/api/middleware/security.py) and [Core-only discovery handlers](https://github.com/home-assistant/supervisor/blob/2026.10.2/supervisor/api/discovery.py).
- **S4:** Supervisor 2026.10.2 [v1/v2 Supervisor info implementations](https://github.com/home-assistant/supervisor/blob/2026.10.2/supervisor/api/supervisor.py).
- **S5:** HA Core 2026.10.0 [MA config flow: discovery and browser authentication](https://github.com/home-assistant/core/blob/2026.10.0/homeassistant/components/music_assistant/config_flow.py).
- **S6:** [Official MA app manifest](https://github.com/music-assistant/home-assistant-addon/blob/main/music_assistant/config.yaml) (version 2.10.6 when inspected).
- **S7:** MA 2.10.6 [discovery architecture](https://github.com/music-assistant/server/blob/2.10.6/music_assistant/controllers/discovery/README.md).
- **S8:** MA 2.10.6 [webserver/login endpoints](https://github.com/music-assistant/server/blob/2.10.6/music_assistant/controllers/webserver/controller.py).
- **S9:** MA 2.10.6 [authentication and `auth/token/create`](https://github.com/music-assistant/server/blob/2.10.6/music_assistant/controllers/webserver/auth.py).
- **S10:** MA 2.10.6 [redirect validation and callback construction](https://github.com/music-assistant/server/blob/2.10.6/music_assistant/helpers/redirect_validation.py).
- **S11:** MA 2.10.6 [Ingress source authentication](https://github.com/music-assistant/server/blob/2.10.6/music_assistant/controllers/webserver/helpers/auth_middleware.py).
- **S12:** [HA Ingress requirements](https://developers.home-assistant.io/docs/apps/presentation/#ingress).
- **S13:** [HA prebuilt-image publishing](https://developers.home-assistant.io/docs/apps/publishing/).
- **S14:** [My Home Assistant link generator](https://my.home-assistant.io/create-link/).
- **S15:** [HA MA integration documentation](https://www.home-assistant.io/integrations/music_assistant/) and [2026.10.0 action implementations](https://github.com/home-assistant/core/blob/2026.10.0/homeassistant/components/music_assistant/services.py).
- **S16:** HA Core 2026.10.0 [media-player implementation, including `_async_handle_get_queue`](https://github.com/home-assistant/core/blob/2026.10.0/homeassistant/components/music_assistant/media_player.py).
