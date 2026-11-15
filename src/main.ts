import './style.css';
import { STAGES } from './data/stages';
import { Assets } from './game/AssetLoader';
import { GameEngine } from './game/GameEngine';
import { InputManager } from './game/InputManager';
import { SaveManager } from './meta/SaveManager';
import { PlatformSDK } from './platform/PlatformSDK';
import { UIManager } from './ui/UIManager';

async function bootstrap() {
  SaveManager.load();
  await Assets.preloadAll();

  const gameRoot = document.getElementById('game-root') as HTMLElement;
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const uiLayer = document.getElementById('ui-layer') as HTMLElement;
  const landscapeGuard = document.getElementById('landscape-guard') as HTMLElement;
  const guardBtn = document.getElementById('btn-guard-landscape') as HTMLButtonElement;
  const ctx = canvas.getContext('2d', { alpha: false })!;

  const isMobileTouchDevice = () =>
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

  const docWithWebkit = document as Document & { webkitFullscreenEnabled?: boolean };
  if (!document.fullscreenEnabled && !docWithWebkit.webkitFullscreenEnabled) {
    guardBtn.style.display = 'none';
  }

  guardBtn.onclick = async () => {
    try {
      const rootEl = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void>;
      };
      if (rootEl.requestFullscreen) await rootEl.requestFullscreen();
      else if (rootEl.webkitRequestFullscreen) await rootEl.webkitRequestFullscreen();
      const orient = screen.orientation as ScreenOrientation & {
        lock?: (mode: string) => Promise<void>;
      };
      await orient?.lock?.('landscape');
    } catch {
      // 浏览器不支持自动锁定时由玩家手动旋转机身即可
    }
  };

  let viewW = window.innerWidth;
  let viewH = window.innerHeight;

  const input = new InputManager(canvas);

  let ui!: UIManager;
  const engine = new GameEngine(canvas, ctx, input, {
    onToggleArmoryShop: () => ui.toggleArmoryShop(),
    onTogglePauseMenu: () => ui.togglePauseMenu(),
    onPlayerDowned: (canRevive) => ui.showReviveModal(canRevive),
    onRunFinished: (victory, snapshot) => ui.showSettlementModal(victory, snapshot),
  });

  const syncViewportAndOrientation = () => {
    if (window.scrollX !== 0 || window.scrollY !== 0) {
      window.scrollTo(0, 0);
    }
    viewW = Math.max(1, Math.round(gameRoot.clientWidth || window.innerWidth));
    viewH = Math.max(1, Math.round(gameRoot.clientHeight || window.innerHeight));
    const dpr = Math.min(window.devicePixelRatio || 1, viewW > 1440 ? 1.25 : 1.5);
    const targetW = Math.max(1, Math.floor(viewW * dpr));
    const targetH = Math.max(1, Math.floor(viewH * dpr));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#141d2b';
      ctx.fillRect(0, 0, viewW, viewH);
    } else {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // 手机端强制横屏体验：若处于竖屏握持，自动冻结战局并提示旋转手机
    const portraitOnMobile = (isMobileTouchDevice() || input.usingTouch) && viewH > viewW;
    landscapeGuard.classList.toggle('visible', portraitOnMobile);
    if (engine.landscapePaused !== portraitOnMobile) {
      engine.landscapePaused = portraitOnMobile;
      if (portraitOnMobile) {
        input.resetStates();
      }
    }
  };

  window.addEventListener('resize', syncViewportAndOrientation);
  window.visualViewport?.addEventListener('resize', syncViewportAndOrientation);
  document.addEventListener('fullscreenchange', syncViewportAndOrientation);
  window.addEventListener('orientationchange', () => {
    syncViewportAndOrientation();
    setTimeout(syncViewportAndOrientation, 150);
    setTimeout(syncViewportAndOrientation, 350);
  });
  syncViewportAndOrientation();

  ui = new UIManager(uiLayer, engine);

  await PlatformSDK.init((adPaused) => {
    engine.paused = adPaused;
    if (adPaused) input.resetStates();
  });

  // 当前开放全关卡自由选关预览，进入直接展示基地选关大厅
  ui.showHomeHub();

  let lastTime = performance.now();
  let hudTick = 0;

  const loop = (now: number) => {
    requestAnimationFrame(loop);

    const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;

    try {
      if (engine.state) {
        engine.update(dt, viewW, viewH);
        engine.render(viewW, viewH);
        hudTick += dt;
        if (hudTick >= 0.08) {
          hudTick = 0;
          ui.syncHUD();
        }
      }
    } catch (err) {
      console.error('[GameLoop Recovered]', err);
    }
  };

  requestAnimationFrame(loop);
}

bootstrap();
