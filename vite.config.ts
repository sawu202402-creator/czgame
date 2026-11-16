import { defineConfig } from 'vite';

export default defineConfig(() => {
  const rawPlatform = (process.env.VITE_PLATFORM || 'web').toLowerCase();
  const platform: 'crazygames' | 'poki' | 'web' =
    rawPlatform === 'crazygames' ? 'crazygames' : rawPlatform === 'poki' ? 'poki' : 'web';

  return {
    base: './',
    define: {
      __BUILD_PLATFORM__: JSON.stringify(platform),
    },
    plugins: [
      {
        name: 'inject-platform-sdk',
        transformIndexHtml: {
          order: 'pre',
          handler(html) {
            if (platform === 'crazygames') {
              return html.replace(
                '</head>',
                '    <!-- CrazyGames SDK v3 -->\n    <script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>\n  </head>'
              );
            }
            if (platform === 'poki') {
              return html.replace(
                '</head>',
                '    <!-- Poki SDK v2 -->\n    <script src="https://game-cdn.poki.com/scripts/v2/poki-sdk.js"></script>\n  </head>'
              );
            }
            return html;
          },
        },
      },
    ],
    server: {
      port: 5173,
      open: false,
    },
    build: {
      target: 'es2020',
      outDir: 'dist',
      assetsInlineLimit: 4096,
    },
  };
});
