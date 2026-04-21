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
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
