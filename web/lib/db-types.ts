/**
 * Hand-maintained TypeScript types for the Supabase schema.
 * Keep in lockstep with `supabase/migrations/0001_init.sql`.
 * Later we can replace this with `supabase gen types typescript --local`.
 */

export type CommitmentStatus = 'active' | 'completed' | 'forfeited';
export type VerdictEventKind = 'requested' | 'submitted' | 'forfeited';

export type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
};

export type Wallet = {
  id: string;
  profile_id: string;
  address: string;
  chain_id: number;
  verified_at: string;
};

export type Commitment = {
  id: number;
  contract_address: string;
  creator_profile: string | null;
  creator_address: string;
  enemy_profile: string | null;
  enemy_address: string;
  task: string;
  rubric: string;
  stake: string;             // numeric → string in JS
  oracle_fee_init: string;
  oracle_fee_remain: string;
  attempts_used: number;
  deadline: string;          // ISO timestamp
  status: CommitmentStatus;
  tx_hash_created: string;
  tx_hash_resolved: string | null;
  created_at: string;
  updated_at: string;
};

export type VerdictEvent = {
  id: number;
  commitment_id: number | null;
  commitment_contract_address: string | null;
  kind: VerdictEventKind;
  attempt: number | null;
  passed: boolean | null;
  reason_hash: string | null;
  evidence_uri: string | null;
  tx_hash: string;
  block_number: number;
  created_at: string;
};

export type IndexerCursor = {
  id: 1;
  last_block: number;
  updated_at: string;
};

export type DegenBalance = {
  user_id: string;
  balance_usdc: number;
  deposited_usdc: number;
  drop_count: number;
  updated_at: string;
};

export type PlinkoDrop = {
  id: string;
  user_id: string;
  ball_value_usdc: number;
  rows: number;
  slot: number;
  path: string;
  multiplier: string;
  payout_usdc: number;
  balance_before: number;
  balance_after: number;
  server_seed: string;
  server_seed_hash: string;
  client_seed: string;
  nonce: number;
  created_at: string;
};

export type DegenSession = {
  id: string;
  user_id: string;
  wallet_address: string;
  commitment_id: number;
  deposited_usdc: number;
  deposit_tx_hash: string;
  deposited_at: string;
  cashed_out_usdc: number | null;
  cashout_tx_hash: string | null;
  cashed_out_at: string | null;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, 'created_at'> & { created_at?: string };
        Update: Partial<Omit<Profile, 'id'>>;
      };
      wallets: {
        Row: Wallet;
        Insert: Omit<Wallet, 'id' | 'verified_at'> & { id?: string; verified_at?: string };
        Update: Partial<Omit<Wallet, 'id' | 'profile_id'>>;
      };
      commitments: {
        Row: Commitment;
        Insert: Omit<Commitment, 'updated_at'> & { updated_at?: string };
        Update: Partial<Omit<Commitment, 'id'>>;
      };
      verdict_events: {
        Row: VerdictEvent;
        Insert: Omit<VerdictEvent, 'id'>;
        Update: Partial<Omit<VerdictEvent, 'id' | 'commitment_id'>>;
      };
      indexer_cursor: {
        Row: IndexerCursor;
        Insert: Omit<IndexerCursor, 'updated_at'> & { updated_at?: string };
        Update: Partial<Omit<IndexerCursor, 'id'>>;
      };
      degen_balances: {
        Row: DegenBalance;
        Insert: DegenBalance;
        Update: Partial<Omit<DegenBalance, 'user_id'>>;
      };
      plinko_drops: {
        Row: PlinkoDrop;
        Insert: Omit<PlinkoDrop, 'id' | 'created_at'> & { id?: string; created_at?: string };
        Update: Partial<Omit<PlinkoDrop, 'id' | 'user_id'>>;
      };
      degen_sessions: {
        Row: DegenSession;
        Insert: Omit<DegenSession, 'id' | 'deposited_at' | 'cashed_out_usdc' | 'cashout_tx_hash' | 'cashed_out_at'> & {
          id?: string;
          deposited_at?: string;
          cashed_out_usdc?: number | null;
          cashout_tx_hash?: string | null;
          cashed_out_at?: string | null;
        };
        Update: Partial<Omit<DegenSession, 'id' | 'user_id'>>;
      };
    };
    Views: Record<string, never>;
    Functions: {
      resolve_username: {
        Args: { u: string };
        Returns: { address: string; chain_id: number }[];
      };
      search_usernames: {
        Args: { q: string; lim?: number };
        Returns: { username: string; display_name: string | null; avatar_url: string | null }[];
      };
      process_plinko_drop: {
        Args: {
          p_user_id: string;
          p_ball_value_usdc: number;
          p_rows: number;
          p_slot: number;
          p_path: string;
          p_multiplier: number;
          p_payout_usdc: number;
          p_server_seed: string;
          p_server_seed_hash: string;
          p_client_seed: string;
          p_nonce: number;
        };
        Returns: {
          drop_id: string;
          balance_before: number;
          balance_after: number;
          new_drop_count: number;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
