/** Dripsender-specific queries: payouts, plugins, syncs, training, tokens. */

import { SqlDatabase } from "./db.ts";
import { stripPii } from "./pii.ts";
import { convertEpochs, parseDateRange, epochMsToIso } from "./time.ts";

type Row = Record<string, unknown>;

export function listPayouts(
  db: SqlDatabase,
  opts: {
    status?: string | null;
    userId?: string | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    limit?: number;
    offset?: number;
  } = {}
): Row[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.status) {
    clauses.push("status = ?");
    params.push(opts.status);
  }
  if (opts.userId) {
    clauses.push("user_id = ?");
    params.push(opts.userId);
  }
  const [startMs, endMs] = parseDateRange(opts.dateFrom, opts.dateTo);
  if (startMs !== null) {
    clauses.push("created_at >= ?");
    params.push(startMs);
  }
  if (endMs !== null) {
    clauses.push("created_at <= ?");
    params.push(endMs);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  const offset = Math.max(0, opts.offset ?? 0);
  const rows = db.query<Row>(
    `SELECT * FROM merchant_payouts ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset
  );
  return convertEpochs(stripPii(rows, "merchant_payouts"), [
    "created_at",
    "updated_at",
    "processed_at",
  ]);
}

export function listPremiumPlugins(db: SqlDatabase, activeOnly = true): Row[] {
  const where = activeOnly ? "WHERE is_active = 1" : "";
  return convertEpochs(stripPii(db.query<Row>(`SELECT * FROM premium_plugins ${where} ORDER BY name`), "premium_plugins"));
}

export function listUserPlugins(
  db: SqlDatabase,
  opts: {
    userId?: string | null;
    pluginId?: string | null;
    activeOnly?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Row[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.userId) {
    clauses.push("up.user_id = ?");
    params.push(opts.userId);
  }
  if (opts.pluginId) {
    clauses.push("up.plugin_id = ?");
    params.push(opts.pluginId);
  }
  if (opts.activeOnly) clauses.push("up.is_active = 1");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  const offset = Math.max(0, opts.offset ?? 0);
  const rows = db.query<Row>(
    `SELECT up.*, p.name AS plugin_name, p.slug AS plugin_slug FROM user_premium_plugins up LEFT JOIN premium_plugins p ON up.plugin_id = p.id ${where} ORDER BY up.created_at DESC LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset
  );
  return convertEpochs(stripPii(rows, "user_premium_plugins"));
}

export function listWebsiteSyncs(
  db: SqlDatabase,
  opts: {
    waId?: string | null;
    status?: string | null;
    includePages?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Row[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.waId) {
    clauses.push("wa_id = ?");
    params.push(opts.waId);
  }
  if (opts.status) {
    clauses.push("status = ?");
    params.push(opts.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  const offset = Math.max(0, opts.offset ?? 0);
  const rows = db.query<Row>(
    `SELECT * FROM website_syncs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset
  );
  const syncs = convertEpochs(stripPii(rows, "website_syncs"));
  if (opts.includePages && db.hasTable("website_sync_pages")) {
    for (const s of syncs) {
      const pages = db.query<Row>(
        "SELECT * FROM website_sync_pages WHERE website_sync_id = ?",
        s.id
      );
      s.pages = convertEpochs(stripPii(pages, "website_sync_pages"), [
        "created_at",
        "updated_at",
        "scraped_at",
      ]);
    }
  }
  return syncs;
}

export function listTrainingDataFiles(
  db: SqlDatabase,
  opts: {
    waId?: string | null;
    status?: string | null;
    limit?: number;
    offset?: number;
  } = {}
): Row[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.waId) {
    clauses.push("wa_id = ?");
    params.push(opts.waId);
  }
  if (opts.status) {
    clauses.push("status = ?");
    params.push(opts.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  const offset = Math.max(0, opts.offset ?? 0);
  const rows = db.query<Row>(
    `SELECT * FROM training_data_files ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset
  );
  return convertEpochs(stripPii(rows, "training_data_files"));
}

export function listTokenPurchases(
  db: SqlDatabase,
  opts: {
    userId?: string | null;
    status?: string | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    limit?: number;
    offset?: number;
  } = {}
): Row[] {
  const clauses: string[] = ["order_type = 'token'"];
  const params: unknown[] = [];
  if (opts.userId) {
    clauses.push("s.user_id = ?");
    params.push(opts.userId);
  }
  if (opts.status) {
    clauses.push("s.status = ?");
    params.push(opts.status);
  }
  const [startMs, endMs] = parseDateRange(opts.dateFrom, opts.dateTo);
  if (startMs !== null) {
    clauses.push("s.created_at >= ?");
    params.push(startMs);
  }
  if (endMs !== null) {
    clauses.push("s.created_at <= ?");
    params.push(endMs);
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  const offset = Math.max(0, opts.offset ?? 0);
  let pkgJoin = "";
  let pkgCols = "";
  if (db.hasTable("token_packages")) {
    pkgJoin = "LEFT JOIN token_packages tp ON s.token_package_id = tp.id";
    pkgCols = ", tp.title AS package_title, tp.token_amount AS package_token_amount";
  }
  const rows = db.query<Row>(
    `SELECT s.*${pkgCols} FROM sales s ${pkgJoin} ${where} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset
  );
  const stripped = stripPii(rows, "sales");
  for (const r of stripped) {
    for (const c of ["created_at", "updated_at", "expired_time"]) {
      if (c in r) r[c] = epochMsToIso(r[c] as number | null);
    }
  }
  return stripped;
}
