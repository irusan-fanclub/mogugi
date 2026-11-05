// Demo build: the overlay UI on sample data, as a static page (dist-demo/).
// Dev: npx vite --config vite.demo.config.mjs, then open /demo.html.
import path from 'node:path';
import { mergeConfig } from 'vite';
import base from './vite.config.mjs';

const src = p => path.resolve(__dirname, 'src', p);

const cfg = mergeConfig(base, {
    base: './',
    publicDir: false,
    resolve: {
        alias: [
            { find: /^@\/lib\/desktopBridge$/, replacement: src('demo/fakeBridge.ts') },
            { find: /^@\/lib\/runtimeEnv$/, replacement: src('demo/fakeRuntimeEnv.ts') },
            { find: /^\.\/useOverlayData$/, replacement: src('demo/fakeOverlayData.ts') },
        ],
    },
    build: { outDir: 'dist-demo', emptyOutDir: true, sourcemap: false },
});
// Type checking is the main build's job; the demo is a preview and may run mid-refactor.
cfg.plugins = cfg.plugins.flat().filter(p => !String(p?.name ?? '').includes('checker'));
cfg.build.rollupOptions = { input: { demo: path.resolve(__dirname, 'demo.html') } };
// The dev server still needs the icons from public/.
if (process.argv.includes('build')) cfg.publicDir = false; else cfg.publicDir = 'public';
export default cfg;
