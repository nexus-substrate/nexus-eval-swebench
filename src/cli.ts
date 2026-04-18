#!/usr/bin/env node
/**
 * SWE-bench evaluation CLI.
 *
 * Usage:
 *   nexus-eval-swebench run [--variant lite|verified|full] [--limit N] [--concurrency N]
 *   nexus-eval-swebench --json > results.json
 *   nexus-eval-swebench --help
 *
 * @module cli
 */

import { parseArgs } from 'node:util';
import { runBenchmark, type SWEBenchVariant } from 'nexus-agents';
import { SweBenchAdapter } from './adapter.js';

const VALID_VARIANTS: readonly SWEBenchVariant[] = ['lite', 'verified', 'full'];

const HELP = `nexus-eval-swebench — SWE-bench harness for nexus-agents

Usage:
  nexus-eval-swebench [run] [options]
  nexus-eval-swebench --version
  nexus-eval-swebench --help

Options:
  --variant <lite|verified|full>  Dataset variant. Default: lite.
  --limit <n>                     Limit instances evaluated. Default: all.
  --concurrency <n>               Max parallel solver calls. Default: 1.
  --timeout <ms>                  Per-instance timeout. Default: 300000.
  --json                          Emit JSON summary instead of human text.
  --help, -h                      Show this help.
  --version, -v                   Show version.

Notes:
  This harness produces PREDICTIONS via nexus-agents' SWEBenchRunner. For
  true test-based resolution, run the SWE-bench Docker evaluation harness
  on the emitted predictions file — see the README.
`;

function parseVariant(input: string | undefined): SWEBenchVariant {
  if (input === undefined) return 'lite';
  if (!VALID_VARIANTS.includes(input as SWEBenchVariant)) {
    throw new Error(`Invalid --variant '${input}'. Must be one of: ${VALID_VARIANTS.join(', ')}`);
  }
  return input as SWEBenchVariant;
}

async function main(argv: readonly string[]): Promise<number> {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.includes('--version') || args.includes('-v')) {
    process.stdout.write('nexus-eval-swebench 0.1.0\n');
    return 0;
  }

  const parsed = parseArgs({
    args: args[0] === 'run' ? args.slice(1) : args,
    options: {
      variant: { type: 'string' },
      limit: { type: 'string' },
      concurrency: { type: 'string', default: '1' },
      timeout: { type: 'string', default: '300000' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  const variant = parseVariant(parsed.values.variant);
  const limit = parsed.values.limit !== undefined ? Number(parsed.values.limit) : undefined;
  const concurrency = Number(parsed.values.concurrency ?? '1');
  const timeoutMs = Number(parsed.values.timeout ?? '300000');

  const adapter = new SweBenchAdapter({ variant });

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
    process.stdout.write(`${adapter.name} (${adapter.variant})\n`);
    process.stdout.write(`  passed:  ${String(summary.passed)} / ${String(summary.total)}\n`);
    process.stdout.write(`  rate:    ${(summary.passRate * 100).toFixed(1)}%\n`);
    process.stdout.write(`  runtime: ${(summary.runTimeMs / 1000).toFixed(1)}s\n`);
  }

  return summary.passed === summary.total ? 0 : 1;
}

main(process.argv)
  .then((code) => {
    process.exit(code);
  })
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Fatal: ${msg}\n`);
    process.exit(2);
  });
