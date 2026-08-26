# Setup — Wajom & Dripsender MCP

Connect AI ke data Wajom & Dripsender via MCP. Server sudah deploy, tinggal pasang URL. Tanpa install apa-apa.

## Server URLs

| Server | URL |
|---|---|
| Wajom | `https://mcp.wajom.co/mcp` |
| Dripsender | `https://mcp.dripsender.id/mcp` |

## ChatGPT Plus

1. Settings → Connectors → **Add custom connector**
2. Name: `Wajom`, URL: `https://mcp.wajom.co/mcp` → Save
3. Add lagi: Name: `Dripsender`, URL: `https://mcp.dripsender.id/mcp` → Save
4. Di chat, klik **Tools** → enable Wajom & Dripsender
5. Tanyakan: "tampilkan 5 order terakhir dari wajom"

## Devin AI

1. Settings → MCP Servers → **Add**
2. Name: `wajom`, URL: `https://mcp.wajom.co/mcp` → Save
3. Add lagi: Name: `dripsender`, URL: `https://mcp.dripsender.id/mcp` → Save
4. Mulai session, tanyakan: "list semua user dripsender yang paid"

## Claude (claude.ai)

1. Settings → Connectors → **Add custom connector**
2. Name: `Wajom`, URL: `https://mcp.wajom.co/mcp` → Connect
3. Add lagi: Name: `Dripsender`, URL: `https://mcp.dripsender.id/mcp` → Connect
4. Di chat: "berapa revenue dripsender per bulan"

## Cursor

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "wajom": { "url": "https://mcp.wajom.co/mcp" },
    "dripsender": { "url": "https://mcp.dripsender.id/mcp" }
  }
}
```

Restart Cursor.

## Contoh prompt

- "tampilkan 5 order terakhir dari wajom"
- "berapa revenue dripsender per bulan"
- "list semua user dripsender yang paid"
- "stats kelas wajom mastery"
- "tampilkan feedback dripsender rating 5"

Semua tool read-only — ga bisa create/update/delete data.

## Troubleshooting

Server ga respond? Cek dengan curl:

```bash
curl -s -X POST https://mcp.wajom.co/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

Expected: response dengan `serverInfo`. Kalau kosong → server down, hubungi tim dev.
