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

  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const uiLayer = document.getElementById('ui-layer') as HTMLElement;
  const ctx = canvas.getContext('2d', { alpha: false })!;

  let viewW = window.innerWidth;
  let viewH = window.innerHeight;

  const resize = () => {
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, viewW > 1440 ? 1.25 : 1.5);
    canvas.width = Math.floor(viewW * dpr);
    canvas.height = Math.floor(viewH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  window.addEventListener('resize', resize);
  resize();

  const input = new InputManager(canvas);

  let ui!: UIManager;
  const engine = new GameEngine(canvas, ctx, input, {
    onToggleArmoryShop: () => ui.toggleArmoryShop(),
    onBattleLevelUp: (choices, onPick) => ui.showLevelUpChoices(choices, onPick),
    onOpenTreasureChest: (choices, onPickOne, onTakeAllAd) =>
      ui.showTreasureChestModal(choices, onPickOne, onTakeAllAd),
    onPlayerDowned: (canRevive) => ui.showReviveModal(canRevive),
    onRunFinished: (victory, snapshot) => ui.showSettlementModal(victory, snapshot),
  });

  ui = new UIManager(uiLayer, engine);

  await PlatformSDK.init((adPaused) => {
    engine.paused = adPaused;
    if (adPaused) input.resetStates();
  });

  // CrazyGames 最佳实践：首次进入直接秒进第 1 关开打（Instant Play），无需繁琐点击开始！
  if (SaveManager.get().totalRuns === 0) {
    ui.startStageRun(STAGES[0], 'standard');
  } else {
    ui.showHomeHub();
  }

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
