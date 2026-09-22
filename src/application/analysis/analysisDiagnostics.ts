/** Log only deliberately selected metadata. Never accepts a raw PRD, response, exception or stack. */
export function analysisDiagnostic(log: (message: string) => void, stage: string, fields: Readonly<Record<string, string | number | boolean>> = {}): void {
  const safe = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/(?:https?:\/\/|Bearer\s+|(?:sk-|ghp_))[\S]+/gi, '[redacted]').slice(0, 1024) : value]));
  // Diagnostics must not affect persistence or successful analysis if the output channel is unavailable.
  try { log(`PRD analysis ${stage}: ${JSON.stringify(safe)}`); } catch { /* Optional observability boundary. */ }
}
