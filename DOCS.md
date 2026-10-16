# Albums of the Year — Home Assistant installation

Requires **Home Assistant 2026.10.0 or later** with Supervisor, amd64 or aarch64, and an installed/onboarded Music Assistant server. Real playback currently supports MA API schema 65. Core, Supervisor and MA have independent versions.

[![Add repository to Home Assistant](https://my.home-assistant.io/badges/supervisor_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmagnusoverli%2Faotyassistant)

## Install and connect

1. Use the button above, or add `https://github.com/magnusoverli/aotyassistant` under **Settings → Apps → App store → Repositories**.
2. Install **Albums of the Year (development)** and start it. Source builds can take several minutes; published-image releases download a prebuilt image instead.
3. Select **Open web UI**. The host interface opens through Home Assistant Ingress. Enable its sidebar entry in the app's Info page if desired.
4. Open **Connections & settings**, choose a detected server, and select **Connect Music Assistant**. Complete MA sign-in in the new tab. If discovery misses an external server, enter its direct API address (normally port 8095).
5. Choose a speaker/group and **Save destination**, then share the host desk's guest QR or display link.

Guest addresses are derived from Supervisor's LAN interface and effective published port. MA-facing media addresses are checked automatically by fetching a protected synthetic file; setup never starts audio. For multiple interfaces, choose a guest address in **Home Assistant setup**. If port `3000/tcp` is disabled, publish it under **Network**, or configure a reachable reverse-proxy origin.

New installs default to **Start on boot**. MA startup is retried in the background; **Find Music Assistant** retries manually. The host UI remains available while MA is offline. Supervisor's optional **Watchdog** monitors this app, not MA availability.

## Addresses and sign-in fallback

- `/host` and `/host/settings`: host controls, through Ingress or the LAN port.
- `/join`, `/participant`, `/display`: guests and display, using the separate LAN origin without HA accounts.
- Existing guest addresses are preserved. `guest_url` is an optional advanced override; normal installation needs no Configuration-tab edits.
- **Advanced: token or separate login address** supports a browser-reachable MA address when the backend uses internal DNS, or manual token entry from **MA → Settings → Profile**.
- **Reconnect Music Assistant** renews authorization while retaining the same server's speaker and private-list source identity. MA 2.10.6 long-lived tokens expire after one year. Replacing the server requires an explicit Disconnect.
- Cancelled/expired login or blocked browser/webview callbacks keep saved settings intact. Retry Connect or use the token fallback.

Phones need access to the guest port; HA remote access does not publish it. MA can fetch media over Supervisor's internal network when installed on the same host. Manual media overrides take precedence. Keep a stable guest address because changing browser origins affects cookies and private-list recovery.

## Access and backups

The app uses the injected Supervisor token for **default-role information reads**; users do not create an HA token. Best-effort mDNS helps find external MA servers. Host networking, Docker access, Core database access and shared-media mounts are unnecessary.

**LAN host controls remain intentionally unauthenticated.** HA login protects Ingress, not the published LAN port. Keep that port on a trusted LAN. The MA token stays in the protected `/data/integrations.json` and is not returned to the UI. The dedicated MA login callback consumes its credential and immediately redirects to a clean URL.

Include all of `/data` in HA backups: room state, settings, private lists and uploads. Hot-backup hooks wait for active filesystem writes and pause new writes during the archive. Read-only pages and existing audio streams remain available. Long uploads can make the pre-backup hook fail; retry after they finish. The post-backup hook resumes writes. Restart the app if a failed Supervisor backup leaves writes paused. Protect backups because they contain credentials; uninstalling can delete app data.

## Releases

Supervisor uses `version` in `config.yaml` to offer updates. Restart restores lists/settings/order but clears playback ownership and reveal; MA may continue independently. See [image publishing](docs/home-assistant-releases.md) and [setup implementation/research](docs/home-assistant-setup-research.md).
