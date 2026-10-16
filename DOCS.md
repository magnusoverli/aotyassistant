# Albums of the Year — Home Assistant lab installation

This development add-on is built from source by Home Assistant Supervisor. It supports amd64 and aarch64; installation and runtime acceptance on HAOS are still pending. The application does not require a Home Assistant API token.

## Install

1. In Home Assistant, open **Settings → Apps → App store** (called **Add-ons** on older versions).
2. Open the store's menu, select **Repositories**, and add:
   `https://github.com/magnusoverli/aotyassistant`
3. Find **Albums of the Year (development)** and select **Install**. The initial source build can take several minutes and requires internet access.
4. In **Configuration**, set `guest_url` to the VM's LAN-facing application origin, for example `http://192.168.1.20:3000`. Do not use the Home Assistant port `8123` or an Ingress URL.
5. Check the **Network** section: publish container port `3000/tcp` on an unused host port. If you choose another port, include it in `guest_url`.
6. Start the add-on, inspect **Logs**, and select **Open web UI**.

The add-on does not start automatically at boot by default. Enable **Start on boot** after verifying startup and persistence. Music never starts automatically.

## Use

- `/host`: manage the listening order.
- `/host/settings`: configure Music Assistant and application addresses.
- `/join`: participant phone interface.
- `/display`: permanent public display.

Without a configured Music Assistant connection, the app offers its demo catalogue. For real playback, enter Music Assistant's direct LAN origin (normally port `8095`) and a long-lived token in the app's settings, then select a speaker. No speaker test is required just to install the app.

Phones, the display, and Music Assistant need access to the published application port. Music Assistant must also be able to fetch uploaded media; verify this in **Application addresses**. The app itself does not require host networking or multicast discovery: Music Assistant handles speaker discovery.

## Security and storage

**The host controls are intentionally unauthenticated.** Anyone who can reach this application can manage the room and integration settings. Keep it on a trusted lab LAN; do not forward the port to the internet. Home Assistant login does not protect this separate port. Ingress is not enabled.

State, private lists, uploads, and integration settings persist in the add-on's `/data`. Include the add-on in Home Assistant backups and protect those backups: the Music Assistant token is stored server-side in plaintext. Uninstalling the add-on can delete its data.

## Updates and lab acceptance

Supervisor uses `version` in `config.yaml` to offer updates; pushing source changes alone is not an add-on release. For each release, update the version and changelog, push the commit, then check the store for updates. Back up before updating. Restarts clear playback ownership and reveal state; Music Assistant may continue playing independently.

Before calling the HAOS deployment verified, check installation logs, all four interfaces, restart persistence, backup/restore, and a versioned update. Speaker playback and natural-end/recovery tests are separate acceptance checks.
