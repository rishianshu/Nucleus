import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";

const metadataApiTarget = process.env.VITE_METADATA_API_URL ?? "http://localhost:4010";
const devPort = Number(process.env.VITE_METADATA_UI_PORT ?? 5176);
const devHost = process.env.VITE_METADATA_HOST ?? "127.0.0.1";
console.info(`[metadata-ui:vite] host=${devHost} port=${devPort}`);

export default defineConfig({
  plugins: [react()],
  envDir: path.resolve(__dirname, "..", ".."),
  server: {
    host: devHost,
    port: devPort,
    strictPort: true,
    proxy: {
      "/metadata/graphql": {
        target: metadataApiTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/metadata\/graphql/, "/graphql"),
      },
    },
  },
  preview: {
    port: Number(process.env.VITE_METADATA_UI_PREVIEW_PORT ?? 4176),
  },
});
