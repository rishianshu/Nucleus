# GraphQL — Semantic Ingestion Management

Additive schema proposal (no breaking changes).

## Types
```graphql
type SemanticUnit {
  unitId: ID!
  kind: SemanticUnitKind!
  displayName: String!
  stats: SemanticUnitStats
}

enum SemanticUnitKind { PROJECT SPACE DRIVE FOLDER }

type SemanticUnitStats {
  items: Int
  lastUpdatedAt: DateTime
  errors: Int
}

type IngestionStatus {
  endpointId: ID!
  unitId: ID!
  enabled: Boolean!
  schedule: Schedule
  checkpoint: JSON
  lastRun: IngestionRun
  lag: Duration
  errors: [IngestionError!]
  stats: IngestionRunStats
}
```

## Queries
```graphql
type Query {
  semanticUnits(endpointId: ID!): [SemanticUnit!]!
  ingestionStatus(endpointId: ID!, unitId: ID!): IngestionStatus!
}
```

## Mutations
```graphql
type Mutation {
  startIngestion(endpointId: ID!, unitId: ID!, schedule: ScheduleInput): IngestionRun!
  pauseIngestion(endpointId: ID!, unitId: ID!): Boolean!
  resumeIngestion(endpointId: ID!, unitId: ID!): Boolean!
  triggerIngestion(endpointId: ID!, unitId: ID!, dryRun: Boolean): IngestionRun!
}
```

### ScheduleInput
```graphql
input ScheduleInput {
  frequency: String!        # cron/iso8601 duration
  timezone: String!         # Olson ID
  windowStart: DateTime
  windowEnd: DateTime
}
```

### IngestionRun
```graphql
type IngestionRun {
  id: ID!
  status: IngestionRunStatus!
  startedAt: DateTime
  completedAt: DateTime
  stats: IngestionRunStats
  errors: [IngestionError!]
}

enum IngestionRunStatus { QUEUED RUNNING SUCCEEDED FAILED PAUSED }

type IngestionRunStats {
  processed: Int
  inserted: Int
  updated: Int
  deleted: Int
  durationMs: Int
  rateLimit: RateLimitInfo
}

type RateLimitInfo {
  limitPerWindow: Int
  windowSeconds: Int
  remaining: Int
  resetAt: DateTime
}

type IngestionError {
  code: String
  message: String
  sampleEntity: JSON
}
```

These fields expose the contract defined in `INGESTION-CONTRACT.md` so UI/workflows can manage per-unit ingestion without directly hitting driver APIs.
