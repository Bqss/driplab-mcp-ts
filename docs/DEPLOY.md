# Deploy Guide — driplab-mcp-ts

Panduan deploy MCP server Wajom & Dripsender ke server production. Client connect via URL (HTTP transport), DB path via env var. Process manager pakai pm2, reverse proxy pakai Caddy. Tanpa Docker.

## Arsitektur deploy

```
│  MCP Client  │──► mcp.wajom.co      ┌───────────┐──► 127.0.0.1:8100 ┌───────────────┐──► ┌──────────┐
│ (Cursor/etc) │──► mcp.dripsender.id │   Caddy   │──► 127.0.0.1:8101 │  MCP Server   │    │ SQLite   │
│              │    HTTPS + auto-TLS  │ (TLS+proxy)│    HTTP/SSE       │ (wajom/drip)  │    │ DB       │
                                                                 ↑
                                                            pm2 (process manager):
                                                            pm2 start wajom-server.ts
                                                            pm2 start dripsender-server.ts
                                                            auto-restart on crash/reboot

Server jalan sebagai HTTP service di VPS, behind Caddy reverse proxy dengan automatic TLS. Client connect via URL. DB path di-set via env var.

## Env var reference

Semua config via env var. Copy `.env.example` ke `.env` dan edit — ini satu-satunya tempat edit value, untuk local dev maupun server deploy (`ecosystem.config.cjs` baca `.env` otomatis).

| Variable | Server | Default | Deskripsi |
|---|---|---|---|
| `WAJOM_DB_PATH` | wajom | `./devdb.sqlite3` | Path ke Wajom SQLite DB |
| `DRIPSENDER_DB_PATH` | dripsender | `./devdb copy.sqlite3` | Path ke Dripsender SQLite DB |
| `MCP_TRANSPORT` | both | `stdio` | `stdio` (local) atau `streamable-http` (server) |
| `MCP_HOST` | both | `0.0.0.0` | Bind address untuk HTTP |
| `MCP_PORT` | wajom | `8100` | Port untuk HTTP (wajom) |
| `MCP_PORT` | dripsender | `8101` | Port untuk HTTP (dripsender) |

## Opsi 1: Bare metal + pm2 + Caddy (rekomendasi)

### 1. Setup Node.js di VPS

```bash
# Install Node.js 22 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22

# Install pnpm
npm i -g pnpm

# Verify
node --version  # v22.x
```

### 2. Clone & install project

```bash
git clone <repo> /opt/driplab-mcp-ts
cd /opt/driplab-mcp-ts
pnpm install
```

### 3. Copy DB ke server (read-only)

```bash
mkdir -p /data/wajom /data/dripsender
scp devdb.sqlite3 user@vps:/data/wajom/prod.sqlite3
scp "devdb copy.sqlite3" user@vps:/data/dripsender/prod.sqlite3
chmod 444 /data/wajom/prod.sqlite3 /data/dripsender/prod.sqlite3
```

### 4. Buat `.env`

```bash
cp .env.example /opt/driplab-mcp-ts/.env
```

Edit `/opt/driplab-mcp-ts/.env`:

```env
WAJOM_DB_PATH=/data/wajom/prod.sqlite3
DRIPSENDER_DB_PATH=/data/dripsender/prod.sqlite3
MCP_TRANSPORT=streamable-http
MCP_HOST=127.0.0.1
```

> `MCP_PORT` tidak perlu di `.env` — tiap server pin port-nya sendiri di
> `ecosystem.config.cjs` (wajom=8100, dripsender=8101) supaya ga bentrok.
> `.env` adalah satu-satunya tempat edit value; `ecosystem.config.cjs` baca
> file ini otomatis saat `pm2 start`.

### 5. Install pm2 & jalankan server

```bash
# Install pm2 global
npm i -g pm2

# Start kedua server (ecosystem.config.cjs baca .env otomatis)
cd /opt/driplab-mcp-ts
pm2 start ecosystem.config.cjs

# Save process list (auto-restart setelah reboot)
pm2 save

# Setup pm2 startup script (jalankan sebagai user mcp)
pm2 startup systemd
# pm2 akan print perintah sudo — copy-paste & jalankan
```

Verify:

```bash
pm2 status
# Expected: wajom-mcp (online) + dripsender-mcp (online)

pm2 logs wajom-mcp --lines 5
# Expected: [MCP] wajom-mcp running on http://127.0.0.1:8100/mcp

curl -s -X POST http://localhost:8100/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"healthcheck","version":"1.0"}}}'
```

### 6. Install & konfigurasi Caddy

Caddy adalah reverse proxy dengan automatic HTTPS (Let's Encrypt). Jauh lebih simple dari nginx.

```bash
# Install Caddy (Debian/Ubuntu)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

Edit Caddyfile:

```bash
sudo nano /etc/caddy/Caddyfile
```

```caddyfile
# Wajom MCP server
mcp.wajom.co {
	reverse_proxy 127.0.0.1:8100 {
		# SSE: flush immediately, don't buffer
		flush_interval -1
	}
}

# Dripsender MCP server
mcp.dripsender.id {
	reverse_proxy 127.0.0.1:8101 {
		flush_interval -1
	}
}
```

> **Catatan:** `flush_interval -1` penting untuk SSE (Server-Sent Events). Tanpa ini, Caddy akan buffer response dan MCP client timeout.

```bash
# Start Caddy
sudo systemctl enable --now caddy

# Cek status
sudo systemctl status caddy

# Cek TLS certificate (auto-provisioned per domain)
curl -v https://mcp.wajom.co/mcp 2>&1 | grep "SSL connection"
curl -v https://mcp.dripsender.id/mcp 2>&1 | grep "SSL connection"
```

Caddy akan otomatis:
- Provision TLS certificate dari Let's Encrypt (per domain)
- Renewal otomatis sebelum expired
- Redirect HTTP → HTTPS
- Proxy request ke MCP server dengan SSE support

### 7. Config client

```json
// ~/.cursor/mcp.json
{
  "mcpServers": {
    "wajom": {
      "url": "https://mcp.wajom.co/mcp"
    },
    "dripsender": {
      "url": "https://mcp.dripsender.id/mcp"
    }
}
```

Restart Cursor. Selesai.

## Opsi 2: Local stdio (dev only)

Untuk development lokal, tetap pakai stdio. Lihat [SETUP.md](./SETUP.md).

## Security checklist

| Item | Status |
|---|---|
| DB connection read-only (`readonly: true` + `query_only = 1`) | ✅ enforced di `db.ts` |
| PII stripped (passwords, api_keys, tokens) | ✅ allowlist di `pii.ts` |
| No raw SQL tool exposed | ✅ semua tool parameterized |
| DB file permission: `chmod 444` | ⬜ set manual di production |
| HTTP behind TLS (Caddy automatic HTTPS) | ✅ via Caddy |
| HTTP behind auth | ⬜ tambahan: Caddy basic_auth atau IP allowlist (lihat di bawah) |
| Env var untuk DB path, bukan hardcoded | ✅ |
| No secrets in code | ✅ |
| `.env` tidak di-commit ke git | ✅ di `.gitignore` |

## Optional: Caddy basic auth

Kalau mau protect endpoint dengan username/password:

```caddyfile
# Wajom
mcp.wajom.co {
	basic_auth {
		mcp $2a$14$...hashed-password...  # generate dengan: caddy hash-password
	}
	reverse_proxy 127.0.0.1:8100 {
		flush_interval -1
	}
}

# Dripsender
mcp.dripsender.id {
	basic_auth {
		mcp $2a$14$...hashed-password...
	}
	reverse_proxy 127.0.0.1:8101 {
		flush_interval -1
	}
}
```

Generate password hash:

```bash
caddy hash-password --plaintext "your-secret-password"
```

> **Catatan:** Sebagian MCP client mungkin tidak support HTTP basic auth. Test dulu dengan client lo. Kalau bermasalah, gunakan IP allowlist saja:

```caddyfile
# Wajom
mcp.wajom.co {
	@allowed remote_ip 1.2.3.4 5.6.7.8  # IP yang diizinkan
	handle @allowed {
		reverse_proxy 127.0.0.1:8100 { flush_interval -1 }
	}
	respond "Forbidden" 403
}

# Dripsender
mcp.dripsender.id {
	@allowed remote_ip 1.2.3.4 5.6.7.8
	handle @allowed {
		reverse_proxy 127.0.0.1:8101 { flush_interval -1 }
	}
	respond "Forbidden" 403
}
```

## Database sync (production → local)

```bash
# Copy DB dari server (read-only snapshot)
scp user@vps:/data/wajom/prod.sqlite3 ./devdb.sqlite3
scp user@vps:/data/dripsender/prod.sqlite3 "./devdb copy.sqlite3"

# Atau rsync dengan exclude WAL/SHM
rsync -avz --exclude='*-wal' --exclude='*-shm' user@vps:/data/wajom/ ./
```

**Jangan pointing ke DB production langsung dari local** kalau DB tersebut dipakai active write — SQLite read-only connection bisa lock. Copy dulu.

## Update / rollback

```bash
cd /opt/driplab-mcp-ts
git pull
pnpm install
pm2 restart wajom-mcp dripsender-mcp
```

Rollback:

```bash
git checkout <previous-tag>
pnpm install
pm2 restart wajom-mcp dripsender-mcp
```

## Monitoring

```bash
# Cek server jalan
pm2 status

# Cek log real-time
pm2 logs wajom-mcp --lines 50
pm2 logs dripsender-mcp --lines 50
pm2 logs                    # semua server sekaligus

# Cek Caddy
sudo systemctl status caddy
sudo journalctl -u caddy -f

# Health check (lewat Caddy, dari luar)
curl -s -X POST https://mcp.wajom.co/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"healthcheck","version":"1.0"}}}'
# Expected: SSE response with serverInfo {"name":"wajom-mcp","version":"0.1.0"}

# Health check (langsung ke server, dari VPS)
curl -s -X POST http://localhost:8100/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"healthcheck","version":"1.0"}}}'
```
