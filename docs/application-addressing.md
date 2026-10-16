# Application addresses and verified Music Assistant callbacks

Status: **implemented and deployed to the development instance on 2026-10-15**. Typecheck/build, 132 backend/controller tests, 34 browser workflows and both container smokes pass. The real MA diagnostic selected an automatic LAN origin in an isolated packaged app; the deployed app then passed the same check and saved its guest address through the browser UI. Running backend hashes/web assets match the tested build; all six role pages return 200 and the settings page has no 320px horizontal overflow. Session/participant order, two private libraries, token/source binding and destination were retained; `.env` and network rules were untouched. Protected backup and prior image retained. No real speaker/queue/volume write was issued. The saved speaker was reported unavailable by MA during verification; audible playback still needs owner testing.

## Normal setup

After the owner's subsequent manual settings test, an authorized repair restored the app origin to `http://192.168.5.147:3000` and the MA API origin to `http://192.168.5.139:8095` (development values only). The old backup token was rejected, so the current valid token was retained while restoring the original catalogue source identity and Roam selection. A fresh real-MA diagnostic passed after restart; both private lists and participants remained intact. Roam still reported unavailable. No speaker command was issued. Repair backup/evidence: `/tmp/opencode/aoty-ma-settings-repair-20261015T201724049Z/`.

The app listens on all container interfaces; the deployment publishes its HTTP port. No application setting changes OS routes, firewall rules, Tailscale, Docker networks, or port exposure. Tailscale is not required. Prefer a stable LAN hostname, DHCP reservation, or trusted reverse proxy.

Open **Connections & settings → Application addresses**:

1. Choose **Use the address I opened for guest links**, or enter a **Guest address**. This updates invitation/display links immediately and persists across restart. No environment-file edit or restart is needed. A guest address is a host choice, not proof that every phone can reach it.
2. Once a Music Assistant connection is saved, opening/reloading settings checks media access automatically. Candidates are the browser-opened origin, the last automatically selected origin, and the configured guest origin, deduplicated and bounded to three. A manual override takes precedence and is never silently replaced.
3. MA must fetch and exactly resolve a fresh capability-protected **synthetic three-second WAV** through its Builtin track API. The application must observe a valid GET callback. Only then can an automatic candidate be selected and persisted. No participant file is used, and no queue, speaker, volume, or library-write command is issued.
4. **Test file connection** explicitly repeats the check. The **Advanced address override** is for different MA-facing origins (for example, proxy/container arrangements); a non-empty override must pass the same check before it is saved. Clear it to return to automatic selection.

The selected media origin and guest origin are independent. A browser-accessible URL is a suggestion, never a guarantee of MA accessibility. Advertising an address does not create a route. Loopback works only on the relevant machine and is not a valid guest sharing address for phones. Failed checks leave saved addresses and private files intact.

Startup rechecks the selected media origin after the listener starts. Opening settings can observe that in-progress result without issuing another MA request. Settings/address changes invalidate verification, browser-origin changes trigger new suggestions, and successful checks expire from the UI after five minutes. Explicit Test always makes a fresh check. Every real uploaded-track Play still resolves and observes its own protected source; diagnostic success never bypasses per-play identity or ownership checks. Verification is point-in-time, not continuous network monitoring.

## Persistence and browser identity

The existing private `DATA_DIR/integrations.json` stores guest/manual/automatic origins, under the same atomic persistence and revision rules as other integration settings. Existing files migrate without losing the MA token, destination, source binding, session or private lists. The UI-selected guest origin overrides the add-on `guest_url` or Docker `GUEST_URL` fallback; those remain optional installer-supplied hints, not hard-coded network requirements. Changing speaker or disconnecting MA does not discard guest-address configuration.

Browser cookies/local storage belong to an origin. **Changing IP/hostname does not move browser credentials**: existing phones may need to rejoin, and private lists may need their recovery keys at the new origin. Keep recovery keys before changing an address. Server-side participants, private files, credentials and lists are not deleted or re-keyed by an address save. Guest origins apply to HTTP Host validation and Secure-cookie policy, so use the configured HTTPS origin when applicable.

## Safety and failure behaviour

- Unconfigured private-LAN IP or `.local` hosts, from private/loopback peers, may open **only setup assets, read-only setup information, and address APIs**; root/host pages redirect to settings. Ordinary session/player/private-list APIs stay blocked until explicitly configured. Public/arbitrary DNS Host headers and forwarded headers do not automatically establish trust. For custom proxy domains, supply the deployment origin or configure it from an already trusted local setup address.
- Diagnostic media has its own exact Host/capability checks, fixed path, finite synthetic content and GET/HEAD/range support. Its random capability is never returned to browsers, stored in configuration, or logged by the application. It expires within 30 seconds and is revoked immediately on success/failure; after revocation it returns 404. No arbitrary target path, uploaded asset or credential is exposed.
- Origins reject credentials, paths, query strings, fragments, unsupported protocols, Supervisor, wildcard/unspecified, multicast and literal link-local/metadata addresses. Network mutations retain JSON/same-origin/cross-site guards and the existing deliberate open-LAN-host access model. Do not expose host controls to untrusted networks.
- MA errors may echo source URLs, so the checker returns bounded, fixed explanations rather than raw upstream errors. Check errors are separate from catalogue/speaker readiness.
- Network I/O runs outside the playback serializer. Concurrent checks are bounded; a settings revision change discards a stale result. Address writes respect owned-playing/paused/uncertain playback guards; a diagnostic may prove a candidate works but cannot silently reroute owned playback. Failed/ambiguous persistence does not falsely claim that an address was saved; the UI reads back without replaying writes.
- Reverse proxies must preserve the configured Host, accept byte ranges and not log capability paths, credentials or private API bodies. TLS certificates must be trusted by MA. Discovery cannot solve blocked ports, routing, DNS or isolated VLANs.

## Why not MA registration or a custom provider?

The inspected MA **2.10.6/schema 65** API has no supported general external-app callback-address registry. MA's `_mass._tcp.local.` advertisement discovers MA itself. `dashboard/register` registers WebSocket-owned display clients, not external media servers. A provider/plugin inside MA can offer deeper hosting integration but would be a separate architecture and maintenance commitment. This implementation uses the existing supported `music/item_by_uri` resolution API, explicitly typed as a Builtin track with metadata updates disabled; no library import or custom provider is needed.

Sources: [MA API](https://www.music-assistant.io/api/), [discovery architecture](https://github.com/music-assistant/server/blob/2.10.6/music_assistant/controllers/discovery/README.md), [dashboard registration](https://github.com/music-assistant/server/blob/2.10.6/music_assistant/controllers/dashboard/controller.py).

## Validation

Backend/browser tests cover scoped onboarding, origin/Host/CSRF validation, exact MA callbacks (including unobserved/substituted/failed results), fallback selection, override retention, guest-link persistence, stale revisions, slow-check isolation, paused-playback guards, bounded ranges, capability expiry/revocation, disk failures and secret-free views. The container smoke verifies guest URL precedence across restart without modifying deployment defaults. Fixture tests do not prove actual network reachability or audible playback: use the real MA check on the installation, and obtain separate approval for speaker tests.
