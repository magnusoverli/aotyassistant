# Install and manage Albums of the Year

Albums of the Year is distributed and supported as a **Home Assistant app**. Use Home Assistant OS with Core **2026.10.0 or later**, Supervisor, and an **amd64** or **aarch64** system. Music Assistant must be reachable from the app and have a working login, music source, and speaker/group. Playback supports **MA API schema 65**.

## Install

[![Add repository to Home Assistant](https://my.home-assistant.io/badges/supervisor_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmagnusoverli%2Faotyassistant)

1. Add `https://github.com/magnusoverli/aotyassistant` under **Settings → Apps → App store → Repositories**.
2. Install **Albums of the Year**. Supervisor downloads the published image for your architecture.
3. Keep the app’s **Network** port enabled: container port `3000/tcp` is published as port `3000` by default. Choose another free host port if necessary.
4. Start the app and select **Open web UI**. The host desk opens inside Home Assistant through Ingress. Enable **Show in sidebar** if desired.

**Start on boot** is enabled for new installations. The optional **Watchdog** checks the app’s process health; an unavailable Music Assistant server does not by itself make the app unhealthy.

## Connect Music Assistant

1. Open **Connections & settings** and select a detected server. Use **Find Music Assistant** to search again. If needed, enter the server’s direct API address, normally `http://<ma-host>:8095`, rather than its Home Assistant dashboard/Ingress URL.
2. Choose **Connect Music Assistant**, complete sign-in in the new tab, and return to Settings.
3. Choose an available **Speaker or group**. Selection is checked and saved immediately.
4. Check **Application addresses**, then open the host desk’s join/display links from a guest device.

Discovery, connection checks, speaker selection, and file-access checks do not play audio or change volume. An explicit Play action replaces the selected destination’s queue with one song and may interrupt music already playing there.

**Advanced: token or separate login address** supports a browser-reachable MA login address when the detected internal hostname cannot open on your device, or manual token entry from MA’s profile settings. A cancelled sign-in keeps existing settings. You do not need to create a Home Assistant access token.

Use **Reconnect Music Assistant** to renew authorization for the same server while retaining saved music identity and speaker selection. Use **Disconnect** when replacing the server. Disconnecting removes this app’s saved token; revoke it in Music Assistant separately if needed. See [connection and compatibility details](docs/music-assistant.md).

## Guest and display access

- **Host desk / Connections & settings:** available through Home Assistant Ingress and the published LAN port.
- **My seat / Join / Listening room:** use the separate guest address, without Home Assistant accounts.

Supervisor supplies LAN-address and published-port suggestions. Choose a stable address in Settings if several interfaces are available. Phones and the display must be able to reach that address; isolated guest Wi-Fi may block it. Home Assistant remote access does not automatically expose the guest port.

Keep the address stable. Changing its hostname, IP, port, or HTTP/HTTPS scheme can require participants to rejoin and recover their private lists. Save recovery keys first. See [application addresses](docs/application-addressing.md).

**Host controls on the LAN port are open to everyone who can reach it.** Use a trusted network and do not forward the port to the internet. Ingress authentication does not secure the LAN port. See [security and privacy](SECURITY.md).

## App options

Normal setup takes place in **Connections & settings**. The Home Assistant Configuration tab contains only these advanced/compatibility options:

| Option | Default | Purpose |
| --- | --- | --- |
| `guest_url` | Automatic | Optional guest-origin fallback, such as `http://homeassistant.local:3000`. Include the published port; no path, query, or Ingress address. A saved in-app guest address takes precedence. |
| `demo_track_seconds` | `30` | Simulated track length before Music Assistant is connected; 1–3600 seconds. No effect on real music. |
| `playback_mode` | `demo` | Compatibility option for older saved configuration. Connecting Music Assistant enables real playback automatically. |

## Updates and restart behaviour

1. Finish or stop app-owned playback.
2. Create a Home Assistant backup including this app.
3. Check the app store for updates, read the [changelog](CHANGELOG.md), and install the update.
4. Refresh open browser pages and check the Music Assistant/speaker status in Settings.

The stable app uses the same repository and slug as 0.3.16: update the existing installation; do not uninstall it. Room membership/order, saved lists, uploaded files, and settings are retained. Restart clears playback ownership and reveal and never starts audio. Music Assistant may continue independently if you leave a song playing.

Obsolete room schemas from early development builds are not migrated or silently deleted. If startup reports unsupported stored data, retain a backup and [report the upgrade path](https://github.com/magnusoverli/aotyassistant/issues). Corrupt records likewise stop startup rather than replacing saved state.

## Backups and restore

Include **Albums of the Year** in your Home Assistant backup selection. Its private `/data` contains the room, integration credentials, settings, private lists, and uploaded audio. Protect the backup: it contains a Music Assistant token and private files.

Hot-backup hooks coordinate persistent writes while Supervisor archives the data. Existing read-only pages and audio streams remain available. If a backup fails and writes remain paused, restart the app and retry the backup. Avoid large uploads during backups.

Restore the app through Home Assistant’s backup interface. Recheck the guest address, Music Assistant connection, and speaker after restoring, especially on a replacement host. Keep participant recovery keys: restoring server data cannot restore credentials that a phone’s browser has lost. Uninstalling the app may remove its data.

For a rollback, restore the pre-update backup together with its matching app version; do not assume an older image can read a newer data format. See [troubleshooting](docs/troubleshooting.md) for common recovery paths.
