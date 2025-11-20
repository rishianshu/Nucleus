export type KbScope = {
  orgId: string;
  projectId?: string | null;
  domainId?: string | null;
  teamId?: string | null;
};

export type KbIdentity = {
  logicalKey: string;
  originEndpointId?: string | null;
  originVendor?: string | null;
  sourceLogicalKey?: string | null;
  targetLogicalKey?: string | null;
  externalId?: unknown;
  provenance?: unknown;
};

export type KbNode = {
  id: string;
  entityType: string;
  displayName: string;
  canonicalPath?: string | null;
  phase?: string | null;
  updatedAt: string;
  identity: KbIdentity;
  scope: KbScope;
  provenance?: unknown;
};

export type KbEdge = {
  id: string;
  edgeType: string;
  sourceEntityId: string;
  targetEntityId: string;
  confidence?: number | null;
  updatedAt: string;
  identity: KbIdentity;
  scope: KbScope;
};

export type PageInfoState = {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string | null;
  endCursor?: string | null;
};

export type KbScene = {
  nodes: KbNode[];
  edges: KbEdge[];
  summary: {
    nodeCount: number;
    edgeCount: number;
    truncated: boolean;
  };
};
