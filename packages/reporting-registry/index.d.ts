export type ReportingRegistryRunSummary = {
  id: string;
  reportVersionId: string;
  status: string;
  executedAt: string;
  durationMs: number;
  cacheHit: boolean;
  workflowId?: string | null;
  temporalRunId?: string | null;
};

export type ReportingRegistryRunHandle = {
  id: string;
  metadata?: { runId?: string };
};

export type ReportingRegistryClient = {
  listRuns(input: { reportVersionId: string }): Promise<ReportingRegistryRunSummary[]>;
  runReport(input: { reportVersionId: string }): Promise<ReportingRegistryRunHandle>;
};

export type ReportingRegistryClientOptions = {
  endpoint: string;
  tenantId?: string;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string> | (() => Record<string, string> | undefined);
};

export declare function createGraphQLReportingRegistryClient(
  options: ReportingRegistryClientOptions,
): ReportingRegistryClient;
