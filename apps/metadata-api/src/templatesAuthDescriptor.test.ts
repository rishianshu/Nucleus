import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createResolvers } from "./schema.js";
import { FileMetadataStore } from "@metadata/core";

function buildCtx() {
  return {
    auth: { tenantId: "tenant-auth", projectId: "project-auth", roles: ["admin"], subject: "tester" },
    userId: "user-auth",
    bypassWrites: true,
  };
}

test("endpoint templates expose auth descriptors with delegated mode", async (t) => {
  const previousRefreshFlag = process.env.METADATA_ENDPOINT_TEMPLATE_REFRESH_DISABLED;
  process.env.METADATA_ENDPOINT_TEMPLATE_REFRESH_DISABLED = "1";
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "auth-descriptor-"));
  t.after(async () => {
    process.env.METADATA_ENDPOINT_TEMPLATE_REFRESH_DISABLED = previousRefreshFlag;
    await rm(rootDir, { recursive: true, force: true });
  });

  const store = new FileMetadataStore({ rootDir });
  const resolvers = createResolvers(store);
  const ctx = buildCtx();

  const templates = await (resolvers.Query.metadataEndpointTemplates as any)(null, { family: "HTTP" }, ctx as any);
  const confluence = templates.find((template: any) => template.id === "http.confluence");
  assert.ok(confluence, "confluence template should be present");
  assert.ok(confluence.auth, "auth descriptor should be present");
  const delegated = confluence.auth?.modes?.find((mode: any) => mode.mode === "delegated_auth_code_pkce");
  assert.ok(delegated, "delegated auth mode should be exposed");
  assert.equal(delegated.interactive, true, "delegated mode should be marked interactive");
  assert.equal(confluence.auth?.profileBinding?.supported, true, "profile binding should be supported");
});

test("github template exposes service + delegated auth descriptors", async (t) => {
  const previousRefreshFlag = process.env.METADATA_ENDPOINT_TEMPLATE_REFRESH_DISABLED;
  process.env.METADATA_ENDPOINT_TEMPLATE_REFRESH_DISABLED = "1";
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "auth-descriptor-gh-"));
  t.after(async () => {
    process.env.METADATA_ENDPOINT_TEMPLATE_REFRESH_DISABLED = previousRefreshFlag;
    await rm(rootDir, { recursive: true, force: true });
  });

  const store = new FileMetadataStore({ rootDir });
  const resolvers = createResolvers(store);
  const ctx = buildCtx();

  const templates = await (resolvers.Query.metadataEndpointTemplates as any)(null, { family: "HTTP" }, ctx as any);
  const github = templates.find((template: any) => template.id === "http.github");
  assert.ok(github, "github template should be present");
  assert.ok(github.auth, "auth descriptor should be present");
  const servicePat = github.auth?.modes?.find((mode: any) => mode.mode === "service_pat");
  assert.ok(servicePat, "service PAT mode should exist");
  assert.equal(servicePat.interactive, false);
  const delegatedGh = github.auth?.modes?.find((mode: any) => mode.mode === "delegated_auth_code_pkce");
  assert.ok(delegatedGh, "delegated mode should exist");
  assert.equal(delegatedGh.interactive, true, "delegated mode should be interactive");
  assert.equal(github.auth?.profileBinding?.supported, true, "profile binding should be supported");
});
