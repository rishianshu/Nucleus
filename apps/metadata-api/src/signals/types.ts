export type SignalStatus = "ACTIVE" | "DISABLED" | "DRAFT";
export type SignalInstanceStatus = "OPEN" | "RESOLVED" | "SUPPRESSED";
export type SignalSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";
export type SignalImplMode = "DSL" | "CODE";

export type SignalDefinition = {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  status: SignalStatus;
  implMode: SignalImplMode;
  sourceFamily?: string | null;
  entityKind?: string | null;
  processKind?: string | null;
  policyKind?: string | null;
  severity: SignalSeverity;
  tags: string[];
  cdmModelId?: string | null;
  surfaceHints?: Record<string, unknown> | null;
  owner?: string | null;
  definitionSpec: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type SignalInstance = {
  id: string;
  definitionId: string;
  status: SignalInstanceStatus;
  entityRef: string;
  entityKind: string;
  severity: SignalSeverity;
  summary: string;
  details?: Record<string, unknown> | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolvedAt?: Date | null;
  sourceRunId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  definition?: SignalDefinition;
};

export type SignalDefinitionFilter = {
  status?: SignalStatus[];
  entityKind?: string[];
  sourceFamily?: string[];
  implMode?: SignalImplMode[];
  tags?: string[];
};

export type SignalInstanceFilter = {
  definitionIds?: string[];
  definitionSlugs?: string[];
  entityRefs?: string[];
  entityKind?: string;
  status?: SignalInstanceStatus[];
  severity?: SignalSeverity[];
  limit?: number;
};

export type SignalInstancePage = {
  rows: SignalInstance[];
  cursorOffset: number;
  hasNextPage: boolean;
};

export type SignalInstancePageFilter = SignalInstanceFilter & {
  after?: string | null;
};

export type CreateSignalDefinitionInput = Omit<
  SignalDefinition,
  "id" | "createdAt" | "updatedAt" | "definitionSpec" | "implMode"
> & { definitionSpec: Record<string, unknown>; implMode?: SignalImplMode };

export type UpdateSignalDefinitionInput = Partial<
  Omit<SignalDefinition, "id" | "createdAt" | "updatedAt" | "definitionSpec">
> & { definitionSpec?: Record<string, unknown> };

export type UpsertSignalInstanceInput = {
  definitionId: string;
  entityRef: string;
  entityKind: string;
  severity: SignalSeverity;
  summary: string;
  details?: Record<string, unknown> | null;
  status?: SignalInstanceStatus;
  sourceRunId?: string | null;
  timestamp?: Date | string;
  resolvedAt?: Date | string | null;
};

export interface SignalStore {
  // Definitions
  getDefinition(id: string): Promise<SignalDefinition | null>;
  getDefinitionBySlug(slug: string): Promise<SignalDefinition | null>;
  listDefinitions(filter?: SignalDefinitionFilter): Promise<SignalDefinition[]>;
  createDefinition(input: CreateSignalDefinitionInput): Promise<SignalDefinition>;
  updateDefinition(id: string, patch: UpdateSignalDefinitionInput): Promise<SignalDefinition>;

  // Instances
  getInstance(id: string): Promise<SignalInstance | null>;
  listInstances(filter?: SignalInstanceFilter): Promise<SignalInstance[]>;
  listInstancesPaged?(filter?: SignalInstancePageFilter): Promise<SignalInstancePage>;
  upsertInstance(input: UpsertSignalInstanceInput): Promise<SignalInstance>;
  updateInstanceStatus(id: string, status: SignalInstanceStatus, resolvedAt?: Date | string | null): Promise<SignalInstance>;
}
