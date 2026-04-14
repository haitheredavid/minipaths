import { createRoot } from "react-dom/client";
import { AuthProvider } from "./AuthContext.tsx";
import { App } from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <AuthProvider>
    <App />
  </AuthProvider>
);
