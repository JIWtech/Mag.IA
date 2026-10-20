import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function preventViteDisconnectReloadPlugin() {
  return {
    name: 'prevent-vite-disconnect-reload',
    enforce: 'post',
    transform(code, id) {
      if (id.includes('client.mjs') || id.includes('@vite/client')) {
        const target = /await waitForSuccessfulPing\(url\.href\);[\r\n\s]+location\.reload\(\);/;
        if (target.test(code)) {
          return code.replace(
            target,
            `await waitForSuccessfulPing(url.href);
          try {
            console.log('[vite] Reconnecting WebSocket without full page reload...');
            await transport.connect(createHMRHandler(handleMessage));
            console.log('[vite] WebSocket reconnected successfully!');
          } catch (e) {
            console.warn('[vite] Silent reconnect failed, reloading...', e);
            location.reload();
          }`
          );
        }
      }
    },
  };
}

export default defineConfig({
  root: __dirname,
  plugins: [react(), preventViteDisconnectReloadPlugin()],
  server: {
    port: 5174,
    strictPort: true,
    hmr: {
      clientPort: 5174,
      timeout: 120000,
    },
  },
});
