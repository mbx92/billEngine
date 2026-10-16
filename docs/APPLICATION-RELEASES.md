# Application builds and releases

BillEngine treats a source repository, an immutable image release, and a deployed client
instance as separate objects:

- **Application** stores the Git repository and build settings.
- **Release** points to an immutable OCI digest such as
  `ghcr.io/acme/my-app@sha256:...`.
- **Resource** is one client deployment with its own environment, secrets, ports, and volumes.

This means one image is built once and can be deployed to multiple clients. A client that needs
custom source should use a separate application/image repository (or a separate build variant).

BillEngine can also run the build on a dedicated OC Agent. Enroll the Ubuntu node with role
`builder`; the control plane remains responsible only for queueing, status, and release metadata.
The builder clones the configured HTTPS GitHub repository, runs Docker Buildx/BuildKit, pushes the
image to the registered OCI registry, and returns its immutable digest.

## 1. Configure BillEngine

Generate a callback secret and provide it to the BillEngine runtime:

```dotenv
NUXT_RELEASE_WEBHOOK_SECRET=<random-secret>
```

Run the database migration, deploy the new control plane and OC Agent `0.6.0`, then open
**Infrastructure → Applications**.

For a private GHCR package, add a registry with:

- Host: `ghcr.io`
- Username: the GitHub user or organization owner
- Token: a GitHub personal access token (classic) with `read:packages`

Use `write:packages` instead when the registry will receive images from the native builder. A
self-hosted OCI registry or Harbor instance can be used by registering its host and push-capable
credential in the same page. Use a TLS certificate trusted by both builder and deployment nodes;
the agent does not automatically enable Docker's insecure-registry mode.

The token is encrypted at rest. It is delivered to the target agent only for a deployment pull,
passed to `docker login` over stdin, and its temporary Docker config is removed after the pull.

## 2. Configure the application repository

### Native builder

Install OC Agent `0.11.0+` on a separate Ubuntu server, create its enrollment as **Image builder**,
and ensure both `git` and `docker buildx` are available. The node reports the `image-build`
capability after enrollment. From **Infrastructure → Applications**, click **Build image**. Native
builds currently accept public repositories under `https://github.com/...`; private GitHub source
credentials are intentionally not sent until a scoped GitHub App integration is implemented.

Builder workspaces are temporary under `/var/lib/oc-agent/builds`. BuildKit cache and published
layers live in the configured registry. Do not combine the builder role with a production runtime
node unless the node is intentionally enrolled as `hybrid`.

### GitHub Actions callback

Create `.github/workflows/publish-image.yml` in the application repository:

```yaml
name: Publish application image

on:
  push:
    branches: [main]
    tags: ['v*']
  workflow_dispatch:

permissions:
  contents: read
  packages: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - id: image
        name: Resolve image and release names
        shell: bash
        run: |
          image="ghcr.io/${GITHUB_REPOSITORY,,}"
          if [[ "$GITHUB_REF_TYPE" == "tag" ]]; then
            version="$GITHUB_REF_NAME"
          else
            version="sha-${GITHUB_SHA:0:12}"
          fi
          echo "repository=$image" >> "$GITHUB_OUTPUT"
          echo "version=$version" >> "$GITHUB_OUTPUT"

      - id: build
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          push: true
          tags: |
            ${{ steps.image.outputs.repository }}:${{ steps.image.outputs.version }}
            ${{ steps.image.outputs.repository }}:latest
          cache-from: type=registry,ref=${{ steps.image.outputs.repository }}:buildcache
          cache-to: type=registry,ref=${{ steps.image.outputs.repository }}:buildcache,mode=max

      - name: Register release in BillEngine
        env:
          BILLENGINE_URL: ${{ secrets.BILLENGINE_URL }}
          BILLENGINE_RELEASE_SECRET: ${{ secrets.BILLENGINE_RELEASE_SECRET }}
          APPLICATION_SLUG: ${{ vars.BILLENGINE_APPLICATION_SLUG }}
          VERSION: ${{ steps.image.outputs.version }}
          IMAGE_DIGEST: ${{ steps.build.outputs.digest }}
        shell: bash
        run: |
          payload="$(jq -n \
            --arg applicationSlug "$APPLICATION_SLUG" \
            --arg version "$VERSION" \
            --arg commitSha "$GITHUB_SHA" \
            --arg imageDigest "$IMAGE_DIGEST" \
            '{applicationSlug:$applicationSlug,version:$version,commitSha:$commitSha,imageDigest:$imageDigest}')"
          curl --fail-with-body --retry 3 \
            -H "Authorization: Bearer $BILLENGINE_RELEASE_SECRET" \
            -H "Content-Type: application/json" \
            --data "$payload" \
            "$BILLENGINE_URL/api/infrastructure/releases/callback"
```

Add these repository settings in GitHub:

- Secret `BILLENGINE_URL`: public HTTPS URL of the BillEngine control plane.
- Secret `BILLENGINE_RELEASE_SECRET`: the same value as `NUXT_RELEASE_WEBHOOK_SECRET`.
- Variable `BILLENGINE_APPLICATION_SLUG`: the application slug created in BillEngine.

`GITHUB_TOKEN` pushes the image from Actions. It is not reused by BillEngine. BillEngine uses the
separate read-only registry credential configured in its Applications page.

## 3. Release behavior

After a successful push, the callback records the exact digest. It never deploys from `latest`.
From the Applications page you can:

- create a deployment template connected to the application;
- manually roll a release out to one or more client resources;
- enable **Track release berikutnya** for selected resources;
- enable **Auto deploy tracked resources** on the application so future callbacks queue redeploys.

An application template stores the runtime profile (CPU, memory, container port, healthcheck,
volume, environment keys, and secret keys), not a mutable image tag. Each time it is deployed,
BillEngine resolves the application's newest release and stores that release ID on the new client
resource. If **Track release berikutnya** is enabled, the resource remains connected to the
application for later rollouts.

The resulting relationship is:

```text
Application -> immutable Release -> Deployment Template -> Client Resource
```

The agent pulls the new image before removing the currently running container. If the pull fails,
the existing container remains running. Persistent named volumes are reused during replacement.
