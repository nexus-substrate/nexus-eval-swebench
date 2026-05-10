# nexus-eval-swebench

SWE-bench (Lite / Verified / Full) evaluation harness for [nexus-agents](https://github.com/williamzujkowski/nexus-agents), implementing the `BenchmarkAdapter` contract.

> **v0.2 — clean-room re-implementation.** This harness is now self-contained: it depends only on public `nexus-agents` types (`BenchmarkAdapter`, `IModelAdapter`, `runBenchmark`) — no internal helpers, no in-tree runtime imports. The original v0.1 thin wrapper around the in-tree `SWEBenchRunner` is replaced by a model-only baseline implemented locally. See [nexus-agents #2515](https://github.com/williamzujkowski/nexus-agents/issues/2515) for the extraction rationale.

## Install

```sh
npm install nexus-eval-swebench nexus-agents
```

`nexus-agents` is a peer dependency.

## Quick start (CLI)

```sh
# Set the OpenAI-compat endpoint
export OPENAI_API_KEY=sk-...
export OPENAI_BASE_URL=https://your-gateway/v1   # optional
export MODEL_ID=anthropic/claude-sonnet-4-6      # optional

# Run 5 SWE-bench Lite instances in parallel
npx nexus-eval-swebench --variant lite --limit 5 --concurrency 3

# JSON summary for piping
npx nexus-eval-swebench --variant verified --json > run.json
```

## Library usage

```ts
import { runBenchmark, createOpenAIAdapter } from 'nexus-agents';
import { SweBenchAdapter } from 'nexus-eval-swebench';

const modelAdapter = createOpenAIAdapter({
  apiKey: process.env.OPENAI_API_KEY!,
  modelId: 'gpt-4o',
});

const adapter = new SweBenchAdapter(modelAdapter, { variant: 'lite' });
const summary = await runBenchmark(adapter, {}, { concurrency: 4, limit: 10 });

console.log(
  `Generated ${summary.passed}/${summary.total} non-empty patches ` +
    `(${(summary.passRate * 100).toFixed(1)}%)`
);
```

Operators with their own `IModelAdapter` (Claude API, Ollama, anything implementing the contract) can substitute it for `createOpenAIAdapter` without changing anything else.

## What this harness does (v0.2 MVP)

- **Loads SWE-bench instances** from HuggingFace (`princeton-nlp/SWE-bench{,-Lite,-Verified}`) or a local `.jsonl` fixture. HF responses are cached under `~/.nexus-eval-swebench/cache/<variant>.jsonl`.
- **Composes a SWE-bench prompt** that surfaces repo, base commit, problem statement, and optional hints. Asks for a unified-diff patch wrapped in a fenced ` ```diff ` block.
- **Invokes the configured `IModelAdapter`** via `complete()` — pure model-only, no agent loop, no workspace clone.
- **Extracts the patch** from the model response (handles fenced ` ```diff ` blocks, ` ```patch ` blocks, and bare unified diffs).
- **Returns predictions** in the standard SWE-bench shape: `{ instance_id, model_name_or_path, model_patch }`.
- **Surfaces per-run metadata**: empty-patch count, generation-error count, dataset variant.

## What v0.2 does NOT do

- **Does NOT run tests** against the predictions. Pass/fail in the summary reflects "did the model produce a non-empty patch", not "does the patch resolve the issue." For test-based resolution, run the upstream SWE-bench Docker harness on the emitted predictions file:

  ```sh
  python -m swebench.harness.run_evaluation \
    --dataset_name princeton-nlp/SWE-bench_Lite \
    --predictions_path ./predictions.jsonl \
    --max_workers 8 \
    --run_id my-run
  ```

- **Does NOT clone repos**. The model only sees `problem_statement` + optional `hints_text`. Real agentic flows (clone repo, navigate codebase, edit files, capture diff) score considerably higher than this baseline. Tracked as v0.3 follow-up — agentic flow via `ICliAdapter` against a cloned workspace.

## Roadmap

- **v0.3**: agentic flow (`ICliAdapter` + workspace clone) for substantially better patch quality
- **v0.4**: optional Docker harness integration for inline test-based resolution
- **v0.5+**: fixture generation, dataset slicing, per-repo breakdowns

Track in this repo's issues.

## Configuration

```ts
interface SweBenchAdapterConfig {
  variant?: 'lite' | 'verified' | 'full';     // default 'lite'
  dataset?: 'huggingface' | string;             // default 'huggingface'; pass a path for .jsonl
  cacheDir?: string;                            // default ~/.nexus-eval-swebench/cache/
}
```

CLI flags: `--variant`, `--model-id`, `--dataset`, `--cache-dir`, `--limit`, `--concurrency`, `--timeout`, `--json`. See `npx nexus-eval-swebench --help`.

Environment for the CLI: `OPENAI_API_KEY` (required), `OPENAI_BASE_URL` (optional), `MODEL_ID` (optional).

## Related

- [nexus-agents](https://github.com/williamzujkowski/nexus-agents) — MCP server + `BenchmarkAdapter` contract
- [nexus-eval-template](https://github.com/williamzujkowski/nexus-eval-template) — scaffold this repo was built from
- [nexus-eval-atbench](https://github.com/williamzujkowski/nexus-eval-atbench) — sibling harness for trajectory safety
- [SWE-bench paper](https://arxiv.org/abs/2310.06770)

## License

MIT.
