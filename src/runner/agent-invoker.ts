/**
 * Generate one SWE-bench prediction by calling an `IModelAdapter` from
 * `nexus-agents` with the SWE-bench prompt and extracting the patch.
 *
 * MVP scope:
 *   - One round-trip: system + user prompt → model → patch.
 *   - No agent loop, no workspace clone, no tool use. Pure model-only
 *     baseline. Produces meaningfully worse patches than agentic
 *     approaches but ships a working harness end-to-end.
 *   - v0.3 follow-up: agentic flow via `ICliAdapter` against a cloned
 *     repo workspace.
 *
 * @module runner/agent-invoker
 */

import { ok, err, type IModelAdapter, type Result } from 'nexus-agents';

import type { SweBenchInstance, SweBenchPrediction } from '../types.js';
import { extractPatch } from './patch-extractor.js';
import { composeUserPrompt, getSystemPrompt } from './prompt-template.js';

export interface GeneratePredictionOptions {
  /** Hard timeout for the model call. Default: 5min. */
  readonly timeoutMs?: number;
  /** Model name to record in the prediction. Default: adapter.modelId. */
  readonly modelLabel?: string;
}

/**
 * Generate one prediction. Returns the prediction in the standard
 * snake_case shape the SWE-bench harness consumes.
 *
 * Note that this never throws — generation failures are reported via
 * `Result.err`. Empty patches (model-couldn't-solve-it) come back as
 * `ok({ ...prediction, model_patch: '' })` so the orchestrator can
 * still record the attempt.
 */
export async function generatePrediction(
  instance: SweBenchInstance,
  modelAdapter: IModelAdapter,
  options: GeneratePredictionOptions = {}
): Promise<Result<SweBenchPrediction, Error>> {
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  const modelLabel = options.modelLabel ?? modelAdapter.modelId;

  try {
    const completion = await Promise.race([
      modelAdapter.complete({
        messages: [
          { role: 'system', content: getSystemPrompt() },
          { role: 'user', content: composeUserPrompt(instance) },
        ],
      }),
      timeoutAfter<never>(timeoutMs, `model call exceeded ${String(timeoutMs)}ms`),
    ]);

    if (!completion.ok) {
      return err(new Error(completion.error.message));
    }
    // Some IModelAdapter implementations return `{ content: string }`,
    // others return `{ choices: [{ message: { content } }] }`. Normalise.
    const responseText = extractResponseText(completion.value);
    const patch = extractPatch(responseText);

    return ok({
      instance_id: instance.instanceId,
      model_name_or_path: modelLabel,
      model_patch: patch,
    });
  } catch (caught: unknown) {
    return err(caught instanceof Error ? caught : new Error(String(caught)));
  }
}

function timeoutAfter<T>(ms: number, message: string): Promise<T> {
  return new Promise((_, reject) => {
    const handle = setTimeout(() => {
      reject(new Error(message));
    }, ms);
    // Don't keep the event loop alive just to fire a rejection.
    handle.unref?.();
  });
}

/**
 * Pull the assistant's response text out of an IModelAdapter completion.
 * The shape varies by adapter implementation; this normalises across
 * the common ones without coupling to any specific adapter.
 */
function extractResponseText(value: unknown): string {
  if (typeof value !== 'object' || value === null) return '';
  const obj = value as Record<string, unknown>;
  // Shape A: { content: string }
  if (typeof obj['content'] === 'string') return obj['content'];
  // Shape B: { text: string } (some compat adapters)
  if (typeof obj['text'] === 'string') return obj['text'];
  // Shape C: OpenAI-style { choices: [{ message: { content } }] }
  if (Array.isArray(obj['choices']) && obj['choices'].length > 0) {
    const first = obj['choices'][0] as { message?: { content?: unknown } } | undefined;
    if (
      first !== undefined &&
      typeof first.message === 'object' &&
      first.message !== null &&
      typeof first.message.content === 'string'
    ) {
      return first.message.content;
    }
  }
  return '';
}
