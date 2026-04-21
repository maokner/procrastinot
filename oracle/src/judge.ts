import OpenAI from 'openai';
import type { ChatCompletionContentPart } from 'openai/resources/chat/completions';
import type { Evidence } from './evidence.js';
import { logger } from './logger.js';
import { retry } from './retry.js';

const SYSTEM_PROMPT =
  'You are a strict commitment-device judge. You receive a task, a rubric describing what counts as proof of completion, and a piece of evidence. Evidence may include photographs. If so, judge them against the rubric visually. Be strict but fair. Return JSON: {"passed": boolean, "reason": string}. Keep reason to one sentence.';

const MAX_TEXT_BYTES = 8 * 1024;

export type Verdict = { passed: boolean; reason: string };

function truncateToBytes(input: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(input);
  if (bytes.byteLength <= maxBytes) return input;
  const slice = bytes.slice(0, maxBytes);
  return new TextDecoder('utf-8', { fatal: false }).decode(slice);
}

export type Judge = {
  judge: (args: { task: string; rubric: string; evidence: Evidence }) => Promise<Verdict>;
};

function imageDetail(): 'auto' | 'low' | 'high' {
  const raw = (process.env.OPENAI_IMAGE_DETAIL ?? 'low').toLowerCase();
  if (raw === 'auto' || raw === 'high') return raw;
  return 'low';
}

function buildContentParts(
  task: string,
  rubric: string,
  evidence: Evidence,
): { parts: ChatCompletionContentPart[]; meta: Record<string, unknown> } {
  const header = `TASK: ${task}\nRUBRIC: ${rubric}\nEVIDENCE:`;
  const detail = imageDetail();

  if (evidence.kind === 'text') {
    const truncated = truncateToBytes(evidence.text, MAX_TEXT_BYTES);
    return {
      parts: [{ type: 'text', text: `${header}\n${truncated}` }],
      meta: {
        mode: 'text',
        evidenceBytes: new TextEncoder().encode(truncated).byteLength,
      },
    };
  }

  if (evidence.kind === 'image') {
    return {
      parts: [
        { type: 'text', text: `${header}\n[image below]` },
        {
          type: 'image_url',
          image_url: {
            url: `data:${evidence.mime};base64,${evidence.dataBase64}`,
            detail,
          },
        },
      ],
      meta: {
        mode: 'image',
        imageCount: 1,
        imageBytes: Math.ceil((evidence.dataBase64.length * 3) / 4),
        detail,
      },
    };
  }

  // images
  const noteLine = evidence.note ? `\nNOTE: ${evidence.note}` : '';
  const parts: ChatCompletionContentPart[] = [
    { type: 'text', text: `${header}\n[${evidence.items.length} image(s) below]${noteLine}` },
  ];
  for (const item of evidence.items) {
    parts.push({
      type: 'image_url',
      image_url: {
        url: `data:${item.mime};base64,${item.dataBase64}`,
        detail,
      },
    });
  }
  const totalBytes = evidence.items.reduce(
    (acc, it) => acc + Math.ceil((it.dataBase64.length * 3) / 4),
    0,
  );
  return {
    parts,
    meta: {
      mode: 'images',
      imageCount: evidence.items.length,
      imageBytes: totalBytes,
      detail,
    },
  };
}

export function createJudge(opts: { apiKey: string; model: string }): Judge {
  const client = new OpenAI({ apiKey: opts.apiKey });

  return {
    async judge({ task, rubric, evidence }) {
      const { parts, meta } = buildContentParts(task, rubric, evidence);

      logger.info(
        {
          model: opts.model,
          taskPreview: task.slice(0, 120),
          rubricPreview: rubric.slice(0, 120),
          ...meta,
        },
        meta.mode === 'text' ? 'judge.request' : 'judge.multimodal',
      );

      const completion = await retry(
        () =>
          client.chat.completions.create({
            model: opts.model,
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: parts },
            ],
          }),
        { tries: 3, baseMs: 500, label: 'openai.chat.completions' },
      );

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
