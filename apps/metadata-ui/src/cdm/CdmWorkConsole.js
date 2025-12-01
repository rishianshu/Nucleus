import { jsx as _jsx } from "react/jsx-runtime";
import { CdmWorkListView } from "./CdmWorkListView";
export function CdmWorkExplorer({ metadataEndpoint, authToken, userRole }) {
    return _jsx(CdmWorkListView, { metadataEndpoint: metadataEndpoint, authToken: authToken, userRole: userRole });
}
