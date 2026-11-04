/** D1-compatible test adapter with real SQLite transaction/rollback semantics. */
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
export function sqliteD1(sqlite: DatabaseSync) {
  return {
    prepare(sql: string) {
      let args: SQLInputValue[] = [];
      const statement = {
        bind(...values: unknown[]) { args = values as SQLInputValue[]; return statement; },
        async first<T>() { await Promise.resolve(); return (sqlite.prepare(sql).get(...args) || null) as T | null; },
        runSync() { return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }; },
        async run() { await Promise.resolve(); return statement.runSync(); },
      };
      return statement;
    },
    async batch(statements: Array<{ runSync(): { meta: { changes: number } } }>) {
      sqlite.exec("BEGIN IMMEDIATE");
      try { const result = statements.map(s => s.runSync()); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
}
