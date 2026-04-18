/**
 * Unit tests for SweBenchAdapter. These exercise the adapter contract
 * without hitting the real SWE-bench dataset or running any executor;
 * loadInstances/runInstance are stubbed so the tests are fast and
 * hermetic.
 */
import { describe, it, expect, vi } from 'vitest';
import type { SWEBenchInstance, SWEBenchPrediction } from 'nexus-agents';
import { SweBenchAdapter } from './adapter.js';

function makeInstance(id: string): SWEBenchInstance {
  return {
    instance_id: id,
    repo: 'example/example',
    base_commit: 'deadbeef',
    problem_statement: `Problem for ${id}`,
    created_at: '2026-01-01T00:00:00Z',
    test_patch: '',
    version: '1.0',
    environment_setup_commit: 'deadbeef',
    FAIL_TO_PASS: [],
    PASS_TO_PASS: [],
  };
}

describe('SweBenchAdapter', () => {
  it('defaults to the lite variant', () => {
    const adapter = new SweBenchAdapter();
    expect(adapter.name).toBe('swe-bench');
    expect(adapter.variant).toBe('lite');
  });

  it('honors variant in config', () => {
    const adapter = new SweBenchAdapter({ variant: 'verified' });
    expect(adapter.variant).toBe('verified');
  });

  it('isPass distinguishes completed from error runs', () => {
    const adapter = new SweBenchAdapter();
    const prediction: SWEBenchPrediction = {
      instance_id: 'a',
      model_name_or_path: 'stub',
      model_patch: 'diff --git a/x b/x',
    };
    expect(
      adapter.isPass({
        instanceId: 'a',
        generationCompleted: true,
        prediction,
        error: undefined,
        durationMs: 10,
        tokensUsed: 100,
        iterations: 1,
      })
    ).toBe(true);
    expect(
      adapter.isPass({
        instanceId: 'a',
        generationCompleted: true,
        prediction,
        error: 'timeout',
        durationMs: 10,
        tokensUsed: 100,
        iterations: 1,
      })
    ).toBe(false);
  });

  it('summarize aggregates verdicts and surfaces dataset metadata', () => {
    const adapter = new SweBenchAdapter({ variant: 'verified' });
    const prediction: SWEBenchPrediction = {
      instance_id: 'a',
      model_name_or_path: 'stub',
      model_patch: 'diff',
    };
    const summary = adapter.summarize(
      [
        {
          instanceId: 'a',
          generationCompleted: true,
          prediction,
          error: undefined,
          durationMs: 10,
          tokensUsed: 500,
          iterations: 2,
        },
        {
          instanceId: 'b',
          generationCompleted: true,
          prediction,
          error: 'failure',
          durationMs: 5,
          tokensUsed: 200,
          iterations: 1,
        },
      ],
      1234
    );
    expect(summary.name).toBe('swe-bench');
    expect(summary.variant).toBe('verified');
    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(1);
    expect(summary.passRate).toBe(0.5);
    expect(summary.runTimeMs).toBe(1234);
    expect(summary.metadata['datasetVariant']).toBe('verified');
    expect(summary.metadata['errorCount']).toBe(1);
    expect(summary.metadata['totalTokensUsed']).toBe(700);
  });

  it('evaluate returns cached result when runInstance populated one', async () => {
    const adapter = new SweBenchAdapter();
    // @ts-expect-error — accessing private cache for test seeding
    adapter.cachedResults.set('inst-1', {
      instanceId: 'inst-1',
      generationCompleted: true,
      prediction: {
        instance_id: 'inst-1',
        model_name_or_path: 'stub',
        model_patch: 'diff',
      },
      error: undefined,
      durationMs: 42,
      tokensUsed: 123,
      iterations: 2,
    });
    const instance = makeInstance('inst-1');
    const result = await adapter.evaluate(instance, {
      instance_id: 'inst-1',
      model_name_or_path: 'stub',
      model_patch: 'diff',
    });
    expect(result.durationMs).toBe(42);
    expect(result.tokensUsed).toBe(123);
  });

  it('loadInstances surfaces runner errors', async () => {
    const adapter = new SweBenchAdapter();
    // @ts-expect-error — replace the internal runner with a stub
    adapter.runner = {
      loadInstances: vi.fn().mockResolvedValue({
        ok: false,
        error: { message: 'dataset not found', code: 'DATASET_NOT_FOUND', cause: undefined },
      }),
    };
    await expect(adapter.loadInstances({})).rejects.toThrow(/dataset not found/);
  });
});
