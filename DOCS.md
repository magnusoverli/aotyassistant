# Install and manage Doom Room

Doom Room lets people prepare private track selections, take turns playing through Music Assistant, and reveal track details on a shared display.

It is distributed and supported as a **Home Assistant app**. Use Home Assistant OS with Core **2026.10.0 or later**, Supervisor, and an **amd64** or **aarch64** system. Music Assistant must be reachable from the app and have a working login, music source, and speaker/group. Playback supports **MA API schema 65**.

## Install

[![Add repository to Home Assistant](https://my.home-assistant.io/badges/supervisor_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmagnusoverli%2Fdoom-room)

1. Add `https://github.com/magnusoverli/doom-room` under **Settings → Apps → App store → Repositories**.

   Already added `https://github.com/magnusoverli/aotyassistant`? Keep it. It redirects to the new address, and updates continue. Don't add the new address as well: Home Assistant would list a second, separate Doom Room.
2. Install **Doom Room**. Supervisor downloads the published image for the system’s architecture.
3. Keep the app’s **Network** port enabled: container port `3000/tcp` is published as port `3000` by default. Choose another free host port if necessary.
4. Start the app and select **Open web UI**. The host desk opens inside Home Assistant through Ingress. Enable **Show in sidebar** if desired.

**Start on boot** is enabled for new installations. The optional **Watchdog** checks the app’s process health; an unavailable Music Assistant server does not by itself make the app unhealthy.

## Connect Music Assistant

1. Open **Settings** and select a detected server. Use **Find Music Assistant** to search again. If needed, enter the server’s direct API address, normally `http://<ma-host>:8095`, rather than its Home Assistant dashboard/Ingress URL.
2. Choose **Connect Music Assistant**, complete sign-in in the new tab, and return to Settings.
3. Choose an available **Speaker or group**. Selection is checked and saved immediately.
4. Under **Access & network**, check **Guest access** for local joining, or enable **Online invitations** and follow the Tailscale sign-in/approval prompts. Open the host desk’s join/display links from a guest device.

Discovery, connection checks, idle speaker selection, and file-access checks do not play audio or change volume. During a song, selecting another speaker and confirming moves the current playback there; see [changing speakers](docs/using-the-app.md#change-speakers-during-a-song). An explicit Play action replaces the selected destination’s queue with one song and may interrupt music already playing there.

**Advanced: token or separate login address** supports a browser-reachable MA login address when the detected internal hostname is inaccessible from the browser, or manual token entry from MA’s profile settings. A cancelled sign-in keeps existing settings. A Home Assistant access token is not required.

Use **Reconnect Music Assistant** to renew authorization for the same server while retaining saved music identity and speaker selection. Use **Disconnect** when replacing the server. Disconnecting removes this app’s saved token; revoke it in Music Assistant separately if needed. See [connection and compatibility details](docs/music-assistant.md).

## Guest and display access

- **All menu pages:** stay on the address you opened, including Home Assistant Ingress. Your music and Room display do not require a separate network address when opened from the menu.
- **Invitations and QR codes:** use the separate guest address, without Home Assistant accounts. By default the LAN address is detected automatically. Optional **Online invitations** use a stable HTTPS address and private invitation link through the bundled Tailscale Funnel connector.

Supervisor supplies LAN-address and published-port suggestions. Choose a stable address in Settings if several interfaces are available. Phones and the display must be able to reach that address; isolated guest Wi-Fi may block it. Home Assistant remote access does not automatically expose the guest port.

For joining over mobile data and moving between venues, see [online invitations](docs/online-invitations.md). The only external setup is authorizing the bundled device in your Tailscale account and approving HTTPS/Funnel. Music Assistant still needs local access to the speaker.

Keep the address stable. Changing its hostname, IP, port, or HTTP/HTTPS scheme can require participants to rejoin and lose access to previous selections. Browser identities do not move between origins, and there is no list-recovery feature. See [application addresses](docs/application-addressing.md).

**Host controls on the LAN port are open to everyone who can reach it.** Use a trusted network and do not forward the port to the internet. Ingress authentication does not secure the LAN port. See [security and privacy](SECURITY.md).

## App options

Normal setup takes place in **Settings**. The Home Assistant Configuration tab contains these advanced/compatibility options:

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

Update the existing installation from the same repository; uninstalling is not required. Room membership/order, saved lists, uploaded files, and settings are retained. Restart clears playback ownership and reveal and never starts audio. Music Assistant may continue playing independently if playback was active before the restart.

Room data in legacy schemas 1 and 2 is not migrated or silently deleted. If startup reports unsupported stored data, retain a backup and [report the installed and target versions](https://github.com/magnusoverli/doom-room/issues). Corrupt records also stop startup rather than replacing saved state.

## Move from Listening Room

Doom Room was previously named **Listening Room** and, before that, **Albums of the Year**. Doom Room has a new Home Assistant ID, so Home Assistant installs it as a separate app. The installed Listening Room app receives no further updates. Its room, saved lists, uploaded files, sign-ins, and settings do not move to Doom Room.

1. Create a Home Assistant backup including **Listening Room**, in case you need the old room again.
2. Refresh the app store and install **Doom Room** from the same repository.
3. Stop **Listening Room**. Both apps use port `3000` by default, so only one can run at a time.
4. Start Doom Room, then [connect Music Assistant](#connect-music-assistant) and choose a speaker or group.
5. Share the new guest link or QR code. Participants choose their display name and PIN again, then build **Your playlist**.
6. If you use online invitations, enable them again and sign in to Tailscale. The guest address becomes `https://doom-room.…ts.net`, so share the new invitation. Remove the old **listening-room** device in the Tailscale admin console.
7. Browser speakers register again as **Doom Room (…)**. In Music Assistant, remove leftover **Listening Room (…)** web players and revoke the old app's token if you no longer need them.
8. When Doom Room works, uninstall **Listening Room**.

## Backups and restore

Include **Doom Room** in the Home Assistant backup selection. Its private `/data` contains the room, integration credentials, settings, private lists, and uploaded audio. Protect the backup: it contains a Music Assistant token and private files.

Hot-backup hooks coordinate persistent writes while Supervisor archives the data. Existing read-only pages and audio streams remain available. If a backup fails and writes remain paused, restart the app and retry the backup. Avoid large uploads during backups.

Restore the app through Home Assistant’s backup interface. Recheck the guest address, Music Assistant connection, and speaker after restoring, especially on a replacement host. Preserve the guest origin and browser credentials: restoring server data cannot restore a browser identity that was cleared. Uninstalling the app may remove its data.

For a rollback, restore the pre-update backup together with its matching app version; do not assume an older image can read a newer data format. See [troubleshooting](docs/troubleshooting.md) for common recovery paths.
