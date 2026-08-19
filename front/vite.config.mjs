import path from 'node:path';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import checker from 'vite-plugin-checker';
import wasm from 'vite-plugin-wasm';

const targetPort = 8030;
const targetUrl = `http://localhost:${targetPort}`;

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));

function buildDataPlugin() {
    return {
        name: 'build-data',
        async buildStart() {
            await new Promise((resolve, reject) => {
                const script = path.resolve(__dirname, 'scripts/build-data.mjs');
                const child = spawn(process.execPath, [script], { stdio: 'inherit' });
                child.on('close', code => code === 0 ? resolve() : reject(new Error(`build-data exit ${code}`)));
                child.on('error', reject);
            });
        },
    };
}

// https://vitejs.dev/config/
export default defineConfig({
    define: {
        __IS_STANDALONE__: process.env.STANDALONE === 'true',
        __APP_VERSION__: JSON.stringify(pkg.version),
        __APP_TAGLINE__: JSON.stringify(process.env.MOGUGI_TAGLINE ?? ''),
    },
    plugins: [
        {
            // Favicons are cached per-origin far more aggressively than any
            // other asset; a version query forces the refresh on upgrades.
            name: 'favicon-version',
            transformIndexHtml: html => html.replace('/favicon.ico', `/favicon.ico?v=${pkg.version}`),
        },
        buildDataPlugin(),
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
            "@sqlite.org/sqlite-wasm",
        ],
    },
    build: {
        sourcemap: true,
        minify: false,
    },
});
