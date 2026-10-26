# Security and privacy

## Supported scope

Security fixes target the latest stable Home Assistant app release. Install updates through Home Assistant and keep Home Assistant and Music Assistant supported and up to date.

## Network access

The published LAN port exposes guest pages **and unauthenticated host controls**. Anyone who can reach it can manage the listening order, change integration settings, and adjust the selected destination’s volume. Use a trusted LAN. Do not forward this port to the internet.

Home Assistant login protects the Ingress interface only. It does not add authentication to the LAN endpoint. Guest Wi-Fi access rules must account for this access model.

## Credentials and private music

- Music Assistant tokens remain server-side in a permission-restricted file under `/data`; they are **not encrypted at rest**.
- Private selections use separate HttpOnly browser credentials and a private server-side participant binding. A display name is not proof of ownership; another browser cannot select or claim someone else’s list.
- Public display responses omit concealed titles, artists, and artwork until reveal. Other Music Assistant, Home Assistant, and speaker interfaces can independently expose playing metadata.
- Uploaded audio uses protected playback-specific URLs; treat those URLs as secrets.
- Backups contain tokens, private lists, and uploaded files. Protect backups and their encryption keys.
- Cookies, tokens, protected URLs, private lists, and backup archives must not be included in public issues or logs.

## Reporting a vulnerability

Use [GitHub’s private vulnerability report](https://github.com/magnusoverli/aotyassistant/security/advisories/new) for credential disclosure, unauthorized private-list/file access, or other security issues. Include the affected version, prerequisites, and minimal reproduction. Avoid real secrets and other people’s data.

Use ordinary [GitHub issues](https://github.com/magnusoverli/aotyassistant/issues) for non-sensitive bugs. No response-time or support SLA is promised.
