import { createServer } from 'http';
import { keccak256, toBytes } from 'viem';
import * as abiPkg from '@procrastinot/abi';
const { Status } = abiPkg;
import type { ChainClients } from './chain.js';
import { getCommitment, submitVerdict } from './chain.js';
import { logger } from './logger.js';

export function createApiServer(clients: ChainClients, port: number): void {
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
      let body = '';
      for await (const chunk of req) body += chunk;

      let commitmentId: bigint;
      try {
        const json = JSON.parse(body) as { commitmentId?: unknown };
        commitmentId = BigInt(json.commitmentId as string);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid body — expected { commitmentId: string }' }));
        return;
      }

      try {
        const commitment = await getCommitment(clients, commitmentId);

        if (commitment.status !== Status.Active) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Commitment is not active' }));
          return;
        }

        if (commitment.attemptsUsed < 1) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No evidence submitted yet' }));
          return;
        }

        const reasonHash = keccak256(toBytes('oracle-withdraw'));
        const txHash = await submitVerdict(clients, {
          commitmentId,
          passed: true,
          reasonHash,
        });

        logger.info({ commitmentId: commitmentId.toString(), txHash }, 'oracle.withdraw.success');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, txHash }));
      } catch (err) {
        logger.error({ err }, 'oracle.withdraw.error');
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Withdraw failed' }));
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
