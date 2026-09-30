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
```

Enable **Overdue access gate** from Settings only after the middleware below is
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
application. Preserve every middleware already on that router. Do not attach
the gate to the billing application's own domain, otherwise its overdue page
would cause a redirect loop. The final middleware removes the shared key before
the request reaches the customer application.

For a standard Coolify application this currently requires editing Container
Labels, preserving the generated labels, and redeploying once. Test on one
non-critical application before rolling it out broadly.

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

The test branches use the external `coolify` network and the
`billengine-gate` alias for forward-auth traffic. Before changing the tunnel,
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
