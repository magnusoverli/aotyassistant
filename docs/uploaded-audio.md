# Private uploaded tracks

Status: **implemented and deployed to the development instance on 2026-10-15**, alongside the combined participant workspace and verified address setup. Real MA-to-app protected-file resolution is verified over LAN for every supported format. Deployment followed a fresh no-playing/paused check and protected backup; the existing session, two participants/private libraries and MA connection/destination were retained. No speaker/queue/volume write was issued. Audible lifecycle and real-phone acceptance remain pending; MA reported the saved speaker unavailable during deployment verification.

## Supported files

One file per upload: **MP3 (CBR/VBR), M4A with AAC or Apple Lossless/ALAC, FLAC, WAV/PCM, AIFF/PCM, Ogg Vorbis, and Opus in Ogg**. Recognized extensions include `.mp3`, `.m4a`, `.flac`, `.wav`, `.aif`, `.aiff`, `.ogg`, `.oga`, and `.opus`, case-insensitively. The actual container/audio stream is probed; an extension or browser MIME type is not proof of supported audio. Embedded attached covers are allowed, not actual video content or multiple audio streams.

**Standalone AAC/ADTS (`.aac`) is deliberately excluded**, even when renamed. AAC inside M4A remains supported. There is no AAC-remux/transcoding path in the app. Output conversion for the selected speaker remains Music Assistant's job. No streaming-app downloads, folders, archives, batch import, or catalogue matching are supported.

## Participant workflow

1. Join the room and choose **Upload a track** in the private music panel. The native phone/browser picker supplies the file; the app never receives a device filesystem path or searches other apps' storage.
2. Watch upload/processing progress. Review the detected cover, title, artist, and album; correct the text if needed. Unknown tags fall back to the filename/empty fields and the neutral record.
3. Choose **Add uploaded track to my list**. **Saved** means the server acknowledged durable file storage and list attachment, not merely that the network transfer reached 100%.
4. Reorder, Make next, Remove, Undo, Restore, and recover the list normally. Only the current participant may explicitly **Play next**, pause/resume/stop/reveal, or finish. Uploading never changes the current listener or starts audio.

Preparation does not require a working MA connection or speaker. Without them, uploaded entries remain saved but unavailable for playback; the demo does not pretend to play uploaded audio. Once saved, the phone can disconnect. Artist/album tags and common embedded JPEG/PNG covers are extracted locally; the app does not perform cloud identification or fetch URLs from tags. Album artwork is not reused as an artist portrait.

Uploads and normal list/player commands have separate request lanes. A file-processing failure does not call the playback engine or send speaker commands. The processor runs outside the main process, validates a supported finite audio stream using FFprobe, bounds metadata/image work, and is canceled with its child processes on interruption/shutdown. Covers are rasterized to private PNG thumbnails, at most 512px. Originals are immutable; saving corrected text never rewrites audio tags. Original-byte SHA-256 is checked before capture/playback.

## Interrupted saves and drafts

- An unconfirmed upload ID and review text are retained in that browser's owner-scoped local storage, not the audio bytes or credentials.
- File selection reserves the upload lane immediately, including private-list initialization. Cancel prevents that pending selection from starting a later transfer; completed server-side work is checked explicitly before retrying.
- Reload can check whether the upload finished using a read-only request. An incomplete transfer may require choosing the file again. Neither upload bytes nor audio commands are automatically replayed.
- Add-to-list uses the existing durable operation receipt/revision mechanism. Lost acknowledgements are retried explicitly and do not append another entry. Conflicts retain the uploaded asset for explicit reconciliation. Exact byte-identical upcoming uploads are deduplicated within that private list, not across owners.
- **Discard upload draft** deletes only an unreferenced draft. If an earlier save actually succeeded, the saved entry/file is preserved and only the local draft is forgotten.
- Uncommitted staged files expire after seven days; incomplete files are removed on failed/canceled attempts or conservatively cleaned up later using durable receiving markers. Retained saved assets never expire. Cleanup refuses to delete bytes referenced by a saved list, including after an inconsistent/partial backup.

## Retention, deletion, storage, and backup

There are **no upload file-size, per-owner storage, or total-storage quotas**. Uploads stream to disk with backpressure; actual disk exhaustion produces an error rather than a false Saved state. Existing list entry-count/retry rules still apply. Processing concurrency, network idle timeouts, and metadata/image budgets are operational safeguards, not audio-storage allowances. Operators still need enough physical disk space and protected backups.

Saved files survive refreshes, new events, app restarts, connection/server changes, and private-library recovery. Played history and reversible Removed entries keep their audio/covers. To reclaim a file, Remove it, open **Removed**, then choose **Delete file permanently** and confirm. This deletes that asset's entries from the owner's list/history and its audio/artwork. It is blocked while the file is starting, playing, paused, or pinned by uncertain ownership awaiting recovery.

List deletion intents are durable before physical file deletion. If deletion fails or the process exits between stages, the next authorized list read retries cleanup; an acknowledged deletion never resurrects the entry. Old operation receipts remain idempotent. Permanent deletion cannot undo existing external backups; backup retention is managed separately.

Storage layout, inside the existing `DATA_DIR`:

```text
preparations/<owner-id>.json           private list, receipts, deletion intents
uploads/<asset-id>/audio               original bytes (0600)
uploads/<asset-id>/manifest.json       private owner/format/metadata/hash record
uploads/<asset-id>/cover.png           optional extracted thumbnail (0600)
uploads/<asset-id>/receiving.json      incomplete-transfer marker only
```

Directories use `0700`. Include **the entire data directory**, including uploads, in backups; list JSON alone cannot restore audio. Corrupt/unreadable data fails closed rather than resetting lists or deleting recoverable bytes.

## Music Assistant setup and playback

The existing MA server/token/speaker setup remains in **Connections & settings**. **Application addresses** now suggests media origins from the opened browser/deployment addresses and verifies them through a real MA fetch of a synthetic protected file, never speaker playback. Guest links are host-configurable without environment-file edits; **Advanced address override → Application address reachable from Music Assistant** is for unusual proxy/container arrangements. Non-empty overrides must pass the same check before saving. Changes remain revision-checked and do not reroute owned playback. See [address setup and safeguards](application-addressing.md).

No firewall or routing changes are automatic. The configured alternate Host is accepted only for protected media reads, not as an alternative entry to host controls. Reverse proxies must preserve the expected Host and permit range requests. Exclude media paths/capabilities, API bodies, and credentials from access logs.

### Development callback verification — 2026-10-15

The earlier callback timeout was traced to an overlapping development VPN route: this laptop was directly connected to `192.168.5.0/24`, but accepted a Tailscale route to that same subnet. `ip route get` selected the tunnel for MA while packet-header observation showed MA's connection attempts arriving over Wi-Fi. The owner disconnected Tailscale; its state became `Stopped` and the route selected Wi-Fi with the laptop's LAN source address. No special routes, firewall exceptions, interface forcing, or VPN-specific application code were added. Tailscale is not part of the intended normal deployment.

An isolated container running the packaged application implementation then served synthetic fixtures through the **actual UploadAssets, upload analyzer, HTTP Host/capability/range checks, IntegrationManager and MusicAssistantClient**. Its media origin was a temporary Docker-published LAN address, separate from its guest origin. The real MA **2.10.6/schema 65** fetched and resolved all ten fixtures: untagged CBR MP3, tagged ID3v2.3 MP3, VBR/ID3v2.4 MP3, AAC/M4A, ALAC/M4A, FLAC, WAV, AIFF, Vorbis and Opus.

All cases passed exact Builtin URL/typed-URI and duration validation, observed real-MA callback access without cookies/Authorization, application-owned metadata preservation, HEAD/Content-Length checks, matching byte-range reads/206, and capability revocation/404. MA performed repeated and nonzero range requests. Only `music/item_by_uri` and `player_queues/get_active_queue` were called; sampled queue identity/status stayed unchanged. Metadata reads may populate MA's cache, but no queue/library/settings writes, audio commands or production restart occurred. Credentials stayed in process memory and sanitized results contain no active capability URL. The temporary container and its tmpfs assets were removed.

This clears the **LAN callback/resolution blocker**, not speaker-playback acceptance. The subsequent development deployment selected its LAN guest origin through the new setup UI and verified media access from the running app. A normal deployment needs a stable app LAN origin reachable from MA; listening on a particular address is not a substitute for correct host routing. Existing Tailscale guest links do not automatically become LAN links when the VPN is stopped. Evidence: `/tmp/opencode/aoty-lan-verification/results.json`; temporary harness scripts are in the same directory.

On explicit Play next:

1. Verify ownership and original-byte integrity, then generate an opaque capability URL for one exact saved asset/playback attempt.
2. Resolve `builtin://track/<protected-url>` through MA's `music/item_by_uri` with metadata updates disabled. Explicit typing prevents untagged files becoming sound effects/radio. Verify the exact provider/item/URI, finite duration, and that MA actually requested the protected file from this app.
3. Only after source verification, perform existing destination/schema-65 checks and single-track queue replacement. No `builtin/add_track`, library sync, automatic substitute, or whole-list queueing is used.
4. Keep application-owned metadata authoritative; upstream URL-derived names/artwork/capabilities never enter participant/public track views. A corrected name in this app is not a guarantee of the same correction in external MA/Sonos interfaces.

The media endpoint supports GET/HEAD, bounded-memory streaming, Content-Length/Content-Type, byte ranges/206 and invalid ranges/416. The capability authorizes repeated requests without browser cookies. It has no short clock expiry while playback is valid/paused, allowing MA's roughly 30-second pause parking and later explicit resume. Stop, verified completion, takeover, configuration/end/restart/close revoke access as appropriate. Uncertain ownership revokes reads but pins deletion until host recovery. Already buffered external audio cannot be recalled by endpoint revocation.

Original audio URLs never reach the public display or another participant. List/preview artwork requires owner authorization; current artwork uses existing participant/context and reveal/turn checks, revalidated after reads. Independently accessible MA/Sonos queues, caches, and logs can expose playing metadata or source URLs; the app cannot hide those interfaces. Capabilities must be treated as secrets.

If reverse connectivity or exact resolution fails, no queue mutation is sent. The file/head is retained under the existing explicit playback-review workflow. Check the file-playback address and network path, then explicitly retry after review; do not blindly resend Play.

## Installation and validation

The Docker/add-on image includes **FFprobe** via Alpine's `ffmpeg` package and the metadata/image dependencies. Native Node installations need FFprobe on `PATH` (for example, install the OS `ffmpeg` package) before uploading files; other app features still work if it is absent. Node 24 is supported. Sharp native/prebuilt dependencies were exercised on Linux x64/Alpine; other add-on architectures require their own package verification.

Run `npm run typecheck`, `npm test`, `npm run test:browser`, and `npm run test:container`. The latter uses its own temporary containers/volumes, tests actual packaged MP3 CBR/VBR, M4A AAC/ALAC, FLAC, WAV, AIFF, Vorbis/Opus processing and JPEG/PNG covers, rejects text/raw AAC, and verifies original bytes/artwork/recovery across restart without any real speaker commands.

Browser/transport tests use synthetic analysis/MA fixtures; the container smoke uses actual FFprobe/metadata/image processing. The separate real-MA LAN probe above verifies protected-file fetch/resolution, not audible lifecycle behaviour. Real iPhone/Android native pickers, deployed-address verification, exact speaker playback, long pause/resume, natural completion, and interference/recovery remain live acceptance tasks requiring approval. See [research](uploaded-audio-research.md) for the historical development networking observations.
