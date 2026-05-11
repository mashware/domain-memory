// Path and symbol matcher. This is the most reliable signal: if two
// pieces of knowledge reference the same file or the same fully-qualified
// symbol, they are almost certainly about the same thing. Rename/move is
// absorbed by also matching on basename and symbol, so a single rename
// does not orphan existing knowledge.

import { basename } from 'node:path';
import type { Db } from '../storage/database.js';

export interface PathHit {
  entry_id: string;
  score: number;
  reasons: string[];
}

export interface PathQuery {
  file_paths: string[];
  symbols: string[];
}

export class PathMatcher {
  constructor(private readonly db: Db) {}

  search(query: PathQuery): PathHit[] {
    const hits = new Map<string, PathHit>();
    this.matchExactPaths(query.file_paths, hits);
    this.matchBasenames(query.file_paths, hits);
    this.matchSymbols(query.symbols, hits);
    this.matchSymbolBasenames(query.symbols, hits);
    return Array.from(hits.values()).sort((a, b) => b.score - a.score);
  }

  private matchExactPaths(paths: string[], hits: Map<string, PathHit>): void {
    if (paths.length === 0) return;
    const stmt = this.db.prepare<[string]>(
      'SELECT entry_id FROM entry_paths WHERE path = ?',
    );
    for (const p of paths) {
      const rows = stmt.all(p) as Array<{ entry_id: string }>;
      for (const row of rows) {
        this.bump(hits, row.entry_id, 1.0, `path_exact:${p}`);
      }
    }
  }

  private matchBasenames(paths: string[], hits: Map<string, PathHit>): void {
    if (paths.length === 0) return;
    const stmt = this.db.prepare<[string]>(
      "SELECT entry_id, path FROM entry_paths WHERE path LIKE ? AND is_dir = 0",
    );
    for (const p of paths) {
      const name = basename(p);
      if (!name) continue;
      const rows = stmt.all(`%${name}`) as Array<{
        entry_id: string;
        path: string;
      }>;
      for (const row of rows) {
        if (row.path === p) continue;
        this.bump(hits, row.entry_id, 0.65, `path_basename:${name}`);
      }
    }
  }

  private matchSymbols(symbols: string[], hits: Map<string, PathHit>): void {
    if (symbols.length === 0) return;
    const stmt = this.db.prepare<[string]>(
      'SELECT entry_id FROM entry_symbols WHERE symbol = ?',
    );
    for (const s of symbols) {
      const rows = stmt.all(s) as Array<{ entry_id: string }>;
      for (const row of rows) {
        this.bump(hits, row.entry_id, 1.0, `symbol_exact:${s}`);
      }
    }
  }

  private matchSymbolBasenames(symbols: string[], hits: Map<string, PathHit>): void {
    if (symbols.length === 0) return;
    const stmt = this.db.prepare<[string]>(
      'SELECT entry_id, symbol FROM entry_symbols WHERE symbol LIKE ?',
    );
    for (const s of symbols) {
      const shortName = shortSymbolName(s);
      if (!shortName || shortName === s) continue;
      const rows = stmt.all(`%${shortName}`) as Array<{
        entry_id: string;
        symbol: string;
      }>;
      for (const row of rows) {
        if (row.symbol === s) continue;
        this.bump(hits, row.entry_id, 0.6, `symbol_short:${shortName}`);
      }
    }
  }

  private bump(
    hits: Map<string, PathHit>,
    entryId: string,
    score: number,
    reason: string,
  ): void {
    const existing = hits.get(entryId);
    if (!existing) {
      hits.set(entryId, { entry_id: entryId, score, reasons: [reason] });
      return;
    }
    existing.score = Math.min(1, Math.max(existing.score, score));
    if (!existing.reasons.includes(reason)) {
      existing.reasons.push(reason);
    }
  }
}

function shortSymbolName(symbol: string): string {
  const byBackslash = symbol.split('\\').pop() ?? symbol;
  const byColon = byBackslash.split('::').pop() ?? byBackslash;
  const byDot = byColon.split('.').pop() ?? byColon;
  return byDot;
}
