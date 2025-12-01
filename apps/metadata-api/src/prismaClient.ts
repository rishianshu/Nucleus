import path from "node:path";

let clientPromise: Promise<any> | null = null;

declare global {
  // eslint-disable-next-line no-var
  var __metadataPrismaClient: any | undefined;
}

export function getPrismaClient(): Promise<any> {
  if (globalThis.__metadataPrismaClient) {
    return Promise.resolve(globalThis.__metadataPrismaClient);
  }
  if (!clientPromise) {
    clientPromise = loadClient();
  }
  return clientPromise;
}

async function loadClient(): Promise<any> {
  ensureMetadataDatabaseUrl();
  const candidates = [
    path.resolve(process.cwd(), "node_modules", ".metadata-client", "index.js"),
    path.resolve(process.cwd(), "..", "..", "node_modules", ".metadata-client", "index.js"),
  ];
  for (const modulePath of candidates) {
    try {
      const metadataModule = await import(modulePath);
      if (metadataModule && typeof metadataModule.PrismaClient === "function") {
        return new metadataModule.PrismaClient();
      }
    } catch {
      // continue trying other locations
    }
  }
  throw new Error("Metadata Prisma client is not available. Run `pnpm prisma:generate:metadata`.");
}

function ensureMetadataDatabaseUrl() {
  if (process.env.METADATA_DATABASE_URL) {
    return;
  }
  const base = process.env.DATABASE_URL;
  if (!base) {
    return;
  }
  try {
    const url = new URL(base);
    url.searchParams.set("schema", "metadata");
    process.env.METADATA_DATABASE_URL = url.toString();
  } catch {
    process.env.METADATA_DATABASE_URL = `${base}?schema=metadata`;
  }
}
