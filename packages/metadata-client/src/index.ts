export type MetadataDatasetField = {
  name: string;
  type: string;
  description?: string | null;
};

export type MetadataDataset = {
  id: string;
  displayName: string;
  description?: string | null;
  source?: string | null;
  projectIds?: string[];
  labels?: string[];
  fields: MetadataDatasetField[];
};

export type MetadataDomainSummary = {
  key: string;
  title: string;
  description?: string;
  itemCount: number;
  endpoints: MetadataEndpointDescriptor[];
};

export type MetadataEndpointDescriptor = {
  id: string;
  name: string;
  description?: string;
  verb: HttpVerb;
  url: string;
  authPolicy?: string;
};

export type HttpVerb = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type DatasetFilter = {
  search?: string;
  ids?: string[];
  labels?: string[];
};

export type MetadataClientMode = "local" | "remote";

export type MetadataClientOptions = {
  mode?: MetadataClientMode;
  manifestPath?: string;
  graphqlEndpoint?: string;
  headers?: Record<string, string> | (() => Record<string, string> | undefined);
  fetchImpl?: typeof fetch;
};

const isBrowser = typeof window !== "undefined";
const isNodeRuntime = !isBrowser && typeof process !== "undefined" && Boolean(process.versions?.node);
const DEFAULT_MANIFEST_PATH = resolveManifestPath();

export class MetadataClient {
  private readonly mode: MetadataClientMode;
  private readonly manifestPath: string;
  private readonly graphqlEndpoint?: string;
  private readonly headersProvider?: () => Record<string, string> | undefined;
  private readonly fetchImpl?: typeof fetch;
  private datasetCache: MetadataDataset[] | null = null;

  constructor(options?: MetadataClientOptions) {
    const inferredMode: MetadataClientMode =
      options?.mode ?? (options?.graphqlEndpoint ? "remote" : "local");
    this.mode = inferredMode;
    this.manifestPath = options?.manifestPath ?? DEFAULT_MANIFEST_PATH;
    this.graphqlEndpoint = options?.graphqlEndpoint;
    if (typeof options?.headers === "function") {
      this.headersProvider = options.headers;
    } else if (options?.headers) {
      const staticHeaders = { ...options.headers };
      this.headersProvider = () => staticHeaders;
    } else {
      this.headersProvider = undefined;
    }
    // Bind fetch to globalThis so browser polyfills that depend on `this` keep working.
    this.fetchImpl =
      options?.fetchImpl ??
      (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined);

    if (this.mode === "remote" && !this.graphqlEndpoint) {
      throw new Error("Remote metadata client requires a graphqlEndpoint");
    }
    if (this.mode === "local" && !isNodeRuntime) {
      throw new Error(
        "Local metadata mode requires access to the filesystem. Provide a METADATA_GRAPHQL_ENDPOINT (remote mode) when running in the browser.",
      );
    }
  }

  async listDatasets(filter?: DatasetFilter): Promise<MetadataDataset[]> {
    const datasets = await this.loadDatasets();
    if (!filter) {
      return datasets;
    }

    const search = filter.search?.trim().toLowerCase();
    return datasets.filter((dataset) => {
      if (filter.ids?.length && !filter.ids.includes(dataset.id)) {
        return false;
      }
      if (filter.labels?.length) {
        const datasetLabels = dataset.labels ?? [];
        const containsAll = filter.labels.every((label) => datasetLabels.includes(label));
        if (!containsAll) {
          return false;
        }
      }
      if (search) {
        const haystack = [dataset.displayName, dataset.description, dataset.source]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(search)) {
          return false;
        }
      }
      return true;
    });
  }

  async getDataset(id: string): Promise<MetadataDataset | null> {
    const datasets = await this.loadDatasets();
    return datasets.find((dataset) => dataset.id === id) ?? null;
  }

  async listDomains(): Promise<MetadataDomainSummary[]> {
    const datasets = await this.loadDatasets();
    return [
      {
        key: "datasets",
        title: "Datasets",
        description: "Tabular datasets sourced from the local catalog manifest or metadata service.",
        itemCount: datasets.length,
        endpoints: this.describeDatasetEndpoints(),
      },
    ];
  }

  private describeDatasetEndpoints(): MetadataEndpointDescriptor[] {
    if (this.mode === "remote" && this.graphqlEndpoint) {
      return [
        {
          id: "metadata.datasets.query",
          name: "Metadata Catalog",
          description: "GraphQL query CatalogDatasets to retrieve dataset metadata.",
          verb: "POST",
          url: this.graphqlEndpoint,
          authPolicy: "MetadataGraphQL",
        },
      ];
    }
    return [
      {
        id: "metadata.datasets.local",
        name: "Local Catalog JSON",
        description: this.manifestPath,
        verb: "GET",
        url: this.manifestPath,
      },
    ];
  }

  private async loadDatasets(): Promise<MetadataDataset[]> {
    if (this.mode === "remote") {
      return this.fetchRemoteDatasets();
    }
    if (this.datasetCache) {
      return this.datasetCache;
    }
    const file = await readLocalManifest(this.manifestPath);
    const parsed = JSON.parse(file) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(`Catalog manifest at ${this.manifestPath} is not an array.`);
    }
    this.datasetCache = parsed.map((raw) => normalizeDataset(raw));
    return this.datasetCache;
  }

  private async fetchRemoteDatasets(): Promise<MetadataDataset[]> {
    if (!this.graphqlEndpoint || !this.fetchImpl) {
      throw new Error("Remote metadata mode requires fetch implementation and graphqlEndpoint");
    }
    const query = `
      query CatalogDatasets {
        catalogDatasets {
          id
          displayName
          description
          source
          labels
          projectIds
          fields { name type description }
        }
      }
    `;
    const headers = {
      "Content-Type": "application/json",
      ...(this.headersProvider?.() ?? {}),
    };
    const response = await this.fetchImpl(this.graphqlEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ query }),
    });
    if (!response.ok) {
      throw new Error(`Metadata GraphQL error (${response.status})`);
    }
    const payload = (await response.json()) as { data?: { catalogDatasets?: MetadataDataset[] }; errors?: unknown };
    if (payload.errors) {
      throw new Error(`Metadata GraphQL returned errors: ${JSON.stringify(payload.errors)}`);
    }
    const datasets = payload.data?.catalogDatasets ?? [];
    return datasets.map((dataset) => normalizeDataset(dataset));
  }
}

function normalizeDataset(raw: any): MetadataDataset {
  return {
    id: String(raw.id ?? raw.path ?? raw.name ?? ""),
    displayName: String(raw.displayName ?? raw.name ?? raw.id ?? "Unnamed Dataset"),
    description: raw.description ?? null,
    source: raw.source ?? raw.path ?? null,
    projectIds: Array.isArray(raw.projectIds) ? raw.projectIds.map(String) : undefined,
    labels: Array.isArray(raw.labels) ? raw.labels.map(String) : undefined,
    fields: Array.isArray(raw.fields)
      ? raw.fields.map((field: any) => ({
          name: String(field.name ?? ""),
          type: String(field.type ?? "string"),
          description: field.description ?? null,
        }))
      : [],
  };
}

export function createMetadataClient(options?: MetadataClientOptions) {
  return new MetadataClient(options);
}

function resolveManifestPath(): string {
  if (isNodeRuntime && typeof process.cwd === "function") {
    return `${process.cwd()}/configs/reporting/catalog.json`;
  }
  return "/configs/reporting/catalog.json";
}

async function readLocalManifest(filePath: string): Promise<string> {
  if (!isNodeRuntime) {
    throw new Error("Local metadata client mode is not available in the browser runtime. Use remote mode instead.");
  }
  const fs = await import("node:fs/promises");
  return fs.readFile(filePath, "utf-8");
}
