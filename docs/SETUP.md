# Setup Guide — driplab-mcp-ts

Panduan setup lokal untuk MCP server Wajom & Dripsender (TypeScript version).

## Prerequisites

- **Node.js 22+** (`node --version`) — dibutuhkan untuk `--experimental-strip-types` (native TS execution tanpa build step)
- **pnpm** — package manager. Install: `npm i -g pnpm`
- **SQLite database files** — `devdb.sqlite3` (Wajom) dan `devdb copy.sqlite3` (Dripsender)

## Struktur project

```
driplab-mcp-ts/
├── src/
│   ├── core/                     # shared read-only SQLite core
│   │   ├── db.ts                 # read-only conn (better-sqlite3), schema introspection
│   │   ├── pii.ts                # per-table allowlist, strips passwords/api_keys/tokens
│   │   ├── time.ts               # epoch ms ↔ ISO-8601, date-range parser
│   │   ├── money.ts              # MYR/IDR formatter
│   │   ├── queries.ts            # shared: users, orders, plans, coupons, whatsapps, affiliate, feedback, activity
│   │   ├── wajom-queries.ts      # class_participants + class stats
│   │   ├── dripsender-queries.ts # payouts, plugins, website syncs, training data, token purchases
│   │   └── index.ts              # barrel export
│   ├── server-factory.ts         # shared MCP server factory + transport selection
│   ├── wajom-server.ts           # 19 tools (wajom_*)
│   └── dripsender-server.ts      # 23 tools (dripsender_*)
├── mcp-client-config.json        # template config untuk MCP client
├── .env.example                  # env var template
└── package.json
```

## 1. Install dependencies

```bash
cd /path/ke/driplab-mcp-ts
pnpm install
```

Ini install semua dependency termasuk `better-sqlite3` (native addon). Kalau `better-sqlite3` gagal build, pastikan build tools terinstall:

```bash
# macOS
xcode-select --install

# Linux
sudo apt install build-essential python3
```

## 2. Verifikasi server jalan

```bash
# Test stdio (local mode)
WAJOM_DB_PATH=../driplab-mcp/devdb.sqlite3 node --experimental-strip-types src/wajom-server.ts
# Expected output: [MCP] wajom-mcp running on stdio
# Ctrl+C to stop

DRIPSENDER_DB_PATH="../driplab-mcp/devdb copy.sqlite3" node --experimental-strip-types src/dripsender-server.ts
# Expected: [MCP] dripsender-mcp running on stdio

# Test HTTP mode
MCP_TRANSPORT=streamable-http MCP_PORT=8100 WAJOM_DB_PATH=../driplab-mcp/devdb.sqlite3 \
  node --experimental-strip-types src/wajom-server.ts
# Expected: [MCP] wajom-mcp running on http://0.0.0.0:8100/mcp
```

Kalau tidak ada error output = server berjalan dengan benar.

## 3. Setup MCP client (local stdio)

### Cursor

Edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "wajom": {
      "command": "node",
      "args": ["--experimental-strip-types", "/path/ke/driplab-mcp-ts/src/wajom-server.ts"],
      "env": {
        "WAJOM_DB_PATH": "/path/ke/driplab-mcp/devdb.sqlite3"
      }
    },
    "dripsender": {
      "command": "node",
      "args": ["--experimental-strip-types", "/path/ke/driplab-mcp-ts/src/dripsender-server.ts"],
      "env": {
        "DRIPSENDER_DB_PATH": "/path/ke/driplab-mcp/devdb copy.sqlite3"
      }
    }
  }
}
```

**Restart Cursor** (tutup total, buka lagi). Cek **Settings → MCP** — kedua server harus status connected.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` dengan format identik. Restart Claude Desktop.

## 4. Test tools

Di chat Cursor/Claude, coba:

- "tampilkan 5 order terakhir dari wajom"
- "berapa revenue dripsender per bulan"
- "list semua user dripsender yang paid"
- "stats kelas wajom mastery"

Agent akan otomatis pilih tool yang relevan.

## Environment variables

Copy `.env.example` ke `.env` dan edit sesuai kebutuhan.

| Variable | Wajib | Default | Deskripsi |
|---|---|---|---|
| `WAJOM_DB_PATH` | ya* | `./devdb.sqlite3` | Path ke Wajom SQLite DB |
| `DRIPSENDER_DB_PATH` | ya* | `./devdb copy.sqlite3` | Path ke Dripsender SQLite DB |
| `MCP_TRANSPORT` | tidak | `stdio` | `stdio` (local) atau `streamable-http` (server) |
| `MCP_HOST` | tidak | `0.0.0.0` | Bind address untuk HTTP transport |
| `MCP_PORT` | tidak | `8100`/`8101` | Port untuk HTTP transport (per server) |

\* Kalau env var tidak di-set, server cari file default di CWD atau parent directory. Untuk production, **selalu set env var eksplisit**.

> **Untuk deploy ke server (HTTP transport, client connect via URL):** lihat [DEPLOY.md](./DEPLOY.md).

## Troubleshooting

### Server status "failed" di Cursor

Cursor tidak nemu `node` di PATH-nya. Fix: ganti `"command": "node"` ke full path:

```bash
which node
# output: /Users/mac/.nvm/versions/node/v22.16.0/bin/node
```

```json
"command": "/Users/mac/.nvm/versions/node/v22.16.0/bin/node"
```

### "Could not locate the bindings file" (better-sqlite3)

Native addon belum ter-compile. Rebuild:

```bash
cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3
npm run install
```

Atau:

```bash
pnpm rebuild better-sqlite3
```

### Tool call return "database not found"

Env var tidak ke-load atau path salah. Verifikasi:

```bash
WAJOM_DB_PATH="/path/ke/devdb.sqlite3" node --experimental-strip-types src/wajom-server.ts
```

### Tool call return empty array

DB kosong atau filter terlalu sempit. Coba tanpa filter:

```
wajom_list_orders dengan limit=5
```

### "ERR_INVALID_TYPESCRIPT_SYNTAX"

Node.js versi terlalu lama. `--experimental-strip-types` butuh Node 22+:

```bash
node --version
# harus v22.x atau lebih baru
```

## Ganti ke database production

1. Copy/sync DB production ke lokasi lokal.
2. Edit `~/.cursor/mcp.json`, ganti path di `WAJOM_DB_PATH` / `DRIPSENDER_DB_PATH`.
3. Restart Cursor.

Tidak perlu ubah kode apa-apa. Server read-only — aman pointing ke DB production.
