import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwind from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  plugins: [
    vue(),
    tailwind(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "coletor-sw.ts",
      scope: "/coletor",
      registerType: "prompt",
      injectRegister: false,
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      manifest: {
        name: "Recicla+ Coletor",
        short_name: "Recicla+",
        start_url: "/coletor",
        scope: "/coletor",
        display: "standalone",
        lang: "pt-BR",
        background_color: "#f6f8f7",
        theme_color: "#14694c",
        icons: [
          { src: "/coletor/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/coletor/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
  server: { proxy: { "/api": "http://127.0.0.1:3001" } },
  build: { sourcemap: false },
});
