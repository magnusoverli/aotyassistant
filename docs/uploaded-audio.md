# Uploaded audio

Upload one audio file from a phone or computer, review its title, artist, album, and embedded cover, then add it to **Your playlist**. The Home Assistant app includes the required audio-analysis tools.

## Supported formats

| Format | Details |
| --- | --- |
| MP3 | Constant or variable bitrate |
| M4A | AAC or Apple Lossless/ALAC |
| FLAC | Lossless audio |
| WAV / AIFF | PCM audio |
| Ogg Vorbis / Opus | Vorbis or Opus in an Ogg container |

Supported extensions are `.mp3`, `.m4a`, `.flac`, `.wav`, `.aif`, `.aiff`, `.ogg`, `.oga`, and `.opus`. The app checks actual file contents. Raw `.aac`/ADTS, video, archives, folders, batch import, and downloads protected by streaming services are unsupported. Music Assistant handles any conversion needed by the speaker.

## Upload and play

1. Join the room and choose **Upload a song**.
2. Select one file and wait for upload and processing to finish.
3. Review the details and correct the text if needed.
4. Choose **Add to list** and wait for **Saved**.
5. During the current participant’s turn, select **Play first selection** in the player to play the first entry in the list.

Upload completion alone is not a saved list entry. Uploading does not change the turn or start audio. Once saved, the phone can disconnect; the file is stored by the app. Text corrections do not rewrite the original audio.

Files can be prepared while Music Assistant is unavailable. Playback requires a connected, compatible server and speaker, plus successful file-access verification in Settings. The demo timer does not play uploads.

## Interrupted uploads

Failed uploads show their error for the current attempt, not again after refreshing. Rejected or missing uploads are forgotten automatically; saved tracks are unaffected.

The app automatically checks uncertain upload responses and restores completed uploads and edited review text after a reload or reconnection. An incomplete transfer may require choosing the file again. Adding to the playlist and retrying an unconfirmed save remain explicit; the app does not automatically resend files or audio commands, or duplicate an acknowledged entry.

Upload progress is shown until processing finishes. Use **Choose another file** afterward to replace an unsaved selection. The app handles cleanup internally and never deletes a file referenced by a saved track. Completed uploads not added to a list expire after seven days if they cannot be cleaned up sooner. Saved files do not expire.

## Storage and deletion

There are no configured file-size, per-person, or total upload-storage quotas. Available Home Assistant disk space remains the limit; monitor storage and keep backups. Uploads are part of the app’s private `/data` and its Home Assistant backup.

**Remove** is reversible and retains the file. To reclaim its storage, open **History → Removed**, choose **Delete file permanently**, and confirm. This removes that file and its entries from the private list/history. Deletion is blocked while the file is starting, playing, paused, or awaiting playback recovery. Deleting here cannot remove copies from existing backups.

Only the owner can access private upload previews and artwork. The display gets artwork only after reveal. Music Assistant receives a protected, playback-specific file URL; it is revoked when playback is released or the app restarts. Independently accessible Music Assistant/speaker interfaces may still show track information.

For file-access errors, see [application addresses](application-addressing.md) and [troubleshooting](troubleshooting.md).
