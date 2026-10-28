# Troubleshooting

## The app is missing from the store

Check that the repository was added, reload the store, and confirm Home Assistant is at least 2026.10.0 on amd64 or aarch64. This app requires Home Assistant OS and Supervisor’s app store.

## Open web UI works, but the QR code does not

Ingress and guest access are separate. Enable the app’s `3000/tcp` port under **Network** and check **Settings → Guest access** in the web UI. Open the join link directly on a phone on the same trusted LAN. Guest Wi-Fi isolation and a changed host port are common causes. Home Assistant remote access does not publish the guest port.

## Music Assistant is not found or sign-in cannot open

Choose **Find Music Assistant**. If discovery fails, enter its direct API origin, normally `http://<ma-host>:8095`. Do not paste a Home Assistant dashboard/Ingress path.

If the detected internal address works for the app but not the browser, expand **Advanced: token or separate login address** and use a browser-reachable login address, or enter a token from Music Assistant’s profile settings. Allow the sign-in tab/callback to complete. Cancelled or expired login leaves existing settings intact.

## The connection needs attention

Check Music Assistant itself is running and reachable. Use **Reconnect Music Assistant** for expired/revoked authorization. Do not disconnect just to renew a token: disconnecting creates a new catalogue binding on reconnection. For a verified address change of the same server, use the advanced setup flow.

## No available speaker, or playback is unsupported

Check the speaker in Music Assistant, then use **Refresh speakers**. Only available speakers are selectable; a remembered but unavailable speaker is not shown as ready. The music connection and speaker have independent status.

If Settings reports an unsupported API, note the installed MA version/schema and check for an app update. Playback requires schema 65. Reconnecting a token or choosing a different speaker cannot fix an API-version mismatch.

## An uploaded file is saved but will not play

Open **Settings → Guest access → Test file connection**. Music Assistant must be able to fetch a protected file from the app. Check the suggested address and network reachability; use a verified advanced override only if needed. Also check Music Assistant/speaker readiness and that the file is a [supported format](uploaded-audio.md#supported-formats).

## Playback controls need recovery

Open Settings and choose **Recover playback controls**. The app checks ownership before stopping anything and does not restart or advance playback. Once recovery succeeds, the participant can review their selection and explicitly play again. External Music Assistant/speaker actions may have taken over the queue.

## A private list disappeared

Select your existing name/avatar and enter your four-digit PIN. Remembered browsers continue automatically, and every device uses your same playlist. A matching display name alone is not proof of ownership: creating another user with the same name creates a separate identity. If you forgot your PIN, ask the host to set a replacement under Settings → Users. Existing users upgrading from browser-only recognition can choose their first PIN on their remembered device. Load failures show an error and do not replace existing songs with an empty list. The host UI cannot inspect another person's list.

## Saving or backup fails

Check free disk space in Home Assistant. Uploads have no storage quota. **Saved** is only shown after durable acknowledgement; keep an unsynced change for explicit retry rather than clearing browser data.

If a failed backup leaves writes paused, restart the app and retry when uploads have finished. If startup reports unreadable or unsupported stored data, preserve the backup and logs. Do not delete data files to force a fresh start. Restore a known-good matching-version backup or report the failure.

## Report a problem

Use the [issue form](https://github.com/magnusoverli/aotyassistant/issues/new/choose). Include:

- App, Home Assistant Core/Supervisor, and Music Assistant versions; MA schema if shown.
- Host architecture, browser/device, speaker integration, and whether the page is Ingress or the guest link.
- Exact steps, expected result, actual result, and a short sanitized log excerpt from the app’s **Log** tab.

Do not upload `/data`, backups, cookies, tokens, protected media URLs, or other people’s music. Report credential leaks and privacy vulnerabilities through the [private security channel](../SECURITY.md#reporting-a-vulnerability).
