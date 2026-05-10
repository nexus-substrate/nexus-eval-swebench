/**
 * SWE-bench instance loader.
 *
 * Two sources:
 *   1. HuggingFace Hub — fetches `princeton-nlp/SWE-bench{,-Lite,-Verified}`
 *      via the public datasets-server JSON endpoint. No auth needed.
 *   2. Local `.jsonl` file — one normalised SweBenchInstance per line.
 *
 * Caching: HuggingFace responses are written to `<cacheDir>/<variant>.jsonl`
 * on first fetch, then read from disk on subsequent calls.
 *
 * @module runner/instance-loader
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { SweBenchInstance, SweBenchVariant } from '../types.js';

const HF_DATASET_BY_VARIANT: Record<SweBenchVariant, string> = {
  lite: 'princeton-nlp/SWE-bench_Lite',
  verified: 'princeton-nlp/SWE-bench_Verified',
  full: 'princeton-nlp/SWE-bench',
};

const HF_DATASETS_SERVER = 'https://datasets-server.huggingface.co/rows';

/**
 * Public surface: load instances from the configured source.
 *
 * @param source - 'huggingface' (default) or an absolute path to a .jsonl file
 * @param variant - dataset variant (lite / verified / full); ignored when
 *   source is a file path
 * @param cacheDir - where to cache HF downloads; ignored when source is a
 *   file path
 * @param maxInstances - optional cap; useful for smoke tests
 */
export async function loadSweBenchInstances(args: {
  readonly source?: 'huggingface' | string;
  readonly variant?: SweBenchVariant;
  readonly cacheDir?: string;
  readonly maxInstances?: number;
}): Promise<readonly SweBenchInstance[]> {
  const source = args.source ?? 'huggingface';
  const variant = args.variant ?? 'lite';

  const all =
    source === 'huggingface'
      ? await loadFromHuggingFace(variant, args.cacheDir)
      : loadFromFile(source);

  if (args.maxInstances !== undefined && args.maxInstances < all.length) {
    return all.slice(0, args.maxInstances);
  }
  return all;
}

/**
 * Read a JSONL file of normalised instances. Each line is a complete
 * SweBenchInstance object.
 */
function loadFromFile(path: string): readonly SweBenchInstance[] {
  if (!existsSync(path)) {
    throw new Error(`SWE-bench fixture not found: ${path}`);
  }
  const raw = readFileSync(path, 'utf8');
  const out: SweBenchInstance[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    out.push(JSON.parse(trimmed) as SweBenchInstance);
  }
  return out;
}

interface HfRow {
  readonly row: Record<string, unknown>;
}

interface HfResponse {
  readonly rows?: readonly HfRow[];
  readonly num_rows_total?: number;
}

/**
 * Fetch the variant from HuggingFace, normalising into our camelCase shape.
 * Caches the JSONL serialisation under `<cacheDir>/<variant>.jsonl` so
 * subsequent calls don't re-fetch.
 *
 * The HF datasets-server paginates responses; we walk the pages until
 * `rows.length === num_rows_total`.
 */
async function loadFromHuggingFace(
  variant: SweBenchVariant,
  cacheDirRaw: string | undefined
): Promise<readonly SweBenchInstance[]> {
  const cacheDir = cacheDirRaw ?? defaultCacheDir();
  const cachePath = `${cacheDir}/${variant}.jsonl`;
  if (existsSync(cachePath)) {
    return loadFromFile(cachePath);
  }

  const dataset = HF_DATASET_BY_VARIANT[variant];
  const all: SweBenchInstance[] = [];
  let offset = 0;
  const length = 100; // HF datasets-server caps page size at 100
  // Bound the loop in case num_rows_total never matches; SWE-bench
  // variants are at most 2294 rows (full), so 100 pages is generous.
  for (let page = 0; page < 100; page += 1) {
    const url = `${HF_DATASETS_SERVER}?dataset=${encodeURIComponent(dataset)}&config=default&split=test&offset=${String(offset)}&length=${String(length)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `HuggingFace dataset fetch failed (${dataset}): HTTP ${String(res.status)} ${res.statusText}`
      );
    }
    const body = (await res.json()) as HfResponse;
    const rows = body.rows ?? [];
    for (const r of rows) {
      all.push(normaliseHfRow(r.row));
    }
    if (rows.length === 0) break;
    if (body.num_rows_total !== undefined && all.length >= body.num_rows_total) break;
    offset += rows.length;
  }

  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(
    cachePath,
    all.map((i) => JSON.stringify(i)).join('\n') + '\n',
    'utf8'
  );
  return all;
}

/**
 * Normalise an HF dataset row (snake_case, may have nullable fields) into
 * the canonical SweBenchInstance shape (camelCase, optional fields removed
 * when undefined).
 */
function normaliseHfRow(row: Record<string, unknown>): SweBenchInstance {
  const str = (k: string): string => {
    const v = row[k];
    return typeof v === 'string' ? v : '';
  };
  const optStr = (k: string): string | undefined => {
    const v = row[k];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };
  const arr = (k: string): readonly string[] | undefined => {
    const v = row[k];
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
    if (typeof v === 'string' && v.length > 0) {
      try {
        const parsed = JSON.parse(v) as unknown;
        if (Array.isArray(parsed))
          return parsed.filter((x): x is string => typeof x === 'string');
      } catch {
        /* fall through */
      }
    }
    return undefined;
  };

  const base: SweBenchInstance = {
    instanceId: str('instance_id'),
    repo: str('repo'),
    baseCommit: str('base_commit'),
    problemStatement: str('problem_statement'),
    testPatch: str('test_patch'),
    patch: str('patch'),
  };
  const hints = optStr('hints_text');
  const version = optStr('version');
  const envCommit = optStr('environment_setup_commit');
  const pass = arr('PASS_TO_PASS');
  const fail = arr('FAIL_TO_PASS');
  return {
    ...base,
    ...(hints !== undefined && { hintsText: hints }),
    ...(version !== undefined && { version }),
    ...(envCommit !== undefined && { environmentSetupCommit: envCommit }),
    ...(pass !== undefined && { passToPass: pass }),
    ...(fail !== undefined && { failToPass: fail }),
  };
}

function defaultCacheDir(): string {
  const home = process.env['HOME'] ?? '/tmp';
  return `${home}/.nexus-eval-swebench/cache`;
}
