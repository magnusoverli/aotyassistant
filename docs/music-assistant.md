# Music Assistant connection and compatibility

Albums of the Year uses Music Assistant for catalogue search, artwork, speaker discovery, and playback. Configure music providers and speakers in Music Assistant first, then [connect the app](../DOCS.md#connect-music-assistant).

## Supported API

**Playback supports Music Assistant API schema 65**, used by MA 2.10.6 and 2.10.7. Core, Supervisor, Music Assistant, and this app have independent version numbers. A higher MA version number alone is not proof of playback compatibility.

Settings reports the installed MA version/schema and distinguishes an unsupported playback API from an offline speaker. Read-only browsing may remain available on other compatible schemas; unsupported playback is blocked before queue changes. Check for an app update when Settings reports incompatibility.

The app selects speakers and groups exposed by Music Assistant. Search coverage, artist albums, availability, seeking, and volume depend on the provider/player. Compatibility has not been established for every player integration or provider. See [testing coverage and limitations](testing.md).

## Search and saved recordings

Search includes available sources configured in Music Assistant, such as Spotify, Tidal, and local files. Some providers expose only indexed library albums or lack artist-album browsing. Try track search when artist browsing returns no results.

Matching results can be grouped for display, but selecting a track always retains its exact recording and source. The app does not substitute another service or a similarly named recording if resolution fails. It does not import playlists, cast live phone audio, or accept streaming-service links.

## Connection maintenance

- **Find Music Assistant** remains available after connection. Background discovery retries outages and periodically refreshes network information.
- **Reconnect Music Assistant** renews the same server’s authorization and retains its selected speaker and saved-list identity. MA 2.10.6 long-lived tokens expire after one year.
- Advanced address changes require a token and verification of the same server identity before retaining that binding. A failed or different-server candidate keeps the saved setup.
- Trusted Supervisor discovery can relocate the same server automatically; mDNS results are suggestions, not permission to send retained credentials to an unknown server.
- To replace a server, use **Disconnect**, then connect the replacement. Old-source list entries remain saved but unavailable rather than being silently rebound.

Connection settings are guarded while the app owns playing, paused, or uncertain playback. Finish or recover that playback first. Disconnecting forgets the token in this app; it does not revoke the token in MA.

## Playback and recovery

An explicit Play replaces the selected destination’s queue with one exact track and disables autoplay, repeat, and shuffle. It can interrupt other audio. The app verifies the resulting queue/item and playback state before reporting success.

Natural turn advancement requires an authoritative completion flag for the exact app-owned item, previously observed playing. Elapsed-time estimates, an idle queue alone, pauses, and failed commands cannot advance the turn.

External queue/source changes invalidate app playback and conceal its details. When ownership is uncertain, use **Recover playback controls** in Settings. Recovery stops only the exact item if it is still owned, clears uncertainty, and neither restarts music nor advances the turn. Avoid repeated Play requests while resolving an uncertain result.

Restart drops playback ownership and reveal. It never reclaims or resumes a Music Assistant queue automatically. Finish app-owned playback before updates.

## Credentials and transport

The Music Assistant token stays in the app’s protected private data and is not returned to browsers. Requests are restricted to validated private-network addresses, with bounded responses and timeouts; redirects and untrusted TLS certificates are rejected. The app does not expose a general Music Assistant command proxy.

Host controls remain open on the guest LAN port. See [security and privacy](../SECURITY.md).
