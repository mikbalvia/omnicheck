# Mind Aku Check

Static mirror of the Mind Aku API portal page.

The portal is available at:

- `/`

Legal/support pages are available at:

- `/faq`
- `/refund-policy`
- `/terms-and-conditions`
- `/kontak`

This repository includes a small Node.js server for Cloudflare Tunnel:

- Serves the static portal files.
- Proxies `/api/*` and `/v1/*` to my9router (default `http://127.0.0.1:20127`).
- Listens on `http://127.0.0.1:20128` by default.

## Payment mode (dynamic)

Set via environment variables (see `.env.example`):

| `PAYMENT_GATEWAY_ENABLED` | Behavior |
|---------------------------|----------|
| `false` (default) | Pembayaran langsung via iPaymu; callback ke domain omnicheck (`/api/topup/ipaymu/callback` proxied ke my9router) |
| `true` | Pembayaran via `ipaymu-gateway` di domain whitelist |

When gateway is enabled, also set:

- `PAYMENT_GATEWAY_URL` — public URL of ipaymu-gateway
- `PAYMENT_GATEWAY_SECRET` — shared secret (same as `GATEWAY_API_SECRET` / `OMNIROUTE_PAYMENT_GATEWAY_SECRET`)

omnicheck injects these settings into proxied API requests so my9router picks the correct payment path per request.

## Run locally

Start my9router first:

```bash
cd ../my9router
npm run dev
```

Then start the portal proxy:

```bash
npm run dev
```

Health check:

```bash
curl http://127.0.0.1:20128/healthz
```

## Cloudflare Tunnel

Point the tunnel public hostname `max-omni.mind-aku.my.id` to:

```text
http://127.0.0.1:20128
```
