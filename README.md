# Doom Room

**Take turns. Share music. Listen together.**

Turn-based music sharing for Home Assistant, powered by Music Assistant.

People join the Doom Room from their phones, prepare private track selections, and take turns playing music. Browse the sources configured in Music Assistant or upload an audio file. Track details stay hidden on the room display until the current participant reveals the title, artist, and artwork.

[![Release](https://img.shields.io/github/v/release/magnusoverli/doom-room)](https://github.com/magnusoverli/doom-room/releases/latest)
[![Application checks](https://github.com/magnusoverli/doom-room/actions/workflows/ci.yaml/badge.svg?branch=main)](https://github.com/magnusoverli/doom-room/actions/workflows/ci.yaml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## What it does

- **Take turns:** choose your name and four-digit PIN, see who is up next, and let the host arrange the listening order.
- **Browse music:** search artists, albums, and tracks across the sources configured in Music Assistant.
- **Prepare privately:** save and reorder selections, upload a track, and return to the same private list on later visits.
- **Play and reveal:** the current participant controls playback and can reveal track details on the shared display, or the host can switch off secret playback to show them as each song starts.
- **Keep the room moving:** confirmed track completion advances the turn; the next track starts when its participant presses Play, or by itself with optional automatic play.
- **Use existing devices:** participant phones, a host desk inside Home Assistant, and a browser on a TV or shared display. Guests need no Home Assistant account or app installation.
- **Make it your room:** add your room's logo to the room display and the join page.

Use it for music discovery, listening clubs, or themed track-sharing. The app manages sharing and playback, not voting, scoring, or rankings.

## Requirements

- **Home Assistant OS**, with Home Assistant **2026.10.0 or later** and the app store.
- An **amd64** or **aarch64** system.
- **Music Assistant**, with a configured music source and speaker or group. Playback supports **API schema 65**; Settings reports compatibility with the connected server.
- A trusted local network for HA and the playback speaker. Guests can use that network or join through optional [online invitations](docs/online-invitations.md) using Tailscale Funnel.

**Home Assistant is the only supported deployment.** See [Music Assistant compatibility](docs/music-assistant.md) for player and provider limitations.

## Install

[![Add repository to Home Assistant](https://my.home-assistant.io/badges/supervisor_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmagnusoverli%2Fdoom-room)

1. Add this repository to **Settings → Apps → App store → Repositories**:
   ```text
   https://github.com/magnusoverli/doom-room
   ```
2. Install **Doom Room**, start it, and select **Open web UI**.
3. Open **Settings**, connect Music Assistant, and choose a speaker or group.
4. Share the host desk’s join QR code and open **Room display** on a shared screen.

The app discovers local addresses and Music Assistant automatically. Setup checks do not start music. For the full walkthrough, options, updates, and backups, see the **[installation guide](DOCS.md)**.

For guests on mobile data or when moving between venues, enable **Settings → Access & network → Online invitations** inside Home Assistant. Complete the guided Tailscale sign-in and Funnel approval once; the bundled connector maintains the invitation address as you move.

## How it works

The host opens **Host desk** to share invitations and arrange the listening order. Guests join on their phones, open **Your music**, browse **Find music**, and add tracks to **Your playlist** or upload an audio file. During a turn, the current participant selects **Play** from search results or **Play first selection** in the player, then **Reveal details** to show the track information. The turn passes automatically when Music Assistant confirms the track has finished, or earlier with **Finish turn**.

There is one persistent room, not separate events or temporary sessions. People, saved lists, and settings survive app restarts; playback and reveal reset. Joining, restarting, **Finish turn** and **Skip turn** never start the next track. With **Settings → Playback → Play the next song automatically** switched on, a track that finishes naturally starts the next participant’s first saved song. Before Music Assistant is connected, **Demo mode — no audio** lets you try the workflow without playing sound.

Pressing Play replaces the selected speaker or group’s queue with one track and may interrupt other audio. The app does not automatically play an entire saved list or album.

## Access and privacy

Use this app on a **trusted LAN**. Anyone who can reach its guest port can also open the host controls, change settings, and manage the listening order. Home Assistant authentication protects the Ingress interface, not the separate LAN port. Do not publish that port to the internet.

The built-in online invitation feature publishes a separate, invitation-protected **guest-only** interface. It never publishes the LAN or Ingress listener. Replace invitations in Settings to revoke old links and online guest sessions.

Each user has one automatic private track list across devices. Select your name/avatar and enter your four-digit PIN on a new browser; remembered browsers continue automatically. The host can reset forgotten PINs in Settings. The app keeps unrevealed track details off the shared display, but cannot hide them in independently accessible Music Assistant or speaker apps. See [security and privacy](SECURITY.md).

## Guides and support

- [Install, configure, update, and back up](DOCS.md)
- [Host and participant guide](docs/using-the-app.md)
- [Private selections and persistence](docs/private-lists.md)
- [Uploading audio](docs/uploaded-audio.md)
- [Connection and playback troubleshooting](docs/troubleshooting.md)
- [All documentation](docs/README.md) · [Changelog](CHANGELOG.md)

For bugs and questions, [open an issue](https://github.com/magnusoverli/doom-room/issues). Include the app, Home Assistant, and Music Assistant versions, the affected page, and steps to reproduce. Remove credentials and private music details from logs and screenshots.

Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under [MIT](LICENSE). This is an independent project, not an official Home Assistant or Music Assistant product.
