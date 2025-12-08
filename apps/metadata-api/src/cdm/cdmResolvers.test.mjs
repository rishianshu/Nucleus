import test from "node:test";
import assert from "node:assert/strict";
import { createResolvers } from "../schema.js";
import { CdmEntityStore } from "./entityStore.js";

const sampleProject = {
  cdm_id: "cdm:work:project:test:ENG",
  source_system: "jira",
  source_project_key: "ENG",
  name: "Engineering",
  description: "Engineering backlog",
};

const sampleItem = {
  cdm_id: "cdm:work:item:test:ENG-1",
  source_system: "jira",
  source_issue_key: "ENG-1",
  project_cdm_id: sampleProject.cdm_id,
  summary: "Seeded issue summary",
  status: "In Progress",
  priority: "High",
  assignee_cdm_id: "cdm:work:user:test:assignee",
  reporter_cdm_id: "cdm:work:user:test:reporter",
  created_at: new Date("2024-01-01T10:00:00Z"),
  updated_at: new Date("2024-01-02T12:00:00Z"),
  closed_at: null,
  reporter_display_name: "Reporter",
  reporter_email: "reporter@example.com",
  assignee_display_name: "Assignee",
  assignee_email: "assignee@example.com",
};

const sampleComment = {
  cdm_id: "cdm:work:comment:test:ENG-1:1",
  item_cdm_id: sampleItem.cdm_id,
  author_cdm_id: sampleItem.reporter_cdm_id,
  body: "Looks good",
  created_at: new Date("2024-01-02T15:00:00Z"),
  author_display_name: "Reporter",
  author_email: "reporter@example.com",
};

const sampleWorklog = {
  cdm_id: "cdm:work:worklog:test:ENG-1:1",
  item_cdm_id: sampleItem.cdm_id,
  author_cdm_id: sampleItem.assignee_cdm_id,
  started_at: new Date("2024-01-03T08:00:00Z"),
  time_spent_seconds: 3600,
  comment: "Implementation",
  author_display_name: "Assignee",
  author_email: "assignee@example.com",
};

const fakeCdmStore = {
  listProjects: async () => [sampleProject],
  listWorkItems: async () => ({ rows: [sampleItem], cursorOffset: 0, hasNextPage: false }),
  getWorkItemDetail: async () => ({ item: sampleItem, comments: [sampleComment], worklogs: [sampleWorklog] }),
};

const sampleDocItem = {
  cdm_id: "cdm:doc:item:confluence:seed:1",
  source_system: "confluence",
  source_item_id: "123",
  space_cdm_id: "cdm:doc:space:confluence:CUS",
  space_key: "CUS",
  space_name: "Customer Success",
  space_url: "https://example/wiki/spaces/CUS",
  parent_item_cdm_id: null,
  title: "Seeded doc",
  doc_type: "page",
  mime_type: "storage",
  created_by_cdm_id: null,
  updated_by_cdm_id: null,
  created_at: new Date("2024-02-01T00:00:00Z"),
  updated_at: new Date("2024-02-02T00:00:00Z"),
  url: "https://example/wiki/spaces/CUS/pages/123",
  tags: [],
  properties: {
    _metadata: {
      sourceDatasetId: "confluence.page",
      sourceEndpointId: "endpoint-doc",
    },
    spaceKey: "CUS",
    spaceName: "Customer Success",
    path: "Customer Success / Seeded doc",
    raw: {
      body: {
        storage: {
          value: "<p>Seeded docs content</p>",
        },
      },
    },
  },
  dataset_id: "confluence.page",
  endpoint_id: "endpoint-doc",
};

const fakeDocStore = {
  listDocItems: async () => ({ rows: [sampleDocItem], cursorOffset: 0, hasNextPage: false }),
  getDocItem: async () => sampleDocItem,
};

const context = {
  auth: { tenantId: "tenant", projectId: "project", roles: ["viewer"], subject: "user" },
  userId: "user",
  bypassWrites: false,
};

test("cdm work queries map CDM tables", async () => {
  const resolvers = createResolvers({}, { cdmWorkStore: fakeCdmStore });

  const projects = await resolvers.Query.cdmWorkProjects(null, undefined, context);
  assert.equal(projects[0]?.name, "Engineering");

  const connection = await resolvers.Query.cdmWorkItems(null, { filter: { projectCdmId: sampleProject.cdm_id } }, context);
  assert.equal(connection.edges.length, 1);
  assert.equal(connection.pageInfo.hasNextPage, false);
  assert.equal(connection.edges[0]?.node.summary, sampleItem.summary);
  assert.equal(connection.edges[0]?.node.reporter?.displayName, "Reporter");

  const detail = await resolvers.Query.cdmWorkItem(null, { cdmId: sampleItem.cdm_id }, context);
  assert.equal(detail?.comments[0]?.body, "Looks good");
  assert.equal(detail?.worklogs[0]?.timeSpentSeconds, 3600);
});

test("cdm docs entities expose doc-specific fields", async () => {
  const cdmEntityStore = new CdmEntityStore({
    workStore: fakeCdmStore,
    docStore: fakeDocStore,
  });
  const resolvers = createResolvers({}, { cdmEntityStore });
  const docsConnection = await resolvers.Query.cdmEntities(
    null,
    { filter: { domain: "DOC_ITEM", docDatasetIds: ["confluence.page"] }, first: 10 },
    context,
  );
  assert.equal(docsConnection.edges.length, 1);
  const node = docsConnection.edges[0]?.node;
  assert.equal(node.docTitle, "Seeded doc");
  assert.equal(node.docDatasetId, "confluence.page");
  assert.equal(node.docProjectKey, "CUS");
  assert.ok(node.docContentExcerpt.includes("Seeded"));

  const singleDoc = await resolvers.Query.cdmEntity(
    null,
    { id: sampleDocItem.cdm_id, domain: "DOC_ITEM" },
    context,
  );
  assert.equal(singleDoc?.docSourceEndpointId, "endpoint-doc");
});

test("cdm docs dataset query filters doc configs", async () => {
  const fakePrisma = {
    ingestionUnitConfig: {
      findMany: async () => [
        {
          id: "cfg-doc",
          datasetId: "confluence.page",
          unitId: "confluence.page",
          endpointId: "endpoint-doc",
          endpoint: { id: "endpoint-doc", name: "Customer Success Confluence", vendor: "confluence" },
        },
        {
          id: "cfg-work",
          datasetId: "jira.issues",
          unitId: "jira.issues",
          endpointId: "endpoint-work",
          endpoint: { id: "endpoint-work", name: "Customer Success Jira", vendor: "jira" },
        },
      ],
    },
  };
  const resolvers = createResolvers({}, { prismaClient: fakePrisma });
  const datasets = await resolvers.Query.cdmDocsDatasets(null, undefined, context);
  assert.equal(datasets.length, 1);
  assert.equal(datasets[0]?.datasetId, "confluence.page");
  assert.equal(datasets[0]?.sourceSystem, "confluence");
});

test("cdm docs entities honor secured principal injection", async () => {
  let capturedAccessIds = null;
  const docStore = {
    listDocItems: async (args) => {
      capturedAccessIds = args.accessPrincipalIds;
      const allowed = Array.isArray(args.accessPrincipalIds) && args.accessPrincipalIds.includes("user-allowed");
      return allowed ? { rows: [sampleDocItem], cursorOffset: 0, hasNextPage: false } : { rows: [], cursorOffset: 0, hasNextPage: false };
    },
    getDocItem: async () => sampleDocItem,
  };
  const cdmEntityStore = new CdmEntityStore({
    workStore: fakeCdmStore,
    docStore,
  });
  const resolvers = createResolvers({}, { cdmEntityStore });
  const securedContext = {
    ...context,
    auth: { ...context.auth, subject: "user-allowed", email: "user-allowed@example.com", roles: ["viewer"] },
  };
  const docsConnection = await resolvers.Query.cdmEntities(
    null,
    { filter: { domain: "DOC_ITEM", docDatasetIds: ["confluence.page"] }, first: 10 },
    securedContext,
  );
  assert.ok(Array.isArray(capturedAccessIds));
  assert.ok(capturedAccessIds.includes("user-allowed"), "subject should be injected into accessPrincipalIds");
  assert.equal(docsConnection.edges.length, 1);
});

test("cdm docs secured=false requires admin", async () => {
  const cdmEntityStore = new CdmEntityStore({
    workStore: fakeCdmStore,
    docStore: fakeDocStore,
  });
  const resolvers = createResolvers({}, { cdmEntityStore });
  await assert.rejects(
    () =>
      resolvers.Query.cdmEntities(
        null,
        { filter: { domain: "DOC_ITEM", secured: false }, first: 5 },
        { ...context, auth: { ...context.auth, roles: ["viewer"] } },
      ),
    /RLS bypass requires admin role/,
  );
  // Admin can bypass
  const adminContext = { ...context, auth: { ...context.auth, roles: ["admin"] } };
  const docsConnection = await resolvers.Query.cdmEntities(
    null,
    { filter: { domain: "DOC_ITEM", secured: false }, first: 5 },
    adminContext,
  );
  assert.equal(docsConnection.edges.length, 1);
});
