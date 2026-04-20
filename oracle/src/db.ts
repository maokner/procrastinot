import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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
  passed: boolean | null;
  reason: string | null;
  tx_hash: string | null;
  evidence_uri: string | null;
};

export type OracleDb = {
  client: SupabaseClient;
  getCursor: () => Promise<bigint | null>;
  setCursor: (block: bigint) => Promise<void>;
  upsertTask: (row: TaskRow) => Promise<void>;
  getTask: (commitmentId: string) => Promise<TaskRow | undefined>;
  insertVerdict: (row: {
    commitment_id: string;
    attempt_number: number;
    evidence_uri: string;
  }) => Promise<{ inserted: boolean }>;
  markVerdictSubmitted: (args: {
    commitment_id: string;
    attempt_number: number;
    passed: boolean;
    reason: string;
    tx_hash: string | null;
  }) => Promise<void>;
  markVerdictFailed: (args: {
    commitment_id: string;
    attempt_number: number;
    reason: string;
  }) => Promise<void>;
  getPendingVerdicts: () => Promise<VerdictRow[]>;
  close: () => void;
};

const CURSOR_KEY = 'last_block';

export function openDb(args: {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}): OracleDb {
  const client = createClient(args.supabaseUrl, args.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Client-Info': 'procrastinot-oracle' } },
  });

  return {
    client,

    async getCursor(): Promise<bigint | null> {
      const { data, error } = await client
        .from('oracle_cursor')
        .select('value')
        .eq('key', CURSOR_KEY)
        .maybeSingle();
      if (error) throw new Error(`getCursor: ${error.message}`);
      if (!data) return null;
      return BigInt(data.value);
    },

    async setCursor(block: bigint): Promise<void> {
      const { error } = await client
        .from('oracle_cursor')
        .upsert(
          { key: CURSOR_KEY, value: Number(block), updated_at: new Date().toISOString() },
          { onConflict: 'key' },
        );
      if (error) throw new Error(`setCursor: ${error.message}`);
    },

    async upsertTask(row: TaskRow): Promise<void> {
      const { error } = await client
        .from('oracle_tasks')
        .upsert(
          { commitment_id: row.commitment_id, task: row.task, rubric: row.rubric },
          { onConflict: 'commitment_id' },
        );
      if (error) throw new Error(`upsertTask: ${error.message}`);
    },

    async getTask(commitmentId: string): Promise<TaskRow | undefined> {
      const { data, error } = await client
        .from('oracle_tasks')
        .select('commitment_id, task, rubric')
        .eq('commitment_id', commitmentId)
        .maybeSingle();
      if (error) throw new Error(`getTask: ${error.message}`);
      if (!data) return undefined;
      return data as TaskRow;
    },

    async insertVerdict({ commitment_id, attempt_number, evidence_uri }) {
      // ignoreDuplicates makes this idempotent: replays of the same
      // VerdictRequested event won't overwrite a later status.
      const { data, error } = await client
        .from('oracle_verdicts')
        .upsert(
          {
            commitment_id,
            attempt_number,
            status: 'pending',
            evidence_uri,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'commitment_id,attempt_number', ignoreDuplicates: true },
        )
        .select('commitment_id');
      if (error) throw new Error(`insertVerdict: ${error.message}`);
      return { inserted: (data?.length ?? 0) > 0 };
    },

    async markVerdictSubmitted({ commitment_id, attempt_number, passed, reason, tx_hash }) {
      const { error } = await client
        .from('oracle_verdicts')
        .update({
          status: 'submitted',
          passed,
          reason,
          tx_hash,
          updated_at: new Date().toISOString(),
        })
        .eq('commitment_id', commitment_id)
        .eq('attempt_number', attempt_number);
      if (error) throw new Error(`markVerdictSubmitted: ${error.message}`);
    },

    async markVerdictFailed({ commitment_id, attempt_number, reason }) {
      const { error } = await client
        .from('oracle_verdicts')
        .update({
          status: 'failed',
          reason,
          updated_at: new Date().toISOString(),
        })
        .eq('commitment_id', commitment_id)
        .eq('attempt_number', attempt_number);
      if (error) throw new Error(`markVerdictFailed: ${error.message}`);
    },

    async getPendingVerdicts(): Promise<VerdictRow[]> {
      const { data, error } = await client
        .from('oracle_verdicts')
        .select('commitment_id, attempt_number, status, passed, reason, tx_hash, evidence_uri')
        .eq('status', 'pending')
        .order('updated_at', { ascending: true });
      if (error) throw new Error(`getPendingVerdicts: ${error.message}`);
      return (data ?? []) as VerdictRow[];
    },

    close() {
      // no-op — Supabase client holds no long-lived connection.
    },
  };
}
