/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [react()],

    /* page/server.py は dist/ をそのまま配信する。サブパスで開いても動くよう、相対パスで参照する */
    base: "./",

    build: {
        outDir: "dist",
        emptyOutDir: true
    },

    /* npm run dev のときは、OCR の API を page/server.py（既定のポート 5000）に中継する */
    server: {
        proxy: {
            "/api": "http://127.0.0.1:5000"
        }
    },

    test: {
        environment: "jsdom",
        include: ["src/**/*.test.ts"]
    }
});
