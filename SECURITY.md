# Security and privacy

## Supported scope

Security fixes target the latest stable Home Assistant app release. Install updates through Home Assistant and keep Home Assistant and Music Assistant supported and up to date.

## Network access

The published LAN port exposes guest pages **and unauthenticated host controls**. Anyone who can reach it can manage the listening order, change integration settings, and adjust the selected destination’s volume. Use a trusted LAN. Do not forward this port to the internet.

Home Assistant login protects the Ingress interface only. It does not add authentication to the LAN endpoint. Guest Wi-Fi access rules must account for this access model.

The optional built-in Tailscale Funnel feature uses a separate loopback-only guest listener with an explicit route allowlist. It does not publish host controls, configuration, health, or file-playback endpoints. Its administration requires authenticated HA Ingress. Do not substitute the LAN port as a Funnel target.

Online guests need a high-entropy revocable invitation before accessing profiles, participant APIs, or the display. Invitation fragments are exchanged for seven-day signed Secure/HttpOnly/SameSite cookies and removed from browser history before room requests start. Replacing or disabling invitations invalidates grants and closes active guest responses. Global and per-grant limits, bounded uploads, existing PIN cooldowns, and per-user private-list checks apply. An invited person can still share their invitation; this is a trusted-friends access model, not strong identity verification or protection against denial of service.

## Credentials and private music

- Music Assistant tokens remain server-side in a permission-restricted file under `/data`; they are **not encrypted at rest**.
- Permanent users have one private playlist each, accessed through independent HttpOnly browser sessions and separate private-list credentials. A display name alone is not proof of ownership; another browser needs that user's four-digit PIN.
- PINs are a casual privacy barrier on the trusted LAN, stored as salted scrypt verifiers. Five incorrect attempts trigger an initial one-minute cooldown. Host PIN reset revokes remembered sessions without deleting data, and inherits the unauthenticated host-control model above.
- Public display responses omit concealed titles, artists, and artwork until reveal. Other Music Assistant, Home Assistant, and speaker interfaces can independently expose playing metadata.
- Uploaded audio uses protected playback-specific URLs; treat those URLs as secrets.
- Backups contain tokens, user/PIN records, private lists, uploaded files, invitation signing state, and the Tailscale device identity when enabled. Protect backups and their encryption keys. Do not run cloned Tailscale identities concurrently; replace invitations after restoring old backups to preserve intended revocations.
- PINs, cookies, tokens, protected URLs, private lists, and backup archives must not be included in public issues or logs.

## Reporting a vulnerability

Use [GitHub’s private vulnerability report](https://github.com/magnusoverli/aotyassistant/security/advisories/new) for credential disclosure, unauthorized private-list/file access, or other security issues. Include the affected version, prerequisites, and minimal reproduction. Avoid real secrets and other people’s data.

Use ordinary [GitHub issues](https://github.com/magnusoverli/aotyassistant/issues) for non-sensitive bugs. No response-time or support SLA is promised.
