import { SoundFX } from '../audio/SoundFX';
import { POWERUP_META, RELICS } from '../data/perksAndRelics';
import { STAGES } from '../data/stages';
import { WEAPON_LIST, WEAPONS } from '../data/weapons';
import { RunSnapshot } from '../game/Entities';
import { GameEngine } from '../game/GameEngine';
import { SaveManager, UPGRADE_TRACKS } from '../meta/SaveManager';
import { PlatformSDK } from '../platform/PlatformSDK';
import { GameMode, PowerUpType, StageDef } from '../types';

export class UIManager {
  private hudRoot: HTMLElement | null = null;
  private modalRoot: HTMLElement;
  private needleAnimId = 0;
  private armoryOpen = false;
  private pauseOpen = false;
  private selectedMode: GameMode = 'standard';
  private hubTab: 'stages' | 'upgrades' = 'stages';
  private armoryTab: 'guns' | 'supplies' = 'guns';
  private hudCache: Record<string, string> = {};
  private wepDomRefs: { btn: HTMLButtonElement; ammoEl: HTMLElement }[] = [];

  constructor(
    private uiLayer: HTMLElement,
    private engine: GameEngine
  ) {
    this.modalRoot = document.createElement('div');
    this.modalRoot.className = 'modal-host';
    this.uiLayer.appendChild(this.modalRoot);
  }

  // ==================== 特工战术指挥大厅 ====================

  private getAgentRankTitle(level: number): string {
    if (level >= 12) return '传奇统帅';
    if (level >= 8) return '王牌指挥官';
    if (level >= 5) return '铁血军士长';
    if (level >= 3) return '破阵先锋';
    return '新锐特工';
  }

  private isFullscreenSupported(): boolean {
    const doc = document as Document & { webkitFullscreenEnabled?: boolean };
    return Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
  }

  private isFullscreenActive(): boolean {
    const doc = document as Document & { webkitFullscreenElement?: Element | null };
    return Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
  }

  private async toggleFullscreen(): Promise<void> {
    try {
      const doc = document as Document & {
        webkitFullscreenElement?: Element | null;
        webkitExitFullscreen?: () => Promise<void>;
      };
      const el = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void>;
      };
      if (this.isFullscreenActive()) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
      } else {
        if (el.requestFullscreen) await el.requestFullscreen();
        else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
        const orient = screen.orientation as ScreenOrientation & {
          lock?: (mode: string) => Promise<void>;
        };
        orient?.lock?.('landscape').catch(() => {});
      }
    } catch {
      // 忽略部分移动浏览器全屏权限限制
    }
  }

  private bindCombatTap(btn: HTMLButtonElement, action: () => void): void {
    let lastTouchFire = 0;
    btn.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        e.preventDefault();
        e.stopPropagation();
        lastTouchFire = performance.now();
        if (!btn.disabled) action();
      }
    });
    btn.onclick = () => {
      if (performance.now() - lastTouchFire < 420) return;
      if (!btn.disabled) action();
    };
  }

  public showHomeHub(): void {
    cancelAnimationFrame(this.needleAnimId);
    this.armoryOpen = false;
    this.pauseOpen = false;
    this.engine.modalPaused = false;
    this.engine.paused = false;
    this.hudRoot?.remove();
    this.hudRoot = null;
    this.engine.state = null;

    const save = SaveManager.get();
    const hasAffordableUpgrade = UPGRADE_TRACKS.some(
      (t) => save.upgrades[t.key] < t.maxLevel && save.gold >= SaveManager.getUpgradeCost(t.key)
    );
    const muted = SoundFX.isUserMuted();
    const fsSupported = this.isFullscreenSupported();
    const fsActive = this.isFullscreenActive();

    const bodyHtml =
      this.hubTab === 'stages' ? this.buildStagesHubView(save) : this.buildUpgradesHubView(save);

    this.modalRoot.innerHTML = `
      <div class="hub-screen">
        <div class="hub-bg-art">
          <img src="./assets/hub_banner.jpg" alt="" />
        </div>

        <header class="hub-header">
          <div class="brand-block">
            <img class="brand-avatar" src="./assets/player_hero.png" alt="" />
            <div class="brand-titles">
              <h1>僵尸防线大作战</h1>
              <span class="brand-sub">SAS ZOMBIE FRONTLINE · 战术防区突围</span>
            </div>
          </div>

          <div class="hub-nav-tabs">
            <button class="seg-btn ${this.hubTab === 'stages' ? 'active' : ''}" data-hub-tab="stages">🗺️ 战区出击</button>
            <button class="seg-btn ${this.hubTab === 'upgrades' ? 'active' : ''}" data-hub-tab="upgrades">
              ⚡ 特工强化${hasAffordableUpgrade ? '<span class="nav-dot"></span>' : ''}
            </button>
          </div>

          <div class="agent-bar">
            <span class="gold-pill" title="永久特工金币">🪙 ${save.gold}</span>
            <button class="hub-util-btn" id="btn-hub-mute" title="音效开关">${muted ? '🔇' : '🔊'}</button>
            ${fsSupported ? `<button class="hub-util-btn ${fsActive ? 'active' : ''}" id="btn-hub-fs" title="全屏沉浸模式">⛶</button>` : ''}
          </div>
        </header>

        <main class="hub-main">
          ${bodyHtml}
        </main>

        <footer class="hub-footer-tip">
          📱 触屏：左半屏摇杆移动 · 右半屏滑动瞄准（默认自动索敌开火） ｜ 💻 键鼠：WASD 移动 · 鼠标射击 · B 军火库 · G 手雷
        </footer>
      </div>
    `;

    const muteBtn = this.modalRoot.querySelector('#btn-hub-mute') as HTMLButtonElement | null;
    if (muteBtn) {
      muteBtn.onclick = () => {
        SoundFX.toggleUserMute();
        this.showHomeHub();
      };
    }

    const fsBtn = this.modalRoot.querySelector('#btn-hub-fs') as HTMLButtonElement | null;
    if (fsBtn) {
      fsBtn.onclick = async () => {
        await this.toggleFullscreen();
        this.showHomeHub();
      };
    }

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-hub-tab]').forEach((btn) => {
      btn.onclick = () => {
        this.hubTab = btn.dataset.hubTab as 'stages' | 'upgrades';
        this.showHomeHub();
      };
    });

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-mode-pick]').forEach((btn) => {
      btn.onclick = () => {
        this.selectedMode = btn.dataset.modePick as GameMode;
        this.showHomeHub();
      };
    });

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-stage-go]').forEach((btn) => {
      btn.onclick = () => {
        const st = STAGES.find((item) => item.id === btn.dataset.stageGo)!;
        this.startStageRun(st, this.selectedMode);
      };
    });

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-upg]').forEach((btn) => {
      btn.onclick = () => {
        const key = btn.dataset.upg as keyof typeof save.upgrades;
        if (SaveManager.buyUpgrade(key)) {
          SoundFX.fanfare();
          this.showHomeHub();
        }
      };
    });
  }

  private buildStagesHubView(save: ReturnType<typeof SaveManager.get>): string {
    const xpNext = SaveManager.xpForNextLevel(save.agentLevel);
    const xpPct = Math.min(100, Math.round((save.agentXp / Math.max(1, xpNext)) * 100));
    const rankTitle = this.getAgentRankTitle(save.agentLevel);
    const bestEndless = Math.max(0, ...Object.values(save.endlessBestWave));

    const stageVisualMeta: {
      theme: string;
      sector: string;
      diffLabel: string;
      sprites: string[];
      tags: string[];
    }[] = [
      {
        theme: 'theme-police',
        sector: 'SECTOR 01 · 城市防线',
        diffLabel: '★☆☆ 推荐首战',
        sprites: ['prop_police_car', 'player_hero', 'mech_dog'],
        tags: ['🚪 6大防区', '🐕 机械警犬', '⚡ 超武改造机'],
      },
      {
        theme: 'theme-mall',
        sector: 'SECTOR 02 · 霓虹中庭',
        diffLabel: '★★☆ 进阶战区',
        sprites: ['prop_arcade', 'prop_vending', 'zombie_runner'],
        tags: ['🚪 6大防区', '🎰 幸运贩卖机', '🕹️ 街机掩体阵'],
      },
      {
        theme: 'theme-lab',
        sector: 'SECTOR 03 · 绝密深渊',
        diffLabel: '★★★ 高危禁区',
        sprites: ['prop_cryo_pod', 'prop_laser_tower', 'zombie_boss'],
        tags: ['🚪 6大防区', '🚨 旋转激光塔', '🧬 冷冻培养舱'],
      },
    ];

    const cards = STAGES.map((st, idx) => {
      const meta = stageVisualMeta[idx] || stageVisualMeta[0];
      const cleared = save.clearedStages.includes(st.id);
      const bestWave = save.endlessBestWave[st.id] || 0;
      const statusText =
        this.selectedMode === 'standard'
          ? cleared
            ? '✅ 已通关'
            : meta.diffLabel
          : bestWave > 0
            ? `🏆 最高 ${bestWave} 波`
            : '♾️ 极限生存';

      const spritesHtml = meta.sprites
        .map((sp, sIdx) => `<img class="stage-vis-sp sp-${sIdx}" src="./assets/${sp}.png" alt="" />`)
        .join('');

      const tagsHtml = meta.tags.map((tag) => `<span class="stage-tag">${tag}</span>`).join('');

      return `
        <article class="stage-card ${cleared ? 'is-cleared' : ''}">
          <div class="stage-visual-strip ${meta.theme}">
            <div class="stage-vis-top">
              <span class="stage-sector">${meta.sector}</span>
              <span class="stage-badge ${cleared && this.selectedMode === 'standard' ? 'cleared' : ''}">${statusText}</span>
            </div>
            <div class="stage-vis-sprites">
              ${spritesHtml}
            </div>
          </div>

          <div class="stage-card-body">
            <h3>${st.name}</h3>
            <p>${st.subtitle}</p>
            <div class="stage-tags">${tagsHtml}</div>
            <button class="btn-cartoon ${this.selectedMode === 'standard' ? 'btn-green' : 'btn-purple'} stage-go-btn" data-stage-go="${st.id}">
              ${this.selectedMode === 'standard' ? '▶ 空降出击 (10波撤离)' : '▶ 迎战无尽尸潮'}
            </button>
          </div>
        </article>
      `;
    }).join('');

    const showcaseIds = [
      'revolver',
      'autoshotgun',
      'flamethrower',
      'cryogun',
      'sawlauncher',
      'minigun',
      'tesla',
      'plasma',
    ];
    const showcaseGunsHtml = showcaseIds
      .map((id) => {
        const w = WEAPONS[id];
        if (!w) return '';
        return `
          <div class="arsenal-preview-chip">
            <img src="./assets/gun_${w.id}.png" alt="${w.name}" />
            <div class="arsenal-chip-meta">
              <span class="arsenal-chip-name">${w.name}</span>
              <span class="arsenal-chip-evo">⚡${w.superName}</span>
            </div>
          </div>
        `;
      })
      .join('');

    const modeDesc =
      this.selectedMode === 'standard'
        ? '坚守 10 波防线并击毙狂暴尸王，前往停机坪搭乘直升机撤离'
        : '无波次上限，精英暴君与尸王轮番压境，冲击最高生存波次纪录';

    return `
      <section class="hub-hero-banner">
        <div class="hero-dossier">
          <div class="hero-rank-row">
            <span class="hero-rank-pill">🎖️ Lv.${save.agentLevel} ${rankTitle}</span>
            <span class="hero-dmg-bonus">全枪伤害 +${(save.agentLevel - 1) * 4}%</span>
          </div>

          <div class="hero-xp-wrap">
            <div class="hero-xp-bar">
              <div class="hero-xp-fill" style="width:${xpPct}%"></div>
            </div>
            <span class="hero-xp-text">经验 ${save.agentXp}/${xpNext}</span>
          </div>

          <div class="hero-stats-row">
            <span class="hero-stat-chip">🏆 通关 ${save.clearedStages.length}/${STAGES.length}</span>
            <span class="hero-stat-chip">♾️ 最高 ${bestEndless > 0 ? `${bestEndless} 波` : '待挑战'}</span>
            <span class="hero-stat-chip">🔫 15把超武重火器</span>
          </div>

          <div class="hero-mode-box">
            <div class="seg-group">
              <button class="seg-btn ${this.selectedMode === 'standard' ? 'active' : ''}" data-mode-pick="standard">🚁 10波撤离</button>
              <button class="seg-btn ${this.selectedMode === 'endless' ? 'active' : ''}" data-mode-pick="endless">♾️ 无尽尸潮</button>
            </div>
            <span class="hero-mode-desc">${modeDesc}</span>
          </div>
        </div>

        <div class="hero-art-panel">
          <img class="hero-key-art" src="./assets/hub_banner.jpg" alt="僵尸防线大作战" />
          <div class="hero-art-caption">🔨 修窗固防 · 🔓 开门拓荒 · ⚡ 超武觉醒</div>
        </div>
      </section>

      <section class="stage-grid">${cards}</section>

      <section class="hub-arsenal-strip">
        <div class="arsenal-strip-head">
          <span class="arsenal-strip-title">🔥 战地军火库图鉴 <small>局内开门解锁 · 全枪械支持超武进化</small></span>
          <div class="tactical-loop-pills">
            <span>🔨 近窗自动钉板</span>
            <span>🎁 奇物空投箱</span>
            <span>👑 决战狂暴尸王</span>
          </div>
        </div>
        <div class="arsenal-preview-rail">${showcaseGunsHtml}</div>
      </section>
    `;
  }

  private buildUpgradesHubView(save: ReturnType<typeof SaveManager.get>): string {
    const xpNext = SaveManager.xpForNextLevel(save.agentLevel);
    const xpPct = Math.min(100, Math.round((save.agentXp / Math.max(1, xpNext)) * 100));
    const rankTitle = this.getAgentRankTitle(save.agentLevel);

    const upgradesHtml = UPGRADE_TRACKS.map((t) => {
      const lvl = save.upgrades[t.key];
      const isMax = lvl >= t.maxLevel;
      const cost = SaveManager.getUpgradeCost(t.key);
      const canBuy = !isMax && save.gold >= cost;
      const pct = Math.round((lvl / t.maxLevel) * 100);
      return `
        <div class="upgrade-card ${isMax ? 'maxed' : ''}">
          <div class="upg-top">
            <span class="upg-icon">${t.icon}</span>
            <div class="upg-info">
              <div class="upg-title">${t.name} <small>Lv.${lvl}/${t.maxLevel}</small></div>
              <div class="upg-val">${t.valueText(lvl)}</div>
            </div>
          </div>
          <p class="upg-desc">${t.desc}</p>
          <div class="upg-prog-track">
            <div class="upg-prog-fill" style="width:${pct}%"></div>
          </div>
          <button class="btn-cartoon btn-mini ${isMax ? 'btn-gray' : canBuy ? 'btn-yellow' : 'btn-disabled'}"
            data-upg="${t.key}" ${!canBuy ? 'disabled' : ''}>
            ${isMax ? '✅ 已满级' : `🪙 ${cost} 强化升级`}
          </button>
        </div>
      `;
    }).join('');

    return `
      <div class="upg-dossier-card">
        <img class="upg-hero-avatar" src="./assets/player_hero.png" alt="" />
        <div class="upg-dossier-body">
          <div class="upg-dossier-top">
            <strong>🎖️ Lv.${save.agentLevel} ${rankTitle}</strong>
            <span>全枪械永久伤害加成 +${(save.agentLevel - 1) * 4}%</span>
          </div>
          <div class="hero-xp-wrap">
            <div class="hero-xp-bar">
              <div class="hero-xp-fill" style="width:${xpPct}%"></div>
            </div>
            <span class="hero-xp-text">升级经验 ${save.agentXp}/${xpNext}</span>
          </div>
        </div>
      </div>
      <div class="upgrade-list">${upgradesHtml}</div>
    `;
  }

  public startStageRun(stage: StageDef, mode: GameMode): void {
    this.armoryOpen = false;
    this.pauseOpen = false;
    this.armoryTab = 'guns';
    this.modalRoot.innerHTML = '';
    if (this.engine.input.usingTouch && this.isFullscreenActive()) {
      const orient = screen.orientation as ScreenOrientation & {
        lock?: (mode: string) => Promise<void>;
      };
      orient?.lock?.('landscape').catch(() => {});
    }
    this.mountHUD();
    this.engine.startRun(stage, mode);
  }

  // ==================== 极简局内 HUD ====================

  private mountHUD(): void {
    this.hudRoot?.remove();
    this.hudCache = {};
    this.wepDomRefs = [];
    const hud = document.createElement('div');
    hud.className = 'hud-overlay';
    hud.innerHTML = `
      <div class="screen-vignette" id="hud-vignette"></div>

      <div class="hud-top">
        <div class="hud-left">
          <div class="hp-row">
            <div class="bar-box hp-box">
              <div class="bar-fill hp-fill" id="hud-hp-fill"></div>
              <span id="hud-hp-text">❤️ 100</span>
            </div>
            <span class="armor-chip" id="hud-armor-chip" style="display:none">🛡️ 0</span>
          </div>
          <div class="relic-row" id="hud-relics"></div>
        </div>

        <div class="hud-center">
          <div class="wave-pill" id="hud-wave">第 1/10 波</div>
          <div class="boss-bar-wrap" id="hud-boss-box" style="display:none">
            <div class="boss-bar-fill" id="hud-boss-fill"></div>
            <span id="hud-boss-text">👑 尸王</span>
          </div>
          <div class="fever-wrap" id="hud-fever-box" style="display:none">
            <div class="fever-fill fever-active" id="hud-fever-fill"></div>
            <span id="hud-fever-text">🔥 狂暴</span>
          </div>
          <div class="powerup-row" id="hud-powerups"></div>
        </div>

        <div class="hud-right">
          <div class="cash-pill" id="hud-cash">$80</div>
          <button class="hud-icon-btn" id="btn-pause" title="暂停 / 设置 (Esc)">⏸</button>
        </div>
      </div>

      <div class="hud-banner" id="hud-banner"></div>

      <div class="hud-bottom">
        <button class="hud-dock-btn hud-shop-btn" id="btn-open-armory">🛒 商店</button>
        <div class="weapon-slots" id="hud-weapons"></div>
        <button class="hud-dock-btn hud-gren-btn" id="btn-grenade">
          <img class="hud-gren-icon" src="./assets/prop_grenade.png" alt="" />
          <span id="hud-gren-count">2</span>
        </button>
      </div>
    `;
    this.uiLayer.appendChild(hud);
    this.hudRoot = hud;

    (hud.querySelector('#btn-pause') as HTMLButtonElement).onclick = () => {
      this.togglePauseMenu();
    };

    (hud.querySelector('#btn-open-armory') as HTMLButtonElement).onclick = () => {
      this.toggleArmoryShop();
    };

    this.bindCombatTap(hud.querySelector('#btn-grenade') as HTMLButtonElement, () => {
      this.engine.throwGrenade();
    });
  }

  // ==================== 极简暂停与设置小面板 ====================

  public togglePauseMenu(): void {
    const s = this.engine.state;
    if (!s || s.waveState === 'ended') return;

    if (this.armoryOpen) {
      this.toggleArmoryShop();
      return;
    }

    if (this.pauseOpen) {
      this.pauseOpen = false;
      this.modalRoot.innerHTML = '';
      this.engine.modalPaused = false;
      this.engine.flushQueuedModals();
      return;
    }

    if (this.engine.modalPaused) return;

    this.pauseOpen = true;
    this.engine.modalPaused = true;
    this.engine.input.resetStates();
    this.renderPauseMenu();
  }

  private renderPauseMenu(): void {
    const s = this.engine.state;
    if (!s) return;
    const autoOn = this.engine.input.autoFireEnabled;
    const muted = SoundFX.isUserMuted();
    const fsSupported = this.isFullscreenSupported();
    const fsActive = this.isFullscreenActive();

    this.modalRoot.innerHTML = `
      <div class="popup-backdrop" id="pause-backdrop">
        <div class="popup-box compact-modal">
          <h2>⏸ 战术暂停</h2>
          <p class="popup-sub">第 ${s.wave} 波 · 击杀 ${s.kills} · 战斗 Lv.${s.battleLevel}</p>
          <div class="pause-btn-stack">
            <button class="btn-cartoon btn-green" id="btn-resume">▶ 继续战斗</button>
            <button class="btn-cartoon ${autoOn ? 'btn-blue' : 'btn-gray'}" id="btn-toggle-auto">
              🎯 自动射击：${autoOn ? '开启' : '关闭'}
            </button>
            <button class="btn-cartoon btn-gray" id="btn-toggle-mute">
              ${muted ? '🔇 音效：已静音' : '🔊 音效：开启'}
            </button>
            ${
              fsSupported
                ? `<button class="btn-cartoon ${fsActive ? 'btn-yellow' : 'btn-gray'}" id="btn-toggle-fs">
                    ⛶ 全屏模式：${fsActive ? '开启中' : '点击开启'}
                  </button>`
                : ''
            }
            <button class="btn-cartoon btn-gray" id="btn-quit-hub">🏠 返回基地大厅</button>
          </div>
        </div>
      </div>
    `;

    (this.modalRoot.querySelector('#pause-backdrop') as HTMLElement).onclick = (e) => {
      if (e.target === e.currentTarget) this.togglePauseMenu();
    };

    (this.modalRoot.querySelector('#btn-resume') as HTMLButtonElement).onclick = () => {
      this.togglePauseMenu();
    };

    (this.modalRoot.querySelector('#btn-toggle-auto') as HTMLButtonElement).onclick = () => {
      this.engine.input.autoFireEnabled = !this.engine.input.autoFireEnabled;
      this.renderPauseMenu();
    };

    (this.modalRoot.querySelector('#btn-toggle-mute') as HTMLButtonElement).onclick = () => {
      SoundFX.toggleUserMute();
      this.renderPauseMenu();
    };

    const fsBtn = this.modalRoot.querySelector('#btn-toggle-fs') as HTMLButtonElement | null;
    if (fsBtn) {
      fsBtn.onclick = async () => {
        await this.toggleFullscreen();
        this.renderPauseMenu();
      };
    }

    (this.modalRoot.querySelector('#btn-quit-hub') as HTMLButtonElement).onclick = () => {
      this.pauseOpen = false;
      PlatformSDK.gameplayStop();
      this.showHomeHub();
    };
  }

  // ==================== 分栏清爽军火商店 ====================

  public toggleArmoryShop(): void {
    const s = this.engine.state;
    if (!s || s.waveState === 'ended') return;

    if (this.pauseOpen) {
      this.pauseOpen = false;
      this.modalRoot.innerHTML = '';
      this.engine.modalPaused = false;
    }

    if (this.armoryOpen) {
      this.armoryOpen = false;
      this.modalRoot.innerHTML = '';
      this.engine.modalPaused = false;
      this.engine.flushQueuedModals();
      return;
    }

    if (this.engine.modalPaused) return;

    this.armoryOpen = true;
    this.engine.modalPaused = true;
    this.engine.input.resetStates();
    this.renderArmoryShop('');
  }

  private renderArmoryShop(toastMsg: string): void {
    const s = this.engine.state;
    if (!s) return;

    const unlockedRooms = this.engine.getUnlockedExtraRoomsCount();
    const activeWep = s.player.weapons[s.player.activeSlot];
    const activeDef = WEAPONS[activeWep.defId];
    const save = SaveManager.get();

    let contentHtml = '';
    if (this.armoryTab === 'guns') {
      const canEvolve = !activeWep.evolved && s.cash >= 1850;
      const evolveStrip = activeWep.evolved
        ? `<div class="evolve-strip done">⚡ 当前主武器已进化为超武【${activeDef.superName}】</div>`
        : `<div class="evolve-strip">
            <span>⚡ 将【${activeDef.name}】进化为超武【${activeDef.superName}】</span>
            <button class="btn-cartoon btn-mini ${canEvolve ? 'btn-purple' : 'btn-disabled'}" id="btn-shop-evolve">
              $1850 进化
            </button>
          </div>`;

      const gunCards = WEAPON_LIST.map((w) => {
        const owned = s.player.weapons.find((inst) => inst.defId === w.id);
        const isEquipped = activeWep.defId === w.id;
        const locked = unlockedRooms < w.unlockRoomsRequired;

        let btnLabel = `$${w.shopCost} 购买`;
        let btnClass = s.cash >= w.shopCost ? 'btn-green' : 'btn-disabled';
        if (locked) {
          btnLabel = `🔒 需开 ${w.unlockRoomsRequired} 扇门`;
          btnClass = 'btn-disabled';
        } else if (owned) {
          if (w.maxReserve < 0) {
            btnLabel = isEquipped ? '装备中' : '切换';
            btnClass = isEquipped ? 'btn-gray' : 'btn-blue';
          } else {
            const maxRes = w.maxReserve * (owned.evolved ? 2 : 1);
            const full = owned.reserve >= maxRes && owned.mag >= this.engine.getMaxMag(w.id, owned.evolved);
            if (full) {
              btnLabel = isEquipped ? '弹药已满' : '切换';
              btnClass = isEquipped ? 'btn-gray' : 'btn-blue';
            } else {
              btnLabel = `补弹 $${w.ammoCost}`;
              btnClass = s.cash >= w.ammoCost ? 'btn-yellow' : 'btn-disabled';
            }
          }
        }

        return `
          <div class="armory-gun-card ${isEquipped ? 'equipped' : ''} ${locked ? 'locked' : ''}">
            <div class="gun-card-head">
              <img src="./assets/gun_${w.id}.png" alt="${w.name}" class="armory-gun-img" />
              <div class="gun-head-info">
                <div class="gun-title">${owned?.evolved ? `⚡${w.superName}` : w.name}</div>
                <div class="gun-tag">威力 ${w.damage * w.pellets} · 射速 ${w.fireRate}/s</div>
              </div>
            </div>
            <button class="btn-cartoon btn-mini ${btnClass}" data-buy-gun="${w.id}" ${locked ? 'disabled' : ''}>
              ${btnLabel}
            </button>
          </div>
        `;
      }).join('');

      contentHtml = `${evolveStrip}<div class="armory-gun-grid">${gunCards}</div>`;
    } else {
      const turretSupportText =
        s.hqSupportCooldown > 0
          ? `冷却 ${s.hqSupportCooldown.toFixed(0)}s`
          : save.freeHqSupportUsed
            ? '🎬 支援获取'
            : '🎁 首次免费';
      const elecSupportText =
        s.electricFortifyWaves > 0 ? `生效中(${s.electricFortifyWaves}波)` : '🎬 支援获取';
      const cashSupportText =
        s.armoryAdCooldown > 0 ? `冷却 ${s.armoryAdCooldown.toFixed(0)}s` : '🎬 空投 +$450';

      contentHtml = `
        <div class="supply-grid">
          <div class="supply-card">
            <div class="sup-name">🦺 防弹护甲 +65</div>
            <div class="sup-meta">当前 ${Math.round(s.player.armor)}/100 · 减伤70%</div>
            <button class="btn-cartoon btn-mini ${s.cash >= 380 && s.player.armor < 100 ? 'btn-blue' : 'btn-disabled'}" data-tac="armor">$380 购买</button>
          </div>
          <div class="supply-card">
            <div class="sup-name">❤️ 战地急救包</div>
            <div class="sup-meta">生命 ${Math.ceil(s.player.hp)}/${s.player.maxHp}</div>
            <button class="btn-cartoon btn-mini ${s.cash >= 300 && s.player.hp < s.player.maxHp ? 'btn-green' : 'btn-disabled'}" data-tac="medkit">$300 恢复满血</button>
          </div>
          <div class="supply-card">
            <div class="sup-name"><img class="sup-inline-icon" src="./assets/prop_grenade.png" alt="" /> M67 破片手雷 x3</div>
            <div class="sup-meta">当前持有 x${s.player.grenades}</div>
            <button class="btn-cartoon btn-mini ${s.cash >= 220 ? 'btn-yellow' : 'btn-disabled'}" data-tac="grenades">$220 购买</button>
          </div>
          <div class="supply-card">
            <div class="sup-name">📦 全枪弹药补满</div>
            <div class="sup-meta">补满携带的所有枪械</div>
            <button class="btn-cartoon btn-mini ${s.cash >= 320 ? 'btn-blue' : 'btn-disabled'}" data-tac="all_ammo">$320 补满</button>
          </div>
          <div class="supply-card">
            <div class="sup-name">🛰️ 自动哨戒机枪塔</div>
            <div class="sup-meta">持续协防 38 秒</div>
            <button class="btn-cartoon btn-mini ${s.cash >= 650 ? 'btn-yellow' : 'btn-disabled'}" data-tac="turret">$650 部署</button>
          </div>
          <div class="supply-card support-highlight">
            <div class="sup-name">💰 紧急军费空投</div>
            <div class="sup-meta">立即获得 $450 战地经费</div>
            <button class="btn-cartoon btn-mini ${s.armoryAdCooldown > 0 ? 'btn-disabled' : 'btn-yellow'}" id="btn-armory-ad" ${s.armoryAdCooldown > 0 ? 'disabled' : ''}>${cashSupportText}</button>
          </div>
          <div class="supply-card support-highlight">
            <div class="sup-name">🛰️ 总部炮塔+满弹支援</div>
            <div class="sup-meta">满弹 + 手雷x2 + 45秒炮塔</div>
            <button class="btn-cartoon btn-mini ${s.hqSupportCooldown > 0 ? 'btn-disabled' : 'btn-green'}" id="btn-sup-turret" ${s.hqSupportCooldown > 0 ? 'disabled' : ''}>${turretSupportText}</button>
          </div>
          <div class="supply-card support-highlight">
            <div class="sup-name">⚡ 全图高压电网</div>
            <div class="sup-meta">全窗封满 + 持续2波电击减速</div>
            <button class="btn-cartoon btn-mini ${s.electricFortifyWaves > 0 ? 'btn-disabled' : 'btn-blue'}" id="btn-sup-elec" ${s.electricFortifyWaves > 0 ? 'disabled' : ''}>${elecSupportText}</button>
          </div>
        </div>
      `;
    }

    this.modalRoot.innerHTML = `
      <div class="popup-backdrop" id="armory-backdrop">
        <div class="armory-modal">
          <header class="armory-header">
            <div class="armory-left-head">
              <h2>🛒 军火库</h2>
              <div class="seg-group dark">
                <button class="seg-btn ${this.armoryTab === 'guns' ? 'active' : ''}" data-shop-tab="guns">🔫 枪械</button>
                <button class="seg-btn ${this.armoryTab === 'supplies' ? 'active' : ''}" data-shop-tab="supplies">🧰 补给与支援</button>
              </div>
            </div>
            <div class="armory-wallet">
              <span class="shop-room-tag">已开防区 ${unlockedRooms}</span>
              <span class="cash-pill">$${s.cash}</span>
              <button class="shop-close-btn" id="btn-close-armory" title="关闭">✕</button>
            </div>
          </header>

          ${toastMsg ? `<div class="armory-toast">${toastMsg}</div>` : ''}

          <div class="armory-body">
            ${contentHtml}
          </div>
        </div>
      </div>
    `;

    (this.modalRoot.querySelector('#armory-backdrop') as HTMLElement).onclick = (e) => {
      if (e.target === e.currentTarget) this.toggleArmoryShop();
    };

    (this.modalRoot.querySelector('#btn-close-armory') as HTMLButtonElement).onclick = () => {
      this.toggleArmoryShop();
    };

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-shop-tab]').forEach((btn) => {
      btn.onclick = () => {
        this.armoryTab = btn.dataset.shopTab as 'guns' | 'supplies';
        this.renderArmoryShop('');
      };
    });

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-buy-gun]').forEach((btn) => {
      btn.onclick = () => {
        const res = this.engine.buyOrRefillWeaponFromShop(btn.dataset.buyGun!);
        this.renderArmoryShop(res.msg);
      };
    });

    const evolveBtn = this.modalRoot.querySelector('#btn-shop-evolve') as HTMLButtonElement | null;
    if (evolveBtn) {
      evolveBtn.onclick = () => {
        const res = this.engine.evolveActiveWeaponInShop(1850);
        this.renderArmoryShop(res.msg);
      };
    }

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-tac]').forEach((btn) => {
      btn.onclick = () => {
        const item = btn.dataset.tac as 'grenades' | 'medkit' | 'turret' | 'all_ammo' | 'armor';
        const res = this.engine.buyShopTacticalItem(item);
        this.renderArmoryShop(res.msg);
      };
    });

    const cashAdBtn = this.modalRoot.querySelector('#btn-armory-ad') as HTMLButtonElement | null;
    if (cashAdBtn) {
      cashAdBtn.onclick = async () => {
        if (s.armoryAdCooldown > 0) return;
        const ok = await PlatformSDK.showRewardedAd('armory_free_cash', '紧急军费空投 +$450');
        if (ok) {
          s.cash += 450;
          s.armoryAdCooldown = 90;
          PlatformSDK.gameplayStart();
          this.renderArmoryShop('💰 军费 +$450 已到账');
        }
      };
    }

    const supTurretBtn = this.modalRoot.querySelector('#btn-sup-turret') as HTMLButtonElement | null;
    if (supTurretBtn) {
      supTurretBtn.onclick = async () => {
        if (s.hqSupportCooldown > 0) return;
        if (!save.freeHqSupportUsed) {
          save.freeHqSupportUsed = true;
          SaveManager.save();
          this.toggleArmoryShop();
          this.engine.applyHqAmmoAndTurret();
        } else {
          const ok = await PlatformSDK.showRewardedAd('hq_ammo_turret', '满弹药 + 自动哨戒机枪塔');
          if (ok) {
            this.toggleArmoryShop();
            this.engine.applyHqAmmoAndTurret();
          }
        }
      };
    }

    const supElecBtn = this.modalRoot.querySelector('#btn-sup-elec') as HTMLButtonElement | null;
    if (supElecBtn) {
      supElecBtn.onclick = async () => {
        if (s.electricFortifyWaves > 0) return;
        const ok = await PlatformSDK.showRewardedAd('electric_fortify', '全图高压电网加固 (2波)');
        if (ok) {
          this.toggleArmoryShop();
          this.engine.applyElectricFortify();
        }
      };
    }
  }

  // ==================== 轻量 HUD 数据同步 ====================

  public syncHUD(): void {
    const s = this.engine.state;
    if (!s || !this.hudRoot) return;

    const setIfChanged = (key: string, val: string, fn: () => void) => {
      if (this.hudCache[key] !== val) {
        this.hudCache[key] = val;
        fn();
      }
    };

    const vigState = `${s.player.hp / s.player.maxHp < 0.3 ? 1 : 0}|${s.player.hitFlashTimer > 0 ? 1 : 0}`;
    setIfChanged('vig', vigState, () => {
      const vig = this.hudRoot!.querySelector('#hud-vignette') as HTMLElement;
      vig.classList.toggle('low-hp', s.player.hp / s.player.maxHp < 0.3);
      vig.classList.toggle('hit-flash', s.player.hitFlashTimer > 0);
    });

    const hpTextStr = `❤️ ${Math.ceil(s.player.hp)}/${s.player.maxHp}`;
    setIfChanged('hp', hpTextStr, () => {
      const hpFill = this.hudRoot!.querySelector('#hud-hp-fill') as HTMLElement;
      const hpText = this.hudRoot!.querySelector('#hud-hp-text') as HTMLElement;
      hpFill.style.width = `${Math.max(0, (s.player.hp / s.player.maxHp) * 100)}%`;
      hpText.textContent = hpTextStr;
    });

    const armorVal = Math.round(s.player.armor);
    setIfChanged('armor', `${armorVal}`, () => {
      const chip = this.hudRoot!.querySelector('#hud-armor-chip') as HTMLElement;
      if (armorVal > 0) {
        chip.style.display = 'inline-flex';
        chip.textContent = `🛡️ ${armorVal}`;
      } else {
        chip.style.display = 'none';
      }
    });

    let waveStr = '';
    if (s.waveState === 'extraction') {
      waveStr = `🚁 撤离 ${Math.round(s.extractionProgress * 100)}%`;
    } else if (s.waveState === 'intermission') {
      waveStr = `⏳ 备战 ${Math.ceil(s.intermissionTimer)}s`;
    } else {
      const waveLabel = s.mode === 'standard' ? `第 ${s.wave}/${s.maxWaves} 波` : `♾️ 第 ${s.wave} 波`;
      waveStr = `${waveLabel} · 🧟 ${s.zombiesRemainingInWave}`;
    }
    setIfChanged('wave', waveStr, () => {
      (this.hudRoot!.querySelector('#hud-wave') as HTMLElement).textContent = waveStr;
    });

    const bossTarget =
      s.zombies.find((z) => z.kind === 'boss') || s.zombies.find((z) => z.kind === 'miniboss');
    const bossKey = bossTarget ? `${bossTarget.id}:${Math.ceil(bossTarget.hp)}` : 'none';
    setIfChanged('bossHud', bossKey, () => {
      const bossBox = this.hudRoot!.querySelector('#hud-boss-box') as HTMLElement;
      if (bossTarget) {
        bossBox.style.display = 'block';
        const pct = Math.max(0, (bossTarget.hp / bossTarget.maxHp) * 100);
        (this.hudRoot!.querySelector('#hud-boss-fill') as HTMLElement).style.width = `${pct}%`;
        const title = bossTarget.kind === 'boss' ? '👑 尸王' : '🛡️ 暴君';
        (this.hudRoot!.querySelector('#hud-boss-text') as HTMLElement).textContent =
          `${title} ${Math.ceil(bossTarget.hp)}`;
      } else {
        bossBox.style.display = 'none';
      }
    });

    // 仅在 6.5 秒狂暴激活时显示紧凑计时条，平时完全隐藏不占视野
    const feverKey = s.feverTimer > 0 ? s.feverTimer.toFixed(1) : 'off';
    setIfChanged('fever', feverKey, () => {
      const feverBox = this.hudRoot!.querySelector('#hud-fever-box') as HTMLElement;
      if (s.feverTimer > 0) {
        feverBox.style.display = 'block';
        (this.hudRoot!.querySelector('#hud-fever-fill') as HTMLElement).style.width =
          `${(s.feverTimer / 6.5) * 100}%`;
        (this.hudRoot!.querySelector('#hud-fever-text') as HTMLElement).textContent =
          `🔥 狂暴 ${s.feverTimer.toFixed(1)}s`;
      } else {
        feverBox.style.display = 'none';
      }
    });

    const cashStr = `$${s.cash}`;
    setIfChanged('cash', cashStr, () => {
      (this.hudRoot!.querySelector('#hud-cash') as HTMLElement).textContent = cashStr;
    });

    const pulseShop =
      s.waveState === 'intermission' || (s.player.weapons.length === 1 && s.cash >= 400) ? '1' : '0';
    setIfChanged('pulseShop', pulseShop, () => {
      (this.hudRoot!.querySelector('#btn-open-armory') as HTMLButtonElement).classList.toggle(
        'shop-ready',
        pulseShop === '1'
      );
    });

    const grenStr = `${s.player.grenades}`;
    setIfChanged('gren', grenStr, () => {
      const grenBtn = this.hudRoot!.querySelector('#btn-grenade') as HTMLButtonElement;
      const grenCnt = this.hudRoot!.querySelector('#hud-gren-count') as HTMLElement;
      grenCnt.textContent = grenStr;
      grenBtn.disabled = s.player.grenades <= 0;
    });

    const bannerKey = s.bannerTimer > 0 && s.bannerText ? s.bannerText : '';
    setIfChanged('banner', bannerKey, () => {
      const bannerEl = this.hudRoot!.querySelector('#hud-banner') as HTMLElement;
      if (bannerKey) {
        bannerEl.textContent = bannerKey;
        bannerEl.classList.add('visible');
      } else {
        bannerEl.classList.remove('visible');
      }
    });

    const relicSig = s.relicIds.join(',');
    setIfChanged('relics', relicSig, () => {
      const relicRow = this.hudRoot!.querySelector('#hud-relics') as HTMLElement;
      relicRow.innerHTML = s.relicIds
        .map((id) => {
          const r = RELICS.find((item) => item.id === id);
          return r ? `<span class="relic-chip" title="${r.name}">${r.icon}</span>` : '';
        })
        .join('');
    });

    const activePows = (Object.keys(s.powerUpTimers) as PowerUpType[])
      .filter((k) => s.powerUpTimers[k] > 0)
      .map(
        (k) =>
          `<span class="pow-chip" style="background:${POWERUP_META[k].color}">${POWERUP_META[k].icon} ${s.powerUpTimers[k].toFixed(0)}s</span>`
      )
      .join('');
    setIfChanged('pows', activePows, () => {
      (this.hudRoot!.querySelector('#hud-powerups') as HTMLElement).innerHTML = activePows;
    });

    const wepStructSig = s.player.weapons.map((w) => `${w.defId}:${w.evolved ? 1 : 0}`).join('|');
    setIfChanged('wepStruct', wepStructSig, () => {
      const wContainer = this.hudRoot!.querySelector('#hud-weapons') as HTMLElement;
      wContainer.innerHTML = s.player.weapons
        .map((w, idx) => {
          const def = WEAPONS[w.defId];
          const name = w.evolved ? `⚡${def.superName}` : def.name;
          return `
            <button class="wep-slot ${w.evolved ? 'evolved' : ''}" data-slot="${idx}" title="${name}（点击切枪 / 再次点击换弹）">
              <img src="./assets/gun_${w.defId}.png" alt="${name}" class="wep-icon" />
              <span class="wep-ammo"></span>
            </button>
          `;
        })
        .join('');

      this.wepDomRefs = Array.from(wContainer.querySelectorAll<HTMLButtonElement>('[data-slot]')).map((btn) => {
        this.bindCombatTap(btn, () => {
          const slot = Number(btn.dataset.slot);
          if (this.engine.state?.player.activeSlot === slot) {
            this.engine.startReload();
          } else {
            this.engine.switchWeapon(slot);
          }
        });
        return {
          btn,
          ammoEl: btn.querySelector('.wep-ammo') as HTMLElement,
        };
      });
    });

    s.player.weapons.forEach((w, idx) => {
      const ref = this.wepDomRefs[idx];
      if (!ref) return;
      const active = idx === s.player.activeSlot;
      ref.btn.classList.toggle('active', active);
      const ammoStr =
        s.player.reloadTimer > 0 && active
          ? '换弹...'
          : w.reserve < 0
            ? `${w.mag}/∞`
            : `${w.mag}/${w.reserve}`;
      if (ref.ammoEl.textContent !== ammoStr) {
        ref.ammoEl.textContent = ammoStr;
      }
    });
  }

  // ==================== 复活与结算简洁弹窗 ====================

  public showReviveModal(canRevive: boolean): void {
    this.armoryOpen = false;
    this.pauseOpen = false;
    const s = this.engine.state!;
    if (!canRevive) {
      s.waveState = 'ended';
      this.showSettlementModal(false, s);
      return;
    }

    this.modalRoot.innerHTML = `
      <div class="popup-backdrop">
        <div class="popup-box compact-modal">
          <h2>🚨 特工倒地</h2>
          <p class="popup-sub">坚守至第 ${s.wave} 波 · 歼灭 ${s.kills} 只僵尸</p>
          <div class="revive-perks">
            <span>⚡ 全屏震飞</span>
            <span>❤️ 满血满弹</span>
            <span>🔨 全窗封死</span>
          </div>
          <div class="popup-footer">
            <button class="btn-cartoon btn-green" id="btn-do-revive">🎬 空投复活</button>
            <button class="btn-cartoon btn-gray" id="btn-skip-revive">直接结算</button>
          </div>
        </div>
      </div>
    `;

    const reviveBtn = this.modalRoot.querySelector('#btn-do-revive') as HTMLButtonElement;
    reviveBtn.onclick = async () => {
      reviveBtn.disabled = true;
      const ok = await PlatformSDK.showRewardedAd('revive_shockwave', '绝境震爆复活 + 全窗加固');
      if (ok) {
        this.modalRoot.innerHTML = '';
        this.engine.modalPaused = false;
        this.engine.applyTacticalRevive();
        this.engine.flushQueuedModals();
      } else {
        reviveBtn.disabled = false;
      }
    };

    (this.modalRoot.querySelector('#btn-skip-revive') as HTMLButtonElement).onclick = () => {
      s.waveState = 'ended';
      this.showSettlementModal(false, s);
    };
  }

  public showSettlementModal(victory: boolean, s: RunSnapshot): void {
    this.armoryOpen = false;
    this.pauseOpen = false;
    const baseGold = Math.round(25 + s.wave * 14 + Math.min(220, s.kills * 0.45) + (victory ? 110 : 0));
    const baseXp = Math.round(30 + s.wave * 16 + Math.min(260, s.kills * 0.65) + (victory ? 100 : 0));
    const zones = [2, 3, 5, 3, 2];

    this.modalRoot.innerHTML = `
      <div class="popup-backdrop">
        <div class="popup-box compact-modal">
          <h2>${victory ? '🚁 撤离成功' : '🎖️ 行动结算'}</h2>
          <p class="popup-sub">第 ${s.wave} 波 · 歼灭 ${s.kills} 只僵尸</p>

          <div class="reward-preview">
            <span>🪙 <strong id="rew-gold">+${baseGold}</strong></span>
            <span>🎖️ <strong id="rew-xp">+${baseXp} XP</strong></span>
          </div>

          <div class="meter-wrap">
            <div class="meter-bar">
              <span class="m-z z2">x2</span>
              <span class="m-z z3">x3</span>
              <span class="m-z z5">x5</span>
              <span class="m-z z3">x3</span>
              <span class="m-z z2">x2</span>
              <div class="meter-needle" id="settle-needle"></div>
            </div>
          </div>

          <div class="popup-footer">
            <button class="btn-cartoon btn-yellow" id="btn-mult-claim">
              🎬 翻倍领取 (<span id="mult-live">x5</span>)
            </button>
            <button class="btn-cartoon btn-gray" id="btn-normal-claim">普通领取</button>
          </div>
        </div>
      </div>
    `;

    const needle = this.modalRoot.querySelector('#settle-needle') as HTMLElement;
    const multLive = this.modalRoot.querySelector('#mult-live') as HTMLElement;
    const goldEl = this.modalRoot.querySelector('#rew-gold') as HTMLElement;
    const xpEl = this.modalRoot.querySelector('#rew-xp') as HTMLElement;

    let pos = 0.5;
    let currentMult = 5;
    let stopped = false;

    const animateNeedle = (now: number) => {
      if (stopped) return;
      pos = (Math.sin(now * 0.0042) + 1) / 2;
      needle.style.left = `${pos * 100}%`;
      const idx = Math.min(4, Math.floor(pos * 5));
      currentMult = zones[idx];
      multLive.textContent = `x${currentMult}`;
      this.needleAnimId = requestAnimationFrame(animateNeedle);
    };
    this.needleAnimId = requestAnimationFrame(animateNeedle);

    (this.modalRoot.querySelector('#btn-mult-claim') as HTMLButtonElement).onclick = async () => {
      stopped = true;
      cancelAnimationFrame(this.needleAnimId);
      const lockedMult = currentMult;
      const ok = await PlatformSDK.showRewardedAd(
        'settlement_multiplier',
        `结算奖励 x${lockedMult} 倍暴击领取`
      );
      if (ok) {
        goldEl.textContent = `+${baseGold * lockedMult}`;
        xpEl.textContent = `+${baseXp * lockedMult} XP`;
        SaveManager.addRewards(baseGold * lockedMult, baseXp * lockedMult);
        this.showHomeHub();
      } else {
        stopped = false;
        this.needleAnimId = requestAnimationFrame(animateNeedle);
      }
    };

    (this.modalRoot.querySelector('#btn-normal-claim') as HTMLButtonElement).onclick = () => {
      stopped = true;
      cancelAnimationFrame(this.needleAnimId);
      SaveManager.addRewards(baseGold, baseXp);
      this.showHomeHub();
    };
  }
}
