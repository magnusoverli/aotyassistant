# Browser playback

Opening Listening Room automatically registers its browser as a Music Assistant speaker. This applies to Home Assistant, local access and invited internet browsers. There are no separate enable/disable buttons, approval codes, setup panels or persistent indicators.

Choose **Listening Room (Chrome)**, **Listening Room (Safari)** or the corresponding browser name in the existing **Settings → Playback** speaker selector. Refresh the speaker list if necessary. Registration does not select a destination or start a track; playback uses the existing controls.

The audio engine belongs to the application shell and stays alive across page navigation, settings deep links and Back/Forward. Browser audio permission is handled during normal clicks and key presses, separately from registration and pairing. Some browsers require interaction with that tab before they allow sound. Phone screen-lock/background behavior remains browser-dependent.

Only one tab per browser identity connects at a time. Other tabs wait and can take over automatically when the active tab closes. Reloading or closing the active document interrupts its audio; registration resumes automatically when the application opens again. Network recovery does not send Play or replace the queue.

## Music Assistant compatibility

Compatibility uses the supported **API schema (currently 65)**, server identity, and the Sendspin authentication/pairing exchanges. There is no 2.10.8 version ceiling.

MA **2.10.9** has schema 65 and `aiosendspin[server]==10.2.1`. Its authenticated Sendspin proxy and `pair_web_player` implementation are identical to 2.10.8. Its frontend automatically connects and pairs the browser player; Listening Room follows that lifecycle. This is source verification, not a claim of tested audible playback on an installed MA server.

- [MA 2.10.9 API schema](https://github.com/music-assistant/server/blob/2.10.9/music_assistant/constants.py)
- [MA 2.10.9 Sendspin proxy](https://github.com/music-assistant/server/blob/2.10.9/music_assistant/controllers/webserver/sendspin_proxy.py)
- [MA 2.10.9 pairing implementation](https://github.com/music-assistant/server/blob/2.10.9/music_assistant/providers/sendspin/provider.py)
- [MA frontend automatic connection and pairing](https://github.com/music-assistant/frontend/blob/2.17.297/src/components/SendspinPlayer.vue)

## Access and testing

Audio travels through Listening Room's own address, including the Ingress prefix or Funnel address. The MA account token stays on the backend. Public upgrades require both a valid invitation and a browser session. Invitation revocation, logout and connection replacement close affected audio connections. PCM stereo uses roughly 1.4–1.5 Mbit/s per active speaker, plus transport overhead.

**Invited browsers are trusted Sendspin clients.** The protocol includes track metadata and playback-control capabilities. Listening Room's interface still follows its reveal/turn rules, but those rules are not a security boundary against an invited client inspecting or using Sendspin directly. Local browser identity is scoped to the installation/MA source and browser origin.

Automated tests cover automatic startup without waiting for audio permission, retained player lifetimes, standby tabs, reconnect/cancellation, HTTP/WebSocket authorization, pairing identity binding, schema/server checks and revocation. Actual sound, real MA pairing and HA/Funnel/mobile behavior still require [installed-system testing](testing.md).
