# Use this browser as a speaker

Listening Room can send Music Assistant audio to the device displaying the app. Connect a laptop's USB, HDMI or headphone output to your sound system, or use the device's own speakers.

## Enable and select

1. Open **Menu → Use this device as a speaker**, or the same button in **Settings → Playback → Browser speakers**.
2. Give the speaker a recognizable name and click **Use this device as a speaker**. This click also enables browser audio.
3. If an approval code appears, open the host's **Settings → Playback → Browser speakers**, match the name and code, and approve the trusted device. Authenticated Home Assistant Ingress approves the first tab automatically; another tab using the same speaker identity requires explicit takeover approval.
4. In **Settings → Playback**, refresh the speaker list and select the browser's name as the room destination. Destination changes use the normal playback safeguards. Start music with the existing **Play** action.

Close the dialog and navigate normally. There is no persistent speaker indicator. To enable audio again after a browser suspension, or to disable the speaker, reopen the menu's speaker dialog. The host can disconnect an approved device with **Remove** in Playback settings.

## What stays playing?

| Action | Behavior |
| --- | --- |
| Navigate between Listening Room pages, use settings deep links, or Back/Forward | The same audio engine and connection remain alive |
| Close the speaker dialog or enter full screen | Audio continues |
| Refresh, close the tab, log out, or leave/recreate the HA app iframe | Browser audio stops; enable it again |
| Open a second tab | A second tab cannot take over the same speaker identity without host approval |
| Lose the network | Bounded reconnection attempts; recovery never issues Play or replaces the queue |
| Phone lock, background tab, or operating-system suspension | Browser-dependent; keep a dedicated output device awake for reliable room playback |

Speaker approvals last eight hours and expire on application restart. Online invitation rotation/disable also disconnects online speakers. Replacing the Music Assistant connection invalidates its speaker grants. Browser identity is stored per installation and MA source on the current browser origin; LAN, HA Ingress, and Funnel origins can have separate identities.

## Requirements and access

- Connect Music Assistant first and refresh its status. The adapter is restricted to **MA 2.10.6–2.10.8**, the versions whose authenticated Sendspin proxy and pairing API were inspected. The bundled browser SDK is pinned to **Sendspin JS 6.0.0**. Actual audible compatibility across these versions still requires installed-system testing.
- Use a current browser with Web Audio and site storage enabled. HTTPS is recommended. PCM audio avoids optional WASM decoder requirements and uses roughly **1.4–1.5 Mbit/s per active stereo speaker**, plus transport overhead.
- Audio uses Listening Room's own address over a WebSocket, including the Ingress prefix or Funnel HTTPS address. Guests do not need a direct connection to Music Assistant. The MA account token remains on the backend.
- The MA integration account needs access to the browser destination and permission to pair web players. If pairing or discovery fails, check that account's access and the installed MA version; no destination is selected automatically.

Approve only a **trusted output device**. Sendspin includes track metadata and control capabilities, so a browser speaker is more privileged than an ordinary guest. Listening Room does not display Sendspin metadata or attach SDK playback commands to OS media controls; its normal reveal and turn controls remain authoritative in the app. This is not a guarantee that a trusted speaker cannot inspect the protocol's metadata. Removing a device here revokes its Listening Room relay grant; any saved MA-side pairing can be managed separately in Music Assistant.

## Validation status

Automated tests cover real HTTP/WebSocket relaying against a simulated MA authentication endpoint, binary/text framing, pairing identity binding, approval/expiry, tab takeover, listener provenance, account replacement and revocation. Navigation tests cover deep-link and Ingress routing. These tests do not establish audible playback, real MA pairing, mobile suspension behavior, or actual Ingress/Funnel audio delivery. See [testing](testing.md) for installed-system checks and [the design investigation](browser-player-investigation.md) for protocol findings.
