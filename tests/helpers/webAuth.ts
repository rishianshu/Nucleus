import { expect, type Page } from "@playwright/test";

export const metadataBase = (process.env.METADATA_WEB_URL ?? "http://127.0.0.1:5176").replace(/\/+$/, "");
export const keycloakBase = (process.env.KEYCLOAK_BASE_URL ?? "http://localhost:8081").replace(/\/+$/, "");
const defaultUsername = process.env.KEYCLOAK_TEST_USERNAME ?? "dev-writer";
const defaultPassword = process.env.KEYCLOAK_TEST_PASSWORD ?? "password";
const keycloakRealm = process.env.KEYCLOAK_REALM ?? process.env.VITE_KEYCLOAK_REALM ?? "nucleus";
const keycloakAdminUser = process.env.KEYCLOAK_ADMIN ?? "admin";
const keycloakAdminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD ?? "admin";

export async function waitForKeycloakAuth(page: Page) {
  await page.waitForURL(
    (url) => url.href.startsWith(`${keycloakBase}/realms/`) && url.href.includes("/protocol/openid-connect/auth"),
    { timeout: 15_000 },
  );
}

type KeycloakCredentials = {
  username?: string;
  password?: string;
};

export async function loginViaKeycloak(page: Page, credentials?: KeycloakCredentials) {
  const username = credentials?.username ?? defaultUsername;
  const password = credentials?.password ?? defaultPassword;
  page.on("console", (msg) => {
    // eslint-disable-next-line no-console
    console.log(`[metadata:${msg.type()}] ${msg.text()}`);
    if (msg.type() === "error" && msg.args().length > 0) {
      const args = msg.args();
      void Promise.all(args.map((arg) => arg.jsonValue().catch(() => undefined))).then((values) => {
        const rendered = values
          .map((value) => {
            if (value === null || value === undefined) {
              return String(value);
            }
            if (typeof value === "object") {
              try {
                return JSON.stringify(value);
              } catch {
                return "[object]";
              }
            }
            return String(value);
          })
          .join(" ");
        // eslint-disable-next-line no-console
        console.error(`[metadata:error-detail] ${rendered}`);
      });
    }
  });
  page.on("pageerror", (error) => {
    // eslint-disable-next-line no-console
    console.error(`[metadata:pageerror] ${error.stack ?? error.message ?? String(error)}`);
  });

  if (credentials) {
    await page.context().clearCookies();
  }
  await page.goto(`${metadataBase}/`, { waitUntil: "domcontentloaded" });
  if (credentials) {
    await page.evaluate(() => {
      window.sessionStorage.clear();
      window.localStorage.clear();
    });
    await page.reload();
  }

  // If the app is already loaded (session cookie), skip auth entirely.
  const registerButton = page.getByTestId("metadata-register-open").first();
  const sessionReady = await registerButton.isVisible({ timeout: 5000 }).catch(() => false);
  if (sessionReady) {
    if (!credentials) {
      return;
    }
    const expandButton = page.getByRole("button", { name: /Expand sidebar/i });
    if (await expandButton.isVisible({ timeout: 500 }).catch(() => false)) {
      await expandButton.click();
    }
    const logoutButton = page.getByTestId("metadata-logout-button");
    if (await logoutButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await logoutButton.click();
      await page.waitForTimeout(500);
      await page.goto(`${metadataBase}/`, { waitUntil: "domcontentloaded" });
    } else {
      await page.evaluate(() => {
        window.sessionStorage.clear();
        window.localStorage.clear();
      });
      await page.reload();
    }
  }

  const continueButton = page.getByRole("button", { name: /Continue with Keycloak/i });
  if (await continueButton.isVisible({ timeout: 10000 }).catch(() => false)) {
    await continueButton.click();
  }

  await waitForKeycloakAuth(page);

  const usernameInput = page.locator("input[name='username']");
  const passwordInput = page.locator("input[name='password']");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await usernameInput.waitFor({ state: "visible", timeout: 15_000 });
    await usernameInput.fill(username);

    await passwordInput.waitFor({ state: "visible", timeout: 15_000 });
    await passwordInput.fill("");
    await passwordInput.type(password, { delay: 20 });

    await page.getByRole("button", { name: "Sign In" }).click();
    try {
      await page.waitForURL((url) => url.href.startsWith(metadataBase), { timeout: 20_000 });
      return;
    } catch (error) {
      const reauthVisible = await page.locator("text=Please re-authenticate").isVisible().catch(() => false);
      if (!reauthVisible) {
        throw error;
      }
      // fall through and retry credentials
    }
  }
  throw new Error("Keycloak login did not complete after multiple attempts");
}

export function captureAuthLogs(page: Page) {
  const events: string[] = [];
  page.on("console", (msg) => {
    if (msg.text().includes("[AuthLoop]")) {
      events.push(msg.text());
    }
  });
  return events;
}

export async function readSessionValue(page: Page, key: string) {
  return page.evaluate((storageKey) => window.sessionStorage.getItem(storageKey), key);
}

type RealmUserSpec = {
  username: string;
  password: string;
  roles: string[];
};

export async function ensureRealmUser(spec: RealmUserSpec) {
  const adminToken = await acquireAdminToken();
  let userId = await findUserId(spec.username, adminToken);
  if (!userId) {
    userId = await createRealmUser(spec, adminToken);
  }
  if (spec.roles.length > 0) {
    await ensureUserRoles(userId, spec.roles, adminToken);
  }
}

async function acquireAdminToken(): Promise<string> {
  const response = await fetch(`${keycloakBase}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: "admin-cli",
      grant_type: "password",
      username: keycloakAdminUser,
      password: keycloakAdminPassword,
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to acquire Keycloak admin token (${response.status})`);
  }
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new Error("Keycloak admin token missing access_token");
  }
  return payload.access_token;
}

async function findUserId(username: string, adminToken: string): Promise<string | null> {
  const response = await fetch(
    `${keycloakBase}/admin/realms/${keycloakRealm}/users?username=${encodeURIComponent(username)}`,
    {
      headers: { Authorization: `Bearer ${adminToken}` },
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch Keycloak user (${response.status})`);
  }
  const users = (await response.json()) as Array<{ id: string }>;
  return users[0]?.id ?? null;
}

async function createRealmUser(spec: RealmUserSpec, adminToken: string): Promise<string> {
  const response = await fetch(`${keycloakBase}/admin/realms/${keycloakRealm}/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username: spec.username,
      enabled: true,
      emailVerified: true,
      email: `${spec.username}@example.com`,
      firstName: "Dev",
      lastName: "Admin",
      credentials: [{ type: "password", value: spec.password, temporary: false }],
      attributes: { tenant_id: ["dev"], project_id: ["global"] },
    }),
  });
  if (response.status !== 201 && response.status !== 409) {
    throw new Error(`Failed to create Keycloak user (${response.status})`);
  }
  const existing = await findUserId(spec.username, adminToken);
  if (!existing) {
    throw new Error("Keycloak user creation did not return an id");
  }
  return existing;
}

async function ensureUserRoles(userId: string, roles: string[], adminToken: string) {
  const response = await fetch(
    `${keycloakBase}/admin/realms/${keycloakRealm}/users/${userId}/role-mappings/realm`,
    {
      headers: { Authorization: `Bearer ${adminToken}` },
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to read Keycloak user roles (${response.status})`);
  }
  const assigned = (await response.json()) as Array<{ name: string }>;
  const assignedNames = new Set(assigned.map((role) => role.name));
  const missingRoles = roles.filter((role) => !assignedNames.has(role));
  if (!missingRoles.length) {
    return;
  }
  const roleRepresentations = await Promise.all(
    missingRoles.map(async (role) => {
      const roleResponse = await fetch(`${keycloakBase}/admin/realms/${keycloakRealm}/roles/${role}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (!roleResponse.ok) {
        throw new Error(`Failed to load Keycloak role "${role}" (${roleResponse.status})`);
      }
      return (await roleResponse.json()) as { id: string; name: string };
    }),
  );
  const assignResponse = await fetch(
    `${keycloakBase}/admin/realms/${keycloakRealm}/users/${userId}/role-mappings/realm`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(roleRepresentations),
    },
  );
  if (!assignResponse.ok) {
    throw new Error(`Failed to assign Keycloak roles (${assignResponse.status})`);
  }
}
