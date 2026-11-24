import { defineConfig } from 'vite';

export default defineConfig(() => {
  const rawPlatform = (process.env.VITE_PLATFORM || 'web').toLowerCase();
  const platform: 'crazygames' | 'poki' | 'gamedistribution' | 'y8' | 'itch' | 'web' =
    rawPlatform === 'crazygames'
      ? 'crazygames'
      : rawPlatform === 'poki'
        ? 'poki'
        : rawPlatform === 'gamedistribution' || rawPlatform === 'gd'
          ? 'gamedistribution'
          : rawPlatform === 'y8'
            ? 'y8'
            : rawPlatform === 'itch'
              ? 'itch'
              : 'web';
  const gdGameId = (process.env.VITE_GD_GAME_ID || '').trim();

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
                '    <!-- CrazyGames SDK v3 -->\n    <script defer src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>\n  </head>'
              );
            }
            if (platform === 'poki') {
              return html.replace(
                '</head>',
                '    <!-- Poki SDK v2 -->\n    <script defer src="https://game-cdn.poki.com/scripts/v2/poki-sdk.js"></script>\n  </head>'
              );
            }
            if (platform === 'gamedistribution') {
              const fallbackId = gdGameId || 'PASTE_YOUR_GD_GAME_ID_IN_GD_CONFIG_JS';
              const gdSnippet = [
                '    <!-- GameDistribution HTML5 SDK -->',
                '    <script src="./gd-config.js"></script>',
                '    <script>',
                '      window.__gdEventQueue = [];',
                '      window["GD_OPTIONS"] = {',
                `        gameId: window.CZ_GD_GAME_ID || ${JSON.stringify(fallbackId)},`,
                '        onEvent: function(event) {',
                '          if (window.__onGdSdkEvent) {',
                '            window.__onGdSdkEvent(event);',
                '          } else {',
                '            window.__gdEventQueue.push(event);',
                '          }',
                '        }',
                '      };',
                '      (function(d, s, id) {',
                '        var js, fjs = d.getElementsByTagName(s)[0];',
                '        if (d.getElementById(id)) return;',
                '        js = d.createElement(s);',
                '        js.id = id;',
                '        js.src = "https://html5.api.gamedistribution.com/main.min.js";',
                '        fjs.parentNode.insertBefore(js, fjs);',
                '      }(document, "script", "gamedistribution-jssdk"));',
                '    </script>',
                '  </head>',
              ].join('\n');
              return html.replace('</head>', gdSnippet);
            }
            if (platform === 'y8') {
              const y8Snippet = [
                '    <!-- Y8 Minimal HTML5 SDK v2 -->',
                '    <script src="./y8-config.js"></script>',
                '    <script async src="https://cdn.y8.com/minimal-sdk/2-0/y8.min.js"></script>',
                '  </head>',
              ].join('\n');
              return html.replace('</head>', y8Snippet);
            }
            if (platform === 'web') {
              const pwaSnippet = [
                '    <meta name="theme-color" content="#090e17" />',
                '    <meta name="mobile-web-app-capable" content="yes" />',
                '    <meta name="apple-mobile-web-app-capable" content="yes" />',
                '    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
                '    <meta name="apple-mobile-web-app-title" content="僵尸防线" />',
                '    <link rel="icon" type="image/png" sizes="32x32" href="./favicon-32.png?v=2" />',
                '    <link rel="apple-touch-icon" sizes="180x180" href="./apple-touch-icon.png?v=2" />',
                '    <link rel="manifest" href="./manifest.json?v=2" />',
                '  </head>',
              ].join('\n');
              return html.replace('</head>', pwaSnippet);
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
