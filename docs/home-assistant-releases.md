# Publishing Home Assistant images

The **Publish Home Assistant images** workflow builds amd64 and aarch64 images, publishes their versioned multi-architecture manifest to GHCR, and emits a store manifest. It uses GitHub's short-lived package token.

1. Set the intended version in `config.yaml`, `package.json` and the lockfile; update the changelog and merge tested changes.
2. Run **Actions → Publish Home Assistant images → Run workflow**, or push a matching `v<version>` tag. Checks run before both architectures are published.
3. Make `ghcr.io/magnusoverli/aotyassistant` **public** on first publication and confirm an unauthenticated pull works.
4. Download the **published-store-manifest** artifact. Replace root `config.yaml` with its `config.prebuilt.yaml` contents and commit/push. The `image` reference is enabled only after the image is available.
5. Check for updates in HA's app store and test the release on HAOS.

Version **0.2.2** is published publicly for amd64 and aarch64; its anonymous pull was verified and the root manifest now uses that image. For subsequent releases, build/tag a release branch, publish the image, then merge the store version update. Do not advertise missing/private images or overwrite released version tags. To build a local development checkout on HA, remove its `image` line.

The Node 24/Alpine Dockerfile is shared by source and prebuilt installations and includes HA/OCI labels. The workflow does not restart deployed installations. Regenerate `icon.png` from `icon.svg` with `npx tsx scripts/generate-addon-icon.ts`.
