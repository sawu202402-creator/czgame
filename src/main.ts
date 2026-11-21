import './style.css';
import { STAGES } from './data/stages';
import { Assets } from './game/AssetLoader';
import { GameEngine } from './game/GameEngine';
import { InputManager } from './game/InputManager';
import { I18n } from './i18n/I18n';
import { SaveManager } from './meta/SaveManager';
import { PlatformSDK } from './platform/PlatformSDK';
import { UIManager } from './ui/UIManager';

async function bootstrap() {
  let engineRef: GameEngine | null = null;
  let inputRef: InputManager | null = null;

  await PlatformSDK.init((adPaused) => {
    if (engineRef) engineRef.paused = adPaused;
    if (adPaused) inputRef?.resetStates();
  });

  I18n.init((k) => PlatformSDK.getStorageItem(k));
  PlatformSDK.loadingStart();
  SaveManager.load();

  const bootLoader = document.getElementById('boot-loader');
  const bootFill = document.getElementById('boot-bar-fill');
  const bootPct = document.getElementById('boot-pct');

  // 跨境弱网防卡死保护：老玩家进大厅或点好友联机链接时最多等待 2.2s（新玩家最多 3.2s）即刻放行进界面，剩余贴图后台静默秒补！
  const maxBootWaitMs =
    SaveManager.get().tutorialDone || PlatformSDK.hasPendingInviteUrl() ? 2200 : 3200;
  await Promise.race([
    Assets.preloadCritical((loaded, total) => {
      const pct = Math.min(100, Math.max(8, Math.round((loaded / Math.max(1, total)) * 100)));
      if (bootFill) bootFill.style.width = `${pct}%`;
      if (bootPct) bootPct.textContent = `${pct}%`;
    }),
    new Promise<void>((resolve) => setTimeout(resolve, maxBootWaitMs)),
  ]);

  const gameRoot = document.getElementById('game-root') as HTMLElement;
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const uiLayer = document.getElementById('ui-layer') as HTMLElement;
  const landscapeGuard = document.getElementById('landscape-guard') as HTMLElement;
  const guardBtn = document.getElementById('btn-guard-landscape') as HTMLButtonElement;
  const ctx = canvas.getContext('2d', { alpha: false })!;

  const isMobileTouchDevice = () => PlatformSDK.isMobileOrTablet();

  if (!PlatformSDK.isFullscreenAllowed()) {
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
  inputRef = input;

  let ui!: UIManager;
  const engine = new GameEngine(canvas, ctx, input, {
    onToggleArmoryShop: () => ui.toggleArmoryShop(),
    onTogglePauseMenu: () => ui.togglePauseMenu(),
    onPlayerDowned: (canRevive) => ui.showReviveModal(canRevive),
    onRunFinished: (victory, snapshot) => ui.showSettlementModal(victory, snapshot),
    onShowPerkChoices: (choices, level, onPick) => ui.showPerkChoiceModal(choices, level, onPick),
  });
  engineRef = engine;

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

    const portraitOnMobile = (isMobileTouchDevice() || input.usingTouch) && viewH > viewW;
    const isDesktopCompact = !isMobileTouchDevice() && !input.usingTouch && (viewW < 1040 || viewH < 580);
    if (isDesktopCompact) {
      const uiScale = Math.min(1, Math.max(0.56, Math.min(viewW / 1060, viewH / 600)));
      uiLayer.style.width = `${(100 / uiScale).toFixed(3)}%`;
      uiLayer.style.height = `${(100 / uiScale).toFixed(3)}%`;
      uiLayer.style.transform = `scale(${uiScale.toFixed(4)})`;
    } else {
      uiLayer.style.width = '100%';
      uiLayer.style.height = '100%';
      uiLayer.style.transform = 'none';
    }
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
  if ((window as unknown as { __CZ_TRAILER_RECORDER__?: boolean }).__CZ_TRAILER_RECORDER__) {
    (window as unknown as Record<string, unknown>).__cz = {
      engine,
      ui,
      Assets,
      STAGES,
      syncViewportAndOrientation,
    };
  }
  if (bootLoader) {
    bootLoader.classList.add('fade-out');
    setTimeout(() => bootLoader.remove(), 320);
  }
  PlatformSDK.loadingStop();
  ui.launchInitialExperience();

  // 首屏秒开后，在后台静默分批预热全部 15 把武器与后续 8 大关卡贴图
  setTimeout(() => {
    Assets.preloadRemainingInBackground(() => {
      engine.bumpMapRevision();
    });
  }, 60);

  let lastTime = performance.now();
  let hudTick = 0;

  const loop = (now: number) => {
    requestAnimationFrame(loop);

    const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    if ((window as unknown as { __czManualStep?: boolean }).__czManualStep) {
      return;
    }

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
      console.error('[GameLoop Error]', err);
    }
  };

  requestAnimationFrame(loop);
}

bootstrap();
