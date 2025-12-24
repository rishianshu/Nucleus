/**
 * Signal store exports - gRPC bridge to Go SignalService
 */
export {
  GrpcSignalStore,
  grpcSignalStore,
} from "./grpcSignalStore.js";

export type {
  SignalDefinition,
  SignalInstance,
  SignalDefinitionFilter,
  SignalInstanceFilter,
  SignalStore,
  SignalStatus,
  SignalInstanceStatus,
  SignalSeverity,
  SignalImplMode,
  SignalInstancePage,
  SignalInstancePageFilter,
  CreateSignalDefinitionInput,
  UpdateSignalDefinitionInput,
  UpsertSignalInstanceInput,
} from "./types.js";

export {
  DefaultSignalEvaluator,
  type SignalEvaluator,
  type EvaluateSignalsOptions,
  type SignalEvaluationSummary,
} from "./evaluator.js";

// Re-export as PrismaSignalStore for backward compatibility
export { GrpcSignalStore as PrismaSignalStore } from "./grpcSignalStore.js";
