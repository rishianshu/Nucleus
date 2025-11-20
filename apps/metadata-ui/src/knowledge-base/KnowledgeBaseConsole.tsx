import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useMemo } from "react";
import type { Role } from "../auth/AuthProvider";
import { KnowledgeBaseOverview } from "./KnowledgeBaseOverview";
import { NodesExplorer } from "./NodesExplorer";
import { EdgesExplorer } from "./EdgesExplorer";
import { ScenesView } from "./ScenesView";
import { ProvenanceView } from "./ProvenanceView";

type KnowledgeBaseConsoleProps = {
  metadataEndpoint: string | null;
  authToken?: string | null;
  projectSlug?: string | null;
  userRole: Role;
};

export function KnowledgeBaseConsole({ metadataEndpoint, authToken, projectSlug, userRole }: KnowledgeBaseConsoleProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const tabs = useMemo(
    () => [
      { id: "overview", label: "Overview", href: "overview" },
      { id: "nodes", label: "Nodes", href: "explorer/nodes" },
      { id: "edges", label: "Edges", href: "explorer/edges" },
      { id: "scenes", label: "Scenes", href: "scenes" },
      { id: "provenance", label: "Provenance", href: "provenance" },
    ],
    [],
  );
  const activeTab = useMemo(() => {
    const match = tabs.find((tab) => location.pathname.includes(`/kb/${tab.href}`));
    return match?.id ?? "overview";
  }, [location.pathname, tabs]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50/60 dark:bg-slate-900/60">
      <header className="border-b border-slate-200 bg-white/80 px-6 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-slate-500">Knowledge Base</p>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Admin Console</h1>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                data-testid={`kb-tab-${tab.id}`}
                onClick={() => {
                  const targetPath = `/kb/${tab.href}${location.search || ""}`;
                  navigate(targetPath);
                }}
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] transition ${
                  activeTab === tab.id
                    ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                    : "border-slate-200 text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto px-6 py-6">
        <Routes>
          <Route path="/" element={<Navigate to="overview" replace />} />
          <Route
            path="overview"
            element={<KnowledgeBaseOverview metadataEndpoint={metadataEndpoint} authToken={authToken} />}
          />
          <Route
            path="explorer/nodes"
            element={
              <NodesExplorer metadataEndpoint={metadataEndpoint} authToken={authToken} projectSlug={projectSlug} userRole={userRole} />
            }
          />
          <Route
            path="explorer/edges"
            element={<EdgesExplorer metadataEndpoint={metadataEndpoint} authToken={authToken} />}
          />
          <Route
            path="scenes"
            element={<ScenesView metadataEndpoint={metadataEndpoint} authToken={authToken} />}
          />
          <Route
            path="provenance"
            element={<ProvenanceView metadataEndpoint={metadataEndpoint} authToken={authToken} />}
          />
          <Route path="*" element={<Navigate to="overview" replace />} />
        </Routes>
      </main>
    </div>
  );
}
