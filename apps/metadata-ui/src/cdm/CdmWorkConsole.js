import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Navigate, Route, Routes } from "react-router-dom";
import { CdmWorkListView } from "./CdmWorkListView";
import { CdmWorkItemDetailView } from "./CdmWorkItemDetailView";
export function CdmWorkExplorer({ metadataEndpoint, authToken, userRole }) {
    return (_jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(Navigate, { to: "work/items", replace: true }) }), _jsx(Route, { path: "work/items", element: _jsx(CdmWorkListView, { metadataEndpoint: metadataEndpoint, authToken: authToken, userRole: userRole }) }), _jsx(Route, { path: "work/items/:cdmId", element: _jsx(CdmWorkItemDetailView, { metadataEndpoint: metadataEndpoint, authToken: authToken }) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "work/items", replace: true }) })] }));
}
