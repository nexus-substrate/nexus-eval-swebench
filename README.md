# nexus-eval-swebench

SWE-bench (Lite / Verified / Full) evaluation harness for [nexus-agents](https://github.com/williamzujkowski/nexus-agents), implementing the `BenchmarkAdapter` contract from nexus-agents ≥ 2.33.1.

Extracted from the in-tree `packages/nexus-agents/src/swe-bench/` suite per [epic #1960](https://github.com/williamzujkowski/nexus-agents/issues/1960) so benchmarks can evolve independently of the core.

## Install

```sh
npm install nexus-eval-swebench nexus-agents
```

`nexus-agents` is a peer dependency.

## Quick start

```sh
# Run 5 SWE-bench Lite instances in parallel
npx nexus-eval-swebench --variant lite --limit 5 --concurrency 3

# JSON summary for piping into a dashboard
npx nexus-eval-swebench --variant verified --json > run.json
```

## Library usage

```ts
import { runBenchmark } from 'nexus-agents';
import { SweBenchAdapter } from 'nexus-eval-swebench';

const adapter = new SweBenchAdapter({ variant: 'lite' });
const summary = await runBenchmark(adapter, {}, { concurrency: 4, limit: 10 });
console.log(`Resolved ${summary.passed}/${summary.total} (${(summary.passRate * 100).toFixed(1)}%)`);
```

## What this harness does

- Loads SWE-bench instances via the published `SWEBenchRunner` from nexus-agents.
- Invokes the configured agent executor to generate one `model_patch` per instance.
- Surfaces prediction-generation success/failure as the adapter verdict.
- Aggregates totals, error count, and token usage into a `BenchmarkRunSummary`.

## What this harness does NOT do (yet)

**True pass/fail based on actual test runs requires the SWE-bench Docker evaluation harness** — which runs each predicted patch against the original repo's test suite. This adapter's `isPass` reflects whether *prediction generation* completed without error, not whether the patch *resolves the issue*.

To get real test-based resolution on the predictions this harness emits:

```ts
import { EvaluationHarness } from 'nexus-agents';

const evalHarness = new EvaluationHarness();
const result = await evalHarness.evaluate(predictions, {
  datasetName: 'lite',
  predictionsPath: './predictions.jsonl',
  runId: 'my-run',
  maxWorkers: 8,
  cacheLevel: 'env',
  mode: 'docker',
  timeoutSeconds: 1800,
});
```

Wiring the Docker harness directly into `SweBenchAdapter.evaluate()` is tracked as future work — it requires a Docker daemon at runtime, which is out of scope for a generic npm-installable harness.

## Configuration

`SweBenchAdapterConfig`:

| Field     | Type                               | Default  | Notes                                  |
| --------- | ---------------------------------- | -------- | -------------------------------------- |
| `variant` | `'lite' \| 'verified' \| 'full'`   | `'lite'` | Which SWE-bench split to load.         |
| `runner`  | `Partial<SWEBenchConfig>`          | `{}`     | Pass-through to the underlying runner. |

## Related

- [nexus-agents](https://github.com/williamzujkowski/nexus-agents) — MCP server + BenchmarkAdapter contract
- [nexus-eval-template](https://github.com/williamzujkowski/nexus-eval-template) — scaffold this repo was built from
- [SWE-bench paper](https://arxiv.org/abs/2310.06770)

## License

MIT.
