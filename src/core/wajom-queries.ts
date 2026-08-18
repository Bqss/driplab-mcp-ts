/** Wajom-specific queries: class participants + stats. */

import { SqlDatabase } from "./db.ts";
import { stripPii } from "./pii.ts";
import { convertEpochs, parseDateRange } from "./time.ts";

type Row = Record<string, unknown>;

export function listClassParticipants(
  db: SqlDatabase,
  opts: {
    status?: string | null;
    affiliateId?: string | null;
    search?: string | null;
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
  if (opts.affiliateId) {
    clauses.push("affiliate_id = ?");
    params.push(opts.affiliateId);
  }
  if (opts.search) {
    clauses.push("(full_name LIKE ? OR email LIKE ? OR phone LIKE ?)");
    const like = `%${opts.search}%`;
    params.push(like, like, like);
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
    `SELECT * FROM class_participants ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset
  );
  return convertEpochs(stripPii(rows, "class_participants"));
}

export function classParticipantStats(
  db: SqlDatabase,
  opts: { dateFrom?: string | null; dateTo?: string | null } = {}
): Record<string, unknown> {
  const clauses: string[] = [];
  const params: unknown[] = [];
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
  const funnel = db.query<{ status: string; count: number; revenue: number }>(
    `SELECT status, COUNT(*) AS count, COALESCE(SUM(amount),0) AS revenue FROM class_participants ${where} GROUP BY status`,
    ...params
  );
  const affClauses = [...clauses, "affiliate_id IS NOT NULL"];
  const affWhere = `WHERE ${affClauses.join(" AND ")}`;
  const byAffiliate = db.query<{ affiliate_id: string; count: number; revenue: number }>(
    `SELECT affiliate_id, COUNT(*) AS count, COALESCE(SUM(amount),0) AS revenue FROM class_participants ${affWhere} GROUP BY affiliate_id ORDER BY count DESC LIMIT 20`,
    ...params
  );
  const total = db.queryOne<{ count: number; revenue: number }>(
    `SELECT COUNT(*) AS count, COALESCE(SUM(amount),0) AS revenue FROM class_participants ${where}`,
    ...params
  );
  return { funnel, by_affiliate: byAffiliate, totals: total };
}
