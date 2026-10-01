// The data-access seam. Every module talks to storage through this narrow,
// async surface so the same code runs on SQLite (local development and tests)
// and Postgres (production on Vercel). SQL is kept to the shared subset of the
// two dialects; drivers own the differences.

export type CivicStatement = {
  /** First row, or undefined when the query matches nothing. */
  get(...parameters: unknown[]): Promise<unknown>;
  all(...parameters: unknown[]): Promise<unknown[]>;
  run(...parameters: unknown[]): Promise<void>;
};

export type CivicDatabase = {
  prepare(sql: string): CivicStatement;
  /**
   * Runs fn atomically; cross-connection coordination requires database locks.
   * The outermost transaction invokes onRollback only after confirmed rollback
   * before any COMMIT attempt. Unclassified/commit failures never invoke it.
   * Compensation failures must not replace the original transaction error.
   */
  transaction<T>(fn: () => Promise<T>, onRollback?: () => Promise<void>): Promise<T>;
  close(): Promise<void>;
};
