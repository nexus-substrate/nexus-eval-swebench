/**
 * Prompt composition for the model-only baseline.
 *
 * The MVP runner sends `problem_statement` to an `IModelAdapter` and asks
 * for a unified-diff patch. No agent loop, no workspace clone — that's
 * v0.3 follow-up work using `ICliAdapter` against a cloned repo.
 *
 * Even at the model-only baseline the prompt template matters — the
 * model needs to know what shape of answer the harness expects.
 *
 * @module runner/prompt-template
 */

import type { SweBenchInstance } from '../types.js';

const SYSTEM_PROMPT = `You are an expert software engineer fixing a real bug.

You will receive:
1. A repo and base commit identifier (for context only — you do NOT have a checkout).
2. A problem statement describing the bug.
3. Optional hints.

Produce ONE unified diff patch that fixes the bug. Constraints:

- Output must be a valid unified diff with \`---\`/\`+++\` headers, hunk headers (\`@@ ... @@\`), and the +/- lines.
- Patch paths are relative to the repo root, e.g. \`src/foo/bar.py\`.
- Only modify code; do NOT modify tests (the harness adds its own test patch separately).
- If you cannot solve the bug, emit an empty patch — do NOT hallucinate file contents.

Return the patch wrapped in a single fenced code block tagged \`diff\`:

\`\`\`diff
--- a/path/to/file.py
+++ b/path/to/file.py
@@ -10,3 +10,4 @@
 unchanged
-removed
+added
+also added
 unchanged
\`\`\`

No prose before or after the code block.`;

export function composeUserPrompt(instance: SweBenchInstance): string {
  const lines: string[] = [
    `Repo: ${instance.repo}`,
    `Base commit: ${instance.baseCommit}`,
    `Instance: ${instance.instanceId}`,
    '',
    'Problem statement:',
    instance.problemStatement,
  ];
  if (instance.hintsText !== undefined && instance.hintsText.length > 0) {
    lines.push('', 'Hints:', instance.hintsText);
  }
  lines.push('', 'Produce the patch now.');
  return lines.join('\n');
}

export function getSystemPrompt(): string {
  return SYSTEM_PROMPT;
}
