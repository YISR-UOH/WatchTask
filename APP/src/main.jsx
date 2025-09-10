import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/style/style.css";
import App from "@/App.jsx";
import { AuthProvider } from "@/context/AuthContext";
import { P2PProvider } from "@/context/P2PContext";
import { DBProvider } from "@/context/DBContext";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AuthProvider>
      <P2PProvider>
        <DBProvider>
          <App />
        </DBProvider>
      </P2PProvider>
    </AuthProvider>
  </StrictMode>
);
