import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

function offlineShellPlugin(): Plugin {
  return {
    name: 'fleetwise-offline-shell',
    apply: 'build',
    generateBundle(_options, bundle) {
      const builtAssets = Object.keys(bundle).filter((file) =>
        /\.(?:css|html|js|png|svg|webmanifest|woff2)$/.test(file)
      );
      const precacheUrls = [
        '/',
        '/index.html',
        '/manifest.webmanifest',
        '/pwa-icon.svg',
        '/pwa-icon-180.png',
        '/pwa-icon-192.png',
        '/pwa-icon-512.png',
        ...builtAssets.map((file) => `/${file}`)
      ];
      const uniqueUrls = [...new Set(precacheUrls)].sort();
      const revision = createHash('sha256')
        .update(uniqueUrls.join('\n'))
        .digest('hex')
        .slice(0, 12);
      const serviceWorker = `
const CACHE_NAME = 'fleetwise-shell-${revision}';
const PRECACHE_URLS = ${JSON.stringify(uniqueUrls)};
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE_URLS);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('fleetwise-shell-') && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const appShell = await cache.match('/index.html');
      if (appShell) return appShell;
    }
    return fetch(request);
  })());
});
`;
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: serviceWorker
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), offlineShellPlugin()],
  test: {
    environment: 'node',
    restoreMocks: true
  }
});
