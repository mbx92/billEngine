# Cloudflare Tunnel management

The **Infrastructure → Tunnels** page lists account-scoped Cloudflare Tunnels and manages ingress
routes for remotely managed tunnels.

## Required configuration

```bash
NUXT_CLOUDFLARE_API_TOKEN='<account-scoped token>'
NUXT_CLOUDFLARE_ACCOUNT_ID='<account id>'
```

The token needs **Cloudflare Tunnel Read** to list tunnels and configurations. Add **Cloudflare
Tunnel Write** to create, update, or remove ingress routes. Keep the token server-side and never use
the `NUXT_PUBLIC_` prefix.

Locally managed tunnels are shown as read-only because their ingress configuration belongs to the
`cloudflared` YAML file on the origin host.

## Route safety

- BillEngine fetches the latest remote configuration immediately before every mutation.
- Unknown Cloudflare configuration fields and existing per-route origin settings are preserved.
- A route is identified by its hostname and optional path.
- The final catch-all rule is preserved and cannot be edited or deleted from BillEngine.
- Changes are written to the audit log.
- Tunnel tokens and connector credentials are never requested or returned to the browser.

The page changes Tunnel ingress only. DNS remains explicit: point each public hostname to the
displayed `<tunnel-uuid>.cfargotunnel.com` target, normally as a proxied CNAME in Cloudflare DNS.

## Routing through the agent gateway

The intended request path is:

```text
Browser → Cloudflare HTTPS → Tunnel → cloudflared → Traefik oc-gateway:80 → application container
```

The agent creates Traefik routers on the HTTP `web` entrypoint (port 80), with a `Host(...)`
rule matching the application's public hostname. It writes the dynamic configuration to
`/var/lib/oc-agent/gateway/dynamic` and attaches the gateway to the deployment's Docker network.
Traefik then forwards to the application's container name and internal port. For billable
resources, the route can also use the billing gate's ForwardAuth middleware.

Choose the tunnel's origin from the point of view of the `cloudflared` process:

- On the same host as the gateway: `http://localhost:80`.
- In Docker on the same network as `oc-gateway`: `http://oc-gateway:80`.
- On a different host: `http://<reachable-node-address>:80`, provided that connector can reach
  the node over the private network. Use a configured HTTPS origin if that hop requires TLS.

`localhost` inside a normal Docker container refers to that container, not the Docker host.
Keep **HTTP Host Header** empty so the original public hostname reaches Traefik. A fixed
override can break hostname routing, especially for wildcard tunnel rules.

Keep **No TLS Verify** off for the default HTTP origin. Although the gateway publishes port
443, the generated application routes do not currently configure a TLS router there. Pointing
the tunnel at `https://localhost:443` does not activate HTTPS routing. Public HTTPS is served
by Cloudflare and the Cloudflare-to-connector tunnel is encrypted; the connector-to-origin hop
uses the protocol specified in the origin URL.

Exact routes should remain above wildcard routes, with the catch-all response last. The DNS
record, tunnel ingress and Traefik hostname rule must all agree. With multiple nodes, each
hostname must reach the node hosting its application; a wildcard route to one node does not
automatically discover applications on other nodes.

## Application Domain tab

The application's **Domain & tunnel** tab reads that deployment's `resource_routes` and uses
`APP_URL` only as an explicitly labelled hint. It compares hostnames with remote tunnel ingress
in configured order, including wildcard and path rules. Exact DNS records are read from the
configured Cloudflare zone when the token has DNS Read access. A matching ingress rule is not
proof that DNS selects that tunnel or that its origin is reachable. Wildcard DNS, other zones,
and locally managed ingress are reported as unverified.

**Hubungkan domain** selects a remotely managed tunnel, an explicit gateway origin as seen by
cloudflared, and a registered TCP container port. It saves the application route and queues
`route.configure` for the agent. It requires a running, synchronized deployment and a healthy
gateway, and preserves billing-gate enforcement. Existing routes owned by another deployment,
conflicting origins, and conflicting path rules are rejected. Exact hostname routes are placed
before wildcard rules. BillEngine serializes its tunnel configuration writes per tunnel.

DNS is deliberately separate: the form and success message show the proxied CNAME target to
configure. Existing DNS and old tunnel routes are not changed. Multiple domains can belong to
one deployment; resource lists continue to show it once, using its oldest route as the primary.

Cloudflare changes and the local database are separate systems. If the remote update succeeds
but the local transaction fails, reload and reconnect using the same values; the identical
existing route can be reused. The UI does not claim end-to-end availability from tunnel status.
