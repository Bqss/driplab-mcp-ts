/**
 * Time helpers. Both products store timestamps as epoch milliseconds (bigint).
 * Tools accept human ISO dates and convert internally.
 *
 * IMPORTANT: bare dates (e.g. "2026-08-24") are parsed as midnight in the
 * configured portal timezone (WAJOM_TZ / DRIPSENDER_TZ env, default
 * "Asia/Jakarta" — UTC+7). This matches the admin portal, which uses
 * `dayjs(date).startOf('day')` with the server's local TZ. Parsing bare dates
 * as UTC midnight (the previous behavior) caused a 7-hour offset that let
 * early-morning WIB orders fall outside the filter range and produced
 * misaligned day buckets in `strftime` grouping.
 */

const TZ_NAME =
  process.env.WAJOM_TZ ||
  process.env.DRIPSENDER_TZ ||
  process.env.TZ ||
  "Asia/Jakarta";

export function portalTimezone(): string {
  return TZ_NAME;
}

/**
 * Today's calendar date (YYYY-MM-DD) in the portal timezone.
 * Use this instead of SQLite `date('now')` (which is UTC) or
 * `new Date().toISOString().slice(0,10)` (also UTC) when comparing
 * against date-only columns like `membership_date`. The portal uses
 * `dayjs().tz('Asia/Jakarta').format('YYYY-MM-DD')` — this matches.
 */
export function portalToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_NAME,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Offset (in milliseconds east of UTC) of `TZ_NAME` at the given UTC instant.
 * Uses Intl.DateTimeFormat so it respects DST for zones that observe it.
 * Asia/Jakarta has no DST, so the result is a constant +7h.
 */
export function tzOffsetMsAt(ms: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ_NAME,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(ms));
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  const asUtc = Date.UTC(
    +map.year,
    +map.month - 1,
    +map.day,
    +map.hour % 24,
    +map.minute,
    +map.second
  );
  return asUtc - ms;
}

/** Same offset as `tzOffsetMsAt`, expressed in whole seconds (for SQLite). */
export function tzOffsetSecondsAt(ms: number): number {
  return Math.round(tzOffsetMsAt(ms) / 1000);
}

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
  const s = value.trim();
  // Bare calendar date "YYYY-MM-DD" → midnight in portal TZ (not UTC).
  // This matches the admin portal's `dayjs(date).startOf('day')` semantics.
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (bare) {
    const guess = Date.UTC(+bare[1], +bare[2] - 1, +bare[3], 0, 0, 0);
    return guess - tzOffsetMsAt(guess);
  }
  // Anything else (ISO with time, or with trailing Z) → let Date parse.
  // Strip a trailing Z so local-time strings are interpreted as such; keep
  // explicit offsets intact.
  const stripped = s.replace(/Z$/, "");
  const dt = new Date(stripped);
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
    // If bare date (no time), extend to end of day in portal TZ.
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
