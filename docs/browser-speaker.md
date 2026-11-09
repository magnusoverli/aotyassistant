# Browser playback

Opening Listening Room directly over the LAN or through a Tailscale invitation automatically registers its browser as a Music Assistant speaker. Home Assistant Ingress does not load or register the embedded player; its normal playback controls still operate the selected speaker or group. To use the same device as a browser speaker, open the direct LAN address or an online invitation outside Ingress. The audio code and its format checks load in the background once the page is shown, so registration happens shortly after a page opens (within three seconds) rather than delaying it. There are no separate enable/disable buttons, approval codes, setup panels or persistent indicators.

Choose your **Listening Room** browser in the existing **Settings → Playback** speaker selector. Refresh the speaker list if necessary. Registration does not select a destination or start a track; playback uses the existing controls.

Names use the signed-in Listening Room display name and device type, for example **Listening Room (Magnus · iPhone)**. Without a signed-in profile the name is **Listening Room (iPhone)**. Names follow sign-in/profile changes on the next session check without reconnecting audio. The display name is visible to other people who can see players in Music Assistant.

Device labels are inferred from ordinary browser information, including desktop-mode iPads. Browsers cannot normally read a computer's hostname or a phone's custom device name. Different browsers, profiles or access origins can register separate players on the same physical device; clearing browser storage creates a new identity.

The audio engine belongs to the application shell and stays alive across page navigation, settings deep links and Back/Forward. Browser audio permission is handled during normal clicks and key presses, separately from registration and pairing. Some browsers require interaction with that tab before they allow sound. Phone screen-lock/background behavior remains browser-dependent.

Only one tab per browser identity connects at a time. Other tabs wait and can take over automatically when the active tab closes. Reloading or closing the active document interrupts its audio; registration resumes automatically when the application opens again. Network recovery does not send Play or replace the queue.

## Music Assistant groups

After pairing, Listening Room updates only its own player's name and **hide_in_ui** setting to make it visible in Music Assistant's group member picker. MA 2.10.9 otherwise hides web players by default. Keep the browser open and connected when selecting it as a group member. For synchronized Sendspin speakers, create a **Sync Group** in Music Assistant; mixed-protocol Universal Groups have different synchronization limitations.

The integration account needs Music Assistant player-configuration read/write permissions. A failed settings update leaves the audio connection paired and retries during session checks; the browser-session API reports a sanitized `configurationError`. Settings are checked again after reconnection. Group membership is managed in Music Assistant, not automatically changed by Listening Room.

This uses the [MA player configuration API](https://github.com/music-assistant/server/blob/2.10.9/music_assistant/controllers/config/players.py) and its [group picker visibility rules](https://github.com/music-assistant/frontend/blob/2.17.297/src/helpers/players.ts). Actual grouped audio and synchronization still need installed-system verification.

## Music Assistant compatibility

Compatibility uses the supported **API schema (currently 65)**, server identity, and the Sendspin authentication/pairing exchanges. There is no 2.10.8 version ceiling.

MA **2.10.9** has schema 65 and `aiosendspin[server]==10.2.1`. Its authenticated Sendspin proxy and `pair_web_player` implementation are identical to 2.10.8. Its frontend automatically connects and pairs the browser player; Listening Room follows that lifecycle. This is source verification, not a claim of tested audible playback on an installed MA server.

- [MA 2.10.9 API schema](https://github.com/music-assistant/server/blob/2.10.9/music_assistant/constants.py)
- [MA 2.10.9 Sendspin proxy](https://github.com/music-assistant/server/blob/2.10.9/music_assistant/controllers/webserver/sendspin_proxy.py)
- [MA 2.10.9 pairing implementation](https://github.com/music-assistant/server/blob/2.10.9/music_assistant/providers/sendspin/provider.py)
- [MA frontend automatic connection and pairing](https://github.com/music-assistant/frontend/blob/2.17.297/src/components/SendspinPlayer.vue)

## Access and testing

Audio travels through Listening Room's direct LAN or Funnel address. Ingress rejects browser-speaker API requests and audio WebSocket connections, including attempts from older open pages. The MA account token stays on the backend. Public upgrades require both a valid invitation and a browser session. Invitation revocation, logout and connection replacement close affected audio connections.

## Automatic audio quality and bandwidth

Browser players prefer **Opus, then FLAC, then PCM**, with no codec or quality setup. MA still controls source quality and encodes each browser's output. Explicit MA output-format choices are respected while the browser can decode them. The display's format/bitrate describes the source, not a particular speaker's output or measured internet usage.

| Environment | Automatic preference |
| --- | --- |
| Chrome/Edge with native Opus support | Opus → FLAC → PCM |
| Safari and iOS browsers | Opus → PCM |
| Firefox desktop/Android | FLAC → PCM (SDK excludes glitch-prone Opus) |
| Chromium without WebCodecs, including ordinary LAN HTTP | FLAC → PCM |

Before connecting, bounded, inaudible sample-decode checks verify the compressed formats. Native and bundled software Opus decoding are checked independently. A failed check removes that format; PCM remains available. All decoder assets are served through the same app origin for direct LAN access and public invitations.

Three received chunks that fail to produce decoded audio within 2.5 seconds trigger automatic recovery: verified software Opus first, then another verified codec. Failed codecs remain excluded for that player lifetime. If MA ignores a format request for four seconds, the existing player reconnects with updated capabilities. Recovery preserves the player identity, pairing, volume and unlocked audio output; it never sends Play or replaces the queue. Silence, no incoming audio and a suspended output do not by themselves trigger codec fallback.

On the local network the client requests 250 ms startup lead and a 500 ms minimum buffer, using Sendspin's synchronized mode. Sustained late decoded chunks can raise the minimum buffer in 250 ms steps, at most once per ten seconds, up to two seconds. Stable playback reduces it slowly. This is a server timing request, not a local speaker-delay adjustment or guaranteed instant repair of network loss.

Over an online invitation (Tailscale Funnel) the browser requests 1 s startup lead and a 1.5 s minimum buffer that can grow to 4 s, because the relay path adds latency and jitter. Playback therefore starts about a second after Play. MA sends up to 30 s of audio ahead; online browsers limit that to 1.92 MB, Opus at its 512 kbps maximum. Opus is never limited, but a FLAC or PCM burst (up to 6 MB) no longer floods the link at each track start and delays searches and artwork.

The relay preserves encrypted frame order and pauses its producer above 512 KiB queued output, resuming below 128 KiB. Each direction has an 8 MiB hard bound and a 15-second no-progress deadline. Heartbeats account for intentionally paused readers, and any frame from a peer counts as proof it is alive. Over Funnel a heartbeat ping can wait behind queued audio, while the browser's regular time-sync messages still arrive. WebSocket compression remains disabled because the Sendspin payload is already encrypted.

PCM stereo needs approximately 1.4–1.5 Mbit/s per playing browser, plus transport overhead. Opus is substantially smaller; MA's reviewed encoder uses libopus defaults rather than a bitrate selected by this app. FLAC usage varies with the music. Multiple remote playing browsers multiply home-upload usage; Tailscale Funnel also has non-configurable bandwidth limits. For a phone playing over an online invitation, Chrome or Safari (Opus) uses far less bandwidth than Firefox (FLAC).

### Internal diagnostics and SDK maintenance

The existing host browser-speaker API includes `audio` (client-reported codec, rate, decode/late/recovery counters and requested buffer), `audioReportedAt`, and `transfer` (server-observed payload bytes sent towards the browser, peak queued bytes and connection count). Reports are at most once per 30 seconds, scoped to the owning active browser session, bounded and schema-validated. A failed report does not interrupt playback. Transfer bytes include Sendspin framing/encryption but exclude WebSocket/TLS/network overhead; use differences over time, not the source bitrate, to estimate relay throughput. No new UI indicator is added.

`web/sendspin-extension.ts` is an instance-scoped adapter for **Sendspin JS 6.0.0**. It accesses the SDK's decoder/protocol hooks because its public player API does not expose decoder failure events or runtime format requests. Contract tests pin this version and exercise the actual SDK; revalidate these hooks before upgrading. The bundled probe helper also uses the decoder's native/software switch. No node_modules files or global prototypes are patched. MA 2.10.9 accepts `stream/request-format`; servers that ignore it use reconnect/capability negotiation instead.

Automated coverage includes real software Opus decoding, browser exclusions, failed probes, decoder starvation versus network gaps, bounded jitter adjustments, same-identity recovery, ignored format requests, cancellation, relay ordering/backpressure/stalls, telemetry authorization and invitation revocation. Audible playback, native browser decoding, background/lock-screen behaviour and mixed-protocol group synchronization still need installed-system acceptance. Browser tests are opt-in; Node tests do not establish browser compatibility.

**Invited browsers are trusted Sendspin clients.** The protocol includes track metadata and playback-control capabilities. Listening Room's interface still follows its reveal/turn rules, but those rules are not a security boundary against an invited client inspecting or using Sendspin directly. Local browser identity is scoped to the installation/MA source and browser origin.

Automated tests cover device labels and stable names, bounded player-configuration updates and retries, automatic startup without waiting for audio permission, retained player lifetimes, standby tabs, reconnect/cancellation, HTTP/WebSocket authorization, pairing identity binding, schema/server checks and revocation. Actual sound, real MA pairing/groups and HA/Funnel/mobile behavior still require [installed-system testing](testing.md).
