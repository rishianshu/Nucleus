/**
 * Signal Evaluator - gRPC bridge to Go brain-core ExtractSignals
 * 
 * Note: Signal evaluation now happens in Go via Temporal activities.
 * This stub provides backward compatibility for the GraphQL mutation.
 */
import type { SignalStore, SignalDefinition } from "./types.js";

export type EvaluateSignalsOptions = {
  now?: Date;
  definitionSlugs?: string[];
  dryRun?: boolean;
  sourceRunId?: string | null;
};

export type SignalEvaluationSummary = {
  evaluatedDefinitions: string[];
  skippedDefinitions: { slug: string; reason: string }[];
  instancesCreated: number;
  instancesUpdated: number;
  instancesResolved: number;
};

export interface SignalEvaluator {
  evaluateAll(options?: EvaluateSignalsOptions): Promise<SignalEvaluationSummary>;
}

/**
 * DefaultSignalEvaluator - delegates to Go ExtractSignals via Temporal
 * 
 * For now, returns empty results since evaluation happens during ingestion.
 * Future: Call Go gRPC endpoint for on-demand evaluation.
 */
export class DefaultSignalEvaluator implements SignalEvaluator {
  constructor(options: { signalStore: SignalStore; workStore?: any; docStore?: any }) {
    // Signal evaluation now happens in Go brain-core
  }

  async evaluateAll(options?: EvaluateSignalsOptions): Promise<SignalEvaluationSummary> {
    // Signal evaluation now happens during ingestion in Go brain-core
    // This is a no-op stub for backward compatibility
    // TODO: Implement gRPC call to Go for on-demand evaluation if needed
    console.info("[SignalEvaluator] Signal evaluation now happens in Go brain-core during ingestion");
    
    return {
      evaluatedDefinitions: options?.definitionSlugs || [],
      skippedDefinitions: [],
      instancesCreated: 0,
      instancesUpdated: 0,
      instancesResolved: 0,
    };
  }
}
