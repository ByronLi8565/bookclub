import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// alchemy injects the cloudflare vite plugin when it drives the build.
export default defineConfig({
  plugins: [react()],
});
