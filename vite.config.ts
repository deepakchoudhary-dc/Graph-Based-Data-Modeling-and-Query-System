import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@client": path.resolve(__dirname, "src/client"),
      "@shared": path.resolve(__dirname, "src/shared")
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000"
    }
  },
  build: {
    outDir: "dist/client"
  }
});
