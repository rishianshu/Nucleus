import { MetadataClient } from "@metadata/client";
let client = null;
export function getMetadataClient() {
    if (!client) {
        const mode = import.meta.env.VITE_METADATA_CLIENT_MODE;
        const endpoint = import.meta.env.VITE_METADATA_GRAPHQL_ENDPOINT ?? "/metadata/graphql";
        client = new MetadataClient({ mode, graphqlEndpoint: endpoint });
    }
    return client;
}
