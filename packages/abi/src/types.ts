export enum Status {
  Active = 0,
  Completed = 1,
  Forfeited = 2,
}

export type Commitment = {
  user: `0x${string}`;
  enemy: `0x${string}`;
  stake: bigint;              // USDC 6dp
  oracleFee: bigint;
  initialOracleFee: bigint;
  deadline: bigint;           // unix seconds
  attemptsUsed: number;
  status: Status;
  taskHash: `0x${string}`;
};

export const ATTEMPT_CAP = 3;
