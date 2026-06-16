/**
 * SWE-bench BenchmarkAdapter — clean-room implementation.
 *
 * Self-contained: depends ONLY on public `nexus-agents` types
 * (`BenchmarkAdapter`, `IModelAdapter`, `Result`, …). No internal-helper
 * imports — the eval repo and nexus-agents communicate through the
 * `BenchmarkAdapter` contract at the edge.
 *
 * MVP (v0.2): model-only baseline. The adapter sends each instance's
 * `problem_statement` to the configured `IModelAdapter` and asks for a
 * unified-diff patch. No agent loop, no workspace clone, no Docker eval.
 * Pass/fail here reflects "did the model produce a non-empty patch" —
 * test-based resolution is a separate Docker-harness step (see README).
 *
 * Roadmap to v0.3+: agentic flow via `ICliAdapter` against a cloned
 * repo workspace; Docker eval integration.
 *
 * @module adapter
 */

import type {
  BenchmarkAdapter,
  BenchmarkRunContext,
  BenchmarkRunSummary,
  IModelAdapter,
} from 'nexus-agents';

import { loadSweBenchInstances } from './runner/instance-loader.js';
import { generatePrediction } from './runner/agent-invoker.js';
import type {
  SweBenchAdapterConfig,
  SweBenchEvalResult,
  SweBenchInstance,
  SweBenchPrediction,
  SweBenchVariant,
} from './types.js';

export class SweBenchAdapter
  implements BenchmarkAdapter<SweBenchInstance, SweBenchPrediction, SweBenchEvalResult>
{
  readonly name = 'swe-bench';
  readonly variant: SweBenchVariant;

  private readonly modelAdapter: IModelAdapter;
  private readonly config: SweBenchAdapterConfig;
  private readonly resultCache = new Map<string, SweBenchEvalResult>();

  constructor(modelAdapter: IModelAdapter, config: SweBenchAdapterConfig = {}) {
    this.modelAdapter = modelAdapter;
    this.config = config;
    this.variant = config.variant ?? 'lite';
  }

  loadInstances(_runConfig: Record<string, unknown>): Promise<readonly SweBenchInstance[]> {
    return loadSweBenchInstances({
      variant: this.variant,
      ...(this.config.dataset !== undefined && { source: this.config.dataset }),
      ...(this.config.cacheDir !== undefined && { cacheDir: this.config.cacheDir }),
    });
  }

  async runInstance(
    instance: SweBenchInstance,
    ctx: BenchmarkRunContext
  ): Promise<SweBenchPrediction> {
    const start = Date.now();
    // Thread the orchestrator's per-instance timeout (ultimately the
    // `--timeout` CLI flag via `instanceTimeoutMs`) into the model call.
    // Fall back to generatePrediction's own default only when the context
    // supplies no usable budget.
    const result = await generatePrediction(
      instance,
      this.modelAdapter,
      typeof ctx.timeoutMs === 'number' && ctx.timeoutMs > 0
        ? { timeoutMs: ctx.timeoutMs }
        : {}
    );

    const durationMs = Date.now() - start;
    if (!result.ok) {
      const empty: SweBenchPrediction = {
        instance_id: instance.instanceId,
        model_name_or_path: this.modelAdapter.modelId,
        model_patch: '',
      };
      this.resultCache.set(instance.instanceId, {
        instanceId: instance.instanceId,
        generationCompleted: false,
        prediction: empty,
        error: result.error.message,
        durationMs,
      });
      return empty;
    }

    this.resultCache.set(instance.instanceId, {
      instanceId: instance.instanceId,
      generationCompleted: result.value.model_patch.length > 0,
      prediction: result.value,
      durationMs,
    });
    return result.value;
  }

  evaluate(
    instance: SweBenchInstance,
    prediction: SweBenchPrediction
  ): Promise<SweBenchEvalResult> {
    const cached = this.resultCache.get(instance.instanceId);
    if (cached !== undefined) return Promise.resolve(cached);
    // Defensive fallback if evaluate is ever called without a prior
    // runInstance — shouldn't happen under the standard orchestrator.
    return Promise.resolve({
      instanceId: instance.instanceId,
      generationCompleted: prediction.model_patch.length > 0,
      prediction,
      durationMs: 0,
    });
  }

  isPass(result: SweBenchEvalResult): boolean {
    return result.generationCompleted && result.error === undefined;
  }

  summarize(
    results: readonly SweBenchEvalResult[],
    runTimeMs: number
  ): BenchmarkRunSummary {
    const passed = results.filter((r) => this.isPass(r)).length;
    const errored = results.filter((r) => r.error !== undefined).length;
    const empty = results.filter((r) => r.prediction.model_patch.length === 0).length;
    return {
      name: this.name,
      variant: this.variant,
      total: results.length,
      passed,
      passRate: results.length > 0 ? passed / results.length : 0,
      runTimeMs,
      metadata: {
        datasetVariant: this.variant,
        generationErrorCount: errored,
        emptyPatchCount: empty,
        note: 'pass/fail here reflects prediction generation only. Run the SWE-bench Docker harness on the predictions file for test-based resolution.',
      },
    };
  }
}
