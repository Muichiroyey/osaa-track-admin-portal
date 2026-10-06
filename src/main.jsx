import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { ToastProvider } from "./context/ToastContext.jsx";
import { LiveUpdatesProvider } from "./context/LiveUpdatesContext.jsx";
import { OSAAEntrance } from "./components/entrance/index.js";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {/* OSAAEntrance sits outside BrowserRouter on purpose: mounted inside it,
        the entrance would remount and replay on every route change. */}
    <OSAAEntrance>
      <BrowserRouter>
        <AuthProvider>
          <LiveUpdatesProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </LiveUpdatesProvider>
        </AuthProvider>
      </BrowserRouter>
    </OSAAEntrance>
  </React.StrictMode>
);
