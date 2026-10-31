# nginx & TLS

nginx is the edge: it terminates TLS, **restricts the admin surface by IP**, and
reverse-proxies the static React app and the Node API. A starting config lives at
[`deploy/nginx.conf.example`](../../deploy/nginx.conf.example).

## Security model

- **Parent portal + parent API** (`/`, `/api/`) — public.
- **Admin UI + admin API** (`/admin/`, `/api/admin/`) — **IP-restricted at nginx**,
  plus an app-level allowlist (`ADMIN_IP_ALLOWLIST`) as defense-in-depth. This
  replaces the legacy "/admin open to any IP" behavior.

Run the private API on loopback with `TRUST_PROXY=true`. Only the immediate loopback
nginx hop is trusted; it must overwrite `X-Forwarded-For` with **one resolved client
address**, not append a forwarding chain. See [HTTP security](http-security.md).
This example is not the AL1 root-preview selector; actual routing remains unverified.

## Base reverse proxy

Serve the built React app (`web/dist`) as static files and proxy the API:

```nginx
upstream api { server 127.0.0.1:3001; }

server {
  server_name enrollment.example.org;

  proxy_set_header Host              $host;
  proxy_set_header X-Real-IP         $remote_addr;
  proxy_set_header X-Forwarded-For   $remote_addr;
  proxy_set_header X-Forwarded-Proto $scheme;
  add_header Referrer-Policy "no-referrer" always;
  add_header Cache-Control "no-store" always;
  add_header X-Content-Type-Options nosniff always;

  # --- ADMIN: IP-restricted ---
  location /api/admin/ {
    allow 203.0.113.0/24;   # office network
    allow 198.51.100.7;     # a specific admin
    deny all;
    proxy_pass http://api;
  }
  location /admin/ {
    allow 203.0.113.0/24;
    allow 198.51.100.7;
    deny all;
    root /opt/renaissance-academy/web/dist;
    try_files $uri /index.html;   # SPA fallback
  }

  # --- PUBLIC ---
  location /api/ { proxy_pass http://api; }
  location / {
    root /opt/renaissance-academy/web/dist;
    try_files $uri /index.html;   # SPA fallback
  }
}
```

> The React app is a single-page app: `try_files ... /index.html` makes deep links
> like `/admin/roster` load correctly.

If nginx itself is behind another proxy, configure `set_real_ip_from` only for
explicit approved upstream hosts and `real_ip_header X-Forwarded-For` so the resolved
client IP is used for allow/deny. Never trust arbitrary private networks. Restrict
exact `/admin` and `/api/admin` as well as their nested paths; the managed host template
in [HOST_SETUP.md](../../infrastructure/HOST_SETUP.md) does this. Do not deploy this
illustrative snippet without complete edge/TLS/admin/routing review.

## TLS with Let's Encrypt (certbot)

Use Let's Encrypt for the approved deployment hostname (examples use `enrollment.example.org`).

```bash
# Debian/Ubuntu
sudo apt install certbot python3-certbot-nginx

# Obtain + install the cert and auto-edit nginx for HTTPS + HTTP→HTTPS redirect
sudo certbot --nginx -d enrollment.example.org
```

certbot adds the TLS `listen 443 ssl` block, the `ssl_certificate` /
`ssl_certificate_key` lines, and an HTTP→HTTPS redirect. After it runs, your
server block looks roughly like:

```nginx
server {
  listen 443 ssl;
  server_name enrollment.example.org;

  ssl_certificate     /etc/letsencrypt/live/enrollment.example.org/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/enrollment.example.org/privkey.pem;
  include             /etc/letsencrypt/options-ssl-nginx.conf;
  ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

  # ... the location blocks from above ...
}

server {                       # certbot-managed redirect
  listen 80;
  server_name enrollment.example.org;
  return 301 https://$host$request_uri;
}
```

### Renewal

certbot installs a systemd timer / cron that renews automatically. Verify:

```bash
sudo certbot renew --dry-run          # test renewal
systemctl list-timers | grep certbot  # confirm the timer is active
```

Certificates are valid 90 days and renew at ~60 days. No action needed unless the
dry run fails (usually a port-80 reachability or nginx-reload issue).

## After changing nginx

```bash
sudo nginx -t              # validate config
sudo systemctl reload nginx
```

## Verifying the admin gate

From an **allowed** IP, `https://enrollment.example.org/admin` loads the login (substitute the approved hostname).
From a **disallowed** IP, nginx returns `403` and the app never sees the request.
Confirm both before go-live.
