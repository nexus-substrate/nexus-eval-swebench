/**
 * Tests that the per-instance timeout (ctx.timeoutMs / --timeout) is
 * actually threaded from the adapter into the model call (#28).
 *
 * Strategy: a mock IModelAdapter whose `complete` never resolves within
 * the timeout. With a small ctx.timeoutMs the generation must abort and
 * surface as an empty patch (recorded error), proving the timeout was
 * honoured rather than the hardcoded 5-minute default.
 */
import { describe, it, expect, vi } from 'vitest';
import { ok, type IModelAdapter } from 'nexus-agents';
import { SweBenchAdapter } from '../adapter.js';
import type { SweBenchInstance } from '../types.js';

const fixtureInstance: SweBenchInstance = {
  instanceId: 'astropy__astropy-1',
  repo: 'astropy/astropy',
  baseCommit: 'deadbeef',
  problemStatement: 'p',
  testPatch: '',
  patch: '',
};

function makeSlowModelAdapter(delayMs: number): IModelAdapter {
  const completion = vi.fn(
    () =>
      new Promise((resolve) => {
        setTimeout(() => resolve(ok({ content: '```diff\n--- a/x\n+++ b/x\n```' })), delayMs);
      })
  );
  return {
    providerId: 'mock',
    modelId: 'mock-model',
    capabilities: [],
    complete: completion as never,
    stream: (() => (async function* () {})()) as never,
    countTokens: () => Promise.resolve(0),
    validateConfig: () => ({ ok: true as const, value: undefined }),
  };
}

describe('timeout threading (#28)', () => {
  it('aborts the model call when ctx.timeoutMs is exceeded', async () => {
    const adapter = new SweBenchAdapter(makeSlowModelAdapter(10_000));
    // 20ms budget — far below the 5-min default. If the timeout were not
    // threaded, this test would hang until the 10s model "call" resolves.
    const prediction = await adapter.runInstance(fixtureInstance, {
      timeoutMs: 20,
    } as never);
    expect(prediction.model_patch).toBe('');
    const verdict = await adapter.evaluate(fixtureInstance, prediction);
    expect(verdict.error).toBeDefined();
    expect(String(verdict.error)).toContain('20ms');
  });
});
