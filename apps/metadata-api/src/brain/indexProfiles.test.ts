import assert from "node:assert/strict";
import test from "node:test";
import { PrismaIndexProfileStore } from "./indexProfileStore.js";

test("index profiles are seeded and retrievable", async () => {
  const store = new PrismaIndexProfileStore();
  const profiles = await store.listProfiles();
  const ids = profiles.map((profile) => profile.id);

  assert.ok(ids.includes("cdm.work.summary"), "work profile should be seeded");
  assert.ok(ids.includes("cdm.doc.body"), "doc profile should be seeded");

  const workProfile = await store.getProfile("cdm.work.summary");
  assert.equal(workProfile?.nodeType, "cdm.work.item");
  assert.equal(workProfile?.profileKind, "work");
  assert.equal(workProfile?.embeddingModel, "text-embedding-3-small");

  const docProfile = await store.getProfile("cdm.doc.body");
  assert.equal(docProfile?.nodeType, "cdm.doc.item");
  assert.equal(docProfile?.profileKind, "doc");

  const missingProfile = await store.getProfile("nonexistent-profile");
  assert.equal(missingProfile, null);
});
