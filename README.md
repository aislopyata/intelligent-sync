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

If you previously installed this plugin under `obsidian-intelligent-sync`, remove that folder and use `intelligent-sync` instead.

### Community plugins

After the plugin is listed in the directory, install it from Settings → Community plugins → Browse → **Intelligent Sync**.

## Quick start

### Server (Linux desktop)

1. Open the vault that should be canonical.
2. Settings → Intelligent Sync → Mode: **Server**.
3. Click **Generate** on the API key and copy it.
4. Bind host/port (default `0.0.0.0:27183`).
5. Configure TLS:
   - **Production / iPhone**: set absolute paths to a trusted `cert.pem` and `key.pem` (for example Let’s Encrypt via a reverse proxy).
   - **Local desktop testing**: leave paths empty to auto-generate a self-signed certificate with `openssl`.
6. Start the server (or enable auto-start).

Expose the port through WireGuard or a public address. The plugin always speaks HTTPS.

### Client (Linux or iPhone)

1. Mode: **Client**.
2. Server URL: `https://<host>:27183`.
3. Paste the same API key.
4. Enable sync on save and/or set a poll interval.
5. Run **Sync now**.

On iPhone, sync runs while Obsidian is open (open / save / poll). Background sync is not supported in v0.1.

## iPhone and TLS

iOS often rejects self-signed certificates used by `fetch`. For mobile clients use a publicly trusted certificate or install your own CA on the device.

WireGuard encrypts the network path; this plugin still requires HTTPS and an API key.

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
