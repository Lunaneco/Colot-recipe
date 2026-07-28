import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import ColorRecipeApp from "./app/ColorRecipeApp";
import "./app/globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Application root was not found");
}

createRoot(root).render(
  <StrictMode>
    <ColorRecipeApp />
  </StrictMode>,
);
