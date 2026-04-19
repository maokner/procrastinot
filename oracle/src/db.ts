import Database from 'better-sqlite3';
import type { Database as DatabaseType, Statement } from 'better-sqlite3';

export type VerdictStatus = 'pending' | 'submitted' | 'failed';

export type TaskRow = {
  commitment_id: string;
  task: string;
  rubric: string;
};

export type VerdictRow = {
  commitment_id: string;
  attempt_number: number;
  status: VerdictStatus;
  passed: number | null;
  reason: string | null;
  tx_hash: string | null;
  evidence_uri: string | null;
};

export type OracleDb = {
  raw: DatabaseType;
  getCursor: () => bigint | null;
  setCursor: (block: bigint) => void;
  upsertTask: (row: TaskRow) => void;
  getTask: (commitmentId: string) => TaskRow | undefined;
  insertVerdict: (row: {
    commitment_id: string;
    attempt_number: number;
    evidence_uri: string;
  }) => { inserted: boolean };
  markVerdictSubmitted: (args: {
    commitment_id: string;
    attempt_number: number;
    passed: boolean;
    reason: string;
    tx_hash: string | null;
  }) => void;
  markVerdictFailed: (args: {
    commitment_id: string;
    attempt_number: number;
    reason: string;
  }) => void;
  getPendingVerdicts: () => VerdictRow[];
  close: () => void;
};

const CURSOR_KEY = 'last_block';

export function openDb(dbPath: string): OracleDb {
  const raw = new Database(dbPath);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');

  raw.exec(`
    CREATE TABLE IF NOT EXISTS cursor (
      key   TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      commitment_id TEXT PRIMARY KEY,
      task          TEXT NOT NULL,
      rubric        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS verdicts (
      commitment_id  TEXT NOT NULL,
      attempt_number INTEGER NOT NULL,
      status         TEXT NOT NULL,
      passed         INTEGER,
      reason         TEXT,
      tx_hash        TEXT,
      evidence_uri   TEXT,
      PRIMARY KEY (commitment_id, attempt_number)
    );
  `);

  const stmts = {
    getCursor: raw.prepare<[string]>('SELECT value FROM cursor WHERE key = ?'),
    setCursor: raw.prepare<[string, string]>(
      'INSERT INTO cursor(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ),
    upsertTask: raw.prepare<[string, string, string]>(
      `INSERT INTO tasks(commitment_id, task, rubric) VALUES(?, ?, ?)
       ON CONFLICT(commitment_id) DO UPDATE SET task = excluded.task, rubric = excluded.rubric`,
    ),
    getTask: raw.prepare<[string]>('SELECT commitment_id, task, rubric FROM tasks WHERE commitment_id = ?'),
    insertVerdict: raw.prepare<[string, number, string]>(
      `INSERT OR IGNORE INTO verdicts(commitment_id, attempt_number, status, evidence_uri)
       VALUES(?, ?, 'pending', ?)`,
    ),
    markSubmitted: raw.prepare<[number, string, string | null, string, number]>(
      `UPDATE verdicts SET status = 'submitted', passed = ?, reason = ?, tx_hash = ?
       WHERE commitment_id = ? AND attempt_number = ?`,
    ),
    markFailed: raw.prepare<[string, string, number]>(
      `UPDATE verdicts SET status = 'failed', reason = ?
       WHERE commitment_id = ? AND attempt_number = ?`,
    ),
    getPending: raw.prepare<[]>(
      `SELECT commitment_id, attempt_number, status, passed, reason, tx_hash, evidence_uri
       FROM verdicts WHERE status = 'pending' ORDER BY commitment_id, attempt_number`,
    ),
  } satisfies Record<string, Statement>;

  return {
    raw,
    getCursor(): bigint | null {
      const row = stmts.getCursor.get(CURSOR_KEY) as { value: number | bigint } | undefined;
      if (!row) return null;
      return BigInt(row.value);
    },
    setCursor(block: bigint) {
      stmts.setCursor.run(CURSOR_KEY, block.toString());
    },
    upsertTask(row: TaskRow) {
      stmts.upsertTask.run(row.commitment_id, row.task, row.rubric);
    },
    getTask(commitmentId: string) {
      return stmts.getTask.get(commitmentId) as TaskRow | undefined;
    },
    insertVerdict({ commitment_id, attempt_number, evidence_uri }) {
      const res = stmts.insertVerdict.run(commitment_id, attempt_number, evidence_uri);
      return { inserted: res.changes > 0 };
    },
    markVerdictSubmitted({ commitment_id, attempt_number, passed, reason, tx_hash }) {
      stmts.markSubmitted.run(passed ? 1 : 0, reason, tx_hash, commitment_id, attempt_number);
    },
    markVerdictFailed({ commitment_id, attempt_number, reason }) {
      stmts.markFailed.run(reason, commitment_id, attempt_number);
    },
    getPendingVerdicts() {
      return stmts.getPending.all() as VerdictRow[];
    },
    close() {
      raw.close();
    },
  };
}
