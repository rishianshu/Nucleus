export async function fetchMetadataGraphQL<T>(
  endpoint: string,
  query: string,
  variables?: Record<string, unknown>,
  signal?: AbortSignal,
  options?: { token?: string },
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options?.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`Metadata GraphQL failed with status ${response.status}`);
  }
  const payload = (await response.json()) as { data?: T; errors?: Array<{ message?: string }> };
  if (payload.errors?.length) {
    throw new Error(payload.errors[0]?.message ?? "Metadata GraphQL error");
  }
  if (!payload.data) {
    throw new Error("Metadata GraphQL response missing data payload");
  }
  return payload.data;
}
