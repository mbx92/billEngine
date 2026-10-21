# Application builds and releases

BillEngine treats a source repository, an immutable image release, and a deployed client
instance as separate objects:

- **Application** stores the Git repository and build settings.
- **Release** points to an immutable local Docker image ID (`sha256:...`) or an OCI registry
  digest such as `registry.example.com/acme/my-app@sha256:...`.
- **Resource** is one client deployment with its own environment, secrets, ports, and volumes.

This means one image is built once and can be deployed to multiple clients. A client that needs
custom source should use a separate application/image repository (or a separate build variant).

BillEngine can also run the build on a dedicated OC Agent. Enroll the Ubuntu node with role
`builder`; the control plane remains responsible only for queueing, status, and release metadata.
The builder clones the configured HTTPS GitHub repository and runs Docker Buildx/BuildKit.
New applications default to **Local image**: the hybrid node loads the result into its own Docker
image store, without logging in to or pushing to a registry. Registry storage remains optional.

## Local image: repository to deployment without a registry

1. Apply the database migrations and install OC Agent **0.12.6+** on the target server.
   Set its mode to **Hybrid** and install Git and Docker Buildx. Its next heartbeat reports
   `local-image-build`; older agents cannot execute local builds or deployments.
   Build the agent artifacts and set `NUXT_AGENT_RELEASE_VERSION=0.12.11` before using remote upgrade.
2. Open **Applications → Application**, enter the public HTTPS GitHub repository, select
   **Local image**, and choose the hybrid server. Registry credentials are not required.
3. Click **Build image**. The agent clones the configured branch and runs
   `docker buildx build --builder default --load`. Build cache stays on the server.
4. On success, BillEngine records a release using the inspected Docker image ID and origin node.
   The build also leaves an `oc-local/<application-slug>:<build-id>` tag in Docker so older
   releases remain available for rollback while their images are retained.
5. Click **Buat template**, configure the runtime port, environment, and secrets, then deploy
   the template from **Templates**. The server selector only offers the release's origin server.
   Select **Port server** for direct LAN access and enter a free host port, e.g. `18080` mapped
   to container port `3000`. Set `APP_URL` to `http://<server-ip>:18080` for Serene Book.
   Port access does not require a platform domain, gateway, DNS, or tunnel and is available for
   internal/ignored resources. Select **Domain** when a gateway and billing gate are needed.

Local deployment inspects the exact image ID before replacing an existing container and uses
`--pull=never`. Missing images fail with `local_image_missing`; the running container is preserved.
Manual rollout, automatic tracked-resource rollout, template deployment, and direct resource APIs
enforce origin-node placement. Multiple client resources can share an image on that server.
External CI callbacks and manual release registration apply only to registry applications.

Local mode removes the image-publishing dependency, not source/build dependencies: cloning still
contacts GitHub, and Dockerfiles may download base images and packages. Images are not replicated
to other servers. Keep local release images when pruning Docker; a deleted image must be rebuilt.

For example, `mbx92/serene-book` uses branch `main`, Dockerfile `Dockerfile`, build context `.`,
and runtime port `3000`. Its startup also needs `APP_URL`, `SESSION_SECRET`, `DATABASE_URL`,
and first-run owner bootstrap settings. PostgreSQL is a separate resource; database allocation
injects `DATABASE_URL` when the application is connected to an eligible service.

Select **Environment variable** delivery for apps such as Serene Book that read `SESSION_SECRET`
and `DATABASE_URL` directly. Agent 0.12.0+ passes secrets through a temporary host-only `0600`
env file, removes it after the operation, and never includes values in command arguments.
These values become container environment variables (visible to Docker administrators).
Environment delivery accepts single-line values; use **Secret file** delivery for multiline
secrets or images that implement the `*_FILE` convention. Existing templates retain file delivery.

The remaining registry and external CI instructions are optional for multi-server distribution.

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
