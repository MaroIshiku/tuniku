import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../design-system/base.css";
import "../../design-system/components.css";
import "./styles.css";
import { App } from "./App.js";
import { I18nProvider } from "./lib/i18n.js";

const root = document.getElementById("root");
if (!root) throw new Error("Root element is missing.");

createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js"));
}
