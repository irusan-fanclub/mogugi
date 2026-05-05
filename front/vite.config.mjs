import path from 'node:path';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import checker from 'vite-plugin-checker';
import wasm from 'vite-plugin-wasm';

const targetPort = 8030;
const targetUrl = `http://localhost:${targetPort}`;

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));

// https://vitejs.dev/config/
export default defineConfig({
    define: {
        __IS_STANDALONE__: process.env.STANDALONE === 'true',
        __APP_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [
        vue(),
        vuetify(),
        checker({
            vueTsc: true,
        }),
        wasm(),
    ],
    server: {
        port: 8031,
        proxy: {
            '/ws': {
                target: targetUrl,
                changeOrigin: true,
                ws: true,
            },
            '/res': {
                target: targetUrl,
                changeOrigin: true,
            },
            '/api': {
                target: targetUrl,
                changeOrigin: true,
            },
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    optimizeDeps: {
        exclude: [
            "brotli-dec-wasm",
        ],
    },
    build: {
        sourcemap: true,
        minify: false,
    },
});
