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

For the Coolify proxy topology documented in `BILLING-GATE.md`, use
`https://localhost:443` as the origin and enable **No TLS Verify**. Exact routes should remain above
the wildcard route, while the catch-all response stays last.
