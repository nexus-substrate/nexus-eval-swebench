/**
 * SWE-bench BenchmarkAdapter implementation.
 *
 * This adapter wraps the published `SWEBenchRunner` from `nexus-agents` and
 * exposes it through the `BenchmarkAdapter` contract so `runBenchmark()` can
 * orchestrate it (concurrency, timeouts, partial-failure, progress).
 *
 * Scope of this MVP:
 * - `runInstance` generates a prediction (patch) via `SWEBenchRunner.run([i])`
 * - `evaluate` wraps the prediction outcome + error state into a verdict
 *
 * What is NOT in this MVP:
 * - Docker-backed test execution against the SWE-bench evaluation harness
 *   (`EvaluationHarness`). That requires Docker images per repo and is a
 *   separate, out-of-band step. Consumers who need true pass/fail based on
 *   actual test runs should call `EvaluationHarness.evaluateInstance` from
 *   nexus-agents on the predictions file this adapter produces.
 *
 * See https://github.com/williamzujkowski/nexus-agents/issues/1960 for the
 * extraction epic and future-work tracking.
 *
 * @module adapter
 */

import {
  SWEBenchRunner,
  SWEBenchRunnerError,
  type BenchmarkAdapter,
  type BenchmarkRunContext,
  type BenchmarkRunSummary,
  type SWEBenchConfig,
  type SWEBenchInstance,
  type SWEBenchPrediction,
  type SWEBenchVariant,
} from 'nexus-agents';

export type SweBenchInstance = SWEBenchInstance;
export type SweBenchPrediction = SWEBenchPrediction;

/**
 * Verdict shape for one SWE-bench run. This adapter does NOT execute tests;
 * `resolved` here is the generation-completion flag. True test-based
 * resolution requires running the SWE-bench Docker harness on the written
 * predictions file — use `EvaluationHarness.evaluateInstance` for that.
 */
export interface SweBenchAdapterEvalResult {
  readonly instanceId: string;
  /** Whether prediction generation completed without error. */
  readonly generationCompleted: boolean;
  readonly prediction: SWEBenchPrediction;
  readonly error: string | undefined;
  readonly durationMs: number;
  readonly tokensUsed: number | undefined;
  readonly iterations: number | undefined;
}

export interface SweBenchAdapterConfig {
  /** 'lite' | 'verified' | 'full'. Defaults to 'lite'. */
  readonly variant?: SWEBenchVariant;
  /** Pass-through to the underlying SWEBenchRunner. */
  readonly runner?: Partial<SWEBenchConfig>;
}

export class SweBenchAdapter
  implements BenchmarkAdapter<SweBenchInstance, SWEBenchPrediction, SweBenchAdapterEvalResult>
{
  readonly name = 'swe-bench';
  readonly variant: SWEBenchVariant;
  private readonly runner: SWEBenchRunner;
  private readonly cachedResults = new Map<string, SweBenchAdapterEvalResult>();

  constructor(config: SweBenchAdapterConfig = {}) {
    this.variant = config.variant ?? 'lite';
    this.runner = new SWEBenchRunner({
      variant: this.variant,
      ...(config.runner ?? {}),
    });
  }

  async loadInstances(_config: Record<string, unknown>): Promise<readonly SweBenchInstance[]> {
    const result = await this.runner.loadInstances(this.variant);
    if (!result.ok) {
      throw new SWEBenchRunnerError(
        `Failed to load SWE-bench ${this.variant} instances: ${result.error.message}`,
        result.error.code,
        result.error.cause
      );
    }
    return result.value;
  }

  async runInstance(
    instance: SweBenchInstance,
    ctx: BenchmarkRunContext
  ): Promise<SWEBenchPrediction> {
    void ctx;
    const runResult = await this.runner.run([instance]);
    if (!runResult.ok) {
      throw new SWEBenchRunnerError(
        `runInstance failed for ${instance.instance_id}: ${runResult.error.message}`,
        runResult.error.code,
        runResult.error.cause
      );
    }
    const first = runResult.value[0];
    if (first === undefined) {
      throw new Error(`runInstance returned empty result for ${instance.instance_id}`);
    }
    this.cachedResults.set(instance.instance_id, {
      instanceId: instance.instance_id,
      generationCompleted: first.completed,
      prediction: first.prediction ?? {
        instance_id: instance.instance_id,
        model_name_or_path: '',
        model_patch: '',
      },
      error: first.error,
      durationMs: first.duration_ms,
      tokensUsed: first.tokens_used,
      iterations: first.iterations,
    });
    if (first.prediction === undefined) {
      throw new Error(
        `runInstance produced no prediction for ${instance.instance_id}: ${first.error ?? 'no error message'}`
      );
    }
    return first.prediction;
  }

  evaluate(
    instance: SweBenchInstance,
    prediction: SWEBenchPrediction
  ): Promise<SweBenchAdapterEvalResult> {
    const cached = this.cachedResults.get(instance.instance_id);
    if (cached !== undefined) return Promise.resolve(cached);
    // Fallback if evaluate is ever called without a prior runInstance
    // (shouldn't happen under the standard orchestrator flow).
    return Promise.resolve({
      instanceId: instance.instance_id,
      generationCompleted: true,
      prediction,
      error: undefined,
      durationMs: 0,
      tokensUsed: undefined,
      iterations: undefined,
    });
  }

  isPass(result: SweBenchAdapterEvalResult): boolean {
    return result.generationCompleted && result.error === undefined;
  }

  summarize(
    results: readonly SweBenchAdapterEvalResult[],
    runTimeMs: number
  ): BenchmarkRunSummary {
    const passed = results.filter((r) => this.isPass(r)).length;
    const errorCount = results.filter((r) => r.error !== undefined).length;
    const totalTokens = results.reduce((sum, r) => sum + (r.tokensUsed ?? 0), 0);
    return {
      name: this.name,
      variant: this.variant,
      total: results.length,
      passed,
      passRate: results.length > 0 ? passed / results.length : 0,
      runTimeMs,
      metadata: {
        datasetVariant: this.variant,
        errorCount,
        generationCompletedCount: passed,
        totalTokensUsed: totalTokens,
        note: 'pass/fail here reflects prediction generation, not test-harness evaluation. Run EvaluationHarness on predictions for test-based resolution.',
      },
    };
  }
}
