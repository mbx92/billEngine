# Billing access gate

The billing gate keeps a Coolify application running during its overdue grace
period. Browser navigations see an interstitial once per configured interval,
while API, webhook, and asset requests continue normally. After grace expires,
browser navigations are redirected to the overdue page and non-browser requests
receive `402 Payment Required`.

The gate does not stop Coolify resources. This is intentional: stopping an
application can also remove its generated Traefik route, which would produce a
proxy error instead of the billing page.

## Runtime configuration

Generate two independent random values and configure them on the billing app:

```bash
NUXT_BILLING_GATE_SECRET='<random value>'
NUXT_BILLING_GATE_SHARED_KEY='<different random value>'
NUXT_PUBLIC_APP_URL='https://billing.example.com'
NUXT_BILLING_GATE_INTERNAL_URL='http://host.docker.internal:8010/api/billing-gate/check'
```

Enable **Billing access gateway** from Settings only after the middleware below is
reachable and tested. Grace length and acknowledgement interval are configured
on the same page.

## Traefik middleware

On each Coolify server, create a dynamic configuration named
`billing-gate.yaml`. The billing application must be reachable from Traefik at
the configured address. Replace both example values.

```yaml
http:
  middlewares:
    billing-gate-key:
      headers:
        customRequestHeaders:
          X-Billing-Gate-Key: '<NUXT_BILLING_GATE_SHARED_KEY>'
    billing-gate-forward:
      forwardAuth:
        address: 'http://billengine:3000/api/billing-gate/check'
    billing-gate-key-clear:
      headers:
        customRequestHeaders:
          X-Billing-Gate-Key: ''
    billing-gate:
      chain:
        middlewares:
          - billing-gate-key
          - billing-gate-forward
          - billing-gate-key-clear
```

Attach `billing-gate@file` to the existing HTTPS router of each billable
application. Preserve every middleware already on that router. Per-application
installation rejects the billing application's own domain. The final middleware removes the shared key before
the request reaches the customer application.

For a standard Coolify application, update Container Labels through BillEngine
or Coolify, preserve the generated labels, and redeploy once. Test on one
non-critical application before rolling it out broadly.

BillEngine can now attach the `billing-gate@file` reference to existing routers
through the Coolify API. Alternatively, use the per-server entrypoint configuration
below to support Compose without editing application labels. BillEngine never
triggers a deploy or proxy restart, and the middleware YAML is installed manually.
Synchronize Resources after changing domains.
Host ownership comes from Coolify's synced FQDN and Compose domain values;
legacy BillEngine-managed domain records are no longer routing authority.

## Configure from BillEngine

1. In **Settings → Koneksi proxy billing gateway**, save the check URL reachable
   from the Coolify proxy. Expand **Konfigurasi manual billing-gate.yaml**, copy
   the YAML, replace its shared-key placeholder, and install it manually on each
   server under **Proxy → Dynamic Configurations**. Saving this URL only updates
   the template; existing proxy files must be updated manually too.
2. Sync **Resources**, classify the application as **Billable**, and link it to a
   service. Every application domain must have an unambiguous billing owner.
3. Open **Resources → Konfigurasi gate**. Review the middleware changes, confirm
   the file is installed, then select **Simpan ke Coolify**. Existing labels and
   middleware order are retained. If Coolify changed since the preview, reload
   before saving. Keep Coolify edits separate while this operation is running:
   its API does not offer an atomic compare-and-swap for labels.
4. Redeploy the application in Coolify. Saving labels does not deploy or restart
   anything. Coolify label management becomes manual, so subsequent domain or
   routing changes need corresponding label updates in Coolify.
5. Select **Periksa gate**. BillEngine sends a random probe to each public domain
   without credentials and without following redirects. An authenticated gate
   answers with HTTP 418 and a proof signed for that nonce and host. A normal app
   response cannot be mistaken for a working gate. Deploy this BillEngine version
   as well as the protected app before verifying. A verified connection and the
   gateway enabled setting are reported separately.

Automatic application label changes support non-Compose Traefik applications.
Docker Compose uses the per-server flow below and can be verified directly from
its resource dialog. Caddy, absent/duplicate labels, and routers for hosts outside
the application's domain list are rejected by the application label editor. The
BillEngine hostname itself is never accepted as a target. All management APIs
require admin access; credential values are not returned by these APIs. Only
router middleware changes are shown in the preview, not the full label set.

Gateway configuration and verification metadata use the existing settings table;
no new database migration is needed. The timestamp is the last successful check,
not continuous monitoring. If a save fails after Coolify accepted the update,
reload the preview to reconcile the actual labels before retrying.

## Per-server gate (including Docker Compose)

This attaches `billing-gate@file` to the chosen Traefik entrypoints. All HTTP
routers on those entrypoints pass through the gate, regardless of application
build pack. No application Compose changes or application redeploy are needed.
TCP/UDP routers and traffic that bypasses this proxy are not protected.

1. Use a Coolify version with `GET /api/v1/servers/{uuid}/proxy` and
   `PUT /api/v1/servers/{uuid}/proxy/configuration`. The token needs
   `read:sensitive`, `write`, and `deploy`; its user must be a team admin/owner.
   Even though the API requires `deploy`, BillEngine does not call restart.
2. If the configuration is missing, open **Coolify → server → Proxy →
   Configuration** and save the existing configuration. The API only returns a
   previously saved database copy; it does not fetch the file from the host.
3. In **BillEngine → Servers**, select **Gate proxy** on the actual application
   node, not the control-plane connection. Configure a direct internal URL such
   as `http://host.docker.internal:8010/api/billing-gate/check` or
   `http://billengine:3000/api/billing-gate/check`. The network/DNS/port must be
   reachable from the proxy container. `localhost` refers to that container.
4. Expand the YAML template in the dialog. Install `billing-gate.yaml` manually
   on that node with exactly that URL and the shared key from BillEngine. The
   dialog does not write or inspect the dynamic middleware file.
5. Select application entrypoints, normally `http` and `https`, then **Pratinjau**.
   Existing middleware is retained. Review the scope, confirm the file and direct
   route, then **Simpan konfigurasi proxy**. The preview includes middleware flags
   and, when necessary, healthcheck isolation described below. The full YAML is
   not sent to the browser or stored in audit metadata.
6. Restart the proxy manually in Coolify. This can briefly interrupt traffic to
   all applications on the node. **Resources → Konfigurasi gate → Periksa gate**
   verifies the deployed path for Compose as well as other applications. The
   saved timestamp alone does not indicate that the proxy has restarted.

### Proxy healthcheck isolation

Coolify's default Traefik healthcheck calls `http://localhost:80/ping`, with
`--ping.entrypoint=http`. An entrypoint middleware also applies to `ping@internal`.
Adding the gate to HTTP can therefore make Docker report the proxy as unhealthy
when the middleware is missing or BillEngine cannot answer the check.

When HTTP is selected, BillEngine moves this standard ping/healthcheck pair to a
dedicated `billengine-health` entrypoint bound to `127.0.0.1:9082` inside the
container (or the next unused listener port up to 9091). It changes the healthcheck
URL to match, preserving its timing and retries. No host port is published. The
listener is excluded from gate selection. The preview shows these changes even
if HTTP already has the gate. Custom healthcheck formats are rejected with manual
configuration instructions. Removing the gate keeps the independent healthcheck.

If the proxy is already unhealthy after applying the old configuration, reload
BillEngine, open **Servers → Gate proxy**, preview and save again, then restart
the proxy in Coolify. For immediate recovery, remove only `billing-gate@file`
from HTTP/HTTPS entrypoint middleware lists in Coolify and restart. Preserve other
middleware references. A healthy proxy still does not prove the application gate
works: use **Resources → Konfigurasi gate → Periksa gate** afterwards. If unhealthy
persists, inspect **Coolify → server → Proxy → Logs** and Docker's health output.

Never use a check URL that routes through a gated entrypoint: it causes recursive
forward-auth calls. The editor rejects public domain URLs, loopback addresses,
the proxy container name, and known proxy listener/published ports. It accepts
private IPs, direct container names, and `host.docker.internal` on other ports.
These static checks cannot prove the actual network topology: verify reachability
and the dynamic YAML URL before saving. Custom aliases/port forwarding can still
route back through a proxy. BillEngine's own public hostname is explicitly exempt
from billing restrictions, but this exemption does not solve a forward-auth loop.

All traffic on selected entrypoints depends on BillEngine being available, even
for unlinked/internal/ignored hosts that normally pass. Disabling billing access
in Settings bypasses billing rules while BillEngine is reachable; it does not
remove the proxy's dependency on it. Use this mode only on nodes where that shared
dependency is acceptable. The control-plane dashboard may also share an entrypoint.

To remove the entrypoint gate, clear the choices, preview and save, then restart
the proxy in Coolify. This removes only `billing-gate@file` from entrypoints; any
per-application gate labels remain. If BillEngine is unavailable, remove that
reference manually in **Coolify → Proxy → Configuration**, then restart there.
Keep an independent route to the Coolify dashboard for recovery.

The editor supports a single Traefik service with an explicit image and command
argument list. YAML aliases/custom tags, duplicate flags, configFile-based or
environment-based entrypoint configuration are rejected instead of guessed.
Changes made in Coolify after a preview require a fresh preview. Coolify does not
provide an atomic conditional write, so avoid concurrent proxy edits while saving.

## Cloudflare Tunnel and verification failures

The application's public hostname must reach the gated Traefik entrypoint.
A Tunnel service such as `http://localhost:3088` pointing at a published app port
bypasses Traefik and therefore bypasses the billing gate. Change that hostname's
Tunnel service to the proxy: for a cloudflared process on the same host, normally
`http://localhost:80`; for a container on the proxy's Docker network, normally
`http://coolify-proxy:80`. In a separate bridge container, `localhost` is that
container, not the host. Preserve the application's original Host header, or set
the Tunnel's HTTP Host Header to that application domain so Traefik selects the
correct router. Keep the forwardAuth URL pointed directly at BillEngine.

If HTTP-to-HTTPS redirection creates a loop behind the Tunnel, configure the
Tunnel to use the proxy's HTTPS listener with the correct origin server name and
valid certificate, or adjust redirect handling in Coolify for that topology.
Do not disable TLS verification to hide a certificate error. Once the routed
domain works, prevent public access to any direct app port that could bypass it.

**Periksa gate** now reports the HTTP status and failure category per domain.
HTTP 200 without signed proof commonly means the request reached the app without
the gate, but may also indicate filtering or an outdated BillEngine instance.
Redirects, DNS/TLS errors, timeouts, auth rejection, proxy errors, and invalid
signatures have separate messages. The verifier never follows redirects, sends
no secret to the app, and does not return response bodies or raw network errors.

## Service lifecycle

With the gateway enabled and attached to the application's router or entrypoint:

- Active service with no overdue balance: allow access.
- Overdue within grace: show periodic notices for browser navigation.
- Overdue after grace: show a notice for browsers and return HTTP 402 for APIs.
- Suspended or cancelled service: show a service-status notice for browsers and
  return HTTP 403 for APIs, even without an invoice. Grace cookies cannot bypass it.
- Payment clears invoice restrictions on the next check. Manual suspension still
  requires manual reactivation; cancellation cannot be reversed.

The gateway does not start or stop containers. Disabling the gateway in Settings
bypasses all these access restrictions. Unlinked, internal, ignored, or ambiguous hosts are allowed;
ensure each protected hostname belongs to exactly one current service. When a
resource is reassigned after cancellation, its new service determines access.
A cancelled service retains its restriction until the resource is reassigned or
its billing mapping is deleted.

## Cloudflare Tunnel on the Coolify host

When `cloudflared` publishes an application port directly, for example
`http://localhost:8009`, the request bypasses Traefik and the billing middleware
will not run. Point the protected hostname at the local Traefik HTTPS listener
instead:

```text
https://localhost:443
```

For this test topology, enable **No TLS Verify** in the tunnel origin settings
because the certificate is issued for the public hostname rather than
`localhost`. Keep the billing hostname pointed directly at its published app
port (`http://localhost:8010`) so the overdue page itself is never gated.

The test deployment publishes BillEngine on host port `8010`. Traefik reaches
the gate through `http://host.docker.internal:8010`; the Coolify proxy already
maps `host.docker.internal` to the host gateway. Before changing the tunnel,
verify that both applications are healthy and that the protected application's
generated labels include the `opswiki-billing-gate` middleware chain.

To roll back immediately, restore the protected hostname origin to its direct
application port (for OpsWiki, `http://localhost:8009`). Then switch the
application back to its production branch and redeploy.

## Local development test

1. Start PostgreSQL, migrate, seed, and run Nuxt as described in the README.
2. Configure the two gate secrets in `.env` and enable the gate in Settings.
3. Create an invoice for seeded service `SVC-000001`, use a due date in the
   past, issue it, then select **Mark overdue**.
4. Simulate Traefik with curl (replace the shared key):

```bash
curl -i 'http://localhost:3000/api/billing-gate/check' \
  -H 'X-Billing-Gate-Key: <shared key>' \
  -H 'X-Forwarded-Host: customer-app.localhost' \
  -H 'X-Forwarded-Proto: http' \
  -H 'X-Forwarded-Uri: /dashboard' \
  -H 'Accept: text/html'
```

The response is `302` during grace and after grace. Open its `Location` value
in a browser. During grace the page has a **Lanjutkan ke layanan** action; after
grace it does not. A request with `Accept: application/json` is allowed during
grace and returns `402` after grace.

Automated policy and token tests run with:

```bash
npm test -- tests/unit/billing-access-policy.test.ts tests/unit/billing-access-control.test.ts
```

## Domain and infrastructure ownership

Configure domains and SSL in Coolify, and DNS/tunnel settings in the provider's
console. Then synchronize Resources in BillEngine. There is no domain creation,
Cloudflare mutation, or instant-deploy action in the billing application.

Production always evaluates real billing data. `BILLING_GATE_TEST_HOST` and
`BILLING_GATE_TEST_STATE` are ignored when `NODE_ENV=production` and are not
included in the Coolify Compose deployment.
