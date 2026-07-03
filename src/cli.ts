#!/usr/bin/env node
/**
 * SWE-bench evaluation CLI.
 *
 * Usage:
 *   nexus-eval-swebench [run] [--variant lite|verified|full] [options]
 *   nexus-eval-swebench --version
 *   nexus-eval-swebench --help
 *
 * Constructs an OpenAI-compatible `IModelAdapter` from env vars
 * (`OPENAI_API_KEY`, optional `OPENAI_BASE_URL`, `MODEL_ID`). Operators
 * who need a different adapter shape (Claude API, Ollama local, …) can
 * compose `SweBenchAdapter` directly via the library API in `index.ts`.
 *
 * @module cli
 */

import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runBenchmark, createOpenAIAdapter } from 'nexus-agents';
import { SweBenchAdapter } from './adapter.js';
import type { SweBenchAdapterConfig, SweBenchVariant } from './types.js';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as { version: string };
export const VERSION = packageJson.version;

const VALID_VARIANTS: readonly SweBenchVariant[] = ['lite', 'verified', 'full'];

const HELP = `nexus-eval-swebench — SWE-bench harness for nexus-agents

Usage:
  nexus-eval-swebench [run] [options]
  nexus-eval-swebench --version
  nexus-eval-swebench --help

Options:
  --variant <lite|verified|full>  Dataset variant. Default: lite.
  --model-id <id>                 Model identifier passed to the OpenAI-compat
                                  endpoint. Default: env MODEL_ID or 'gpt-4o'.
  --dataset <huggingface|path>    Dataset source. Default: huggingface.
  --cache-dir <dir>               Cache dir for HF downloads.
  --limit <n>                     Limit instances. Default: all.
  --concurrency <n>               Max parallel solver calls. Default: 1.
  --timeout <ms>                  Per-instance timeout. Default: 300000.
  --json                          JSON summary instead of human text.
  --help, -h                      Show this help.
  --version, -v                   Show version.

Environment:
  OPENAI_API_KEY      (required) auth for the OpenAI-compat endpoint.
  OPENAI_BASE_URL     (optional) override base URL — point at a workspace
                                proxy or self-hosted vLLM / OpenRouter / etc.
  MODEL_ID            (optional) model identifier — overridden by --model-id.

Notes:
  v0.2 is a model-only baseline — sends each instance's problem_statement
  to the model and parses a unified diff out of the response. Pass/fail
  reflects "did the model produce a non-empty patch", NOT test-based
  resolution. For test-based pass/fail, run the SWE-bench Docker harness
  on the emitted predictions file (out of MVP scope).
`;

function parseVariant(input: string | undefined): SweBenchVariant {
  if (input === undefined) return 'lite';
  if (!VALID_VARIANTS.includes(input as SweBenchVariant)) {
    throw new Error(
      `Invalid --variant '${input}'. Must be one of: ${VALID_VARIANTS.join(', ')}`
    );
  }
  return input as SweBenchVariant;
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.includes('--version') || args.includes('-v')) {
    process.stdout.write(`nexus-eval-swebench ${VERSION}\n`);
    return 0;
  }

  const parsed = parseArgs({
    args: args[0] === 'run' ? args.slice(1) : args,
    options: {
      variant: { type: 'string' },
      'model-id': { type: 'string' },
      dataset: { type: 'string' },
      'cache-dir': { type: 'string' },
      limit: { type: 'string' },
      concurrency: { type: 'string', default: '1' },
      timeout: { type: 'string', default: '300000' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  const apiKey = process.env['OPENAI_API_KEY']?.trim();
  if (apiKey === undefined || apiKey === '') {
    process.stderr.write(
      'Error: OPENAI_API_KEY is not set. Set it to the auth token for your\n' +
        'OpenAI-compat endpoint (real OpenAI, a workspace proxy, vLLM, etc.).\n'
    );
    return 2;
  }

  const variant = parseVariant(parsed.values.variant);
  const modelId =
    parsed.values['model-id'] ?? process.env['MODEL_ID'] ?? 'gpt-4o';
  const baseUrl = process.env['OPENAI_BASE_URL'];
  const limit =
    parsed.values.limit !== undefined ? Number(parsed.values.limit) : undefined;
  const concurrency = Number(parsed.values.concurrency ?? '1');
  const timeoutMs = Number(parsed.values.timeout ?? '300000');

  const modelAdapter = createOpenAIAdapter({
    apiKey,
    modelId,
    ...(baseUrl !== undefined && baseUrl !== '' && { baseUrl }),
  });

  const adapterConfig: SweBenchAdapterConfig = {
    variant,
    ...(parsed.values.dataset !== undefined && { dataset: parsed.values.dataset }),
    ...(parsed.values['cache-dir'] !== undefined && { cacheDir: parsed.values['cache-dir'] }),
  };
  const adapter = new SweBenchAdapter(modelAdapter, adapterConfig);

  const summary = await runBenchmark(adapter, {}, {
    concurrency,
    instanceTimeoutMs: timeoutMs,
    ...(limit !== undefined ? { limit } : {}),
    onProgress: (done: number, total: number): void => {
      if (!parsed.values.json) {
        process.stderr.write(`[${String(done)}/${String(total)}]\r`);
      }
    },
  });

  if (parsed.values.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } else {
    process.stdout.write('\n');
    process.stdout.write(`${adapter.name} (${adapter.variant}, model=${modelId})\n`);
    process.stdout.write(
      `  generated:  ${String(summary.passed)} / ${String(summary.total)} non-empty patches\n`
    );
    process.stdout.write(`  rate:       ${(summary.passRate * 100).toFixed(1)}%\n`);
    process.stdout.write(`  runtime:    ${(summary.runTimeMs / 1000).toFixed(1)}s\n`);
  }

  return summary.passed === summary.total ? 0 : 1;
}

function isDirectExecution(argvPath: string | undefined): boolean {
  return argvPath !== undefined && import.meta.url === pathToFileURL(resolve(argvPath)).href;
}

if (isDirectExecution(process.argv[1])) {
  main(process.argv)
    .then((code) => {
      process.exit(code);
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Fatal: ${msg}\n`);
      process.exit(2);
    });
}
