import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import type { IncomingMessage } from "node:http";
import { createResolvers, typeDefs } from "./schema.js";
import { getMetadataStore, getGraphStore } from "./context.js";
import { authenticateRequest } from "./auth.js";

async function main() {
  const store = await getMetadataStore();
  console.info("[metadata-api] using store", store.constructor?.name ?? "unknown");
  const graphStore = await getGraphStore();
  const resolvers = createResolvers(store, { graphStore });

  const server = new ApolloServer({
    typeDefs,
    resolvers,
  });

  const port = Number(process.env.METADATA_API_PORT ?? 4010);
  const { url } = await startStandaloneServer(server, {
    listen: { port },
    context: async ({ req }) => {
      const headerUserId = readHeader(req, "x-user-id");
      const auth = await authenticateRequest(req.headers.authorization ?? null);
      const derivedUserId =
        headerUserId ??
        (auth.subject && auth.subject !== "anonymous" ? auth.subject : null);
      return {
        request: req,
        userId: derivedUserId,
        auth,
        bypassWrites: readHeader(req, "x-metadata-test-write") === "1",
      };
    },
  });

  // eslint-disable-next-line no-console
  console.log(`Metadata API listening at ${url}`);
}

void main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start Metadata API", error);
  process.exit(1);
});

function readHeader(req: IncomingMessage, key: string): string | null {
  const value = req.headers[key];
  if (!value) {
    return null;
  }
  return Array.isArray(value) ? value[0] ?? null : value;
}
