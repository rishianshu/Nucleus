import { jsx as _jsx } from "react/jsx-runtime";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import "./index.css";
const rootElement = document.getElementById("root");
if (!rootElement) {
    throw new Error("Root element not found");
}
ReactDOM.createRoot(rootElement).render(_jsx(React.StrictMode, { children: _jsx(AuthProvider, { children: _jsx(App, {}) }) }));
