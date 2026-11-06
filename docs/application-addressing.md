# Application addresses

The app uses separate addresses for different jobs:

| Address | Used by |
| --- | --- |
| Home Assistant Ingress | All app pages opened inside Home Assistant |
| Guest address | Participant phones, join QR codes, and the shared display |
| Music Assistant API address | The app connecting to Music Assistant |
| File-playback address | Music Assistant fetching uploaded audio from the app |

An address that works for one job may not work for another. In particular, guests and Music Assistant cannot use an authenticated Home Assistant Ingress link as a file/guest origin.

## Guest links

Menu navigation stays on the current address. When opened inside Home Assistant, participant pages, uploads, private lists, and the display remain inside Ingress. Guest invitations and QR codes use a separate LAN address.

Home Assistant supplies LAN interfaces and the app’s effective published port. A single preferred LAN address is selected automatically. Automatic selection retains a suitable address across refreshes, and a replacement must appear in two successful discovery scans before it is saved. Address changes wait while the app owns playback. Discovery does not depend on connecting Music Assistant.

**Settings → Access & network → Guest access** shows sharing status. **Advanced guest settings** contains network choices, a discovery refresh, and manual overrides. **Use automatic address** clears an in-app override. The add-on's explicit `guest_url`/environment override still takes precedence over discovery. Existing addresses saved by older releases are preserved as legacy selections because their original source is unknown; use automatic addressing to opt in.

Host desk and Room display hide invitations while automatic discovery is unresolved or the guest port is disabled. A detected address is not proof that every phone can reach it: use **Open guest invitation** and try the link on a guest device. Standalone localhost links are labelled as working only on the current device.

Use a stable hostname or reserved LAN address reachable by participant devices and the display. Include the published port, normally `3000`. An address is an HTTP(S) origin without a path, query, credentials, or fragment. `localhost` refers to the device opening it, so it cannot be shared with phones.

Changing the origin requires guests to select their name and enter their four-digit PIN again because remembered browser sessions do not move between origins. This also applies when moving between direct LAN access and Home Assistant Ingress. Their existing playlist and files remain associated with their user. Active tabs are not redirected when discovery updates invitation links. Keep the guest address stable for convenient automatic recognition. See [private selections](private-lists.md).

The optional Home Assistant `guest_url` option is a fallback; a saved in-app guest address takes precedence. Supervisor-verified LAN addresses can also open the guest/display pages. Other address mismatches show a setup/recovery page rather than granting unrestricted access through an arbitrary Host header.

## Music Assistant file access

The app automatically checks whether Music Assistant can fetch a short synthetic protected WAV file. This plays no audio and uses no participant upload. A successful callback is required before an automatic file address or manual override is accepted.

Use **Test file connection** to repeat the check. **Advanced address override** is for an address reachable from Music Assistant when automatic suggestions cannot work. A manual override takes precedence until it is cleared. Failed checks leave saved addresses and private files intact.

File access is rechecked after startup and relevant connection/network changes; Settings shows the latest result across tabs. A diagnostic is a point-in-time check. Every real uploaded-track Play verifies its own exact protected source again.

## Network requirements

- Publish the app’s guest port in its Home Assistant **Network** settings.
- Allow phones and the display to reach it on the trusted LAN. Home Assistant remote access alone does not publish it.
- Allow Music Assistant to reach the file address. Apps on the same HA host can use Supervisor’s internal network.
- Discovery cannot fix blocked ports, isolated Wi-Fi/VLANs, or DNS/routing problems.
- If an existing proxy is used, it must preserve the configured Host, support streaming and byte-range requests, and use certificates trusted by Music Assistant. Do not log protected media URLs, cookies, or API request bodies.

Address settings do not change firewall rules, routes, port publication, or Home Assistant remote access. See [troubleshooting](troubleshooting.md).
