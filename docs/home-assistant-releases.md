# Publishing Home Assistant releases

The store follows `main`. The published app is `ghcr.io/magnusoverli/aotyassistant`, with a versioned multi-architecture image for **amd64** and **aarch64**. GitHub Actions uses its short-lived package token; no long-lived registry credential is needed.

## Release

Complete the intended changes and their **Unreleased** changelog entries. Review [testing and validation](testing.md), including upgrade compatibility and physical-device coverage. Then, from `main`:

```sh
npm run release -- <version> "<short summary>"
```

The command:

1. Typechecks and builds, then creates `release/<version>`. It sets the version in `config.yaml`, `package.json`, the lockfile and `Dockerfile`, and moves the **Unreleased** entries under a dated heading.
2. Runs `npm run check:release`, commits as `Release <version>: <summary>`, pushes the branch and waits for **Application checks**. These include the unit/integration suite and native amd64/aarch64 packaged-app tests.
3. If the checks pass, pushes the annotated `v<version>` tag and waits for **Publish Home Assistant images**. If they fail, fix the problem on the release branch, commit, and run the same command again: it continues from the branch, and no version number is used up.

The publish workflow runs the application checks again, alongside native amd64 and aarch64 image builds. Only when both pass does it do the following:

- publish and verify the multi-architecture image (anonymous manifest, configuration and layer access, architecture labels, version metadata);
- fast-forward `main` to the tag, so the store offers the version only once its image is available;
- write the GitHub release from the changelog section and mark it latest. Missing releases for earlier versions are filled in.

Playwright is opt-in and skipped, including for releases. Keep the repository’s GitHub About description aligned with the short description in `package.json`.

Use semantic versions: patches for compatible fixes, minor versions for compatible features, major versions for incompatible contracts. Describe required user action and data migrations explicitly in the changelog; it becomes the release notes. Never overwrite a released Git tag or image version.

For first publication, the GHCR package must be public. The anonymous check intentionally fails while it is private; make it public and rerun the failed publication job. If publication fails, the store stays on the previous version; repair and rerun the workflow. If a published image needs code changes, use a new version rather than replacing its contents.

## Installed-app acceptance

Refresh the Home Assistant store, update a backed-up installation, and record the app/HA/MA versions, architecture, and player integration. Check startup, Ingress, guest links, connection/speaker status, retained room/lists/uploads, and backup/restore.

Physical speaker tests involve real audio and queue replacement. Run them on the intended test destination, recording exact-recording playback, reveal, pause/resume, natural completion, takeover, and recovery. Automated synthetic checks do not establish those results.

Keep the previous backup and version until acceptance completes. Rollback means restoring matching data and app versions through Home Assistant, not deleting configuration or replacing data files by hand.
