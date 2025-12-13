# ucl-grpc-capabilities-and-auth-descriptors-v1 — Story

- 2025-12-12T18:28Z: Added UCL gRPC capability probe/operation RPCs plus Go server stubs; extended metadata-api client/schema with capability gating and template auth descriptors (delegated mode seeded); added GraphQL/ops hardening tests (`pnpm --dir apps/metadata-api exec node --import tsx --test src/capabilityProbe.test.ts src/templatesAuthDescriptor.test.ts src/operationsMapping.test.ts src/hardeningNegativeCases.test.ts`) and tsc build; full ci-check still pending.
