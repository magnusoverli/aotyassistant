# Albums of the Year

**A Home Assistant app for sharing favourite music, one person and one song at a time.**

Gather your friends, scan the room’s QR code, and take turns playing a song from a favourite album. Everyone prepares their choices privately on their phone. A shared display keeps the song hidden until the current listener reveals it.

[![Release](https://img.shields.io/github/v/release/magnusoverli/aotyassistant)](https://github.com/magnusoverli/aotyassistant/releases/latest)
[![Application checks](https://github.com/magnusoverli/aotyassistant/actions/workflows/ci.yaml/badge.svg?branch=main)](https://github.com/magnusoverli/aotyassistant/actions/workflows/ci.yaml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## What it does

- **Take turns:** join with a nickname, see who is up next, and let the host arrange the listening order.
- **Find your music:** search artists, albums, and tracks across the sources configured in Music Assistant.
- **Prepare privately:** save and reorder your picks, upload a track, and keep your list between gatherings.
- **Play and reveal:** control your song during your turn, then reveal its title, artist, and artwork on the shared display.
- **Keep the room moving:** confirmed track completion advances the turn; the next song starts only when someone presses Play.
- **Use the screens you have:** participant phones, a host desk inside Home Assistant, and a browser on a TV or shared display. Guests need no Home Assistant account or app installation.

## Requirements

- **Home Assistant OS**, with Home Assistant **2026.10.0 or later** and the app store.
- An **amd64** or **aarch64** system.
- **Music Assistant**, with a configured music source and speaker or group. Playback currently supports **API schema 65**; Settings reports compatibility with your installed server.
- A trusted local network that lets guest devices reach the app’s published port, **3000** by default.

**Home Assistant is the only supported deployment.** See [Music Assistant compatibility](docs/music-assistant.md) for player and provider limitations.

## Install

[![Add repository to Home Assistant](https://my.home-assistant.io/badges/supervisor_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmagnusoverli%2Faotyassistant)

1. Add this repository to **Settings → Apps → App store → Repositories**:
   ```text
   https://github.com/magnusoverli/aotyassistant
   ```
2. Install **Albums of the Year**, start it, and select **Open web UI**.
3. Open **Connections & settings**, connect Music Assistant, and choose your speaker or group.
4. Share the host desk’s join QR code and open its **Listening room** link on your shared display.

The app discovers local addresses and Music Assistant automatically. Setup checks do not start music. For the full walkthrough, options, updates, and backups, see the **[installation guide](DOCS.md)**.

## A listening evening

The host opens **Host desk** to share invitations and arrange people. Each guest joins on their phone, then browses **Find music**, adds songs to **My list**, or uploads an audio file. On their turn, they choose **Play** or **Play next**, and **Reveal** when they are ready to show the song. **Finish my turn** passes to the next person.

There is one persistent room. People, saved lists, and settings survive app restarts; playback and reveal reset. Joining, restarting, or advancing a turn never starts the next song automatically.

## Access and privacy

Use this app on a **trusted LAN**. Anyone who can reach its guest port can also open the host controls, change settings, and manage the listening order. Home Assistant authentication protects the Ingress interface, not the separate LAN port. Do not publish that port to the internet.

Private song lists are tied to browser credentials. Save a recovery key to retain access when changing phones or browser addresses. The app keeps unrevealed music off the shared display, but cannot hide it in independently accessible Music Assistant or speaker apps. See [security and privacy](SECURITY.md).

## Guides and support

- [Install, configure, update, and back up](DOCS.md)
- [Host and participant guide](docs/using-the-app.md)
- [Private lists and recovery](docs/private-lists.md)
- [Uploading audio](docs/uploaded-audio.md)
- [Connection and playback troubleshooting](docs/troubleshooting.md)
- [All documentation](docs/README.md) · [Changelog](CHANGELOG.md)

For bugs and questions, [open an issue](https://github.com/magnusoverli/aotyassistant/issues). Include the app, Home Assistant, and Music Assistant versions, the affected page, and steps to reproduce. Remove credentials and private music details from logs and screenshots.

Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under [MIT](LICENSE). This is an independent project, not an official Home Assistant or Music Assistant product.
