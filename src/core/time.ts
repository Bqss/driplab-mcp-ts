/**
 * Time helpers. Both products store timestamps as epoch milliseconds (bigint).
 * Tools accept human ISO dates and convert internally.
 */

export function nowMs(): number {
  return Date.now();
}

export function epochMsToIso(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined) return null;
  try {
    return new Date(Number(ms)).toISOString();
  } catch {
    return null;
  }
}

function parseToMs(value: string): number {
  const s = value.trim().replace(/Z$/, "");
  const dt = new Date(s);
  if (isNaN(dt.getTime())) {
    throw new Error(
      `unrecognized date/time '${value}'; use ISO-8601 like '2026-08-18' or '2026-08-18T00:00:00Z'`
    );
  }
  return dt.getTime();
}

export function parseDateRange(
  dateFrom?: string | null,
  dateTo?: string | null
): [number | null, number | null] {
  const startMs = dateFrom ? parseToMs(dateFrom) : null;
  let endMs: number | null = null;
  if (dateTo) {
    endMs = parseToMs(dateTo);
    // If bare date (no time), extend to end of day.
    if (!dateTo.includes("T") && !dateTo.includes(" ")) {
      endMs += 24 * 60 * 60 * 1000 - 1;
    }
  }
  return [startMs, endMs];
}

/** Convert epoch-ms columns in a list of rows to ISO strings. */
export function convertEpochs(
  rows: Record<string, unknown>[],
  cols: string[] = ["created_at", "updated_at"]
): Record<string, unknown>[] {
  for (const r of rows) {
    for (const c of cols) {
      if (c in r) r[c] = epochMsToIso(r[c] as number | null);
    }
  }
  return rows;
}
