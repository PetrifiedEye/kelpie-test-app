const ALLOWED_FIELDS = new Set(['phase', 'status', 'revision', 'code', 'kind', 'scenario', 'httpStatus']);
const SCENARIO_TOKENS = new Set(['happy', 'lost_ack', 'stale_status', 'delete_failure', 'reset']);

export type SafeLogFields = Record<string, unknown>;
export type SafeLogSink = (event: string, fields: Record<string, string | number>) => void;

let sink: SafeLogSink = () => undefined;

/** Test and diagnostics hooks replace the sink. The default sink records nothing. */
export function setSafeLogSink(next: SafeLogSink): void {
  sink = next;
}

/**
 * Records an operational event. File bytes, file names, and charge descriptions
 * are dropped even if a caller passes them.
 */
export function safeLog(event: string, fields: SafeLogFields = {}): void {
  sink(event, sanitizeLogFields(fields));
}

export function sanitizeLogFields(fields: SafeLogFields): Record<string, string | number> {
  const safe: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED_FIELDS.has(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) {
      safe[key] = value;
      continue;
    }
    if (typeof value === 'string' && isSafeToken(key, value)) safe[key] = value;
  }
  return safe;
}

function isSafeToken(key: string, value: string): boolean {
  if (key === 'scenario') return SCENARIO_TOKENS.has(value);
  return value.length > 0 && value.length <= 64 && /^[A-Za-z0-9_-]+$/.test(value);
}
