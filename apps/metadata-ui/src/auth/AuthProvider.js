import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { kc, MAX_AUTO_ATTEMPTS, captureKeycloakFragmentError, getAutoAttempts, getLastAuthError, initKeycloak, maybeAutoLogin, resetAutoAttempts, setLastAuthError, } from "./keycloak";
const AuthContext = createContext(undefined);
const hasKeycloak = Boolean(kc);
const disableProfileHydration = typeof import.meta.env.VITE_KC_DISABLE_PROFILE !== "undefined" &&
    String(import.meta.env.VITE_KC_DISABLE_PROFILE).trim() === "1";
export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(null);
    const [phase, setPhase] = useState(() => (hasKeycloak ? "boot" : "anonymous"));
    const [authError, setAuthError] = useState(() => (typeof window === "undefined" ? null : getLastAuthError()));
    const [autoAttempts, setAutoAttempts] = useState(() => (typeof window === "undefined" ? 0 : getAutoAttempts()));
    const lastLoggedError = useRef(null);
    const autoSuppressedReason = useRef(null);
    const initLogged = useRef(false);
    const hydratedProfiles = useRef(new Set());
    const syncAutoAttempts = useCallback(() => {
        setAutoAttempts(typeof window === "undefined" ? 0 : getAutoAttempts());
    }, []);
    const handleAuthError = useCallback((details, context) => {
        setAuthError(details);
        setLastAuthError(details);
        if (lastLoggedError.current !== details.timestamp) {
            lastLoggedError.current = details.timestamp;
            logAuthEvent("auth:error", {
                message: details.message,
                code: details.code ?? null,
                context,
                timestamp: details.timestamp,
            }, "error");
        }
    }, []);
    const syncFromKeycloak = useCallback((instance) => {
        if (!instance.token) {
            setUser(null);
            setToken(null);
            setPhase("anonymous");
            return;
        }
        const mapped = mapTokenToUser(instance.tokenParsed);
        if (!mapped) {
            setUser(null);
            setToken(null);
            setPhase("anonymous");
            return;
        }
        setToken(instance.token);
        setUser(mapped);
        if (typeof window !== "undefined") {
            window.__metadataAuthRole = mapped.role;
        }
        if (typeof document !== "undefined") {
            document.body.dataset.metadataAuthRole = mapped.role;
        }
        logAuthEvent("auth:role", { role: mapped.role });
        setPhase("authenticated");
        setAuthError(null);
        setLastAuthError(null);
        resetAutoAttempts();
        syncAutoAttempts();
        logAuthEvent("auth:success", {
            subject: mapped.id,
            tenantId: mapped.tenantId ?? null,
            projectId: mapped.projectId ?? null,
        });
    }, [syncAutoAttempts]);
    useEffect(() => {
        const fragmentError = captureKeycloakFragmentError();
        if (fragmentError) {
            handleAuthError(fragmentError, "fragment");
        }
        if (!initLogged.current) {
            initLogged.current = true;
            logAuthEvent("auth:init", { phase: hasKeycloak ? "checking" : "anonymous", keycloak: hasKeycloak });
        }
        if (!kc || typeof window === "undefined") {
            setPhase("anonymous");
            return;
        }
        const keycloak = kc;
        let cancelled = false;
        setPhase("checking");
        initKeycloak()
            .then(({ authenticated }) => {
            if (cancelled) {
                return;
            }
            if (authenticated) {
                syncFromKeycloak(keycloak);
            }
            else {
                const stored = getLastAuthError();
                if (stored) {
                    handleAuthError(stored, "stored");
                    setPhase("error");
                }
                else {
                    setPhase("anonymous");
                }
            }
            syncAutoAttempts();
        })
            .catch((error) => {
            if (!cancelled) {
                const message = error instanceof Error ? error.message : "Keycloak initialization failed";
                handleAuthError({
                    message,
                    code: "init_failed",
                    timestamp: Date.now(),
                }, "init");
                setPhase("error");
                syncAutoAttempts();
            }
        });
        keycloak.onAuthSuccess = () => {
            if (!cancelled) {
                syncFromKeycloak(keycloak);
            }
        };
        keycloak.onAuthRefreshSuccess = () => {
            if (!cancelled) {
                syncFromKeycloak(keycloak);
            }
        };
        keycloak.onAuthLogout = () => {
            if (!cancelled) {
                setUser(null);
                setToken(null);
                setPhase("anonymous");
            }
        };
        keycloak.onTokenExpired = () => {
            keycloak.updateToken(30).catch(() => {
                if (!cancelled) {
                    const errorDetails = {
                        message: "Session expired. Sign in again to continue.",
                        code: "token_refresh_failed",
                        timestamp: Date.now(),
                    };
                    handleAuthError(errorDetails, "refresh");
                    resetAutoAttempts();
                    syncAutoAttempts();
                    setUser(null);
                    setToken(null);
                    setPhase("error");
                }
            });
        };
        return () => {
            cancelled = true;
        };
    }, [handleAuthError, syncAutoAttempts, syncFromKeycloak]);
    useEffect(() => {
        if (!kc || typeof window === "undefined") {
            return;
        }
        if (authError) {
            if (autoSuppressedReason.current !== "error_blocked") {
                autoSuppressedReason.current = "error_blocked";
                logAuthEvent("auth:auto_suppressed", {
                    reason: "error_blocked",
                    message: authError.message,
                });
            }
            return;
        }
        if (phase !== "anonymous") {
            autoSuppressedReason.current = null;
            return;
        }
        if (getAutoAttempts() >= MAX_AUTO_ATTEMPTS) {
            if (autoSuppressedReason.current !== "exceeded_attempts") {
                autoSuppressedReason.current = "exceeded_attempts";
                logAuthEvent("auth:auto_suppressed", {
                    reason: "exceeded_attempts",
                    autoAttempts: getAutoAttempts(),
                });
            }
            syncAutoAttempts();
            return;
        }
        autoSuppressedReason.current = null;
        const attemptNumber = maybeAutoLogin();
        if (attemptNumber !== null) {
            logAuthEvent("auth:auto_attempt", {
                attempt: attemptNumber,
                route: currentRoute(),
                mode: "auto",
            });
            setPhase("authenticating");
            syncAutoAttempts();
        }
    }, [authError, phase, syncAutoAttempts]);
    useEffect(() => {
        if (disableProfileHydration) {
            return;
        }
        if (!kc || typeof kc.loadUserProfile !== "function") {
            return;
        }
        if (!user?.id) {
            hydratedProfiles.current.clear();
            return;
        }
        if (hydratedProfiles.current.has(user.id)) {
            return;
        }
        hydratedProfiles.current.add(user.id);
        let cancelled = false;
        kc.loadUserProfile()
            .then((profile) => {
            if (cancelled || !profile) {
                return;
            }
            setUser((current) => {
                if (!current || current.id !== user.id) {
                    return current;
                }
                const enriched = mergeProfileFields(profile, current);
                if (enriched.displayName === current.displayName &&
                    enriched.email === current.email &&
                    enriched.username === current.username) {
                    return current;
                }
                return enriched;
            });
        })
            .catch((error) => {
            hydratedProfiles.current.delete(user.id);
            logAuthEvent("auth:profile_failed", {
                message: error instanceof Error ? error.message : String(error),
            }, "error");
        });
        return () => {
            cancelled = true;
        };
    }, [user?.id, disableProfileHydration]);
    const login = useCallback(() => {
        if (!kc || typeof window === "undefined") {
            logAuthEvent("auth:auto_suppressed", { reason: "missing_keycloak" });
            return;
        }
        setAuthError(null);
        setLastAuthError(null);
        resetAutoAttempts();
        syncAutoAttempts();
        const attemptNumber = maybeAutoLogin();
        if (attemptNumber !== null) {
            logAuthEvent("auth:auto_attempt", {
                attempt: attemptNumber,
                route: currentRoute(),
                mode: "manual",
            });
            setPhase("authenticating");
            syncAutoAttempts();
        }
        else {
            const stored = getLastAuthError();
            if (stored) {
                handleAuthError(stored, "manual");
                setPhase("error");
            }
        }
    }, [handleAuthError, syncAutoAttempts]);
    const logout = useCallback(async () => {
        if (!kc || typeof window === "undefined") {
            return;
        }
        resetAutoAttempts();
        setLastAuthError(null);
        syncAutoAttempts();
        setAuthError(null);
        setUser(null);
        setToken(null);
        setPhase("anonymous");
        try {
            await kc.logout({ redirectUri: window.location.origin });
        }
        catch {
            // ignore logout errors
        }
    }, [syncAutoAttempts]);
    const value = useMemo(() => ({
        user,
        token,
        hasKeycloak,
        keycloak: kc,
        phase,
        error: authError,
        autoAttempts,
        maxAutoAttempts: MAX_AUTO_ATTEMPTS,
        login,
        logout,
    }), [authError, autoAttempts, login, logout, phase, token, user]);
    return _jsx(AuthContext.Provider, { value: value, children: children });
}
export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return ctx;
}
function currentRoute() {
    if (typeof window === "undefined") {
        return "/";
    }
    return window.location.pathname || "/";
}
function logAuthEvent(event, payload, level = "info") {
    const entry = { event, ...payload };
    if (typeof window !== "undefined") {
        const debugQueue = window.__authDebug;
        debugQueue?.push(entry);
    }
    const label = `[AuthLoop] ${event}`;
    if (level === "error") {
        // eslint-disable-next-line no-console
        console.error(label, payload);
    }
    else {
        // eslint-disable-next-line no-console
        console.info(label, payload);
    }
}
function mapTokenToUser(parsed) {
    if (!parsed) {
        return null;
    }
    const id = stringClaim(parsed.sub) ?? "anonymous";
    const username = stringClaim(parsed.preferred_username) ??
        stringClaim(parsed["preferred-username"]) ??
        id;
    const email = stringClaim(parsed.email) ?? `${username}@example.com`;
    const displayName = stringClaim(parsed.name) ?? username ?? email ?? id;
    const tenantId = stringClaim(parsed["tenant_id"]);
    const projectId = stringClaim(parsed["project_id"]);
    return {
        id,
        email,
        displayName,
        username,
        role: deriveRole(parsed),
        tenantId,
        projectId,
    };
}
function stringClaim(value) {
    return typeof value === "string" && value.trim().length > 0 ? value : null;
}
function mergeProfileFields(profile, fallback) {
    const profileDisplayName = buildProfileDisplayName(profile);
    const profileEmail = stringClaim(profile.email);
    const profileUsername = stringClaim(profile.username);
    return {
        ...fallback,
        displayName: profileDisplayName ?? fallback.displayName,
        email: profileEmail ?? fallback.email,
        username: profileUsername ?? fallback.username,
    };
}
function buildProfileDisplayName(profile) {
    if (!profile) {
        return null;
    }
    const firstName = stringClaim(profile.firstName);
    const lastName = stringClaim(profile.lastName);
    const combined = [firstName, lastName].filter(Boolean).join(" ").trim();
    if (combined.length > 0) {
        return combined;
    }
    return stringClaim(profile.username) ?? stringClaim(profile.email) ?? null;
}
function deriveRole(parsed) {
    const collected = new Set();
    const direct = parsed.roles;
    if (Array.isArray(direct)) {
        direct.forEach((entry) => collected.add(String(entry).toLowerCase()));
    }
    const realmRoles = parsed.realm_access?.roles;
    if (Array.isArray(realmRoles)) {
        realmRoles.forEach((role) => collected.add(String(role).toLowerCase()));
    }
    const resourceAccess = parsed.resource_access;
    if (resourceAccess) {
        Object.values(resourceAccess).forEach((resource) => {
            if (Array.isArray(resource.roles)) {
                resource.roles.forEach((role) => collected.add(String(role).toLowerCase()));
            }
        });
    }
    if (import.meta.env.DEV && typeof window !== "undefined") {
        window.__metadataRawRoles =
            Array.from(collected);
        window.__metadataAuthDebug = {
            collected: Array.from(collected),
            scope: typeof parsed.scope === "string" ? parsed.scope : null,
            direct: Array.isArray(parsed.roles) ? parsed.roles : null,
            realm: parsed.realm_access?.roles ?? null,
            resource: parsed.resource_access ?? null,
        };
    }
    if (collected.has("admin")) {
        return "ADMIN";
    }
    const hasWriterLike = collected.has("manager") || collected.has("writer") || collected.has("editor");
    if (hasWriterLike && !collected.has("reader")) {
        return "MANAGER";
    }
    return "USER";
}
