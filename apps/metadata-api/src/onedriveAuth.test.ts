import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  completeOneDriveAuthCallback,
  getOneDriveDelegatedToken,
  startOneDriveAuth,
} from "./onedriveAuth.js";

test("OneDrive delegated auth start/complete round-trip persists tokens", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "onedrive-auth-"));
  const tokenFile = path.join(tmpDir, "tokens.json");
  const originalTokenPath = process.env.METADATA_ONEDRIVE_TOKEN_FILE;
  process.env.METADATA_ONEDRIVE_TOKEN_FILE = tokenFile;
  try {
    const session = await startOneDriveAuth("endpoint-1");
    assert.ok(session.authUrl.includes(session.state));
    const invalid = await completeOneDriveAuthCallback("bad-state", "code123");
    assert.equal(invalid.ok, false);
    const result = await completeOneDriveAuthCallback(session.state, "code123");
    assert.equal(result.ok, true);
    assert.equal(result.endpointId, "endpoint-1");
    const stored = await getOneDriveDelegatedToken("endpoint-1");
    assert.ok(stored?.access_token, "expected access token to be stored");
    assert.ok(stored?.refresh_token, "expected refresh token to be stored");
  } finally {
    process.env.METADATA_ONEDRIVE_TOKEN_FILE = originalTokenPath;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
