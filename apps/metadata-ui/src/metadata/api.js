export async function fetchMetadataGraphQL(endpoint, query, variables, signal, options) {
    const headers = {
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
    const payload = (await response.json());
    if (payload.errors?.length) {
        throw new Error(payload.errors[0]?.message ?? "Metadata GraphQL error");
    }
    if (!payload.data) {
        throw new Error("Metadata GraphQL response missing data payload");
    }
    return payload.data;
}
