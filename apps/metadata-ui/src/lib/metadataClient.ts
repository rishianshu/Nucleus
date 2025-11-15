import { MetadataClient, type MetadataClientMode } from "@metadata/client";

let client: MetadataClient | null = null;

export function getMetadataClient() {
  if (!client) {
    const mode = import.meta.env.VITE_METADATA_CLIENT_MODE as MetadataClientMode | undefined;
    const endpoint = import.meta.env.VITE_METADATA_GRAPHQL_ENDPOINT ?? "/metadata/graphql";
    client = new MetadataClient({ mode, graphqlEndpoint: endpoint });
  }
  return client;
}
