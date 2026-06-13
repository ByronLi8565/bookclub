import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Alchemy injects the cloudflare vite plugin when it drives the build.
export default defineConfig({ plugins: [react()] });
