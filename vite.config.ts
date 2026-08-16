import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");

  return {
    base: env.BASE_PATH || "/",
    plugins: [react()],
    build: {
      target: "es2022",
      sourcemap: mode !== "production",
      chunkSizeWarningLimit: 1400,
    },
  };
});
