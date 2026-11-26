import { SoundFX } from '../audio/SoundFX';
import { getBossProfile, isBossKind } from '../data/enemies';
import { POWERUP_META, RELICS } from '../data/perksAndRelics';
import { STAGES, TUTORIAL_STAGE } from '../data/stages';
import { WEAPON_LIST, WEAPONS } from '../data/weapons';
import { RunSnapshot } from '../game/Entities';
import { GameEngine } from '../game/GameEngine';
import { I18n, LANG_OPTIONS, LangCode } from '../i18n/I18n';
import { SaveManager, UPGRADE_TRACKS } from '../meta/SaveManager';
import {
  CHIP_MAX_LEVEL,
  DIFFICULTY_TIERS,
  MAX_EQUIPPED_CHIPS,
  PARAGON_TRACKS,
  TACTICAL_CHIPS,
  WEAPON_MASTERY_MAX,
  getChipUpgradeCost,
  getDifficultyMeta,
  getParagonCost,
  getStageEcology,
  getWeaponAwakeningDesc,
  getWeaponMasteryBonuses,
  getWeaponMasteryCost,
} from '../meta/EndgameDefs';
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
import {
  AgentClassId,
  DifficultyTier,
  GameMode,
  InRunPerkDef,
  ParagonKey,
  PowerUpType,
  StageDef,
} from '../types';

export class UIManager {
  private hudRoot: HTMLElement | null = null;
  private modalRoot: HTMLElement;
  private needleAnimId = 0;
  private armoryOpen = false;
  private pauseOpen = false;
  private selectedMode: GameMode = 'standard';
  private selectedTier: DifficultyTier = 1;
  private hubTab: 'stages' | 'upgrades' | 'coop' | 'daily' | 'rank' = 'stages';
  private upgSubTab: 'core' | 'mastery' | 'endgame' = 'core';
  private rankSort: 'endless' | 'kills' = 'endless';
  private armoryTab: 'guns' | 'supplies' = 'guns';
  private hudCache: Record<string, string> = {};
  private coopToast = '';
  private coopCodeDraft = '';
  private hallFilter: 'all' | 'waiting' | 'ingame' = 'all';
  private hudStatsOpen = false;
  private cleanupKeypadModal: (() => void) | null = null;
  private calloutStripHideTimer = 0;
  private perkKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private ftue: {
    active: boolean;
    startX: number;
    startY: number;
    initialCash: number;
    initialGrenades: number;
    moved: boolean;
    shot: boolean;
    geared: boolean;
    tactical: boolean;
    completedAt: number;
  } | null = null;

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
      (stageId, mode, lobby) => {
        const st = STAGES.find((item) => item.id === stageId) || STAGES[0];
        this.startStageRun(st, mode, false, lobby?.tier || 1);
      },
      () => {
        if (!this.engine.state && this.hubTab === 'coop') {
          this.syncCoopLobbyNetBadge();
        }
      },
      () => {
        if (!this.engine.state) {
          this.syncCoopTabHallBadge();
          if (this.hubTab === 'coop') {
            this.syncPublicRoomsInHub();
          }
        }
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

    PlatformSDK.onInstallStateChange(() => {
      if (!this.engine.state && this.modalRoot.querySelector('.hub-screen')) {
        const btn = this.modalRoot.querySelector('#btn-hub-install') as HTMLButtonElement | null;
        if (btn && !PlatformSDK.canShowHomeScreenShortcut()) {
          btn.style.display = 'none';
        }
      }
    });

    const urlRoom = CoopManager.consumeUrlRoomParam();
    if (urlRoom) {
      this.hubTab = 'coop';
      setTimeout(() => CoopManager.joinRoomByCode(urlRoom), 60);
    } else if (PlatformSDK.isInstantMultiplayerRequested()) {
      this.hubTab = 'coop';
      setTimeout(() => CoopManager.createHostRoom(STAGES[0].id, this.selectedMode), 60);
    }

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' && this.engine.state && this.engine.state.waveState !== 'ended') {
        if (!this.pauseOpen && !this.armoryOpen) {
          e.preventDefault();
          this.hudStatsOpen = !this.hudStatsOpen;
          this.syncHUD();
        }
      }
    });
  }

  private getAgentRankTitle(level: number): string {
    if (level >= 12) return I18n.t('rank12');
    if (level >= 8) return I18n.t('rank8');
    if (level >= 5) return I18n.t('rank5');
    if (level >= 3) return I18n.t('rank3');
    return I18n.t('rank1');
  }

  private isFullscreenSupported(): boolean {
    return PlatformSDK.isFullscreenAllowed();
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
    let lastTouchFire = -9999;
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
    let lastTouchFire = -9999;
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

  public launchInitialExperience(): void {
    const save = SaveManager.get();
    if (
      this.hubTab !== 'coop' &&
      !save.tutorialDone &&
      !CoopManager.lobby &&
      !PlatformSDK.hasPendingInviteUrl() &&
      !PlatformSDK.isInstantMultiplayerRequested()
    ) {
      this.startStageRun(TUTORIAL_STAGE, 'standard', true);
      return;
    }
    this.showHomeHub();
  }

  public showHomeHub(): void {
    this.clearPerkKeyHandler();
    cancelAnimationFrame(this.needleAnimId);
    PlatformSDK.gameplayStop();
    SoundFX.setBgmMode('hub');
    document.body.classList.remove('pc-combat-cursor');
    this.ftue = null;
    this.hudStatsOpen = false;
    this.armoryOpen = false;
    this.pauseOpen = false;
    this.engine.modalPaused = false;
    this.engine.paused = false;
    this.hudRoot?.remove();
    this.hudRoot = null;
    this.engine.stopRun();

    if (!CoopManager.lobby) {
      PlatformSDK.hideInviteButton();
    } else {
      PlatformSDK.showInviteButton(
        CoopManager.lobby.roomCode,
        !CoopManager.lobby.inGame && CoopManager.lobby.members.length < 4
      );
    }
    CoopManager.ensurePublicDirectoryActive();

    const save = SaveManager.get();
    const hasAffordableUpgrade =
      UPGRADE_TRACKS.some(
        (t) => (save.upgrades[t.key] || 0) < t.maxLevel && save.gold >= SaveManager.getUpgradeCost(t.key)
      ) ||
      AGENT_CLASSES.some((c) => !save.unlockedClasses.includes(c.id) && save.gold >= c.unlockCost);
    const hasDailyReward = SaveManager.hasUnclaimedDailyRewards();
    const muted = SoundFX.isUserMuted();
    const musicMuted = SoundFX.isMusicMuted();
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

    const coopCountBadge = `<span id="hub-coop-tab-badge">${this.buildCoopTabBadgeHtml()}</span>`;

    const langOptsHtml = LANG_OPTIONS.map(
      (o) => `<option value="${o.code}" ${o.code === I18n.lang ? 'selected' : ''}>🌐 ${o.label}</option>`
    ).join('');

    this.cleanupKeypadModal?.();
    const prevHubEl = this.modalRoot.querySelector('.hub-screen') as HTMLElement | null;
    const prevScrollTop = prevHubEl ? prevHubEl.scrollTop : 0;

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
            <span class="core-pill" title="Tech Cores">💠 ${save.techCores || 0}</span>
            <select class="hub-lang-select" id="hub-lang-sel" aria-label="Language">${langOptsHtml}</select>
            <button class="hub-util-btn ${!musicMuted ? 'active' : ''}" id="btn-hub-music" title="${I18n.t('hubMusicTitle')}">${musicMuted ? '🔕' : '🎵'}</button>
            <button class="hub-util-btn" id="btn-hub-mute" title="${I18n.t('hubSoundTitle')}">${muted ? '🔇' : '🔊'}</button>
            ${fsSupported ? `<button class="hub-util-btn ${fsActive ? 'active' : ''}" id="btn-hub-fs" title="Fullscreen">⛶</button>` : ''}
            ${PlatformSDK.canShowHomeScreenShortcut() ? `<button class="hub-install-btn" id="btn-hub-install" type="button"><img src="./assets/app_icon_ui.png" width="18" height="18" alt="" /><span>${I18n.t('installAppBtn')}</span></button>` : ''}
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

    const musicBtn = this.modalRoot.querySelector('#btn-hub-music') as HTMLButtonElement | null;
    if (musicBtn) {
      musicBtn.onclick = () => {
        SoundFX.toggleMusicMute();
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

    const installBtn = this.modalRoot.querySelector('#btn-hub-install') as HTMLButtonElement | null;
    if (installBtn) {
      this.bindModalTap(installBtn, async () => {
        const plat = PlatformSDK.getInstallGuidePlatform();
        // 国内安卓 Chrome 的 beforeinstallprompt ("安装应用") 会后台请求被墙的 googleapis WebAPK 服务导致安装后桌面无图标，
        // 安卓端优先展示清晰的「创建快捷方式 + 桌面快捷方式权限」指引；桌面端与其他支持端正常弹原生安装框
        if (plat !== 'android' && PlatformSDK.hasNativeInstallPrompt()) {
          const outcome = await PlatformSDK.triggerNativeInstallPrompt();
          if (outcome === 'accepted') {
            SoundFX.fanfare();
            installBtn.style.display = 'none';
            return;
          }
          if (outcome === 'dismissed') return;
        }
        this.openInstallAppGuide();
      });
    }

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-hub-tab]').forEach((btn) => {
      this.bindModalTap(btn, () => {
        this.hubTab = btn.dataset.hubTab as 'stages' | 'upgrades' | 'coop' | 'daily' | 'rank';
        this.coopToast = '';
        this.showHomeHub();
      });
    });

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-mode-pick]').forEach((btn) => {
      btn.onclick = () => {
        this.selectedMode = btn.dataset.modePick as GameMode;
        this.showHomeHub();
      };
    });

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-tier-pick]').forEach((btn) => {
      btn.onclick = () => {
        this.selectedTier = Number(btn.dataset.tierPick) as DifficultyTier;
        this.showHomeHub();
      };
    });

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-bot-pick]').forEach((btn) => {
      btn.onclick = () => {
        SaveManager.setAiSquadCount(Number(btn.dataset.botPick || '0'));
        this.showHomeHub();
      };
    });

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-upg-sub]').forEach((btn) => {
      btn.onclick = () => {
        this.upgSubTab = btn.dataset.upgSub as 'core' | 'mastery' | 'endgame';
        this.showHomeHub();
      };
    });

    const tutBtn = this.modalRoot.querySelector('#btn-hub-tutorial') as HTMLButtonElement | null;
    if (tutBtn) {
      tutBtn.onclick = () => {
        if (CoopManager.role !== 'offline') {
          CoopManager.disconnect();
        }
        this.startStageRun(TUTORIAL_STAGE, 'standard', true, 1);
      };
    }

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-stage-go]').forEach((btn) => {
      btn.onclick = async () => {
        if (btn.disabled) return;
        const idx = STAGES.findIndex((item) => item.id === btn.dataset.stageGo);
        if (idx < 0) return;
        const unlocked = idx === 0 || save.clearedStages.includes(STAGES[idx - 1].id);
        const st = STAGES[idx];
        if (!unlocked || !SaveManager.isTierUnlocked(st.id, this.selectedTier)) return;
        if (CoopManager.role !== 'offline') {
          CoopManager.disconnect();
        }
        btn.disabled = true;
        await PlatformSDK.showCommercialBreak();
        this.startStageRun(st, this.selectedMode, false, this.selectedTier);
      };
    });

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-stage-coop-host]').forEach((btn) => {
      this.bindModalTap(btn, () => {
        const sid = btn.dataset.stageCoopHost || STAGES[0].id;
        const idx = STAGES.findIndex((item) => item.id === sid);
        if (idx < 0) return;
        const unlocked = idx === 0 || save.clearedStages.includes(STAGES[idx - 1].id);
        if (!unlocked) return;
        const tier = SaveManager.isTierUnlocked(sid, this.selectedTier) ? this.selectedTier : 1;
        this.hubTab = 'coop';
        this.coopToast = '';
        CoopManager.createHostRoom(sid, this.selectedMode, true, tier);
        this.showHomeHub();
      });
    });

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-gun-mastery]').forEach((btn) => {
      btn.onclick = () => {
        const wid = btn.dataset.gunMastery || '';
        if (SaveManager.upgradeWeaponMastery(wid)) {
          SoundFX.fanfare();
          this.showHomeHub();
        } else {
          SoundFX.emptyClip();
        }
      };
    });

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-chip-upg]').forEach((btn) => {
      btn.onclick = () => {
        const cid = btn.dataset.chipUpg || '';
        if (SaveManager.upgradeOrUnlockChip(cid)) {
          SoundFX.fanfare();
          this.showHomeHub();
        } else {
          SoundFX.emptyClip();
        }
      };
    });

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-chip-equip]').forEach((btn) => {
      btn.onclick = () => {
        const cid = btn.dataset.chipEquip || '';
        if (SaveManager.toggleEquipChip(cid)) {
          SoundFX.reloadDone();
          this.showHomeHub();
        } else {
          SoundFX.emptyClip();
        }
      };
    });

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-paragon-buy]').forEach((btn) => {
      btn.onclick = () => {
        const pKey = btn.dataset.paragonBuy as ParagonKey;
        if (SaveManager.buyParagonLevel(pKey)) {
          SoundFX.fanfare();
          this.showHomeHub();
        } else {
          SoundFX.emptyClip();
        }
      };
    });

    const forgeCoreBtn = this.modalRoot.querySelector('#btn-forge-core') as HTMLButtonElement | null;
    if (forgeCoreBtn) {
      forgeCoreBtn.onclick = () => {
        if (SaveManager.forgeTechCoreWithGold(420)) {
          SoundFX.fanfare();
          this.showHomeHub();
        } else {
          SoundFX.emptyClip();
        }
      };
    }

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
          CoopManager.syncMyLobbyClass(cid);
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

    if (prevScrollTop > 0) {
      const nextHubEl = this.modalRoot.querySelector('.hub-screen') as HTMLElement | null;
      if (nextHubEl) nextHubEl.scrollTop = prevScrollTop;
    }
  }

  private syncCoopLobbyNetBadge(): void {
    const pill = this.modalRoot.querySelector('.coop-net-pill') as HTMLElement | null;
    if (!pill) return;
    pill.classList.toggle('is-p2p', CoopManager.hasDirectP2P());
    pill.textContent = CoopManager.getNetStatusLabel();
  }

  private buildCoopTabBadgeHtml(): string {
    if (CoopManager.lobby && CoopManager.role !== 'offline') {
      return ` (${CoopManager.lobby.members.length}/4)`;
    }
    const openCount = CoopManager.getPublicRooms().length;
    if (openCount > 0) {
      return `<span class="hall-nav-badge">${I18n.t('hallTabRoomsUnit', { n: openCount })}</span>`;
    }
    return '';
  }

  private syncCoopTabHallBadge(): void {
    const badgeEl = this.modalRoot.querySelector('#hub-coop-tab-badge') as HTMLElement | null;
    if (badgeEl) {
      badgeEl.innerHTML = this.buildCoopTabBadgeHtml();
    }
  }

  private getStageHallSprite(stageId: string): string {
    const map: Record<string, string> = {
      stage_police: './assets/prop_police_car.png',
      stage_mall: './assets/prop_arcade.png',
      stage_lab: './assets/prop_cryo_pod.png',
      stage_hospital: './assets/prop_ambulance.png',
      stage_harbor: './assets/prop_container.png',
      stage_subway: './assets/prop_subway_car.png',
      stage_airbase: './assets/prop_military_truck.png',
      stage_bunker: './assets/prop_missile_pod.png',
    };
    return map[stageId] || './assets/prop_police_car.png';
  }

  private buildInRoomOtherHallHtml(): string {
    const lobby = CoopManager.lobby;
    if (!lobby || CoopManager.role !== 'host' || lobby.members.length !== 1 || lobby.inGame) {
      return '';
    }
    const otherRooms = CoopManager.getPublicRooms();
    if (otherRooms.length === 0) return '';
    return `
      <div class="inroom-other-hall-alert">
        <span>${I18n.t('hallOtherRoomsBanner', { n: otherRooms.length })}</span>
        <button type="button" class="btn-cartoon btn-mini btn-yellow" id="btn-switch-to-hall">${I18n.t('hallSwitchToHallBtn')}</button>
      </div>
    `;
  }

  private buildHallFilterBarHtml(allRooms = CoopManager.getPublicRooms()): string {
    const waitCount = allRooms.filter((r) => !r.inGame).length;
    const liveCount = allRooms.filter((r) => r.inGame).length;
    return `
      <div class="hall-filter-pills">
        <button type="button" class="hall-filter-btn ${this.hallFilter === 'all' ? 'active' : ''}" data-hall-filter="all">
          ${I18n.t('hallFilterAll')} <b>${allRooms.length}</b>
        </button>
        <button type="button" class="hall-filter-btn ${this.hallFilter === 'waiting' ? 'active' : ''}" data-hall-filter="waiting">
          ${I18n.t('hallFilterWait')} <b>${waitCount}</b>
        </button>
        <button type="button" class="hall-filter-btn ${this.hallFilter === 'ingame' ? 'active' : ''}" data-hall-filter="ingame">
          ${I18n.t('hallFilterLive')} <b>${liveCount}</b>
        </button>
      </div>
    `;
  }

  private buildPublicRoomsRowsHtml(): string {
    const allRooms = CoopManager.getPublicRooms();
    const rooms =
      this.hallFilter === 'waiting'
        ? allRooms.filter((r) => !r.inGame)
        : this.hallFilter === 'ingame'
          ? allRooms.filter((r) => r.inGame)
          : allRooms;

    if (rooms.length === 0) {
      return `
        <div class="public-hall-empty-card">
          <div class="hall-empty-main">
            <strong>${I18n.t('hallEmptyTitle')}</strong>
            <p>${I18n.t('hallEmptySub')}</p>
          </div>
          <div class="hall-empty-actions">
            <button type="button" class="btn-cartoon btn-mini btn-green" id="btn-hall-empty-create">${I18n.t('hallCreateRoomBtn')}</button>
            <button type="button" class="btn-cartoon btn-mini btn-yellow" id="btn-hall-empty-code">⌨️ ${I18n.t('joinCardTitle')}</button>
          </div>
        </div>
      `;
    }

    return rooms
      .slice(0, 12)
      .map((ad) => {
        const st = STAGES.find((item) => item.id === ad.stageId) || STAGES[0];
        const stName = I18n.stageMeta(st.id, {
          name: st.name,
          subtitle: st.subtitle,
          sector: '',
          diffLabel: '',
          tags: [],
        }).name;
        const stars = DIFFICULTY_TIERS[ad.tier || 1].stars;
        const modeShort =
          ad.mode === 'endless' ? I18n.t('hallModeEndlessShort') : I18n.t('hallModeStandardShort');
        const stBadge = ad.inGame
          ? I18n.t('publicRoomInGame', { w: ad.wave, n: ad.memberCount })
          : I18n.t('publicRoomWaiting', { n: ad.memberCount });
        const hostCls = getAgentClassDef(ad.hostClassId || 'vanguard');
        const stageIcon = this.getStageHallSprite(ad.stageId);
        const seatDots = [0, 1, 2, 3]
          .map((idx) => `<i class="seat-pip ${idx < ad.memberCount ? 'filled' : ''}"></i>`)
          .join('');
        return `
          <div class="public-room-row public-room-card ${ad.inGame ? 'is-live' : 'is-waiting'}">
            <div class="pub-room-thumb">
              <img src="${stageIcon}" alt="" />
              <span class="pub-room-stars">${stars}</span>
            </div>
            <div class="pub-room-meta">
              <div class="pub-room-top">
                <strong class="pub-stage-title">${stName}</strong>
                <span class="pub-mode-chip">${modeShort}</span>
                <span class="pub-code-chip">#${ad.roomCode}</span>
              </div>
              <div class="pub-room-sub">
                <span class="pub-host-chip"><img src="${hostCls.sprite}" width="16" height="16" alt="" /> ${ad.hostName}</span>
                <span class="pub-room-state ${ad.inGame ? 'in-game' : 'waiting'}">${stBadge}</span>
              </div>
            </div>
            <div class="pub-room-cta">
              <div class="pub-seat-pips" title="${ad.memberCount}/4">${seatDots}<span>${ad.memberCount}/4</span></div>
              <button type="button" class="btn-cartoon btn-mini btn-green pub-join-btn" data-pub-join="${ad.roomCode}">
                🚀 ${I18n.t('publicJoinBtn')}
              </button>
            </div>
          </div>
        `;
      })
      .join('');
  }

  private syncPublicRoomsInHub(): void {
    const allRooms = CoopManager.getPublicRooms();
    const onlinePill = this.modalRoot.querySelector('#hall-online-pill') as HTMLElement | null;
    if (onlinePill) {
      onlinePill.textContent = I18n.t('hallOnlineCount', { n: allRooms.length });
      onlinePill.classList.toggle('has-rooms', allRooms.length > 0);
    }
    const filterWrap = this.modalRoot.querySelector('#hall-filter-wrap') as HTMLElement | null;
    if (filterWrap) {
      filterWrap.innerHTML = this.buildHallFilterBarHtml(allRooms);
      this.bindHallFilterButtons();
    }
    const listBody = this.modalRoot.querySelector('#coop-public-rooms-body') as HTMLElement | null;
    if (listBody) {
      listBody.innerHTML = this.buildPublicRoomsRowsHtml();
      this.bindPublicRoomJoinButtons();
    }
    const inRoomBar = this.modalRoot.querySelector('#inroom-other-hall-bar') as HTMLElement | null;
    if (inRoomBar) {
      inRoomBar.innerHTML = this.buildInRoomOtherHallHtml();
      const swBtn = inRoomBar.querySelector('#btn-switch-to-hall') as HTMLButtonElement | null;
      if (swBtn) {
        this.bindModalTap(swBtn, () => {
          this.coopToast = '';
          CoopManager.disconnect();
        });
      }
    }
  }

  private bindHallFilterButtons(): void {
    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-hall-filter]').forEach((btn) => {
      this.bindModalTap(btn, () => {
        this.hallFilter = (btn.dataset.hallFilter as 'all' | 'waiting' | 'ingame') || 'all';
        SoundFX.xp();
        this.syncPublicRoomsInHub();
      });
    });
  }

  private bindPublicRoomJoinButtons(): void {
    const callInp = this.modalRoot.querySelector('#coop-callsign-inp') as HTMLInputElement | null;
    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-pub-join]').forEach((btn) => {
      this.bindModalTap(btn, () => {
        const rc = btn.dataset.pubJoin || '';
        if (!rc) return;
        if (callInp && callInp.value.trim()) {
          CoopManager.setCallsign(callInp.value);
        }
        this.coopToast = '';
        SoundFX.reloadDone();
        CoopManager.joinRoomByCode(rc);
      });
    });
    const emptyCreateBtn = this.modalRoot.querySelector('#btn-hall-empty-create') as HTMLButtonElement | null;
    if (emptyCreateBtn) {
      this.bindModalTap(emptyCreateBtn, () => {
        if (callInp) CoopManager.setCallsign(callInp.value);
        this.coopToast = '';
        CoopManager.createHostRoom(STAGES[0].id, this.selectedMode, true);
      });
    }
    const emptyCodeBtn = this.modalRoot.querySelector('#btn-hall-empty-code') as HTMLButtonElement | null;
    if (emptyCodeBtn) {
      this.bindModalTap(emptyCodeBtn, () => {
        this.openRoomCodeKeypadModal();
      });
    }
  }

  private openInstallAppGuide(): void {
    const hub = this.modalRoot.querySelector('.hub-screen') as HTMLElement | null;
    if (!hub) return;
    hub.querySelector('#install-guide-overlay')?.remove();

    const plat = PlatformSDK.getInstallGuidePlatform();
    const step1 =
      plat === 'wechat'
        ? I18n.t('installWechatStep1')
        : plat === 'ios'
          ? I18n.t('installIosStep1')
          : plat === 'android'
            ? I18n.t('installAndroidStep1')
            : I18n.t('installDesktopStep1');
    const step2 =
      plat === 'wechat'
        ? I18n.t('installWechatStep2')
        : plat === 'ios'
          ? I18n.t('installIosStep2')
          : plat === 'android'
            ? I18n.t('installAndroidStep2')
            : I18n.t('installDesktopStep2');

    const overlay = document.createElement('div');
    overlay.id = 'install-guide-overlay';
    overlay.className = 'install-guide-overlay';
    overlay.innerHTML = `
      <div class="install-guide-card">
        <div class="install-guide-top">
          <div class="install-icon-preview">
            <img src="./assets/app_icon_ui.png" width="58" height="58" alt="" />
            <span>${I18n.isZh() ? '僵尸防线' : 'Zombie Def'}</span>
          </div>
          <div class="install-guide-head">
            <span class="install-badge-pill">${I18n.t('installBadgeTag')}</span>
            <h3>${I18n.t('installModalTitle')}</h3>
            <p>${I18n.t('installModalSub')}</p>
          </div>
        </div>
        <div class="install-steps-box">
          <div class="install-step-item">${step1}</div>
          <div class="install-step-item">${step2}</div>
        </div>
        <div class="install-guide-actions">
          ${PlatformSDK.hasNativeInstallPrompt() ? `<button class="btn-cartoon btn-mini btn-yellow" id="btn-install-native" type="button">${I18n.isZh() ? '⚡ 系统直接安装' : '⚡ Install Now'}</button>` : ''}
          <button class="btn-cartoon btn-mini btn-blue" id="btn-install-copy-url" type="button">${I18n.t('installCopyUrlBtn')}</button>
          <button class="btn-cartoon btn-mini btn-green" id="btn-install-close" type="button">${I18n.t('installGotItBtn')}</button>
        </div>
      </div>
    `;
    const openedAt = performance.now();
    hub.appendChild(overlay);

    overlay.onclick = (e) => {
      if (e.target === overlay && performance.now() - openedAt > 380) {
        overlay.remove();
      }
    };
    const closeBtn = overlay.querySelector('#btn-install-close') as HTMLButtonElement;
    this.bindModalTap(closeBtn, () => overlay.remove());

    const nativeBtn = overlay.querySelector('#btn-install-native') as HTMLButtonElement | null;
    if (nativeBtn) {
      this.bindModalTap(nativeBtn, async () => {
        const out = await PlatformSDK.triggerNativeInstallPrompt();
        if (out === 'accepted') {
          SoundFX.fanfare();
          overlay.remove();
        }
      });
    }

    const copyUrlBtn = overlay.querySelector('#btn-install-copy-url') as HTMLButtonElement;
    this.bindModalTap(copyUrlBtn, async () => {
      const cleanUrl = `${window.location.origin}${window.location.pathname}`;
      try {
        await navigator.clipboard.writeText(cleanUrl);
        copyUrlBtn.textContent = I18n.t('installUrlCopied');
      } catch {
        copyUrlBtn.textContent = cleanUrl;
      }
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
      const starsEarned = SaveManager.getStageStars(st.id);
      const tierUnlocked = unlocked && SaveManager.isTierUnlocked(st.id, this.selectedTier);
      const eco = getStageEcology(st.id);
      const ecoTag = I18n.isZh() ? eco.zhEcologyTag : eco.enEcologyTag;
      const bestWave = save.endlessBestWave[st.id] || 0;
      const starDisplay =
        starsEarned > 0 ? '★'.repeat(starsEarned) + '☆'.repeat(Math.max(0, 3 - starsEarned)) : '';
      const statusText = !unlocked
        ? I18n.t('stageLockedBadge')
        : this.selectedMode === 'standard'
          ? starsEarned > 0
            ? `${starDisplay} ${I18n.t('stageCleared')}`
            : locMeta.diffLabel
          : bestWave > 0
            ? I18n.t('stageEndlessBest', { w: bestWave })
            : I18n.t('stageEndlessTry');

      const spritesHtml = baseMeta.sprites
        .map((sp, sIdx) => `<img class="stage-vis-sp sp-${sIdx}" src="./assets/${sp}.png" alt="" />`)
        .join('');

      const tagsHtml = `<span class="stage-tag eco-tag">${ecoTag}</span>` +
        locMeta.tags.slice(0, 2).map((tag) => `<span class="stage-tag">${tag}</span>`).join('');
      const prevTierMeta = getDifficultyMeta((Math.max(1, this.selectedTier - 1)) as DifficultyTier);
      const btnClass = !tierUnlocked
        ? 'btn-disabled'
        : this.selectedTier === 3
          ? 'btn-purple'
          : this.selectedTier === 2
            ? 'btn-yellow'
            : this.selectedMode === 'standard'
              ? 'btn-green'
              : 'btn-purple';
      const tierBadgePrefix = this.selectedTier > 1 ? `${getDifficultyMeta(this.selectedTier).stars} ` : '';
      const btnLabel = !unlocked
        ? I18n.t('stageLockedBtn', { n: idx })
        : !tierUnlocked
          ? I18n.t('tierNeedPrev', { prev: I18n.isZh() ? prevTierMeta.zhName : prevTierMeta.enName })
          : this.selectedMode === 'standard'
            ? `${tierBadgePrefix}${I18n.t('deployStandard')}`
            : `${tierBadgePrefix}${I18n.t('deployEndless')}`;

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
            <div class="stage-card-actions">
              <button class="btn-cartoon ${btnClass} stage-go-btn" data-stage-go="${st.id}" ${!tierUnlocked ? 'disabled' : ''}>
                ${btnLabel}
              </button>
              ${
                unlocked
                  ? `<button class="btn-cartoon btn-blue stage-coop-host-btn" type="button" data-stage-coop-host="${st.id}">${I18n.t('stageCoopHostBtn')}</button>`
                  : ''
              }
            </div>
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
            <span class="hero-stat-chip">${I18n.t('starsStat', { cur: SaveManager.getTotalStars(), max: STAGES.length * 3 })}</span>
            <span class="hero-stat-chip">${I18n.t('bestEndlessStat', { wave: endlessRecordStr })}</span>
          </div>

          <div class="hero-mode-box">
            <div class="seg-group">
              <button class="seg-btn ${this.selectedMode === 'standard' ? 'active' : ''}" data-mode-pick="standard">${I18n.t('modeStandard')}</button>
              <button class="seg-btn ${this.selectedMode === 'endless' ? 'active' : ''}" data-mode-pick="endless">${I18n.t('modeEndless')}</button>
            </div>
            <div class="seg-group tier-seg-group">
              ${([1, 2, 3] as DifficultyTier[])
                .map((t) => {
                  const tm = DIFFICULTY_TIERS[t];
                  return `<button class="seg-btn tier-btn-${t} ${this.selectedTier === t ? 'active' : ''}" data-tier-pick="${t}">${I18n.isZh() ? tm.zhName : tm.enName}</button>`;
                })
                .join('')}
            </div>
            <div class="seg-group bot-seg-group">
              ${([0, 1, 2, 3] as const)
                .map((bc) => {
                  const curBots = SaveManager.getAiSquadCount();
                  const lblKey = bc === 0 ? 'botSolo' : bc === 1 ? 'botSquad1' : bc === 2 ? 'botSquad2' : 'botSquad3';
                  return `<button class="seg-btn ${curBots === bc ? 'active' : ''}" data-bot-pick="${bc}">${I18n.t(lblKey)}</button>`;
                })
                .join('')}
            </div>
            <button class="btn-cartoon btn-mini btn-blue" id="btn-hub-tutorial" type="button">${I18n.t('tutReplayBtn')}</button>
            <span class="hero-mode-desc">${this.selectedTier > 1 ? (I18n.isZh() ? DIFFICULTY_TIERS[this.selectedTier].zhRule : DIFFICULTY_TIERS[this.selectedTier].enRule) : modeDesc}</span>
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

    const subNavHtml = `
      <div class="upg-subnav-bar">
        <div class="seg-group dark">
          <button class="seg-btn ${this.upgSubTab === 'core' ? 'active' : ''}" data-upg-sub="core">${I18n.t('upgSubCore')}</button>
          <button class="seg-btn ${this.upgSubTab === 'mastery' ? 'active' : ''}" data-upg-sub="mastery">${I18n.t('upgSubMastery')}</button>
          <button class="seg-btn ${this.upgSubTab === 'endgame' ? 'active' : ''}" data-upg-sub="endgame">${I18n.t('upgSubEndgame')}</button>
        </div>
        <span class="core-wallet-hint">💠 ${save.techCores || 0} · ⭐ ${SaveManager.getTotalStars()}/${STAGES.length * 3}</span>
      </div>
    `;

    let subBodyHtml = '';
    if (this.upgSubTab === 'mastery') {
      subBodyHtml = this.buildWeaponMasterySubView(save);
    } else if (this.upgSubTab === 'endgame') {
      subBodyHtml = this.buildChipsAndParagonSubView(save);
    } else {
      subBodyHtml = `
        <div class="hub-sec-heading">${I18n.t('classSecTitle')}</div>
        <div class="class-spec-grid">${classesHtml}</div>

        <div class="hub-sec-heading">${I18n.t('upgSecTitle')}</div>
        <div class="upgrade-list">${upgradesHtml}</div>
      `;
    }

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

      ${subNavHtml}
      ${subBodyHtml}
    `;
  }

  private buildWeaponMasterySubView(save: ReturnType<typeof SaveManager.get>): string {
    const cardsHtml = WEAPON_LIST.map((w) => {
      const rank = save.weaponMastery[w.id] || 0;
      const kills = save.weaponKills[w.id] || 0;
      const isMax = rank >= WEAPON_MASTERY_MAX;
      const cost = getWeaponMasteryCost(rank);
      const canBuy = !isMax && save.gold >= cost.gold && (save.techCores || 0) >= cost.cores;
      const bonus = getWeaponMasteryBonuses(rank);
      const starsStr = '★'.repeat(rank) + '☆'.repeat(WEAPON_MASTERY_MAX - rank);
      const dmgPct = Math.round((bonus.damageMult - 1) * 100);
      const capPct = Math.round((bonus.capacityMult - 1) * 100);
      const bonusLine = I18n.t('masteryBonusLine', {
        dmg: dmgPct,
        cap: capPct,
        extra: rank >= 3 ? I18n.t('masteryExtra3') : '',
      });
      const awakenText = getWeaponAwakeningDesc(w.id);
      const costStr = isMax
        ? I18n.t('masteryAwakened')
        : `<img class="inline-coin" src="./assets/ui_coin.png" alt="" /> ${cost.gold}${cost.cores > 0 ? ` + 💠${cost.cores}` : ''} · ${I18n.t('masteryUpgradeBtn', { next: rank + 1 })}`;

      return `
        <div class="mastery-gun-card ${isMax ? 'golden-awakened' : ''}">
          <div class="mastery-card-top">
            <div class="mastery-gun-box">
              <img src="./assets/gun_${w.id}.png" alt="" />
            </div>
            <div class="mastery-gun-meta">
              <div class="mastery-name-row">
                <strong>${I18n.wName(w.id, w.name)}</strong>
                <span class="mastery-kills">${I18n.t('masteryKills', { k: kills })}</span>
              </div>
              <div class="mastery-stars-row">
                <span class="mastery-stars">${starsStr}</span>
                <small>⚡${I18n.wSuperName(w.id, w.superName)}</small>
              </div>
            </div>
          </div>
          <div class="mastery-stat-line">${bonusLine}</div>
          <div class="mastery-awaken-box ${isMax ? 'unlocked' : ''}">${awakenText}</div>
          <button class="btn-cartoon btn-mini ${isMax ? 'btn-yellow' : canBuy ? 'btn-green' : 'btn-disabled'}" data-gun-mastery="${w.id}" ${isMax || !canBuy ? 'disabled' : ''}>
            ${costStr}
          </button>
        </div>
      `;
    }).join('');

    return `
      <div class="hub-sec-heading">${I18n.t('masterySecTitle')}</div>
      <div class="mastery-gun-grid">${cardsHtml}</div>
    `;
  }

  private buildChipsAndParagonSubView(save: ReturnType<typeof SaveManager.get>): string {
    const canForgeCore = save.gold >= 420;
    const equippedCount = save.equippedChips.length;

    const chipsHtml = TACTICAL_CHIPS.map((c) => {
      const lv = save.chipLevels[c.id] || 0;
      const isEquipped = save.equippedChips.includes(c.id);
      const isMax = lv >= CHIP_MAX_LEVEL;
      const cost = getChipUpgradeCost(c, lv);
      const canUpg = !isMax && save.gold >= cost.gold && (save.techCores || 0) >= cost.cores;
      const cName = I18n.isZh() ? c.zhName : c.enName;
      const cDesc = I18n.isZh() ? c.zhDesc(Math.max(1, lv)) : c.enDesc(Math.max(1, lv));

      const upgLabel = isMax
        ? I18n.t('chipMaxBtn')
        : `<img class="inline-coin" src="./assets/ui_coin.png" alt="" /> ${cost.gold}${cost.cores > 0 ? ` + 💠${cost.cores}` : ''} · ${lv === 0 ? I18n.t('chipCraftBtn') : I18n.t('chipUpgBtn', { next: lv + 1 })}`;

      const equipBtnHtml =
        lv > 0
          ? `<button class="btn-cartoon btn-mini ${isEquipped ? 'btn-green' : equippedCount >= MAX_EQUIPPED_CHIPS ? 'btn-disabled' : 'btn-blue'}" data-chip-equip="${c.id}" ${!isEquipped && equippedCount >= MAX_EQUIPPED_CHIPS ? 'disabled' : ''}>
              ${isEquipped ? I18n.t('chipUnequipBtn') : equippedCount >= MAX_EQUIPPED_CHIPS ? I18n.t('chipSlotsFull') : I18n.t('chipEquipBtn')}
            </button>`
          : '';

      return `
        <div class="chip-mod-card ${isEquipped ? 'equipped' : ''} ${lv === 0 ? 'locked' : ''}" style="--chip-color:${c.color}">
          <div class="chip-mod-top">
            <div class="chip-ico-box"><img src="${c.sprite}" alt="" /></div>
            <div class="chip-mod-title">
              <strong>${cName}</strong>
              <span class="chip-lv-tag">${lv > 0 ? `Lv.${lv}/${CHIP_MAX_LEVEL}` : I18n.t('chipLocked')}</span>
            </div>
          </div>
          <p class="chip-mod-desc">${cDesc}</p>
          <div class="chip-mod-actions">
            ${equipBtnHtml}
            <button class="btn-cartoon btn-mini ${isMax ? 'btn-gray' : canUpg ? 'btn-yellow' : 'btn-disabled'}" data-chip-upg="${c.id}" ${isMax || !canUpg ? 'disabled' : ''}>
              ${upgLabel}
            </button>
          </div>
        </div>
      `;
    }).join('');

    const paragonHtml = PARAGON_TRACKS.map((pt) => {
      const lv = save.paragon[pt.key] || 0;
      const cost = getParagonCost(lv);
      const canBuy = save.gold >= cost;
      const pName = I18n.isZh() ? pt.zhName : pt.enName;
      const pVal = I18n.isZh() ? pt.zhVal(lv) : pt.enVal(lv);
      return `
        <div class="paragon-card" style="--par-color:${pt.color}">
          <div class="paragon-top">
            <img src="${pt.sprite}" alt="" />
            <div>
              <strong>${pName} <small>Lv.${lv}</small></strong>
              <div class="paragon-val">${pVal}</div>
            </div>
          </div>
          <button class="btn-cartoon btn-mini ${canBuy ? 'btn-purple' : 'btn-disabled'}" data-paragon-buy="${pt.key}" ${!canBuy ? 'disabled' : ''}>
            <img class="inline-coin" src="./assets/ui_coin.png" alt="" /> ${cost} · ${I18n.t('paragonBuyBtn', { next: lv + 1 })}
          </button>
        </div>
      `;
    }).join('');

    return `
      <div class="chip-top-forge-bar">
        <strong>${I18n.t('chipBarTitle', { n: equippedCount })}</strong>
        <button class="btn-cartoon btn-mini ${canForgeCore ? 'btn-blue' : 'btn-disabled'}" id="btn-forge-core" ${!canForgeCore ? 'disabled' : ''}>
          ${I18n.t('forgeCoreBtn')}
        </button>
      </div>

      <div class="hub-sec-heading">${I18n.t('chipSecTitle')}</div>
      <div class="chip-mod-grid">${chipsHtml}</div>

      <div class="hub-sec-heading">${I18n.t('paragonSecTitle')}</div>
      <div class="paragon-grid">${paragonHtml}</div>
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
          <input id="coop-callsign-inp" class="coop-inp callsign-inp" type="text" maxlength="10" enterkeyhint="done" value="${callsign}" placeholder="${I18n.t('callsignPlaceholder')}" />
          <button class="btn-cartoon btn-mini btn-gray" id="btn-rand-callsign" type="button" title="Random Callsign">${I18n.t('randCallsignBtn')}</button>
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
      CoopManager.ensurePublicDirectoryActive();
      const currentDraft = (this.coopCodeDraft || CoopManager.lastJoinCode || '').toUpperCase().slice(0, 5);
      const allRooms = CoopManager.getPublicRooms();
      return `
        <div class="coop-wrap">
          <div class="coop-top-strip">
            <div class="coop-callsign-left">
              <span>${I18n.t('callsignLabel')}</span>
              <input id="coop-callsign-inp" class="coop-inp callsign-inp" type="text" maxlength="10" enterkeyhint="done" value="${callsign}" placeholder="${I18n.t('callsignPlaceholder')}" />
              <button class="btn-cartoon btn-mini btn-gray" id="btn-rand-callsign" type="button" title="Random Callsign">${I18n.t('randCallsignBtn')}</button>
              <button class="btn-cartoon btn-mini btn-blue" id="btn-save-callsign" type="button">${I18n.t('saveCallsign')}</button>
            </div>
            <div class="coop-code-mini-bar">
              <button type="button" id="coop-code-inp" class="coop-inp code-inp code-trigger-btn ${currentDraft ? 'has-val' : ''}" data-code="${currentDraft}" ${status === 'connecting' ? 'disabled' : ''}>
                <span class="code-trigger-val">${currentDraft || I18n.t('codeTapPlaceholder')}</span>
                <span class="code-trigger-kbd">⌨️</span>
              </button>
              <button type="button" class="btn-cartoon btn-mini btn-blue coop-paste-quick-btn" id="btn-coop-paste-join" ${status === 'connecting' ? 'disabled' : ''}>
                ${I18n.t('pasteCodeQuickBtn')}
              </button>
              <button type="button" class="btn-cartoon btn-mini btn-yellow" id="btn-coop-join" ${status === 'connecting' ? 'disabled' : ''}>
                ${I18n.t('joinRoomBtn')}
              </button>
            </div>
          </div>
          ${statusBanner}
          <div class="public-hall-box is-hero-hall" id="coop-public-rooms-box">
            <div class="public-hall-head">
              <div class="public-hall-title-group">
                <strong>${I18n.t('hallPanelTitle')}</strong>
                <span class="hall-online-pill ${allRooms.length > 0 ? 'has-rooms' : ''}" id="hall-online-pill">${I18n.t('hallOnlineCount', { n: allRooms.length })}</span>
                <div id="hall-filter-wrap">${this.buildHallFilterBarHtml(allRooms)}</div>
              </div>
              <div class="public-hall-actions">
                <button class="btn-cartoon btn-mini btn-gray" id="btn-hall-refresh" type="button" ${status === 'connecting' ? 'disabled' : ''}>
                  ${I18n.t('hallRefreshBtn')}
                </button>
                <button class="btn-cartoon btn-mini btn-yellow" id="btn-coop-quick-match" type="button" ${status === 'connecting' ? 'disabled' : ''}>
                  ${I18n.t('quickMatchBtn')}
                </button>
                <button class="btn-cartoon btn-mini btn-green" id="btn-coop-create" type="button" ${status === 'connecting' ? 'disabled' : ''}>
                  ${I18n.t('hallCreateRoomBtn')}
                </button>
              </div>
            </div>
            <div class="public-hall-list" id="coop-public-rooms-body">
              ${this.buildPublicRoomsRowsHtml()}
            </div>
          </div>
          ${rulesStrip}
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
    const hostSave = SaveManager.get();

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
      const memCls = getAgentClassDef(mem.classId || (mem.peerId === CoopManager.myPeerId ? hostSave.selectedClass : 'vanguard'));
      const clsTxt = getLocalizedClassText(memCls);
      return `
        <div class="coop-slot-card filled" style="border-color:${sl.color}">
          <div class="slot-head">
            <span class="slot-badge" style="background:${sl.badgeBg}">${slotTitle}</span>
            <span class="slot-ready ${mem.ready ? 'ok' : ''}">${mem.isHost ? I18n.t('hostBadge') : mem.ready ? I18n.t('readyYes') : I18n.t('readyNo')}</span>
          </div>
          <div class="slot-player">
            <img src="${memCls.sprite}" alt="" />
            <div class="slot-player-meta">
              <strong>${mem.callsign}${mem.peerId === CoopManager.myPeerId ? I18n.t('meSuffix') : ''}</strong>
              <small style="color:${memCls.color}">${clsTxt.name}</small>
            </div>
          </div>
        </div>
      `;
    }).join('');

    const lobbyClassBarHtml = `
      <div class="lobby-class-bar">
        <span class="lobby-cls-lbl">${I18n.t('lobbyClassSwitchTip')}</span>
        <div class="lobby-cls-pills">
          ${AGENT_CLASSES.map((cls) => {
            const owned = hostSave.unlockedClasses.includes(cls.id);
            const active = hostSave.selectedClass === cls.id;
            const cTxt = getLocalizedClassText(cls);
            return `
              <button type="button" class="lobby-cls-pill ${active ? 'active' : ''} ${!owned ? 'locked' : ''}" data-class-pick="${cls.id}">
                <img src="${cls.sprite}" width="18" height="18" alt="" />
                <span>${cTxt.name}${!owned ? ` ($${cls.unlockCost})` : ''}</span>
              </button>
            `;
          }).join('')}
        </div>
      </div>
    `;
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

    const lobbyTier: DifficultyTier = lobby.tier || 1;
    const lobbyTierMeta = getDifficultyMeta(lobbyTier);
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
          <div class="seg-group dark">
            ${([1, 2, 3] as DifficultyTier[])
              .map((t) => `<button class="seg-btn ${lobbyTier === t ? 'active' : ''}" data-coop-tier="${t}">${DIFFICULTY_TIERS[t].stars}</button>`)
              .join('')}
          </div>
          <button class="btn-cartoon btn-green coop-launch-btn" id="btn-coop-launch">
            ${memberCount >= 2 ? I18n.t('launchSquadBtn', { n: memberCount }) : I18n.t('launchSoloRoomBtn', { n: memberCount })}
          </button>
        </div>
      `
      : `
        <div class="coop-stage-Controls">
          <div class="coop-client-stage-info">
            ${I18n.t('hostPickedLabel')} <strong>${selectedStageTitle}</strong> · <span>${I18n.isZh() ? lobbyTierMeta.zhName : lobbyTierMeta.enName} · ${lobby.mode === 'standard' ? I18n.t('modeStandard') : I18n.t('modeEndless')}</span>
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
      <div class="coop-wrap in-room">
        ${callsignBar}
        ${statusBanner}
        <div id="inroom-other-hall-bar">${this.buildInRoomOtherHallHtml()}</div>

        <div class="coop-lobby-box">
          <div class="coop-lobby-head">
            <div class="room-code-block">
              <span class="rc-label">${I18n.t('roomCodeLabel')}</span>
              <strong class="rc-val">${lobby.roomCode}</strong>
              <button class="btn-cartoon btn-mini btn-yellow" id="btn-copy-code" type="button">${I18n.t('copyCodeBtn')}</button>
              <button class="btn-cartoon btn-mini btn-blue" id="btn-copy-link" type="button">${I18n.t('copyLinkBtn')}</button>
              ${
                isHost
                  ? `<button class="btn-cartoon btn-mini ${lobby.isPublic !== false ? 'btn-green' : 'btn-gray'}" id="btn-coop-public-toggle" type="button">${lobby.isPublic !== false ? I18n.t('roomPublicOn') : I18n.t('roomPrivateOn')}</button>`
                  : ''
              }
              <span class="coop-net-pill ${CoopManager.hasDirectP2P() ? 'is-p2p' : ''}">${CoopManager.getNetStatusLabel()}</span>
            </div>
            <button class="btn-cartoon btn-mini btn-gray" id="btn-coop-leave" type="button">${I18n.t('hallBackBtn')}</button>
          </div>

          <div class="coop-slots-grid">${slotsHtml}</div>

          ${lobbyClassBarHtml}

          <div class="coop-scale-banner">⚖️ ${scaleInfo} · <span class="coop-midjoin-note">${I18n.t('coopMidJoinTip')}</span></div>

          ${hostControls}
        </div>
      </div>
    `;
  }

  private extractRoomCodeFromText(raw: string): string {
    if (!raw) return '';
    const urlParam = raw.match(/[?&](?:room|roomId)=([A-Za-z0-9]{4,6})/i);
    if (urlParam && urlParam[1]) {
      return urlParam[1].toUpperCase().slice(0, 5);
    }
    const stripped = raw.replace(/https?:\/\/\S+/gi, ' ');
    const strictToken = stripped.match(/(?:^|[^A-Za-z0-9])([2-9A-HJ-NP-Z]{5})(?:$|[^A-Za-z0-9])/i);
    if (strictToken && strictToken[1]) {
      return strictToken[1].toUpperCase();
    }
    const looseToken = stripped.match(/(?:^|[^A-Za-z0-9])([A-Za-z0-9]{5})(?:$|[^A-Za-z0-9])/);
    if (looseToken && looseToken[1]) {
      return looseToken[1].toUpperCase();
    }
    const cleaned = stripped.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return cleaned.length >= 4 && cleaned.length <= 6 ? cleaned.slice(0, 5) : '';
  }

  private generateRandomCallsign(): string {
    const zhPool = [
      '幽灵猎手',
      '雷霆突击',
      '铁血先锋',
      '暗影狙神',
      '赤焰战神',
      '极光特警',
      '零号王牌',
      '风暴重装',
      '苍穹飞鹰',
      '破阵狂龙',
    ];
    const enPool = [
      'Ghost-07',
      'Viper-X',
      'Titan-09',
      'Apex-01',
      'Falcon-5',
      'Shadow-K',
      'Blaze-88',
      'Raptor-3',
    ];
    const pool = I18n.isZh() ? zhPool : enPool;
    const base = pool[Math.floor(Math.random() * pool.length)];
    return I18n.isZh() ? `${base}${Math.floor(10 + Math.random() * 89)}` : base;
  }

  private syncCodeTriggerDisplay(): void {
    const triggerBtn = this.modalRoot.querySelector('#coop-code-inp') as HTMLButtonElement | null;
    if (!triggerBtn) return;
    const draft = (this.coopCodeDraft || '').toUpperCase().slice(0, 5);
    triggerBtn.dataset.code = draft;
    triggerBtn.classList.toggle('has-val', draft.length > 0);
    const valSpan = triggerBtn.querySelector('.code-trigger-val');
    if (valSpan) {
      valSpan.textContent = draft || I18n.t('codeTapPlaceholder');
    }
  }

  private openRoomCodeKeypadModal(initialNotice = ''): void {
    this.cleanupKeypadModal?.();
    const hub = (this.modalRoot.querySelector('.hub-screen') as HTMLElement | null) || this.modalRoot;
    hub.querySelector('#room-code-keypad-overlay')?.remove();

    let draft = (this.coopCodeDraft || CoopManager.lastJoinCode || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 5);
    this.coopCodeDraft = draft;

    const keypadKeys = [
      '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C',
      'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P',
      'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '⌫',
    ];

    const keysHtml = keypadKeys
      .map((k) => {
        const isBack = k === '⌫';
        const isDigit = k >= '2' && k <= '9';
        const cls = isBack ? 'is-backspace' : isDigit ? 'is-digit' : '';
        return `<button type="button" class="code-key-btn ${cls}" data-k="${k}">${k}</button>`;
      })
      .join('');

    const overlay = document.createElement('div');
    overlay.id = 'room-code-keypad-overlay';
    overlay.className = 'code-keypad-overlay';
    overlay.innerHTML = `
      <div class="code-keypad-card" role="dialog" aria-modal="true">
        <div class="code-keypad-head">
          <div class="code-keypad-titles">
            <strong>${I18n.t('keypadModalTitle')}</strong>
            <span id="keypad-sub-hint">${initialNotice || I18n.t('keypadModalHint')}</span>
          </div>
          <button type="button" class="code-keypad-close" id="btn-keypad-close" aria-label="Close">✕</button>
        </div>

        <div class="code-keypad-bar">
          <div class="code-slots-row" id="keypad-slots-row">
            ${[0, 1, 2, 3, 4]
              .map((idx) => `<span class="code-char-slot" data-slot-idx="${idx}"></span>`)
              .join('')}
          </div>
          <div class="code-keypad-actions">
            <button type="button" class="btn-cartoon btn-mini btn-blue" id="btn-keypad-paste">${I18n.t('keypadPasteBtn')}</button>
            <button type="button" class="btn-cartoon btn-mini btn-gray" id="btn-keypad-clear">${I18n.t('keypadClearBtn')}</button>
            <button type="button" class="btn-cartoon btn-mini btn-yellow" id="btn-keypad-join">${I18n.t('keypadJoinBtn')}</button>
          </div>
        </div>

        <div class="code-key-grid">
          ${keysHtml}
        </div>
      </div>
    `;

    const openedAt = performance.now();
    hub.appendChild(overlay);

    const slotEls = Array.from(overlay.querySelectorAll<HTMLElement>('.code-char-slot'));
    const joinBtn = overlay.querySelector('#btn-keypad-join') as HTMLButtonElement;
    const clearBtn = overlay.querySelector('#btn-keypad-clear') as HTMLButtonElement;
    const pasteBtn = overlay.querySelector('#btn-keypad-paste') as HTMLButtonElement;
    const closeBtn = overlay.querySelector('#btn-keypad-close') as HTMLButtonElement;
    const subHint = overlay.querySelector('#keypad-sub-hint') as HTMLElement;

    const refreshSlotsUI = () => {
      this.coopCodeDraft = draft;
      this.syncCodeTriggerDisplay();
      const activeIdx = Math.min(4, draft.length);
      slotEls.forEach((el, idx) => {
        const ch = draft[idx] || '';
        el.textContent = ch || '·';
        el.classList.toggle('filled', ch.length > 0);
        el.classList.toggle('active-cursor', draft.length < 5 && idx === activeIdx);
      });
      const ready = draft.length >= 4;
      joinBtn.disabled = !ready;
      joinBtn.classList.toggle('btn-green', ready);
      joinBtn.classList.toggle('btn-yellow', !ready);
      joinBtn.classList.toggle('is-ready-pulse', draft.length === 5);
      clearBtn.disabled = draft.length === 0;
    };

    const submitJoin = () => {
      if (draft.length < 4) {
        SoundFX.emptyClip();
        return;
      }
      const callInp = this.modalRoot.querySelector('#coop-callsign-inp') as HTMLInputElement | null;
      if (callInp && callInp.value.trim()) {
        CoopManager.setCallsign(callInp.value);
      }
      const targetCode = draft;
      closeModal();
      this.coopToast = '';
      SoundFX.reloadDone();
      CoopManager.joinRoomByCode(targetCode);
    };

    const handleCharInput = (ch: string) => {
      if (ch === '⌫') {
        if (draft.length > 0) {
          draft = draft.slice(0, -1);
          SoundFX.xp();
          refreshSlotsUI();
        }
        return;
      }
      const clean = ch.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!clean) return;
      if (draft.length >= 5) {
        // 已满 5 位时继续按键则覆盖最后一位，方便手滑秒改
        draft = draft.slice(0, 4) + clean[0];
      } else {
        draft += clean[0];
      }
      if (draft.length === 5) {
        SoundFX.reloadDone();
      } else {
        SoundFX.xp();
      }
      refreshSlotsUI();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        submitJoin();
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        handleCharInput('⌫');
        return;
      }
      if (/^[a-zA-Z0-9]$/.test(e.key)) {
        e.preventDefault();
        handleCharInput(e.key);
      }
    };

    const onWindowPaste = (e: ClipboardEvent) => {
      const txt = e.clipboardData?.getData('text') || '';
      const code = this.extractRoomCodeFromText(txt);
      if (code.length >= 4) {
        e.preventDefault();
        draft = code.slice(0, 5);
        subHint.textContent = I18n.t('keypadPastedToast', { code: draft });
        subHint.classList.add('is-ok');
        SoundFX.reloadDone();
        refreshSlotsUI();
      }
    };

    const closeModal = () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('paste', onWindowPaste);
      if (this.cleanupKeypadModal === closeModal) {
        this.cleanupKeypadModal = null;
      }
      overlay.remove();
    };

    this.cleanupKeypadModal = closeModal;
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('paste', onWindowPaste);

    overlay.onclick = (e) => {
      if (e.target === overlay && performance.now() - openedAt > 380) {
        closeModal();
      }
    };

    this.bindModalTap(closeBtn, () => closeModal());
    this.bindModalTap(clearBtn, () => {
      draft = '';
      SoundFX.xp();
      refreshSlotsUI();
    });
    this.bindModalTap(joinBtn, () => submitJoin());

    this.bindModalTap(pasteBtn, async () => {
      try {
        const txt = await navigator.clipboard.readText();
        const code = this.extractRoomCodeFromText(txt);
        if (code.length >= 4) {
          draft = code.slice(0, 5);
          subHint.textContent = I18n.t('keypadPastedToast', { code: draft });
          subHint.classList.add('is-ok');
          SoundFX.reloadDone();
          refreshSlotsUI();
          return;
        }
      } catch {
        // clipboard read blocked by browser permission
      }
      subHint.textContent = I18n.t('keypadClipboardEmpty');
      subHint.classList.remove('is-ok');
      SoundFX.emptyClip();
    });

    overlay.querySelectorAll<HTMLButtonElement>('.code-key-btn').forEach((keyBtn) => {
      let lastFastPress = -9999;
      const fireKey = () => {
        const k = keyBtn.dataset.k || '';
        if (k) handleCharInput(k);
      };
      keyBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        lastFastPress = performance.now();
        keyBtn.classList.add('is-pressed');
        fireKey();
      });
      const clearPressed = () => keyBtn.classList.remove('is-pressed');
      keyBtn.addEventListener('pointerup', clearPressed);
      keyBtn.addEventListener('pointercancel', clearPressed);
      keyBtn.addEventListener('pointerleave', clearPressed);
      keyBtn.onclick = (e) => {
        if (performance.now() - lastFastPress < 450) {
          e.preventDefault();
          return;
        }
        fireKey();
      };
    });

    refreshSlotsUI();
  }

  private bindCoopHubEvents(): void {
    const saveCallBtn = this.modalRoot.querySelector('#btn-save-callsign') as HTMLButtonElement | null;
    const randCallBtn = this.modalRoot.querySelector('#btn-rand-callsign') as HTMLButtonElement | null;
    const callInp = this.modalRoot.querySelector('#coop-callsign-inp') as HTMLInputElement | null;
    if (randCallBtn && callInp) {
      this.bindModalTap(randCallBtn, () => {
        const nextName = this.generateRandomCallsign();
        callInp.value = nextName;
        CoopManager.setCallsign(nextName);
        SoundFX.xp();
        this.coopToast = I18n.t('callsignSaved', { name: CoopManager.getCallsign() });
        this.showHomeHub();
      });
    }
    if (saveCallBtn && callInp) {
      saveCallBtn.onclick = () => {
        CoopManager.setCallsign(callInp.value);
        this.coopToast = I18n.t('callsignSaved', { name: CoopManager.getCallsign() });
        this.showHomeHub();
      };
    }

    const quickMatchBtn = this.modalRoot.querySelector('#btn-coop-quick-match') as HTMLButtonElement | null;
    if (quickMatchBtn) {
      this.bindModalTap(quickMatchBtn, () => {
        if (callInp) CoopManager.setCallsign(callInp.value);
        this.coopToast = '';
        CoopManager.quickMatchOrCreate(STAGES[0].id, this.selectedMode);
      });
    }

    const pubToggleBtn = this.modalRoot.querySelector('#btn-coop-public-toggle') as HTMLButtonElement | null;
    if (pubToggleBtn) {
      this.bindModalTap(pubToggleBtn, () => {
        CoopManager.toggleHostPublicRoom();
      });
    }

    const hallRefreshBtn = this.modalRoot.querySelector('#btn-hall-refresh') as HTMLButtonElement | null;
    if (hallRefreshBtn) {
      this.bindModalTap(hallRefreshBtn, () => {
        SoundFX.xp();
        CoopManager.refreshPublicDirectory();
        this.coopToast = I18n.t('hallRefreshedToast');
        this.showHomeHub();
      });
    }

    const switchToHallBtn = this.modalRoot.querySelector('#btn-switch-to-hall') as HTMLButtonElement | null;
    if (switchToHallBtn) {
      this.bindModalTap(switchToHallBtn, () => {
        this.coopToast = '';
        CoopManager.disconnect();
      });
    }

    this.bindHallFilterButtons();
    this.bindPublicRoomJoinButtons();

    const createBtn = this.modalRoot.querySelector('#btn-coop-create') as HTMLButtonElement | null;
    if (createBtn) {
      this.bindModalTap(createBtn, () => {
        if (callInp) CoopManager.setCallsign(callInp.value);
        this.coopToast = '';
        CoopManager.createHostRoom(STAGES[0].id, this.selectedMode);
      });
    }

    const codeTriggerBtn = this.modalRoot.querySelector('#coop-code-inp') as HTMLButtonElement | null;
    const pasteJoinBtn = this.modalRoot.querySelector('#btn-coop-paste-join') as HTMLButtonElement | null;
    const joinBtn = codeTriggerBtn ? (this.modalRoot.querySelector('#btn-coop-join') as HTMLButtonElement | null) : null;

    if (codeTriggerBtn) {
      this.bindModalTap(codeTriggerBtn, () => {
        this.openRoomCodeKeypadModal();
      });
    }

    if (pasteJoinBtn) {
      this.bindModalTap(pasteJoinBtn, async () => {
        try {
          const txt = await navigator.clipboard.readText();
          const extracted = this.extractRoomCodeFromText(txt);
          if (extracted.length >= 4) {
            this.coopCodeDraft = extracted;
            this.syncCodeTriggerDisplay();
            if (callInp) CoopManager.setCallsign(callInp.value);
            this.coopToast = '';
            SoundFX.reloadDone();
            CoopManager.joinRoomByCode(extracted);
            return;
          }
        } catch {
          // fallback to built-in keypad modal
        }
        this.openRoomCodeKeypadModal(I18n.t('keypadClipboardEmpty'));
      });
    }

    if (joinBtn && codeTriggerBtn) {
      this.bindModalTap(joinBtn, () => {
        const currentCode = (this.coopCodeDraft || CoopManager.lastJoinCode || '').trim();
        if (currentCode.length < 4) {
          this.openRoomCodeKeypadModal();
          return;
        }
        if (callInp) CoopManager.setCallsign(callInp.value);
        this.coopToast = '';
        CoopManager.joinRoomByCode(currentCode);
      });
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
          btn.dataset.coopMode as GameMode,
          CoopManager.lobby.tier || 1
        );
      };
    });

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-coop-tier]').forEach((btn) => {
      btn.onclick = () => {
        if (!CoopManager.lobby) return;
        CoopManager.setHostStageAndMode(
          CoopManager.lobby.stageId,
          CoopManager.lobby.mode,
          Number(btn.dataset.coopTier) as DifficultyTier
        );
      };
    });

    const readyBtn = this.modalRoot.querySelector('#btn-coop-ready') as HTMLButtonElement | null;
    if (readyBtn) {
      this.bindModalTap(readyBtn, () => {
        CoopManager.toggleClientReady();
      });
    }

    const launchBtn = this.modalRoot.querySelector('#btn-coop-launch') as HTMLButtonElement | null;
    if (launchBtn) {
      this.bindModalTap(launchBtn, () => {
        CoopManager.launchHostMatch();
      });
    }
  }

  public startStageRun(
    stage: StageDef,
    mode: GameMode,
    isFirstTutorial = false,
    difficultyTier: DifficultyTier = 1
  ): void {
    this.clearPerkKeyHandler();
    cancelAnimationFrame(this.needleAnimId);
    this.cleanupKeypadModal?.();
    this.hudStatsOpen = false;
    this.armoryOpen = false;
    this.pauseOpen = false;
    this.engine.modalPaused = false;
    this.engine.paused = false;
    this.armoryTab = 'guns';
    this.modalRoot.innerHTML = '';
    SoundFX.setBgmMode('combat');
    PlatformSDK.hideInviteButton(CoopManager.lobby?.roomCode);
    if (this.engine.input.usingTouch && this.isFullscreenActive()) {
      const orient = screen.orientation as ScreenOrientation & {
        lock?: (mode: string) => Promise<void>;
      };
      orient?.lock?.('landscape').catch(() => {});
    }
    this.mountHUD();
    this.engine.startRun(stage, mode, difficultyTier);

    const s = this.engine.state;
    if ((isFirstTutorial || stage.isTutorial) && s && !s.isCoop) {
      this.ftue = {
        active: true,
        startX: s.player.x,
        startY: s.player.y,
        initialCash: s.cash,
        initialGrenades: s.player.grenades,
        moved: false,
        shot: false,
        geared: false,
        tactical: false,
        completedAt: 0,
      };
    } else {
      this.ftue = null;
    }
  }

  // ==================== 极简局内 HUD ====================

  private mountHUD(): void {
    this.hudRoot?.remove();
    this.hudCache = {};
    const hud = document.createElement('div');
    hud.className = `hud-overlay ${this.engine.input.usingTouch ? 'is-touch-hud' : 'is-pc-hud'}`;
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
          <button class="hud-my-stats-pill" id="hud-my-stats" type="button"></button>
          <div class="hud-squad-list" id="hud-squad-list"></div>
          <div class="hud-stats-drawer" id="hud-stats-drawer" style="display:none"></div>

          <div class="hud-ftue-card" id="hud-ftue-card" style="display:none">
            <div class="ftue-head">
              <span id="ftue-title">${I18n.t('ftueTitle')}</span>
              <button class="ftue-skip-btn" id="btn-ftue-skip" type="button">${I18n.t('ftueSkip')}</button>
            </div>
            <div class="ftue-steps">
              <div class="ftue-step" id="ftue-step-move"><span class="ftue-box" id="ftue-chk-move">○</span><span id="ftue-txt-move"></span></div>
              <div class="ftue-step" id="ftue-step-shoot"><span class="ftue-box" id="ftue-chk-shoot">○</span><span id="ftue-txt-shoot"></span></div>
              <div class="ftue-step" id="ftue-step-gear"><span class="ftue-box" id="ftue-chk-gear">○</span><span id="ftue-txt-gear"></span></div>
              <div class="ftue-step" id="ftue-step-skill"><span class="ftue-box" id="ftue-chk-skill">○</span><span id="ftue-txt-skill"></span></div>
            </div>
          </div>
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
            <span class="hud-coop-net" id="hud-coop-net" style="display:none"></span>
            <button class="cash-pill" id="hud-cash" type="button">$80</button>
            <button class="hud-icon-btn" id="btn-pause" type="button">⏸</button>
          </div>
          <button class="moba-shop-btn" id="btn-open-armory" type="button">
            <img class="moba-shop-sprite" src="./assets/prop_armory_kiosk.png" width="18" height="18" alt="" />
            <span id="hud-shop-label">${I18n.t('shopBtn')}</span>
          </button>
          <button class="hud-coop-ping-btn" id="btn-coop-ping" type="button" style="display:none">${I18n.t('coopPingBtn')}</button>
          <div class="coop-callout-strip" id="coop-callout-strip" style="display:none">
            <button type="button" class="coop-callout-pill" data-callout="sos">🆘</button>
            <button type="button" class="coop-callout-pill" data-callout="door">💰</button>
            <button type="button" class="coop-callout-pill" data-callout="chest">🎁</button>
            <button type="button" class="coop-callout-pill" data-callout="nice">👍</button>
          </div>
          <button class="hud-remote-door-btn" id="btn-remote-door" type="button" style="display:none"></button>
          <button class="quick-ammo-btn" id="btn-quick-ammo" type="button" style="display:none">
            <img class="quick-ammo-gun" id="quick-ammo-icon" src="./assets/gun_smg.png" width="22" height="22" alt="" />
            <span class="quick-ammo-text" id="quick-ammo-label"></span>
            <kbd class="quick-ammo-key" id="quick-ammo-key">V</kbd>
          </button>
        </div>
      </div>

      <div class="hud-banner" id="hud-banner"></div>
      <div class="hud-loot-toast" id="hud-loot-toast">
        <img class="loot-toast-img" id="loot-toast-img" src="./assets/gun_rifle.png" width="36" height="36" alt="" />
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
          <img class="moba-arc-img" id="arc-switch-icon" src="./assets/gun_smg.png" width="28" height="28" alt="" />
          <span class="moba-arc-badge" id="arc-switch-badge">${I18n.t('subWepBadge')}</span>
        </button>

        <button class="moba-arc-btn arc-pos-4 moba-skill-btn" id="btn-arc-skill" type="button">
          <img class="moba-arc-img" id="arc-skill-icon" src="./assets/prop_ammo_box.png" width="28" height="28" alt="" />
          <span class="moba-arc-badge" id="arc-skill-badge">F</span>
        </button>

        <button class="moba-arc-btn arc-pos-2 moba-gren-btn" id="btn-grenade" type="button">
          <img class="moba-arc-img" src="./assets/prop_grenade.png" width="28" height="28" alt="" />
          <span class="moba-arc-badge" id="hud-gren-count">2</span>
        </button>

        <button class="moba-arc-btn arc-pos-3 moba-reload-btn" id="btn-arc-reload" type="button">
          <img class="moba-reload-ico" src="./assets/prop_ammo_box.png" width="22" height="22" alt="" />
          <span class="moba-arc-badge" id="arc-reload-glyph">↻</span>
        </button>

        <button class="moba-main-atk" id="btn-main-attack" type="button">
          <span class="moba-atk-ring"></span>
          <span class="moba-atk-knob" id="main-atk-knob"></span>
          <img class="moba-atk-gun" id="main-atk-icon" src="./assets/gun_pistol.png" width="42" height="42" alt="" />
          <span class="moba-atk-ammo" id="main-atk-ammo">14/∞</span>
        </button>
      </div>

      <div class="pc-hotbar" id="pc-hotbar">
        <button class="pc-wep-slot is-active" id="pc-slot-0" type="button">
          <kbd class="pc-key">1</kbd>
          <img class="pc-wep-ico" id="pc-slot-0-ico" src="./assets/gun_pistol.png" width="30" height="24" alt="" />
          <div class="pc-wep-meta">
            <span class="pc-wep-name" id="pc-slot-0-name">Pistol</span>
            <span class="pc-wep-ammo" id="pc-slot-0-ammo">14/∞</span>
          </div>
        </button>

        <button class="pc-wep-slot is-empty" id="pc-slot-1" type="button">
          <kbd class="pc-key" id="pc-slot-1-key">2</kbd>
          <img class="pc-wep-ico" id="pc-slot-1-ico" src="./assets/gun_smg.png" width="30" height="24" alt="" />
          <div class="pc-wep-meta">
            <span class="pc-wep-name" id="pc-slot-1-name">${I18n.t('pcSlotEmpty')}</span>
            <span class="pc-wep-ammo" id="pc-slot-1-ammo">Q</span>
          </div>
        </button>

        <div class="pc-hotbar-divider"></div>

        <button class="pc-act-pill" id="pc-btn-reload" type="button">
          <kbd class="pc-key">R</kbd>
          <img class="pc-act-ico" src="./assets/prop_ammo_box.png" alt="" />
          <span id="pc-reload-txt">${I18n.t('pcReloadLabel')}</span>
        </button>

        <button class="pc-act-pill" id="pc-btn-skill" type="button">
          <kbd class="pc-key">F</kbd>
          <img class="pc-act-ico" id="pc-skill-ico" src="./assets/prop_ammo_box.png" alt="" />
          <span id="pc-skill-txt">${I18n.t('pcSkillLabel')}</span>
        </button>

        <button class="pc-act-pill" id="pc-btn-grenade" type="button">
          <kbd class="pc-key">G</kbd>
          <img class="pc-act-ico" src="./assets/prop_grenade.png" alt="" />
          <span id="pc-grenade-txt">×2</span>
        </button>

        <button class="pc-act-pill pc-shop-pill" id="pc-btn-armory" type="button">
          <kbd class="pc-key">B</kbd>
          <img class="pc-act-ico" src="./assets/prop_armory_kiosk.png" alt="" />
          <span id="pc-armory-txt">${I18n.t('pcArmoryLabel')}</span>
        </button>
      </div>
      <button class="door-trap-hud-btn" id="btn-door-trap" type="button" style="display:none"></button>
    `;
    this.uiLayer.appendChild(hud);
    this.hudRoot = hud;

    const doorTrapBtn = hud.querySelector('#btn-door-trap') as HTMLButtonElement;
    this.bindCombatTap(doorTrapBtn, () => {
      this.engine.tryActivateNearestDoorTrap();
    });

    const coopPingBtn = hud.querySelector('#btn-coop-ping') as HTMLButtonElement;
    const calloutStrip = hud.querySelector('#coop-callout-strip') as HTMLElement;
    this.bindCombatTap(coopPingBtn, () => {
      this.engine.triggerTacticalPing();
      if (this.engine.state?.isCoop) {
        const isVis = calloutStrip.style.display !== 'none';
        calloutStrip.style.display = isVis ? 'none' : 'inline-flex';
        window.clearTimeout(this.calloutStripHideTimer);
        if (!isVis) {
          this.calloutStripHideTimer = window.setTimeout(() => {
            calloutStrip.style.display = 'none';
          }, 3800);
        }
      }
    });

    calloutStrip.querySelectorAll<HTMLButtonElement>('[data-callout]').forEach((cBtn) => {
      this.bindCombatTap(cBtn, () => {
        const preset = (cBtn.dataset.callout || 'nice') as 'sos' | 'door' | 'chest' | 'nice';
        this.engine.sendQuickCallout(preset);
        calloutStrip.style.display = 'none';
        window.clearTimeout(this.calloutStripHideTimer);
      });
    });

    const remoteDoorBtn = hud.querySelector('#btn-remote-door') as HTMLButtonElement;
    this.bindCombatTap(remoteDoorBtn, () => {
      if (this.engine.fundNextLockedDoorRemotely(100)) {
        this.syncHUD();
      }
    });

    const myStatsBtn = hud.querySelector('#hud-my-stats') as HTMLButtonElement;
    this.bindCombatTap(myStatsBtn, () => {
      this.hudStatsOpen = !this.hudStatsOpen;
      this.syncHUD();
    });

    const sqListEl = hud.querySelector('#hud-squad-list') as HTMLElement;
    sqListEl.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest('[data-gift-peer]') as HTMLButtonElement | null;
      if (btn?.dataset.giftPeer) {
        ev.stopPropagation();
        this.engine.sendCashAidToTeammate(btn.dataset.giftPeer, 100);
        this.syncHUD();
      }
    });

    const pauseBtn = hud.querySelector('#btn-pause') as HTMLButtonElement;
    pauseBtn.title = I18n.t('pcPauseHint');
    this.bindModalTap(pauseBtn, () => {
      this.togglePauseMenu();
    });

    const ftueSkip = hud.querySelector('#btn-ftue-skip') as HTMLButtonElement;
    ftueSkip.onclick = () => {
      if (this.engine.state?.stage.isTutorial) {
        SaveManager.markTutorialDone();
        this.showHomeHub();
        return;
      }
      if (this.ftue) {
        this.ftue.active = false;
      }
      (hud.querySelector('#hud-ftue-card') as HTMLElement).style.display = 'none';
    };

    (hud.querySelector('#pc-slot-0') as HTMLButtonElement).onclick = () => {
      this.engine.switchWeapon(0);
    };
    (hud.querySelector('#pc-slot-1') as HTMLButtonElement).onclick = () => {
      const s = this.engine.state;
      if (!s) return;
      if (s.player.weapons.length >= 2) {
        const targetSlot = s.player.activeSlot === 0 ? 1 : (s.player.activeSlot + 1) % s.player.weapons.length;
        this.engine.switchWeapon(targetSlot);
      } else {
        this.toggleArmoryShop();
      }
    };
    (hud.querySelector('#pc-btn-reload') as HTMLButtonElement).onclick = () => {
      this.engine.startReload();
    };
    (hud.querySelector('#pc-btn-skill') as HTMLButtonElement).onclick = () => {
      this.engine.useActiveClassSkill();
    };
    (hud.querySelector('#pc-btn-grenade') as HTMLButtonElement).onclick = () => {
      this.engine.throwGrenade();
    };
    (hud.querySelector('#pc-btn-armory') as HTMLButtonElement).onclick = () => {
      this.toggleArmoryShop();
    };

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

  private getLivePersonalCombatSummary(s: RunSnapshot) {
    const extraRooms = this.engine.getUnlockedExtraRoomsCount();
    const activeWep = s.player.weapons[s.player.activeSlot] || s.player.weapons[0];
    const mBonuses = getWeaponMasteryBonuses(SaveManager.getWeaponMastery(activeWep.defId));
    const dmgPct = Math.round(
      (s.modifiers.damageMult * mBonuses.damageMult * (1 + extraRooms * 0.1) - 1) * 100
    );
    const rofPct = Math.round(
      (s.modifiers.fireRateMult * (s.powerUpTimers.overdrive > 0 ? 1.45 : 1) - 1) * 100
    );
    const critPct = Math.min(95, Math.round((s.modifiers.critChance + mBonuses.bonusCrit) * 100));
    const spdPct = Math.round((s.modifiers.moveSpeedMult - 1) * 100);
    const rldPct = Math.round((1 / Math.max(0.25, s.modifiers.reloadMult) - 1) * 100);
    const pierceBonus = s.modifiers.extraPierce + mBonuses.bonusPierce;
    const myKills = s.isCoop ? s.personalKills : s.kills;
    const myMvp = this.engine.getPlayerMvpCounters(CoopManager.myPeerId);
    return {
      dmgPct,
      rofPct,
      critPct,
      spdPct,
      rldPct,
      pierceBonus,
      myKills,
      myMvp,
    };
  }

  private buildLiveStatsDrawerHtml(s: RunSnapshot): string {
    const st = this.getLivePersonalCombatSummary(s);
    const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v}%`;

    const allPlayers = [
      {
        peerId: CoopManager.myPeerId,
        callsign: s.localCallsign || 'Agent',
        color: SQUAD_SLOTS[s.localSlot]?.color || '#38bdf8',
        isMe: true,
        cash: Math.round(s.cash),
        kills: st.myKills,
        revives: st.myMvp.revives,
        repairs: st.myMvp.repairs,
        doorFunded: st.myMvp.doorFunded,
      },
      ...s.remotePlayers.map((rp) => {
        const c = this.engine.getPlayerMvpCounters(rp.peerId);
        return {
          peerId: rp.peerId,
          callsign: rp.callsign,
          color: rp.color,
          isMe: false,
          cash: Math.round(rp.cash),
          kills: rp.kills,
          revives: rp.revives ?? c.revives,
          repairs: rp.repairs ?? c.repairs,
          doorFunded: rp.doorFunded ?? c.doorFunded,
        };
      }),
    ].sort((a, b) => b.kills - a.kills);

    const boardHtml =
      allPlayers.length > 1 || s.isCoop
        ? `
          <div class="live-squad-mini-table">
            <div class="lst-row lst-head">
              <span>${I18n.t('hudBoardAgent')}</span>
              <span>${I18n.t('hudBoardCash')}</span>
              <span>${I18n.t('hudBoardKills')}</span>
              <span>${I18n.t('hudBoardTeam')}</span>
            </div>
            ${allPlayers
              .map(
                (pl) => `
                <div class="lst-row ${pl.isMe ? 'is-me' : ''}">
                  <span class="lst-name"><i class="sq-dot" style="background:${pl.color}"></i>${pl.callsign}${pl.isMe ? `(${I18n.t('hudMyStatsTag')})` : ''}</span>
                  <span class="lst-cash">$${pl.cash}</span>
                  <span class="lst-kills">💀${pl.kills}</span>
                  <span class="lst-sup">💉${pl.revives}·🔨${pl.repairs}·🚪$${pl.doorFunded}</span>
                </div>
              `
              )
              .join('')}
          </div>
        `
        : '';

    return `
      <div class="live-stats-head">
        <strong>${I18n.t('hudStatsPanelTitle')}</strong>
      </div>
      <div class="live-mods-grid">
        <span><em>${I18n.t('hudStatDmg')}</em><b>${fmtPct(st.dmgPct)}</b></span>
        <span><em>${I18n.t('hudStatFire')}</em><b>${fmtPct(st.rofPct)}</b></span>
        <span><em>${I18n.t('hudStatCrit')}</em><b>${st.critPct}%</b></span>
        <span><em>${I18n.t('hudStatSpd')}</em><b>${fmtPct(st.spdPct)}</b></span>
        <span><em>${I18n.t('hudStatReload')}</em><b>${fmtPct(st.rldPct)}</b></span>
        <span><em>${I18n.t('hudStatPierce')}</em><b>+${st.pierceBonus}</b></span>
      </div>
      ${boardHtml}
    `;
  }

  private renderPauseMenu(): void {
    const s = this.engine.state;
    if (!s) return;
    const autoOn = this.engine.input.autoFireEnabled;
    const muted = SoundFX.isUserMuted();
    const musicMuted = SoundFX.isMusicMuted();
    const fsSupported = this.isFullscreenSupported();
    const fsActive = this.isFullscreenActive();
    const myKills = s.isCoop ? s.personalKills : s.kills;
    const pauseSubTxt = s.isCoop
      ? I18n.t('pauseCoopSub', { w: s.wave, mk: myKills, k: s.kills, lv: s.battleLevel })
      : I18n.t('pauseSub', { w: s.wave, k: s.kills, lv: s.battleLevel });

    this.modalRoot.innerHTML = `
      <div class="popup-backdrop" id="pause-backdrop">
        <div class="popup-box compact-modal">
          <h2>${I18n.t('pauseTitle')}</h2>
          <p class="popup-sub">${pauseSubTxt}</p>
          <div class="pause-live-stats-wrap">${this.buildLiveStatsDrawerHtml(s)}</div>
          <div class="pause-btn-stack">
            <button class="btn-cartoon btn-green" id="btn-resume">${I18n.t('resumeBtn')}</button>
            <button class="btn-cartoon ${autoOn ? 'btn-blue' : 'btn-gray'}" id="btn-toggle-auto">
              ${I18n.t('autoFireBtn', { state: autoOn ? I18n.t('on') : I18n.t('off') })}
            </button>
            <button class="btn-cartoon ${!musicMuted ? 'btn-blue' : 'btn-gray'}" id="btn-toggle-music">
              ${musicMuted ? I18n.t('musicMuted') : I18n.t('musicOn')}
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

    (this.modalRoot.querySelector('#btn-toggle-music') as HTMLButtonElement).onclick = () => {
      SoundFX.toggleMusicMute();
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
      SaveManager.markTutorialDone();
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
      this.engine.input.resetStates();
    }
    this.renderArmoryShop('');
  }

  public isArmoryShopOpen(): boolean {
    return this.armoryOpen;
  }

  private renderArmoryShop(toastMsg: string): void {
    const s = this.engine.state;
    if (!s) return;

    const isCoopShop = Boolean(s.isCoop);
    const unlockedRooms = this.engine.getUnlockedExtraRoomsCount();
    const activeWep = s.player.weapons[s.player.activeSlot];
    const activeDef = WEAPONS[activeWep.defId];
    const activeBaseName = I18n.wName(activeDef.id, activeDef.name);
    const activeSupName = I18n.wSuperName(activeDef.id, activeDef.superName);
    const save = SaveManager.get();

    let contentHtml = '';
    if (this.armoryTab === 'guns') {
      const isTut = Boolean(s.stage.isTutorial);
      const evoCost = isTut ? 0 : this.engine.getEffectiveEvolveCost(activeWep.defId);
      const canEvolve = !activeWep.evolved && s.cash >= evoCost;
      const evolveStrip = activeWep.evolved
        ? `<div class="evolve-strip done">${I18n.t('evolvedDone', { name: activeSupName })}</div>`
        : `<div class="evolve-strip">
            <span>${I18n.t('evolvePrompt', { base: activeBaseName, sup: activeSupName })}</span>
            <button class="btn-cartoon btn-mini ${canEvolve ? 'btn-purple' : 'btn-disabled'}" id="btn-shop-evolve">
              ${isTut ? I18n.t('tutFreeEvoBtn') : I18n.t('evolveBtn', { cost: evoCost })}
            </button>
          </div>`;

      const gunImgW = isCoopShop ? 34 : 52;
      const gunImgH = isCoopShop ? 24 : 40;
      const gunCards = WEAPON_LIST.map((w) => {
        const owned = s.player.weapons.find((inst) => inst.defId === w.id);
        const isPermanent = !!owned && owned.tempWavesLeft === undefined;
        const isEquipped = activeWep.defId === w.id;
        const locked = !isTut && unlockedRooms < w.unlockRoomsRequired && !owned;
        const mRank = SaveManager.getWeaponMastery(w.id);
        const mStars = mRank > 0 ? ` <em class="shop-mastery-tag">★${mRank}</em>` : '';
        const wTitle =
          (owned?.evolved ? `⚡${I18n.wSuperName(w.id, w.superName)}` : I18n.wName(w.id, w.name)) + mStars;

        const gunCost = this.engine.getEffectiveGunCost(w.id);
        const ammoCost = this.engine.getEffectiveAmmoCost(w.id);
        let btnLabel = isTut ? I18n.t('tutFreeGunBtn') : I18n.t('buyBtn', { cost: gunCost });
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
              <img src="./assets/gun_${w.id}.png" width="${gunImgW}" height="${gunImgH}" alt="${wTitle}" class="armory-gun-img" />
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
      if (isCoopShop) {
        const coopEvolveHtml = activeWep.evolved
          ? `<span class="coop-evo-done">⚡ ${activeSupName}</span>`
          : `<button class="btn-cartoon btn-mini ${canEvolve ? 'btn-purple' : 'btn-disabled'}" id="btn-shop-evolve" type="button">
               ⚡ ${activeSupName} · ${isTut ? I18n.t('tutFreeEvoBtn') : I18n.t('evolveBtn', { cost: evoCost })}
             </button>`;
        const coopToolbar = `
          <div class="coop-shop-toolbar">
            ${coopEvolveHtml}
            <button class="btn-cartoon btn-mini ${autoAmmoOn ? 'btn-green' : 'btn-gray'}" id="btn-toggle-auto-ammo" type="button">
              ${autoAmmoOn ? I18n.t('autoAmmoOn') : I18n.t('autoAmmoOff')}
            </button>
          </div>
        `;
        contentHtml = `${coopToolbar}<div class="armory-gun-grid">${gunCards}</div>`;
      } else {
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
      }
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
            <div class="sup-name"><img class="sup-inline-icon" src="./assets/item_emp_grid.png" width="22" height="22" alt="" /> ${I18n.t('supAlloyWinName')}</div>
            <div class="sup-meta">${I18n.t('supAlloyWinMeta', { done: alloyWin.done, total: alloyWin.total })}</div>
            <button class="btn-cartoon btn-mini ${alloyWinFull ? 'btn-gray' : canBuyAlloyWin ? 'btn-blue' : 'btn-disabled'}" data-tac="alloy_windows">${alloyWinFull ? I18n.t('supAlloyWinFullBtn') : I18n.t('supAlloyWinBtn')}</button>
          </div>
          <div class="supply-card">
            <div class="sup-name"><img class="sup-inline-icon" src="./assets/item_armor.png" width="22" height="22" alt="" /> ${I18n.t('supArmorName')}</div>
            <div class="sup-meta">${I18n.t('supArmorMeta', { cur: Math.round(s.player.armor) })}</div>
            <button class="btn-cartoon btn-mini ${s.cash >= 380 && s.player.armor < 100 ? 'btn-blue' : 'btn-disabled'}" data-tac="armor">${I18n.t('buyBtn', { cost: 380 })}</button>
          </div>
          <div class="supply-card">
            <div class="sup-name"><img class="sup-inline-icon" src="./assets/item_medkit.png" width="22" height="22" alt="" /> ${I18n.t('supMedkitName')}</div>
            <div class="sup-meta">${I18n.t('supMedkitMeta', { hp: Math.ceil(s.player.hp), max: s.player.maxHp })}</div>
            <button class="btn-cartoon btn-mini ${s.cash >= 300 && s.player.hp < s.player.maxHp ? 'btn-green' : 'btn-disabled'}" data-tac="medkit">${I18n.t('supMedkitBtn')}</button>
          </div>
          <div class="supply-card">
            <div class="sup-name"><img class="sup-inline-icon" src="./assets/prop_grenade.png" width="22" height="22" alt="" /> ${I18n.t('supGrenName')}</div>
            <div class="sup-meta">${I18n.t('supGrenMeta', { n: s.player.grenades })}</div>
            <button class="btn-cartoon btn-mini ${s.cash >= 220 ? 'btn-yellow' : 'btn-disabled'}" data-tac="grenades">${I18n.t('buyBtn', { cost: 220 })}</button>
          </div>
          <div class="supply-card">
            <div class="sup-name"><img class="sup-inline-icon" src="./assets/prop_ammo_box.png" width="22" height="22" alt="" /> ${I18n.t('supAllAmmoName')}</div>
            <div class="sup-meta">${I18n.t('supAllAmmoMeta')}</div>
            <button class="btn-cartoon btn-mini ${s.cash >= 320 ? 'btn-blue' : 'btn-disabled'}" data-tac="all_ammo">${I18n.t('supAllAmmoBtn')}</button>
          </div>
          <div class="supply-card">
            <div class="sup-name"><img class="sup-inline-icon" src="./assets/prop_turret.png" width="22" height="22" alt="" /> ${I18n.t('supTurretName')}</div>
            <div class="sup-meta">${I18n.t('supTurretMeta')}</div>
            <button class="btn-cartoon btn-mini ${s.cash >= 650 ? 'btn-yellow' : 'btn-disabled'}" data-tac="turret">${I18n.t('supTurretBtn')}</button>
          </div>
          ${
            isCoopShop
              ? ''
              : `
          <div class="supply-card support-highlight">
            <div class="sup-name"><img class="sup-inline-icon" src="./assets/drop_cash.png" width="22" height="22" alt="" /> ${I18n.t('supCashName')}</div>
            <div class="sup-meta">${I18n.t('supCashMeta')}</div>
            <button class="btn-cartoon btn-mini ${s.armoryAdCooldown > 0 ? 'btn-disabled' : 'btn-yellow'}" id="btn-armory-ad" ${s.armoryAdCooldown > 0 ? 'disabled' : ''}>${cashSupportText}</button>
          </div>
          <div class="supply-card support-highlight">
            <div class="sup-name"><img class="sup-inline-icon" src="./assets/prop_chest.png" width="22" height="22" alt="" /> ${I18n.t('supHqName')}</div>
            <div class="sup-meta">${I18n.t('supHqMeta')}</div>
            <button class="btn-cartoon btn-mini ${s.hqSupportCooldown > 0 ? 'btn-disabled' : 'btn-green'}" id="btn-sup-turret" ${s.hqSupportCooldown > 0 ? 'disabled' : ''}>${turretSupportText}</button>
          </div>
          <div class="supply-card support-highlight">
            <div class="sup-name"><img class="sup-inline-icon" src="./assets/item_emp_grid.png" width="22" height="22" alt="" /> ${I18n.t('supElecName')}</div>
            <div class="sup-meta">${I18n.t('supElecMeta')}</div>
            <button class="btn-cartoon btn-mini ${s.electricFortifyWaves > 0 ? 'btn-disabled' : 'btn-blue'}" id="btn-sup-elec" ${s.electricFortifyWaves > 0 ? 'disabled' : ''}>${elecSupportText}</button>
          </div>`
          }
        </div>
      `;
    }

    this.modalRoot.innerHTML = `
      <div class="popup-backdrop ${isCoopShop ? 'is-coop-shop' : ''}" id="armory-backdrop">
        <div class="armory-modal ${isCoopShop ? 'is-coop-shop' : ''}">
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
              <span class="cash-pill" id="armory-shop-cash">$${s.cash}</span>
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
        const res = this.engine.evolveActiveWeaponInShop();
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
    if (!s || !this.hudRoot) {
      document.body.classList.remove('pc-combat-cursor');
      return;
    }

    const usingTouch = this.engine.input.usingTouch;
    const hideOsCursor =
      !usingTouch &&
      !this.armoryOpen &&
      !this.pauseOpen &&
      !this.engine.modalPaused &&
      !this.engine.paused &&
      this.modalRoot.childElementCount === 0 &&
      s.waveState !== 'ended';
    document.body.classList.toggle('pc-combat-cursor', hideOsCursor);

    const setIfChanged = (key: string, val: string, fn: () => void) => {
      if (this.hudCache[key] !== val) {
        this.hudCache[key] = val;
        fn();
      }
    };

    setIfChanged('hudInputMode', usingTouch ? 'touch' : 'pc', () => {
      this.hudRoot!.classList.toggle('is-touch-hud', usingTouch);
      this.hudRoot!.classList.toggle('is-pc-hud', !usingTouch);
    });

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
    const tierPrefix = s.difficultyTier > 1 ? `${getDifficultyMeta(s.difficultyTier).stars} ` : '';
    let waveStr = '';
    if (s.waveState === 'extraction') {
      waveStr = `${tierPrefix}${I18n.t('waveEvac', { pct: Math.round(s.extractionProgress * 100) })}${coopSuffix}`;
    } else if (s.waveState === 'intermission') {
      waveStr = `${tierPrefix}${I18n.t('waveBreak', { s: Math.ceil(s.intermissionTimer) })}${coopSuffix}`;
    } else {
      waveStr =
        tierPrefix +
        (s.mode === 'standard'
          ? I18n.t('waveStd', { w: s.wave, m: s.maxWaves, n: s.zombiesRemainingInWave })
          : I18n.t('waveEndl', { w: s.wave, n: s.zombiesRemainingInWave })) +
        coopSuffix;
    }
    setIfChanged('wave', waveStr, () => {
      (this.hudRoot!.querySelector('#hud-wave') as HTMLElement).textContent = waveStr;
    });

    const coopNetKey = s.isCoop ? `${I18n.lang}:${CoopManager.hasDirectP2P() ? 1 : 0}:${CoopManager.rttMs}` : 'off';
    setIfChanged('coopHudMode', s.isCoop ? 'coop' : 'solo', () => {
      this.hudRoot!.classList.toggle('is-coop-hud', Boolean(s.isCoop));
    });
    setIfChanged('coopNetHud', coopNetKey, () => {
      const netEl = this.hudRoot!.querySelector('#hud-coop-net') as HTMLElement;
      const pingBtn = this.hudRoot!.querySelector('#btn-coop-ping') as HTMLButtonElement;
      if (!s.isCoop) {
        netEl.style.display = 'none';
        pingBtn.style.display = 'none';
      } else {
        netEl.style.display = 'inline-flex';
        netEl.classList.toggle('is-p2p', CoopManager.hasDirectP2P());
        netEl.textContent = CoopManager.getNetStatusLabel();
        pingBtn.style.display = 'inline-flex';
        pingBtn.textContent = I18n.t('coopPingBtn');
      }
    });

    const nextDoor = s.isCoop ? this.engine.getNextFundableDoor() : null;
    const doorNeed = nextDoor ? Math.max(0, nextDoor.cost - nextDoor.paidAmount) : 0;
    const showRemoteDoor = Boolean(
      s.isCoop && nextDoor && doorNeed > 0 && (nextDoor.paidAmount > 0 || s.cash >= 100)
    );
    const canPayRemoteDoor = showRemoteDoor && s.cash >= Math.min(100, doorNeed);
    const remoteDoorKey = showRemoteDoor ? `${I18n.lang}:${nextDoor!.id}:${doorNeed}:${canPayRemoteDoor ? 1 : 0}` : 'hide';
    setIfChanged('remoteDoor', remoteDoorKey, () => {
      const rBtn = this.hudRoot!.querySelector('#btn-remote-door') as HTMLButtonElement;
      if (!showRemoteDoor) {
        rBtn.style.display = 'none';
      } else {
        rBtn.style.display = 'inline-flex';
        rBtn.disabled = !canPayRemoteDoor;
        rBtn.textContent = I18n.t('remoteDoorBtn', { left: doorNeed });
      }
    });

    const myLive = this.getLivePersonalCombatSummary(s);
    const mySlotColor = SQUAD_SLOTS[s.localSlot]?.color || '#38bdf8';
    const myStatsSig = `${I18n.lang}:${s.isCoop ? 1 : 0}:${myLive.myKills}:${s.kills}:${myLive.dmgPct}:${myLive.critPct}:${myLive.myMvp.revives}:${myLive.myMvp.repairs}:${myLive.myMvp.doorFunded}:${this.hudStatsOpen ? 1 : 0}`;
    setIfChanged('myStatsHud', myStatsSig, () => {
      const myEl = this.hudRoot!.querySelector('#hud-my-stats') as HTMLButtonElement;
      const killsTxt = s.isCoop ? `${myLive.myKills}/${s.kills}` : `${myLive.myKills}`;
      const dmgTxt = `${myLive.dmgPct >= 0 ? '+' : ''}${myLive.dmgPct}%`;
      const supHtml = [
        myLive.myMvp.revives > 0 ? `<span>💉${myLive.myMvp.revives}</span>` : '',
        myLive.myMvp.repairs > 0 ? `<span>🔨${myLive.myMvp.repairs}</span>` : '',
        myLive.myMvp.doorFunded > 0 ? `<span>🚪$${myLive.myMvp.doorFunded}</span>` : '',
      ].join('');
      myEl.classList.toggle('is-open', this.hudStatsOpen);
      myEl.innerHTML = `
        <span class="sq-dot" style="background:${mySlotColor}"></span>
        <span class="my-stat-tag">${I18n.t('hudMyStatsTag')}</span>
        <span class="my-stat-kills">💀${killsTxt}</span>
        <span class="my-stat-buff">⚔️${dmgTxt}</span>
        <span class="my-stat-buff">💥${myLive.critPct}%</span>
        ${supHtml}
        <span class="my-stat-caret">${this.hudStatsOpen ? '▴' : '▾'}</span>
      `;
    });

    const canGift100 = s.isCoop && s.cash >= 100 ? 1 : 0;
    const squadSig =
      s.remotePlayers.length > 0
        ? `${I18n.lang}|${canGift100}|` +
          s.remotePlayers
            .map(
              (rp) =>
                `${rp.peerId}:${rp.callsign}:${rp.hp}/${rp.maxHp}:${rp.downed ? 1 : 0}:${rp.spectating ? 1 : 0}:${Math.ceil(rp.bleedoutTimer)}:${rp.cash}:${rp.kills}:${rp.revives || 0}:${rp.repairs || 0}:${rp.doorFunded || 0}:${rp.isBot ? 1 : 0}`
            )
            .join('|')
        : '';
    setIfChanged('squadHud', squadSig, () => {
      const sqEl = this.hudRoot!.querySelector('#hud-squad-list') as HTMLElement;
      if (s.remotePlayers.length === 0) {
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
              : rp.isBot
                ? `${I18n.t('botRoleTag')} · 💀${rp.kills}`
                : `$${rp.cash} · 💀${rp.kills}`;
          const giftBtnHtml =
            s.isCoop && !rp.isBot && !rp.spectating
              ? `<button class="sq-gift-btn" type="button" data-gift-peer="${rp.peerId}" ${canGift100 ? '' : 'disabled'}>+$100</button>`
              : '';
          return `
            <div class="squad-hud-chip ${rp.downed ? 'is-downed' : ''}">
              <span class="sq-dot" style="background:${rp.color}"></span>
              <span class="sq-name">${rp.callsign}</span>
              <div class="sq-hp-track"><div class="sq-hp-fill" style="width:${hpPct}%;background:${rp.downed ? '#ef4444' : rp.color}"></div></div>
              <span class="sq-meta">${stText}</span>
              ${giftBtnHtml}
            </div>
          `;
        })
        .join('');
    });

    const drawerSig = this.hudStatsOpen
      ? `${myStatsSig}|${Math.round(s.cash)}|${myLive.rofPct}|${myLive.spdPct}|${myLive.rldPct}|${myLive.pierceBonus}|${squadSig}`
      : 'closed';
    setIfChanged('statsDrawer', drawerSig, () => {
      const drEl = this.hudRoot!.querySelector('#hud-stats-drawer') as HTMLElement;
      if (!this.hudStatsOpen) {
        drEl.style.display = 'none';
        return;
      }
      drEl.style.display = 'flex';
      drEl.innerHTML = this.buildLiveStatsDrawerHtml(s);
    });

    const readyTrap = this.engine.getNearestReadyDoorTrap();
    const trapKey = readyTrap ? `${I18n.lang}:${readyTrap.door.id}:${readyTrap.cost}` : 'none';
    setIfChanged('doorTrapBtn', trapKey, () => {
      const tBtn = this.hudRoot!.querySelector('#btn-door-trap') as HTMLButtonElement | null;
      if (!tBtn) return;
      if (!readyTrap) {
        tBtn.style.display = 'none';
      } else {
        tBtn.style.display = 'inline-flex';
        tBtn.textContent = I18n.t('doorTrapBtn', { cost: readyTrap.cost });
      }
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
    if (this.armoryOpen && s.isCoop) {
      const shopCashEl = this.modalRoot.querySelector('#armory-shop-cash') as HTMLElement | null;
      if (shopCashEl && shopCashEl.textContent !== cashStr) {
        shopCashEl.textContent = cashStr;
      }
    }

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

    // 动态切换 Boss 战高燃配乐 vs 常规战斗合成波配乐
    SoundFX.setBgmMode(bossTarget && isBossKind(bossTarget.kind) ? 'boss' : 'combat');

    // PC 桌面端底部战术动作栏同步
    if (!usingTouch) {
      const slot0 = s.player.weapons[0];
      const slot1 = s.player.weapons.length >= 2 ? s.player.weapons[s.player.activeSlot === 0 ? 1 : s.player.activeSlot] : null;
      const pcBarKey = [
        I18n.lang,
        s.player.activeSlot,
        s.player.weapons.length,
        slot0 ? `${slot0.defId}:${slot0.evolved ? 1 : 0}:${slot0.mag}/${slot0.reserve}` : 'none',
        slot1 ? `${slot1.defId}:${slot1.evolved ? 1 : 0}:${slot1.mag}/${slot1.reserve}` : 'empty',
        isReloading ? 'rel' : canReload ? (lowAmmo ? 'low' : 'ok') : 'full',
        `${clsDef.id}:${skillCdSec}`,
        s.player.grenades,
        pulseShop,
      ].join('|');

      setIfChanged('pcHotbar', pcBarKey, () => {
        const formatSlotAmmo = (w: NonNullable<typeof slot0>, active: boolean) => {
          if (active && isReloading) return I18n.t('reloadingShort');
          return w.reserve < 0 ? `${w.mag}/∞` : `${w.mag}/${w.reserve}`;
        };

        if (slot0) {
          const def0 = WEAPONS[slot0.defId];
          const btn0 = this.hudRoot!.querySelector('#pc-slot-0') as HTMLButtonElement;
          const ico0 = this.hudRoot!.querySelector('#pc-slot-0-ico') as HTMLImageElement;
          const nm0 = this.hudRoot!.querySelector('#pc-slot-0-name') as HTMLElement;
          const am0 = this.hudRoot!.querySelector('#pc-slot-0-ammo') as HTMLElement;
          btn0.classList.toggle('is-active', s.player.activeSlot === 0);
          btn0.classList.toggle('is-evolved', slot0.evolved);
          ico0.setAttribute('src', `./assets/gun_${slot0.defId}.png`);
          nm0.textContent = slot0.evolved
            ? I18n.wSuperName(def0.id, def0.superName)
            : I18n.wName(def0.id, def0.name);
          am0.textContent = formatSlotAmmo(slot0, s.player.activeSlot === 0);
          am0.classList.toggle('low-ammo', s.player.activeSlot === 0 && lowAmmo);
        }

        const btn1 = this.hudRoot!.querySelector('#pc-slot-1') as HTMLButtonElement;
        const key1 = this.hudRoot!.querySelector('#pc-slot-1-key') as HTMLElement;
        const ico1 = this.hudRoot!.querySelector('#pc-slot-1-ico') as HTMLImageElement;
        const nm1 = this.hudRoot!.querySelector('#pc-slot-1-name') as HTMLElement;
        const am1 = this.hudRoot!.querySelector('#pc-slot-1-ammo') as HTMLElement;
        if (slot1) {
          const def1 = WEAPONS[slot1.defId];
          const slot1Active = s.player.activeSlot !== 0;
          btn1.classList.remove('is-empty');
          btn1.classList.toggle('is-active', slot1Active);
          btn1.classList.toggle('is-evolved', slot1.evolved);
          key1.textContent = s.player.weapons.length > 2 ? 'Q' : '2';
          ico1.setAttribute('src', `./assets/gun_${slot1.defId}.png`);
          nm1.textContent = slot1.evolved
            ? I18n.wSuperName(def1.id, def1.superName)
            : I18n.wName(def1.id, def1.name);
          am1.textContent = formatSlotAmmo(slot1, slot1Active);
          am1.classList.toggle('low-ammo', slot1Active && lowAmmo);
        } else {
          btn1.classList.add('is-empty');
          btn1.classList.remove('is-active', 'is-evolved');
          key1.textContent = '2';
          ico1.setAttribute('src', './assets/gun_smg.png');
          nm1.textContent = I18n.t('pcSlotEmpty');
          am1.textContent = 'B / Q';
          am1.classList.remove('low-ammo');
        }

        const pcRel = this.hudRoot!.querySelector('#pc-btn-reload') as HTMLButtonElement;
        const pcRelTxt = this.hudRoot!.querySelector('#pc-reload-txt') as HTMLElement;
        pcRel.disabled = !canReload && !isReloading;
        pcRel.classList.toggle('need-reload', canReload && lowAmmo);
        pcRelTxt.textContent = isReloading ? I18n.t('reloadingShort') : I18n.t('pcReloadLabel');

        const pcSk = this.hudRoot!.querySelector('#pc-btn-skill') as HTMLButtonElement;
        const pcSkIco = this.hudRoot!.querySelector('#pc-skill-ico') as HTMLImageElement;
        const pcSkTxt = this.hudRoot!.querySelector('#pc-skill-txt') as HTMLElement;
        pcSkIco.setAttribute('src', clsDef.skillSprite);
        pcSk.disabled = skillCdSec > 0;
        pcSk.style.borderColor = skillCdSec > 0 ? '' : clsDef.color;
        pcSkTxt.textContent = skillCdSec > 0 ? `${skillCdSec}s` : I18n.t('pcSkillLabel');

        const pcGr = this.hudRoot!.querySelector('#pc-btn-grenade') as HTMLButtonElement;
        const pcGrTxt = this.hudRoot!.querySelector('#pc-grenade-txt') as HTMLElement;
        pcGr.disabled = s.player.grenades <= 0;
        pcGrTxt.textContent = `×${s.player.grenades}`;

        const pcShop = this.hudRoot!.querySelector('#pc-btn-armory') as HTMLButtonElement;
        const pcShopTxt = this.hudRoot!.querySelector('#pc-armory-txt') as HTMLElement;
        pcShop.classList.toggle('shop-ready', pulseShop === '1');
        pcShopTxt.textContent = I18n.t('pcArmoryLabel');
      });
    }

    // 新玩家首局实战交互式键位教学引导（FTUE）
    this.syncFtueChecklist(s, usingTouch, setIfChanged);
  }

  private syncFtueChecklist(
    s: RunSnapshot,
    usingTouch: boolean,
    setIfChanged: (key: string, val: string, fn: () => void) => void
  ): void {
    const card = this.hudRoot?.querySelector('#hud-ftue-card') as HTMLElement | null;
    if (!card) return;
    const ft = this.ftue;
    if (!ft || !ft.active) {
      if (card.style.display !== 'none') card.style.display = 'none';
      return;
    }

    const isTut = Boolean(s.stage.isTutorial);
    const p = s.player;
    if (!ft.moved && Math.hypot(p.x - ft.startX, p.y - ft.startY) > 72) {
      ft.moved = true;
      SoundFX.coin();
    }
    if (!ft.shot && (s.kills >= 1 || p.muzzleFlashTimer > 0 || s.bullets.length > 0)) {
      ft.shot = true;
      SoundFX.coin();
    }
    if (
      !ft.geared &&
      (this.armoryOpen ||
        p.weapons.length >= (isTut ? 3 : 2) ||
        p.weapons.some((w) => w.evolved) ||
        s.cash < ft.initialCash)
    ) {
      ft.geared = true;
      SoundFX.coin();
    }
    if (
      !ft.tactical &&
      (s.skillCooldown > 0 || p.grenades < ft.initialGrenades || s.doors.some((d) => d.unlocked))
    ) {
      ft.tactical = true;
      SoundFX.coin();
    }

    const allDone = ft.moved && ft.shot && ft.geared && ft.tactical;
    if ((allDone || (!isTut && s.wave >= 3)) && ft.completedAt === 0) {
      ft.completedAt = performance.now();
      if (allDone) {
        s.cash += 150;
        s.bannerText = I18n.t('ftueBonusBanner');
        s.bannerTimer = 3.6;
        SoundFX.fanfare();
      }
    }

    // 独立教学靶场内保留顶部快捷“跳过教学/去联机”入口，方便想直接联机的新玩家随时一键回大厅！
    if (!isTut && ft.completedAt > 0 && performance.now() - ft.completedAt > 1500) {
      ft.active = false;
      card.style.display = 'none';
      return;
    }

    const hideStepsInTut = isTut && ft.completedAt > 0 && performance.now() - ft.completedAt > 1800;
    const sig = `${I18n.lang}:${isTut ? 1 : 0}:${usingTouch ? 1 : 0}:${ft.moved ? 1 : 0}${ft.shot ? 1 : 0}${ft.geared ? 1 : 0}${ft.tactical ? 1 : 0}:${ft.completedAt > 0 ? 1 : 0}:${hideStepsInTut ? 1 : 0}`;
    setIfChanged('ftueCard', sig, () => {
      card.style.display = 'flex';
      card.classList.toggle('all-done', ft.completedAt > 0);
      (card.querySelector('#ftue-title') as HTMLElement).textContent = I18n.t(
        isTut ? 'tutTitle' : 'ftueTitle'
      );
      (card.querySelector('#btn-ftue-skip') as HTMLElement).textContent = I18n.t(
        isTut ? 'tutSkipToHub' : 'ftueSkip'
      );
      const stepsEl = card.querySelector('.ftue-steps') as HTMLElement;
      stepsEl.style.display = hideStepsInTut ? 'none' : 'flex';

      const applyStep = (id: string, done: boolean, html: string) => {
        const row = card.querySelector(`#ftue-step-${id}`) as HTMLElement;
        const chk = card.querySelector(`#ftue-chk-${id}`) as HTMLElement;
        const txt = card.querySelector(`#ftue-txt-${id}`) as HTMLElement;
        row.classList.toggle('done', done);
        chk.textContent = done ? '✓' : '○';
        txt.innerHTML = html;
      };

      applyStep('move', ft.moved, I18n.t(usingTouch ? 'ftueMoveTouch' : 'ftueMovePc'));
      applyStep('shoot', ft.shot, I18n.t(usingTouch ? 'ftueShootTouch' : 'ftueShootPc'));
      applyStep(
        'gear',
        ft.geared,
        I18n.t(isTut ? (usingTouch ? 'tutGearTouch' : 'tutGearPc') : usingTouch ? 'ftueGearTouch' : 'ftueGearPc')
      );
      applyStep('skill', ft.tactical, I18n.t(usingTouch ? 'ftueSkillTouch' : 'ftueSkillPc'));
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
    const isTut = Boolean(s.stage.isTutorial);
    if (isTut) {
      SaveManager.markTutorialDone();
    }
    const stageEco = getStageEcology(s.stage.id);
    const tierMeta = getDifficultyMeta(s.difficultyTier);
    const pStats = SaveManager.getEffectivePlayerStats();
    const rewardMult = isTut
      ? 1
      : stageEco.rewardMult * tierMeta.rewardMult * pStats.settlementRewardMult;
    const stageTierBonus = (s.stage.index - 1) * 20;
    const rawGold = Math.round(
      (25 + stageTierBonus + s.wave * 14 + Math.min(260, s.kills * 0.45) + (victory ? 110 : 0)) *
        rewardMult
    );
    const rawXp = Math.round(
      (30 + stageTierBonus + s.wave * 16 + Math.min(300, s.kills * 0.65) + (victory ? 100 : 0)) *
        rewardMult
    );
    const baseGold = isTut && victory ? Math.max(180, rawGold) : rawGold;
    const baseXp = isTut && victory ? Math.max(85, rawXp) : rawXp;
    const bonusCores = !isTut && victory ? tierMeta.clearTechCores : 0;
    if (bonusCores > 0) {
      SaveManager.addTechCores(bonusCores);
    }
    if (s.isCoop) {
      // 联机模式立即入账奖励（防房主秒点“下一关”时队员漏领），并展示 4 人同屏 MVP 战绩榜与零广告无缝连战入口！
      SaveManager.addRewards(baseGold, baseXp);
      const mvpList = s.squadMvpStats && s.squadMvpStats.length > 0 ? s.squadMvpStats : this.engine.buildSquadMvpStats();
      const topKills = Math.max(0, ...mvpList.map((m) => m.kills));
      const topRevives = Math.max(0, ...mvpList.map((m) => m.revives));
      const topDoor = Math.max(0, ...mvpList.map((m) => m.doorFunded));
      const topRepairs = Math.max(0, ...mvpList.map((m) => m.repairs));

      const mvpRowsHtml = mvpList
        .map((m) => {
          const cls = getAgentClassDef(m.classId || 'vanguard');
          let badge = I18n.t('mvpOperative');
          let badgeColor = '#64748b';
          if (topKills > 0 && m.kills === topKills) {
            badge = I18n.t('mvpWarGod');
            badgeColor = '#eab308';
          } else if (topRevives > 0 && m.revives === topRevives) {
            badge = I18n.t('mvpMedic');
            badgeColor = '#16a34a';
          } else if (topDoor >= 100 && m.doorFunded === topDoor) {
            badge = I18n.t('mvpSponsor');
            badgeColor = '#0284c7';
          } else if (topRepairs >= 3 && m.repairs === topRepairs) {
            badge = I18n.t('mvpBuilder');
            badgeColor = '#9333ea';
          }
          const isMe = m.peerId === CoopManager.myPeerId;
          return `
            <div class="mvp-row ${isMe ? 'is-me' : ''}" style="border-left-color:${m.color}">
              <div class="mvp-agent">
                <img src="${cls.sprite}" width="26" height="26" alt="" />
                <div>
                  <strong>${m.callsign}${isMe ? I18n.t('meSuffix') : ''}</strong>
                  <span class="mvp-title-tag" style="background:${badgeColor}">${badge}</span>
                </div>
              </div>
              <div class="mvp-metrics">
                <span>💀 ${m.kills}</span>
                <span>💉 ${m.revives}</span>
                <span>🔨 ${m.repairs}</span>
                <span>🚪 $${m.doorFunded}</span>
              </div>
            </div>
          `;
        })
        .join('');

      const curStageIdx = STAGES.findIndex((item) => item.id === s.stage.id);
      const nextStage = victory && curStageIdx >= 0 && curStageIdx + 1 < STAGES.length ? STAGES[curStageIdx + 1] : s.stage;
      const isHost = CoopManager.role === 'host' && CoopManager.lobby !== null;

      this.modalRoot.innerHTML = `
        <div class="popup-backdrop">
          <div class="popup-box coop-settle-modal">
            <h2>${victory ? I18n.t('victoryTitle') : I18n.t('settleTitle')}</h2>
            <p class="popup-sub">${I18n.t('downedSub', { w: s.wave, k: s.kills })}</p>

            <div class="reward-preview compact">
              <span><img class="inline-coin" src="./assets/ui_coin.png" alt="" /> <strong>+${baseGold}</strong></span>
              <span><img class="inline-coin" src="./assets/drop_xp.png" alt="" /> <strong>+${baseXp} XP</strong></span>
              ${bonusCores > 0 ? `<span><strong>💠 +${bonusCores}</strong></span>` : ''}
            </div>

            <div class="mvp-board-box">
              <div class="mvp-board-head">${I18n.t('mvpBoardTitle')}</div>
              <div class="mvp-rows-wrap">${mvpRowsHtml}</div>
            </div>

            <div class="popup-footer">
              ${
                isHost
                  ? `<button class="btn-cartoon btn-green" id="btn-coop-next-stage" type="button">${victory && nextStage.id !== s.stage.id ? I18n.t('coopNextStageBtn') : I18n.t('coopRematchBtn')}</button>`
                  : ''
              }
              <button class="btn-cartoon btn-blue" id="btn-coop-back-lobby" type="button">${I18n.t('normalClaimBtn')}</button>
            </div>
          </div>
        </div>
      `;

      const nextBtn = this.modalRoot.querySelector('#btn-coop-next-stage') as HTMLButtonElement | null;
      if (nextBtn) {
        this.bindModalTap(nextBtn, () => {
          nextBtn.disabled = true;
          const nextTier: DifficultyTier = nextStage.id === s.stage.id ? s.difficultyTier : 1;
          CoopManager.hostLaunchNextStage(nextStage.id, s.mode, nextTier);
        });
      }

      const backBtn = this.modalRoot.querySelector('#btn-coop-back-lobby') as HTMLButtonElement;
      this.bindModalTap(backBtn, () => {
        backBtn.disabled = true;
        if (CoopManager.role !== 'offline' && CoopManager.lobby) {
          CoopManager.returnSquadToLobby();
          this.hubTab = 'coop';
        }
        this.showHomeHub();
      });
      return;
    }

    const zones = [2, 3, 5, 3, 2];

    this.modalRoot.innerHTML = `
      <div class="popup-backdrop">
        <div class="popup-box compact-modal">
          <h2>${victory ? I18n.t(isTut ? 'tutVictoryTitle' : 'victoryTitle') : I18n.t('settleTitle')}</h2>
          <p class="popup-sub">${I18n.t('downedSub', { w: s.wave, k: s.kills })}</p>

          <div class="reward-preview">
            <span><img class="inline-coin" src="./assets/ui_coin.png" alt="" /> <strong id="rew-gold">+${baseGold}</strong></span>
            <span><img class="inline-coin" src="./assets/drop_xp.png" alt="" /> <strong id="rew-xp">+${baseXp} XP</strong></span>
            ${bonusCores > 0 ? `<span><strong>💠 +${bonusCores}</strong></span>` : ''}
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
      if (CoopManager.role === 'offline' && !isTut) {
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
