# Intelligent Sync

Self-hosted markdown sync for Obsidian: one **server** vault is the source of truth, **clients** push and pull changes over **HTTPS** with an **API key**.

Works on **Linux desktop** (server or client) and **iPhone** (client only).

## Features

- Server / Client modes
- Syncs `.md` files only
- Global monotonic revision log on the server
- Conflict policy: **server always wins**
- Deletes applied through Obsidian trash
- Triggers: Sync now, sync on save, periodic poll
- Status bar: mode, revision, connection, last sync
- TLS required; shared API key for auth

## Install

### From source (manual / BRAT)

1. Build:

```bash
npm install
npm run build
```

2. Copy into your vault:

```bash
VAULT="/path/to/your/vault"
PLUGIN="$VAULT/.obsidian/plugins/intelligent-sync"
mkdir -p "$PLUGIN"
cp main.js manifest.json styles.css "$PLUGIN/"
```

3. Enable **Intelligent Sync** under Settings → Community plugins.

### Community plugins

After the plugin is listed in the directory, install it from Settings → Community plugins → Browse → **Intelligent Sync**.

## Quick start

### Server (Linux desktop, direct HTTPS)

1. Open the vault that should be canonical.
2. Settings → Intelligent Sync → Mode: **Server**.
3. Click **Generate** on the API key and copy it.
4. Bind host/port (default `0.0.0.0:27183`).
5. Configure TLS:
   - **Production / iPhone**: set absolute paths to a trusted `cert.pem` and `key.pem` (for example Let’s Encrypt via a reverse proxy).
   - **Local desktop testing**: leave paths empty to auto-generate a self-signed certificate with `openssl`.
6. Start the server (or enable auto-start).

Expose the port through WireGuard or a public address. The plugin always speaks HTTPS.

### Server behind a TLS-terminating reverse proxy (nginx)

Use this so iPhone clients connect to a trusted certificate while the plugin serves plain HTTP on the laptop.

1. Open the canonical vault and set Mode **Server**.
2. Bind host: `127.0.0.1`, Bind port: `27183`.
3. Toggle **TLS / HTTPS** **off**.
4. Start the server.
5. On the VPS, point nginx at the laptop’s port 27183 (reachable via WireGuard or a reverse SSH tunnel — see below).

```nginx
upstream intelligent_sync_obsidian { server 127.0.0.1:27183; }

server {
    listen 443 ssl http2;
    server_name sync.your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/sync.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sync.your-domain.com/privkey.pem;
    add_header Strict-Transport-Security "max-age=31536000" always;

    location / {
        proxy_pass http://intelligent_sync_obsidian;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

Making the laptop’s 27183 reachable from the VPS:
- **WireGuard**: laptop is the server (`10.0.0.1:27183`, firewall open), VPS is a peer (`10.0.0.2`), nginx upstream → `10.0.0.1:27183`.
- **Reverse SSH tunnel** (no router fiddling): from the laptop run `ssh -N -R 27183:127.0.0.1:27183 user@vps`, then nginx upstream stays `127.0.0.1:27183`.

### Client (Linux or iPhone)

1. Mode: **Client**.
2. Server URL: `https://<host>:27183` (direct) or `https://sync.your-domain.com` (reverse proxy, no port).
3. Paste the same API key.
4. Enable sync on save and/or set a poll interval.
5. Run **Sync now**.

On iPhone, sync runs while Obsidian is open (open / save / poll). Background sync is not supported in v0.1.

## iPhone and TLS

iOS often rejects self-signed certificates used by `fetch`. For mobile clients use a publicly trusted certificate (e.g. Let’s Encrypt behind nginx) or install your own CA on the device.

WireGuard encrypts the network path; with a reverse proxy the public endpoint serves a trusted certificate while the plugin-to-nginx link is plain HTTP over loopback or a tunnel.


## Security notes

- Anyone with the API key and network access can read and write synced markdown.
- Prefer WireGuard or another VPN; do not expose the port without TLS and a strong API key.
- Server mode starts a local HTTPS listener inside desktop Obsidian (Node APIs). It is not available on mobile.

## Commands

- **Sync now**
- **Start sync server** / **Stop sync server** (desktop)

## API

Base path: `/api/v1`  
Auth header: `Authorization: Bearer <apiKey>`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/status` | Vault id, revision, server time |
| GET | `/changes?since=N` | Ordered change log after revision N |
| GET | `/index` | Full file index (fallback if the log was trimmed) |
| GET | `/file?path=` | Markdown body and metadata |
| POST | `/push` | Client changes; mismatched base hash → server wins |

Plugin state is stored under:

`.obsidian/plugins/intelligent-sync/`

## Development

```bash
npm install
npm run dev      # watch build
npm run build    # production main.js
```

Release assets for GitHub Releases must include `main.js`, `manifest.json`, and `styles.css`. The release tag must match `manifest.json` `version`.

## License

MIT — see [LICENSE](LICENSE).
