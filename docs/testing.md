# Testing and validation

The test suites cover application behaviour with isolated services and disposable data. Installed-system validation covers Home Assistant, browser, network, and speaker behaviour that cannot be established by fixtures alone.

## Automated coverage

| Check | Coverage |
| --- | --- |
| Release metadata and documentation | Consistent package, image, and manifest versions; changelog entries; local documentation links; shutdown allowance |
| Typecheck and production build | Backend/browser TypeScript and packaged browser assets |
| Backend/controller tests | Turns, private-list access, persistence, uploads, connection identity, playback ownership, recovery, and compatibility handling |
| Chromium workflows | Host, participant, settings, and display interactions against isolated Music Assistant fixtures |
| Native amd64/aarch64 package tests | Packaged audio analysis, file permissions, automatic list persistence across restarts, and backup restore |
| Dependency audit | Known vulnerabilities reported for the locked dependency tree at the time of the check |
| Published-image verification | Anonymous registry access, both architectures, content digests, and version/license labels |

Commands are documented in [CONTRIBUTING.md](../CONTRIBUTING.md#verify-a-change). CI results are available in [GitHub Actions](https://github.com/magnusoverli/aotyassistant/actions). The image-publishing workflow requires the shared application checks and package tests to pass before publishing images.

## Installed-system validation

Record the app version, Home Assistant Core/Supervisor versions, Music Assistant version/schema, host architecture, browser/device, and player integration with each validation result.

### Installation, updates, and data

- Install through the Home Assistant app store and check startup, Ingress, guest links, discovery, and speaker status.
- Update an existing installation and verify retained room membership/order, settings, private lists, and uploaded files.
- Create and restore a Home Assistant backup, including recovery on a replacement host with a different address.
- Confirm restart clears playback/reveal without automatically starting music.

### Playback

Use a designated test speaker or group: Play replaces its current queue and can interrupt existing audio.

- Confirm the exact selected catalogue recording and uploaded audio play on the chosen destination.
- Check single-track queue behaviour, reveal, speaker/group volume, and explicit turn advancement.
- Check ordinary and long-paused resume, natural completion, external takeover, connection loss, and explicit recovery.
- Confirm natural completion advances exactly once and does not start the next participant’s song.

### Browsers and devices

- Check iPhone/Safari and Android joining, automatic empty lists, same-browser list persistence, file selection, large/interrupted uploads, and mobile keyboards.
- Check Music Assistant sign-in inside the Home Assistant companion app.
- Check shared-display layout, full-screen controls, and reconnection on the intended TV/browser.

## Coverage limitations

Chromium is the automated browser baseline. Synthetic Music Assistant tests do not establish audible playback, physical-speaker timing, or compatibility with every player integration. Packaged backup tests do not establish a successful restore through Supervisor on every supported host.

Complete physical-device coverage across these scenarios has not been established. Published compatibility claims must identify the tested configuration and distinguish successful checks from unsupported or untested combinations. Playback support remains restricted to [Music Assistant API schema 65](music-assistant.md#supported-api).
