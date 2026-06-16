/**
 * Tests for the SWE-bench instance loader's resilience:
 *   - a malformed JSONL line is skipped (with a warning) rather than
 *     aborting the whole load (#29)
 *   - the HuggingFace cache is written atomically (temp file + rename)
 *     so an interrupted write cannot self-poison future reads (#29)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSweBenchInstances } from './instance-loader.js';
import type { SweBenchInstance } from '../types.js';

function makeInstance(id: string): SweBenchInstance {
  return {
    instanceId: id,
    repo: 'octo/cat',
    baseCommit: 'deadbeef',
    problemStatement: 'p',
    testPatch: '',
    patch: '',
  };
}

describe('loadFromFile resilience (#29)', () => {
  let dir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'swebench-loader-'));
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warnSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it('skips a malformed line and still returns the good instances', async () => {
    const path = join(dir, 'fixture.jsonl');
    const good1 = JSON.stringify(makeInstance('a'));
    const good2 = JSON.stringify(makeInstance('b'));
    // Line 2 is truncated JSON (simulating an interrupted write).
    writeFileSync(path, `${good1}\n{"instanceId": "broken"\n${good2}\n`, 'utf8');

    const out = await loadSweBenchInstances({ source: path });
    expect(out.map((i) => i.instanceId)).toEqual(['a', 'b']);
    // The skip must be reported, naming the file + line number.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = String(warnSpy.mock.calls[0]?.[0]);
    expect(msg).toContain(path);
    expect(msg).toContain('line 2');
  });

  it('does not warn when every line parses', async () => {
    const path = join(dir, 'clean.jsonl');
    writeFileSync(
      path,
      [makeInstance('a'), makeInstance('b')].map((i) => JSON.stringify(i)).join('\n') + '\n',
      'utf8'
    );
    const out = await loadSweBenchInstances({ source: path });
    expect(out).toHaveLength(2);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('HuggingFace cache atomic write (#29)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'swebench-cache-'));
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () =>
            Promise.resolve({
              num_rows_total: 1,
              rows: [
                {
                  row: {
                    instance_id: 'hf__1',
                    repo: 'octo/cat',
                    base_commit: 'beef',
                    problem_statement: 'p',
                    test_patch: '',
                    patch: '',
                  },
                },
              ],
            }),
        })
      ) as unknown as typeof fetch
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the cache and leaves no temp file behind', async () => {
    const out = await loadSweBenchInstances({
      source: 'huggingface',
      variant: 'lite',
      cacheDir: dir,
    });
    expect(out.map((i) => i.instanceId)).toEqual(['hf__1']);
    // The final cache file exists...
    expect(existsSync(join(dir, 'lite.jsonl'))).toBe(true);
    // ...and no leftover temp (.tmp) file was left behind.
    const stray = readdirSync(dir).filter((f) => f !== 'lite.jsonl');
    expect(stray).toEqual([]);
  });
});
