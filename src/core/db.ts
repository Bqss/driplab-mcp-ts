/**
 * Read-only SQLite access with schema introspection.
 *
 * One `Database` instance wraps a single product's SQLite file. Connections are
 * opened read-only via better-sqlite3's `readonly: true` so even malformed
 * queries can never mutate data.
 */

import Database from "better-sqlite3";
import type { Database as DBInstance } from "better-sqlite3";
import { resolve } from "node:path";

export type Product = "wajom" | "dripsender";

export class SqlDatabase {
  readonly product: Product;
  readonly path: string;
  private readonly _columns: Map<string, string[]> = new Map();

  constructor(path: string, product: Product) {
    this.path = resolve(path);
    this.product = product;
    const db = new Database(this.path, { readonly: true, fileMustExist: true });
    try {
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
        .all() as { name: string }[];
      for (const { name } of tables) {
        const cols = db.prepare(`PRAGMA table_info(${name})`).all() as {
          name: string;
        }[];
        this._columns.set(name, cols.map((c) => c.name));
      }
    } finally {
      db.close();
    }
  }

  // -- introspection -------------------------------------------------

  columns(table: string): string[] {
    return this._columns.get(table) ?? [];
  }

  hasTable(table: string): boolean {
    return this._columns.has(table);
  }

  hasColumn(table: string, column: string): boolean {
    return this._columns.get(table)?.includes(column) ?? false;
  }

  selectColumns(table: string, allowed: string[]): string[] {
    const actual = new Set(this._columns.get(table) ?? []);
    return allowed.filter((c) => actual.has(c));
  }

  // -- queries -------------------------------------------------------

  query<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    const db = new Database(this.path, { readonly: true });
    try {
      db.pragma("query_only = 1");
      return db.prepare(sql).all(...params) as T[];
    } finally {
      db.close();
    }
  }

  queryOne<T = Record<string, unknown>>(
    sql: string,
    ...params: unknown[]
  ): T | undefined {
    const db = new Database(this.path, { readonly: true });
    try {
      db.pragma("query_only = 1");
      return db.prepare(sql).get(...params) as T | undefined;
    } finally {
      db.close();
    }
  }
}
