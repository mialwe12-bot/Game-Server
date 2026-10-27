import { Writable } from 'node:stream';
import pino from 'pino';
import type { ServerLogLine } from '@gameserver/shared';

/** Ringpuffer der letzten Server-Logzeilen für die Log-Ansicht im Admin-Panel. */
export class LogBuffer {
  private lines: ServerLogLine[] = [];
  constructor(private readonly capacity = 2000) {}

  push(line: ServerLogLine): void {
    this.lines.push(line);
    if (this.lines.length > this.capacity) this.lines.splice(0, this.lines.length - this.capacity);
  }

  list(opts: { level?: string; limit?: number; q?: string } = {}): ServerLogLine[] {
    const order = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
    const min = opts.level ? order.indexOf(opts.level) : 0;
    const q = opts.q?.toLowerCase();
    return this.lines
      .filter((l) => order.indexOf(l.level) >= min)
      .filter((l) => !q || l.msg.toLowerCase().includes(q) || JSON.stringify(l.data ?? {}).toLowerCase().includes(q))
      .slice(-(opts.limit ?? 500))
      .reverse();
  }
}

const LEVELS: Record<number, string> = { 10: 'trace', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'fatal' };

export function createLogger(level: string, pretty: boolean, buffer: LogBuffer) {
  const bufferStream = new Writable({
    write(chunk, _enc, cb) {
      try {
        const { level: lvl, time, msg, pid: _pid, hostname: _host, ...rest } = JSON.parse(chunk.toString());
        buffer.push({ time: new Date(time).toISOString(), level: LEVELS[lvl] ?? String(lvl), msg: msg ?? '', data: rest });
      } catch {
        // Nicht-JSON-Zeilen ignorieren
      }
      cb();
    },
  });
  const streams: pino.StreamEntry[] = [{ level: level as pino.Level, stream: bufferStream }];
  if (pretty) {
    streams.push({ level: level as pino.Level, stream: pino.transport({ target: 'pino-pretty', options: { colorize: true } }) });
  } else {
    streams.push({ level: level as pino.Level, stream: process.stdout });
  }
  return pino(
    {
      level,
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'],
        censor: '[redacted]',
      },
    },
    pino.multistream(streams),
  );
}
