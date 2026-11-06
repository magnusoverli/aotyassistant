# Browser speaker investigation

Date: 2026-11-06. Original investigation and design record. The host-approved browser-speaker implementation now follows this design, without a persistent status indicator. See [setup and validation status](browser-speaker.md); live Music Assistant/audio acceptance remains outstanding.

## Recommendation

Add an opt-in, host-approved **Use this device as a speaker** feature backed by Sendspin. Own the audio engine in the persistent application shell, independent of the currently mounted page. Keep Music Assistant as the source and Listening Room's existing playback engine as the authority for queue ownership, turns, and reveal.

Internal page navigation can preserve the same audio engine and connection. This does not promise uninterrupted audio after a document reload, closing the tab, leaving the HA app iframe, changing origins, or operating-system suspension.

## Findings from this application

| Finding | Evidence and implication |
| --- | --- |
| A persistent shell already exists | `web/main.ts` constructs the header and listening-order bar once; `mountPage()` replaces only page content. Create the speaker runtime here, outside `mountPage()`. |
| Page disposal is intentionally destructive | `web/page-runtime.ts` owns an `AbortController` and page-local controllers. Audio must not use that signal, or be disposed with those controllers. |
| Navigation still has reload gaps | `web/main.ts` declines SPA interception when an internal link has a query or fragment. Cross-page links such as `/host/settings#access` therefore reload the document. Same-page settings fragments already have their own handling; preserve it. |
| Logout is a document navigation | `web/app-header.ts` uses `location.assign()` after logout. Define this as an intentional speaker stop unless a separate trusted-device session is explicitly designed to survive participant logout. |
| MA access is backend-only | The current MA token is never delivered to browsers. Keep that boundary when adding audio transport and pairing. |
| There is no incoming WebSocket server | `src/index.ts` creates HTTP listeners; the existing MA WebSocket code is an outbound event client. Incoming audio needs explicit upgrade handling. |
| HTTP protections do not automatically protect upgrades | The Ingress WeakMap and public-route/grant checks run in HTTP request handlers. A Node `upgrade` handler bypasses those paths. Reuse their validation rules explicitly, rather than assuming Express authenticated an upgrade. |
| Browser destinations need real discovery | The existing `players/all` → destination selection → active queue verification flow should remain authoritative. Registration alone is not proof of a selectable or ready speaker. |

## Upstream findings and compatibility

The published `@sendspin/sendspin-js` package was **6.0.0** at investigation time. Its npm `gitHead` was `0834aff5e87a057715596799e145dcd0a45bb6cd`. It exposes `SendspinPlayer`, `unlock()`, `connect()`, a WebSocket URL or adopted socket, persistent cryptographic client identity, and pairing support. Version 6 uses `url`; older examples using `baseUrl` and an application-supplied `playerId` should not be copied unchanged. Pin a version after integration testing.

`unlock()` must run directly in the user's click/tap handler, before unrelated awaited network requests, to satisfy autoplay restrictions. Adopted sockets do not auto-reconnect: the application must own reconnection if it supplies the socket.

Listening Room currently supports MA playback schema 65, documented here for MA 2.10.6–2.10.8. Those tags do **not** pin the same Sendspin library:

| MA tag inspected | Sendspin dependency | Pairing command present |
| --- | --- | --- |
| 2.10.6 | `aiosendspin[server]==9.1.1` | `sendspin/pair_web_player` |
| 2.10.7 | `aiosendspin[server]==10.2.0` | `sendspin/pair_web_player` |
| 2.10.8 | `aiosendspin[server]==10.2.1` | `sendspin/pair_web_player` |

This confirms a separate Sendspin compatibility check is necessary; schema 65 alone is insufficient.

The MA 2.10.8 source contains an authenticated `/sendspin` WebSocket proxy on its web server. Non-Ingress clients first send an authentication message and wait for `auth_ok`; the proxy then forwards to its internal Sendspin service. This is an application-specific authentication layer, not a generic Sendspin endpoint. A Listening Room backend adapter could perform this handshake without exposing the MA token to the browser.

The same source contains `sendspin/pair_web_player`, accepting a client pairing token. It requires a registered web-player identity and binds pairing to the calling MA account. The player classification currently uses product-name/manufacturer heuristics, and web players are private/hidden by default. Prove registration, pairing, visibility to our integration account, and active-queue access together before choosing this as the production adapter. Do not pretend to be Music Assistant's own application or assume an arbitrary player ID is authorized.

Direct `ws://<MA-host>:8927/sendspin` is also documented. It requires separate reachability and pairing treatment; it is not a suitable direct browser URL for an HTTPS HA/Funnel page. Avoid silently guessing a second port when the configured MA address points to a reverse proxy or remote deployment.

## Proposed architecture

```text
Browser: one shell-owned Sendspin player + AudioContext/audio element
                |
       same-origin authenticated WebSocket
       (Ingress-prefixed when applicable)
                |
Listening Room: device authorization, bounded relay, MA handshake
                |
Music Assistant: Sendspin player registration, queue and audio source
```

### Persistent client runtime

- Add a `BrowserSpeaker` service created once by `mountApplication()` in `web/main.ts`. Page components subscribe to its state, rather than constructing/disconnecting it.
- Keep its audio element, buffers, connection, and audio context outside the replaceable page subtree. Route disposal only unsubscribes the page UI.
- Provide compact persistent status: Off, Connecting, Needs a tap, Ready, Playing here, Reconnecting, Unavailable. Do not overload the existing `PlayerController`, which controls the selected MA destination rather than decoding local audio.
- Separate **Enable this browser speaker** from **Use it for this room**. Enabling registers a destination; selecting it uses the existing guarded host action. Neither starts music. An optional combined user action can perform both only when destination switching is permitted.
- Persist the SDK identity using an installation/MA-server-scoped storage adapter. Do not use the transient HA Ingress URL as the only durable installation identity. LAN, Ingress, and Funnel origins have separate browser storage; cross-origin identity continuity needs explicit pairing, not an assumption.
- Enforce one active tab per speaker identity with a backend lease. Web Locks/BroadcastChannel can improve the UX where available, but are not the authority. A second tab shows **Speaker active in another tab**, with explicit takeover rather than two clients competing for one identity.
- Resume a surviving stream only when permitted by the verified MA session and playback state. A reconnect must not issue a new Play, recreate a queue, advance a turn, or reset an uncertain playback state.

### Navigation

- Extend same-origin route interception to supported query/fragment links, preserving the complete URL and the Ingress base.
- Handle cross-page Settings deep links without reloading, while retaining same-page anchors, section history, catalogue Back/Forward state, keyboard modifiers, downloads, and explicit external/new-tab links.
- Keep the audio runtime untouched by `mountPage()`, Back/Forward, page renders, fullscreen changes, or scrolling.
- Treat reload, tab close, logout, origin change, and leaving/recreating the HA iframe as explicit lifecycle boundaries. Give useful recovery feedback rather than promising seamless audio across them.

### Backend and transport

- Add a dedicated browser-speaker manager and fixed-purpose WebSocket upgrade route. Upstream comes only from the validated MA connection, never a browser-provided arbitrary URL.
- Validate listener provenance, Origin, exact route/base, device grant, expiry, and ownership at upgrade. Revoke and close upgraded sockets on device removal, expiration, applicable invitation revocation, logout, MA account/server replacement, and shutdown. The existing public response set does not track upgraded sockets.
- Authenticate upstream server-side and bound the handshake. Hold browser frames until the MA proxy has acknowledged authentication; do not pass its authentication exchange or credential to the browser.
- Use bounded frame sizes, queued bytes, heartbeat timeouts, and connection counts. Keep audio relay work out of the room command serializer. Avoid accumulating latency by buffering an unbounded TCP backlog.
- Pair only the pending browser identity associated with the host-approved device session. Do not offer a generic pairing-token or MA-command forwarding endpoint to guests. Persist/revoke device authorization separately from a room invitation.
- Audit CSP and actual SDK codec assets. The present policy has `connect-src 'self'` and no explicit `media-src`; supported SDK output modes/decoder implementations may need narrowly scoped media/WASM permissions. Serve dependencies locally rather than adding a third-party CDN allowance. Check HA iframe autoplay permissions as well.

## Important reveal/control boundary

The inspected SDK advertises `player@v1`, `controller@v1`, and `metadata@v1` in its hello. Its configuration does not expose a simple built-in-role allowlist. Its transport also implements encrypted Sendspin sessions. Therefore a transparent relay cannot promise to strip metadata or reject individual playback commands by inspecting JSON frames.

For the first implementation, approve only a **trusted output device**, normally the host's laptop or room display. Keep Listening Room's UI and OS media metadata generic until its own authoritative reveal state permits disclosure; do not populate either directly from Sendspin metadata. Do not wire SDK next/previous/play controls around Listening Room's turn checks.

This UI policy is not a claim that unrevealed metadata is unavailable to the trusted speaker's browser internals. If arbitrary guest browsers must become speakers while retaining the existing private-metadata and command restrictions, first establish server-enforced role restrictions or a protocol-terminating, policy-aware bridge. Hiding buttons or deleting metadata from the DOM is insufficient. Do not enable streaming for every invitation holder by default.

## Access modes

| Mode | Proposed handling | Remaining validation |
| --- | --- | --- |
| HA Ingress | Same-origin WebSocket through the dedicated Ingress listener | HA supports WebSockets; verify iframe autoplay, prefix handling, and proxy behavior with audio |
| Direct trusted LAN | Same-origin WebSocket; browser receives from the app, not MA's address | Plain HTTP can limit modern browser audio/identity APIs; detect support and prefer HTTPS where needed |
| Tailscale Funnel | Same-origin WSS to the guest listener, with a separate host-approved speaker grant | Add upgrade authorization explicitly; measure bandwidth, jitter, reconnect and revocation through the real tunnel |

WebSocket is the most direct initial transport for this architecture and avoids requiring STUN/TURN configuration. It can still suffer TCP head-of-line blocking on poor connections. MA's provider README describes WebRTC as another route; those API and SDK contracts require separate version verification before adoption. Funnel providing HTTPS does not by itself configure WebRTC connectivity.

## Suggested delivery sequence

1. **Compatibility spike:** establish a real encrypted/pairable SDK-to-MA connection through a local relay, prove the browser becomes a selectable destination, and verify schema-65 queue ownership/completion. Test MA 2.10.6 and 2.10.8 before claiming both are supported. Resolve private-player visibility and role/privacy boundaries here.
2. **Persistent runtime and navigation:** implement shell ownership, user-gesture unlock, scoped identity, single-tab lease, and reload-free internal/deep-link navigation.
3. **Guided host/device UX:** enable, approve when needed, select destination, persistent status, explicit disable/takeover, safe reconnect and error recovery.
4. **Access-path acceptance:** validate Ingress and Funnel separately, including websocket revocation, codec/CSP behavior, and actual mobile/desktop audio.

## Acceptance criteria

| Scenario | Required result |
| --- | --- |
| Navigate Host → Your music → Settings → Display and back during playback | Same runtime/audio context and connection remain; no route-triggered gap or MA Play/Stop command |
| Follow `/host/settings#access`, change settings sections, use Back/Forward | No document reload; correct URL, page and history restoration |
| Open another tab with the same speaker identity | No duplicate audio or involuntary player takeover |
| Unrevealed track, phone lock screen, OS media controls | No unintended title/artwork disclosure in app/system UI; explicit documented trust boundary for raw Sendspin metadata |
| First enable, foreground/background, screen lock | Gesture requirement is explained; report suspension honestly; test Safari/iOS and Android rather than assuming desktop behavior |
| Network drop/reconnect, server replacement or expired approval | No automatic queue replacement, duplicate Play, turn advance, or reuse of revoked authorization |
| Close/reload/logout | Intentional disconnect/recovery behavior, never a promise of continuity after the document disappears |
| Native HTTP upgrade bypass/forged headers/expired grant | Connection rejected or revoked independently of Express middleware |

Unit and integration tests should cover routing, lifecycle, session grants, bounded relaying, and queue invariants. Browser tests require explicit opt-in under the repository instructions; manual audible testing is also needed because object-identity assertions alone cannot prove gap-free audio. No browser tests or live playback were performed for this investigation.

## Sources

- [Sendspin SDK documentation](https://www.sendspin-audio.com/build/sdks/)
- [Published SDK 6.0.0 metadata](https://registry.npmjs.org/@sendspin/sendspin-js/6.0.0)
- [SDK source pinned to the published commit](https://github.com/Sendspin/sendspin-js/tree/0834aff5e87a057715596799e145dcd0a45bb6cd)
- [MA 2.10.8 Sendspin authentication proxy](https://github.com/music-assistant/server/blob/2.10.8/music_assistant/controllers/webserver/sendspin_proxy.py)
- [MA 2.10.8 pairing/provider implementation](https://github.com/music-assistant/server/blob/2.10.8/music_assistant/providers/sendspin/provider.py)
- [MA 2.10.8 player identity and visibility](https://github.com/music-assistant/server/blob/2.10.8/music_assistant/providers/sendspin/player.py)
- [MA Sendspin documentation](https://www.music-assistant.io/player-support/sendspin/)
- [Home Assistant Ingress guide](https://contributors.home-assistant.io/apps/guides/ingress/)
