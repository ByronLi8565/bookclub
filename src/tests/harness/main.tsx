import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ReaderHarness } from "./TestHarness.tsx";
import "../../client/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ReaderHarness />
  </StrictMode>,
);
