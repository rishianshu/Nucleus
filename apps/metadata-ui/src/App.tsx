import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { LuCloudUpload, LuDatabase, LuGauge, LuLogOut, LuMoon, LuSun } from "react-icons/lu";
import { MetadataWorkspace } from "./metadata/MetadataWorkspace";
import { MetadataAuthBoundary } from "./metadata/MetadataAuthBoundary";
import { useAuth, type Role } from "./auth/AuthProvider";

const METADATA_ENDPOINT = import.meta.env.VITE_METADATA_GRAPHQL_ENDPOINT ?? "/metadata/graphql";

function App() {
  const auth = useAuth();
  const userRole: Role = auth.user?.role ?? "USER";
  const projectSlug = auth.user?.projectId ?? null;

  return (
    <MetadataAuthBoundary>
      <BrowserRouter>
        <Routes>
          <Route
            path="/"
            element={
              <MetadataWorkspaceShell
                metadataEndpoint={METADATA_ENDPOINT}
                authToken={auth.token}
                projectSlug={projectSlug}
                userRole={userRole}
              />
            }
          />
          <Route
            path="/catalog/datasets/:datasetId"
            element={
              <MetadataWorkspaceShell
                metadataEndpoint={METADATA_ENDPOINT}
                authToken={auth.token}
                projectSlug={projectSlug}
                userRole={userRole}
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </MetadataAuthBoundary>
  );
}

type MetadataWorkspaceShellProps = {
  metadataEndpoint: string | null;
  authToken?: string | null;
  projectSlug?: string | null;
  userRole: Role;
};

function MetadataWorkspaceShell({ metadataEndpoint, authToken, projectSlug, userRole }: MetadataWorkspaceShellProps) {
  const auth = useAuth();
  const { datasetId } = useParams<{ datasetId?: string }>();
  const navigate = useNavigate();
  const [shellCollapsed, setShellCollapsed] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDarkMode);
  }, [isDarkMode]);
  const handleDatasetRouteChange = useCallback(
    (nextId: string | null) => {
      if (nextId) {
        if (nextId !== datasetId) {
          navigate(`/catalog/datasets/${nextId}`);
        }
        return;
      }
      if (datasetId) {
        navigate("/");
      }
    },
    [datasetId, navigate],
  );

  const brand = "Nucleus";
  const brandMark = brand.charAt(0).toUpperCase();
  const shellMenu = useMemo(
    () => [
      { id: "metadata", label: "Metadata", icon: LuDatabase, href: "/", disabled: false },
      { id: "ingestion", label: "Ingestion", icon: LuCloudUpload, disabled: true },
      { id: "recon", label: "Reconciliation", icon: LuGauge, disabled: true },
    ],
    [],
  );

  return (
    <div className={`flex min-h-screen ${isDarkMode ? "bg-slate-900 text-slate-100" : "bg-slate-100 text-slate-900"}`}>
      <aside
        className={`flex flex-col border-r border-slate-200/70 bg-white/80 px-4 py-6 transition-[width] dark:border-slate-800/80 dark:bg-slate-900/70 ${
          shellCollapsed ? "w-20" : "w-64"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-300 text-sm font-semibold text-slate-600 dark:border-slate-600 dark:text-slate-200">
              {brandMark}
            </div>
            {!shellCollapsed && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-slate-400">Workspace</p>
                <p className="text-lg font-semibold text-slate-900 dark:text-white">{brand}</p>
              </div>
            )}
          </div>
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => setIsDarkMode((prev) => !prev)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
              aria-label="Toggle color mode"
            >
              {isDarkMode ? <LuSun className="h-4 w-4" /> : <LuMoon className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => setShellCollapsed((prev) => !prev)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
              aria-label="Toggle sidebar"
            >
              {shellCollapsed ? "›" : "‹"}
            </button>
          </div>
        </div>
        <nav className="mt-8 space-y-2">
          {shellMenu.map((item) => {
            const Icon = item.icon ?? LuDatabase;
            const isActive = item.id === "metadata";
            const disabled = item.disabled ?? item.id !== "metadata";
            return (
              <button
                key={item.id}
                type="button"
                title={item.label}
                onClick={() => {
                  if (disabled) {
                    return;
                  }
                  navigate(item.href ?? "/");
                }}
                disabled={disabled}
                className={`flex w-full items-center gap-3 rounded-2xl border text-sm transition ${
                  shellCollapsed ? "justify-center px-2 py-2" : "px-3 py-2"
                } ${
                  isActive
                    ? "border-slate-900 bg-slate-900 text-white shadow-sm dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                    : "border-transparent text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:text-slate-200"
                } ${disabled ? "opacity-60" : ""}`}
              >
                <Icon className="h-4 w-4" />
                {!shellCollapsed && (
                  <span className="text-left">
                    {item.label}
                    {disabled ? <span className="ml-1 text-xs text-slate-400">(soon)</span> : null}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        {!shellCollapsed && (
          <div className="mt-auto space-y-2 border-t border-slate-200 pt-4 text-sm dark:border-slate-800">
            <p className="font-semibold text-slate-700 dark:text-slate-200">{auth.user?.displayName ?? "Unknown user"}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{auth.user?.email ?? "—"}</p>
            <button
              type="button"
              onClick={() => auth.logout()}
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
            >
              <LuLogOut className="h-3 w-3" /> Logout
            </button>
          </div>
        )}
      </aside>
      <div className="flex flex-1 flex-col">
        <MetadataWorkspace
          metadataEndpoint={metadataEndpoint}
          authToken={authToken}
          projectSlug={projectSlug}
          userRole={userRole}
          datasetDetailRouteId={datasetId ?? null}
          onDatasetDetailRouteChange={handleDatasetRouteChange}
        />
      </div>
    </div>
  );
}

export default App;
