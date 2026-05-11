// Append-only logger that writes structured JSON lines to
// `.domain-memory/errors.log`. Used for warnings and failures that must
// never reach the user but should be debuggable later.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Logger {
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export class FileLogger implements Logger {
  constructor(private readonly path: string) {}

  warn(message: string, meta: Record<string, unknown> = {}): void {
    this.write('warn', message, meta);
  }

  error(message: string, meta: Record<string, unknown> = {}): void {
    this.write('error', message, meta);
  }

  private write(
    level: 'warn' | 'error',
    message: string,
    meta: Record<string, unknown>,
  ): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const line =
        JSON.stringify({
          ts: new Date().toISOString(),
          level,
          message,
          ...meta,
        }) + '\n';
      appendFileSync(this.path, line, 'utf-8');
    } catch {
      // Last-resort: swallow. We cannot let logging break the server.
    }
  }
}
