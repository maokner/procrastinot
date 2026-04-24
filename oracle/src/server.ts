import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { isAddress, keccak256, parseUnits, toBytes } from 'viem';
import * as abiPkg from '@procrastinot/abi';
const { Status } = abiPkg;
import type { ChainClients } from './chain.js';
import {
  getCommitment,
  releaseFromVault,
  submitVerdict,
  submitVerdictToVault,
} from './chain.js';
import { logger } from './logger.js';
import type { SupabaseAdminClient } from './supabase.js';

const USDC_DECIMALS = 6;

type JsonBody = Record<string, unknown>;

function writeJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<JsonBody> {
  let body = '';
  for await (const chunk of req) body += chunk;
  const json = JSON.parse(body) as unknown;
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('body must be a JSON object');
  }
  return json as JsonBody;
}

function parseCommitmentId(value: unknown): bigint {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    throw new Error('commitmentId is required');
  }
  return BigInt(value);
}

function parseApiAddress(value: unknown, name: string): `0x${string}` {
  if (typeof value !== 'string' || !isAddress(value)) {
    throw new Error(`${name} must be a 0x-prefixed address`);
  }
  return value as `0x${string}`;
}

function parseRequiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function parseUsdcAmount(json: JsonBody): bigint | null {
  if (typeof json.amountMicroUsdc === 'string' || typeof json.amountMicroUsdc === 'number') {
    return BigInt(json.amountMicroUsdc);
  }
  if (typeof json.amountUnits === 'string' || typeof json.amountUnits === 'number') {
    return BigInt(json.amountUnits);
  }
  if (typeof json.amountUsdc === 'string' || typeof json.amountUsdc === 'number') {
    return parseUnits(String(json.amountUsdc), USDC_DECIMALS);
  }
  if (typeof json.amount === 'string' || typeof json.amount === 'number') {
    const raw = String(json.amount);
    return raw.includes('.') ? parseUnits(raw, USDC_DECIMALS) : BigInt(raw);
  }
  return null;
}

async function markApiVerdictSubmitted(
  supabase: SupabaseAdminClient,
  args: {
    commitmentId: bigint;
    attemptNumber: number;
    passed: boolean;
    reason: string;
    txHash: string;
  },
): Promise<void> {
  const { error } = await supabase.from('oracle_verdicts').upsert(
    {
      commitment_id: args.commitmentId.toString(),
      attempt_number: args.attemptNumber,
      status: 'submitted',
      passed: args.passed,
      reason: args.reason,
      tx_hash: args.txHash,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'commitment_id,attempt_number' },
  );
  if (error) throw new Error(`markApiVerdictSubmitted: ${error.message}`);
}

async function loadReleaseFromCommitment(
  supabase: SupabaseAdminClient,
  commitmentId: bigint,
): Promise<{ to: `0x${string}`; amount: bigint }> {
  const { data, error } = await supabase
    .from('commitments')
    .select('creator_address, stake')
    .eq('id', commitmentId.toString())
    .maybeSingle();
  if (error) throw new Error(`loadReleaseFromCommitment: ${error.message}`);
  if (!data) throw new Error('commitment not found');

  const row = data as { creator_address: string; stake: string };
  return {
    to: parseApiAddress(row.creator_address, 'creator_address'),
    amount: parseUnits(row.stake, USDC_DECIMALS),
  };
}

export function createApiServer(
  clients: ChainClients,
  supabase: SupabaseAdminClient,
  port: number,
): void {
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url === '/api/withdraw') {
      let commitmentId: bigint;
      try {
        const json = await readJsonBody(req);
        commitmentId = parseCommitmentId(json.commitmentId);
      } catch {
        writeJson(res, 400, { error: 'Invalid body — expected { commitmentId: string }' });
        return;
      }

      try {
        const commitment = await getCommitment(clients, commitmentId);

        if (commitment.status !== Status.Active) {
          writeJson(res, 400, { error: 'Commitment is not active' });
          return;
        }

        if (commitment.attemptsUsed < 1) {
          writeJson(res, 400, { error: 'No evidence submitted yet' });
          return;
        }

        const reasonHash = keccak256(toBytes('oracle-withdraw'));
        const txHash = await submitVerdict(clients, {
          commitmentId,
          passed: true,
          reasonHash,
        });

        logger.info({ commitmentId: commitmentId.toString(), txHash }, 'oracle.withdraw.success');
        writeJson(res, 200, { success: true, txHash });
      } catch (err) {
        logger.error({ err }, 'oracle.withdraw.error');
        writeJson(res, 500, { error: 'Withdraw failed' });
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/api/degen') {
      let commitmentId: bigint;
      let reason: string;
      let profileId: string;
      let walletAddress: `0x${string}`;
      try {
        const json = await readJsonBody(req);
        commitmentId = parseCommitmentId(json.commitmentId);
        profileId = parseRequiredString(json.profileId, 'profileId');
        walletAddress = parseApiAddress(json.walletAddress, 'walletAddress');
        reason =
          typeof json.reason === 'string' && json.reason.trim().length > 0
            ? json.reason.trim()
            : 'degen-mode';
      } catch {
        writeJson(res, 400, {
          error: 'Invalid body — expected { commitmentId: string, profileId: string, walletAddress: string }',
        });
        return;
      }

      try {
        const commitment = await getCommitment(clients, commitmentId);

        if (commitment.status !== Status.Active) {
          writeJson(res, 400, { error: 'Commitment is not active' });
          return;
        }

        if (commitment.attemptsUsed < 1) {
          writeJson(res, 400, { error: 'No evidence submitted yet' });
          return;
        }

        const reasonHash = keccak256(toBytes(reason));
        const { verdictTxHash, topUpTxHash } = await submitVerdictToVault(clients, {
          commitmentId,
          reasonHash,
        });

        const { error: depositError } = await supabase.rpc('record_degen_deposit', {
          p_user_id: profileId,
          p_wallet_address: walletAddress,
          p_commitment_id: commitmentId.toString(),
          p_deposited_usdc: Number(commitment.stake),
          p_deposit_tx_hash: verdictTxHash,
        });
        if (depositError) throw new Error(`record_degen_deposit: ${depositError.message}`);

        try {
          await markApiVerdictSubmitted(supabase, {
            commitmentId,
            attemptNumber: commitment.attemptsUsed,
            passed: true,
            reason,
            txHash: verdictTxHash,
          });
        } catch (err) {
          logger.warn({ err, commitmentId: commitmentId.toString() }, 'oracle.degen.supabaseError');
        }

        logger.info(
          {
            commitmentId: commitmentId.toString(),
            profileId,
            walletAddress,
            depositedUsdc: commitment.stake.toString(),
            txHash: verdictTxHash,
            topUpTxHash,
            vaultAddress: clients.degenVaultAddress,
          },
          'oracle.degen.success',
        );
        writeJson(res, 200, { success: true, txHash: verdictTxHash, vaultTopUpTxHash: topUpTxHash });
      } catch (err) {
        logger.error({ err }, 'oracle.degen.error');
        writeJson(res, 500, { error: 'Degen submission failed' });
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/api/vault-release') {
      let commitmentId: bigint | null = null;
      let to: `0x${string}` | null = null;
      let amount: bigint | null = null;

      try {
        const json = await readJsonBody(req);
        if (json.commitmentId !== undefined) {
          commitmentId = parseCommitmentId(json.commitmentId);
          const loaded = await loadReleaseFromCommitment(supabase, commitmentId);
          const recipient = json.to ?? json.walletAddress ?? json.recipient;
          to = recipient === undefined ? loaded.to : parseApiAddress(recipient, 'to');
          amount = parseUsdcAmount(json) ?? loaded.amount;
        } else {
          to = parseApiAddress(json.to ?? json.walletAddress ?? json.recipient, 'to');
          amount = parseUsdcAmount(json);
        }

        if (amount === null || amount <= 0n) {
          throw new Error('amount is required');
        }
      } catch (err) {
        logger.warn({ err }, 'oracle.vaultRelease.badRequest');
        writeJson(res, 400, {
          error:
            'Invalid body — expected { commitmentId: string } or { walletAddress: address, amount: string }',
        });
        return;
      }

      try {
        const { topUpTxHash, releaseTxHash } = await releaseFromVault(clients, {
          to,
          amount,
        });

        logger.info(
          {
            commitmentId: commitmentId?.toString() ?? null,
            to,
            amount: amount.toString(),
            releaseTxHash,
            topUpTxHash,
          },
          'oracle.vaultRelease.success',
        );
        writeJson(res, 200, {
          success: true,
          txHash: releaseTxHash,
          releaseTxHash,
          vaultTopUpTxHash: topUpTxHash,
        });
      } catch (err) {
        logger.error({ err }, 'oracle.vaultRelease.error');
        writeJson(res, 500, { error: 'Vault release failed' });
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(port, () => {
    logger.info({ port }, 'oracle.api.listening');
  });
}
