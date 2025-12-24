import assert from "node:assert/strict";
import test from "node:test";
import type { IndexProfileStore, IndexProfile } from "./types.js";

class InMemoryIndexProfileStore implements IndexProfileStore {
  private readonly profiles: IndexProfile[];

  constructor(seed: IndexProfile[] = [
    {
      id: "cdm.work.summary",
      family: "work",
      description: "work summary",
      nodeType: "cdm.work.item",
      textSource: {},
      embeddingModel: "text-embedding-3-small",
      profileKind: "work",
      enabled: true,
    },
    {
      id: "cdm.doc.body",
      family: "doc",
      description: "doc body",
      nodeType: "cdm.doc.item",
      textSource: {},
      embeddingModel: "text-embedding-3-small",
      profileKind: "doc",
      enabled: true,
    },
  ]) {
    this.profiles = seed;
  }

  async listProfiles(): Promise<IndexProfile[]> {
    return this.profiles;
  }

  async getProfile(id: string): Promise<IndexProfile | null> {
    return this.profiles.find((p) => p.id === id) ?? null;
  }
}

test("index profiles are seeded and retrievable", async () => {
  const store = new InMemoryIndexProfileStore();
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
