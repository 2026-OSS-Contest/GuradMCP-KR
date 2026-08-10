// NFR-06: structured (JSON) logs, one line per record. No external logging library — this
// mirrors the hand-rolled `JSON.stringify` line server.ts already writes on startup.
export interface LogFields {
  eventId?: string;
  sessionId?: string;
  verdict?: string;
  [key: string]: unknown;
}

export function logJson(level: "info" | "warn" | "error", message: string, fields: LogFields = {}): void {
  const line = { timestamp: new Date().toISOString(), level, message, ...fields };
  process.stdout.write(`${JSON.stringify(line)}\n`);
}
