function createGraphQLReportingRegistryClient() {
  return {
    async listRuns() {
      return [];
    },
    async runReport() {
      const runId = `mock-run-${Date.now()}`;
      return { id: runId, metadata: { runId } };
    },
  };
}

export { createGraphQLReportingRegistryClient };
