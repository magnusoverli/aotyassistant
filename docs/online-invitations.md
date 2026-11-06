# Online invitations with Tailscale Funnel

Friends can join Listening Room on mobile data or any Wi-Fi. They open a link or scan the room QR code, choose their name, and enter their PIN. They do not install Tailscale or need a Home Assistant account. Music still plays through your local Music Assistant and speaker; this does not stream the room's audio to remote phones.

## One-time setup

1. Open Listening Room **inside Home Assistant**, then **Settings → Access & network → Online invitations**.
2. Select **Enable online invitations**, then **Sign in to Tailscale**. Create a Tailscale account if you do not already have one. Authorize the new Listening Room device in the account you want to use.
3. Return to the app. Select **Approve in Tailscale** when prompted and approve HTTPS and Funnel. A managed Tailscale account may require its administrator to approve the device and Funnel policy.
4. Wait for **Online invitations ready**. The app checks the exact guest-only proxy configuration and performs an HTTPS challenge through its public address before advertising links.
5. Open Host desk and share its QR code, or use **Copy invitation** in Settings. Test the invitation on a phone with Wi-Fi switched off.

The connector is bundled. There is no separate HA add-on, API key to paste, domain to buy, DNS record, router port-forward, host-network setting, or privileged-mode requirement. Keep Tailscale's account and device access under your control. Tailscale's service availability, account policies, and Funnel bandwidth limits apply; see [Funnel requirements and limitations](https://tailscale.com/docs/features/tailscale-funnel).

Tailscale can expire a device's authorization. Settings shows the reported expiration date. For a dedicated trusted installation, **Tailscale device settings → this device → Disable key expiry** avoids periodic sign-in; otherwise renew authorization when prompted. The host must have permission to change this setting. Keep the account secured and remove this device from Tailscale when decommissioning it.

## Moving between venues

Connect the HA machine to internet access, complete any venue captive-portal login, and ensure Music Assistant can reach the speaker. The tunnel reconnects automatically. No venue router access is needed. Bringing a travel router and your own speaker keeps the local network predictable.

Your `https://listening-room.…ts.net` address and invitation survive network changes and app restarts. Keep the same Tailscale device/account and saved app data: deleting or renaming that device, changing the tailnet domain, or losing its state can change the address. Browser sign-in is origin-specific; switching from a LAN address to the online address may require choosing your name and entering your existing PIN again. Playlists and uploaded files stay on the HA machine.

Guest authorization lasts seven days per browser. Reopen the invitation to renew it. The invitation itself stays valid until you replace it or turn online invitations off. Share the whole link, including its `#online=…` fragment; the bare hostname is not an invitation.

## Control and recovery

| Situation | What to do |
| --- | --- |
| Sign-in or approval requested | Complete the linked Tailscale page, then return. Settings updates automatically. |
| Public reachability not confirmed | Check internet access, captive portals, Tailscale approval, DNS, and outbound HTTPS. The app retries automatically. |
| Old link, expired browser authorization, or new browser | Open the latest invitation from the host. Existing playlists are retained. |
| An invitation was shared too widely | Select **Replace invitation** and share the new link/QR code. Old links and all existing online guest connections are revoked. |
| No internet at this venue | Select **Turn off online invitations** and share the local QR code. Guests need access to your trusted LAN. |
| Different venue speaker | Connect it to a network Music Assistant can reach and select it in Playback settings. |
| Large or slow upload | Online uploads require a known size, support up to 256 MiB, and have a two-minute request deadline. Use local Wi-Fi for larger/slower transfers. |

When online invitations are enabled, Host desk and Room display use them; unresolved online connectivity hides invitations rather than silently presenting a LAN-only link. The local guest address remains available under **Guest access**. Turning online invitations off stops the bundled daemon, revokes existing online grants, and restores local invitations. It retains the Tailscale device identity for future use. It does not stop speaker playback or delete playlists.

## Backups and privacy

The app stores the connector identity under `/data/tailscale` and its invitation signing state in `/data/online-access.json`, with private permissions. Protect Home Assistant backups: these contain the device identity, invitation state, Music Assistant access, and users' private data. The connector stops while Supervisor takes a coordinated backup and reconnects afterward. Restore onto only one active installation; never run two copies of the same Tailscale identity concurrently. Restoring an old backup can restore old invitations, so **Replace invitation** after a restore if any links were previously revoked.

Only the guest listener is published, on container-loopback port 8098. It accepts explicitly permitted guest routes, requires an invitation before exposing profiles or room data, and blocks host APIs, Settings, health details, and Music Assistant file-playback URLs. Host online setup is available only through authenticated HA Ingress. The existing LAN port still includes unauthenticated host controls: never expose port 3000 with another tunnel or port-forward.

Treat an invitation as a key to the room. Invited friends can see the user directory and operate participant controls according to their turn. A four-digit PIN remains a casual privacy barrier among invited friends, not strong identity verification. Keep invitations, cookies, Tailscale state, and pairing links out of logs, public issues, and screenshots. Tailscale handles account sign-in and public HTTPS certificates; its normal account and certificate-transparency considerations apply. See [security and privacy](../SECURITY.md).
