# Publishing Home Assistant releases

The store follows `main`. The published app is `ghcr.io/magnusoverli/aotyassistant`, with a versioned multi-architecture image for **amd64** and **aarch64**. GitHub Actions uses its short-lived package token; no long-lived registry credential is needed.

## Prepare

1. Complete the intended changes and their **Unreleased** changelog entries. Review [testing and validation](testing.md), including upgrade compatibility and physical-device coverage.
2. Create `release/<version>`. Set the same version in `config.yaml`, `package.json`, the lockfile, and `Dockerfile`.
3. When publication is scheduled, move the completed changelog entries under a dated release heading. Keep an empty **Unreleased** section.
4. Run the [contributor checks](../CONTRIBUTING.md#verify-a-change), including `npm run check:release`. Commit and push the release branch.

Use semantic versions: patches for compatible fixes, minor versions for compatible features, major versions for incompatible contracts. Describe required user action and data migrations explicitly. Never overwrite a released Git tag or image version.

## Publish and verify

1. Push the matching annotated `v<version>` tag. **Publish Home Assistant images** runs the shared application checks, Chromium workflows, and native amd64/aarch64 packaged-app tests before building/pushing release images.
2. Wait for both architecture builds and the combined manifest. The workflow verifies anonymous manifest/configuration/layer access, architecture labels, and version metadata before emitting **published-store-manifest**.
3. For first publication, the GHCR package must be public. The anonymous check intentionally fails while it is private; make it public and rerun the failed publication job.
4. Download **published-store-manifest**, compare `config.prebuilt.yaml` with the release branch’s manifest, and apply any required difference. The image reference and version must match the published image.
5. Only after successful publication and verification, fast-forward or merge the release branch into `main` and push. This makes the new store version visible after its image is available.
6. Create a GitHub release from the existing tag with user-facing highlights, upgrade notes, supported architectures, and accurate verification results. Mark it latest when it is the current stable version.

If publication fails, leave the store on the previous version and repair/rerun the workflow. If a published image needs code changes, use a new version rather than replacing its contents.

## Installed-app acceptance

Refresh the Home Assistant store, update a backed-up installation, and record the app/HA/MA versions, architecture, and player integration. Check startup, Ingress, guest links, connection/speaker status, retained room/lists/uploads, and backup/restore.

Physical speaker tests involve real audio and queue replacement. Run them on the intended test destination, recording exact-recording playback, reveal, pause/resume, natural completion, takeover, and recovery. Automated synthetic checks do not establish those results.

Keep the previous backup and version until acceptance completes. Rollback means restoring matching data and app versions through Home Assistant, not deleting configuration or replacing data files by hand.
