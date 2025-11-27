import test from "node:test";
import assert from "node:assert/strict";
import { createResolvers } from "../schema.js";

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
