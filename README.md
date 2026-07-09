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
- Proxies `/api/*` and `/v1/*` to `https://max-omni.mind-aku.my.id`.
- Listens on `http://127.0.0.1:20128` by default.

## Run locally

```bash
npm start
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
