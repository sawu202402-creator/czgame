import { SoundFX } from '../audio/SoundFX';
import { POWERUP_META, RELICS } from '../data/perksAndRelics';
import { STAGES } from '../data/stages';
import { WEAPON_LIST, WEAPONS } from '../data/weapons';
import { RunSnapshot } from '../game/Entities';
import { GameEngine } from '../game/GameEngine';
import { SaveManager, UPGRADE_TRACKS } from '../meta/SaveManager';
import { PlatformSDK } from '../platform/PlatformSDK';
import { GameMode, InRunPerkDef, PowerUpType, RelicDef, StageDef } from '../types';

export class UIManager {
  private hudRoot: HTMLElement | null = null;
  private modalRoot: HTMLElement;
  private needleAnimId = 0;
  private armoryOpen = false;
  private hudCache: Record<string, string> = {};
  private wepDomRefs: { btn: HTMLButtonElement; nameEl: HTMLElement; ammoEl: HTMLElement }[] = [];

  constructor(
    private uiLayer: HTMLElement,
    private engine: GameEngine
  ) {
    this.modalRoot = document.createElement('div');
    this.modalRoot.className = 'modal-host';
    this.uiLayer.appendChild(this.modalRoot);
  }

  public showHomeHub(): void {
    cancelAnimationFrame(this.needleAnimId);
    this.armoryOpen = false;
    this.engine.modalPaused = false;
    this.engine.paused = false;
    this.hudRoot?.remove();
    this.hudRoot = null;
    this.engine.state = null;

    const save = SaveManager.get();
    const xpNext = SaveManager.xpForNextLevel(save.agentLevel);
    const xpPct = Math.min(100, Math.round((save.agentXp / xpNext) * 100));

    const upgradesHtml = UPGRADE_TRACKS.map((t) => {
      const lvl = save.upgrades[t.key];
      const isMax = lvl >= t.maxLevel;
      const cost = SaveManager.getUpgradeCost(t.key);
      const canBuy = !isMax && save.gold >= cost;
      return `
        <div class="upgrade-card">
          <div class="upg-top">
            <span class="upg-icon">${t.icon}</span>
            <div class="upg-info">
              <div class="upg-title">${t.name} <small>Lv.${lvl}/${t.maxLevel}</small></div>
              <div class="upg-val">${t.valueText(lvl)}</div>
            </div>
          </div>
          <div class="upg-desc">${t.desc}</div>
          <button class="btn-cartoon ${isMax ? 'btn-gray' : canBuy ? 'btn-yellow' : 'btn-disabled'}"
            data-upg="${t.key}" ${!canBuy ? 'disabled' : ''}>
            ${isMax ? '已满级 MAX' : `🪙 ${cost} 升级`}
          </button>
        </div>
      `;
    }).join('');

    const stagesHtml = STAGES.map((st) => {
      const selfCleared = save.clearedStages.includes(st.id);
      const bestEndless = save.endlessBestWave[st.id] || 0;

      return `
        <div class="stage-card">
          <div class="stage-badge">${selfCleared ? '✅ 已通关 10 波' : '🔓 全关卡已开放测试'}</div>
          <h3>${st.name}</h3>
          <p>${st.subtitle}</p>
          <div class="stage-actions">
            <button class="btn-cartoon btn-green" data-stage="${st.id}" data-mode="standard">
              🚁 10波撤离模式
            </button>
            <button class="btn-cartoon btn-purple" data-stage="${st.id}" data-mode="endless">
              ♾️ 无尽模式${bestEndless > 0 ? ` (最高 ${bestEndless} 波)` : ''}
            </button>
          </div>
        </div>
      `;
    }).join('');

    this.modalRoot.innerHTML = `
      <div class="hub-screen">
        <header class="hub-header">
          <div class="brand-block">
            <h1>🧟 僵尸防线大作战</h1>
            <span class="brand-sub">类 SAS: Zombie Assault 2 战术房间防守 · 独立军火商店版</span>
          </div>
          <div class="agent-bar">
            <div class="agent-badge">🎖️ 特工 Lv.${save.agentLevel} <small>(全枪伤 +${(save.agentLevel - 1) * 4}%)</small></div>
            <div class="xp-track"><div class="xp-fill" style="width:${xpPct}%"></div><span>XP ${save.agentXp}/${xpNext}</span></div>
            <div class="gold-pill">🪙 ${save.gold} 金币</div>
          </div>
        </header>

        <div class="hub-grid">
          <section class="hub-panel">
            <div class="hero-banner-card">
              <img src="./assets/hub_banner.jpg" alt="僵尸防线大作战" class="hero-banner-img" />
              <div class="hero-banner-caption">
                <img src="./assets/player_hero.png" alt="Hero" class="hero-mini-avatar" />
                <div>
                  <strong>近景特写视角 · 不规则战术建筑 · 9大枪械军火库！</strong>
                  <div>按 B 键或踩终端随时打开军火商店买枪、买手雷、升超武</div>
                </div>
              </div>
            </div>
            <h2>⚡ 特工永久属性强化</h2>
            <div class="upgrade-list">${upgradesHtml}</div>
          </section>
          <section class="hub-panel">
            <h2>🗺️ 选择行动地图 (3张差异化建筑关卡)</h2>
            <div class="stage-list">${stagesHtml}</div>
            <div class="controls-tip">
              💡 <strong>操作指南</strong>：<code>WASD</code> 移动，鼠标瞄准射击，<strong><code>B</code> 键打开【军火商店】买枪</strong>，<code>G</code> 或右键扔破片手雷，<code>Q</code> 切枪，<code>R</code> 换弹；左下角配备实时雷达小地图！
            </div>
          </section>
        </div>
      </div>
    `;

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-upg]').forEach((btn) => {
      btn.onclick = () => {
        const key = btn.dataset.upg as keyof typeof save.upgrades;
        if (SaveManager.buyUpgrade(key)) {
          SoundFX.fanfare();
          this.showHomeHub();
        }
      };
    });

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-stage]').forEach((btn) => {
      btn.onclick = () => {
        const st = STAGES.find((item) => item.id === btn.dataset.stage)!;
        const mode = btn.dataset.mode as GameMode;
        this.startStageRun(st, mode);
      };
    });
  }

  public startStageRun(stage: StageDef, mode: GameMode): void {
    this.armoryOpen = false;
    this.modalRoot.innerHTML = '';
    this.mountHUD();
    this.engine.startRun(stage, mode);
  }

  private mountHUD(): void {
    this.hudRoot?.remove();
    this.hudCache = {};
    this.wepDomRefs = [];
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const hud = document.createElement('div');
    hud.className = 'hud-overlay';
    hud.innerHTML = `
      <div class="screen-vignette" id="hud-vignette"></div>
      <div class="hud-top">
        <div class="hud-left">
          <div class="bar-box hp-box">
            <div class="bar-fill hp-fill" id="hud-hp-fill"></div>
            <span id="hud-hp-text">❤️ 100 / 100</span>
          </div>
          <div class="bar-box armor-box" id="hud-armor-box" style="display:none">
            <div class="bar-fill armor-fill" id="hud-armor-fill"></div>
            <span id="hud-armor-text">🦺 护甲 0</span>
          </div>
          <div class="bar-box lv-box">
            <div class="bar-fill lv-fill" id="hud-lv-fill"></div>
            <span id="hud-lv-text">⚔️ 战斗 Lv.1</span>
          </div>
          <div class="relic-row" id="hud-relics"></div>
        </div>

        <div class="hud-center">
          <div class="wave-pill" id="hud-wave">第 1 / 10 波</div>
          <div class="boss-bar-wrap" id="hud-boss-box" style="display:none">
            <div class="boss-bar-fill" id="hud-boss-fill"></div>
            <span id="hud-boss-text">👑 狂暴尸王</span>
          </div>
          <div class="fever-wrap">
            <div class="fever-fill" id="hud-fever-fill"></div>
            <span id="hud-fever-text">🌈 连杀狂热 FEVER</span>
          </div>
          <div class="powerup-row" id="hud-powerups"></div>
        </div>

        <div class="hud-right">
          <div class="cash-pill" id="hud-cash">💵 $80</div>
          <div class="mini-btns">
            <button class="btn-cartoon btn-mini btn-blue" id="btn-autofire">🎯 自动射击</button>
            <button class="btn-cartoon btn-mini btn-gray" id="btn-mute">🔊</button>
            <button class="btn-cartoon btn-mini btn-gray" id="btn-home">🏠 基地</button>
          </div>
        </div>
      </div>

      <div class="hud-banner" id="hud-banner"></div>

      <div class="hq-support-dock">
        <button class="btn-cartoon btn-support" id="btn-ad-turret">
          🛰️ 呼叫满弹+机枪塔 <small id="tag-ad-turret">🎁免费</small>
        </button>
        <button class="btn-cartoon btn-support btn-elec" id="btn-ad-elec">
          ⚡ 全窗升高压电网 <small>🎬支援</small>
        </button>
      </div>

      <div class="hud-bottom">
        <button class="btn-cartoon btn-green btn-armory-open" id="btn-open-armory">
          ${isTouch ? '🛒 军火商店' : '🛒 军火商店 (B)'}
        </button>
        <div class="weapon-slots" id="hud-weapons"></div>
        <button class="btn-cartoon btn-mini btn-orange" id="btn-grenade">${isTouch ? '💣 手雷 x2' : '💣 手雷 x2 (G)'}</button>
        <button class="btn-cartoon btn-mini btn-yellow" id="btn-reload">${isTouch ? '🔄 换弹' : '🔄 换弹 (R)'}</button>
      </div>
    `;
    this.uiLayer.appendChild(hud);
    this.hudRoot = hud;

    const autoBtn = hud.querySelector('#btn-autofire') as HTMLButtonElement;
    const syncAutoBtn = () => {
      autoBtn.textContent = this.engine.input.autoFireEnabled ? '🎯 自动开火: 开' : '🖱️ 手动瞄准';
      autoBtn.className = `btn-cartoon btn-mini ${this.engine.input.autoFireEnabled ? 'btn-green' : 'btn-blue'}`;
    };
    syncAutoBtn();
    autoBtn.onclick = () => {
      this.engine.input.autoFireEnabled = !this.engine.input.autoFireEnabled;
      syncAutoBtn();
    };

    const muteBtn = hud.querySelector('#btn-mute') as HTMLButtonElement;
    muteBtn.onclick = () => {
      const muted = SoundFX.toggleUserMute();
      muteBtn.textContent = muted ? '🔇' : '🔊';
    };

    (hud.querySelector('#btn-home') as HTMLButtonElement).onclick = () => {
      PlatformSDK.gameplayStop();
      this.showHomeHub();
    };

    (hud.querySelector('#btn-open-armory') as HTMLButtonElement).onclick = () => {
      this.toggleArmoryShop();
    };

    (hud.querySelector('#btn-grenade') as HTMLButtonElement).onclick = () => {
      this.engine.throwGrenade();
    };

    (hud.querySelector('#btn-reload') as HTMLButtonElement).onclick = () => {
      this.engine.startReload();
    };

    (hud.querySelector('#btn-ad-turret') as HTMLButtonElement).onclick = async () => {
      const s = this.engine.state;
      if (!s || s.hqSupportCooldown > 0 || this.engine.modalPaused) return;
      const save = SaveManager.get();
      if (!save.freeHqSupportUsed) {
        save.freeHqSupportUsed = true;
        SaveManager.save();
        this.engine.applyHqAmmoAndTurret();
      } else {
        this.engine.modalPaused = true;
        this.engine.input.resetStates();
        const ok = await PlatformSDK.showRewardedAd('hq_ammo_turret', '满弹药 + 自动哨戒机枪塔');
        this.engine.modalPaused = false;
        if (ok) this.engine.applyHqAmmoAndTurret();
      }
    };

    (hud.querySelector('#btn-ad-elec') as HTMLButtonElement).onclick = async () => {
      const s = this.engine.state;
      if (!s || s.electricFortifyWaves > 0 || this.engine.modalPaused) return;
      this.engine.modalPaused = true;
      this.engine.input.resetStates();
      const ok = await PlatformSDK.showRewardedAd('electric_fortify', '全图高压电网加固 (持续2波)');
      this.engine.modalPaused = false;
      if (ok) this.engine.applyElectricFortify();
    };
  }

  // ==================== 独立 SAS2 风格军火商店界面 ====================

  public toggleArmoryShop(): void {
    const s = this.engine.state;
    if (!s || s.waveState === 'ended') return;

    if (this.armoryOpen) {
      this.armoryOpen = false;
      this.modalRoot.innerHTML = '';
      this.engine.modalPaused = false;
      this.engine.flushQueuedModals();
      return;
    }

    // 若当前已有其他弹窗（升级三选一/复活/宝物箱）则不覆盖
    if (this.engine.modalPaused) return;

    this.armoryOpen = true;
    this.engine.modalPaused = true;
    this.engine.input.resetStates();
    this.renderArmoryShop("");
  }

  private renderArmoryShop(toastMsg: string): void {
    const s = this.engine.state;
    if (!s) return;

    const unlockedRooms = this.engine.getUnlockedExtraRoomsCount();
    const activeWep = s.player.weapons[s.player.activeSlot];
    const activeDef = WEAPONS[activeWep.defId];

    const gunCards = WEAPON_LIST.map((w) => {
      const owned = s.player.weapons.find((inst) => inst.defId === w.id);
      const isEquipped = activeWep.defId === w.id;
      const locked = unlockedRooms < w.unlockRoomsRequired;

      const dmgPct = Math.min(100, Math.round(((w.damage * w.pellets) / 175) * 100));
      const ratePct = Math.min(100, Math.round((w.fireRate / 15) * 100));

      let btnLabel = `💵 $${w.shopCost} 购买`;
      let btnClass = s.cash >= w.shopCost ? 'btn-green' : 'btn-disabled';
      if (locked) {
        btnLabel = `🔒 需在地图开门解锁 ${w.unlockRoomsRequired} 个新区域`;
        btnClass = 'btn-disabled';
      } else if (owned) {
        if (w.maxReserve < 0) {
          btnLabel = isEquipped ? '✅ 当前装备中' : '切换装备';
          btnClass = isEquipped ? 'btn-gray' : 'btn-blue';
        } else {
          const maxRes = w.maxReserve * (owned.evolved ? 2 : 1);
          const full = owned.reserve >= maxRes && owned.mag >= this.engine.getMaxMag(w.id, owned.evolved);
          if (full) {
            btnLabel = isEquipped ? '✅ 弹药已满' : '切换上阵';
            btnClass = isEquipped ? 'btn-gray' : 'btn-blue';
          } else {
            btnLabel = `📦 补满弹药 $${w.ammoCost}`;
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
              <div class="gun-stats-mini">
                <span>威力 <i style="width:${dmgPct}%"></i></span>
                <span>射速 <i style="width:${ratePct}%;background:#38bdf8"></i></span>
              </div>
            </div>
          </div>
          <div class="gun-desc">${owned?.evolved ? w.superDesc : w.desc}</div>
          <button class="btn-cartoon btn-mini ${btnClass}" data-buy-gun="${w.id}" ${locked ? 'disabled' : ''}>
            ${btnLabel}
          </button>
        </div>
      `;
    }).join('');

    const canEvolve = !activeWep.evolved && s.cash >= 1850;

    this.modalRoot.innerHTML = `
      <div class="popup-backdrop">
        <div class="armory-modal">
          <header class="armory-header">
            <div class="armory-title-wrap">
              <img src="./assets/prop_armory_kiosk.png" alt="Shop" class="armory-logo" />
              <div>
                <h2>🔫 特警战术军火库 (SAS Armory)</h2>
                <span>已开门拓展防区：${unlockedRooms} 个 · 花钱开门拓展新房间才能授权解锁重武器！</span>
              </div>
            </div>
            <div class="armory-wallet">
              <div class="cash-pill">💵 $${s.cash}</div>
              <button class="btn-cartoon btn-mini btn-yellow" id="btn-armory-ad" ${s.armoryAdCooldown > 0 ? 'disabled' : ''}>
                ${s.armoryAdCooldown > 0 ? `🎬 军费冷却(${s.armoryAdCooldown.toFixed(0)}s)` : '🎬 紧急空投 +$450'}
              </button>
              <button class="btn-cartoon btn-mini btn-gray" id="btn-close-armory">✖ 继续战斗</button>
            </div>
          </header>

          ${toastMsg ? `<div class="armory-toast">${toastMsg}</div>` : ''}

          <div class="armory-gun-grid">${gunCards}</div>

          <footer class="armory-tactical-bar">
            <button class="btn-cartoon ${canEvolve ? 'btn-purple' : 'btn-disabled'}" id="btn-shop-evolve" ${activeWep.evolved ? 'disabled' : ''}>
              ${activeWep.evolved ? `✅ 已觉醒【${activeDef.superName}】` : `⚡ 觉醒【${activeDef.superName}】($1850)`}
            </button>
            <button class="btn-cartoon btn-blue" data-tac="armor">🦺 防弹护甲+65 ($380) [${Math.round(s.player.armor)}/100]</button>
            <button class="btn-cartoon btn-yellow" data-tac="grenades">💣 破片手雷x3 ($220) [x${s.player.grenades}]</button>
            <button class="btn-cartoon btn-blue" data-tac="all_ammo">📦 全枪满弹 ($320)</button>
            <button class="btn-cartoon btn-green" data-tac="medkit">❤️ 急救满血 ($300)</button>
            <button class="btn-cartoon btn-yellow" data-tac="turret">🛰️ 自动哨戒炮 ($650)</button>
          </footer>
        </div>
      </div>
    `;

    (this.modalRoot.querySelector('#btn-close-armory') as HTMLButtonElement).onclick = () => {
      this.toggleArmoryShop();
    };

    (this.modalRoot.querySelector('#btn-armory-ad') as HTMLButtonElement).onclick = async () => {
      if (s.armoryAdCooldown > 0) return;
      const ok = await PlatformSDK.showRewardedAd('armory_free_cash', '军火库紧急军费空投 +$450');
      if (ok) {
        s.cash += 450;
        s.armoryAdCooldown = 90;
        PlatformSDK.gameplayStart();
        this.renderArmoryShop('💰 总部紧急军费 +$450 已到账！');
      }
    };

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-buy-gun]').forEach((btn) => {
      btn.onclick = () => {
        const res = this.engine.buyOrRefillWeaponFromShop(btn.dataset.buyGun!);
        this.renderArmoryShop(res.msg);
      };
    });

    (this.modalRoot.querySelector('#btn-shop-evolve') as HTMLButtonElement).onclick = () => {
      const res = this.engine.evolveActiveWeaponInShop(1850);
      this.renderArmoryShop(res.msg);
    };

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-tac]').forEach((btn) => {
      btn.onclick = () => {
        const item = btn.dataset.tac as 'grenades' | 'medkit' | 'turret' | 'all_ammo' | 'armor';
        const res = this.engine.buyShopTacticalItem(item);
        this.renderArmoryShop(res.msg);
      };
    });
  }

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

    const hpTextStr = `❤️ ${Math.ceil(s.player.hp)} / ${s.player.maxHp}`;
    setIfChanged('hp', hpTextStr, () => {
      const hpFill = this.hudRoot!.querySelector('#hud-hp-fill') as HTMLElement;
      const hpText = this.hudRoot!.querySelector('#hud-hp-text') as HTMLElement;
      hpFill.style.width = `${Math.max(0, (s.player.hp / s.player.maxHp) * 100)}%`;
      hpText.textContent = hpTextStr;
    });

    const armorVal = Math.round(s.player.armor);
    setIfChanged('armor', `${armorVal}`, () => {
      const armorBox = this.hudRoot!.querySelector('#hud-armor-box') as HTMLElement;
      if (armorVal > 0) {
        armorBox.style.display = 'block';
        (this.hudRoot!.querySelector('#hud-armor-fill') as HTMLElement).style.width = `${Math.min(100, armorVal)}%`;
        (this.hudRoot!.querySelector('#hud-armor-text') as HTMLElement).textContent = `🦺 护甲 ${armorVal}`;
      } else {
        armorBox.style.display = 'none';
      }
    });

    const lvStr = `${s.battleLevel}|${s.battleXp}|${s.battleXpNext}`;
    setIfChanged('lv', lvStr, () => {
      const lvFill = this.hudRoot!.querySelector('#hud-lv-fill') as HTMLElement;
      const lvText = this.hudRoot!.querySelector('#hud-lv-text') as HTMLElement;
      lvFill.style.width = `${Math.min(100, (s.battleXp / s.battleXpNext) * 100)}%`;
      lvText.textContent = `⚔️ 局内 Lv.${s.battleLevel}`;
    });

    let waveStr = '';
    if (s.waveState === 'extraction') {
      waveStr = `🚁 撤离中 (${Math.round(s.extractionProgress * 100)}%)`;
    } else if (s.waveState === 'intermission') {
      waveStr = `⏳ 备战买枪 ${s.intermissionTimer.toFixed(1)}s (下波: ${s.wave + 1})`;
    } else {
      const waveLabel = s.mode === 'standard' ? `第 ${s.wave}/${s.maxWaves} 波` : `♾️ 第 ${s.wave} 波`;
      waveStr = `${waveLabel} · 剩余 ${s.zombiesRemainingInWave}`;
    }
    setIfChanged('wave', waveStr, () => {
      (this.hudRoot!.querySelector('#hud-wave') as HTMLElement).textContent = waveStr;
    });

    // 顶部 Boss / 重装暴君醒目血条
    const bossTarget =
      s.zombies.find((z) => z.kind === 'boss') || s.zombies.find((z) => z.kind === 'miniboss');
    const bossKey = bossTarget ? `${bossTarget.id}:${Math.ceil(bossTarget.hp)}` : 'none';
    setIfChanged('bossHud', bossKey, () => {
      const bossBox = this.hudRoot!.querySelector('#hud-boss-box') as HTMLElement;
      if (bossTarget) {
        bossBox.style.display = 'block';
        const pct = Math.max(0, (bossTarget.hp / bossTarget.maxHp) * 100);
        (this.hudRoot!.querySelector('#hud-boss-fill') as HTMLElement).style.width = `${pct}%`;
        const title = bossTarget.kind === 'boss' ? '👑 狂暴尸王' : '🛡️ 重装暴君';
        (this.hudRoot!.querySelector('#hud-boss-text') as HTMLElement).textContent =
          `${title} ${Math.ceil(bossTarget.hp)} / ${Math.round(bossTarget.maxHp)}`;
      } else {
        bossBox.style.display = 'none';
      }
    });

    const feverKey = s.feverTimer > 0 ? `F:${s.feverTimer.toFixed(1)}` : `N:${Math.round(s.fever)}`;
    setIfChanged('fever', feverKey, () => {
      const feverFill = this.hudRoot!.querySelector('#hud-fever-fill') as HTMLElement;
      const feverText = this.hudRoot!.querySelector('#hud-fever-text') as HTMLElement;
      if (s.feverTimer > 0) {
        feverFill.style.width = `${(s.feverTimer / 6.5) * 100}%`;
        feverFill.classList.add('fever-active');
        feverText.textContent = `🔥 狂暴 ${s.feverTimer.toFixed(1)}s!`;
      } else {
        feverFill.style.width = `${s.fever}%`;
        feverFill.classList.remove('fever-active');
        feverText.textContent = `🌈 狂热 ${Math.round(s.fever)}%`;
      }
    });

    const cashStr = `💵 $${s.cash}`;
    setIfChanged('cash', cashStr, () => {
      (this.hudRoot!.querySelector('#hud-cash') as HTMLElement).textContent = cashStr;
    });

    const pulseShop = s.waveState === 'intermission' || (s.player.weapons.length === 1 && s.cash >= 420) ? '1' : '0';
    setIfChanged('pulseShop', pulseShop, () => {
      (this.hudRoot!.querySelector('#btn-open-armory') as HTMLButtonElement).classList.toggle(
        'shop-pulse',
        pulseShop === '1'
      );
    });

    const grenStr = this.engine.input.usingTouch ? `💣 手雷 x${s.player.grenades}` : `💣 手雷 x${s.player.grenades} (G)`;
    setIfChanged('gren', grenStr, () => {
      const grenBtn = this.hudRoot!.querySelector('#btn-grenade') as HTMLButtonElement;
      grenBtn.textContent = grenStr;
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
          return r ? `<span class="relic-chip" title="${r.name}: ${r.desc}">${r.icon}</span>` : '';
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

    const save = SaveManager.get();
    const turretStr =
      s.hqSupportCooldown > 0
        ? `CD:${s.hqSupportCooldown.toFixed(0)}`
        : `OK:${save.freeHqSupportUsed ? '1' : '0'}`;
    setIfChanged('turretBtn', turretStr, () => {
      const turretBtn = this.hudRoot!.querySelector('#btn-ad-turret') as HTMLButtonElement;
      if (s.hqSupportCooldown > 0) {
        turretBtn.disabled = true;
        turretBtn.innerHTML = `🛰️ 冷却 (${s.hqSupportCooldown.toFixed(0)}s)`;
      } else {
        turretBtn.disabled = false;
        turretBtn.innerHTML = `🛰️ 满弹+炮塔 <small>${save.freeHqSupportUsed ? '🎬' : '🎁免费'}</small>`;
      }
    });

    const elecStr = `${s.electricFortifyWaves}`;
    setIfChanged('elecBtn', elecStr, () => {
      const elecBtn = this.hudRoot!.querySelector('#btn-ad-elec') as HTMLButtonElement;
      elecBtn.disabled = s.electricFortifyWaves > 0;
      elecBtn.innerHTML =
        s.electricFortifyWaves > 0
          ? `⚡ 电网 (${s.electricFortifyWaves}波)`
          : `⚡ 全窗电网 <small>🎬</small>`;
    });

    // 武器槽结构仅在换新枪或超武进阶时重建一次 DOM，彻底告别每 80ms 销毁重建 <img> 导致的卡顿！
    const wepStructSig = s.player.weapons.map((w) => `${w.defId}:${w.evolved ? 1 : 0}`).join('|');
    setIfChanged('wepStruct', wepStructSig, () => {
      const wContainer = this.hudRoot!.querySelector('#hud-weapons') as HTMLElement;
      wContainer.innerHTML = s.player.weapons
        .map((w, idx) => {
          const def = WEAPONS[w.defId];
          const name = w.evolved ? `⚡${def.superName}` : def.name;
          return `
            <button class="wep-slot ${w.evolved ? 'evolved' : ''}" data-slot="${idx}">
              <img src="./assets/gun_${w.defId}.png" alt="${name}" class="wep-icon" />
              <div class="wep-meta">
                <div class="wep-name">[${idx + 1}] ${name}</div>
                <div class="wep-ammo"></div>
              </div>
            </button>
          `;
        })
        .join('');

      this.wepDomRefs = Array.from(wContainer.querySelectorAll<HTMLButtonElement>('[data-slot]')).map((btn) => {
        btn.onclick = () => this.engine.switchWeapon(Number(btn.dataset.slot));
        return {
          btn,
          nameEl: btn.querySelector('.wep-name') as HTMLElement,
          ammoEl: btn.querySelector('.wep-ammo') as HTMLElement,
        };
      });
    });

    // 轻量更新弹药数字与当前选中高亮
    s.player.weapons.forEach((w, idx) => {
      const ref = this.wepDomRefs[idx];
      if (!ref) return;
      const active = idx === s.player.activeSlot;
      ref.btn.classList.toggle('active', active);
      const ammoStr =
        s.player.reloadTimer > 0 && active
          ? '换弹中...'
          : w.reserve < 0
            ? `${w.mag} / ∞`
            : `${w.mag} / ${w.reserve}`;
      if (ref.ammoEl.textContent !== ammoStr) {
        ref.ammoEl.textContent = ammoStr;
      }
    });
  }

  // ==================== 升级三选一 / 宝物箱 / 复活 / 结算动态转盘 ====================

  public showLevelUpChoices(choices: InRunPerkDef[], onPick: (perk: InRunPerkDef) => void): void {
    this.armoryOpen = false;
    const cards = choices
      .map(
        (c, idx) => `
        <button class="choice-card" data-idx="${idx}" style="border-color:${c.color}">
          <div class="choice-icon">${c.icon}</div>
          <h3>${c.name}</h3>
          <p>${c.desc}</p>
          <span class="choice-tag">点击选择</span>
        </button>
      `
      )
      .join('');

    this.modalRoot.innerHTML = `
      <div class="popup-backdrop">
        <div class="popup-box">
          <h2>🆙 战斗等级提升！选择一项战术强化</h2>
          <div class="choice-grid">${cards}</div>
        </div>
      </div>
    `;

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-idx]').forEach((btn) => {
      btn.onclick = () => {
        const perk = choices[Number(btn.dataset.idx)];
        this.modalRoot.innerHTML = '';
        onPick(perk);
      };
    });
  }

  public showTreasureChestModal(
    choices: RelicDef[],
    onPickOne: (r: RelicDef) => void,
    onTakeAllAd: () => Promise<boolean>
  ): void {
    this.armoryOpen = false;
    const cards = choices
      .map(
        (c, idx) => `
        <button class="choice-card relic-${c.rarity}" data-idx="${idx}">
          <div class="choice-icon">${c.icon}</div>
          <h3>${c.name}</h3>
          <p>${c.desc}</p>
          <span class="choice-tag">免费领这件</span>
        </button>
      `
      )
      .join('');

    this.modalRoot.innerHTML = `
      <div class="popup-backdrop">
        <div class="popup-box">
          <h2>🎁 发现房间神秘宝物箱！</h2>
          <p class="popup-sub">任选 1 件本局永久生效的奇物，或呼叫支援全部带走！</p>
          <div class="choice-grid">${cards}</div>
          ${
            choices.length > 1
              ? `<div class="popup-footer">
                  <button class="btn-cartoon btn-yellow btn-large" id="btn-relic-all">
                    🎬 看广告 · 2 件奇物全都要！
                  </button>
                </div>`
              : ''
          }
        </div>
      </div>
    `;

    this.modalRoot.querySelectorAll<HTMLButtonElement>('[data-idx]').forEach((btn) => {
      btn.onclick = () => {
        const picked = choices[Number(btn.dataset.idx)];
        this.modalRoot.innerHTML = '';
        onPickOne(picked);
      };
    });

    const allBtn = this.modalRoot.querySelector('#btn-relic-all') as HTMLButtonElement | null;
    if (allBtn) {
      allBtn.onclick = async () => {
        allBtn.disabled = true;
        const ok = await onTakeAllAd();
        if (ok) {
          this.modalRoot.innerHTML = '';
        } else {
          allBtn.disabled = false;
        }
      };
    }
  }

  public showReviveModal(canRevive: boolean): void {
    this.armoryOpen = false;
    const s = this.engine.state!;
    if (!canRevive) {
      s.waveState = 'ended';
      this.showSettlementModal(false, s);
      return;
    }

    this.modalRoot.innerHTML = `
      <div class="popup-backdrop">
        <div class="popup-box revive-box">
          <h2>🚨 防线失守 · 特工倒地！</h2>
          <p class="popup-sub">当前已坚持到 <strong>第 ${s.wave} 波</strong>，击败 <strong>${s.kills}</strong> 只僵尸！要呼叫紧急空投反击吗？</p>
          <div class="revive-perks">
            <span>⚡ 震飞眩晕全屏僵尸</span>
            <span>❤️ 满血 + 满弹药 + 2颗手雷</span>
            <span>🔨 全图破窗瞬间封死</span>
          </div>
          <div class="popup-footer">
            <button class="btn-cartoon btn-green btn-large" id="btn-do-revive">
              🎬 看广告 · 呼叫震爆空投复活！
            </button>
            <button class="btn-cartoon btn-gray" id="btn-skip-revive">
              放弃复活，直接结算领奖
            </button>
          </div>
        </div>
      </div>
    `;

    (this.modalRoot.querySelector('#btn-do-revive') as HTMLButtonElement).onclick = async () => {
      const ok = await PlatformSDK.showRewardedAd('revive_shockwave', '绝境震爆复活 + 全窗加固');
      if (ok) {
        this.modalRoot.innerHTML = '';
        this.engine.modalPaused = false;
        this.engine.applyTacticalRevive();
        this.engine.flushQueuedModals();
      }
    };

    (this.modalRoot.querySelector('#btn-skip-revive') as HTMLButtonElement).onclick = () => {
      s.waveState = 'ended';
      this.showSettlementModal(false, s);
    };
  }

  public showSettlementModal(victory: boolean, s: RunSnapshot): void {
    this.armoryOpen = false;
    const baseGold = Math.round(25 + s.wave * 14 + Math.min(220, s.kills * 0.45) + (victory ? 110 : 0));
    const baseXp = Math.round(30 + s.wave * 16 + Math.min(260, s.kills * 0.65) + (victory ? 100 : 0));
    const zones = [2, 3, 5, 3, 2];

    this.modalRoot.innerHTML = `
      <div class="popup-backdrop">
        <div class="popup-box settle-box">
          <h2>${victory ? '🚁 撤离成功 · 完美通关！' : '🎖️ 战斗结算报告'}</h2>
          <p class="popup-sub">
            ${
              victory
                ? `恭喜攻克【${s.stage.name}】！本关【♾️ 无尽模式】与下一张建筑地图已解锁！`
                : `本局坚守至 第 ${s.wave} 波 · 共歼灭 ${s.kills} 只僵尸`
            }
          </p>

          <div class="reward-preview">
            <div class="rew-item">🪙 基础金币: <strong id="rew-gold">+${baseGold}</strong></div>
            <div class="rew-item">🎖️ 特工经验: <strong id="rew-xp">+${baseXp} XP</strong></div>
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
            <button class="btn-cartoon btn-yellow btn-large" id="btn-mult-claim">
              🎬 看广告定格指针 · 翻倍领取 (<span id="mult-live">x5</span>)
            </button>
            <button class="btn-cartoon btn-gray" id="btn-normal-claim">
              普通领取 x1 返回基地
            </button>
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
      multLive.textContent = `x${currentMult} · +${baseGold * currentMult}🪙`;
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
