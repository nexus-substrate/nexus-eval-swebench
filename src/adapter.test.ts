/**
 * Smoke tests for the clean-room SweBenchAdapter.
 *
 * Mocks `IModelAdapter` so tests don't make real model calls. Asserts the
 * BenchmarkAdapter contract end-to-end against a fixture instance.
 */
import { describe, it, expect, vi } from 'vitest';
import { ok, type IModelAdapter } from 'nexus-agents';
import { SweBenchAdapter } from './adapter.js';
import { extractPatch } from './runner/patch-extractor.js';
import { composeUserPrompt, getSystemPrompt } from './runner/prompt-template.js';
import type { SweBenchInstance } from './types.js';

const fixtureInstance: SweBenchInstance = {
  instanceId: 'astropy__astropy-12907',
  repo: 'astropy/astropy',
  baseCommit: 'd16bfe05a744909de4b27f5875fe0d4ed41ce607',
  problemStatement:
    "Modeling's `separability_matrix` does not compute separability correctly for nested CompoundModels",
  testPatch: 'diff --git a/test.py b/test.py\n',
  patch: 'diff --git a/fix.py b/fix.py\n',
};

function makeMockModelAdapter(response: string): IModelAdapter {
  const completion = vi.fn(() => Promise.resolve(ok({ content: response })));
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

describe('SweBenchAdapter', () => {
  it('produces a valid prediction shape from a model response', async () => {
    const patch = '--- a/foo.py\n+++ b/foo.py\n@@ -1,1 +1,1 @@\n-old\n+new\n';
    const adapter = new SweBenchAdapter(makeMockModelAdapter(`\`\`\`diff\n${patch}\n\`\`\``));
    const prediction = await adapter.runInstance(fixtureInstance, {} as never);
    expect(prediction.instance_id).toBe('astropy__astropy-12907');
    expect(prediction.model_name_or_path).toBe('mock-model');
    expect(prediction.model_patch).toContain('--- a/foo.py');
    expect(prediction.model_patch).toContain('+++ b/foo.py');
  });

  it('records empty-patch responses without throwing', async () => {
    const adapter = new SweBenchAdapter(makeMockModelAdapter('I cannot solve this bug.'));
    const prediction = await adapter.runInstance(fixtureInstance, {} as never);
    expect(prediction.model_patch).toBe('');
    const verdict = await adapter.evaluate(fixtureInstance, prediction);
    expect(verdict.generationCompleted).toBe(false);
    expect(adapter.isPass(verdict)).toBe(false);
  });

  it('marks generation-complete when the model returns a non-empty patch', async () => {
    const patch = '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n';
    const adapter = new SweBenchAdapter(
      makeMockModelAdapter(`\`\`\`diff\n${patch}\n\`\`\``)
    );
    const prediction = await adapter.runInstance(fixtureInstance, {} as never);
    const verdict = await adapter.evaluate(fixtureInstance, prediction);
    expect(verdict.generationCompleted).toBe(true);
    expect(adapter.isPass(verdict)).toBe(true);
  });

  it('default variant is lite', () => {
    const adapter = new SweBenchAdapter(makeMockModelAdapter(''));
    expect(adapter.variant).toBe('lite');
  });

  it('honours configured variant', () => {
    const adapter = new SweBenchAdapter(makeMockModelAdapter(''), { variant: 'verified' });
    expect(adapter.variant).toBe('verified');
  });

  it('summarize aggregates verdicts + breakdown metadata', () => {
    const adapter = new SweBenchAdapter(makeMockModelAdapter(''));
    const verdicts = [
      {
        instanceId: 'a',
        generationCompleted: true,
        prediction: { instance_id: 'a', model_name_or_path: 'm', model_patch: '...' },
        durationMs: 100,
      },
      {
        instanceId: 'b',
        generationCompleted: false,
        prediction: { instance_id: 'b', model_name_or_path: 'm', model_patch: '' },
        durationMs: 50,
      },
    ];
    const summary = adapter.summarize(verdicts, 200);
    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(1);
    expect(summary.passRate).toBe(0.5);
    const meta = summary.metadata as Record<string, unknown>;
    expect(meta['emptyPatchCount']).toBe(1);
    expect(meta['generationErrorCount']).toBe(0);
  });
});

describe('extractPatch', () => {
  it('prefers fenced ```diff blocks', () => {
    const response =
      'Some prose.\n```diff\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n```\nMore prose.';
    expect(extractPatch(response)).toContain('--- a/x');
  });

  it('falls back to bare unified-diff', () => {
    const response = '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n';
    expect(extractPatch(response)).toContain('--- a/x');
  });

  it('returns empty string for no-patch responses', () => {
    expect(extractPatch('I cannot fix this.')).toBe('');
  });

  it('normalises trailing whitespace + newline', () => {
    const response = '```diff\n--- a/x   \n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n```';
    const result = extractPatch(response);
    expect(result.endsWith('\n')).toBe(true);
    expect(result).not.toMatch(/[ \t]+\n/);
  });

  it('accepts ```patch-tagged blocks too', () => {
    const response = '```patch\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n```';
    expect(extractPatch(response)).toContain('--- a/x');
  });
});

describe('prompt template', () => {
  it('system prompt names the unified-diff format', () => {
    expect(getSystemPrompt()).toContain('unified diff');
    expect(getSystemPrompt()).toContain('```diff');
  });

  it('user prompt includes repo + base commit + problem statement', () => {
    const prompt = composeUserPrompt(fixtureInstance);
    expect(prompt).toContain('astropy/astropy');
    expect(prompt).toContain('d16bfe05a744909de4b27f5875fe0d4ed41ce607');
    expect(prompt).toContain('separability_matrix');
  });

  it('includes hints when present', () => {
    const prompt = composeUserPrompt({ ...fixtureInstance, hintsText: 'Look at modeling.py' });
    expect(prompt).toContain('Hints:');
    expect(prompt).toContain('modeling.py');
  });

  it('omits the hints block when absent', () => {
    const prompt = composeUserPrompt(fixtureInstance);
    expect(prompt).not.toContain('Hints:');
  });
});
