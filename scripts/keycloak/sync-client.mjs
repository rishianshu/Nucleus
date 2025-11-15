#!/usr/bin/env node

/**
 * Ensure the local Keycloak client that backs the metadata designer exposes
 * realm roles and friendly profile fields in issued tokens. This keeps the
 * designer sidebar (and role gating) accurate even when the realm was created
 * before the updated realm export existed.
 */

const baseUrl = normalizeBaseUrl(
  process.env.KEYCLOAK_BASE_URL ?? process.env.VITE_KC_URL ?? "http://localhost:8081",
);
const realm = process.env.KEYCLOAK_REALM ?? process.env.VITE_KC_REALM ?? "nucleus";
const clientId = process.env.KEYCLOAK_CLIENT_ID ?? process.env.VITE_KC_CLIENT ?? "jira-plus-plus";
const adminUsername = process.env.KEYCLOAK_ADMIN ?? "admin";
const adminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD ?? "admin";

const requiredDefaultScopes = ["nucleus-context", "profile", "email"];
const requiredMappers = [
  buildPropertyMapper("preferred-username", {
    "user.attribute": "username",
    "claim.name": "preferred_username",
  }),
  buildRealmRoleMapper("realm-roles-flat", {
    "claim.name": "roles",
  }),
];

async function main() {
  try {
    const token = await acquireAdminToken();
    const client = await fetchClient(token);
    if (!client) {
      logWarn(`Client "${clientId}" not found in realm "${realm}". Skipping sync.`);
      return;
    }
    const changes = [];

    if (!client.fullScopeAllowed) {
      client.fullScopeAllowed = true;
      changes.push("enabled fullScopeAllowed");
    }

    const scopeMap = await ensureRealmScopes(token);
    const defaultScopeChanges = await syncClientDefaultScopes(token, client.id, scopeMap);
    changes.push(...defaultScopeChanges);

    const protocolMappers = [...(client.protocolMappers ?? [])];
    const mapperNames = new Set(protocolMappers.map((mapper) => mapper.name));
    requiredMappers.forEach((mapper) => {
      if (!mapperNames.has(mapper.name)) {
        protocolMappers.push(mapper);
        mapperNames.add(mapper.name);
        changes.push(`mapper +${mapper.name}`);
      }
    });
    if (changes.some((change) => change.startsWith("mapper +"))) {
      client.protocolMappers = protocolMappers;
    }

    const filteredChanges = changes.filter(Boolean);
    if (!filteredChanges.length) {
      logInfo("Keycloak client already aligned.");
      return;
    }

    await updateClient(token, client.id, client);
    logInfo(`Applied Keycloak client sync (${filteredChanges.join(", ")}).`);
  } catch (error) {
    logWarn(`Keycloak sync skipped: ${(error instanceof Error && error.message) || String(error)}`);
  }
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

async function acquireAdminToken() {
  const body = new URLSearchParams({
    client_id: "admin-cli",
    grant_type: "password",
    username: adminUsername,
    password: adminPassword,
  });
  const response = await fetch(`${baseUrl}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(`admin token request failed (${response.status})`);
  }
  const payload = await response.json();
  if (!payload?.access_token) {
    throw new Error("admin token response missing access_token");
  }
  return payload.access_token;
}

async function fetchClient(token) {
  const response = await fetch(
    `${baseUrl}/admin/realms/${encodeURIComponent(realm)}/clients?clientId=${encodeURIComponent(clientId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!response.ok) {
    throw new Error(`failed to query Keycloak clients (${response.status})`);
  }
  const payload = await response.json();
  return payload?.[0] ?? null;
}

async function ensureRealmScopes(token) {
  const currentScopes = await fetchClientScopes(token);
  const scopeMap = new Map(currentScopes.map((scope) => [scope.name, scope]));
  for (const scopeName of requiredDefaultScopes) {
    if (scopeMap.has(scopeName)) {
      continue;
    }
    const created = await createClientScope(token, scopeName);
    scopeMap.set(scopeName, created);
  }
  return scopeMap;
}

async function fetchClientScopes(token) {
  const response = await fetch(`${baseUrl}/admin/realms/${encodeURIComponent(realm)}/client-scopes`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`failed to query client scopes (${response.status})`);
  }
  return (await response.json()) ?? [];
}

async function updateClient(token, id, representation) {
  const response = await fetch(
    `${baseUrl}/admin/realms/${encodeURIComponent(realm)}/clients/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(representation),
    },
  );
  if (!response.ok) {
    throw new Error(`failed to update Keycloak client (${response.status})`);
  }
}

async function createClientScope(token, name) {
  const payload = {
    name,
    description: `autogenerated scope for ${name}`,
    protocol: "openid-connect",
    attributes: {
      "display.on.consent.screen": "false",
      "include.in.token.scope": "true",
    },
  };
  const response = await fetch(`${baseUrl}/admin/realms/${encodeURIComponent(realm)}/client-scopes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok && response.status !== 409) {
    throw new Error(`failed to create client scope "${name}" (${response.status})`);
  }
  const refreshed = await fetchClientScopes(token);
  const created = refreshed.find((scope) => scope.name === name);
  if (!created) {
    throw new Error(`client scope "${name}" was not created`);
  }
  return created;
}

async function syncClientDefaultScopes(token, clientId, scopeMap) {
  const response = await fetch(
    `${baseUrl}/admin/realms/${encodeURIComponent(realm)}/clients/${encodeURIComponent(clientId)}/default-client-scopes`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!response.ok) {
    throw new Error(`failed to read client default scopes (${response.status})`);
  }
  const currentDefaults = ((await response.json()) ?? []).map((scope) => scope.name);
  const changes = [];
  for (const scopeName of requiredDefaultScopes) {
    if (currentDefaults.includes(scopeName)) {
      continue;
    }
    const target = scopeMap.get(scopeName);
    if (!target) {
      throw new Error(`client scope "${scopeName}" missing after creation`);
    }
    const assignResponse = await fetch(
      `${baseUrl}/admin/realms/${encodeURIComponent(realm)}/clients/${encodeURIComponent(clientId)}/default-client-scopes/${encodeURIComponent(target.id)}`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!assignResponse.ok && assignResponse.status !== 204) {
      throw new Error(`failed to assign scope "${scopeName}" (${assignResponse.status})`);
    }
    changes.push(`default scope +${scopeName}`);
  }
  return changes;
}

function buildPropertyMapper(name, overrides) {
  return {
    name,
    protocol: "openid-connect",
    protocolMapper: "oidc-usermodel-property-mapper",
    consentRequired: false,
    config: {
      "userinfo.token.claim": "true",
      "id.token.claim": "true",
      "access.token.claim": "true",
      "introspection.token.claim": "true",
      "jsonType.label": "String",
      ...overrides,
    },
  };
}

function buildRealmRoleMapper(name, overrides) {
  return {
    name,
    protocol: "openid-connect",
    protocolMapper: "oidc-usermodel-realm-role-mapper",
    consentRequired: false,
    config: {
      "multivalued": "true",
      "userinfo.token.claim": "true",
      "id.token.claim": "true",
      "access.token.claim": "true",
      "introspection.token.claim": "true",
      "jsonType.label": "String",
      ...overrides,
    },
  };
}

function sameStringArrays(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

function logInfo(message) {
  console.info(`[keycloak-sync] ${message}`);
}

function logWarn(message) {
  console.warn(`[keycloak-sync] ${message}`);
}

void main();
