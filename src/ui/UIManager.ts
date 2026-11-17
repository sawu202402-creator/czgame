import { SoundFX } from '../audio/SoundFX';
import { getBossProfile, isBossKind } from '../data/enemies';
import { POWERUP_META, RELICS } from '../data/perksAndRelics';
import { STAGES } from '../data/stages';
import { WEAPON_LIST, WEAPONS } from '../data/weapons';
import { RunSnapshot } from '../game/Entities';
import { GameEngine } from '../game/GameEngine';
import { I18n, LANG_OPTIONS, LangCode } from '../i18n/I18n';
import { SaveManager, UPGRADE_TRACKS } from '../meta/SaveManager';
import {
  AGENT_CLASSES,
  DAILY_CHECKIN_REWARDS,
  DAILY_GRAND_BONUS,
  buildLeaderboardRows,
  getAgentClassDef,
  getDailyMissionsForDate,
  getLocalizedClassText,
} from '../meta/ProgressionDefs';
import { CoopManager } from '../net/CoopManager';
import { SQUAD_SLOTS, getCoopScaling } from '../net/CoopProtocol';
import { PlatformSDK } from '../platform/PlatformSDK';
import { AgentClassId, GameMode, InRunPerkDef, PowerUpType, StageDef } from '../types';

export class UIManager {
  private hudRoot: HTMLElement | null = null;
  private modalRoot: HTMLElement;
  private needleAnimId = 0;
  private armoryOpen = false;
  private pauseOpen = false;
  private selectedMode: GameMode = 'standard';
  private hubTab: 'stages' | 'upgrades' | 'coop' | 'daily' | 'rank' = 'stages';
  private rankSort: 'endless' | 'kills' = 'endless';
  private armoryTab: 'guns' | 'supplies' = 'guns';
  private hudCache: Record<string, string> = {};
  private coopToast = '';
  private perkKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    private uiLayer: HTMLElement,
    private engine: GameEngine
  ) {
    this.modalRoot = document.createElement('div');
    this.modalRoot.className = 'modal-host';
    this.uiLayer.appendChild(this.modalRoot);

    CoopManager.bindUI(
      () => {
        if (!this.engine.state && this.hubTab === 'coop') {
          this.showHomeHub();
        }
      },
      (stageId, mode) => {
        const st = STAGES.find((item) => item.id === stageId) || STAGES[0];
        this.startStageRun(st, mode);
      }
    );

    PlatformSDK.registerJoinRoomListener((joinCode) => {
      if (this.engine.state) {
        PlatformSDK.gameplayStop();
        this.showHomeHub();
      }
      this.hubTab = 'coop';
      CoopManager.joinRoomByCode(joinCode);
      this.showHomeHub();
    });

    const urlRoom = CoopManager.consumeUrlRoomParam();
    if (urlRoom) {
      this.hubTab = 'coop';
      setTimeout(() => CoopManager.joinRoomByCode(urlRoom), 60);
    } else if (PlatformSDK.isInstantMultiplayerRequested()) {
      this.hubTab = 'coop';
      setTimeout(() => CoopManager.createHostRoom(STAGES[0].id, this.selectedMode), 60);
    }
  }

  private getAgentRankTitle(level: number): string {
    if (level >= 12) return I18n.t('rank12');
    if (level >= 8) return I18n.t('rank8');
    if (level >= 5) return I18n.t('rank5');
    if (level >= 3) return I18n.t('rank3');
    return I18n.t('rank1');
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
      // ignore fullscreen restrictions
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

  private bindModalTap(btn: HTMLButtonElement, action: () => void): void {
    let lastTouchFire = 0;
    btn.addEventListener('pointerup', (e) => {
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

  // ==================== 特工战术指挥大厅 ====================

  private clearPerkKeyHandler(): void {
    if (this.perkKeyHandler) {
      window.removeEventListener('keydown', this.perkKeyHandler);
      this.perkKeyHandler = null;
    }
  }

  public showHomeHub(): void {
    this.clearPerkKeyHandler();
    cancelAnimationFrame(this.needleAnimId);
    PlatformSDK.gameplayStop();
    this.armoryOpen = false;
    this.pauseOpen = false;
    this.engine.modalPaused = false;
    this.engine.paused = false;
    this.hudRoot?.remove();
    this.hudRoot = null;
    this.engine.state = null;

    if (!CoopManager.lobby) {
      PlatformSDK.hideInviteButton();
    } else {
      PlatformSDK.showInviteButton(
        CoopManager.lobby.roomCode,
        !CoopManager.lobby.inGame && CoopManager.lobby.members.length < 4
      );
    }

    const save = SaveManager.get();
    const hasAffordableUpgrade =
      UPGRADE_TRACKS.some(
        (t) => (save.upgrades[t.key] || 0) < t.maxLevel && save.gold >= SaveManager.getUpgradeCost(t.key)
      ) ||
      AGENT_CLASSES.some((c) => !save.unlockedClasses.includes(c.id) && save.gold >= c.unlockCost);
    const hasDailyReward = SaveManager.hasUnclaimedDailyRewards();
    const muted = SoundFX.isUserMuted();
    const fsSupported = this.isFullscreenSupported();
    const fsActive = this.isFullscreenActive();

    const bodyHtml =
      this.hubTab === 'stages'
        ? this.buildStagesHubView(save)
        : this.hubTab === 'coop'
          ? this.buildCoopHubView()
          : this.hubTab === 'daily'
            ? this.buildDailyHubView(save)
            : this.hubTab === 'rank'
              ? this.buildLeaderboardHubView(save)
              : this.buildUpgradesHubView(save);

    const coopCountBadge =
      CoopManager.lobby && CoopManager.role !== 'offline'
        ? ` (${CoopManager.lobby.members.length}/4)`
        : '';

    const langOptsHtml = LANG_OPTIONS.map(
      (o) => `<option value="${o.code}" ${o.code === I18n.lang ? 'selected' : ''}>🌐 ${o.label}</option>`
    ).join('');

    this.modalRoot.innerHTML = `
      <div class="hub-screen">
        <div class="hub-bg-art">
          <img src="./assets/hub_banner.jpg" alt="" />
        </div>

        <header class="hub-header">
          <div class="brand-block">
            <img class="brand-avatar" src="./assets/player_hero.png" alt="" />
            <div class="brand-titles">
              <h1>${I18n.t('gameTitle')}</h1>
              <span class="brand-sub">${I18n.t('gameSub')}</span>
            </div>
          </div>

          <div class="hub-nav-tabs">
            <button class="seg-btn ${this.hubTab === 'stages' ? 'active' : ''}" data-hub-tab="stages">${I18n.t('tabStages')}</button>
            <button class="seg-btn ${this.hubTab === 'coop' ? 'active' : ''}" data-hub-tab="coop">${I18n.t('tabCoop')}${coopCountBadge}</button>
            <button class="seg-btn ${this.hubTab === 'upgrades' ? 'active' : ''}" data-hub-tab="upgrades">
              ${I18n.t('tabUpgrades')}${hasAffordableUpgrade ? '<span class="nav-dot"></span>' : ''}
            </button>
            <button class="seg-btn ${this.hubTab === 'daily' ? 'active' : ''}" data-hub-tab="daily">
              ${I18n.t('tabDaily')}${hasDailyReward ? '<span class="nav-dot hot-dot"></span>' : ''}
            </button>
            <button class="seg-btn ${this.hubTab === 'rank' ? 'active' : ''}" data-hub-tab="rank">${I18n.t('tabRank')}</button>
          </div>

          <div class="agent-bar">
            <span class="gold-pill"><img class="inline-coin" src="./assets/ui_coin.png" alt="" /> ${save.gold}</span>
            <select class="hub-lang-select" id="hub-lang-sel" aria-label="Language">${langOptsHtml}</select>
            <button class="hub-util-btn" id="btn-hub-mute" title="Sound">${muted ? '🔇' : '🔊'}</button>
            ${fsSupported ? `<button class="hub-util-btn ${fsActive ? 'active' : ''}" id="btn-hub-fs" title="Fullscreen">⛶</button>` : ''}
          </div>
        </header>

        <main class="hub-main">
          ${bodyHtml}
        </main>

        <footer class="hub-footer-tip">
          ${I18n.t('footerTip')}
        </footer>
      </div>
    `;

    const langSel = this.modalRoot.querySelector('#hub-lang-sel') as HTMLSelectElement | null;
    if (langSel) {
      langSel.onchange = () => {
        I18n.setLang(langSel.value as LangCode, (k, v) => PlatformSDK.setStorageItem(k, v));
        this.showHomeHub();
      };
    }

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
        this.hubTab = btn.dataset.hubTab as 'stages' | 'upgrades' | 'coop' | 'daily' | 'rank';
        this.coopToast = '';
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
      btn.onclick = async () => {
        if (btn.disabled) return;
        const idx = STAGES.findIndex((item) => item.id === btn.dataset.stageGo);
        if (idx < 0) return;
        const unlocked = idx === 0 || save.clearedStages.includes(STAGES[idx - 1].id);
        if (!unlocked) return;
        if (CoopManager.role !== 'offline') {
          CoopManager.disconnect();
        }
        btn.disabled = true;
        const st = STAGES[idx];
        await PlatformSDK.showCommercialBreak();
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

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-class-pick]').forEach((btn) => {
      btn.onclick = () => {
        const cid = btn.dataset.classPick as AgentClassId;
        if (SaveManager.unlockOrSelectClass(cid)) {
          SoundFX.fanfare();
          this.showHomeHub();
        } else {
          SoundFX.emptyClip();
        }
      };
    });

    const signBtn = this.modalRoot.querySelector('#btn-daily-signin') as HTMLButtonElement | null;
    if (signBtn) {
      signBtn.onclick = () => {
        const res = SaveManager.claimTodayCheckIn();
        if (res.ok) {
          SoundFX.fanfare();
          this.showHomeHub();
        }
      };
    }

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-claim-dm]').forEach((btn) => {
      btn.onclick = () => {
        const mid = btn.dataset.claimDm || '';
        const res = SaveManager.claimDailyMission(mid);
        if (res.ok) {
          SoundFX.fanfare();
          this.showHomeHub();
        }
      };
    });

    const grandBtn = this.modalRoot.querySelector('#btn-claim-grand') as HTMLButtonElement | null;
    if (grandBtn) {
      grandBtn.onclick = () => {
        const res = SaveManager.claimDailyGrandChest();
        if (res.ok) {
          SoundFX.fanfare();
          this.showHomeHub();
        }
      };
    }

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-rank-sort]').forEach((btn) => {
      btn.onclick = () => {
        this.rankSort = btn.dataset.rankSort as 'endless' | 'kills';
        this.showHomeHub();
      };
    });

    this.bindCoopHubEvents();
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
        diffLabel: '★☆☆☆☆ 推荐首战',
        sprites: ['prop_police_car', 'player_hero', 'mech_dog'],
        tags: ['6大防区', '机械警犬', '重装金库'],
      },
      {
        theme: 'theme-mall',
        sector: 'SECTOR 02 · 霓虹中庭',
        diffLabel: '★★☆☆☆ 商业沦陷',
        sprites: ['prop_arcade', 'prop_vending', 'zombie_runner'],
        tags: ['5大防区', '幸运贩卖机', '街机掩体阵'],
      },
      {
        theme: 'theme-lab',
        sector: 'SECTOR 03 · 绝密深渊',
        diffLabel: '★★★☆☆ 科研禁区',
        sprites: ['prop_cryo_pod', 'prop_laser_tower', 'zombie_spitter'],
        tags: ['双廊天井', '旋转激光塔', '冷冻培养舱'],
      },
      {
        theme: 'theme-hospital',
        sector: 'SECTOR 04 · 疫区急诊',
        diffLabel: '★★★☆☆ 高危疫区',
        sprites: ['prop_ambulance', 'prop_hospital_bed', 'zombie_spitter'],
        tags: ['6大防区', '隔离ICU病床', '消杀激光塔'],
      },
      {
        theme: 'theme-harbor',
        sector: 'SECTOR 05 · 铁锈货运港',
        diffLabel: '★★★★☆ 巷战迷宫',
        sprites: ['prop_container', 'prop_forklift', 'zombie_miniboss'],
        tags: ['集装箱巷战', '重型叉车阵', '连环油桶区'],
      },
      {
        theme: 'theme-subway',
        sector: 'SECTOR 06 · 地下轨道网',
        diffLabel: '★★★★☆ 幽暗枢纽',
        sprites: ['prop_subway_car', 'prop_radar_console', 'zombie_miniboss'],
        tags: ['超宽双轨月台', '脱轨地铁车厢', '高压电弧塔'],
      },
      {
        theme: 'theme-airbase',
        sector: 'SECTOR 07 · 战略空军港',
        diffLabel: '★★★★★ 铁血防区',
        sprites: ['prop_military_truck', 'prop_radar_console', 'zombie_boss'],
        tags: ['巨型运输机库', '双联激光阵', '导弹挂载库'],
      },
      {
        theme: 'theme-bunker',
        sector: 'SECTOR 08 · 零号核地堡',
        diffLabel: '★★★★★ 终局死斗',
        sprites: ['prop_missile_pod', 'prop_helicopter', 'zombie_boss'],
        tags: ['双洲际导弹井', '核指控中心', '终极尸王压境'],
      },
    ];

    const cards = STAGES.map((st, idx) => {
      const baseMeta = stageVisualMeta[idx] || stageVisualMeta[0];
      const locMeta = I18n.stageMeta(st.id, {
        name: st.name,
        subtitle: st.subtitle,
        sector: baseMeta.sector,
        diffLabel: baseMeta.diffLabel,
        tags: baseMeta.tags,
      });

      const unlocked = idx === 0 || save.clearedStages.includes(STAGES[idx - 1].id);
      const cleared = save.clearedStages.includes(st.id);
      const bestWave = save.endlessBestWave[st.id] || 0;
      const statusText = !unlocked
        ? I18n.t('stageLockedBadge')
        : this.selectedMode === 'standard'
          ? cleared
            ? I18n.t('stageCleared')
            : locMeta.diffLabel
          : bestWave > 0
            ? I18n.t('stageEndlessBest', { w: bestWave })
            : I18n.t('stageEndlessTry');

      const spritesHtml = baseMeta.sprites
        .map((sp, sIdx) => `<img class="stage-vis-sp sp-${sIdx}" src="./assets/${sp}.png" alt="" />`)
        .join('');

      const tagsHtml = locMeta.tags.map((tag) => `<span class="stage-tag">${tag}</span>`).join('');
      const btnClass = !unlocked
        ? 'btn-disabled'
        : this.selectedMode === 'standard'
          ? 'btn-green'
          : 'btn-purple';
      const btnLabel = !unlocked
        ? I18n.t('stageLockedBtn', { n: idx })
        : this.selectedMode === 'standard'
          ? I18n.t('deployStandard')
          : I18n.t('deployEndless');

      return `
        <article class="stage-card ${cleared ? 'is-cleared' : ''} ${!unlocked ? 'is-locked' : ''}">
          <div class="stage-visual-strip ${baseMeta.theme}">
            <div class="stage-vis-top">
              <span class="stage-sector">${locMeta.sector}</span>
              <span class="stage-badge ${cleared && this.selectedMode === 'standard' ? 'cleared' : ''}">${statusText}</span>
            </div>
            <div class="stage-vis-sprites">
              ${spritesHtml}
            </div>
          </div>

          <div class="stage-card-body">
            <h3>${locMeta.name}</h3>
            <p>${locMeta.subtitle}</p>
            <div class="stage-tags">${tagsHtml}</div>
            <button class="btn-cartoon ${btnClass} stage-go-btn" data-stage-go="${st.id}" ${!unlocked ? 'disabled' : ''}>
              ${btnLabel}
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
            <img src="./assets/gun_${w.id}.png" alt="${I18n.wName(w.id, w.name)}" />
            <div class="arsenal-chip-meta">
              <span class="arsenal-chip-name">${I18n.wName(w.id, w.name)}</span>
              <span class="arsenal-chip-evo">⚡${I18n.wSuperName(w.id, w.superName)}</span>
            </div>
          </div>
        `;
      })
      .join('');

    const modeDesc =
      this.selectedMode === 'standard' ? I18n.t('modeDescStandard') : I18n.t('modeDescEndless');
    const endlessRecordStr =
      bestEndless > 0
        ? I18n.isZh()
          ? `${bestEndless}`
          : `W${bestEndless}`
        : I18n.t('noRecord');

    return `
      <section class="hub-hero-banner">
        <div class="hero-dossier">
          <div class="hero-rank-row">
            <span class="hero-rank-pill">🎖️ Lv.${save.agentLevel} ${rankTitle}</span>
            <span class="hero-dmg-bonus">${I18n.t('allGunDmgBonus', { pct: (save.agentLevel - 1) * 3 })}</span>
          </div>

          <div class="hero-xp-wrap">
            <div class="hero-xp-bar">
              <div class="hero-xp-fill" style="width:${xpPct}%"></div>
            </div>
            <span class="hero-xp-text">${I18n.t('xpProgress', { cur: save.agentXp, next: xpNext })}</span>
          </div>

          <div class="hero-stats-row">
            <span class="hero-stat-chip">${I18n.t('clearedStat', { done: save.clearedStages.length, total: STAGES.length })}</span>
            <span class="hero-stat-chip">${I18n.t('bestEndlessStat', { wave: endlessRecordStr })}</span>
            <span class="hero-stat-chip">${I18n.t('arsenalStat')}</span>
          </div>

          <div class="hero-mode-box">
            <div class="seg-group">
              <button class="seg-btn ${this.selectedMode === 'standard' ? 'active' : ''}" data-mode-pick="standard">${I18n.t('modeStandard')}</button>
              <button class="seg-btn ${this.selectedMode === 'endless' ? 'active' : ''}" data-mode-pick="endless">${I18n.t('modeEndless')}</button>
            </div>
            <span class="hero-mode-desc">${modeDesc}</span>
          </div>
        </div>

        <div class="hero-art-panel">
          <img class="hero-key-art" src="./assets/hub_banner.jpg" alt="Zombie Room Defense" />
          <div class="hero-art-caption">${I18n.t('heroCaption')}</div>
        </div>
      </section>

      <section class="stage-grid">${cards}</section>

      <section class="hub-arsenal-strip">
        <div class="arsenal-strip-head">
          <span class="arsenal-strip-title">${I18n.t('arsenalPreviewTitle')} <small>${I18n.t('arsenalPreviewSub')}</small></span>
          <div class="tactical-loop-pills">
            <span>${I18n.t('pillRepair')}</span>
            <span>${I18n.t('pillChest')}</span>
            <span>${I18n.t('pillBoss')}</span>
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

    const classesHtml = AGENT_CLASSES.map((c) => {
      const unlocked = save.unlockedClasses.includes(c.id);
      const active = save.selectedClass === c.id;
      const canUnlock = !unlocked && save.gold >= c.unlockCost;
      const loc = getLocalizedClassText(c);
      const btnCls = active
        ? 'btn-green'
        : unlocked
          ? 'btn-blue'
          : canUnlock
            ? 'btn-yellow'
            : 'btn-disabled';
      const btnTxt = active
        ? I18n.t('classEquipped')
        : unlocked
          ? I18n.t('classSelect')
          : `<img class="inline-coin" src="./assets/ui_coin.png" alt="" /> ${c.unlockCost} ${I18n.t('classUnlock')}`;

      return `
        <div class="class-spec-card ${active ? 'active' : ''} ${!unlocked ? 'locked' : ''}" style="--cls-accent:${c.color}">
          <div class="class-spec-top">
            <div class="class-icon-box"><img src="${c.sprite}" alt="" /></div>
            <div class="class-spec-meta">
              <strong>${loc.name}</strong>
              <span class="class-passive-line">${loc.passive}</span>
            </div>
          </div>
          <div class="class-skill-box">
            <img src="${c.skillSprite}" alt="" />
            <div>
              <div class="class-skill-name">${I18n.t('classSkillTag')} <strong>${loc.skillName}</strong></div>
              <div class="class-skill-desc">${loc.skillDesc}</div>
            </div>
          </div>
          <button class="btn-cartoon btn-mini ${btnCls}" data-class-pick="${c.id}" ${!unlocked && !canUnlock ? 'disabled' : ''}>
            ${btnTxt}
          </button>
        </div>
      `;
    }).join('');

    const upgSpriteMap: Record<keyof typeof save.upgrades, string> = {
      hp: './assets/item_medkit.png',
      reload: './assets/prop_ammo_box.png',
      speed: './assets/player_boot.png',
      repair: './assets/prop_wood_plank.png',
      startCash: './assets/drop_cash.png',
      crit: './assets/gun_sniper.png',
      armor: './assets/item_armor.png',
      magnet: './assets/relic_war_bonds.png',
      ammo: './assets/gear_backpack.png',
      ordnance: './assets/prop_grenade.png',
    };

    const upgradesHtml = UPGRADE_TRACKS.map((t) => {
      const lvl = save.upgrades[t.key] || 0;
      const isMax = lvl >= t.maxLevel;
      const cost = SaveManager.getUpgradeCost(t.key);
      const canBuy = !isMax && save.gold >= cost;
      const pct = Math.round((lvl / t.maxLevel) * 100);
      const locUpg = I18n.upgradeMeta(t.key, lvl, {
        name: t.name,
        desc: t.desc,
        val: t.valueText(lvl),
      });
      return `
        <div class="upgrade-card ${isMax ? 'maxed' : ''}">
          <div class="upg-top">
            <div class="upg-icon-box"><img class="upg-sprite-icon" src="${upgSpriteMap[t.key]}" alt="" /></div>
            <div class="upg-info">
              <div class="upg-title">${locUpg.name} <small>Lv.${lvl}/${t.maxLevel}</small></div>
              <div class="upg-val">${locUpg.val}</div>
            </div>
          </div>
          <p class="upg-desc">${locUpg.desc}</p>
          <div class="upg-prog-track">
            <div class="upg-prog-fill" style="width:${pct}%"></div>
          </div>
          <button class="btn-cartoon btn-mini ${isMax ? 'btn-gray' : canBuy ? 'btn-yellow' : 'btn-disabled'}"
            data-upg="${t.key}" ${!canBuy ? 'disabled' : ''}>
            ${isMax ? I18n.t('upgMaxed') : `<img class="inline-coin" src="./assets/ui_coin.png" alt="" /> ${cost} ${I18n.t('upgBuy')}`}
          </button>
        </div>
      `;
    }).join('');

    return `
      <div class="upg-dossier-card">
        <img class="upg-hero-avatar" src="${getAgentClassDef(save.selectedClass).sprite}" alt="" />
        <div class="upg-dossier-body">
          <div class="upg-dossier-top">
            <strong>🎖️ Lv.${save.agentLevel} ${rankTitle}</strong>
            <span>${I18n.t('upgPermanentBonus', { pct: (save.agentLevel - 1) * 3 })}</span>
          </div>
          <div class="hero-xp-wrap">
            <div class="hero-xp-bar">
              <div class="hero-xp-fill" style="width:${xpPct}%"></div>
            </div>
            <span class="hero-xp-text">${I18n.t('xpProgress', { cur: save.agentXp, next: xpNext })}</span>
          </div>
        </div>
      </div>

      <div class="hub-sec-heading">${I18n.t('classSecTitle')}</div>
      <div class="class-spec-grid">${classesHtml}</div>

      <div class="hub-sec-heading">${I18n.t('upgSecTitle')}</div>
      <div class="upgrade-list">${upgradesHtml}</div>
    `;
  }

  private buildDailyHubView(save: ReturnType<typeof SaveManager.get>): string {
    const canSign = SaveManager.canClaimTodayCheckIn();
    const curSignDay = SaveManager.getCurrentSignDisplayDay();
    const streak = save.daily.signStreak || 0;

    const signDaysHtml = DAILY_CHECKIN_REWARDS.map((r) => {
      const isDone = !canSign ? r.day <= curSignDay : r.day < curSignDay;
      const isToday = canSign && r.day === curSignDay;
      return `
        <div class="signin-day-card ${isDone ? 'done' : ''} ${isToday ? 'today' : ''}">
          <span class="signin-day-num">${I18n.t('dailyDayLabel', { d: r.day })}</span>
          <img class="signin-day-ico" src="${r.sprite}" alt="" />
          <strong class="signin-day-gold">+${r.gold}</strong>
          <small class="signin-day-xp">+${r.xp} XP</small>
          ${isDone ? `<span class="signin-check">✓</span>` : ''}
        </div>
      `;
    }).join('');

    const missions = getDailyMissionsForDate(save.daily.dateKey);
    const missionsHtml = missions
      .map((m) => {
        const cur = Math.min(m.target, save.daily.missionProgress[m.kind] || 0);
        const pct = Math.min(100, Math.round((cur / m.target) * 100));
        const done = cur >= m.target;
        const claimed = save.daily.claimedIds.includes(m.id);
        const title = I18n.isZh() ? m.zhTitle : m.enTitle;
        return `
          <div class="daily-mission-card ${claimed ? 'claimed' : done ? 'ready' : ''}">
            <img class="dm-sprite" src="${m.sprite}" alt="" />
            <div class="dm-body">
              <div class="dm-title">${title}</div>
              <div class="dm-prog-row">
                <div class="dm-prog-bar"><div class="dm-prog-fill" style="width:${pct}%"></div></div>
                <span class="dm-prog-txt">${cur}/${m.target}</span>
              </div>
            </div>
            <div class="dm-right">
              <div class="dm-rew-pills">
                <span><img class="inline-coin" src="./assets/ui_coin.png" alt="" /> +${m.rewardGold}</span>
                <small>+${m.rewardXp} XP</small>
              </div>
              <button class="btn-cartoon btn-mini ${claimed ? 'btn-gray' : done ? 'btn-yellow' : 'btn-disabled'}"
                data-claim-dm="${m.id}" ${!done || claimed ? 'disabled' : ''}>
                ${claimed ? I18n.t('dailyClaimed') : done ? I18n.t('dailyClaimBtn') : I18n.t('dailyGoBtn')}
              </button>
            </div>
          </div>
        `;
      })
      .join('');

    const grandReady = SaveManager.canClaimDailyGrandChest();
    const grandClaimed = save.daily.grandChestClaimed;

    return `
      <div class="daily-hub-wrap">
        <section class="daily-panel">
          <div class="daily-panel-head">
            <h3>${I18n.t('dailySignTitle')}</h3>
            <div class="daily-head-actions">
              <span class="streak-pill">${I18n.t('dailyStreakBadge', { n: streak })}</span>
              <button class="btn-cartoon btn-mini ${canSign ? 'btn-green' : 'btn-gray'}" id="btn-daily-signin" ${!canSign ? 'disabled' : ''}>
                ${canSign ? I18n.t('dailyClaimNow') : I18n.t('dailyTomorrow')}
              </button>
            </div>
          </div>
          <div class="signin-grid">${signDaysHtml}</div>
        </section>

        <section class="daily-panel">
          <div class="daily-panel-head">
            <h3>${I18n.t('dailyMissionsTitle')}</h3>
          </div>
          <div class="daily-mission-list">${missionsHtml}</div>

          <div class="daily-grand-bar ${grandReady ? 'ready' : ''} ${grandClaimed ? 'claimed' : ''}">
            <div class="daily-grand-left">
              <img src="./assets/prop_chest.png" alt="" />
              <div>
                <strong>${I18n.t('dailyGrandTitle')}</strong>
                <p>${I18n.t('dailyGrandDesc')}</p>
              </div>
            </div>
            <div class="daily-grand-right">
              <span class="grand-rew-tag"><img class="inline-coin" src="./assets/ui_coin.png" alt="" /> +${DAILY_GRAND_BONUS.gold} · +${DAILY_GRAND_BONUS.xp} XP</span>
              <button class="btn-cartoon btn-mini ${grandClaimed ? 'btn-gray' : grandReady ? 'btn-yellow' : 'btn-disabled'}"
                id="btn-claim-grand" ${!grandReady || grandClaimed ? 'disabled' : ''}>
                ${grandClaimed ? I18n.t('dailyClaimed') : I18n.t('dailyClaimBtn')}
              </button>
            </div>
          </div>
        </section>
      </div>
    `;
  }

  private buildLeaderboardHubView(save: ReturnType<typeof SaveManager.get>): string {
    const myCallsign = CoopManager.getCallsign();
    const myRankTitle = this.getAgentRankTitle(save.agentLevel);
    const rows = buildLeaderboardRows(this.rankSort, save, myCallsign, myRankTitle);
    const myIdx = rows.findIndex((r) => r.isMe);
    const meRow = rows[myIdx] || rows[rows.length - 1];
    const prevRow = myIdx > 0 ? rows[myIdx - 1] : null;

    let chaseHtml = I18n.t('rankTopOneHint');
    if (prevRow) {
      if (this.rankSort === 'endless') {
        const diffW = Math.max(1, prevRow.bestWave - meRow.bestWave + (prevRow.bestWave === meRow.bestWave ? 0 : 0));
        const gapStr =
          prevRow.bestWave > meRow.bestWave
            ? I18n.isZh()
              ? `${diffW} 波`
              : `${diffW} Wave(s)`
            : `${Math.max(1, prevRow.totalKills - meRow.totalKills + 1)} Kills`;
        chaseHtml = I18n.t('rankChaseHint', {
          prevRank: prevRow.rank,
          name: prevRow.callsign,
          gap: gapStr,
        });
      } else {
        const diffK = Math.max(1, prevRow.totalKills - meRow.totalKills + 1);
        const gapStr = I18n.isZh() ? `${diffK} 击杀` : `${diffK} Kills`;
        chaseHtml = I18n.t('rankChaseHint', {
          prevRank: prevRow.rank,
          name: prevRow.callsign,
          gap: gapStr,
        });
      }
    }

    const rowsHtml = rows
      .map((r) => {
        const cls = getAgentClassDef(r.classId);
        const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : `#${r.rank}`;
        const waveTxt = r.bestWave > 0 ? (I18n.isZh() ? `第 ${r.bestWave} 波` : `W${r.bestWave}`) : '—';
        return `
          <div class="lb-row ${r.isMe ? 'is-me' : ''} ${r.isCoopFriend ? 'is-friend' : ''} ${r.rank <= 3 ? `top-${r.rank}` : ''}">
            <span class="lb-col-rank">${medal}</span>
            <div class="lb-col-agent">
              <img class="lb-avatar" src="${cls.sprite}" alt="" />
              <div class="lb-agent-info">
                <strong>${r.callsign}${r.isMe ? I18n.t('meSuffix') : ''}</strong>
                <span class="lb-badge">${r.badgeText}</span>
              </div>
            </div>
            <span class="lb-col-wave">${waveTxt}</span>
            <span class="lb-col-kills">${r.totalKills.toLocaleString()}</span>
            <span class="lb-col-clear">${r.clearedCount}/${STAGES.length}</span>
          </div>
        `;
      })
      .join('');

    return `
      <div class="lb-hub-wrap">
        <div class="lb-top-bar">
          <div class="seg-group dark">
            <button class="seg-btn ${this.rankSort === 'endless' ? 'active' : ''}" data-rank-sort="endless">${I18n.t('rankTitleEndless')}</button>
            <button class="seg-btn ${this.rankSort === 'kills' ? 'active' : ''}" data-rank-sort="kills">${I18n.t('rankTitleKills')}</button>
          </div>
          <div class="lb-my-summary">
            <div>${I18n.t('rankMySummary', { rank: meRow.rank, w: meRow.bestWave, k: meRow.totalKills })}</div>
            <div class="lb-chase-line">${chaseHtml}</div>
          </div>
        </div>

        <div class="lb-table-card">
          <div class="lb-head-row">
            <span>${I18n.t('rankColRank')}</span>
            <span>${I18n.t('rankColAgent')}</span>
            <span>${I18n.t('rankColWave')}</span>
            <span>${I18n.t('rankColKills')}</span>
            <span>${I18n.t('rankColCleared')}</span>
          </div>
          <div class="lb-body-list">${rowsHtml}</div>
        </div>
      </div>
    `;
  }

  private buildCoopHubView(): string {
    const callsign = CoopManager.getCallsign();
    const lobby = CoopManager.lobby;
    const status = CoopManager.status;
    const err = CoopManager.errorMsg;

    const rulesStrip = `
      <div class="coop-rules-strip">
        <span>${I18n.t('coopRule1')}</span>
        <span>${I18n.t('coopRule2')}</span>
        <span>${I18n.t('coopRule3')}</span>
      </div>
    `;

    const callsignBar = `
      <div class="coop-callsign-bar">
        <div class="coop-callsign-left">
          <span>${I18n.t('callsignLabel')}</span>
          <input id="coop-callsign-inp" class="coop-inp callsign-inp" type="text" maxlength="10" value="${callsign}" placeholder="${I18n.t('callsignPlaceholder')}" />
          <button class="btn-cartoon btn-mini btn-blue" id="btn-save-callsign" type="button">${I18n.t('saveCallsign')}</button>
        </div>
        <span class="coop-p2p-tag">${I18n.t('p2pBadge')}</span>
      </div>
    `;

    const statusBanner =
      status === 'connecting'
        ? `<div class="coop-alert info">${I18n.t('connectingMsg')}</div>`
        : err
          ? `<div class="coop-alert error">⚠️ ${err}</div>`
          : this.coopToast
            ? `<div class="coop-alert ok">✅ ${this.coopToast}</div>`
            : '';

    if (!lobby || CoopManager.role === 'offline') {
      return `
        <div class="coop-wrap">
          ${callsignBar}
          ${rulesStrip}
          ${statusBanner}
          <div class="coop-entry-grid">
            <div class="coop-panel-card">
              <h3>${I18n.t('createCardTitle')}</h3>
              <p>${I18n.t('createCardDesc')}</p>
              <button class="btn-cartoon btn-green" id="btn-coop-create" ${status === 'connecting' ? 'disabled' : ''}>
                ${I18n.t('createRoomBtn')}
              </button>
            </div>

            <div class="coop-panel-card">
              <h3>${I18n.t('joinCardTitle')}</h3>
              <p>${I18n.t('joinCardDesc')}</p>
              <div class="coop-join-row">
                <input id="coop-code-inp" class="coop-inp code-inp" type="text" maxlength="6" value="${CoopManager.lastJoinCode}" placeholder="${I18n.t('codePlaceholder')}" />
                <button class="btn-cartoon btn-yellow" id="btn-coop-join" ${status === 'connecting' ? 'disabled' : ''}>
                  ${I18n.t('joinRoomBtn')}
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    const memberCount = lobby.members.length;
    const previewScale = getCoopScaling(Math.max(2, memberCount));
    const activeScale = getCoopScaling(memberCount);
    const isHost = CoopManager.role === 'host';
    const selectedStage = STAGES.find((s) => s.id === lobby.stageId) || STAGES[0];
    const selectedStageTitle = I18n.stageMeta(selectedStage.id, {
      name: selectedStage.name,
      subtitle: selectedStage.subtitle,
      sector: '',
      diffLabel: '',
      tags: [],
    }).name;
    const me = lobby.members.find((m) => m.peerId === CoopManager.myPeerId);

    const slotsHtml = SQUAD_SLOTS.map((sl) => {
      const mem = lobby.members.find((m) => m.slot === sl.slot);
      const slotTitle = I18n.slotLabel(sl.slot);
      if (!mem) {
        return `
          <div class="coop-slot-card empty">
            <span class="slot-badge" style="background:#334155">${slotTitle}</span>
            <div class="slot-empty-txt">${I18n.t('waitingFriend')}</div>
            <small>${I18n.t('shareCodeHint', { code: lobby.roomCode })}</small>
          </div>
        `;
      }
      return `
        <div class="coop-slot-card filled" style="border-color:${sl.color}">
          <div class="slot-head">
            <span class="slot-badge" style="background:${sl.badgeBg}">${slotTitle}</span>
            <span class="slot-ready ${mem.ready ? 'ok' : ''}">${mem.isHost ? I18n.t('hostBadge') : mem.ready ? I18n.t('readyYes') : I18n.t('readyNo')}</span>
          </div>
          <div class="slot-player">
            <img src="./assets/player_hero.png" alt="" />
            <strong>${mem.callsign}${mem.peerId === CoopManager.myPeerId ? I18n.t('meSuffix') : ''}</strong>
          </div>
        </div>
      `;
    }).join('');

    const hostSave = SaveManager.get();
    const stageOptionsHtml = STAGES.map((st, idx) => {
      const unlocked = idx === 0 || hostSave.clearedStages.includes(STAGES[idx - 1].id);
      const sTitle = I18n.stageMeta(st.id, {
        name: st.name,
        subtitle: st.subtitle,
        sector: '',
        diffLabel: '',
        tags: [],
      }).name;
      return `<option value="${st.id}" ${st.id === lobby.stageId ? 'selected' : ''} ${!unlocked ? 'disabled' : ''}>${!unlocked ? '🔒 ' : ''}${sTitle}</option>`;
    }).join('');

    const hostControls = isHost
      ? `
        <div class="coop-stage-Controls">
          <div class="coop-sel-group">
            <label>${I18n.t('stageSelectLabel')}</label>
            <select id="coop-stage-sel" class="coop-select">${stageOptionsHtml}</select>
          </div>
          <div class="seg-group dark">
            <button class="seg-btn ${lobby.mode === 'standard' ? 'active' : ''}" data-coop-mode="standard">${I18n.t('modeStandard')}</button>
            <button class="seg-btn ${lobby.mode === 'endless' ? 'active' : ''}" data-coop-mode="endless">${I18n.t('modeEndless')}</button>
          </div>
          <button class="btn-cartoon btn-green coop-launch-btn" id="btn-coop-launch">
            ${memberCount >= 2 ? I18n.t('launchSquadBtn', { n: memberCount }) : I18n.t('launchSoloRoomBtn', { n: memberCount })}
          </button>
        </div>
      `
      : `
        <div class="coop-stage-Controls">
          <div class="coop-client-stage-info">
            ${I18n.t('hostPickedLabel')} <strong>${selectedStageTitle}</strong> · <span>${lobby.mode === 'standard' ? I18n.t('modeStandard') : I18n.t('modeEndless')}</span>
          </div>
          <button class="btn-cartoon ${me?.ready ? 'btn-gray' : 'btn-green'}" id="btn-coop-ready">
            ${me?.ready ? I18n.t('readyWaitingHost') : I18n.t('clickReady')}
          </button>
        </div>
      `;

    const scaleInfo =
      memberCount >= 2
        ? I18n.t('scaleActiveInfo', {
            n: memberCount,
            c: activeScale.countMult,
            hp: activeScale.hpMult,
            dmg: activeScale.dmgMult,
            door: activeScale.doorCostMult,
          })
        : I18n.t('scalePreviewInfo', {
            c: previewScale.countMult,
            hp: previewScale.hpMult,
          });

    return `
      <div class="coop-wrap">
        ${callsignBar}
        ${statusBanner}

        <div class="coop-lobby-box">
          <div class="coop-lobby-head">
            <div class="room-code-block">
              <span class="rc-label">${I18n.t('roomCodeLabel')}</span>
              <strong class="rc-val">${lobby.roomCode}</strong>
              <button class="btn-cartoon btn-mini btn-yellow" id="btn-copy-code" type="button">${I18n.t('copyCodeBtn')}</button>
              <button class="btn-cartoon btn-mini btn-blue" id="btn-copy-link" type="button">${I18n.t('copyLinkBtn')}</button>
            </div>
            <button class="btn-cartoon btn-mini btn-gray" id="btn-coop-leave" type="button">${I18n.t('leaveRoomBtn')}</button>
          </div>

          <div class="coop-slots-grid">${slotsHtml}</div>

          <div class="coop-scale-banner">⚖️ ${scaleInfo}</div>

          ${hostControls}
        </div>
      </div>
    `;
  }

  private bindCoopHubEvents(): void {
    const saveCallBtn = this.modalRoot.querySelector('#btn-save-callsign') as HTMLButtonElement | null;
    const callInp = this.modalRoot.querySelector('#coop-callsign-inp') as HTMLInputElement | null;
    if (saveCallBtn && callInp) {
      saveCallBtn.onclick = () => {
        CoopManager.setCallsign(callInp.value);
        this.coopToast = I18n.t('callsignSaved', { name: CoopManager.getCallsign() });
        this.showHomeHub();
      };
    }

    const createBtn = this.modalRoot.querySelector('#btn-coop-create') as HTMLButtonElement | null;
    if (createBtn) {
      createBtn.onclick = () => {
        if (callInp) CoopManager.setCallsign(callInp.value);
        this.coopToast = '';
        CoopManager.createHostRoom(STAGES[0].id, this.selectedMode);
      };
    }

    const joinBtn = this.modalRoot.querySelector('#btn-coop-join') as HTMLButtonElement | null;
    const codeInp = this.modalRoot.querySelector('#coop-code-inp') as HTMLInputElement | null;
    if (joinBtn && codeInp) {
      const doJoin = () => {
        if (callInp) CoopManager.setCallsign(callInp.value);
        this.coopToast = '';
        CoopManager.joinRoomByCode(codeInp.value);
      };
      joinBtn.onclick = doJoin;
      codeInp.onkeydown = (e) => {
        if (e.key === 'Enter') doJoin();
      };
    }

    const copyCodeBtn = this.modalRoot.querySelector('#btn-copy-code') as HTMLButtonElement | null;
    if (copyCodeBtn && CoopManager.lobby) {
      copyCodeBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(CoopManager.lobby!.roomCode);
          this.coopToast = I18n.t('codeCopied', { code: CoopManager.lobby!.roomCode });
        } catch {
          this.coopToast = CoopManager.lobby!.roomCode;
        }
        this.showHomeHub();
      };
    }

    const copyLinkBtn = this.modalRoot.querySelector('#btn-copy-link') as HTMLButtonElement | null;
    if (copyLinkBtn && CoopManager.lobby) {
      copyLinkBtn.onclick = async () => {
        const url = await CoopManager.getInviteUrl();
        try {
          await navigator.clipboard.writeText(url);
          this.coopToast = I18n.t('linkCopied');
        } catch {
          this.coopToast = url;
        }
        this.showHomeHub();
      };
    }

    const leaveBtn = this.modalRoot.querySelector('#btn-coop-leave') as HTMLButtonElement | null;
    if (leaveBtn) {
      leaveBtn.onclick = () => {
        this.coopToast = '';
        CoopManager.disconnect();
      };
    }

    const stageSel = this.modalRoot.querySelector('#coop-stage-sel') as HTMLSelectElement | null;
    if (stageSel && CoopManager.lobby) {
      stageSel.onchange = () => {
        CoopManager.setHostStageAndMode(stageSel.value, CoopManager.lobby!.mode);
      };
    }

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-coop-mode]').forEach((btn) => {
      btn.onclick = () => {
        if (!CoopManager.lobby) return;
        CoopManager.setHostStageAndMode(
          CoopManager.lobby.stageId,
          btn.dataset.coopMode as GameMode
        );
      };
    });

    const readyBtn = this.modalRoot.querySelector('#btn-coop-ready') as HTMLButtonElement | null;
    if (readyBtn) {
      readyBtn.onclick = () => {
        CoopManager.toggleClientReady();
      };
    }

    const launchBtn = this.modalRoot.querySelector('#btn-coop-launch') as HTMLButtonElement | null;
    if (launchBtn) {
      launchBtn.onclick = () => {
        CoopManager.launchHostMatch();
      };
    }
  }

  public startStageRun(stage: StageDef, mode: GameMode): void {
    this.armoryOpen = false;
    this.pauseOpen = false;
    this.armoryTab = 'guns';
    this.modalRoot.innerHTML = '';
    PlatformSDK.hideInviteButton(CoopManager.lobby?.roomCode);
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
    const hud = document.createElement('div');
    hud.className = 'hud-overlay';
    hud.innerHTML = `
      <div class="screen-vignette" id="hud-vignette"></div>

      <div class="hud-top">
        <div class="hud-left">
          <div class="hp-row">
            <div class="bar-box hp-box">
              <div class="bar-fill hp-fill" id="hud-hp-fill"></div>
              <div class="hud-xp-subbar"><div class="hud-xp-subfill" id="hud-xp-fill"></div></div>
              <span class="hud-hp-label"><img class="hud-mini-ico" src="./assets/item_medkit.png" alt="" /><em id="hud-hp-text">100</em></span>
            </div>
            <span class="lv-chip" id="hud-lv-chip">Lv.1</span>
            <span class="armor-chip" id="hud-armor-chip" style="display:none"><img class="hud-mini-ico" src="./assets/item_armor.png" alt="" /><em id="hud-armor-val">0</em></span>
            <span class="sector-chip" id="hud-sector-chip" style="display:none"></span>
          </div>
          <div class="relic-row" id="hud-relics"></div>
          <div class="hud-squad-list" id="hud-squad-list"></div>
        </div>

        <div class="hud-center">
          <div class="wave-pill" id="hud-wave">Wave 1/10</div>
          <div class="boss-bar-wrap" id="hud-boss-box" style="display:none">
            <div class="boss-bar-fill" id="hud-boss-fill"></div>
            <span id="hud-boss-text">Boss</span>
          </div>
          <div class="fever-wrap" id="hud-fever-box" style="display:none">
            <div class="fever-fill fever-active" id="hud-fever-fill"></div>
            <span id="hud-fever-text">FEVER</span>
          </div>
          <div class="powerup-row" id="hud-powerups"></div>
        </div>

        <div class="hud-right-stack">
          <div class="hud-right">
            <button class="cash-pill" id="hud-cash" type="button">$80</button>
            <button class="hud-icon-btn" id="btn-pause" type="button">⏸</button>
          </div>
          <button class="moba-shop-btn" id="btn-open-armory" type="button">
            <img class="moba-shop-sprite" src="./assets/prop_armory_kiosk.png" alt="" />
            <span id="hud-shop-label">${I18n.t('shopBtn')}</span>
          </button>
          <button class="quick-ammo-btn" id="btn-quick-ammo" type="button" style="display:none">
            <img class="quick-ammo-gun" id="quick-ammo-icon" src="./assets/gun_smg.png" alt="" />
            <span class="quick-ammo-text" id="quick-ammo-label"></span>
            <kbd class="quick-ammo-key" id="quick-ammo-key">V</kbd>
          </button>
        </div>
      </div>

      <div class="hud-banner" id="hud-banner"></div>
      <div class="hud-loot-toast" id="hud-loot-toast">
        <img class="loot-toast-img" id="loot-toast-img" src="./assets/gun_rifle.png" alt="" />
        <div class="loot-toast-body">
          <div class="loot-toast-head">
            <span class="loot-toast-badge" id="loot-toast-badge">Lv.2</span>
            <strong id="loot-toast-title">Perk</strong>
          </div>
          <div class="loot-toast-desc" id="loot-toast-desc"></div>
        </div>
      </div>

      <div class="moba-wheel-zone">
        <button class="moba-arc-btn arc-pos-1 empty-slot" id="btn-arc-switch" type="button">
          <img class="moba-arc-img" id="arc-switch-icon" src="./assets/gun_smg.png" alt="" />
          <span class="moba-arc-badge" id="arc-switch-badge">${I18n.t('subWepBadge')}</span>
        </button>

        <button class="moba-arc-btn arc-pos-4 moba-skill-btn" id="btn-arc-skill" type="button">
          <img class="moba-arc-img" id="arc-skill-icon" src="./assets/prop_ammo_box.png" alt="" />
          <span class="moba-arc-badge" id="arc-skill-badge">F</span>
        </button>

        <button class="moba-arc-btn arc-pos-2 moba-gren-btn" id="btn-grenade" type="button">
          <img class="moba-arc-img" src="./assets/prop_grenade.png" alt="" />
          <span class="moba-arc-badge" id="hud-gren-count">2</span>
        </button>

        <button class="moba-arc-btn arc-pos-3 moba-reload-btn" id="btn-arc-reload" type="button">
          <img class="moba-reload-ico" src="./assets/prop_ammo_box.png" alt="" />
          <span class="moba-arc-badge" id="arc-reload-glyph">↻</span>
        </button>

        <button class="moba-main-atk" id="btn-main-attack" type="button">
          <span class="moba-atk-ring"></span>
          <span class="moba-atk-knob" id="main-atk-knob"></span>
          <img class="moba-atk-gun" id="main-atk-icon" src="./assets/gun_pistol.png" alt="" />
          <span class="moba-atk-ammo" id="main-atk-ammo">14/∞</span>
        </button>
      </div>
    `;
    this.uiLayer.appendChild(hud);
    this.hudRoot = hud;

    this.bindModalTap(hud.querySelector('#btn-pause') as HTMLButtonElement, () => {
      this.togglePauseMenu();
    });

    this.bindModalTap(hud.querySelector('#btn-open-armory') as HTMLButtonElement, () => {
      this.toggleArmoryShop();
    });

    this.bindCombatTap(hud.querySelector('#btn-quick-ammo') as HTMLButtonElement, () => {
      this.engine.quickBuyPrimaryAmmo();
    });

    this.bindModalTap(hud.querySelector('#hud-cash') as HTMLButtonElement, () => {
      this.toggleArmoryShop();
    });

    const switchBtn = hud.querySelector('#btn-arc-switch') as HTMLButtonElement;
    let lastSwitchTouch = 0;
    switchBtn.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && (this.engine.state?.player.weapons.length ?? 0) >= 2) {
        e.preventDefault();
        e.stopPropagation();
        lastSwitchTouch = performance.now();
        this.engine.switchWeapon();
      }
    });
    switchBtn.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch' && (this.engine.state?.player.weapons.length ?? 0) < 2) {
        e.preventDefault();
        e.stopPropagation();
        lastSwitchTouch = performance.now();
        this.toggleArmoryShop();
      }
    });
    switchBtn.onclick = () => {
      if (performance.now() - lastSwitchTouch < 420) return;
      const s = this.engine.state;
      if (!s) return;
      if (s.player.weapons.length >= 2) {
        this.engine.switchWeapon();
      } else {
        this.toggleArmoryShop();
      }
    };

    this.bindCombatTap(hud.querySelector('#btn-arc-skill') as HTMLButtonElement, () => {
      this.engine.useActiveClassSkill();
    });

    this.bindCombatTap(hud.querySelector('#btn-grenade') as HTMLButtonElement, () => {
      this.engine.throwGrenade();
    });

    this.bindCombatTap(hud.querySelector('#btn-arc-reload') as HTMLButtonElement, () => {
      this.engine.startReload();
    });

    this.bindMainAttackWheel(
      hud.querySelector('#btn-main-attack') as HTMLButtonElement,
      hud.querySelector('#main-atk-knob') as HTMLElement
    );
  }

  private bindMainAttackWheel(atkBtn: HTMLButtonElement, knobEl: HTMLElement): void {
    const input = this.engine.input;
    const maxKnob = 24;
    const deadzone = 9;

    const resetVisual = () => {
      atkBtn.classList.remove('pressing', 'aiming');
      knobEl.style.transform = 'translate(0px, 0px)';
    };

    const updateFromPoint = (clientX: number, clientY: number) => {
      const vx = clientX - input.attackBtnStick.startX;
      const vy = clientY - input.attackBtnStick.startY;
      const dist = Math.hypot(vx, vy);
      const clamped = Math.min(dist, maxKnob);
      const nx = dist > 0.5 ? vx / dist : 0;
      const ny = dist > 0.5 ? vy / dist : 0;
      knobEl.style.transform = `translate(${(nx * clamped).toFixed(1)}px, ${(ny * clamped).toFixed(1)}px)`;
      if (dist > deadzone) {
        input.attackBtnStick.dx = nx;
        input.attackBtnStick.dy = ny;
        atkBtn.classList.add('aiming');
      } else {
        input.attackBtnStick.dx = 0;
        input.attackBtnStick.dy = 0;
        atkBtn.classList.remove('aiming');
      }
    };

    atkBtn.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (input.attackBtnStick.active || e.changedTouches.length === 0) return;
        const t = e.changedTouches[0];
        const rect = atkBtn.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        input.usingTouch = true;
        input.attackBtnStick = {
          active: true,
          id: t.identifier,
          startX: cx,
          startY: cy,
          curX: t.clientX,
          curY: t.clientY,
          dx: 0,
          dy: 0,
        };
        atkBtn.classList.add('pressing');
        updateFromPoint(t.clientX, t.clientY);
      },
      { passive: false }
    );

    atkBtn.addEventListener(
      'touchmove',
      (e) => {
        if (!input.attackBtnStick.active) return;
        e.preventDefault();
        e.stopPropagation();
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (t.identifier === input.attackBtnStick.id) {
            input.attackBtnStick.curX = t.clientX;
            input.attackBtnStick.curY = t.clientY;
            updateFromPoint(t.clientX, t.clientY);
            break;
          }
        }
      },
      { passive: false }
    );

    const endTouch = (e: TouchEvent) => {
      if (!input.attackBtnStick.active) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === input.attackBtnStick.id) {
          input.attackBtnStick.active = false;
          input.attackBtnStick.dx = 0;
          input.attackBtnStick.dy = 0;
          resetVisual();
          break;
        }
      }
    };
    atkBtn.addEventListener('touchend', endTouch);
    atkBtn.addEventListener('touchcancel', endTouch);

    atkBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = atkBtn.getBoundingClientRect();
      input.attackBtnStick = {
        active: true,
        id: -99,
        startX: rect.left + rect.width / 2,
        startY: rect.top + rect.height / 2,
        curX: e.clientX,
        curY: e.clientY,
        dx: 0,
        dy: 0,
      };
      atkBtn.classList.add('pressing');
      const onUp = () => {
        if (input.attackBtnStick.id === -99) {
          input.attackBtnStick.active = false;
          input.attackBtnStick.dx = 0;
          input.attackBtnStick.dy = 0;
          resetVisual();
        }
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mouseup', onUp);
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
      PlatformSDK.gameplayStart();
      this.engine.flushQueuedModals();
      return;
    }

    if (this.engine.modalPaused && !s.isCoop) return;

    this.pauseOpen = true;
    if (!s.isCoop) {
      this.engine.modalPaused = true;
      PlatformSDK.gameplayStop();
    }
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
          <h2>${I18n.t('pauseTitle')}</h2>
          <p class="popup-sub">${I18n.t('pauseSub', { w: s.wave, k: s.kills, lv: s.battleLevel })}</p>
          <div class="pause-btn-stack">
            <button class="btn-cartoon btn-green" id="btn-resume">${I18n.t('resumeBtn')}</button>
            <button class="btn-cartoon ${autoOn ? 'btn-blue' : 'btn-gray'}" id="btn-toggle-auto">
              ${I18n.t('autoFireBtn', { state: autoOn ? I18n.t('on') : I18n.t('off') })}
            </button>
            <button class="btn-cartoon btn-gray" id="btn-toggle-mute">
              ${muted ? I18n.t('soundMuted') : I18n.t('soundOn')}
            </button>
            <button class="btn-cartoon btn-blue" id="btn-cycle-lang">
              ${I18n.t('langBtn', { lang: I18n.getLangLabel() })}
            </button>
            ${
              fsSupported
                ? `<button class="btn-cartoon ${fsActive ? 'btn-yellow' : 'btn-gray'}" id="btn-toggle-fs">
                    ${I18n.t('fsBtn', { state: fsActive ? I18n.t('on') : I18n.t('off') })}
                  </button>`
                : ''
            }
            <button class="btn-cartoon btn-gray" id="btn-quit-hub">${I18n.t('quitHubBtn')}</button>
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

    (this.modalRoot.querySelector('#btn-cycle-lang') as HTMLButtonElement).onclick = () => {
      I18n.cycleLang((k, v) => PlatformSDK.setStorageItem(k, v));
      this.hudCache = {};
      if (this.hudRoot) {
        const shopLbl = this.hudRoot.querySelector('#hud-shop-label');
        if (shopLbl) shopLbl.textContent = I18n.t('shopBtn');
      }
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
      if (CoopManager.role !== 'offline') {
        CoopManager.disconnect();
      }
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
      PlatformSDK.gameplayStart();
      this.engine.flushQueuedModals();
      return;
    }

    if (this.engine.modalPaused && !s.isCoop) return;

    this.armoryOpen = true;
    if (!s.isCoop) {
      this.engine.modalPaused = true;
      PlatformSDK.gameplayStop();
    }
    this.engine.input.resetStates();
    this.renderArmoryShop('');
  }

  private renderArmoryShop(toastMsg: string): void {
    const s = this.engine.state;
    if (!s) return;

    const unlockedRooms = this.engine.getUnlockedExtraRoomsCount();
    const activeWep = s.player.weapons[s.player.activeSlot];
    const activeDef = WEAPONS[activeWep.defId];
    const activeBaseName = I18n.wName(activeDef.id, activeDef.name);
    const activeSupName = I18n.wSuperName(activeDef.id, activeDef.superName);
    const save = SaveManager.get();

    let contentHtml = '';
    if (this.armoryTab === 'guns') {
      const canEvolve = !activeWep.evolved && s.cash >= 1850;
      const evolveStrip = activeWep.evolved
        ? `<div class="evolve-strip done">${I18n.t('evolvedDone', { name: activeSupName })}</div>`
        : `<div class="evolve-strip">
            <span>${I18n.t('evolvePrompt', { base: activeBaseName, sup: activeSupName })}</span>
            <button class="btn-cartoon btn-mini ${canEvolve ? 'btn-purple' : 'btn-disabled'}" id="btn-shop-evolve">
              ${I18n.t('evolveBtn', { cost: 1850 })}
            </button>
          </div>`;

      const gunCards = WEAPON_LIST.map((w) => {
        const owned = s.player.weapons.find((inst) => inst.defId === w.id);
        const isPermanent = !!owned && owned.tempWavesLeft === undefined;
        const isEquipped = activeWep.defId === w.id;
        const locked = unlockedRooms < w.unlockRoomsRequired && !owned;
        const wTitle = owned?.evolved ? `⚡${I18n.wSuperName(w.id, w.superName)}` : I18n.wName(w.id, w.name);

        const gunCost = this.engine.getEffectiveGunCost(w.id);
        const ammoCost = this.engine.getEffectiveAmmoCost(w.id);
        let btnLabel = I18n.t('buyBtn', { cost: gunCost });
        let btnClass = s.cash >= gunCost ? 'btn-green' : 'btn-disabled';
        let refillBtnHtml = '';

        if (locked) {
          btnLabel = I18n.t('needDoors', { n: w.unlockRoomsRequired });
          btnClass = 'btn-disabled';
        } else if (owned && !isPermanent) {
          if (!isEquipped) {
            btnLabel = I18n.t('freeSwitch');
            btnClass = 'btn-blue';
          } else {
            btnLabel = I18n.t('buyPermanent', { cost: gunCost });
            btnClass = s.cash >= gunCost ? 'btn-green' : 'btn-disabled';
          }
        } else if (owned) {
          const maxRes = this.engine.getMaxReserve(w.id, owned.evolved);
          const full =
            w.maxReserve < 0 ||
            (owned.reserve >= maxRes && owned.mag >= this.engine.getMaxMag(w.id, owned.evolved));
          if (!isEquipped) {
            btnLabel = I18n.t('equipNow');
            btnClass = 'btn-blue';
            if (!full) {
              const canRefill = s.cash >= ammoCost;
              refillBtnHtml = `<button class="btn-cartoon btn-mini ${canRefill ? 'btn-yellow' : 'btn-disabled'}" data-refill-gun="${w.id}">${I18n.t('refillBtn', { cost: ammoCost })}</button>`;
            }
          } else if (full) {
            btnLabel = w.maxReserve < 0 ? I18n.t('equippedTag') : I18n.t('equippedFull');
            btnClass = 'btn-gray';
          } else {
            btnLabel = I18n.t('refillMainBtn', { cost: ammoCost });
            btnClass = s.cash >= ammoCost ? 'btn-yellow' : 'btn-disabled';
          }
        }

        const ownedBadge = isEquipped
          ? `<span class="gun-owned-pill active">${I18n.t('pillEquipped')}</span>`
          : isPermanent
            ? `<span class="gun-owned-pill">${I18n.t('pillOwned')}</span>`
            : owned
              ? `<span class="gun-owned-pill trial">${I18n.t('pillTrial', { n: owned.tempWavesLeft ?? 1 })}</span>`
              : '';

        return `
          <div class="armory-gun-card ${isEquipped ? 'equipped' : isPermanent ? 'owned' : ''} ${locked ? 'locked' : ''}">
            <div class="gun-card-head">
              <img src="./assets/gun_${w.id}.png" alt="${wTitle}" class="armory-gun-img" />
              <div class="gun-head-info">
                <div class="gun-title-row">
                  <span class="gun-title">${wTitle}</span>
                  ${ownedBadge}
                </div>
                <div class="gun-tag">${I18n.t('gunStatsTag', { dmg: w.damage * w.pellets, rate: w.fireRate })}</div>
              </div>
            </div>
            <div class="gun-card-actions">
              <button class="btn-cartoon btn-mini ${btnClass}" data-buy-gun="${w.id}" ${locked ? 'disabled' : ''}>
                ${btnLabel}
              </button>
              ${refillBtnHtml}
            </div>
          </div>
        `;
      }).join('');

      const autoAmmoOn = Boolean(save.autoBuyAmmo);
      const autoAmmoStrip = `
        <div class="auto-ammo-strip ${autoAmmoOn ? 'active' : ''}">
          <div class="auto-ammo-copy">
            <strong>${I18n.t('autoAmmoTitle')}</strong>
            <span>${I18n.t('autoAmmoDesc')}</span>
          </div>
          <button class="btn-cartoon btn-mini ${autoAmmoOn ? 'btn-green' : 'btn-gray'}" id="btn-toggle-auto-ammo" type="button">
            ${autoAmmoOn ? I18n.t('autoAmmoOn') : I18n.t('autoAmmoOff')}
          </button>
        </div>
      `;
      const arsenalHint = `<div class="arsenal-keep-bar">${I18n.t('arsenalKeepHint', { n: s.player.weapons.length })}</div>`;
      contentHtml = `${evolveStrip}${autoAmmoStrip}${arsenalHint}<div class="armory-gun-grid">${gunCards}</div>`;
    } else {
      const turretSupportText =
        s.hqSupportCooldown > 0
          ? I18n.t('supCooldown', { s: s.hqSupportCooldown.toFixed(0) })
          : save.freeHqSupportUsed
            ? I18n.t('supWatchAd')
            : I18n.t('supFreeFirst');
      const elecSupportText =
        s.electricFortifyWaves > 0
          ? I18n.t('supActiveWaves', { w: s.electricFortifyWaves })
          : I18n.t('supWatchAd');
      const cashSupportText =
        s.armoryAdCooldown > 0
          ? I18n.t('supCooldown', { s: s.armoryAdCooldown.toFixed(0) })
          : I18n.t('supCashBtn');
      const alloyWin = this.engine.getAlloyWindowsStatus();
      const canBuyAlloyWin = alloyWin.total > 0 && alloyWin.done < alloyWin.total && s.cash >= 180;
      const alloyWinFull = alloyWin.total > 0 && alloyWin.done >= alloyWin.total;

      contentHtml = `
        <div class="supply-grid">
          <div class="supply-card">
            <div class="sup-name"><img class="sup-inline-icon" src="./assets/item_emp_grid.png" alt="" /> ${I18n.t('supAlloyWinName')}</div>
            <div class="sup-meta">${I18n.t('supAlloyWinMeta', { done: alloyWin.done, total: alloyWin.total })}</div>
            <button class="btn-cartoon btn-mini ${alloyWinFull ? 'btn-gray' : canBuyAlloyWin ? 'btn-blue' : 'btn-disabled'}" data-tac="alloy_windows">${alloyWinFull ? I18n.t('supAlloyWinFullBtn') : I18n.t('supAlloyWinBtn')}</button>
          </div>
          <div class="supply-card">
            <div class="sup-name"><img class="sup-inline-icon" src="./assets/item_armor.png" alt="" /> ${I18n.t('supArmorName')}</div>
            <div class="sup-meta">${I18n.t('supArmorMeta', { cur: Math.round(s.player.armor) })}</div>
            <button class="btn-cartoon btn-mini ${s.cash >= 380 && s.player.armor < 100 ? 'btn-blue' : 'btn-disabled'}" data-tac="armor">${I18n.t('buyBtn', { cost: 380 })}</button>
          </div>
          <div class="supply-card">
            <div class="sup-name"><img class="sup-inline-icon" src="./assets/item_medkit.png" alt="" /> ${I18n.t('supMedkitName')}</div>
            <div class="sup-meta">${I18n.t('supMedkitMeta', { hp: Math.ceil(s.player.hp), max: s.player.maxHp })}</div>
            <button class="btn-cartoon btn-mini ${s.cash >= 300 && s.player.hp < s.player.maxHp ? 'btn-green' : 'btn-disabled'}" data-tac="medkit">${I18n.t('supMedkitBtn')}</button>
          </div>
          <div class="supply-card">
            <div class="sup-name"><img class="sup-inline-icon" src="./assets/prop_grenade.png" alt="" /> ${I18n.t('supGrenName')}</div>
            <div class="sup-meta">${I18n.t('supGrenMeta', { n: s.player.grenades })}</div>
            <button class="btn-cartoon btn-mini ${s.cash >= 220 ? 'btn-yellow' : 'btn-disabled'}" data-tac="grenades">${I18n.t('buyBtn', { cost: 220 })}</button>
          </div>
          <div class="supply-card">
            <div class="sup-name"><img class="sup-inline-icon" src="./assets/prop_ammo_box.png" alt="" /> ${I18n.t('supAllAmmoName')}</div>
            <div class="sup-meta">${I18n.t('supAllAmmoMeta')}</div>
            <button class="btn-cartoon btn-mini ${s.cash >= 320 ? 'btn-blue' : 'btn-disabled'}" data-tac="all_ammo">${I18n.t('supAllAmmoBtn')}</button>
          </div>
          <div class="supply-card">
            <div class="sup-name"><img class="sup-inline-icon" src="./assets/prop_turret.png" alt="" /> ${I18n.t('supTurretName')}</div>
            <div class="sup-meta">${I18n.t('supTurretMeta')}</div>
            <button class="btn-cartoon btn-mini ${s.cash >= 650 ? 'btn-yellow' : 'btn-disabled'}" data-tac="turret">${I18n.t('supTurretBtn')}</button>
          </div>
          <div class="supply-card support-highlight">
            <div class="sup-name"><img class="sup-inline-icon" src="./assets/drop_cash.png" alt="" /> ${I18n.t('supCashName')}</div>
            <div class="sup-meta">${I18n.t('supCashMeta')}</div>
            <button class="btn-cartoon btn-mini ${s.armoryAdCooldown > 0 ? 'btn-disabled' : 'btn-yellow'}" id="btn-armory-ad" ${s.armoryAdCooldown > 0 ? 'disabled' : ''}>${cashSupportText}</button>
          </div>
          <div class="supply-card support-highlight">
            <div class="sup-name"><img class="sup-inline-icon" src="./assets/prop_chest.png" alt="" /> ${I18n.t('supHqName')}</div>
            <div class="sup-meta">${I18n.t('supHqMeta')}</div>
            <button class="btn-cartoon btn-mini ${s.hqSupportCooldown > 0 ? 'btn-disabled' : 'btn-green'}" id="btn-sup-turret" ${s.hqSupportCooldown > 0 ? 'disabled' : ''}>${turretSupportText}</button>
          </div>
          <div class="supply-card support-highlight">
            <div class="sup-name"><img class="sup-inline-icon" src="./assets/item_emp_grid.png" alt="" /> ${I18n.t('supElecName')}</div>
            <div class="sup-meta">${I18n.t('supElecMeta')}</div>
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
              <h2>${I18n.t('armoryTitle')}</h2>
              <div class="seg-group dark">
                <button class="seg-btn ${this.armoryTab === 'guns' ? 'active' : ''}" data-shop-tab="guns">${I18n.t('tabGuns')}</button>
                <button class="seg-btn ${this.armoryTab === 'supplies' ? 'active' : ''}" data-shop-tab="supplies">${I18n.t('tabSupplies')}</button>
              </div>
            </div>
            <div class="armory-wallet">
              <span class="shop-room-tag">${I18n.t('unlockedSectors', { n: unlockedRooms })}</span>
              <span class="cash-pill">$${s.cash}</span>
              <button class="shop-close-btn" id="btn-close-armory">✕</button>
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

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-refill-gun]').forEach((btn) => {
      btn.onclick = () => {
        const res = this.engine.buyOrRefillWeaponFromShop(btn.dataset.refillGun!, true);
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

    const autoAmmoBtn = this.modalRoot.querySelector('#btn-toggle-auto-ammo') as HTMLButtonElement | null;
    if (autoAmmoBtn) {
      autoAmmoBtn.onclick = () => {
        const enabled = SaveManager.toggleAutoBuyAmmo();
        SoundFX.reloadDone();
        this.renderArmoryShop(enabled ? I18n.t('autoAmmoOn') : I18n.t('autoAmmoOff'));
      };
    }

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-tac]').forEach((btn) => {
      btn.onclick = () => {
        const item = btn.dataset.tac as
          | 'grenades'
          | 'medkit'
          | 'turret'
          | 'all_ammo'
          | 'armor'
          | 'alloy_windows';
        const res = this.engine.buyShopTacticalItem(item);
        this.renderArmoryShop(res.msg);
      };
    });

    const cashAdBtn = this.modalRoot.querySelector('#btn-armory-ad') as HTMLButtonElement | null;
    if (cashAdBtn) {
      cashAdBtn.onclick = async () => {
        if (s.armoryAdCooldown > 0) return;
        const ok = await PlatformSDK.showRewardedAd('armory_free_cash', I18n.t('supCashName'));
        if (s.isCoop) PlatformSDK.gameplayStart();
        if (ok) {
          s.cash += 450;
          s.armoryAdCooldown = 90;
          this.renderArmoryShop(I18n.t('cashAddedToast'));
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
          const ok = await PlatformSDK.showRewardedAd('hq_ammo_turret', I18n.t('supHqName'));
          if (ok) {
            this.toggleArmoryShop();
            this.engine.applyHqAmmoAndTurret();
          } else if (s.isCoop) {
            PlatformSDK.gameplayStart();
          }
        }
      };
    }

    const supElecBtn = this.modalRoot.querySelector('#btn-sup-elec') as HTMLButtonElement | null;
    if (supElecBtn) {
      supElecBtn.onclick = async () => {
        if (s.electricFortifyWaves > 0) return;
        const ok = await PlatformSDK.showRewardedAd('electric_fortify', I18n.t('supElecName'));
        if (ok) {
          this.toggleArmoryShop();
          this.engine.applyElectricFortify();
        } else if (s.isCoop) {
          PlatformSDK.gameplayStart();
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

    const hpTextStr = `${Math.ceil(s.player.hp)}/${s.player.maxHp}`;
    setIfChanged('hp', hpTextStr, () => {
      const hpFill = this.hudRoot!.querySelector('#hud-hp-fill') as HTMLElement;
      const hpText = this.hudRoot!.querySelector('#hud-hp-text') as HTMLElement;
      hpFill.style.width = `${Math.max(0, (s.player.hp / s.player.maxHp) * 100)}%`;
      hpText.textContent = hpTextStr;
    });

    const xpKey = `${s.battleLevel}:${Math.round((s.battleXp / Math.max(1, s.battleXpNext)) * 100)}`;
    setIfChanged('xpLv', xpKey, () => {
      const xpFill = this.hudRoot!.querySelector('#hud-xp-fill') as HTMLElement;
      const lvChip = this.hudRoot!.querySelector('#hud-lv-chip') as HTMLElement;
      xpFill.style.width = `${Math.min(100, Math.max(0, (s.battleXp / Math.max(1, s.battleXpNext)) * 100))}%`;
      lvChip.textContent = `Lv.${s.battleLevel}`;
    });

    const armorVal = Math.round(s.player.armor);
    setIfChanged('armor', `${armorVal}`, () => {
      const chip = this.hudRoot!.querySelector('#hud-armor-chip') as HTMLElement;
      const armorText = this.hudRoot!.querySelector('#hud-armor-val') as HTMLElement;
      if (armorVal > 0) {
        chip.style.display = 'inline-flex';
        armorText.textContent = `${armorVal}`;
      } else {
        chip.style.display = 'none';
      }
    });

    const extraRooms = this.engine.getUnlockedExtraRoomsCount();
    const sectorKey = `${I18n.lang}:${extraRooms}`;
    setIfChanged('sectorBuff', sectorKey, () => {
      const sChip = this.hudRoot!.querySelector('#hud-sector-chip') as HTMLElement;
      if (extraRooms > 0) {
        sChip.style.display = 'inline-flex';
        sChip.textContent = I18n.t('hudSectorBuff', { n: extraRooms, dmg: extraRooms * 10 });
        sChip.title = I18n.t('hudSectorTip', {
          n: extraRooms,
          dmg: extraRooms * 10,
          bonus: extraRooms * 50,
        });
      } else {
        sChip.style.display = 'none';
      }
    });

    const coopSuffix = s.isCoop ? I18n.t('coopCountSuffix', { n: s.squadCount }) : '';
    let waveStr = '';
    if (s.waveState === 'extraction') {
      waveStr = `${I18n.t('waveEvac', { pct: Math.round(s.extractionProgress * 100) })}${coopSuffix}`;
    } else if (s.waveState === 'intermission') {
      waveStr = `${I18n.t('waveBreak', { s: Math.ceil(s.intermissionTimer) })}${coopSuffix}`;
    } else {
      waveStr =
        (s.mode === 'standard'
          ? I18n.t('waveStd', { w: s.wave, m: s.maxWaves, n: s.zombiesRemainingInWave })
          : I18n.t('waveEndl', { w: s.wave, n: s.zombiesRemainingInWave })) + coopSuffix;
    }
    setIfChanged('wave', waveStr, () => {
      (this.hudRoot!.querySelector('#hud-wave') as HTMLElement).textContent = waveStr;
    });

    const squadSig = s.isCoop
      ? `${I18n.lang}|` +
        s.remotePlayers
          .map(
            (rp) =>
              `${rp.peerId}:${rp.callsign}:${rp.hp}/${rp.maxHp}:${rp.downed ? 1 : 0}:${rp.spectating ? 1 : 0}:${Math.ceil(rp.bleedoutTimer)}:${rp.cash}`
          )
          .join('|')
      : '';
    setIfChanged('squadHud', squadSig, () => {
      const sqEl = this.hudRoot!.querySelector('#hud-squad-list') as HTMLElement;
      if (!s.isCoop || s.remotePlayers.length === 0) {
        sqEl.innerHTML = '';
        return;
      }
      sqEl.innerHTML = s.remotePlayers
        .map((rp) => {
          const hpPct = Math.max(0, Math.min(100, Math.round((rp.hp / Math.max(1, rp.maxHp)) * 100)));
          const stText = rp.spectating
            ? I18n.t('squadWaitWave')
            : rp.downed
              ? I18n.t('squadSOS', { s: Math.ceil(rp.bleedoutTimer) })
              : `$${rp.cash}`;
          return `
            <div class="squad-hud-chip ${rp.downed ? 'is-downed' : ''}">
              <span class="sq-dot" style="background:${rp.color}"></span>
              <span class="sq-name">${rp.callsign}</span>
              <div class="sq-hp-track"><div class="sq-hp-fill" style="width:${hpPct}%;background:${rp.downed ? '#ef4444' : rp.color}"></div></div>
              <span class="sq-meta">${stText}</span>
            </div>
          `;
        })
        .join('');
    });

    const bossTarget =
      s.zombies.find((z) => isBossKind(z.kind)) || s.zombies.find((z) => z.kind === 'miniboss');
    const bossKey = bossTarget ? `${I18n.lang}:${bossTarget.id}:${Math.ceil(bossTarget.hp)}` : 'none';
    setIfChanged('bossHud', bossKey, () => {
      const bossBox = this.hudRoot!.querySelector('#hud-boss-box') as HTMLElement;
      if (bossTarget) {
        bossBox.style.display = 'block';
        const pct = Math.max(0, (bossTarget.hp / bossTarget.maxHp) * 100);
        (this.hudRoot!.querySelector('#hud-boss-fill') as HTMLElement).style.width = `${pct}%`;
        const bp = isBossKind(bossTarget.kind) ? getBossProfile(bossTarget.kind) : null;
        const title = bp ? (I18n.isZh() ? bp.zhName : bp.enName) : I18n.t('bossTyrant');
        (this.hudRoot!.querySelector('#hud-boss-text') as HTMLElement).textContent =
          `${title} ${Math.ceil(bossTarget.hp)}`;
      } else {
        bossBox.style.display = 'none';
      }
    });

    const feverKey = s.feverTimer > 0 ? `${I18n.lang}:${s.feverTimer.toFixed(1)}` : 'off';
    setIfChanged('fever', feverKey, () => {
      const feverBox = this.hudRoot!.querySelector('#hud-fever-box') as HTMLElement;
      if (s.feverTimer > 0) {
        feverBox.style.display = 'block';
        (this.hudRoot!.querySelector('#hud-fever-fill') as HTMLElement).style.width =
          `${(s.feverTimer / 6.5) * 100}%`;
        (this.hudRoot!.querySelector('#hud-fever-text') as HTMLElement).textContent = I18n.t(
          'feverActive',
          { s: s.feverTimer.toFixed(1) }
        );
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

    const qTarget = this.engine.getQuickRefillTarget();
    const showKeyHint = !this.engine.input.usingTouch;
    const qKey = qTarget
      ? `${I18n.lang}:${qTarget.defId}:${qTarget.evolved ? 1 : 0}:${qTarget.cost}:${qTarget.isEmpty ? 1 : 0}:${qTarget.needsReequip ? 1 : 0}:${qTarget.urgent ? 1 : 0}:${qTarget.canAfford ? 1 : 0}:${showKeyHint ? 1 : 0}`
      : 'none';
    setIfChanged('quickAmmo', qKey, () => {
      const qBtn = this.hudRoot!.querySelector('#btn-quick-ammo') as HTMLButtonElement;
      if (!qTarget) {
        qBtn.style.display = 'none';
        return;
      }
      const qIcon = this.hudRoot!.querySelector('#quick-ammo-icon') as HTMLImageElement;
      const qLbl = this.hudRoot!.querySelector('#quick-ammo-label') as HTMLElement;
      const qKbd = this.hudRoot!.querySelector('#quick-ammo-key') as HTMLElement;
      qBtn.style.display = 'inline-flex';
      const iconSrc = `./assets/gun_${qTarget.defId}.png`;
      if (qIcon.getAttribute('src') !== iconSrc) {
        qIcon.setAttribute('src', iconSrc);
      }
      qLbl.textContent = I18n.t(
        qTarget.isEmpty && qTarget.needsReequip ? 'quickAmmoReequipBtn' : 'quickAmmoBtn',
        { cost: qTarget.cost }
      );
      qKbd.style.display = showKeyHint ? 'inline-block' : 'none';
      qBtn.classList.toggle('is-empty', qTarget.isEmpty);
      qBtn.classList.toggle('is-urgent', qTarget.urgent && qTarget.canAfford);
      qBtn.classList.toggle('no-cash', !qTarget.canAfford);
      qBtn.classList.toggle('is-evolved', qTarget.evolved);
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
        bannerEl.classList.toggle('alert-banner', bannerKey.startsWith('⚠️'));
        bannerEl.classList.add('visible');
      } else {
        bannerEl.classList.remove('visible', 'alert-banner');
      }
    });

    const toastKey = s.lootToast ? `${s.lootToast.badge}|${s.lootToast.title}` : '';
    setIfChanged('lootToast', toastKey, () => {
      const toastEl = this.hudRoot!.querySelector('#hud-loot-toast') as HTMLElement;
      if (s.lootToast) {
        const imgEl = this.hudRoot!.querySelector('#loot-toast-img') as HTMLImageElement;
        const badgeEl = this.hudRoot!.querySelector('#loot-toast-badge') as HTMLElement;
        const titleEl = this.hudRoot!.querySelector('#loot-toast-title') as HTMLElement;
        const descEl = this.hudRoot!.querySelector('#loot-toast-desc') as HTMLElement;
        imgEl.setAttribute('src', s.lootToast.sprite);
        badgeEl.textContent = s.lootToast.badge;
        badgeEl.style.background = s.lootToast.color;
        titleEl.textContent = s.lootToast.title;
        descEl.textContent = s.lootToast.desc;
        toastEl.style.borderColor = s.lootToast.color;
        toastEl.classList.add('visible');
      } else {
        toastEl.classList.remove('visible');
      }
    });

    const relicSig = `${I18n.lang}:${s.relicIds.join(',')}`;
    setIfChanged('relics', relicSig, () => {
      const relicRow = this.hudRoot!.querySelector('#hud-relics') as HTMLElement;
      relicRow.innerHTML = s.relicIds
        .map((id) => {
          const r = RELICS.find((item) => item.id === id);
          if (!r) return '';
          const rm = I18n.relicMeta(r.id, r.name, r.desc);
          return `<span class="relic-chip rarity-${r.rarity}" title="${rm.name}: ${rm.desc}"><img src="${r.sprite}" alt="" /></span>`;
        })
        .join('');
    });

    const activePows = (Object.keys(s.powerUpTimers) as PowerUpType[])
      .filter((k) => s.powerUpTimers[k] > 0)
      .map(
        (k) =>
          `<span class="pow-chip" style="border-color:${POWERUP_META[k].color}"><img class="pow-chip-ico" src="${POWERUP_META[k].sprite}" alt="" /> ${I18n.powerupName(k, POWERUP_META[k].name)} ${s.powerUpTimers[k].toFixed(0)}s</span>`
      )
      .join('');
    setIfChanged('pows', activePows, () => {
      (this.hudRoot!.querySelector('#hud-powerups') as HTMLElement).innerHTML = activePows;
    });

    const activeWep = s.player.weapons[s.player.activeSlot];
    const maxMag = this.engine.getMaxMag(activeWep.defId, activeWep.evolved);
    const isReloading = s.player.reloadTimer > 0;
    const ammoStr = isReloading
      ? I18n.t('reloadingShort')
      : activeWep.reserve < 0
        ? `${activeWep.mag}/∞`
        : `${activeWep.mag}/${activeWep.reserve}`;
    const lowAmmo = !isReloading && activeWep.mag <= Math.max(2, Math.floor(maxMag * 0.28));

    const mainKey = `${activeWep.defId}:${activeWep.evolved ? 1 : 0}:${ammoStr}:${lowAmmo ? 1 : 0}:${isReloading ? 1 : 0}`;
    setIfChanged('mainAtkWheel', mainKey, () => {
      const atkBtn = this.hudRoot!.querySelector('#btn-main-attack') as HTMLButtonElement;
      const atkIcon = this.hudRoot!.querySelector('#main-atk-icon') as HTMLImageElement;
      const atkAmmo = this.hudRoot!.querySelector('#main-atk-ammo') as HTMLElement;
      const targetSrc = `./assets/gun_${activeWep.defId}.png`;
      if (atkIcon.getAttribute('src') !== targetSrc) {
        atkIcon.setAttribute('src', targetSrc);
      }
      atkBtn.classList.toggle('evolved', activeWep.evolved);
      atkBtn.classList.toggle('reloading', isReloading);
      atkAmmo.textContent = ammoStr;
      atkAmmo.classList.toggle('low-ammo', lowAmmo);
    });

    const atkBtnEl = this.hudRoot.querySelector('#btn-main-attack') as HTMLButtonElement;
    if (!this.engine.input.attackBtnStick.active && atkBtnEl.classList.contains('pressing')) {
      atkBtnEl.classList.remove('pressing', 'aiming');
      (this.hudRoot.querySelector('#main-atk-knob') as HTMLElement).style.transform = 'translate(0px, 0px)';
    }

    const weaponCount = s.player.weapons.length;
    const hasSecond = weaponCount >= 2;
    const nextIdx = hasSecond ? (s.player.activeSlot + 1) % weaponCount : 0;
    const secWep = hasSecond ? s.player.weapons[nextIdx] : null;
    const switchKey = secWep
      ? `${secWep.defId}:${secWep.evolved ? 1 : 0}:${s.player.activeSlot}/${weaponCount}`
      : `empty:${I18n.lang}`;
    setIfChanged('arcSwitch', switchKey, () => {
      const swBtn = this.hudRoot!.querySelector('#btn-arc-switch') as HTMLButtonElement;
      const swIcon = this.hudRoot!.querySelector('#arc-switch-icon') as HTMLImageElement;
      const swBadge = this.hudRoot!.querySelector('#arc-switch-badge') as HTMLElement;
      if (secWep) {
        swBtn.classList.remove('empty-slot');
        swBtn.classList.toggle('evolved', secWep.evolved);
        swIcon.setAttribute('src', `./assets/gun_${secWep.defId}.png`);
        swBadge.textContent = weaponCount > 2 ? `${s.player.activeSlot + 1}/${weaponCount}` : '⇄';
      } else {
        swBtn.classList.add('empty-slot');
        swBtn.classList.remove('evolved');
        swIcon.setAttribute('src', './assets/gun_smg.png');
        swBadge.textContent = I18n.t('subWepBadge');
      }
    });

    const clsDef = getAgentClassDef(s.classId);
    const skillCdSec = s.skillCooldown > 0 ? Math.ceil(s.skillCooldown) : 0;
    const skillKey = `${clsDef.id}:${skillCdSec}:${this.engine.input.usingTouch ? 1 : 0}`;
    setIfChanged('arcSkill', skillKey, () => {
      const skBtn = this.hudRoot!.querySelector('#btn-arc-skill') as HTMLButtonElement;
      const skIcon = this.hudRoot!.querySelector('#arc-skill-icon') as HTMLImageElement;
      const skBadge = this.hudRoot!.querySelector('#arc-skill-badge') as HTMLElement;
      if (skIcon.getAttribute('src') !== clsDef.skillSprite) {
        skIcon.setAttribute('src', clsDef.skillSprite);
      }
      skBtn.disabled = skillCdSec > 0;
      skBtn.style.borderColor = skillCdSec > 0 ? '' : clsDef.color;
      skBadge.textContent = skillCdSec > 0 ? `${skillCdSec}s` : this.engine.input.usingTouch ? '⚡' : 'F';
    });

    const canReload =
      !isReloading &&
      activeWep.mag < maxMag &&
      (activeWep.reserve < 0 || activeWep.reserve > 0);
    const reloadKey = `${canReload ? 1 : 0}:${isReloading ? 1 : 0}:${lowAmmo ? 1 : 0}`;
    setIfChanged('arcReload', reloadKey, () => {
      const relBtn = this.hudRoot!.querySelector('#btn-arc-reload') as HTMLButtonElement;
      relBtn.disabled = !canReload && !isReloading;
      relBtn.classList.toggle('reloading', isReloading);
      relBtn.classList.toggle('need-reload', canReload && lowAmmo);
    });
  }

  // ==================== 单人模式战地升级肉鸽三选一卡片 ====================

  public showPerkChoiceModal(
    choices: InRunPerkDef[],
    level: number,
    onPick: (perk: InRunPerkDef) => void
  ): void {
    this.clearPerkKeyHandler();
    this.armoryOpen = false;
    this.pauseOpen = false;

    const cardsHtml = choices
      .map((c, idx) => {
        const meta = I18n.perkMeta(c.id, c.name, c.desc);
        return `
          <button class="perk-choice-card" type="button" data-perk-idx="${idx}" style="--perk-color:${c.color}">
            <span class="perk-key-badge">[${idx + 1}]</span>
            <div class="perk-ico-wrap"><img src="${c.sprite}" alt="" /></div>
            <strong class="perk-card-title">${meta.name}</strong>
            <p class="perk-card-desc">${meta.desc}</p>
          </button>
        `;
      })
      .join('');

    this.modalRoot.innerHTML = `
      <div class="popup-backdrop">
        <div class="popup-box perk-modal-box">
          <h2>${I18n.t('perkPickTitle', { lv: level })}</h2>
          <p class="popup-sub">${I18n.t('perkPickHint')}</p>
          <div class="perk-choice-grid">${cardsHtml}</div>
        </div>
      </div>
    `;

    let chosen = false;
    const commitPick = (idx: number) => {
      if (chosen || !choices[idx]) return;
      chosen = true;
      this.clearPerkKeyHandler();
      this.modalRoot.innerHTML = '';
      onPick(choices[idx]);
    };

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-perk-idx]').forEach((btn) => {
      this.bindModalTap(btn, () => {
        commitPick(Number(btn.dataset.perkIdx));
      });
    });

    this.perkKeyHandler = (e: KeyboardEvent) => {
      if (e.code === 'Digit1' || e.code === 'Numpad1') {
        e.preventDefault();
        commitPick(0);
      } else if (e.code === 'Digit2' || e.code === 'Numpad2') {
        e.preventDefault();
        commitPick(1);
      } else if (e.code === 'Digit3' || e.code === 'Numpad3') {
        e.preventDefault();
        commitPick(2);
      }
    };
    window.addEventListener('keydown', this.perkKeyHandler);
  }

  // ==================== 复活与结算简洁弹窗 ====================

  public showReviveModal(canRevive: boolean): void {
    this.clearPerkKeyHandler();
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
          <h2>${I18n.t('downedTitle')}</h2>
          <p class="popup-sub">${I18n.t('downedSub', { w: s.wave, k: s.kills })}</p>
          <div class="revive-perks">
            <span><img class="sup-inline-icon" src="./assets/item_emp_grid.png" alt="" /> ${I18n.t('revPerk1')}</span>
            <span><img class="sup-inline-icon" src="./assets/item_medkit.png" alt="" /> ${I18n.t('revPerk2')}</span>
            <span><img class="sup-inline-icon" src="./assets/prop_wood_plank.png" alt="" /> ${I18n.t('revPerk3')}</span>
          </div>
          <div class="popup-footer">
            <button class="btn-cartoon btn-green" id="btn-do-revive">${I18n.t('reviveAdBtn')}</button>
            <button class="btn-cartoon btn-gray" id="btn-skip-revive">${I18n.t('skipReviveBtn')}</button>
          </div>
        </div>
      </div>
    `;

    const reviveBtn = this.modalRoot.querySelector('#btn-do-revive') as HTMLButtonElement;
    reviveBtn.onclick = async () => {
      reviveBtn.disabled = true;
      const ok = await PlatformSDK.showRewardedAd('revive_shockwave', I18n.t('reviveAdBtn'));
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
    this.clearPerkKeyHandler();
    this.armoryOpen = false;
    this.pauseOpen = false;
    const stageTierBonus = (s.stage.index - 1) * 20;
    const baseGold = Math.round(
      25 + stageTierBonus + s.wave * 14 + Math.min(220, s.kills * 0.45) + (victory ? 110 : 0)
    );
    const baseXp = Math.round(
      30 + stageTierBonus + s.wave * 16 + Math.min(260, s.kills * 0.65) + (victory ? 100 : 0)
    );
    const zones = [2, 3, 5, 3, 2];

    this.modalRoot.innerHTML = `
      <div class="popup-backdrop">
        <div class="popup-box compact-modal">
          <h2>${victory ? I18n.t('victoryTitle') : I18n.t('settleTitle')}</h2>
          <p class="popup-sub">${I18n.t('downedSub', { w: s.wave, k: s.kills })}</p>

          <div class="reward-preview">
            <span><img class="inline-coin" src="./assets/ui_coin.png" alt="" /> <strong id="rew-gold">+${baseGold}</strong></span>
            <span><img class="inline-coin" src="./assets/drop_xp.png" alt="" /> <strong id="rew-xp">+${baseXp} XP</strong></span>
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
              ${I18n.t('multClaimBtn')} (<span id="mult-live">x5</span>)
            </button>
            <button class="btn-cartoon btn-gray" id="btn-normal-claim">${I18n.t('normalClaimBtn')}</button>
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
        `x${lockedMult} ${I18n.t('multClaimBtn')}`
      );
      if (ok) {
        goldEl.textContent = `+${baseGold * lockedMult}`;
        xpEl.textContent = `+${baseXp * lockedMult} XP`;
        SaveManager.addRewards(baseGold * lockedMult, baseXp * lockedMult);
        if (CoopManager.role !== 'offline' && CoopManager.lobby) {
          CoopManager.returnSquadToLobby();
          this.hubTab = 'coop';
        }
        this.showHomeHub();
      } else {
        stopped = false;
        this.needleAnimId = requestAnimationFrame(animateNeedle);
      }
    };

    const normalClaimBtn = this.modalRoot.querySelector('#btn-normal-claim') as HTMLButtonElement;
    normalClaimBtn.onclick = async () => {
      normalClaimBtn.disabled = true;
      stopped = true;
      cancelAnimationFrame(this.needleAnimId);
      SaveManager.addRewards(baseGold, baseXp);
      if (CoopManager.role === 'offline') {
        await PlatformSDK.showCommercialBreak();
      }
      if (CoopManager.role !== 'offline' && CoopManager.lobby) {
        CoopManager.returnSquadToLobby();
        this.hubTab = 'coop';
      }
      this.showHomeHub();
    };
  }
}
