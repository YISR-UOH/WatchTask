import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
// https://vite.dev/config/
export default defineConfig({
  base: "/WatchTask/",
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      workbox: {
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
      },
      registerType: "autoUpdate",
      manifest: {
        name: "WatchTask",
        short_name: "WatchTask",
        start_url: "/WatchTask/",
        scope: "/WatchTask/",
        display: "standalone",
        description: "Aplicación para gestionar ordenes de mantenimiento",
        background_color: "#ffffff",
        theme_color: "#1976d2",
        icons: [
          {
            src: "pwa-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "maskable-icon.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "apple-touch-icon.png",
            sizes: "180x180",
            type: "image/png",
            purpose: "any",
          },
        ],
      },
    }),
  ],
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 5 * 1024 * 1024,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    exclude: ["node_modules", "**/node_modules/*"],
  },
});
