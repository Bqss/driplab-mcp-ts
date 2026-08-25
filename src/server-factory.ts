/**
 * Shared MCP server factory + helpers.
 *
 * Both Wajom and Dripsender servers use this to create an `McpServer`,
 * register tools, and select transport (stdio or streamable-http) via env.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { SqlDatabase } from "./core/db.ts";
import type { Product } from "./core/db.ts";

export interface ServerConfig {
  product: Product;
  name: string;
  defaultPort: number;
  dbEnvVar: string;
  defaultDbPath: string;
}

/** Resolve DB path from env or default locations. */
export function resolveDbPath(config: ServerConfig): string {
  const envPath = process.env[config.dbEnvVar];
  if (envPath) return envPath;
  for (const candidate of [
    resolve(process.cwd(), config.defaultDbPath),
    resolve(import.meta.dirname, "../../..", config.defaultDbPath),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`${config.dbEnvVar} not set and ${config.defaultDbPath} not found`);
}

/** Create a lazily-initialized DB singleton. */
export function createDbLazy(config: ServerConfig): () => SqlDatabase {
  let db: SqlDatabase | null = null;
  return () => {
    if (!db) db = new SqlDatabase(resolveDbPath(config), config.product);
    return db;
  };
}

/** JSON serialize tool output. */
export function json(obj: unknown): string {
  return JSON.stringify(obj, null, 2);
}

/**
 * Convert snake_case object keys to camelCase.
 * MCP tool args convention is snake_case (date_from, user_id), but the
 * query functions expect camelCase (dateFrom, userId). Without this, every
 * snake_case filter is silently dropped because the property never matches.
 */
export function camelArgs<T extends Record<string, unknown>>(args: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  return out;
}

/** Run an MCP server with transport selected via env vars. */
export function runServer(server: McpServer, config: ServerConfig): void {
  const transport = process.env.MCP_TRANSPORT ?? "stdio";

  if (transport === "streamable-http") {
    const host = process.env.MCP_HOST ?? "0.0.0.0";
    const port = parseInt(process.env.MCP_PORT ?? String(config.defaultPort), 10);

    const httpServer = createServer(async (req, res) => {
      try {
        const t = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        await server.connect(t);
        await t.handleRequest(req, res);
      } catch (err) {
        console.error("[MCP] request error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "internal server error" }));
        }
      }
    });

    httpServer.listen(port, host, () => {
      console.error(`[MCP] ${config.name} running on http://${host}:${port}/mcp`);
    });
  } else {
    serveStdio(() => server);
    console.error(`[MCP] ${config.name} running on stdio`);
  }
}
