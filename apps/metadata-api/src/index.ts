import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import http, { type IncomingMessage } from "node:http";
import { URL } from "node:url";
import { createResolvers, typeDefs } from "./schema.js";
import { getMetadataStore, getGraphStore } from "./context.js";
import { authenticateRequest } from "./auth.js";
import { completeOneDriveAuthCallback, markOneDriveEndpointDelegatedConnected } from "./onedriveAuth.js";
import { registerDefaultIngestionDrivers } from "./ingestion/register.js";

async function main() {
  registerDefaultIngestionDrivers();
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
  startOneDriveCallbackServer();
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

function startOneDriveCallbackServer() {
  const port = Number(process.env.METADATA_ONEDRIVE_CALLBACK_PORT ?? 4011);
  const server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (requestUrl.pathname !== "/auth/onedrive/callback") {
        res.statusCode = 404;
        res.end("not_found");
        return;
      }
      const state = requestUrl.searchParams.get("state");
      const code = requestUrl.searchParams.get("code");
      const result = await completeOneDriveAuthCallback(state ?? "", code);
      if (result.ok && result.endpointId) {
        await markOneDriveEndpointDelegatedConnected(result.endpointId);
      }
      res.statusCode = result.ok ? 200 : 400;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(
        result.ok
          ? "<p>OneDrive delegated auth completed. You can close this window.</p>"
          : "<p>OneDrive auth session is invalid or expired.</p>",
      );
    } catch (error) {
      res.statusCode = 500;
      res.end("error");
      console.error("[metadata-api] onedrive callback failed", error);
    }
  });
  server.listen(port, () => {
    console.info(`[metadata-api] OneDrive auth callback listening on :${port}`);
  });
}
