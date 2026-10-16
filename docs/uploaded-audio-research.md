# Uploaded audio — research and implementation plan

Date: **2026-10-15**. Status: **research only; feature not implemented or deployed**.

**Subsequent implementation update:** the owner dropped standalone AAC to avoid its timing/remux complexity and approved implementation. MP3, M4A (AAC/ALAC), FLAC, WAV, AIFF, Vorbis and Opus are now implemented locally without storage quotas; no AAC remux path was built. See [current implementation/setup](uploaded-audio.md). The original research findings below remain historical evidence, not the current format scope. No deployment or real speaker test has followed.

**Later deployment update:** the upload implementation, combined participant workspace and [MA-verified address setup](application-addressing.md) were subsequently deployed for development testing on 2026-10-15. The host UI saved the LAN guest origin and the deployed diagnostic passed against real MA without speaker commands. Native phone and audible lifecycle acceptance remain pending; the statements below describe the earlier research stage.

## Scope and conclusion

A participant selects **one ordinary audio file through the browser's native picker**, uploads it, reviews metadata/artwork, and adds it to their existing private list. It then follows normal ordering, current-turn Play next, controls, reveal, played history, removal/restoration, and recovery rules.

Confirmed requirements:

- Initial support is not MP3-only: MP3, M4A, FLAC, and standalone AAC are targets. M4A should cover AAC and Apple Lossless (ALAC).
- WAV, AIFF, Ogg Vorbis, and Opus are recommended additions based on the research, not previously confirmed owner requirements.
- **No new storage quotas or per-file size ceilings.** Stream to disk, not whole-file memory buffers. Handle actual disk exhaustion without deleting saved work. Metadata/image memory budgets and processing concurrency are safeguards, not storage allowances.
- No batch/folder/archive uploads, music cataloguing, streaming-app offline downloads, recording substitution, or automatic playback.
- Originals and saved entries survive events/restarts. Reversible Remove and Played history retain their assets; permanent deletion is separate and must not race with playback.

**Architecture:** app-owned private files/metadata, fetched by Music Assistant's Builtin URL provider, then played through its normal queue/audio/speaker pipeline. No custom MA provider, shared filesystem, library import, or browser audio player is needed.

**Historical development blocker — now resolved:** at research time MA could not reach this machine's LAN endpoints or Tailscale address. Subsequent diagnosis found an overlapping Tailscale/LAN route. After the owner disconnected Tailscale, real MA protected-file resolution passed for all supported formats using the packaged application implementation, without routing/firewall workarounds or speaker commands. See [verification details](uploaded-audio.md#development-callback-verification--2026-10-15). The original observations below are retained as historical evidence.

## Evidence and boundaries

### Deployed Music Assistant

The configured server was queried using its existing server-side token, without printing or copying that token into research files:

- `/info`: **2.10.6**, schema **65**, minimum supported schema **28**.
- Generated `/api-docs/commands.json`: confirmed `music/item`, `music/item_by_uri`, normal queue playback/resume, and parameters/scopes.
- Invoked only read commands: `music/item`, `music/item_by_uri`, `player_queues/get_active_queue`.
- Sampled before/after queue identity and status were unchanged. No queue-control, library-write, volume, speaker, session, or settings commands were issued. Reads may populate MA metadata caches.

Public test/silence fixtures from the **same upstream 2.10.6 repository** were resolved; none was played:

| Fixture/case | Live result |
| --- | --- |
| Untagged `tests/fixtures/test.mp3`, bare HTTPS URL | `sound_effect`, duration 1s |
| Same MP3, explicit `builtin://track/<HTTPS URL>` | `track`, duration 1s |
| Tagged MP3, explicit track request | Title `MyTitle`, artist `MyArtist`, duration 1s |
| Null-separated ID3v2.4 multi-artist MP3 | Track, but only `Artist One` returned |
| Tagged M4A | Track, title/artist resolved, duration 1s |
| `tests/fixtures/audio/short_test.flac` | Track, duration 10s |
| Upstream Ogg silence resource | Track, duration 60s |
| Upstream MP3 silence URL with query string | Track; exact full URL and typed URI preserved |

Explicit cases returned provider `builtin`, `item_id` equal to the supplied URL including query parameters, and URI `builtin://track/` followed by that URL. Album was absent. The Builtin implementation does not construct full album metadata as the filesystem catalogue provider does.

This proves live URL resolution/classification. **It does not prove audible playback, speaker compatibility, parked-pause recovery, natural completion, or callback access to this app.**

### Reverse connectivity

**Follow-up:** the callback blocker is cleared over direct LAN after the owner disconnected the conflicting development VPN. This section describes the original failed probes, not the current status; real speaker acceptance remains pending.

Synthetic audio was offered by a temporary capability-protected server, first LAN-bound and then Docker-published. MA's FFprobe connections timed out without a request reaching either server. Existing app static-cover checks also returned:

- App LAN address, port 3000: connection timed out.
- App Tailscale address, port 3000: network unreachable.

No firewall, routing, proxy, production container, or MA configuration was altered. Firewall inspection required unavailable interactive sudo authorization, so a firewall cause is **not confirmed**. Temporary fixture containers/listeners were stopped and removed.

Consequences:

1. Diagnose and establish an approved MA-to-app route before app-hosted-file acceptance testing; do not silently expose a public service.
2. Provide a host-configurable **media origin reachable from MA**, separate from phone-facing `GUEST_URL` if needed. Follow the existing host-frontend configuration requirement; no hard-coded development addresses.
3. Current HTTP Host validation accepts the guest origin and loopback, not an arbitrary LAN origin. Explicitly authorize a configured media origin for appropriate routes without weakening all Host/origin checks or trusting request headers.

### Isolated format and metadata checks

Synthetic 12-second audio and covers were generated with **FFmpeg 8.1.2** from a cached Home Assistant image in isolated containers. This is **not a measurement of MA's installed FFmpeg build**. Metadata checks used `music-metadata` **12.2.1** and `sharp` **0.35.5**, installed only in research scratch storage.

All nine codec/container combinations below passed local probing, decoding from five seconds into the file, and separate protected-HTTP decoding/seek checks. HTTP clients were isolated FFmpeg processes, **not MA's deployed stream engine**.

| Candidate | Metadata/artwork observations | Recommendation |
| --- | --- | --- |
| MP3, CBR/VBR | ID3v2.3/v2.4 text, Unicode, JPEG/PNG APIC covers; front cover selected when back cover appears first | Initial support |
| M4A/AAC | Title, track artist, album artist, album, embedded `covr` PNG | Initial support |
| M4A/ALAC | Same text/cover extraction, lossless audio decoded | Include within M4A |
| FLAC | Vorbis comments and FLAC picture block | Initial support |
| AAC/ADTS (`.aac`) | Audio decoded; fixture had no tags/artwork; timing caveat below | Initial support with indexed playback rendition |
| WAV/PCM | Audio/duration; untagged fixture uses fallback metadata | Recommended addition |
| AIFF/PCM | ID3 text, audio/duration | Recommended addition |
| Ogg Vorbis | Comment text and `METADATA_BLOCK_PICTURE` cover | Recommended addition |
| Opus in Ogg (`.opus`) | Comment text and `METADATA_BLOCK_PICTURE` cover | Recommended addition |

Other observations:

- M4A is a container, not a codec. Detect supported audio inside it, including AAC/ALAC. Common aliases (`.aif`, `.aiff`, `.oga`, `.ogg`) should follow detected content; alias/picker behaviour was not separately tested.
- Successful metadata parsing is not audio validation: text named `.mp3` produced an empty result without throwing; FFprobe rejected it. Require a valid supported audio stream.
- Some valid generated ID3/WAV fixtures produced parser warnings despite successful decoding. Do not reject every warning indiscriminately.
- Attached covers can appear as video streams. Distinguish artwork from actual video rather than rejecting all such files.
- Missing tags/artwork are not audio failures. WAV/AIFF tagging varies, and raw AAC often has little usable metadata.
- Browser audio-codec support does not restrict uploading: the browser transfers bytes and MA handles decoding. Real iPhone/Android picker/interruption tests remain necessary.

## Findings that change the implementation plan

### Explicit track typing and exact identity

Verified read request:

```json
{
  "command": "music/item",
  "args": {
    "media_type": "track",
    "item_id": "<app-generated protected audio URL>",
    "provider_instance_id_or_domain": "builtin",
    "allow_update_metadata": false
  }
}
```

`music/item_by_uri` with `builtin://track/<URL>` is also verified. Explicit Play should pass the typed URI to the existing one-item replace workflow with continuation disabled. Playback commands were researched, **not executed**.

MA's completion tracker excludes radio, live audio sources, and sound effects from ending a queue. Bare untagged URLs could therefore break turn advancement. Verify finite duration and exact provider/URL; explicit typing alone does not make a durationless source seekable.

Do **not** call `builtin/add_track`: it writes shared provider/library configuration and schedules sync. URL playback needs no library import. Persist `assetId`, not an expiring URL/MA item ID; create and verify a fresh runtime URL identity per explicit play. Uploads do not belong to a catalogue source binding and must never be title-matched.

### Raw AAC timing and lossless remux

One synthetic ADTS fixture produced materially different durations:

| Method | Duration |
| --- | --- |
| Ordinary FFprobe raw-AAC estimate | **13.109582s** |
| Full `music-metadata` duration scan | **12.0279365s** |
| FFprobe after stream-copy AAC-to-M4A remux | **12.027937s** |

Research command, executed only on synthetic scratch files:

```sh
ffmpeg -i input.aac -map 0:a:0 -c:a copy -movflags +faststart playback.m4a
```

Original and rendition produced **identical decoded-audio SHA-256 hashes**. No audio re-encoding occurred; the rendition passed HTTP seek/decode checks.

Recommendation: retain original AAC and create an indexed M4A playback rendition. This improves timing/seeking without lossy conversion. One fixture is not a universal guarantee: varied AAC profiles, VBR, encoder delay, and long files need acceptance tests. Other formats normally retain original playback bytes; player-specific output conversion remains MA's responsibility.

### App-owned metadata and artwork

The URL provider is less complete than filesystem catalogue metadata. In the multi-artist fixture, MA returned only `Artist One`; local parsing recovered **all three artists**, album artist `Album Artist A`, and album `MyAlbum`.

Parse locally for private preview and authoritative app list/player/reveal metadata. Upload/save must not require MA online. Keep manual corrections separate from immutable original bytes.

The tested parser covers required tag families and front-cover selection. JPEG/PNG images were normalized using `sharp`; front-over-back selection was verified from thumbnail pixels. Prefer front cover, then another usable embedded picture, then the neutral record. Never fetch artwork URLs from tags or invent an artist portrait from album artwork.

MA accepts full Track objects, but its queue loader may re-fetch provider details, for example when artwork is absent. Sending corrected metadata once is **not proof that every correction persists externally**. App metadata remains authoritative independently; matching corrections in external MA/Sonos interfaces needs separate tests if required.

### Playback-scoped capabilities and repeated reads

Protected-HTTP checks observed repeated GETs, nonzero byte ranges, M4A tail reads, and multiple FLAC/Opus seeks. A wrong token returned 404. Clients supplied neither browser cookies nor Authorization headers; access came from the capability URL.

- Generate URLs server-side for one asset/rendition and playback attempt. No arbitrary client URL/path proxy or public upload directory.
- Support GET/HEAD, correct Content-Type/Content-Length, ranges/206, and unsatisfiable ranges/416. Authorize every request, not just probing.
- Allow probe, stream, and parked-pause resume reads. MA's source confirms pause can release the stream after roughly 30 seconds; resume restarts the same queue item at `resume_pos`.
- Fixed short URL expiry conflicts with indefinite app pause. Bind access to the playing/paused ownership lifecycle, independent of phone connectivity; revoke at appropriate playback/turn/configuration/end/restart transitions. Revocation cannot recall buffered bytes.
- URLs become MA item IDs/cache keys and may appear in diagnostics. Live errors echoed full source URLs. Treat capabilities as secrets and redact errors/logs; never forward them to public/other-participant responses.
- Keep public artwork on the existing reveal-authorized path. Do not expose the audio URL to the display merely to extract its embedded cover/tags.

### Streaming upload, validation, and packaging

Current middleware rejects non-JSON writes and limits JSON to 16 KiB. Add an explicit single-file streaming path preserving membership/owner and same-origin checks; do not globally enlarge JSON limits or disable origin validation.

Recommended processing:

1. Authenticate, stream one file to private staging, and hash while streaming. No media-size quota or whole-file memory buffer.
2. Parse metadata in bounded worker/process resources and validate actual audio with a restricted local probe. Do not follow uploaded playlists or network protocols. An unusable optional cover should not invalidate usable audio.
3. Create safe artwork and any needed rendition; preserve original bytes.
4. Show preview/corrections and require Add. Durably finalize asset/manifest before acknowledging list commit; reconcile ambiguous/interrupted saves idempotently.
5. Preserve staged/reusable assets during list conflicts/review; collect only abandoned uncommitted data, never referenced/in-use files.

Metadata/image budgets, processing concurrency, and network idle timeouts stay independent of player controls. No quota does not make disk capacity infinite: handle `ENOSPC` without claiming Saved or deleting existing work.

The production image has Node/`su-exec`, not FFmpeg/FFprobe. Local validation/AAC remux needs explicit packaging and native-install docs. `music-metadata` requires Node >=22, compatible with Node 24. `sharp` native/prebuilt dependencies require target Alpine/add-on architecture checks; only the research host environment was exercised.

## Revised implementation sequence

1. **Diagnose reverse connectivity with approval**, configure a reachable media origin and scoped Host validation, and repeat protected callback resolution. No speaker command is needed for this probe.
2. Add private durable originals/renditions/artwork, authorization, staging/finalization, idempotent list attachment, cleanup, and backups. No quota feature.
3. Support the full confirmed initial MP3/M4A/FLAC/AAC set, metadata/covers, actual-audio validation, and AAC remux. Add WAV/AIFF/Vorbis/Opus if accepted; do not quietly defer confirmed formats.
4. Add picker, progress, processing, preview/corrections, and Add to my list. Saved means durable asset/list confirmation. Refresh before completion may require selecting the file again; confirmed saved assets do not.
5. Extend upload availability, private/reveal-only artwork, typed MA resolution, capability lifecycle, exact ownership, and existing Play next/bookkeeping. No MA import or full-list queueing.
6. Test disk/processing failures, conflicts/retries, malformed files/images, recovery/history, privacy/stale artwork, network loss, and player isolation; then native iPhone/Android selection/interruption.
7. **With fresh approval**, test real speaker start, ordinary and >30-second pause/resume, stop/finish, natural completion, external takeover, and revoke/restart behaviour across formats. This research authorizes neither deployment nor speaker tests.

Integration points: `src/preparations.ts` (reserved descriptor/views), `src/preparation-http.ts` (owner operations/artwork), `src/http.ts` (request/artwork routing), `src/music-assistant.ts`/`src/live-playback.ts` (resolution/ownership), preparation UI/controller, host settings/configuration (media origin), and `Dockerfile`/backup docs (tools/assets). **No application source or dependencies changed during research.**

## Sources and reproducibility

- [Builtin documentation](https://www.music-assistant.io/music-providers/builtin/), [API docs](https://www.music-assistant.io/api/), and the configured server's generated API contract.
- Version-pinned [Builtin provider](https://github.com/music-assistant/server/blob/2.10.6/music_assistant/providers/builtin/__init__.py), [URI parser](https://github.com/music-assistant/server/blob/2.10.6/music_assistant/helpers/uri.py), and [music controller](https://github.com/music-assistant/server/blob/2.10.6/music_assistant/controllers/music/controller.py).
- Version-pinned [queue controller](https://github.com/music-assistant/server/blob/2.10.6/music_assistant/controllers/player_queues/controller.py), [queue loader](https://github.com/music-assistant/server/blob/2.10.6/music_assistant/controllers/player_queues/queue_loader.py), [completion tracker](https://github.com/music-assistant/server/blob/2.10.6/music_assistant/controllers/player_queues/playback_tracker.py), [audio pipeline](https://github.com/music-assistant/server/blob/2.10.6/music_assistant/controllers/streams/audio.py), and [tag/image helpers](https://github.com/music-assistant/server/blob/2.10.6/music_assistant/helpers/tags.py).
- [Audio-processing docs](https://www.music-assistant.io/faq/tech-info/), [filesystem-provider behaviour](https://www.music-assistant.io/music-providers/local-files/), and [classification tests](https://github.com/music-assistant/server/blob/2.10.6/tests/providers/builtin/test_parse_item_media_type.py).
- [`music-metadata` 12.2.1](https://github.com/Borewit/music-metadata/tree/v12.2.1), [sharp docs](https://sharp.pixelplumbing.com/), and [browser file inputs](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file). Picker `accept` is a hint, not validation.

Scratch artifacts remain under `/tmp/opencode/aoty-upload-research-20261015/`: generated fixtures; `public-probe.mjs`/`public-results.json`; `metadata-probe.mjs`/`metadata-results.json`; `ffprobe-fixtures.py`/`ffprobe-results.json`; `probe.mjs`/`server.mjs`/`http-results.json`; `compare-remux.py`/`remux-results.json`; fixture generation and failed callback observations. These are research, not application tests/features. Results contain no MA access token; temporary capabilities are redacted from errors and their servers are no longer running.
