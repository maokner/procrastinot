import OpenAI from 'openai';
import { logger } from './logger.js';

const SYSTEM_PROMPT =
  'You are a strict commitment-device judge. You receive a task, a rubric describing what counts as proof of completion, and a piece of evidence. Decide whether the evidence clearly satisfies the rubric. Be skeptical but fair — if the evidence is ambiguous or unverifiable, answer no. Output JSON: {"passed": boolean, "reason": string}. Keep reason to one sentence.';

const MAX_EVIDENCE_BYTES = 8 * 1024;

export type Verdict = { passed: boolean; reason: string };

function truncateToBytes(input: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(input);
  if (bytes.byteLength <= maxBytes) return input;
  const slice = bytes.slice(0, maxBytes);
  return new TextDecoder('utf-8', { fatal: false }).decode(slice);
}

export type Judge = {
  judge: (args: { task: string; rubric: string; evidence: string }) => Promise<Verdict>;
};

export function createJudge(opts: { apiKey: string; model: string }): Judge {
  const client = new OpenAI({ apiKey: opts.apiKey });

  return {
    async judge({ task, rubric, evidence }) {
      const truncated = truncateToBytes(evidence, MAX_EVIDENCE_BYTES);
      const userContent = `TASK: ${task}\nRUBRIC: ${rubric}\nEVIDENCE:\n${truncated}`;

      logger.info(
        {
          model: opts.model,
          taskPreview: task.slice(0, 120),
          rubricPreview: rubric.slice(0, 120),
          evidenceBytes: new TextEncoder().encode(truncated).byteLength,
        },
        'judge.request',
      );

      const completion = await client.chat.completions.create({
        model: opts.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
      });

      const raw = completion.choices[0]?.message?.content;
      if (typeof raw !== 'string' || raw.length === 0) {
        throw new Error('judge: empty completion');
      }

      logger.info({ raw }, 'judge.response');

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new Error(`judge: response is not valid JSON: ${(err as Error).message}`);
      }

      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof (parsed as { passed?: unknown }).passed !== 'boolean' ||
        typeof (parsed as { reason?: unknown }).reason !== 'string'
      ) {
        throw new Error(`judge: response missing passed/reason fields: ${raw}`);
      }

      const obj = parsed as { passed: boolean; reason: string };
      return { passed: obj.passed, reason: obj.reason };
    },
  };
}
