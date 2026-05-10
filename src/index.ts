/**
 * Library entry point — public exports of the SWE-bench harness.
 *
 * Consumers compose `SweBenchAdapter` with their own `IModelAdapter`
 * and feed it through `runBenchmark` from `nexus-agents`.
 *
 * @module index
 */

export { SweBenchAdapter } from './adapter.js';
export type {
  SweBenchAdapterConfig,
  SweBenchEvalResult,
  SweBenchInstance,
  SweBenchPrediction,
  SweBenchVariant,
} from './types.js';

// Lower-level building blocks — exposed for consumers who want to use
// the loader / generator pieces independently of the adapter.
export { loadSweBenchInstances } from './runner/instance-loader.js';
export { generatePrediction } from './runner/agent-invoker.js';
export type { GeneratePredictionOptions } from './runner/agent-invoker.js';
export { extractPatch } from './runner/patch-extractor.js';
export { composeUserPrompt, getSystemPrompt } from './runner/prompt-template.js';
