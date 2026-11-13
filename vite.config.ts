import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { defineConfig, Plugin } from 'vite';

// Current build timestamp for cache busting and versioning
const BUILD_TIMESTAMP = Date.now();
const APP_VERSION = '1.2.0';

/**
 * Custom Vite Plugin to write a fresh version.json into dist on build
 */
function versionJsonPlugin(): Plugin {
  return {
    name: 'version-json-generator',
    writeBundle() {
      const distDir = path.resolve('dist');
      if (!fs.existsSync(distDir)) {
        fs.mkdirSync(distDir, { recursive: true });
      }
      const versionData = {
        version: APP_VERSION,
        buildTime: BUILD_TIMESTAMP,
        timestamp: new Date(BUILD_TIMESTAMP).toISOString(),
      };
      fs.writeFileSync(
        path.join(distDir, 'version.json'),
        JSON.stringify(versionData, null, 2),
        'utf-8'
      );
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), versionJsonPlugin()],
    define: {
      'window.__APP_BUILD_TIME__': JSON.stringify(BUILD_TIMESTAMP),
      'window.__APP_VERSION__': JSON.stringify(APP_VERSION),
    },
    resolve: {
      alias: {
        '@': path.resolve('.'),
      },
    },
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-router-dom',
        'firebase/app',
        'firebase/auth',
        'firebase/firestore',
        'firebase/storage',
        'lucide-react',
        'qrcode',
      ],
    },
    build: {
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('firebase')) {
                return 'vendor-firebase';
              }
              if (id.includes('lucide-react')) {
                return 'vendor-icons';
              }
              if (id.includes('react-router-dom') || id.includes('react-dom') || id.includes('react')) {
                return 'vendor-react';
              }
              return 'vendor-libs';
            }
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâ€”file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
