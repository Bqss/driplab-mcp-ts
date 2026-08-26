/**
 * HTTP client for WA server (wajom-client) queue stats endpoint.
 *
 * Instead of reading per-instance SQLite DBs from filesystem (which
 * requires WA_SERVER_DB_DIR access — impossible when MCP and WA server
 * are on different VPS), we hit the WA server's HTTP endpoint directly.
 *
 * Each WA server instance exposes:
 *   GET {connect_url}/api/queue/stats?date_from=&date_to=
 *
 * Auth: /api paths bypass the origin check in auth middleware.
 *
 * The portal DB (whatsapps table) provides connect_url + port for each
 * device, so MCP can resolve which endpoint to call per device.
 */

export interface QueueStatsResponse {
  port: string;
  server_id: string;
  by_status: Record<string, number>;
  by_source: Record<string, number>;
  total: number;
  delivered: number;
  chat_ai_count: number;
  daily: Array<{ date: string; count: number }>;
  recent: Array<{
    id: number;
    jid: string;
    name: string;
    status: string;
    send_at: number;
    tries: number;
    campaign_id: string | null;
    list_id: string | null;
    source: string | null;
  }>;
  has_source_column: boolean;
}

/**
 * Fetch queue stats from a WA server instance via HTTP.
 * Returns null if the instance is unreachable (offline, sleep, etc).
 */
export async function fetchQueueStats(
  connectUrl: string,
  opts: { dateFrom?: string | null; dateTo?: string | null } = {}
): Promise<QueueStatsResponse | null> {
  try {
    const url = new URL(`${connectUrl}/api/queue/stats`);
    if (opts.dateFrom) url.searchParams.set("date_from", opts.dateFrom);
    if (opts.dateTo) url.searchParams.set("date_to", opts.dateTo);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);

    if (!res.ok || res.status >= 500) return null;
    const data = (await res.json()) as QueueStatsResponse;
    return data;
  } catch {
    // Instance offline, timeout, DNS error, etc — not an error, just unreachable
    return null;
  }
}

/**
 * Fetch queue stats for multiple instances in parallel.
 * Returns map of whatsapp_id → QueueStatsResponse (only for reachable instances).
 */
export async function fetchQueueStatsBatch(
  devices: Array<{ id: string; connect_url: string }>,
  opts: { dateFrom?: string | null; dateTo?: string | null } = {}
): Promise<Map<string, QueueStatsResponse>> {
  const results = new Map<string, QueueStatsResponse>();

  // Batch in chunks of 20 to avoid overwhelming the network
  const chunkSize = 20;
  for (let i = 0; i < devices.length; i += chunkSize) {
    const chunk = devices.slice(i, i + chunkSize);
    const settled = await Promise.allSettled(
      chunk.map((d) => fetchQueueStats(d.connect_url, opts))
    );
    settled.forEach((s, idx) => {
      if (s.status === "fulfilled" && s.value !== null) {
        results.set(chunk[idx].id, s.value);
      }
    });
  }

  return results;
}
