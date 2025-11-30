import { Navigate, Route, Routes } from "react-router-dom";
import type { Role } from "../auth/AuthProvider";
import { CdmWorkListView } from "./CdmWorkListView";
import { CdmWorkItemDetailView } from "./CdmWorkItemDetailView";

type CdmWorkExplorerProps = {
  metadataEndpoint: string | null;
  authToken?: string | null;
  userRole: Role;
};

export function CdmWorkExplorer({ metadataEndpoint, authToken, userRole }: CdmWorkExplorerProps) {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="work/items" replace />} />
      <Route
        path="work/items"
        element={<CdmWorkListView metadataEndpoint={metadataEndpoint} authToken={authToken} userRole={userRole} />}
      />
      <Route
        path="work/items/:cdmId"
        element={<CdmWorkItemDetailView metadataEndpoint={metadataEndpoint} authToken={authToken} />}
      />
      <Route path="*" element={<Navigate to="work/items" replace />} />
    </Routes>
  );
}
