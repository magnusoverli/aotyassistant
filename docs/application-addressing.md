# Application addresses

The app uses separate addresses for different jobs:

| Address | Used by |
| --- | --- |
| Home Assistant Ingress | The host opening the app inside Home Assistant |
| Guest address | Participant phones, join QR codes, and the shared display |
| Music Assistant API address | The app connecting to Music Assistant |
| File-playback address | Music Assistant fetching uploaded audio from the app |

An address that works for one job may not work for another. In particular, guests and Music Assistant cannot use an authenticated Home Assistant Ingress link as a file/guest origin.

## Guest links

Home Assistant supplies LAN interfaces and the app’s effective published port. In **Settings**, select a suggested address under **Home Assistant setup**, or open **Guest access → Change guest address**. A saved address updates join/display links immediately and survives restarts.

Use a stable hostname or reserved LAN address reachable by participant devices and the display. Include the published port, normally `3000`. An address is an HTTP(S) origin without a path, query, credentials, or fragment. `localhost` refers to the device opening it, so it cannot be shared with phones.

Changing the origin can require guests to rejoin and lose access to previous selections because browser credentials do not move between origins. Keep the guest address stable: there is no cross-device or cross-origin list recovery feature. Changing an address does not delete server-side lists or files. See [private selections](private-lists.md).

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
