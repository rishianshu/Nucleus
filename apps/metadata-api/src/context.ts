import {
  FileMetadataStore,
  PrismaMetadataStore,
  createGraphStore,
  type GraphStore,
  type MetadataStore,
} from "@metadata/core";
import path from "node:path";
import { seedMetadataStoreIfEmpty } from "./seeds/sample.js";

let storePromise: Promise<MetadataStore> | null = null;
let graphStorePromise: Promise<GraphStore> | null = null;

export function getMetadataStore(): Promise<MetadataStore> {
  if (!storePromise) {
    storePromise = createStore();
  }
  return storePromise;
}

export function getGraphStore(): Promise<GraphStore> {
  if (!graphStorePromise) {
    graphStorePromise = getMetadataStore().then((store) =>
      createGraphStore({ metadataStore: store, driver: process.env.GRAPH_STORE_DRIVER }),
    );
  }
  return graphStorePromise;
}

async function createStore(): Promise<MetadataStore> {
  if (process.env.METADATA_FORCE_FILE_STORE === "1") {
    return createFileStore();
  }
  const databaseUrl = resolveMetadataDatabaseUrl();
  if (databaseUrl) {
    const prismaClient = await createPrismaMetadataClient();
    if (prismaClient) {
      const prismaStore = new PrismaMetadataStore(prismaClient as any);
      await trySeedStore(prismaStore);
      return prismaStore;
    }
    // eslint-disable-next-line no-console
    console.warn("Metadata Prisma client could not be loaded. Falling back to file store for local development.");
  } else {
    // eslint-disable-next-line no-console
    console.warn("METADATA_DATABASE_URL not set; using local file-backed metadata store (designer will not work in browser).");
  }
  return createFileStore();
}

async function trySeedStore(store: MetadataStore): Promise<void> {
  if (!(store instanceof FileMetadataStore)) {
    return;
  }
  try {
    await seedMetadataStoreIfEmpty(store);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("Metadata seed skipped (non-fatal):", error);
  }
}

async function createFileStore(): Promise<MetadataStore> {
  const manifestDir = process.env.METADATA_STORE_DIR
    ? path.resolve(process.env.METADATA_STORE_DIR)
    : path.resolve(process.cwd(), "metadata", "store");
  const fileStore = new FileMetadataStore({ rootDir: manifestDir });
  await trySeedStore(fileStore);
  return fileStore;
}

async function createPrismaMetadataClient(): Promise<object | null> {
  const candidatePaths = [
    path.resolve(process.cwd(), "node_modules", ".metadata-client", "index.js"),
    path.resolve(process.cwd(), "..", "..", "node_modules", ".metadata-client", "index.js"),
  ];
  for (const modulePath of candidatePaths) {
    try {
      const metadataModule = await import(modulePath);
      if (metadataModule && typeof metadataModule.PrismaClient === "function") {
        return new metadataModule.PrismaClient();
      }
    } catch {
      // continue trying next candidate
    }
  }
  // eslint-disable-next-line no-console
  console.warn("Failed to load metadata Prisma client from known locations.");
  return null;
}

function resolveMetadataDatabaseUrl(): string | null {
  if (process.env.METADATA_DATABASE_URL) {
    return process.env.METADATA_DATABASE_URL;
  }
  const primary = process.env.DATABASE_URL;
  if (!primary) {
    return null;
  }
  const [base, query] = primary.split("?", 2);
  if (!query) {
    process.env.METADATA_DATABASE_URL = `${primary}?schema=metadata`;
    return process.env.METADATA_DATABASE_URL;
  }
  const params = new URLSearchParams(query);
  if (params.has("schema")) {
    params.set("schema", "metadata");
  } else {
    params.append("schema", "metadata");
  }
  process.env.METADATA_DATABASE_URL = `${base}?${params.toString()}`;
  return process.env.METADATA_DATABASE_URL;
}
