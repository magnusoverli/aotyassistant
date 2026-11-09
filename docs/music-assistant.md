# Music Assistant connection and compatibility

Doom Room uses Music Assistant for catalogue search, artwork, speaker discovery, and playback. Configure music providers and speakers in Music Assistant first, then [connect the app](../DOCS.md#connect-music-assistant).

## Supported API

**Playback supports Music Assistant API schema 65**, including MA 2.10.9. Compatibility is checked by API schema, not a 2.10.8 version ceiling. Core, Supervisor, Music Assistant, and this app have independent version numbers.

Settings reports the installed MA version/schema and distinguishes an unsupported playback API from an offline speaker. Read-only browsing may remain available on other compatible schemas; unsupported playback is blocked before queue changes. Check for an app update when Settings reports incompatibility.

The app selects speakers and groups exposed by Music Assistant. Search coverage, artist albums, availability, seeking, and volume depend on the provider/player. Compatibility has not been established for every player integration or provider. See [testing coverage and limitations](testing.md).

The [Doom Room browser registers automatically as a speaker](browser-speaker.md) over direct LAN access and Tailscale invitations, but not Home Assistant Ingress. Select it in the existing Playback speaker selector; its audio engine survives navigation between app pages. Ingress retains playback controls for the selected speaker or group.

## Search and saved recordings

Search by artist, then open an album to choose tracks. Search includes available sources configured in Music Assistant, such as Spotify, Tidal, and local files. Some providers expose only indexed library albums or lack artist-album browsing, which can limit the albums shown.

Choose artists, releases and recordings directly, without a provider dropdown. Artist search combines matching names across providers, and opening an artist shows the combined album catalogue with matching albums listed once. Browse matching uses compatible names and release metadata even when providers omit shared identifiers; known conflicting artist identities and different editions remain separate. Recording substitution still requires Music Assistant mappings or recording identifiers, with artist, edition, explicitness and duration checks. Small duration differences (up to three seconds) are tolerated only alongside recording identity evidence. Browsing never adds private choices to the shared MA library.

Saved choices retain recording evidence and up to eight alternative source references. Old saved choices remain readable. Before Play, the app may resolve an available equivalent from another provider; live, remastered and other distinct versions are not interchangeable. Once Play is sent, the app never retries it through another source. The app does not import playlists, cast live phone audio, or accept streaming-service links.

Album browsing combines compatible provider products even when their barcodes or MusicBrainz release IDs differ. Known differences in edition, year, artist, clean/explicit status or MusicBrainz release group remain separate. All provider references are retained for browsing; this display grouping does not establish recording equivalence for playback.

## Artwork performance

Results, saved playlists/history and the small participant player use the same 160-pixel JPEG size. The app caches up to 512 Music Assistant artwork variants for an hour, bounded to 20 MiB, and combines simultaneous requests for the same image. It fetches at most four images from Music Assistant at a time; the rest wait in line rather than failing. This matters over online invitations, where browsers use HTTP/2 and request a whole page of thumbnails at once. A thumbnail still waiting is dropped when the browser stops asking for it, for example after leaving the page.

Participant artwork URLs stay stable within their catalogue context. Browsers can retain the image and revalidate access before reuse; unchanged images return a body-free `304` response without the app reading the image again. Invitation, participant and catalogue checks still apply. The `Server-Timing` artwork duration reports server-side retrieval time to help distinguish Music Assistant delays from browser or internet-transfer delays.

Saved playlist and history covers are served directly from their own authorized URL, one request per cover, with no redirect. They carry the same revalidation tag as the catalogue image, so once a browser has the pixels, every URL for that image revalidates with a body-free `304`. A cover first seen in results is downloaded once more the first time it appears in the list. Access with or without room membership uses the same response. Browser caches are local to each browser/origin and can be evicted; another device still needs its own download.

## Browsing speed

Artist searches, artist album lists and album track lists are kept for five minutes and shared by everyone in the room. Browsing back, or a second guest opening the same artist, is answered without waiting for Music Assistant and its streaming services. Identical requests in progress share one Music Assistant read. New library additions appear within five minutes. Playback never uses this cache: the app always checks current availability before Play.

When an artist search returns an exact name match first, its albums are loaded in the background before anyone taps it. Only one such prefetch runs at a time, it uses only the local network, and a failure is ignored. Pressing a **View albums** or **View tracks** button starts the request as the finger or mouse button goes down; the click reuses it, and a scroll cancels it.

Uploaded artwork also uses size-specific JPEG responses and stable authorized URLs, with up to 128 variants/8 MiB cached for an hour and at most two resized at a time. New uploads retain covers up to 1024 pixels for `/display` (512 if needed to fit the stored-artwork limit); older covers keep their existing resolution. Original audio and existing stored cover files are unchanged.

The player retains its loaded cover and artist portrait when playback confirms the same saved image. Different images load and decode before replacing the visible artwork. Reuse is based on verified image identity, not matching song titles; current download authorization still applies.

The room display downloads an encrypted 1024-pixel cover and 160-pixel artist portrait while the track is playing or paused. The reveal update supplies the decryption key, so a completed download needs only local decryption and image decoding at reveal. The cover remains unreadable before reveal, including through the display's network responses. Preparations are scoped to the current playback and discarded on turn changes or lost access. An immediate reveal or interrupted download can still need time to finish; failed preparation falls back to ordinary authorized artwork loading. This works over HTTPS/Ingress/Funnel and plain LAN HTTP.

## Connection maintenance

- **Find Music Assistant** remains available after connection. Background discovery retries outages and periodically refreshes network information.
- **Reconnect Music Assistant** renews the same server’s authorization and retains its selected speaker and saved-list identity. MA 2.10.6 long-lived tokens expire after one year.
- Advanced address changes require a token and verification of the same server identity before retaining that binding. A failed or different-server candidate keeps the saved setup.
- Trusted Supervisor discovery can relocate the same server automatically; mDNS results are suggestions, not permission to send retained credentials to an unknown server.
- To replace a server, use **Disconnect**, then connect the replacement. Old-source list entries remain saved but unavailable rather than being silently rebound.

Connection settings are guarded while the app owns playing, paused, or uncertain playback. Finish or recover that playback first. Disconnecting forgets the token in this app; it does not revoke the token in MA.

## Playback and recovery

An explicit Play replaces the selected destination’s queue with one recording and disables autoplay, repeat, and shuffle. It can interrupt other audio. A dynamic queue is stopped and cleared before changing its locked policies. The app verifies the resulting queue/item, playback state and reported stream provider/item before reporting success. Missing stream identity prevents confirmation; an unexpected stream source invalidates ownership rather than triggering another Play.

Natural turn advancement requires an authoritative completion flag for the exact app-owned item, previously observed playing. Elapsed-time estimates, an idle queue alone, pauses, and failed commands cannot advance the turn.

External queue changes or unverified source changes invalidate app playback and conceal its details. When ownership is uncertain, use **Recover playback controls** in Settings. Recovery stops only the exact item if it is still owned, clears uncertainty, and neither restarts music nor advances the turn. Avoid repeated Play requests while resolving an uncertain result.

Restart drops playback ownership and reveal. It never reclaims or resumes a Music Assistant queue automatically. Finish app-owned playback before updates.

### Speaker transfer

The host can [change speakers during an active song](using-the-app.md#change-speakers-during-a-song) using MA's `player_queues/transfer`. Handoff requires a stable MA **2.10.8 or later** release and the supported playback schema; ordinary playback compatibility is unchanged. Earlier schema-65 releases can resume a transfer using the target's old playback position. The fixed behavior was source-verified in [2.10.8/2.10.9](https://github.com/music-assistant/server/blob/2.10.9/music_assistant/controllers/player_queues/controller.py#L1099-L1218) and [upstream tests](https://github.com/music-assistant/server/blob/2.10.9/tests/controllers/player_queues/test_transfer_queue.py).

MA stops and clears the source queue before starting the destination, so transfer is not gapless or atomic. The app verifies the preserved queue-item ID, recording, reported stream source, single-track policies and position, plus the cleared source. It never retries a transfer after a lost acknowledgement or uses a new Play as a fallback. Group members are addressed through their own queue rather than their group's active queue; MA may release grouping. Paused transfer uses `auto_play:false` and requires an idle, ungrouped target.

Synthetic tests cover routing, position, pause/resume, upload leases, stale commands, partial outcomes and recovery. Actual audible interruption, position accuracy and group behavior still need installed-system acceptance with the affected speaker integrations.

## Credentials and transport

The Music Assistant token stays in the app’s protected private data and is not returned to browsers. Requests are restricted to validated private-network addresses, with bounded responses and timeouts; redirects and untrusted TLS certificates are rejected. The app does not expose a general Music Assistant command proxy.

Host controls remain open on the guest LAN port. See [security and privacy](../SECURITY.md).
