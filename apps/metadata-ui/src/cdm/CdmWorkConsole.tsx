import type { Role } from "../auth/AuthProvider";
import { CdmWorkListView } from "./CdmWorkListView";

type CdmWorkExplorerProps = {
  metadataEndpoint: string | null;
  authToken?: string | null;
  userRole: Role;
};

export function CdmWorkExplorer({ metadataEndpoint, authToken, userRole }: CdmWorkExplorerProps) {
  return <CdmWorkListView metadataEndpoint={metadataEndpoint} authToken={authToken} userRole={userRole} />;
}
