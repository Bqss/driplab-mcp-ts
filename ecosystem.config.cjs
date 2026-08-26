/**
 * pm2 process config for the Wajom & Dripsender MCP servers.
 *
 * pm2 has no `--env-file` flag, so this file loads `.env` (the single source
 * of truth for DB paths / ports / host) and forwards the vars to each app.
 * Edit values in `.env` (copy from `.env.example`), then:
 *
 *   pm2 start ecosystem.config.cjs
 *
 * Only MCP_PORT must differ per app, so it is pinned here; everything else
 * comes from `.env`.
 */
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

// Minimal .env loader — no dotenv dependency needed for deploy.
const envPath = resolve(__dirname, ".env");
try {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, raw] = m;
    const val = raw.replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val; // don't override real env
  }
} catch {
  console.error("[ecosystem] .env not found at", envPath, "— copy .env.example first");
  process.exit(1);
}

module.exports = {
  apps: [
    {
      name: "wajom-mcp",
      script: "src/wajom-server.ts",
      interpreter: "node",
      interpreter_args: "--experimental-strip-types",
      cwd: __dirname,
      env: {
        WAJOM_DB_PATH: process.env.WAJOM_DB_PATH,
        WA_SERVER_DB_DIR: process.env.WA_SERVER_DB_DIR,
        MCP_TRANSPORT: process.env.MCP_TRANSPORT ?? "streamable-http",
        MCP_HOST: process.env.MCP_HOST ?? "127.0.0.1",
        MCP_PORT: "8100",
      },
    },
    {
      name: "dripsender-mcp",
      script: "src/dripsender-server.ts",
      interpreter: "node",
      interpreter_args: "--experimental-strip-types",
      cwd: __dirname,
      env: {
        DRIPSENDER_DB_PATH: process.env.DRIPSENDER_DB_PATH,
        MCP_TRANSPORT: process.env.MCP_TRANSPORT ?? "streamable-http",
        MCP_HOST: process.env.MCP_HOST ?? "127.0.0.1",
        MCP_PORT: "8101",
      },
    },
  ],
};
