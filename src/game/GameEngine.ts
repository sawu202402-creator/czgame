import { SoundFX } from '../audio/SoundFX';
import {
  ZOMBIE_COLOR_BY_KIND,
  ZOMBIE_RADIUS_BY_KIND,
  getBossProfile,
  getStageBossKind,
  isBossKind,
} from '../data/enemies';
import { IN_RUN_PERKS, POWERUP_META, RELICS } from '../data/perksAndRelics';
import { WEAPONS } from '../data/weapons';
import { I18n } from '../i18n/I18n';
import { SaveManager } from '../meta/SaveManager';
import { CoopManager } from '../net/CoopManager';
import {
  CoopNetMessage,
  PlayerSyncPayload,
  RemotePlayerState,
  SQUAD_SLOTS,
  SerializedBullet,
  WorldSyncPayload,
  getCoopScaling,
} from '../net/CoopProtocol';
import { PlatformSDK } from '../platform/PlatformSDK';
import { getAgentClassDef, getLocalizedClassText } from '../meta/ProgressionDefs';
import { GameMode, InRunPerkDef, PowerUpType, Rect, StageDef } from '../types';
import {
  DropItem,
  RunSnapshot,
  RuntimeRoom,
  RuntimeStation,
  ZombieEntity,
  ZombieKind,
} from './Entities';
import { InputManager } from './InputManager';
import { CartoonRenderer } from './Renderer';

export interface EngineCallbacks {
  onToggleArmoryShop: () => void;
  onTogglePauseMenu: () => void;
  onPlayerDowned: (canRevive: boolean) => void;
  onRunFinished: (victory: boolean, snapshot: RunSnapshot) => void;
  onShowPerkChoices: (choices: InRunPerkDef[], level: number, onPick: (perk: InRunPerkDef) => void) => void;
}

export class GameEngine {
  public state: RunSnapshot | null = null;
  public paused = false;
  public modalPaused = false;
  public landscapePaused = false;
  private renderer = new CartoonRenderer();
  private nextEntityId = 1;

  private spawnQueue: ZombieKind[] = [];
  private spawnTimer = 0;
  private extractionSpawnTimer = 0;

  // 防重入死循环与弹窗串行队列（杜绝后期连环爆裂/闪电链越界与多弹窗并发互盖死锁！）
  private deadZombieIds = new Set<number>();
  private explosionDepth = 0;
  private pendingModals: (() => void)[] = [];

  // 56px 网格 BFS 流场寻路（支持任意不规则多边形房间、走廊与家具绕障！）
  private flowDist: Int16Array = new Int16Array(0);
  private walkableGrid: Uint8Array = new Uint8Array(0);
  private staticBlockers: Rect[] = [];
  private flowTimer = 0;
  private lastViewW = 1280;
  private lastViewH = 720;

  // 多人联机状态同步计时器与序列号
  private playerSyncTimer = 0;
  private playersFastTimer = 0;
  private worldSyncTimer = 0;
  private playerSyncSeq = 0;
  private worldSyncSeq = 0;
  private lastAppliedWorldSeq = 0;
  private localPlayerVx = 0;
  private localPlayerVy = 0;
  private pendingNetBullets: SerializedBullet[] = [];
  private pendingFireSfx = 'rifle';
  private pendingFireEvolved = false;
  private fireFlushTimer = 0;
  private reviveTickTimer = 0;
  private reviveTickTargetId = '';
  private reviveTickAccum = 0;
  private lastReviveTickAt = new Map<string, number>();
  private reviveSyncGraceUntil = new Map<string, number>();

  constructor(
    private canvas: HTMLCanvasElement,
    private ctx: CanvasRenderingContext2D,
    public input: InputManager,
    private callbacks: EngineCallbacks
  ) {
    CoopManager.bindEngine(
      (msg, fromPeerId) => this.handleCoopMessage(msg, fromPeerId),
      (peerId) => this.handlePeerLeave(peerId)
    );
    this.input.bindActions(
      (slot?: number) => this.switchWeapon(slot),
      () => this.startReload(),
      () => {
        if (this.state && this.state.waveState !== 'ended') {
          this.callbacks.onToggleArmoryShop();
        }
      },
      () => this.throwGrenade(),
      () => {
        if (this.state && this.state.waveState !== 'ended') {
          this.callbacks.onTogglePauseMenu();
        }
      },
      () => {
        this.quickBuyPrimaryAmmo();
      },
      () => {
        this.useActiveClassSkill();
      }
    );
  }

  public startRun(stage: StageDef, mode: GameMode): void {
    const pStats = SaveManager.getEffectivePlayerStats();
    const save = SaveManager.get();
    save.totalRuns += 1;
    SaveManager.save();

    const isCoop = CoopManager.isActiveCoop();
    const lobby = CoopManager.lobby;
    const squadCount = isCoop ? CoopManager.getSquadCount() : 1;
    const scaling = getCoopScaling(squadCount);
    const localSlot = isCoop ? CoopManager.mySlot : 0;
    const localCallsign = CoopManager.getCallsign();

    const spawnOffsets = [
      { dx: -26, dy: -22 },
      { dx: 26, dy: -22 },
      { dx: -26, dy: 22 },
      { dx: 26, dy: 22 },
    ];
    const myOff = isCoop ? spawnOffsets[localSlot % 4] : { dx: 0, dy: 0 };

    const remotePlayers: RemotePlayerState[] =
      isCoop && lobby
        ? lobby.members
            .filter((m) => m.peerId !== CoopManager.myPeerId)
            .map((m) => {
              const off = spawnOffsets[m.slot % 4];
              const sx = stage.playerSpawn.x + off.dx;
              const sy = stage.playerSpawn.y + off.dy;
              return {
                peerId: m.peerId,
                slot: m.slot,
                callsign: m.callsign,
                color: m.color || SQUAD_SLOTS[m.slot]?.color || '#4ade80',
                x: sx,
                y: sy,
                netTx: sx,
                netTy: sy,
                vx: 0,
                vy: 0,
                extrapAge: 0,
                lastSeq: 0,
                angle: 0,
                netAngle: 0,
                legAngle: 0,
                walkPhase: 0,
                isMoving: false,
                hp: 120,
                maxHp: 120,
                armor: 0,
                maxArmor: 100,
                downed: false,
                spectating: false,
                bleedoutTimer: 0,
                reviveProgress: 0,
                activeWepId: 'pistol',
                evolved: false,
                muzzleFlashTimer: 0,
                recoilOffset: 0,
                repairProgress: 0,
                hitFlashTimer: 0,
                invulnTimer: 1.5,
                cash: pStats.startCash,
                kills: 0,
              };
            })
        : [];

    const pistolDef = WEAPONS.pistol;
    this.nextEntityId = 1;
    this.deadZombieIds.clear();
    this.explosionDepth = 0;
    this.pendingModals = [];
    this.modalPaused = false;
    this.paused = false;
    this.playerSyncTimer = 0;
    this.playersFastTimer = 0;
    this.worldSyncTimer = 0;
    this.playerSyncSeq = 0;
    this.worldSyncSeq = 0;
    this.lastAppliedWorldSeq = 0;
    this.localPlayerVx = 0;
    this.localPlayerVy = 0;
    this.pendingNetBullets = [];
    this.fireFlushTimer = 0;
    this.reviveTickTimer = 0;
    this.reviveTickTargetId = '';
    this.reviveTickAccum = 0;
    this.lastReviveTickAt.clear();
    this.reviveSyncGraceUntil.clear();

    this.state = {
      stage,
      mode,
      wave: 1,
      maxWaves: mode === 'standard' ? 10 : 9999,
      waveState: 'fighting',
      intermissionTimer: 0,
      extractionProgress: 0,
      extractionTimer: 0,
      lootToast: null,
      zombiesRemainingInWave: 0,
      cash: pStats.startCash,
      battleLevel: 1,
      battleXp: 0,
      battleXpNext: 55,
      kills: 0,
      fever: 0,
      feverTimer: 0,
      electricFortifyWaves: 0,
      repairsPaidThisWave: 0,
      medkitsDroppedThisWave: 0,
      powerUpTimers: {
        overdrive: 0,
        nuke: 0,
        carpenter: 0,
        double_cash: 0,
        freeze: 0,
      },
      isCoop,
      localSlot,
      localCallsign,
      squadCount,
      remotePlayers,
      lastPrimaryWeaponId: null,
      classId: pStats.classId,
      skillCooldown: 0,
      skillMaxCooldown: pStats.skillCooldown,
      lastRecordedKills: 0,
      lastRecordedWave: 1,
      player: {
        x: stage.playerSpawn.x + myOff.dx,
        y: stage.playerSpawn.y + myOff.dy,
        radius: 15,
        angle: 0,
        hp: pStats.maxHp,
        maxHp: pStats.maxHp,
        armor: pStats.startArmor,
        maxArmor: 100,
        downed: false,
        spectating: false,
        bleedoutTimer: 0,
        reviveProgress: 0,
        hitFlashTimer: 0,
        invulnTimer: 1.5,
        weapons: [
          {
            defId: 'pistol',
            evolved: false,
            mag: pistolDef.magSize,
            reserve: -1,
          },
        ],
        activeSlot: 0,
        grenades: pStats.startGrenades,
        grenadeCooldown: 0,
        reloadTimer: 0,
        reloadDuration: 0,
        fireCooldown: 0,
        muzzleFlashTimer: 0,
        repairProgress: 0,
        walkPhase: 0,
        legAngle: 0,
        isMoving: false,
        recoilOffset: 0,
        barrelSpin: 0,
        weaponSwapTimer: 0,
        akimboAlt: false,
        footDustCd: 0,
        distanceAccum: 0,
        vampCounter: 0,
        killHealCounter: 0,
        chillTimer: 0,
        chillImmuneTimer: 0,
      },
      mapRevision: 1,
      modifiers: {
        damageMult: pStats.agentDamageBonus,
        fireRateMult: pStats.fireRateMultiplier,
        reloadMult: pStats.reloadMultiplier,
        magMult: 1,
        moveSpeedMult: 1,
        extraPierce: 0,
        extraPellets: 0,
        critChance: pStats.critChance,
        critDamageMult: pStats.critDamageMult,
        killHealRatio: pStats.killHealRatio,
        cashMult: pStats.cashBonusMult,
        killRefillChance: 0,
        cryoShotChance: 0,
        electricShotChance: 0,
        lowHpDamageBonus: 0,
      },
      relicIds: [],
      rooms: stage.rooms.map((r) => ({ ...r, unlocked: r.initiallyUnlocked })),
      windows: stage.windows.map((w) => ({
        ...w,
        planks: pStats.maxPlanks,
        maxPlanks: pStats.maxPlanks,
        armorPlanks: 0,
        attackCooldown: 0,
      })),
      doors: stage.doors.map((d) => ({
        ...d,
        cost: Math.round((d.cost * scaling.doorCostMult) / 10) * 10,
        unlocked: false,
        progress: 0,
        paidAmount: 0,
      })),
      props: stage.props,
      stations: stage.stations.map((s) => ({ ...s, used: false, progress: 0, activeTimer: 0 })),
      walls: stage.walls,
      barrels: stage.barrels.map((b) => ({ ...b, alive: true, respawnWaves: 0 })),
      zombies: [],
      bullets: [],
      grenadesThrown: [],
      explosions: [],
      spits: [],
      acidPools: [],
      drops: [],
      chests: [],
      turrets: [],
      mechDog: { active: false, x: stage.playerSpawn.x - 45, y: stage.playerSpawn.y + 35, angle: 0, biteCd: 0 },
      decals: [],
      particles: [],
      floatingTexts: [],
      lightnings: [],
      bannerText: '',
      bannerTimer: 0,
      reviveUsed: false,
      hqSupportCooldown: 0,
      armoryAdCooldown: 0,
      camera: { x: stage.playerSpawn.x + myOff.dx, y: stage.playerSpawn.y + myOff.dy, zoom: 1.02, shake: 0 },
    };

    this.paused = false;
    this.modalPaused = false;
    this.rebuildWalkableMask();
    this.resolveEntityInsideWalls(this.state.player);
    this.rebuildFlowField();
    if (!isCoop || CoopManager.role === 'host') {
      this.prepareWave(1);
    }
    if (isCoop) {
      this.showBanner(I18n.t('bannerCoopStart', { n: squadCount, m: scaling.countMult }), 3.0);
    }
    PlatformSDK.gameplayStart();
  }

  // ==================== 建筑流场寻路构建 ====================

  public rebuildWalkableMask(): void {
    const s = this.state;
    if (!s) return;
    const { gridCols: cols, gridRows: rows, cellSize: G } = s.stage;
    this.walkableGrid = new Uint8Array(cols * rows);

    for (const room of s.rooms) {
      if (!room.unlocked) continue;
      for (const r of room.rects) {
        const x0 = Math.max(0, Math.floor(r.x / G));
        const y0 = Math.max(0, Math.floor(r.y / G));
        const x1 = Math.min(cols, Math.ceil((r.x + r.w) / G));
        const y1 = Math.min(rows, Math.ceil((r.y + r.h) / G));
        for (let gy = y0; gy < y1; gy++) {
          for (let gx = x0; gx < x1; gx++) {
            this.walkableGrid[gy * cols + gx] = 1;
          }
        }
      }
    }

    // 标记室内大型家具障碍物中心格不可穿过，让僵尸自动丝滑绕开桌子/车/喷泉！
    for (const pr of s.props) {
      const { ew, eh } = this.getEffectivePropDims(pr);
      const x0 = Math.max(0, Math.floor((pr.x - ew * 0.36) / G));
      const y0 = Math.max(0, Math.floor((pr.y - eh * 0.36) / G));
      const x1 = Math.min(cols - 1, Math.floor((pr.x + ew * 0.36) / G));
      const y1 = Math.min(rows - 1, Math.floor((pr.y + eh * 0.36) / G));
      for (let gy = y0; gy <= y1; gy++) {
        for (let gx = x0; gx <= x1; gx++) {
          this.walkableGrid[gy * cols + gx] = 0;
        }
      }
    }

    const propRects: Rect[] = s.props.map((pr) => {
      const { ew, eh } = this.getEffectivePropDims(pr);
      return {
        x: pr.x - ew * 0.42,
        y: pr.y - eh * 0.42,
        w: ew * 0.84,
        h: eh * 0.84,
      };
    });
    this.staticBlockers = [
      ...s.walls,
      ...s.windows,
      ...s.doors.filter((d) => !d.unlocked),
      ...propRects,
    ];
  }

  private getEffectivePropDims(pr: RunSnapshot['props'][number]): { ew: number; eh: number } {
    const rot = pr.rotation || 0;
    const c = Math.abs(Math.cos(rot));
    const s = Math.abs(Math.sin(rot));
    return {
      ew: pr.w * c + pr.h * s,
      eh: pr.w * s + pr.h * c,
    };
  }

  private canStepBetweenCells(gx1: number, gy1: number, gx2: number, gy2: number): boolean {
    const s = this.state!;
    const { gridCols: cols, gridRows: rows, cellSize: G } = s.stage;
    if (gx2 < 0 || gx2 >= cols || gy2 < 0 || gy2 >= rows) return false;
    if (!this.walkableGrid[gy2 * cols + gx2]) return false;

    // 检查两格中心连线是否被实心墙或未解锁的门阻挡
    const mx = ((gx1 + gx2 + 1) * G) / 2;
    const my = ((gy1 + gy2 + 1) * G) / 2;
    if (this.findBlockingWallOrLockedDoor(mx, my, 8)) return false;

    if (gx1 !== gx2 && gy1 !== gy2) {
      // 对角线移动防止蹭墙角
      if (!this.walkableGrid[gy1 * cols + gx2] || !this.walkableGrid[gy2 * cols + gx1]) return false;
      if (this.findBlockingWallOrLockedDoor((gx2 + 0.5) * G, (gy1 + 0.5) * G, 10)) return false;
      if (this.findBlockingWallOrLockedDoor((gx1 + 0.5) * G, (gy2 + 0.5) * G, 10)) return false;
    }
    return true;
  }

  private getAliveCombatants(): {
    id: string;
    isLocal: boolean;
    x: number;
    y: number;
    radius: number;
  }[] {
    const s = this.state!;
    const out: { id: string; isLocal: boolean; x: number; y: number; radius: number }[] = [];
    if (!s.player.downed && !s.player.spectating && s.player.hp > 0) {
      out.push({
        id: CoopManager.myPeerId,
        isLocal: true,
        x: s.player.x,
        y: s.player.y,
        radius: s.player.radius,
      });
    }
    for (const rp of s.remotePlayers) {
      if (!rp.downed && !rp.spectating && rp.hp > 0) {
        out.push({
          id: rp.peerId,
          isLocal: false,
          x: rp.x,
          y: rp.y,
          radius: 15,
        });
      }
    }
    if (out.length === 0) {
      out.push({
        id: CoopManager.myPeerId,
        isLocal: true,
        x: s.player.x,
        y: s.player.y,
        radius: s.player.radius,
      });
    }
    return out;
  }

  private getNearestAliveCombatant(x: number, y: number) {
    const list = this.getAliveCombatants();
    let best = list[0];
    let bestD = Infinity;
    for (const c of list) {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  private inflictDamageOnCombatant(targetId: string, damage: number, invulnDur = 0.32): void {
    const s = this.state;
    if (!s) return;
    if (!s.isCoop || targetId === CoopManager.myPeerId) {
      this.damagePlayer(damage, invulnDur);
      return;
    }
    const rp = s.remotePlayers.find((item) => item.peerId === targetId);
    if (!rp || rp.downed || rp.spectating || rp.invulnTimer > 0) return;
    rp.invulnTimer = invulnDur;
    rp.hitFlashTimer = 0.24;
    if (CoopManager.role === 'host') {
      CoopManager.sendToClient(rp.peerId, { type: 'evt_player_hit', targetId: rp.peerId, damage });
    }
  }

  private rebuildFlowField(): void {
    const s = this.state;
    if (!s) return;
    const { gridCols: cols, gridRows: rows, cellSize: G } = s.stage;
    const total = cols * rows;
    if (this.flowDist.length !== total) {
      this.flowDist = new Int16Array(total);
    }
    this.flowDist.fill(30000);

    const q = new Int32Array(total);
    let head = 0;
    let tail = 0;

    // 多源 BFS：将所有在场存活队员同时设为流场目标源点，僵尸自动扑向路径最近的特种兵！
    const seedCells: [number, number][] = [];
    for (const comb of this.getAliveCombatants()) {
      const pgx = Math.max(0, Math.min(cols - 1, Math.floor(comb.x / G)));
      const pgy = Math.max(0, Math.min(rows - 1, Math.floor(comb.y / G)));
      if (this.walkableGrid[pgy * cols + pgx]) {
        seedCells.push([pgx, pgy]);
      } else {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = pgx + dx;
            const ny = pgy + dy;
            if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && this.walkableGrid[ny * cols + nx]) {
              seedCells.push([nx, ny]);
            }
          }
        }
      }
    }

    for (const [sx, sy] of seedCells) {
      const idx = sy * cols + sx;
      if (this.flowDist[idx] === 0) continue;
      this.flowDist[idx] = 0;
      q[tail++] = idx;
    }

    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    while (head < tail) {
      const cur = q[head++];
      const cx = cur % cols;
      const cy = (cur / cols) | 0;
      const nextD = this.flowDist[cur] + 1;
      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
        const nidx = ny * cols + nx;
        if (this.flowDist[nidx] <= nextD) continue;
        if (this.canStepBetweenCells(cx, cy, nx, ny)) {
          this.flowDist[nidx] = nextD;
          q[tail++] = nidx;
        }
      }
    }
  }

  private getFlowVelocityTarget(zx: number, zy: number): { x: number; y: number } {
    const s = this.state!;
    const { gridCols: cols, gridRows: rows, cellSize: G } = s.stage;
    const p = this.getNearestAliveCombatant(zx, zy);

    const gx = Math.max(0, Math.min(cols - 1, Math.floor(zx / G)));
    const gy = Math.max(0, Math.min(rows - 1, Math.floor(zy / G)));
    let bestD = this.flowDist[gy * cols + gx];

    // 仅当流场距离已足够近且在 280px 内时才做直线视线检测，砍掉后期尸潮 85% 的冗余射线开销！
    if (
      bestD <= 6 &&
      Math.abs(p.x - zx) < 280 &&
      Math.abs(p.y - zy) < 280 &&
      this.hasClearWalkLine(zx, zy, p.x, p.y)
    ) {
      return { x: p.x, y: p.y };
    }

    let bestX = gx;
    let bestY = gy;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = gx + dx;
        const ny = gy + dy;
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
        const d = this.flowDist[ny * cols + nx];
        if (d < bestD && this.canStepBetweenCells(gx, gy, nx, ny)) {
          bestD = d;
          bestX = nx;
          bestY = ny;
        }
      }
    }

    if (bestX === gx && bestY === gy) {
      return { x: p.x, y: p.y };
    }
    return { x: (bestX + 0.5) * G, y: (bestY + 0.5) * G };
  }

  private hasClearWalkLine(x1: number, y1: number, x2: number, y2: number): boolean {
    const steps = 6;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const mx = x1 + (x2 - x1) * t;
      const my = y1 + (y2 - y1) * t;
      if (this.findBlockingWallOrLockedDoor(mx, my, 14)) return false;
      for (const pr of this.state!.props) {
        const { ew, eh } = this.getEffectivePropDims(pr);
        if (this.circleIntersectsRect(mx, my, 14, { x: pr.x - ew / 2, y: pr.y - eh / 2, w: ew, h: eh })) {
          return false;
        }
      }
    }
    return true;
  }

  // ==================== 独立军火库商店购买接口（复刻 SAS2） ====================

  public getUnlockedExtraRoomsCount(): number {
    if (!this.state) return 0;
    return Math.max(0, this.state.rooms.filter((r) => r.unlocked).length - 1);
  }

  public getSectorDamageMult(): number {
    return 1 + this.getUnlockedExtraRoomsCount() * 0.1;
  }

  public getEffectiveGunCost(weaponId: string): number {
    const def = WEAPONS[weaponId];
    if (def.shopCost <= 0) return 0;
    return Math.max(50, Math.round((def.shopCost * SaveManager.getEffectivePlayerStats().gunShopCostMult) / 5) * 5);
  }

  public getEffectiveAmmoCost(weaponId: string): number {
    const def = WEAPONS[weaponId];
    if (def.ammoCost <= 0) return 0;
    return Math.max(20, Math.round((def.ammoCost * SaveManager.getEffectivePlayerStats().ammoCostMult) / 5) * 5);
  }

  public getMaxReserve(weaponId: string, evolved: boolean): number {
    const def = WEAPONS[weaponId];
    if (def.maxReserve < 0) return -1;
    return Math.round(def.maxReserve * (evolved ? 2 : 1) * SaveManager.getEffectivePlayerStats().reserveAmmoMult);
  }

  public buyOrRefillWeaponFromShop(weaponId: string, forceRefill = false): { ok: boolean; msg: string } {
    const s = this.state;
    if (!s) return { ok: false, msg: '' };
    const def = WEAPONS[weaponId];
    const unlockedRooms = this.getUnlockedExtraRoomsCount();
    if (unlockedRooms < def.unlockRoomsRequired) {
      return { ok: false, msg: I18n.t('msgNeedRooms', { n: def.unlockRoomsRequired }) };
    }

    const gunCost = this.getEffectiveGunCost(weaponId);
    const ammoCost = this.getEffectiveAmmoCost(weaponId);
    const wTitle = (evo: boolean) => (evo ? I18n.wSuperName(def.id, def.superName) : I18n.wName(def.id, def.name));

    const ownedIdx = s.player.weapons.findIndex((w) => w.defId === weaponId);
    if (ownedIdx >= 0) {
      const w = s.player.weapons[ownedIdx];
      if (w.tempWavesLeft !== undefined && !forceRefill) {
        if (s.cash < gunCost) return { ok: false, msg: I18n.t('msgNoCash', { c: gunCost }) };
        s.cash -= gunCost;
        delete w.tempWavesLeft;
        w.mag = this.getMaxMag(weaponId, w.evolved);
        if (def.maxReserve > 0) w.reserve = this.getMaxReserve(weaponId, w.evolved);
        s.player.activeSlot = ownedIdx;
        if (def.maxReserve > 0) s.lastPrimaryWeaponId = weaponId;
        s.player.reloadTimer = 0;
        s.player.weaponSwapTimer = 0.32;
        SoundFX.fanfare();
        return { ok: true, msg: I18n.t('msgBoughtPerm', { name: wTitle(w.evolved) }) };
      }

      if (!forceRefill && s.player.activeSlot !== ownedIdx) {
        s.player.activeSlot = ownedIdx;
        if (def.maxReserve > 0) s.lastPrimaryWeaponId = weaponId;
        s.player.reloadTimer = 0;
        s.player.weaponSwapTimer = 0.32;
        SoundFX.reloadDone();
        return { ok: true, msg: I18n.t('msgSwitched', { name: wTitle(w.evolved) }) };
      }

      if (def.maxReserve < 0) {
        s.player.activeSlot = ownedIdx;
        s.player.reloadTimer = 0;
        s.player.weaponSwapTimer = 0.32;
        return { ok: true, msg: I18n.t('msgInfAmmo') };
      }
      const maxRes = this.getMaxReserve(weaponId, w.evolved);
      if (w.reserve >= maxRes && w.mag >= this.getMaxMag(weaponId, w.evolved)) {
        s.player.activeSlot = ownedIdx;
        s.lastPrimaryWeaponId = weaponId;
        s.player.reloadTimer = 0;
        s.player.weaponSwapTimer = 0.32;
        return { ok: true, msg: I18n.t('msgAmmoFull') };
      }
      if (s.cash < ammoCost) return { ok: false, msg: I18n.t('msgNoCash', { c: ammoCost }) };
      s.cash -= ammoCost;
      w.mag = this.getMaxMag(weaponId, w.evolved);
      w.reserve = maxRes;
      s.player.activeSlot = ownedIdx;
      s.lastPrimaryWeaponId = weaponId;
      s.player.reloadTimer = 0;
      s.player.weaponSwapTimer = 0.32;
      SoundFX.reloadDone();
      return { ok: true, msg: I18n.t('msgRefilled', { name: wTitle(w.evolved) }) };
    }

    if (s.cash < gunCost) return { ok: false, msg: I18n.t('msgNoCash', { c: gunCost }) };
    s.cash -= gunCost;
    this.giveOrRefillWeapon(weaponId, false);
    SoundFX.fanfare();
    return { ok: true, msg: I18n.t('msgBoughtGun', { name: wTitle(false) }) };
  }

  public getQuickRefillTarget(): {
    defId: string;
    evolved: boolean;
    cost: number;
    isEmpty: boolean;
    needsReequip: boolean;
    urgent: boolean;
    canAfford: boolean;
  } | null {
    const s = this.state;
    if (!s || s.waveState === 'ended') return null;
    const p = s.player;
    if (p.downed || p.spectating) return null;

    const activeWep = p.weapons[p.activeSlot];
    const activeDef = WEAPONS[activeWep.defId];
    if (activeDef.maxReserve > 0) {
      s.lastPrimaryWeaponId = activeWep.defId;
      const maxMag = this.getMaxMag(activeWep.defId, activeWep.evolved);
      const maxRes = this.getMaxReserve(activeWep.defId, activeWep.evolved);
      if (activeWep.mag >= maxMag && activeWep.reserve >= maxRes) {
        return null;
      }
      const totalCur = activeWep.mag + activeWep.reserve;
      const totalMax = maxMag + maxRes;
      const cost = this.getEffectiveAmmoCost(activeWep.defId);
      return {
        defId: activeWep.defId,
        evolved: activeWep.evolved,
        cost,
        isEmpty: totalCur <= 0,
        needsReequip: false,
        urgent: activeWep.reserve <= 0 || totalCur <= Math.ceil(totalMax * 0.28),
        canAfford: s.cash >= cost,
      };
    }

    let candidate = s.lastPrimaryWeaponId
      ? p.weapons.find((w) => w.defId === s.lastPrimaryWeaponId && WEAPONS[w.defId].maxReserve > 0)
      : undefined;

    if (!candidate) {
      for (let i = p.weapons.length - 1; i >= 0; i--) {
        const w = p.weapons[i];
        const d = WEAPONS[w.defId];
        if (d.maxReserve > 0 && w.mag + w.reserve <= 0) {
          candidate = w;
          break;
        }
      }
    }
    if (!candidate) {
      for (let i = p.weapons.length - 1; i >= 0; i--) {
        const w = p.weapons[i];
        const d = WEAPONS[w.defId];
        if (d.maxReserve > 0) {
          const maxM = this.getMaxMag(w.defId, w.evolved);
          const maxR = this.getMaxReserve(w.defId, w.evolved);
          if (w.mag < maxM || w.reserve < maxR) {
            candidate = w;
            break;
          }
        }
      }
    }
    if (!candidate) return null;

    const cMaxMag = this.getMaxMag(candidate.defId, candidate.evolved);
    const cMaxRes = this.getMaxReserve(candidate.defId, candidate.evolved);
    if (candidate.mag >= cMaxMag && candidate.reserve >= cMaxRes) {
      return null;
    }
    const cTotal = candidate.mag + candidate.reserve;
    const cCost = this.getEffectiveAmmoCost(candidate.defId);
    return {
      defId: candidate.defId,
      evolved: candidate.evolved,
      cost: cCost,
      isEmpty: cTotal <= 0,
      needsReequip: true,
      urgent: cTotal <= 0 || candidate.reserve <= 0,
      canAfford: s.cash >= cCost,
    };
  }

  public quickBuyPrimaryAmmo(): boolean {
    const s = this.state;
    if (!s || this.landscapePaused || s.waveState === 'ended') return false;
    if (!s.isCoop && (this.paused || this.modalPaused)) return false;
    const target = this.getQuickRefillTarget();
    if (!target) return false;

    const def = WEAPONS[target.defId];
    const wIdx = s.player.weapons.findIndex((w) => w.defId === target.defId);
    if (wIdx < 0) return false;
    const w = s.player.weapons[wIdx];
    const wLabel = w.evolved ? I18n.wSuperName(def.id, def.superName) : I18n.wName(def.id, def.name);

    if (s.cash < target.cost) {
      SoundFX.emptyClip();
      this.spawnFloatingText(s.player.x, s.player.y - 36, I18n.t('msgNoCash', { c: target.cost }), '#fca5a5', 1.15);
      return false;
    }

    s.cash -= target.cost;
    w.mag = this.getMaxMag(w.defId, w.evolved);
    w.reserve = this.getMaxReserve(w.defId, w.evolved);
    s.player.activeSlot = wIdx;
    s.lastPrimaryWeaponId = w.defId;
    s.player.reloadTimer = 0;
    s.player.reloadDuration = 0;
    s.player.weaponSwapTimer = 0.26;
    SoundFX.reloadDone();
    this.spawnFloatingText(
      s.player.x,
      s.player.y - 38,
      I18n.t('ftQuickRefilled', { name: wLabel }),
      w.evolved ? def.superColor : '#4ade80',
      1.25
    );
    return true;
  }

  public evolveActiveWeaponInShop(cost = 1850): { ok: boolean; msg: string } {
    const s = this.state;
    if (!s) return { ok: false, msg: '' };
    const wep = s.player.weapons[s.player.activeSlot];
    const def = WEAPONS[wep.defId];
    if (wep.evolved) return { ok: false, msg: I18n.t('msgAlreadyEvo') };
    if (s.cash < cost) return { ok: false, msg: I18n.t('msgNoCash', { c: cost }) };

    const sName = I18n.wSuperName(def.id, def.superName);
    s.cash -= cost;
    wep.evolved = true;
    wep.mag = this.getMaxMag(wep.defId, true);
    if (def.maxReserve > 0) wep.reserve = this.getMaxReserve(wep.defId, true);
    s.player.weaponSwapTimer = 0.35;
    SaveManager.addDailyProgress('evolve', 1, true);
    this.spawnFloatingText(s.player.x, s.player.y - 36, `⚡ ${sName}`, def.superColor, 1.3);
    SoundFX.fanfare();
    PlatformSDK.happyTime();
    return { ok: true, msg: I18n.t('msgEvolved', { name: sName }) };
  }

  public getAlloyWindowsStatus(): { done: number; total: number } {
    const s = this.state;
    if (!s) return { done: 0, total: 0 };
    let done = 0;
    let total = 0;
    for (const win of s.windows) {
      const rm = s.rooms.find((r) => r.id === win.roomId);
      if (!rm?.unlocked) continue;
      total += 1;
      if (win.armorPlanks >= win.maxPlanks && win.planks >= win.maxPlanks) {
        done += 1;
      }
    }
    return { done, total };
  }

  public buyShopTacticalItem(
    item: 'grenades' | 'medkit' | 'turret' | 'all_ammo' | 'armor' | 'alloy_windows'
  ): { ok: boolean; msg: string } {
    const s = this.state;
    if (!s) return { ok: false, msg: '' };
    const pStats = SaveManager.getEffectivePlayerStats();
    if (item === 'alloy_windows') {
      const st = this.getAlloyWindowsStatus();
      if (st.total === 0 || st.done >= st.total) {
        return { ok: false, msg: I18n.t('msgAlloyWinFull') };
      }
      if (s.cash < 180) return { ok: false, msg: I18n.t('msgNoCash', { c: 180 }) };
      s.cash -= 180;
      let upgradedCount = 0;
      for (const win of s.windows) {
        const rm = s.rooms.find((r) => r.id === win.roomId);
        if (!rm?.unlocked) continue;
        if (win.planks < win.maxPlanks || win.armorPlanks < win.maxPlanks) {
          win.planks = win.maxPlanks;
          win.armorPlanks = win.maxPlanks;
          this.pushOutdoorZombiesOutsidePlanks(win);
          upgradedCount += 1;
        }
      }
      SaveManager.addDailyProgress('repairs', upgradedCount * 2);
      SoundFX.fanfare();
      if (s.isCoop && CoopManager.role === 'client') {
        CoopManager.sendToHost({
          type: 'cmd_fortify_win',
          ownerId: CoopManager.myPeerId,
          winId: 'ALL',
        });
      }
      return { ok: true, msg: I18n.t('msgAlloyWinBought', { n: upgradedCount }) };
    }
    if (item === 'armor') {
      if (s.player.armor >= s.player.maxArmor) return { ok: false, msg: I18n.t('msgArmorFull') };
      if (s.cash < 380) return { ok: false, msg: I18n.t('msgNoCash', { c: 380 }) };
      s.cash -= 380;
      s.player.armor = Math.min(s.player.maxArmor, s.player.armor + 65);
      SoundFX.fanfare();
      return { ok: true, msg: I18n.t('msgArmorBought') };
    }
    if (item === 'grenades') {
      if (s.cash < 220) return { ok: false, msg: I18n.t('msgNoCash', { c: 220 }) };
      s.cash -= 220;
      s.player.grenades += 3;
      SoundFX.reloadDone();
      return { ok: true, msg: I18n.t('msgGrenBought') };
    }
    if (item === 'medkit') {
      if (s.player.hp >= s.player.maxHp) return { ok: false, msg: I18n.t('msgHpFull') };
      if (s.cash < 300) return { ok: false, msg: I18n.t('msgNoCash', { c: 300 }) };
      s.cash -= 300;
      s.player.hp = s.player.maxHp;
      SoundFX.fanfare();
      return { ok: true, msg: I18n.t('msgHealed') };
    }
    if (item === 'turret') {
      if (s.cash < 650) return { ok: false, msg: I18n.t('msgNoCash', { c: 650 }) };
      s.cash -= 650;
      const tx = s.player.x + 25;
      const ty = s.player.y;
      const tLife = Math.round(38 * pStats.turretDurationMultiplier);
      if (s.isCoop && CoopManager.role === 'client') {
        CoopManager.sendToHost({ type: 'cmd_deploy_turret', ownerId: CoopManager.myPeerId, x: tx, y: ty, life: tLife });
      } else {
        s.turrets.push({ x: tx, y: ty, angle: s.player.angle, fireCd: 0, life: tLife });
      }
      SoundFX.fanfare();
      return { ok: true, msg: I18n.t('msgTurretDeployed') };
    }
    if (s.cash < 320) return { ok: false, msg: I18n.t('msgNoCash', { c: 320 }) };
    s.cash -= 320;
    for (const w of s.player.weapons) {
      const def = WEAPONS[w.defId];
      w.mag = this.getMaxMag(w.defId, w.evolved);
      if (def.maxReserve > 0) w.reserve = this.getMaxReserve(w.defId, w.evolved);
    }
    SoundFX.reloadDone();
    return { ok: true, msg: I18n.t('msgAllAmmoFull') };
  }

  public useActiveClassSkill(): boolean {
    const s = this.state;
    if (!s || this.landscapePaused || s.waveState === 'ended') return false;
    if (!s.isCoop && (this.paused || this.modalPaused)) return false;
    const p = s.player;
    if (p.downed || p.spectating || s.skillCooldown > 0) return false;

    const pStats = SaveManager.getEffectivePlayerStats();
    const cls = getAgentClassDef(s.classId);
    const clsText = getLocalizedClassText(cls);
    s.skillCooldown = s.skillMaxCooldown;
    SaveManager.addDailyProgress('skills', 1);

    if (s.classId === 'vanguard') {
      s.powerUpTimers.overdrive = Math.max(s.powerUpTimers.overdrive, 5.5);
      const activeWep = p.weapons[p.activeSlot];
      activeWep.mag = this.getMaxMag(activeWep.defId, activeWep.evolved);
      p.reloadTimer = 0;
      SoundFX.fanfare();
    } else if (s.classId === 'engineer') {
      const tx = p.x + Math.cos(p.angle) * 26;
      const ty = p.y + Math.sin(p.angle) * 26;
      const tLife = Math.round(26 * pStats.turretDurationMultiplier);
      if (s.isCoop && CoopManager.role === 'client') {
        CoopManager.sendToHost({ type: 'cmd_deploy_turret', ownerId: CoopManager.myPeerId, x: tx, y: ty, life: tLife });
      } else {
        s.turrets.push({ x: tx, y: ty, angle: p.angle, fireCd: 0, life: tLife });
      }
      for (const win of s.windows) {
        const rm = s.rooms.find((r) => r.id === win.roomId);
        if (!rm?.unlocked || win.planks >= win.maxPlanks) continue;
        if (Math.hypot(p.x - (win.x + win.w / 2), p.y - (win.y + win.h / 2)) <= 220) {
          win.planks = Math.min(win.maxPlanks, win.planks + 2);
          this.pushOutdoorZombiesOutsidePlanks(win);
          if (s.isCoop && CoopManager.role === 'client') {
            CoopManager.sendToHost({ type: 'cmd_repair_win', ownerId: CoopManager.myPeerId, winId: win.id });
          }
          break;
        }
      }
      SoundFX.fanfare();
    } else if (s.classId === 'medic') {
      const heal = Math.round(p.maxHp * 0.45);
      p.hp = Math.min(p.maxHp, p.hp + heal);
      p.armor = Math.min(p.maxArmor, p.armor + 35);
      p.invulnTimer = Math.max(p.invulnTimer, 1.5);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        s.particles.push({
          x: p.x + Math.cos(a) * 18,
          y: p.y + Math.sin(a) * 18,
          vx: Math.cos(a) * 110,
          vy: Math.sin(a) * 110,
          size: 5,
          color: '#4ade80',
          life: 0.45,
          maxLife: 0.45,
        });
      }
      if (s.isCoop) {
        for (const rp of s.remotePlayers) {
          if (rp.downed && !rp.spectating && Math.hypot(rp.x - p.x, rp.y - p.y) <= 150) {
            if (CoopManager.role === 'host') {
              this.advanceReviveOnHost(rp.peerId, CoopManager.myPeerId, s.localCallsign, 5);
            } else {
              CoopManager.sendToHost({
                type: 'cmd_revive_tick',
                reviverId: CoopManager.myPeerId,
                reviverName: s.localCallsign,
                targetId: rp.peerId,
                dt: 5,
              });
            }
          }
        }
      }
      SoundFX.fanfare();
    } else {
      // demolisher: 向四周发射 4 颗集束高爆雷并震退近身丧尸
      const gDmg = 280 * s.modifiers.damageMult * pStats.grenadeDamageMult * this.getSectorDamageMult();
      for (let k = 0; k < 4; k++) {
        const ang = p.angle + (k * Math.PI) / 2;
        const gData = {
          x: p.x + Math.cos(ang) * 18,
          y: p.y + Math.sin(ang) * 18,
          vx: Math.cos(ang) * 320,
          vy: Math.sin(ang) * 320,
          z: 16,
          vz: 165,
          fuse: 0.62,
          maxFuse: 0.62,
          spinAngle: ang,
          damage: gDmg,
          radius: 165,
        };
        s.grenadesThrown.push(gData);
        if (s.isCoop && CoopManager.role === 'client') {
          CoopManager.sendToHost({ type: 'cmd_grenade', ownerId: CoopManager.myPeerId, g: gData });
        } else if (s.isCoop && CoopManager.role === 'host') {
          CoopManager.broadcastToClients({ type: 'cmd_grenade', ownerId: CoopManager.myPeerId, g: gData });
        }
      }
      if (!s.isCoop || CoopManager.role === 'host') {
        for (const z of s.zombies) {
          if (Math.hypot(z.x - p.x, z.y - p.y) <= 155) {
            z.stunTimer = Math.max(z.stunTimer, 1.2);
          }
        }
      }
      SoundFX.explosion();
    }

    this.spawnFloatingText(
      p.x,
      p.y - 42,
      I18n.t('ftSkillReady', { name: clsText.skillName }),
      cls.color,
      1.3
    );
    return true;
  }

  public throwGrenade(): void {
    const s = this.state;
    if (!s || this.landscapePaused || s.waveState === 'ended') return;
    if (!s.isCoop && (this.paused || this.modalPaused)) return;
    const p = s.player;
    if (p.downed || p.spectating || p.grenades <= 0 || p.grenadeCooldown > 0) return;

    p.grenades -= 1;
    p.grenadeCooldown = 0.65;
    SaveManager.addDailyProgress('skills', 1);
    const grenMult = SaveManager.getEffectivePlayerStats().grenadeDamageMult;
    const gData = {
      x: p.x + Math.cos(p.angle) * 20,
      y: p.y + Math.sin(p.angle) * 20,
      vx: Math.cos(p.angle) * 430,
      vy: Math.sin(p.angle) * 430,
      z: 18,
      vz: 190,
      fuse: 1.05,
      maxFuse: 1.05,
      spinAngle: p.angle,
      damage: 320 * s.modifiers.damageMult * grenMult * this.getSectorDamageMult(),
      radius: 175,
    };
    s.grenadesThrown.push(gData);
    if (s.isCoop && CoopManager.role === 'client') {
      CoopManager.sendToHost({
        type: 'cmd_grenade',
        ownerId: CoopManager.myPeerId,
        g: gData,
      });
    } else if (s.isCoop && CoopManager.role === 'host') {
      CoopManager.broadcastToClients({
        type: 'cmd_grenade',
        ownerId: CoopManager.myPeerId,
        g: gData,
      });
    }
    SoundFX.repair();
  }

  // ==================== 波次与刷怪 ====================

  private reviveLocalPlayerFromWaveOrTeammate(reviverName?: string): void {
    const s = this.state;
    if (!s) return;
    const p = s.player;
    if (!p.downed && !p.spectating && p.hp > 0) return;
    p.downed = false;
    p.spectating = false;
    p.bleedoutTimer = 0;
    p.reviveProgress = 0;
    p.chillTimer = 0;
    p.hp = Math.max(Math.round(p.maxHp * 0.55), p.hp);
    p.invulnTimer = 3.2;
    SoundFX.fanfare();
    this.spawnFloatingText(
      p.x,
      p.y - 38,
      reviverName ? I18n.t('ftRevivedBy', { name: reviverName }) : I18n.t('ftWaveRevive'),
      '#4ade80',
      1.25
    );
    if (s.isCoop && CoopManager.role === 'client') {
      CoopManager.sendToHost({ type: 'player_sync', p: this.buildLocalPlayerSync() });
    }
  }

  private prepareWave(wave: number): void {
    const s = this.state;
    if (!s) return;
    s.wave = wave;
    s.waveState = 'fighting';
    s.repairsPaidThisWave = 0;
    s.medkitsDroppedThisWave = 0;

    if (s.isCoop) {
      this.reviveLocalPlayerFromWaveOrTeammate();
      if (CoopManager.role === 'host') {
        const now = performance.now();
        for (const rp of s.remotePlayers) {
          if (rp.downed || rp.spectating || rp.hp <= 0) {
            rp.downed = false;
            rp.spectating = false;
            rp.bleedoutTimer = 0;
            rp.reviveProgress = 0;
            rp.hp = Math.round(rp.maxHp * 0.55);
            rp.invulnTimer = 3.2;
            this.reviveSyncGraceUntil.set(rp.peerId, now + 2200);
          }
        }
        CoopManager.broadcastToClients({ type: 'evt_team_reward', waveAutoRevive: true });
      }
    }

    const p = s.player;
    for (let i = p.weapons.length - 1; i >= 0; i--) {
      const w = p.weapons[i];
      if (w.tempWavesLeft !== undefined) {
        w.tempWavesLeft -= 1;
        if (w.tempWavesLeft <= 0 && p.weapons.length > 1) {
          this.spawnFloatingText(p.x, p.y - 38, I18n.t('ftTrialExpired'), '#cbd5e1', 1.1);
          p.weapons.splice(i, 1);
          p.activeSlot = Math.min(p.activeSlot, p.weapons.length - 1);
        }
      }
    }

    for (const b of s.barrels) {
      if (!b.alive) {
        b.respawnWaves -= 1;
        if (b.respawnWaves <= 0) b.alive = true;
      }
    }

    const scaling = getCoopScaling(s.squadCount);
    const queue: ZombieKind[] = [];
    const baseCount =
      10 + wave * 6.2 + Math.pow(Math.max(0, wave - 3), 1.45) * 2.8 + (s.stage.index - 1) * 3.6;
    const totalCount = Math.round(baseCount * scaling.countMult);
    const necroChance = wave >= 5 ? Math.min(0.1, 0.05 + (wave - 5) * 0.01) : 0;
    const frostChance = wave >= 4 ? Math.min(0.14, 0.08 + (wave - 4) * 0.012) : 0;
    const spitterChance = wave >= 4 ? Math.min(0.18, 0.1 + (wave - 4) * 0.014) : 0;
    const riotChance = wave >= 3 ? Math.min(0.15, 0.08 + (wave - 3) * 0.012) : 0;
    const boomerChance = wave >= 2 ? Math.min(0.14, 0.07 + (wave - 2) * 0.012) : 0;
    const runnerChance = wave >= 2 ? Math.min(0.32, 0.2 + (wave - 2) * 0.022) : 0.14;

    for (let i = 0; i < totalCount; i++) {
      const r = Math.random();
      let acc = necroChance;
      if (r < acc) {
        queue.push('necro');
        continue;
      }
      acc += frostChance;
      if (r < acc) {
        queue.push('frost');
        continue;
      }
      acc += spitterChance;
      if (r < acc) {
        queue.push('spitter');
        continue;
      }
      acc += riotChance;
      if (r < acc) {
        queue.push('riot');
        continue;
      }
      acc += boomerChance;
      if (r < acc) {
        queue.push('boomer');
        continue;
      }
      acc += runnerChance;
      if (r < acc) {
        queue.push('runner');
      } else {
        queue.push('walker');
      }
    }

    if (wave % 3 === 0) {
      queue.splice(Math.floor(queue.length * 0.45), 0, 'thief');
    }

    // 中后期（第 5 波起）混编重装暴君精英，多人联机额外增派精英突击！
    let miniBossCount = 0;
    if (wave === 5 || wave === 6) miniBossCount = 1 + scaling.extraMiniBoss;
    else if (wave === 7 || wave === 8) miniBossCount = 2 + scaling.extraMiniBoss;
    else if (wave === 9) miniBossCount = 3 + scaling.extraMiniBoss;
    else if (wave === 10) miniBossCount = 2 + scaling.extraMiniBoss;
    else if (wave > 10) miniBossCount = 2 + Math.floor((wave - 9) / 2) + scaling.extraMiniBoss;

    for (let m = 0; m < miniBossCount; m++) {
      const insertIdx = Math.min(
        queue.length,
        Math.floor(((m + 1) / (miniBossCount + 1)) * queue.length)
      );
      queue.splice(insertIdx, 0, 'miniboss');
    }

    const isBossWave = wave % 10 === 0 || (wave > 10 && wave % 5 === 0);
    const waveBossKind = isBossWave ? getStageBossKind(s.stage.id, wave) : null;
    if (waveBossKind) {
      queue.splice(Math.floor(queue.length * 0.72), 0, waveBossKind);
      if (s.squadCount >= 3 && wave >= 10) {
        // 3~4人满编高难下双线精英护卫压境！
        queue.splice(Math.floor(queue.length * 0.48), 0, 'miniboss');
      }
    }

    if (wave >= 2 && (wave - 2) % 3 === 0 && s.chests.length < 2) {
      this.spawnRoomTreasureChest();
    }

    this.spawnQueue = queue;
    s.zombiesRemainingInWave = queue.length;
    this.spawnTimer = 0.55;

    if (wave % 5 === 0) {
      SoundFX.alarm();
      let bText = I18n.t('bannerEliteWave', { w: wave });
      if (waveBossKind) {
        const bp = getBossProfile(waveBossKind);
        bText = I18n.isZh() ? bp.zhIntro : bp.enIntro;
      }
      this.showBanner(bText, 3.2);
      if (s.isCoop && CoopManager.role === 'host') {
        CoopManager.broadcastToClients({ type: 'evt_fx', kind: 'banner', text: bText, dur: 3.2 });
      }
    }
  }

  private spawnRoomTreasureChest(): void {
    const s = this.state;
    if (!s) return;
    const unlockedRooms = s.rooms.filter((r) => r.unlocked);
    const room = unlockedRooms[Math.floor(Math.random() * unlockedRooms.length)];
    const rect = room.rects[Math.floor(Math.random() * room.rects.length)];
    const margin = 65;
    const cx = rect.x + margin + Math.random() * Math.max(20, rect.w - margin * 2);
    const cy = rect.y + margin + Math.random() * Math.max(20, rect.h - margin * 2);
    s.chests.push({
      id: this.nextEntityId++,
      x: cx,
      y: cy,
      roomId: room.id,
      progress: 0,
      bobPhase: Math.random() * Math.PI * 2,
    });
  }

  public showBanner(text: string, dur = 2.8): void {
    if (!this.state) return;
    this.state.bannerText = text;
    this.state.bannerTimer = dur;
  }

  public switchWeapon(slotIndex?: number): void {
    const s = this.state;
    if (!s || s.player.weapons.length < 2) return;
    if (!s.isCoop && (this.paused || this.modalPaused)) return;
    const next = slotIndex !== undefined ? slotIndex : (s.player.activeSlot + 1) % s.player.weapons.length;
    if (next !== s.player.activeSlot && s.player.weapons[next]) {
      s.player.activeSlot = next;
      s.player.reloadTimer = 0;
      s.player.reloadDuration = 0;
      s.player.weaponSwapTimer = 0.28;
      const wep = s.player.weapons[next];
      const def = WEAPONS[wep.defId];
      if (def.maxReserve > 0) {
        s.lastPrimaryWeaponId = wep.defId;
      }
      const wLabel = wep.evolved ? I18n.wSuperName(def.id, def.superName) : I18n.wName(def.id, def.name);
      SoundFX.reloadDone();
      this.spawnFloatingText(
        s.player.x,
        s.player.y - 34,
        `🔫 ${wLabel}`,
        wep.evolved ? def.superColor : def.color,
        1.15
      );
    }
  }

  public startReload(): void {
    const s = this.state;
    if (!s) return;
    const p = s.player;
    if (p.reloadTimer > 0) return;
    const wep = p.weapons[p.activeSlot];
    const maxMag = this.getMaxMag(wep.defId, wep.evolved);
    if (wep.mag >= maxMag || wep.reserve === 0) return;

    const def = WEAPONS[wep.defId];
    const dur = Math.max(0.28, def.reloadTime * s.modifiers.reloadMult);
    p.reloadDuration = dur;
    p.reloadTimer = dur;
  }

  public getMaxMag(defId: string, evolved: boolean): number {
    const s = this.state;
    const def = WEAPONS[defId];
    const mult = (s ? s.modifiers.magMult : 1) * (evolved ? 1.5 : 1);
    return Math.max(2, Math.round(def.magSize * mult));
  }

  // ==================== 激励视频支援效果 ====================

  public applyTacticalRevive(): void {
    const s = this.state;
    if (!s) return;
    this.paused = false;
    this.modalPaused = false;
    s.reviveUsed = true;
    s.player.hp = s.player.maxHp;
    s.player.invulnTimer = 4.5;
    s.player.grenades += 2;
    s.spits = [];
    s.acidPools = [];
    for (const w of s.player.weapons) {
      const def = WEAPONS[w.defId];
      w.mag = this.getMaxMag(w.defId, w.evolved);
      if (def.maxReserve > 0) w.reserve = this.getMaxReserve(w.defId, w.evolved);
    }
    for (const win of s.windows) {
      win.planks = win.maxPlanks;
      this.pushOutdoorZombiesOutsidePlanks(win);
    }
    const snapshot = [...s.zombies];
    for (const z of snapshot) {
      if (!z || z.hp <= 0 || this.deadZombieIds.has(z.id)) continue;
      const dx = z.x - s.player.x;
      const dy = z.y - s.player.y;
      const d = Math.hypot(dx, dy) || 1;
      z.x += (dx / d) * 150;
      z.y += (dy / d) * 150;
      if (z.insideBuilding) {
        this.resolveEntityInsideWalls(z);
      } else if (z.targetWindowId) {
        const w = s.windows.find((item) => item.id === z.targetWindowId);
        if (w) this.resolveOutdoorZombieObstacles(z, w, false);
      }
      z.stunTimer = 3.2;
      if (!isBossKind(z.kind) && z.kind !== 'miniboss') {
        z.hp -= z.maxHp * 0.65;
        if (z.hp <= 0) {
          this.killZombie(z);
        }
      }
    }
    s.camera.shake = 1.2;
    SoundFX.explosion();
    this.showBanner(I18n.t('bannerReviveDrop'), 2.6);
    PlatformSDK.gameplayStart();
  }

  public applyHqAmmoAndTurret(): void {
    const s = this.state;
    if (!s) return;
    s.hqSupportCooldown = 45;
    s.player.grenades += 2;
    for (const w of s.player.weapons) {
      const def = WEAPONS[w.defId];
      w.mag = this.getMaxMag(w.defId, w.evolved);
      if (def.maxReserve > 0) w.reserve = this.getMaxReserve(w.defId, w.evolved);
    }
    if (s.isCoop && CoopManager.role === 'client') {
      CoopManager.sendToHost({
        type: 'cmd_deploy_turret',
        ownerId: CoopManager.myPeerId,
        x: s.player.x,
        y: s.player.y,
        life: 45,
      });
    } else {
      s.turrets.push({ x: s.player.x, y: s.player.y, angle: 0, fireCd: 0, life: 45 });
    }
    this.showBanner(I18n.t('bannerHqSupport'), 3.2);
    PlatformSDK.gameplayStart();
  }

  public applyElectricFortify(): void {
    const s = this.state;
    if (!s) return;
    const gridMsg = I18n.t('bannerElecGrid');
    if (s.isCoop && CoopManager.role === 'client') {
      CoopManager.sendToHost({ type: 'cmd_electric_fortify', ownerId: CoopManager.myPeerId });
    } else {
      s.electricFortifyWaves = 2;
      for (const win of s.windows) {
        win.planks = win.maxPlanks;
        this.pushOutdoorZombiesOutsidePlanks(win);
      }
      if (s.isCoop && CoopManager.role === 'host') {
        CoopManager.broadcastToClients({
          type: 'evt_fx',
          kind: 'banner',
          text: gridMsg,
          dur: 3.2,
        });
      }
    }
    this.showBanner(gridMsg, 3.2);
    PlatformSDK.gameplayStart();
  }

  // ==================== 主更新循环 ====================

  private isRunHalted(): boolean {
    if (!this.state || this.landscapePaused || this.state.waveState === 'ended') {
      return true;
    }
    if (!this.state.isCoop) {
      return this.paused || this.modalPaused || this.state.player.hp <= 0;
    }
    return false;
  }

  public update(dt: number, viewW: number, viewH: number): void {
    this.lastViewW = viewW;
    this.lastViewH = viewH;
    if (!this.state || this.landscapePaused || this.state.waveState === 'ended') {
      return;
    }
    const s = this.state;
    if (!s.isCoop && (this.paused || this.modalPaused)) {
      return;
    }

    // 专注桌面与手机横屏宽幅视野缩放（16:9 ~ 21:9 全面屏自适应）
    const fitZoom =
      viewH < 520 ? Math.min(viewW / 1040, viewH / 540) : Math.min(viewW / 1180, viewH / 680);
    s.camera.zoom = Math.max(0.66, Math.min(1.1, fitZoom));

    if (s.bannerTimer > 0) s.bannerTimer -= dt;
    if (s.lootToast) {
      s.lootToast.timer -= dt;
      if (s.lootToast.timer <= 0) s.lootToast = null;
    }
    if (s.hqSupportCooldown > 0) s.hqSupportCooldown -= dt;
    if (s.armoryAdCooldown > 0) s.armoryAdCooldown -= dt;
    if (s.skillCooldown > 0) s.skillCooldown = Math.max(0, s.skillCooldown - dt);
    if (s.camera.shake > 0) s.camera.shake = Math.max(0, s.camera.shake - dt * 2.8);

    (Object.keys(s.powerUpTimers) as PowerUpType[]).forEach((k) => {
      if (s.powerUpTimers[k] > 0) s.powerUpTimers[k] = Math.max(0, s.powerUpTimers[k] - dt);
    });
    if (s.feverTimer > 0) {
      s.feverTimer = Math.max(0, s.feverTimer - dt);
    } else if (s.fever > 0) {
      s.fever = Math.max(0, s.fever - dt * 7);
    }

    // 平滑插值远端联机队友身位与动画
    if (s.isCoop) {
      this.interpolateRemotePlayers(dt);
    }

    if (s.isCoop && CoopManager.role === 'client') {
      // 客机模式：本地零延迟操控 + 客户端交互请求 + 平滑世界实体插值
      this.updatePlayer(dt, viewW, viewH);
      this.updateCoopRevive(dt);
      this.updateClientInteractions(dt);
      this.updateClientWorldVisuals(dt);
      this.updateFX(dt);

      this.flushPendingNetFire(dt);
      this.playerSyncTimer -= dt;
      if (this.playerSyncTimer <= 0 && !CoopManager.isCongested()) {
        this.playerSyncTimer = 0.05;
        CoopManager.sendToHost({ type: 'player_sync', p: this.buildLocalPlayerSync() });
      }
    } else {
      // 单机或房主权威模式：完整物理、多源流场寻路、刷怪与战斗结算
      this.flowTimer -= dt;
      if (this.flowTimer <= 0) {
        this.flowTimer = 0.18;
        this.rebuildFlowField();
      }

      this.updateWaveLogic(dt);
      if (this.isRunHalted()) return;

      this.updatePlayer(dt, viewW, viewH);
      if (s.isCoop) {
        this.updateCoopRevive(dt);
      }
      this.updateInteractions(dt);
      if (this.isRunHalted()) return;

      this.updateTurretsAndDog(dt);
      this.updateGrenades(dt);
      this.updateBullets(dt);
      this.updateZombies(dt);
      if (this.isRunHalted()) return;

      this.updateSpits(dt);
      if (this.isRunHalted()) return;

      this.updateAcidPools(dt);
      if (this.isRunHalted()) return;

      this.updateDrops(dt);
      this.updateFX(dt);

      if (s.isCoop && CoopManager.role === 'host') {
        this.flushPendingNetFire(dt);
        this.checkCoopSquadWipe();
        this.worldSyncTimer -= dt;
        this.playersFastTimer -= dt;
        if (!CoopManager.isCongested()) {
          if (this.worldSyncTimer <= 0) {
            this.worldSyncTimer = 0.1;
            this.playersFastTimer = 0.05;
            CoopManager.broadcastToClients({ type: 'world_sync', w: this.buildWorldSyncPayload() });
          } else if (this.playersFastTimer <= 0) {
            this.playersFastTimer = 0.05;
            CoopManager.broadcastToClients({ type: 'players_fast', list: this.buildAllPlayersSync() });
          }
        }
      }
    }

    // 若重伤昏迷观战，镜头自动平滑跟随在场存活队友
    let camTargetX = s.player.x;
    let camTargetY = s.player.y;
    if (s.isCoop && s.player.spectating) {
      const aliveMate = s.remotePlayers.find((rp) => !rp.downed && !rp.spectating && rp.hp > 0);
      if (aliveMate) {
        camTargetX = aliveMate.x;
        camTargetY = aliveMate.y;
      }
    }
    const lerp = Math.min(1, dt * 8.5);
    s.camera.x += (camTargetX - s.camera.x) * lerp;
    s.camera.y += (camTargetY - s.camera.y) * lerp;
  }

  public render(viewW: number, viewH: number): void {
    if (!this.state) return;
    this.renderer.render(this.ctx, viewW, viewH, this.state, this.input);
  }

  private updateWaveLogic(dt: number): void {
    const s = this.state!;
    const scaling = getCoopScaling(s.squadCount);
    if (s.waveState === 'fighting') {
      if (this.spawnQueue.length > 0) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          if (s.zombies.length >= scaling.maxActiveZombies) {
            // 同屏在场僵尸上限保护，待击杀腾出空位后无缝续刷
            this.spawnTimer = 0.2;
          } else {
            // 中后期及多人联机多窗口并发涌入，营造四面楚歌的防守张力
            const baseBurst = s.wave >= 10 ? 3 : s.wave >= 7 ? 3 : s.wave >= 4 ? 2 : 1;
            const maxBurst = baseBurst + (s.squadCount >= 3 ? 1 : 0);
            const burst =
              maxBurst > 1 ? 1 + Math.floor(Math.random() * maxBurst) : 1;
            for (
              let b = 0;
              b < burst && this.spawnQueue.length > 0 && s.zombies.length < scaling.maxActiveZombies;
              b++
            ) {
              const kind = this.spawnQueue.shift()!;
              this.spawnZombie(kind);
              if (isBossKind(kind) || kind === 'miniboss') break;
            }
            const baseInterval = Math.max(0.2, (1.12 - s.wave * 0.068) / scaling.spawnRateMult);
            this.spawnTimer = baseInterval * (0.72 + Math.random() * 0.45);
          }
        }
      } else if (s.zombies.length === 0) {
        if (s.electricFortifyWaves > 0) s.electricFortifyWaves -= 1;
        this.onWaveSurvivedLocal(s.wave);

        // 波次清空时立刻拉起所有倒地/观战队友！
        if (s.isCoop) {
          const now = performance.now();
          this.reviveLocalPlayerFromWaveOrTeammate();
          for (const rp of s.remotePlayers) {
            if (rp.downed || rp.spectating || rp.hp <= 0) {
              rp.downed = false;
              rp.spectating = false;
              rp.bleedoutTimer = 0;
              rp.reviveProgress = 0;
              rp.hp = Math.round(rp.maxHp * 0.55);
              rp.invulnTimer = 3.2;
              this.reviveSyncGraceUntil.set(rp.peerId, now + 2200);
            }
          }
          CoopManager.broadcastToClients({ type: 'evt_team_reward', waveAutoRevive: true });
        }

        if (s.relicIds.includes('piggy_bank') && s.cash > 0) {
          const interest = Math.min(180, Math.round(s.cash * 0.1));
          s.cash += interest;
          this.spawnFloatingText(s.player.x, s.player.y - 42, I18n.t('ftInterest', { n: interest }), '#fde047', 1.3);
          SoundFX.coin();
        }

        if (s.mode === 'standard' && s.wave >= s.maxWaves) {
          s.waveState = 'extraction';
          s.extractionTimer = 0;
          this.extractionSpawnTimer = 1.2;
          const yard = s.rooms.find((r) => r.id === 'courtyard');
          if (yard && !yard.unlocked) {
            s.rooms.forEach((rm) => (rm.unlocked = true));
            s.doors.forEach((d) => (d.unlocked = true));
            s.mapRevision += 1;
            this.rebuildWalkableMask();
            this.rebuildFlowField();
          }
          SoundFX.fanfare();
          PlatformSDK.happyTime();
          const bMsg = I18n.t('bannerEvacReady');
          this.showBanner(bMsg, 4.5);
          if (s.isCoop) {
            CoopManager.broadcastToClients({ type: 'evt_fx', kind: 'banner', text: bMsg, dur: 4.5 });
          }
        } else {
          s.waveState = 'intermission';
          s.intermissionTimer = 5.0;
        }
      }
      s.zombiesRemainingInWave = this.spawnQueue.length + s.zombies.length;
    } else if (s.waveState === 'intermission') {
      s.intermissionTimer -= dt;
      if (s.intermissionTimer <= 0) {
        this.prepareWave(s.wave + 1);
      }
    } else if (s.waveState === 'extraction') {
      s.extractionTimer += dt;
      // 撤离突围阶段持续刷出追击尸潮，多人模式追兵更密集！
      this.extractionSpawnTimer -= dt;
      const maxExtZombies = 14 + (s.squadCount - 1) * 6;
      if (this.extractionSpawnTimer <= 0 && s.zombies.length < maxExtZombies) {
        this.extractionSpawnTimer = Math.max(0.65, 1.35 / scaling.spawnRateMult);
        this.spawnZombie(Math.random() < 0.6 ? 'runner' : 'walker');
      }

      const aliveList = this.getAliveCombatants();
      const onPadCount = aliveList.filter(
        (c) => Math.hypot(c.x - s.stage.helipadPos.x, c.y - s.stage.helipadPos.y) <= 92
      ).length;
      if (onPadCount > 0) {
        const ratio = onPadCount / Math.max(1, aliveList.length);
        const speedMult = ratio >= 1 ? 1 : 0.42 + ratio * 0.45;
        s.extractionProgress = Math.min(1, s.extractionProgress + (dt / 2.8) * speedMult);
        if (s.extractionProgress >= 1) {
          s.waveState = 'ended';
          PlatformSDK.gameplayStop();
          PlatformSDK.happyTime();
          SaveManager.markStageCleared(s.stage.id);
          SaveManager.addDailyProgress('clear', 1);
          this.flushRunTelemetry(true);
          if (s.isCoop && CoopManager.role === 'host') {
            CoopManager.broadcastToClients({ type: 'evt_run_finished', victory: true });
          }
          this.callbacks.onRunFinished(true, s);
        }
      } else {
        s.extractionProgress = Math.max(0, s.extractionProgress - dt * 0.55);
      }
    }
  }

  private spawnZombie(kind: ZombieKind): void {
    const s = this.state!;
    const scaling = getCoopScaling(s.squadCount);
    const activeWindows = s.windows.filter((w) => {
      const r = s.rooms.find((rm) => rm.id === w.roomId);
      return r?.unlocked;
    });

    // 动态均衡分配各朝向破窗压力，让尸潮真正从东南西北四面八方同时包抄围攻！
    const windowLoad = new Map<string, number>();
    for (const oz of s.zombies) {
      if (!oz.insideBuilding && oz.targetWindowId) {
        windowLoad.set(oz.targetWindowId, (windowLoad.get(oz.targetWindowId) || 0) + 1);
      }
    }
    let win = s.windows[0];
    if (activeWindows.length > 0) {
      const weights = activeWindows.map((w) => 1 / (1 + (windowLoad.get(w.id) || 0) * 1.35));
      const totalW = weights.reduce((acc, v) => acc + v, 0);
      let pick = Math.random() * totalW;
      win = activeWindows[activeWindows.length - 1];
      for (let idx = 0; idx < activeWindows.length; idx++) {
        pick -= weights[idx];
        if (pick <= 0) {
          win = activeWindows[idx];
          break;
        }
      }
    }
    const wf = this.getWindowFrame(win);

    // 紧绷硬核且平滑衔接 8 大战区与 1~4 人联机动态血量/伤害膨胀曲线！
    const stageMult = 1 + (s.stage.index - 1) * 0.22;
    const hpScale =
      (1 + (s.wave - 1) * 0.42 + Math.pow(Math.max(0, s.wave - 3), 1.76) * 0.36) *
      stageMult *
      scaling.hpMult;
    const dmgScale =
      (1 + Math.max(0, s.wave - 1) * 0.095 + (s.stage.index - 1) * 0.095) * scaling.dmgMult;
    const stageBountyMult = 1 + (s.stage.index - 1) * 0.08;
    const cashTaper = stageBountyMult / (1 + Math.max(0, s.wave - 3) * 0.14);

    let hp = Math.round(68 * hpScale);
    let speed = 108 + Math.min(86, s.wave * 7.2);
    let radius = 24;
    let damage = Math.round(17 * dmgScale);
    let cash = Math.max(5, Math.round(10 * cashTaper));
    let xp = Math.round(10 * stageBountyMult);
    let color = '#4ade80';
    let rangedCd = 2.2;
    let fleeTimer = 0;

    if (kind === 'thief') {
      hp = Math.round(
        (320 + s.wave * 110 + Math.pow(Math.max(0, s.wave - 3), 1.65) * 75) *
          (1 + (s.stage.index - 1) * 0.2) *
          scaling.hpMult
      );
      speed = 214;
      radius = 25;
      damage = 0;
      cash = Math.round(130 * stageBountyMult);
      xp = Math.round(42 * stageBountyMult);
      color = '#facc15';
      rangedCd = 5;
      fleeTimer = 15;
    } else if (kind === 'runner') {
      hp = Math.round(50 * hpScale);
      speed = 182 + Math.min(92, s.wave * 7.8);
      radius = 21;
      damage = Math.round(15 * dmgScale);
      cash = Math.max(6, Math.round(12 * cashTaper));
      xp = 12;
      color = '#fb7185';
    } else if (kind === 'spitter') {
      hp = Math.round(98 * hpScale);
      speed = 104 + Math.min(54, s.wave * 4.5);
      radius = 27;
      damage = Math.round(18 * dmgScale);
      cash = Math.max(8, Math.round(16 * cashTaper));
      xp = 16;
      color = '#a3e635';
    } else if (kind === 'boomer') {
      hp = Math.round(92 * hpScale);
      speed = 118 + Math.min(62, s.wave * 5.2);
      radius = ZOMBIE_RADIUS_BY_KIND.boomer;
      damage = Math.round(21 * dmgScale);
      cash = Math.max(9, Math.round(16 * cashTaper));
      xp = 18;
      color = ZOMBIE_COLOR_BY_KIND.boomer;
    } else if (kind === 'riot') {
      hp = Math.round(158 * hpScale);
      speed = 96 + Math.min(48, s.wave * 4.2);
      radius = ZOMBIE_RADIUS_BY_KIND.riot;
      damage = Math.round(20 * dmgScale);
      cash = Math.max(10, Math.round(19 * cashTaper));
      xp = 20;
      color = ZOMBIE_COLOR_BY_KIND.riot;
    } else if (kind === 'frost') {
      hp = Math.round(78 * hpScale);
      speed = 138 + Math.min(58, s.wave * 5.0);
      radius = ZOMBIE_RADIUS_BY_KIND.frost;
      damage = Math.round(16 * dmgScale);
      cash = Math.max(9, Math.round(17 * cashTaper));
      xp = 18;
      color = ZOMBIE_COLOR_BY_KIND.frost;
    } else if (kind === 'necro') {
      hp = Math.round(126 * hpScale);
      speed = 104 + Math.min(50, s.wave * 4.2);
      radius = ZOMBIE_RADIUS_BY_KIND.necro;
      damage = Math.round(18 * dmgScale);
      cash = Math.max(12, Math.round(22 * cashTaper));
      xp = 24;
      color = ZOMBIE_COLOR_BY_KIND.necro;
      rangedCd = 2.6;
    } else if (kind === 'miniboss') {
      hp = Math.round(880 * hpScale);
      speed = 102 + Math.min(58, s.wave * 5);
      radius = 38;
      damage = Math.round(32 * dmgScale);
      cash = 110;
      xp = 62;
      color = '#a855f7';
    } else if (isBossKind(kind)) {
      const bp = getBossProfile(kind);
      hp = Math.round(2450 * hpScale * bp.hpMult);
      speed = bp.speedBase + Math.min(54, s.wave * 4.5);
      radius = bp.radius;
      damage = Math.round(42 * dmgScale);
      cash = 300;
      xp = 150;
      color = bp.color;
      rangedCd = 2.2;
    }

    // 360° 广角环城外围散点生成：按 ~150° 大扇面分布在建筑外圈与镜头视野外，彻底告别直线排队进场！
    const bb = s.stage.buildingBounds;
    const baseOutAng = Math.atan2(wf.outY, wf.outX);
    const spreadAng = baseOutAng + (Math.random() - 0.5) * 2.58;
    const dirX = Math.cos(spreadAng);
    const dirY = Math.sin(spreadAng);
    const baseDist = 420 + Math.random() * 270;
    let wx = wf.wcx + dirX * baseDist;
    let wy = wf.wcy + dirY * baseDist;

    const outPad = 115;
    for (let step = 0; step < 12; step++) {
      const insideOuterEnvelope =
        wx > bb.x - outPad &&
        wx < bb.x + bb.w + outPad &&
        wy > bb.y - outPad &&
        wy < bb.y + bb.h + outPad;
      if (!insideOuterEnvelope && !this.isPointInsideAnyRoom(wx, wy, 48)) {
        break;
      }
      wx += (dirX * 0.65 + wf.outX * 0.65) * 78;
      wy += (dirY * 0.65 + wf.outY * 0.65) * 78;
    }

    const zoom = Math.max(0.45, s.camera.zoom || 1);
    const camHalfW = this.lastViewW / (2 * zoom) + radius + 68;
    const camHalfH = this.lastViewH / (2 * zoom) + radius + 68;
    for (let step = 0; step < 12; step++) {
      if (Math.abs(wx - s.camera.x) >= camHalfW || Math.abs(wy - s.camera.y) >= camHalfH) {
        break;
      }
      const pushAng = Math.atan2(wy - s.camera.y || wf.outY, wx - s.camera.x || wf.outX);
      wx += Math.cos(pushAng) * 86;
      wy += Math.sin(pushAng) * 86;
    }

    s.zombies.push({
      id: this.nextEntityId++,
      kind,
      x: wx,
      y: wy,
      vx: 0,
      vy: 0,
      radius,
      hp,
      maxHp: hp,
      speed,
      damage,
      cashReward: cash,
      xpReward: xp,
      color,
      targetWindowId: win.id,
      insideBuilding: false,
      hitFlash: 0,
      burnTimer: 0,
      slowTimer: 0,
      stunTimer: 0,
      attackCd: 0,
      rangedCd,
      fleeTimer,
      wobblePhase: Math.random() * Math.PI * 2,
      facingAngle: Math.atan2(wf.wcy - wy, wf.wcx - wx),
      attackAnim: 0,
      attackState: 'none',
      attackStateTimer: 0,
      slashAngle: Math.atan2(wf.wcy - wy, wf.wcx - wx),
      recoilVx: 0,
      recoilVy: 0,
    });
  }

  private updatePlayer(dt: number, viewW: number, viewH: number): void {
    const s = this.state!;
    const p = s.player;
    const pStats = SaveManager.getEffectivePlayerStats();
    const wep = p.weapons[p.activeSlot];
    const def = WEAPONS[wep.defId];

    if (p.invulnTimer > 0) p.invulnTimer -= dt;
    if (p.hitFlashTimer > 0) p.hitFlashTimer = Math.max(0, p.hitFlashTimer - dt);
    if (p.fireCooldown > 0) p.fireCooldown -= dt;
    if (p.grenadeCooldown > 0) p.grenadeCooldown -= dt;
    if (p.muzzleFlashTimer > 0) p.muzzleFlashTimer -= dt;
    if (p.recoilOffset > 0) p.recoilOffset = Math.max(0, p.recoilOffset - dt * 42);
    if (p.weaponSwapTimer > 0) p.weaponSwapTimer = Math.max(0, p.weaponSwapTimer - dt);
    if (p.chillTimer > 0) p.chillTimer = Math.max(0, p.chillTimer - dt);
    if (p.chillImmuneTimer > 0) p.chillImmuneTimer = Math.max(0, p.chillImmuneTimer - dt);
    if (p.footDustCd > 0) p.footDustCd -= dt;

    this.localPlayerVx = 0;
    this.localPlayerVy = 0;

    if (p.spectating) {
      p.isMoving = false;
      p.repairProgress = 0;
      return;
    }

    if (p.downed) {
      p.repairProgress = 0;
      p.bleedoutTimer = Math.max(0, p.bleedoutTimer - dt);
      if (p.bleedoutTimer <= 0) {
        p.spectating = true;
        p.isMoving = false;
        this.showBanner(I18n.t('bannerBledOut'), 3.4);
        return;
      }
      // 倒地状态可缓慢向队友方向爬行求援
      const mvDown = this.input.getMoveVector();
      const crawlSpd = pStats.moveSpeed * 0.32;
      const ox = p.x;
      const oy = p.y;
      p.x += mvDown.x * crawlSpd * dt;
      p.y += mvDown.y * crawlSpd * dt;
      this.resolveEntityInsideWalls(p);
      if (dt > 0.0005) {
        this.localPlayerVx = (p.x - ox) / dt;
        this.localPlayerVy = (p.y - oy) / dt;
      }
      const crawled = Math.hypot(p.x - ox, p.y - oy);
      p.isMoving = crawled > 0.2;
      if (p.isMoving) {
        p.walkPhase += crawled * 0.1;
        p.angle = Math.atan2(p.y - oy, p.x - ox);
        p.legAngle = p.angle;
      }
      return;
    }

    if (def.sawblade) {
      p.barrelSpin += dt * 18;
    }

    if (p.reloadTimer > 0) {
      p.reloadTimer -= dt;
      if (p.reloadTimer <= 0) {
        p.reloadTimer = 0;
        const maxMag = this.getMaxMag(wep.defId, wep.evolved);
        if (wep.reserve < 0) {
          wep.mag = maxMag;
        } else {
          const needed = maxMag - wep.mag;
          const load = Math.min(needed, wep.reserve);
          wep.mag += load;
          wep.reserve -= load;
        }
        SoundFX.reloadDone();
      }
    }

    const mv = this.input.getMoveVector();
    const inAcid = s.acidPools.some((ap) => Math.hypot(p.x - ap.x, p.y - ap.y) <= ap.radius + p.radius * 0.5);
    let speed =
      pStats.moveSpeed *
      1.05 *
      s.modifiers.moveSpeedMult *
      def.moveSpeedMult *
      (inAcid ? 0.78 : 1) *
      (p.chillTimer > 0 ? 0.86 : 1);
    if (s.feverTimer > 0 || s.powerUpTimers.overdrive > 0) speed *= 1.24;

    const oldX = p.x;
    const oldY = p.y;
    p.x += mv.x * speed * dt;
    p.y += mv.y * speed * dt;
    this.resolveEntityInsideWalls(p);
    if (dt > 0.0005) {
      this.localPlayerVx = (p.x - oldX) / dt;
      this.localPlayerVy = (p.y - oldY) / dt;
    }

    const moved = Math.hypot(p.x - oldX, p.y - oldY);
    p.isMoving = moved > 0.35;
    if (p.isMoving) {
      p.walkPhase += moved * 0.115;
      const moveAng = Math.atan2(p.y - oldY, p.x - oldX);
      p.legAngle = this.lerpAngle(p.legAngle, moveAng, Math.min(1, dt * 15));

      if (p.footDustCd <= 0 && s.particles.length < 110) {
        p.footDustCd = 0.14;
        const side = Math.sin(p.walkPhase) >= 0 ? 1 : -1;
        const perp = p.legAngle + Math.PI / 2;
        s.particles.push({
          x: p.x - Math.cos(p.legAngle) * 10 + Math.cos(perp) * side * 7,
          y: p.y - Math.sin(p.legAngle) * 10 + Math.sin(perp) * side * 7,
          vx: -Math.cos(p.legAngle) * 24 + (Math.random() - 0.5) * 16,
          vy: -Math.sin(p.legAngle) * 24 + (Math.random() - 0.5) * 16,
          size: 3.6,
          color: 'rgba(226, 232, 240, 0.55)',
          life: 0.24,
          maxLife: 0.24,
        });
      }

      if (s.relicIds.includes('static_boots')) {
        p.distanceAccum += moved;
        if (p.distanceAccum >= 260 && s.zombies.length > 0) {
          p.distanceAccum = 0;
          this.triggerChainLightning(p.x, p.y, 65 * s.modifiers.damageMult, 3);
        }
      }
    } else {
      // 站立时双脚柔和归位朝向准星方向
      p.legAngle = this.lerpAngle(p.legAngle, p.angle, Math.min(1, dt * 8));
    }

    // 考虑镜头 Zoom 的精准鼠标瞄准坐标换算
    const zoom = s.camera.zoom;
    const worldMouseX = (this.input.mouseScreenX - viewW / 2) / zoom + s.camera.x;
    const worldMouseY = (this.input.mouseScreenY - viewH / 2) / zoom + s.camera.y;

    let wantFire = false;
    if (this.input.attackBtnStick.active) {
      wantFire = true;
      if (this.input.attackBtnStick.dx !== 0 || this.input.attackBtnStick.dy !== 0) {
        p.angle = Math.atan2(this.input.attackBtnStick.dy, this.input.attackBtnStick.dx);
      } else {
        const target = this.findNearestTarget(p.x, p.y, 540);
        if (target) {
          p.angle = Math.atan2(target.y - p.y, target.x - p.x);
        } else if (mv.x !== 0 || mv.y !== 0) {
          p.angle = Math.atan2(mv.y, mv.x);
        }
      }
    } else if (this.input.aimStick.active && (this.input.aimStick.dx !== 0 || this.input.aimStick.dy !== 0)) {
      p.angle = Math.atan2(this.input.aimStick.dy, this.input.aimStick.dx);
      wantFire = true;
    } else if (!this.input.usingTouch && this.input.mouseDown) {
      p.angle = Math.atan2(worldMouseY - p.y, worldMouseX - p.x);
      wantFire = true;
    } else if (this.input.autoFireEnabled) {
      const target = this.findNearestTarget(p.x, p.y, 480);
      if (target) {
        p.angle = Math.atan2(target.y - p.y, target.x - p.x);
        wantFire = true;
      } else if (!this.input.usingTouch) {
        p.angle = Math.atan2(worldMouseY - p.y, worldMouseX - p.x);
      } else if (mv.x !== 0 || mv.y !== 0) {
        p.angle = Math.atan2(mv.y, mv.x);
      }
    } else if (!this.input.usingTouch) {
      p.angle = Math.atan2(worldMouseY - p.y, worldMouseX - p.x);
    } else if (mv.x !== 0 || mv.y !== 0) {
      p.angle = Math.atan2(mv.y, mv.x);
    }

    if (wantFire) {
      if (def.id === 'minigun') {
        p.barrelSpin += dt * 26;
      }
      this.tryFirePlayerWeapon();
    }
  }

  private lerpAngle(a: number, b: number, t: number): number {
    let diff = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }

  private hasBulletLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(3, Math.ceil(dist / 24));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const mx = x1 + (x2 - x1) * t;
      const my = y1 + (y2 - y1) * t;
      if (this.findBulletBlocker(mx, my, 4)) return false;
    }
    return true;
  }

  private isZombieTargetableForAutoAim(z: ZombieEntity): boolean {
    if (z.insideBuilding) return true;
    if (!z.targetWindowId) return false;
    const win = this.state!.windows.find((w) => w.id === z.targetWindowId);
    if (!win) return false;
    const room = this.state!.rooms.find((r) => r.id === win.roomId);
    if (!room?.unlocked) return false;
    // 允许手机自动瞄准与哨戒炮透过已解锁房间的窗户射击洞口，主动清剿窗外逼近及扒窗的丧尸！
    const wcx = win.x + win.w / 2;
    const wcy = win.y + win.h / 2;
    return Math.hypot(z.x - wcx, z.y - wcy) <= z.radius + 260;
  }

  private findNearestTarget(x: number, y: number, maxRange: number): ZombieEntity | null {
    const s = this.state!;
    let best: ZombieEntity | null = null;
    let bestScore = Infinity;
    for (const z of s.zombies) {
      if (z.hp <= 0) continue;
      const dx = z.x - x;
      const dy = z.y - y;
      if (Math.abs(dx) > maxRange || Math.abs(dy) > maxRange) continue;
      const d = Math.hypot(dx, dy);
      if (d > maxRange) continue;
      // 优先集火盗宝怪与已破窗入室的丧尸，室内安全时顺畅朝窗外倾泻火力
      const score = z.kind === 'thief' ? d * 0.52 : z.insideBuilding ? d * 0.68 : d * 1.12;
      // 先判断分数是否优于当前最优目标，再执行昂贵的墙壁穿刺射线检测（减少 ~90% 射线开销！）
      if (score >= bestScore) continue;
      if (!this.isZombieTargetableForAutoAim(z)) continue;
      if (!this.hasBulletLineOfSight(x, y, z.x, z.y)) continue;
      bestScore = score;
      best = z;
    }
    return best;
  }

  private tryAutoRefillEmptyWeapon(wep: RunSnapshot['player']['weapons'][number]): boolean {
    const s = this.state!;
    const p = s.player;
    const def = WEAPONS[wep.defId];
    if (def.maxReserve <= 0) return false;
    if (!SaveManager.get().autoBuyAmmo) return false;
    const ammoCost = this.getEffectiveAmmoCost(def.id);
    if (s.cash < ammoCost) return false;

    s.cash -= ammoCost;
    wep.mag = this.getMaxMag(def.id, wep.evolved);
    wep.reserve = this.getMaxReserve(def.id, wep.evolved);
    s.lastPrimaryWeaponId = def.id;
    p.reloadTimer = 0;
    p.reloadDuration = 0;
    p.weaponSwapTimer = 0.2;
    SoundFX.reloadDone();
    const wLabel = wep.evolved ? I18n.wSuperName(def.id, def.superName) : I18n.wName(def.id, def.name);
    this.spawnFloatingText(
      p.x,
      p.y - 38,
      I18n.t('ftAutoAmmoBought', { name: wLabel, cost: ammoCost }),
      '#38bdf8',
      1.18
    );
    return true;
  }

  private tryFirePlayerWeapon(): void {
    const s = this.state!;
    const p = s.player;
    const wep = p.weapons[p.activeSlot];
    const def = WEAPONS[wep.defId];
    const overdrive = s.powerUpTimers.overdrive > 0;

    if (!overdrive && p.reloadTimer > 0) return;
    if (!overdrive && wep.mag <= 0) {
      if (wep.reserve === 0) {
        if (!this.tryAutoRefillEmptyWeapon(wep)) {
          if (p.activeSlot !== 0) {
            this.notifyAndFallbackFromEmptyWeapon(wep);
          }
          return;
        }
      } else {
        this.startReload();
        return;
      }
    }
    if (p.fireCooldown > 0) return;

    const rateMult =
      s.modifiers.fireRateMult *
      (overdrive ? 1.6 : 1) *
      (s.feverTimer > 0 ? 1.26 : 1) *
      (wep.evolved ? 1.16 : 1);
    p.fireCooldown = 1 / (def.fireRate * rateMult);

    if (!overdrive) {
      wep.mag -= 1;
      if (wep.mag <= 0) {
        if (wep.reserve > 0 || wep.reserve < 0) {
          this.startReload();
        } else if (wep.reserve === 0) {
          this.tryAutoRefillEmptyWeapon(wep);
        }
      }
    }

    const extraFloor = Math.floor(s.modifiers.extraPellets);
    const extraFrac = s.modifiers.extraPellets - extraFloor;
    const totalPellets = def.pellets + extraFloor + (Math.random() < extraFrac ? 1 : 0);
    const isCrit = Math.random() < s.modifiers.critChance;
    const lowHpMult =
      s.modifiers.lowHpDamageBonus > 0 && p.hp <= p.maxHp * 0.55 ? 1 + s.modifiers.lowHpDamageBonus : 1;
    const baseDmg =
      def.damage *
      s.modifiers.damageMult *
      this.getSectorDamageMult() *
      lowHpMult *
      (wep.evolved ? 1.58 : 1) *
      (isCrit ? s.modifiers.critDamageMult : 1);

    const isAkimbo = Boolean(def.akimboOnEvolve && wep.evolved);
    p.akimboAlt = !p.akimboAlt;
    const sideOffset = isAkimbo ? (p.akimboAlt ? 11 : -11) : 0;
    const perpAng = p.angle + Math.PI / 2;
    const fwdDist =
      def.id === 'sniper'
        ? p.radius + 32
        : def.id === 'minigun' || def.id === 'plasma' || def.id === 'tesla'
          ? p.radius + 26
          : p.radius + 18;
    const muzzleX = p.x + Math.cos(p.angle) * fwdDist + Math.cos(perpAng) * sideOffset;
    const muzzleY = p.y + Math.sin(p.angle) * fwdDist + Math.sin(perpAng) * sideOffset;

    const isClientOnly = s.isCoop && CoopManager.role === 'client';
    const netBullets: SerializedBullet[] = [];

    for (let i = 0; i < totalPellets; i++) {
      const offset =
        totalPellets === 1
          ? (Math.random() - 0.5) * def.spread
          : (i / (totalPellets - 1) - 0.5) * def.spread + (Math.random() - 0.5) * 0.04;
      const ang = p.angle + offset;

      if (s.bullets.length >= 165) {
        s.bullets.shift();
      }
      const bSpec: SerializedBullet = {
        x: Math.round(muzzleX * 10) / 10,
        y: Math.round(muzzleY * 10) / 10,
        vx: Math.round(Math.cos(ang) * def.bulletSpeed * 10) / 10,
        vy: Math.round(Math.sin(ang) * def.bulletSpeed * 10) / 10,
        radius:
          def.sawblade
            ? wep.evolved
              ? 13
              : 10.5
            : def.flame || def.cryo
              ? 8.5
              : def.laser
                ? 6
                : def.explosiveRadius
                  ? 6.5
                  : isCrit
                    ? 5.5
                    : 4.4,
        damage: Math.round(baseDmg * 10) / 10,
        knockback: Math.round(def.knockback),
        pierceLeft: def.pierce + s.modifiers.extraPierce + (wep.evolved ? 1 : 0),
        bouncesLeft:
          (def.bounces || 0) +
          (def.sawblade && wep.evolved ? 2 : 0) +
          (s.relicIds.includes('rubber_bullets') && !def.explosiveRadius ? 1 : 0),
        explosiveRadius: def.explosiveRadius ? Math.round(def.explosiveRadius * (wep.evolved ? 1.35 : 1)) : 0,
        color: isCrit ? '#fde047' : wep.evolved ? def.superColor : def.color,
        isCrit,
        flame: Boolean(def.flame || (def.id === 'shotgun' && wep.evolved) || s.relicIds.includes('dragon_oil')),
        cryo: Boolean(def.cryo || (s.modifiers.cryoShotChance > 0 && Math.random() < s.modifiers.cryoShotChance)),
        electric: Boolean(
          def.electric ||
            ((def.id === 'smg' || def.id === 'sniper') && wep.evolved) ||
            (s.modifiers.electricShotChance > 0 && Math.random() < s.modifiers.electricShotChance)
        ),
        laser: Boolean(def.laser),
        sawblade: Boolean(def.sawblade),
        life: def.flame || def.cryo ? 0.44 : def.sawblade ? 2.4 : 1.4,
      };
      if (s.isCoop) netBullets.push(bSpec);
      s.bullets.push({
        ...bSpec,
        hitIds: new Set(),
        localVisualOnly: isClientOnly,
      });
    }

    p.muzzleFlashTimer = 0.07;
    p.recoilOffset =
      def.id === 'shotgun' || def.id === 'sniper' || def.id === 'launcher' || def.id === 'revolver'
        ? 10.5
        : def.flame || def.cryo
          ? 2.2
          : 6.5;
    s.camera.shake = Math.max(
      s.camera.shake,
      def.id === 'shotgun' || def.id === 'launcher' || def.id === 'sniper' ? 0.3 : 0.07
    );

    if (!def.flame && !def.cryo && !def.laser && !def.sawblade && def.id !== 'crossbow' && def.id !== 'tesla') {
      const shellAng = p.angle + Math.PI * 0.6 + (Math.random() - 0.5) * 0.4;
      s.particles.push({
        x: p.x,
        y: p.y,
        vx: Math.cos(shellAng) * 95,
        vy: Math.sin(shellAng) * 95,
        size: 3.4,
        color: '#fbbf24',
        life: 0.42,
        maxLife: 0.42,
        isShell: true,
        angle: Math.random() * Math.PI * 2,
      });
    }

    const sfxMap: Record<string, 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'minigun' | 'plasma'> = {
      pistol: 'pistol',
      revolver: 'shotgun',
      smg: 'smg',
      shotgun: 'shotgun',
      autoshotgun: 'shotgun',
      rifle: 'rifle',
      flamethrower: 'smg',
      crossbow: 'rifle',
      sniper: 'shotgun',
      cryogun: 'smg',
      launcher: 'shotgun',
      sawlauncher: 'rifle',
      minigun: 'minigun',
      tesla: 'plasma',
      plasma: 'plasma',
    };
    const sfxKey = sfxMap[def.id] || 'rifle';
    SoundFX.shoot(sfxKey, wep.evolved);

    if (s.isCoop && netBullets.length > 0) {
      for (const nb of netBullets) {
        if (this.pendingNetBullets.length < 36) {
          this.pendingNetBullets.push(nb);
        }
      }
      this.pendingFireSfx = sfxKey;
      this.pendingFireEvolved = wep.evolved;
      if (this.fireFlushTimer <= 0) {
        this.sendPendingNetFireNow();
        this.fireFlushTimer = 0.048;
      }
    }

    if (!overdrive && wep.mag <= 0 && wep.reserve === 0 && p.activeSlot !== 0) {
      this.notifyAndFallbackFromEmptyWeapon(wep);
    }
  }

  private notifyAndFallbackFromEmptyWeapon(wep: RunSnapshot['player']['weapons'][number]): void {
    const s = this.state!;
    const p = s.player;
    const def = WEAPONS[wep.defId];
    if (def.maxReserve > 0) {
      s.lastPrimaryWeaponId = wep.defId;
    }
    const wLabel = wep.evolved ? I18n.wSuperName(def.id, def.superName) : I18n.wName(def.id, def.name);
    p.activeSlot = 0;
    p.reloadTimer = 0;
    p.reloadDuration = 0;
    p.weaponSwapTimer = 0.3;
    p.fireCooldown = Math.max(p.fireCooldown, 0.25);
    SoundFX.emptyClip();
    const effAmmoCost = this.getEffectiveAmmoCost(def.id);
    this.showBanner(I18n.t('bannerOutOfAmmo', { name: wLabel, cost: effAmmoCost }), 4.0);
    this.spawnFloatingText(p.x, p.y - 38, I18n.t('ftOutOfAmmo', { name: wLabel }), '#fde047', 1.28);
  }

  private flushPendingNetFire(dt: number): void {
    if (this.fireFlushTimer > 0) {
      this.fireFlushTimer -= dt;
    }
    if (this.fireFlushTimer <= 0 && this.pendingNetBullets.length > 0) {
      this.sendPendingNetFireNow();
      this.fireFlushTimer = 0.048;
    }
  }

  private sendPendingNetFireNow(): void {
    if (this.pendingNetBullets.length === 0) return;
    const bullets = this.pendingNetBullets;
    this.pendingNetBullets = [];
    const fireMsg: CoopNetMessage = {
      type: 'cmd_fire',
      ownerId: CoopManager.myPeerId,
      bullets,
      sfxKey: this.pendingFireSfx,
      evolved: this.pendingFireEvolved,
    };
    if (CoopManager.role === 'client') {
      CoopManager.sendToHost(fireMsg);
    } else if (CoopManager.role === 'host' && !CoopManager.isCongested()) {
      CoopManager.broadcastToClients(fireMsg);
    }
  }

  private updateGrenades(dt: number): void {
    const s = this.state!;
    for (let i = s.grenadesThrown.length - 1; i >= 0; i--) {
      const g = s.grenadesThrown[i];
      g.fuse -= dt;
      g.vz -= 520 * dt;
      g.z += g.vz * dt;
      if (g.z <= 0) {
        g.z = 0;
        g.vz = Math.abs(g.vz) * 0.45;
        g.vx *= 0.65;
        g.vy *= 0.65;
      }
      g.spinAngle += dt * (g.z > 2 ? 10.5 : Math.hypot(g.vx, g.vy) * 0.045);

      const nx = g.x + g.vx * dt;
      const ny = g.y + g.vy * dt;
      if (this.findBlockingWallOrLockedDoor(nx, g.y, 8)) g.vx = -g.vx * 0.6;
      else g.x = nx;
      if (this.findBlockingWallOrLockedDoor(g.x, ny, 8)) g.vy = -g.vy * 0.6;
      else g.y = ny;

      // 引信白烟与火星拖尾粒子
      if (s.particles.length < 135 && Math.random() < 0.65) {
        const isSpark = Math.random() < 0.45;
        s.particles.push({
          x: g.x + (Math.random() - 0.5) * 6,
          y: g.y - g.z - 6 + (Math.random() - 0.5) * 5,
          vx: -g.vx * 0.12 + (Math.random() - 0.5) * 36,
          vy: -g.vy * 0.12 - 18 + (Math.random() - 0.5) * 36,
          size: isSpark ? 2.4 : 4.5,
          color: isSpark ? '#fde047' : 'rgba(203, 213, 225, 0.52)',
          life: isSpark ? 0.16 : 0.34,
          maxLife: isSpark ? 0.16 : 0.34,
          isSmoke: !isSpark,
        });
      }

      if (g.fuse <= 0) {
        this.explodeAt(g.x, g.y, g.radius, g.damage);
        s.grenadesThrown.splice(i, 1);
      }
    }
  }

  private applyDoorFunding(door: RunSnapshot['doors'][number], rawAmount: number, contributorPeerId?: string): void {
    const s = this.state!;
    if (door.unlocked || rawAmount <= 0) return;
    const needed = Math.max(0, door.cost - door.paidAmount);
    const accepted = Math.min(needed, rawAmount);
    const refund = rawAmount - accepted;

    if (refund > 0) {
      if (!contributorPeerId || contributorPeerId === CoopManager.myPeerId) {
        s.cash += refund;
      } else if (CoopManager.role === 'host') {
        CoopManager.sendToClient(contributorPeerId, {
          type: 'evt_team_reward',
          targetId: contributorPeerId,
          cashDelta: refund,
        });
      }
    }

    if (accepted <= 0) return;
    door.paidAmount += accepted;
    const cx = door.x + door.w / 2;
    const cy = door.y + door.h / 2;

    if (door.paidAmount >= door.cost) {
      door.paidAmount = door.cost;
      const newlyUnlockedRooms: RuntimeRoom[] = [];
      for (const rid of [door.unlockRoomId, door.roomA, door.roomB]) {
        const rObj = s.rooms.find((r) => r.id === rid);
        if (rObj && !rObj.unlocked && !newlyUnlockedRooms.includes(rObj)) {
          newlyUnlockedRooms.push(rObj);
        }
      }
      const room = s.rooms.find((r) => r.id === door.unlockRoomId);
      if (room) room.unlocked = true;
      const roomAObj = s.rooms.find((r) => r.id === door.roomA);
      if (roomAObj) roomAObj.unlocked = true;
      const roomBObj = s.rooms.find((r) => r.id === door.roomB);
      if (roomBObj) roomBObj.unlocked = true;

      s.doors.forEach((d) => {
        const ra = s.rooms.find((r) => r.id === d.roomA)?.unlocked;
        const rb = s.rooms.find((r) => r.id === d.roomB)?.unlocked;
        if (ra && rb) {
          d.unlocked = true;
          d.progress = 0;
          d.paidAmount = d.cost;
        }
      });

      s.mapRevision += 1;
      this.rebuildWalkableMask();
      this.rebuildFlowField();
      for (const newRoom of newlyUnlockedRooms) {
        this.spawnRoomBreachLoot(newRoom, door.cost);
      }
      SaveManager.addDailyProgress('doors', 1);
      SoundFX.fanfare();
      PlatformSDK.happyTime();
      const extraRooms = this.getUnlockedExtraRoomsCount();
      const bText = I18n.t('bannerDoorBreach', {
        name: I18n.roomOrDoorName(door.unlockRoomId, door.label),
        dmg: extraRooms * 10,
        bonus: extraRooms * 50,
      });
      this.showBanner(bText, 3.6);
      if (s.isCoop && CoopManager.role === 'host') {
        CoopManager.broadcastToClients({ type: 'evt_fx', kind: 'banner', text: bText, dur: 3.6 });
      }
    } else {
      const left = door.cost - door.paidAmount;
      SoundFX.coin();
      const ftText = I18n.t('ftDoorPool', { paid: accepted, left });
      this.spawnFloatingText(cx, cy - 22, ftText, '#fde047', 1.05);
      if (s.isCoop && CoopManager.role === 'host') {
        CoopManager.broadcastToClients({
          type: 'evt_fx',
          kind: 'floating',
          x: cx,
          y: cy - 22,
          text: ftText,
          color: '#fde047',
          scale: 1.05,
        });
      }
    }
  }

  private spawnRoomBreachLoot(room: RuntimeRoom, doorCost: number): void {
    const s = this.state!;
    const rect0 = room.rects[0];
    const baseCandidates = [
      room.labelPos,
      rect0 ? { x: rect0.x + rect0.w / 2, y: rect0.y + rect0.h / 2 } : room.labelPos,
    ];
    const offsets = [
      [0, 0],
      [0, 42],
      [0, -42],
      [46, 0],
      [-46, 0],
      [44, 40],
      [-44, 40],
      [44, -40],
      [-44, -40],
      [0, 76],
      [76, 0],
      [-76, 0],
    ];

    let spotX = room.labelPos.x;
    let spotY = room.labelPos.y;
    let found = false;
    for (const base of baseCandidates) {
      if (found) break;
      for (const [ox, oy] of offsets) {
        const cx = base.x + ox;
        const cy = base.y + oy;
        const inRoom = room.rects.some(
          (r) => cx >= r.x + 36 && cx <= r.x + r.w - 36 && cy >= r.y + 36 && cy <= r.y + r.h - 36
        );
        if (!inRoom) continue;
        if (this.findBlockingWallOrLockedDoor(cx, cy, 26)) continue;
        if (s.stations.some((st) => Math.hypot(st.x - cx, st.y - cy) < 56)) continue;
        if (s.barrels.some((b) => Math.hypot(b.x - cx, b.y - cy) < 46)) continue;
        const hitsProp = s.props.some((pr) => {
          const { ew, eh } = this.getEffectivePropDims(pr);
          return this.circleIntersectsRect(cx, cy, 24, { x: pr.x - ew / 2, y: pr.y - eh / 2, w: ew, h: eh });
        });
        if (hitsProp) continue;
        spotX = cx;
        spotY = cy;
        found = true;
        break;
      }
    }

    // 1. 免费破门战术遗物空投箱
    s.chests.push({
      id: this.nextEntityId++,
      x: spotX,
      y: spotY,
      roomId: room.id,
      progress: 0,
      bobPhase: Math.random() * Math.PI * 2,
    });

    // 2. 破门战利品赏金返还（约返还 40% 开门资金，保底 $160）+ 高额战地经验球
    const cashRefund = Math.max(160, Math.round((doorCost * 0.4) / 10) * 10);
    const halfCashA = Math.round(cashRefund * 0.55);
    const halfCashB = Math.max(20, cashRefund - halfCashA);
    s.drops.push(
      {
        id: this.nextEntityId++,
        kind: 'cash',
        value: halfCashA,
        x: spotX - 28,
        y: spotY + 18,
        life: 60,
        bobPhase: 0.4,
      },
      {
        id: this.nextEntityId++,
        kind: 'cash',
        value: halfCashB,
        x: spotX + 28,
        y: spotY + 18,
        life: 60,
        bobPhase: 2.1,
      },
      {
        id: this.nextEntityId++,
        kind: 'xp',
        value: 75,
        x: spotX,
        y: spotY - 26,
        life: 60,
        bobPhase: 3.7,
      }
    );

    this.spawnHitSparks(spotX, spotY, '#fde047', 12);
    const lootTxt = I18n.t('ftBreachLoot');
    this.spawnFloatingText(spotX, spotY - 34, lootTxt, '#fde047', 1.2);
    if (s.isCoop && CoopManager.role === 'host') {
      CoopManager.broadcastToClients({
        type: 'evt_fx',
        kind: 'floating',
        x: spotX,
        y: spotY - 34,
        text: lootTxt,
        color: '#fde047',
        scale: 1.2,
      });
    }
  }

  private updateInteractions(dt: number): void {
    const s = this.state!;
    const p = s.player;
    if (p.downed || p.spectating) {
      p.repairProgress = 0;
      return;
    }
    const pStats = SaveManager.getEffectivePlayerStats();
    const maxPaidRepairs = 6 * s.squadCount;

    // 1. 自动修窗（免费修补木板并赚取修窗补贴；合金电击窗升级已移至军火库【补给】页签，彻底杜绝走位误触扣钱！）
    let repairingAny = false;
    for (const win of s.windows) {
      const room = s.rooms.find((r) => r.id === win.roomId);
      if (!room?.unlocked || win.planks >= win.maxPlanks) continue;
      const cx = win.x + win.w / 2;
      const cy = win.y + win.h / 2;
      if (Math.hypot(p.x - cx, p.y - cy) <= 82) {
        if (win.planks === 0 && win.armorPlanks <= 0 && this.hasZombieVaultingWindow(win)) {
          continue;
        }
        repairingAny = true;
        p.repairProgress += dt * 1.35 * pStats.repairSpeedMultiplier;
        if (p.repairProgress >= 1) {
          p.repairProgress = 0;
          win.planks += 1;
          this.pushOutdoorZombiesOutsidePlanks(win);
          SoundFX.repair();
          SaveManager.addDailyProgress('repairs', 1);
          if (s.repairsPaidThisWave < maxPaidRepairs) {
            s.repairsPaidThisWave += 1;
            const cashBonus = 8;
            s.cash += cashBonus;
            this.spawnFloatingText(cx, cy - 16, I18n.t('ftRepairCash', { n: cashBonus }), '#fde047', 1);
          } else {
            this.spawnFloatingText(cx, cy - 16, I18n.t('ftRepaired'), '#cbd5e1', 0.9);
          }
        }
        break;
      }
    }
    if (!repairingAny) p.repairProgress = 0;

    // 2. 靠近未解锁大门读条开门（单人满额解锁 / 多人联机支持全队合资凑钱解锁！）
    for (const door of s.doors) {
      if (door.unlocked) continue;
      const cx = door.x + door.w / 2;
      const cy = door.y + door.h / 2;
      const needed = Math.max(0, door.cost - door.paidAmount);
      const canContribute = s.isCoop ? s.cash >= Math.min(50, needed) && needed > 0 : s.cash >= needed && needed > 0;
      if (Math.hypot(p.x - cx, p.y - cy) <= 74 && canContribute) {
        door.progress += dt * 1.65;
        if (door.progress >= 1) {
          door.progress = 0;
          const pay = Math.min(s.cash, needed);
          s.cash -= pay;
          this.applyDoorFunding(door, pay, CoopManager.myPeerId);
        }
      } else {
        door.progress = Math.max(0, door.progress - dt * 2.5);
      }
    }

    // 3. 踩房间神秘宝物箱（当场直接开箱领取奇物，多人联机全队同步获得战术模组！）
    for (let i = s.chests.length - 1; i >= 0; i--) {
      const c = s.chests[i];
      if (Math.hypot(p.x - c.x, p.y - c.y) <= 56) {
        c.progress += dt * 1.8;
        if (c.progress >= 1) {
          s.chests.splice(i, 1);
          this.grantChestRelicInline(c.x, c.y);
          if (s.isCoop && CoopManager.role === 'host') {
            CoopManager.broadcastToClients({ type: 'evt_team_reward', grantChestRelic: true });
          }
          break;
        }
      } else {
        c.progress = Math.max(0, c.progress - dt * 2);
      }
    }

    // 4. 房间站点交互（含军火商店终端！）
    for (const st of s.stations) {
      const room = s.rooms.find((r) => r.id === st.roomId);
      if (!room?.unlocked) continue;
      if (st.activeTimer > 0) {
        st.activeTimer = Math.max(0, st.activeTimer - dt);
        if (st.type === 'laser_trap') {
          this.damageZombiesWithLaserTrap(st, dt);
        }
      }
      if (st.used && (st.type === 'starter_airdrop' || st.type === 'mech_dog_cage')) continue;
      if (st.type === 'laser_trap' && st.activeTimer > 0) continue;

      const dist = Math.hypot(p.x - st.x, p.y - st.y);
      const canAfford = st.type === 'starter_airdrop' || st.type === 'armory_kiosk' || s.cash >= st.cost;

      if (dist <= 42 && canAfford && this.canUseStation(st)) {
        st.progress += dt * 1.65;
        if (st.progress >= 1) {
          st.progress = 0;
          this.triggerStation(st);
        }
      } else {
        st.progress = Math.max(0, st.progress - dt * 2.5);
      }
    }
  }

  private canUseStation(st: RuntimeStation): boolean {
    const s = this.state!;
    const activeWep = s.player.weapons[s.player.activeSlot];
    if (st.type === 'pack_a_punch') return !activeWep.evolved;
    if (st.type === 'ammo_box') {
      const def = WEAPONS[activeWep.defId];
      if (def.maxReserve < 0) return false;
      return activeWep.reserve < this.getMaxReserve(activeWep.defId, activeWep.evolved);
    }
    return true;
  }

  private async triggerStation(st: RuntimeStation): Promise<void> {
    const s = this.state!;
    const p = s.player;

    if (st.type === 'armory_kiosk') {
      // 推开一点点避免关店瞬间重复读条
      const ang = Math.atan2(p.y - st.y, p.x - st.x);
      p.x = st.x + Math.cos(ang) * 50;
      p.y = st.y + Math.sin(ang) * 50;
      this.resolveEntityInsideWalls(p);
      this.callbacks.onToggleArmoryShop();
      return;
    }

    if (st.type === 'starter_airdrop' && st.weaponId) {
      const save = SaveManager.get();
      let granted = false;
      if (save.freeStarterUsedCount < 2) {
        save.freeStarterUsedCount += 1;
        SaveManager.save();
        granted = true;
      } else {
        this.modalPaused = true;
        granted = await PlatformSDK.showRewardedAd('starter_super_crate', st.label);
        this.modalPaused = false;
        PlatformSDK.gameplayStart();
      }
      if (granted) {
        st.used = true;
        this.giveOrRefillWeapon(st.weaponId, true, 3);
      }
      return;
    }

    s.cash -= st.cost;

    if (st.type === 'ammo_box') {
      const wep = p.weapons[p.activeSlot];
      wep.mag = this.getMaxMag(wep.defId, wep.evolved);
      wep.reserve = this.getMaxReserve(wep.defId, wep.evolved);
      SoundFX.reloadDone();
      this.spawnFloatingText(st.x, st.y - 34, I18n.t('ftAmmoFull'), '#4ade80', 1.15);
    } else if (st.type === 'pack_a_punch') {
      const wep = p.weapons[p.activeSlot];
      const def = WEAPONS[wep.defId];
      const sName = I18n.wSuperName(def.id, def.superName);
      wep.evolved = true;
      wep.mag = this.getMaxMag(wep.defId, true);
      if (def.maxReserve > 0) wep.reserve = this.getMaxReserve(wep.defId, true);
      SaveManager.addDailyProgress('evolve', 1, true);
      SoundFX.fanfare();
      PlatformSDK.happyTime();
      this.spawnFloatingText(st.x, st.y - 36, `⚡ ${sName}`, def.superColor, 1.3);
    } else if (st.type === 'mech_dog_cage') {
      st.used = true;
      s.mechDog.active = true;
      s.mechDog.x = st.x;
      s.mechDog.y = st.y;
      SoundFX.fanfare();
      this.spawnFloatingText(st.x, st.y - 34, I18n.t('ftMechDog'), '#7dd3fc', 1.2);
    } else if (st.type === 'vending_machine') {
      const roll = Math.random();
      if (roll < 0.36) {
        p.hp = p.maxHp;
        p.armor = Math.min(p.maxArmor, p.armor + 35);
        this.spawnFloatingText(st.x, st.y - 34, I18n.t('ftVendHeal'), '#4ade80', 1.2);
      } else if (roll < 0.75) {
        s.powerUpTimers.overdrive = 7;
        this.spawnFloatingText(st.x, st.y - 34, I18n.t('ftVendOverdrive'), '#f97316', 1.2);
      } else {
        s.cash += 300;
        this.spawnFloatingText(st.x, st.y - 34, I18n.t('ftVendJackpot'), '#fde047', 1.3);
      }
      SoundFX.fanfare();
    } else if (st.type === 'laser_trap') {
      st.activeTimer = 18;
      SoundFX.alarm();
      this.spawnFloatingText(st.x, st.y - 34, I18n.t('ftLaserOn'), '#f87171', 1.15);
    }
  }

  public giveOrRefillWeapon(weaponId: string, evolved: boolean, tempWaves?: number): void {
    const s = this.state!;
    const p = s.player;
    const def = WEAPONS[weaponId];
    const existingIdx = p.weapons.findIndex((w) => w.defId === weaponId);
    if (existingIdx >= 0) {
      const w = p.weapons[existingIdx];
      if (evolved) w.evolved = true;
      if (tempWaves === undefined) delete w.tempWavesLeft;
      w.mag = this.getMaxMag(weaponId, w.evolved);
      if (def.maxReserve > 0) w.reserve = this.getMaxReserve(weaponId, w.evolved);
      p.activeSlot = existingIdx;
    } else {
      const inst = {
        defId: weaponId,
        evolved,
        mag: this.getMaxMag(weaponId, evolved),
        reserve: def.maxReserve > 0 ? this.getMaxReserve(weaponId, evolved) : -1,
        tempWavesLeft: tempWaves,
      };
      p.weapons.push(inst);
      p.activeSlot = p.weapons.length - 1;
    }
    if (def.maxReserve > 0) {
      s.lastPrimaryWeaponId = weaponId;
    }
    p.reloadTimer = 0;
    p.weaponSwapTimer = 0.32;
    const dispName = evolved ? I18n.wSuperName(def.id, def.superName) : I18n.wName(def.id, def.name);
    this.spawnFloatingText(
      p.x,
      p.y - 36,
      I18n.t('ftEquipped', { name: dispName }),
      evolved ? def.superColor : def.color,
      1.2
    );
  }

  public flushQueuedModals(): void {
    const s = this.state;
    if (!s || s.waveState === 'ended' || s.player.hp <= 0 || this.modalPaused) return;
    const nextModal = this.pendingModals.shift();
    if (nextModal) {
      nextModal();
    }
  }

  private grantChestRelicInline(cx: number, cy: number): void {
    const s = this.state!;
    SaveManager.addDailyProgress('evolve', 1);
    const pool = RELICS.filter((r) => !s.relicIds.includes(r.id));
    SoundFX.fanfare();
    if (pool.length === 0) {
      s.cash += 350;
      this.spawnFloatingText(cx, cy - 28, I18n.t('ftRelicMax'), '#fde047', 1.25);
      return;
    }
    const picked = pool[Math.floor(Math.random() * pool.length)];
    s.relicIds.push(picked.id);
    const rMeta = I18n.relicMeta(picked.id, picked.name, picked.desc);
    const rarityColor =
      picked.rarity === 'legendary' ? '#f59e0b' : picked.rarity === 'epic' ? '#c084fc' : '#38bdf8';
    const rarityLabel =
      picked.rarity === 'legendary'
        ? I18n.t('rarityLeg')
        : picked.rarity === 'epic'
          ? I18n.t('rarityEpic')
          : I18n.t('rarityRare');
    s.lootToast = {
      sprite: picked.sprite,
      badge: rarityLabel,
      title: rMeta.name,
      desc: rMeta.desc,
      color: rarityColor,
      timer: 3.4,
    };
    this.spawnFloatingText(cx, cy - 28, I18n.t('ftGotRelic', { name: rMeta.name }), rarityColor, 1.25);
  }

  private damageZombiesWithLaserTrap(st: RuntimeStation, dt: number): void {
    const s = this.state!;
    const beamAngle = performance.now() * 0.0045;
    const snapshot = [...s.zombies];
    for (let i = 0; i < 2; i++) {
      const a = beamAngle + i * Math.PI;
      const bx = Math.cos(a);
      const by = Math.sin(a);
      for (const z of snapshot) {
        if (!z || z.hp <= 0 || this.deadZombieIds.has(z.id)) continue;
        const dx = z.x - st.x;
        const dy = z.y - st.y;
        const proj = dx * bx + dy * by;
        if (proj > 0 && proj < 255) {
          const perp = Math.abs(dx * -by + dy * bx);
          if (perp < z.radius + 12) {
            this.damageZombie(z, 280 * this.getSectorDamageMult() * dt, 0, 0, false, true, false);
          }
        }
      }
    }
  }

  private updateTurretsAndDog(dt: number): void {
    const s = this.state!;
    const sectorMult = this.getSectorDamageMult();
    for (let i = s.turrets.length - 1; i >= 0; i--) {
      const t = s.turrets[i];
      t.life -= dt;
      if (t.life <= 0) {
        s.turrets.splice(i, 1);
        continue;
      }
      t.fireCd -= dt;
      const target = this.findNearestTarget(t.x, t.y, 440);
      if (target) {
        t.angle = Math.atan2(target.y - t.y, target.x - t.x);
        if (t.fireCd <= 0) {
          t.fireCd = 0.14;
          if (s.bullets.length >= 165) {
            s.bullets.shift();
          }
          s.bullets.push({
            x: t.x + Math.cos(t.angle) * 24,
            y: t.y + Math.sin(t.angle) * 24,
            vx: Math.cos(t.angle) * 950,
            vy: Math.sin(t.angle) * 950,
            radius: 3.8,
            damage: 25 * s.modifiers.damageMult * sectorMult,
            knockback: 45,
            pierceLeft: 0,
            bouncesLeft: 0,
            explosiveRadius: 0,
            color: '#38bdf8',
            isCrit: false,
            flame: false,
            cryo: false,
            electric: false,
            laser: false,
            sawblade: false,
            hitIds: new Set(),
            life: 1.0,
          });
        }
      }
    }

    if (s.mechDog.active) {
      const d = s.mechDog;
      d.biteCd = Math.max(0, d.biteCd - dt);
      let tx = s.player.x - 42;
      let ty = s.player.y + 36;

      const nearDrop = s.drops.find((dr) => Math.hypot(dr.x - s.player.x, dr.y - s.player.y) < 520);
      const nearZombie = this.findNearestTarget(d.x, d.y, 260);

      if (nearZombie && nearZombie.insideBuilding) {
        tx = nearZombie.x;
        ty = nearZombie.y;
        if (Math.hypot(nearZombie.x - d.x, nearZombie.y - d.y) <= nearZombie.radius + 22 && d.biteCd <= 0) {
          d.biteCd = 0.45;
          this.damageZombie(nearZombie, 48 * s.modifiers.damageMult * sectorMult, 0, 0, false, false, true);
        }
      } else if (nearDrop) {
        tx = nearDrop.x;
        ty = nearDrop.y;
      }

      const dx = tx - d.x;
      const dy = ty - d.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 8) {
        d.angle = Math.atan2(dy, dx);
        const step = Math.min(dist, 300 * dt);
        d.x += (dx / dist) * step;
        d.y += (dy / dist) * step;
      }
    }
  }

  private updateBullets(dt: number): void {
    const s = this.state!;
    for (let i = s.bullets.length - 1; i >= 0; i--) {
      const b = s.bullets[i];
      b.life -= dt;
      if (b.life <= 0) {
        if (b.explosiveRadius > 0) this.explodeAt(b.x, b.y, b.explosiveRadius, b.damage);
        s.bullets.splice(i, 1);
        continue;
      }

      const nextX = b.x + b.vx * dt;
      const nextY = b.y + b.vy * dt;

      const hitWall = this.findBulletBlocker(nextX, nextY, b.radius);
      if (hitWall) {
        if (b.explosiveRadius > 0) {
          this.explodeAt(b.x, b.y, b.explosiveRadius, b.damage);
          s.bullets.splice(i, 1);
          continue;
        }
        if (b.bouncesLeft > 0) {
          b.bouncesLeft -= 1;
          if (b.sawblade) {
            b.hitIds.clear();
            this.spawnHitSparks(b.x, b.y, '#fde047', 5);
          } else {
            b.damage *= 1.25;
          }
          const hitX = this.findBulletBlocker(nextX, b.y, b.radius);
          if (hitX) b.vx = -b.vx;
          else b.vy = -b.vy;
          b.x += b.vx * dt;
          b.y += b.vy * dt;
        } else {
          this.spawnHitSparks(b.x, b.y, b.color, 4);
          s.bullets.splice(i, 1);
          continue;
        }
      } else {
        b.x = nextX;
        b.y = nextY;
      }

      let bulletRemoved = false;
      for (const barrel of s.barrels) {
        if (!barrel.alive) continue;
        if (Math.hypot(b.x - barrel.x, b.y - barrel.y) <= 24 + b.radius) {
          this.explodeAt(barrel.x, barrel.y, 185, 250 * s.modifiers.damageMult * this.getSectorDamageMult());
          barrel.alive = false;
          barrel.respawnWaves = 2;
          s.bullets.splice(i, 1);
          bulletRemoved = true;
          break;
        }
      }
      if (bulletRemoved) continue;

      for (let zi = s.zombies.length - 1; zi >= 0; zi--) {
        if (zi >= s.zombies.length) {
          zi = s.zombies.length - 1;
          if (zi < 0) break;
        }
        const z = s.zombies[zi];
        if (!z || z.hp <= 0 || this.deadZombieIds.has(z.id)) continue;
        if (b.hitIds.has(z.id)) continue;
        const hitDist = z.radius + b.radius;
        if (Math.abs(b.x - z.x) > hitDist || Math.abs(b.y - z.y) > hitDist) continue;
        if (Math.hypot(b.x - z.x, b.y - z.y) <= hitDist) {
          b.hitIds.add(z.id);
          if (b.explosiveRadius > 0) {
            this.explodeAt(b.x, b.y, b.explosiveRadius, b.damage);
            s.bullets.splice(i, 1);
            break;
          }

          const ang = Math.atan2(b.vy, b.vx);
          let effBulletDmg = b.damage;
          // 防暴盾卫尸与镇暴重盾局长：正面防弹盾可抵挡普通弹道伤害，侧翼绕后/火焰/激光/爆炸可破盾满伤！
          if (
            (z.kind === 'riot' || z.kind === 'boss_warden') &&
            !b.flame &&
            !b.laser &&
            Math.cos(ang - z.facingAngle) < -0.35
          ) {
            effBulletDmg *= z.kind === 'riot' ? 0.48 : 0.6;
            this.spawnHitSparks(b.x, b.y, '#93c5fd', 4);
            if (s.floatingTexts.length < 12 && Math.random() < 0.22) {
              this.spawnFloatingText(z.x, z.y - z.radius - 10, I18n.t('ftRiotBlock'), '#93c5fd', 0.92);
            }
          }
          // 透过窗户射击孔向外倾泻火力享受 100% 满额伤害！
          this.damageZombie(
            z,
            effBulletDmg,
            Math.cos(ang) * b.knockback,
            Math.sin(ang) * b.knockback,
            b.isCrit,
            b.flame,
            b.electric,
            b.cryo
          );

          if (b.pierceLeft > 0) {
            b.pierceLeft -= 1;
          } else {
            s.bullets.splice(i, 1);
            break;
          }
        }
      }
    }
  }

  private spawnMergedDrop(kind: 'cash' | 'xp', value: number, x: number, y: number, life = 25): void {
    const s = this.state!;
    if (value <= 0) return;

    // 38px 内自动合并同类型钞票/经验球；若场上掉落物已超 72 个则就近并入，彻底消除后期百个掉落物堆积掉帧！
    const forceMerge = s.drops.length >= 72;
    let bestDrop: DropItem | null = null;
    let bestDist = forceMerge ? Infinity : 38;

    for (const d of s.drops) {
      if (d.kind !== kind) continue;
      const dist = Math.hypot(d.x - x, d.y - y);
      if (dist < bestDist) {
        bestDist = dist;
        bestDrop = d;
        if (!forceMerge) break;
      }
    }

    if (bestDrop) {
      bestDrop.value += value;
      bestDrop.life = Math.max(bestDrop.life, life);
      return;
    }

    s.drops.push({
      id: this.nextEntityId++,
      kind,
      value,
      x,
      y,
      life,
      bobPhase: Math.random() * 6,
    });
  }

  private damageZombie(
    z: ZombieEntity,
    dmg: number,
    kx: number,
    ky: number,
    isCrit: boolean,
    flame: boolean,
    electric: boolean,
    cryo = false
  ): void {
    if (!z || z.hp <= 0 || this.deadZombieIds.has(z.id)) return;
    const s = this.state!;
    z.hp -= dmg;
    z.hitFlash = 0.09;
    if (flame) z.burnTimer = 3.0;
    if (cryo && z.kind !== 'frost' && z.kind !== 'boss_cryo') {
      z.slowTimer = Math.max(z.slowTimer, 3.2);
      if (Math.random() < 0.25 && !isBossKind(z.kind)) {
        z.stunTimer = Math.max(z.stunTimer, 0.22);
      }
    }
    if (electric) z.slowTimer = Math.max(z.slowTimer, 2.2);

    const kbResist = isBossKind(z.kind) ? 0.12 : z.kind === 'miniboss' || z.kind === 'riot' ? 0.32 : 1;
    z.x += kx * 0.08 * kbResist;
    z.y += ky * 0.08 * kbResist;
    if (z.insideBuilding) {
      this.resolveEntityInsideWalls(z);
    } else if (z.targetWindowId) {
      const win = s.windows.find((w) => w.id === z.targetWindowId);
      if (win) {
        this.resolveOutdoorZombieObstacles(z, win, win.planks <= 0);
      }
    }

    if (isCrit || (s.floatingTexts.length < 14 && dmg >= 85 && Math.random() < 0.22)) {
      this.spawnFloatingText(
        z.x + (Math.random() - 0.5) * 14,
        z.y - z.radius - 8,
        `${Math.round(dmg)}${isCrit ? '!' : ''}`,
        isCrit ? '#fde047' : '#e2e8f0',
        isCrit ? 1.2 : 0.9
      );
    }

    if (z.kind === 'thief' && z.rangedCd > 0 && Math.random() < 0.38) {
      z.rangedCd -= 1;
      const dp = this.getSafeIndoorDropPoint(z);
      this.spawnMergedDrop(
        'cash',
        12,
        dp.x + (Math.random() - 0.5) * 28,
        dp.y + (Math.random() - 0.5) * 28,
        22
      );
    }

    const zx = z.x;
    const zy = z.y;
    const zid = z.id;

    // 先处理击杀移出数组，再触发闪电链等连锁伤害，彻底阻断重入递归！
    if (z.hp <= 0) {
      this.killZombie(z);
    }

    if (electric) {
      const activeWep = s.player.weapons[s.player.activeSlot];
      const jumps = activeWep?.defId === 'tesla' ? (activeWep.evolved ? 5 : 3) : 2;
      const arcRatio = activeWep?.defId === 'tesla' ? 0.65 : 0.4;
      this.triggerChainLightning(zx, zy, dmg * arcRatio, jumps, zid);
    }
  }

  private killZombie(z: ZombieEntity): void {
    if (!z || this.deadZombieIds.has(z.id)) return;
    this.deadZombieIds.add(z.id);

    const s = this.state!;
    const idx = s.zombies.findIndex((item) => item.id === z.id);
    if (idx >= 0) {
      s.zombies.splice(idx, 1);
    }
    if (this.deadZombieIds.size > 400) {
      this.deadZombieIds.clear();
      this.deadZombieIds.add(z.id);
    }

    s.kills += 1;
    SaveManager.addDailyProgress('kills', 1);
    const isBoss = isBossKind(z.kind);
    if (isBoss || z.kind === 'miniboss') {
      SaveManager.addDailyProgress('bosses', 1);
    }

    if (s.modifiers.killRefillChance > 0 && Math.random() < s.modifiers.killRefillChance) {
      const activeWep = s.player.weapons[s.player.activeSlot];
      const maxMag = this.getMaxMag(activeWep.defId, activeWep.evolved);
      if (activeWep.mag < maxMag) {
        const addAmt = maxMag >= 20 ? 2 : 1;
        const gained = Math.min(addAmt, maxMag - activeWep.mag);
        activeWep.mag += gained;
        if (s.floatingTexts.length < 14) {
          this.spawnFloatingText(
            s.player.x,
            s.player.y - 28,
            I18n.t('ftAmmoScav', { n: gained }),
            '#4ade80',
            0.95
          );
        }
      }
    }
    this.spawnHitSparks(z.x, z.y, z.color, 8);
    if (s.decals.length > 52) s.decals.shift();
    s.decals.push({
      x: z.x,
      y: z.y,
      radius: z.radius * (0.85 + Math.random() * 0.35),
      color:
        z.kind === 'thief'
          ? 'rgba(250, 204, 21, 0.38)'
          : z.kind === 'spitter' || z.kind === 'boomer'
            ? 'rgba(163, 230, 53, 0.42)'
            : z.kind === 'frost'
              ? 'rgba(56, 189, 248, 0.38)'
              : 'rgba(34, 197, 94, 0.32)',
      life: 8,
      maxLife: 8,
      seed: Math.random() * 10,
    });

    if (s.feverTimer <= 0) {
      s.fever = Math.min(100, s.fever + (isBoss ? 40 : 10));
      if (s.fever >= 100) {
        s.feverTimer = 6.5;
        s.fever = 0;
        SoundFX.fanfare();
        this.spawnFloatingText(s.player.x, s.player.y - 38, I18n.t('ftFever'), '#fb923c', 1.25);
      }
    }

    if (s.modifiers.killHealRatio > 0 && !s.player.downed && !s.player.spectating) {
      s.player.killHealCounter += 1;
      if (s.player.killHealCounter >= 10) {
        s.player.killHealCounter = 0;
        const healRatio = Math.min(0.35, s.modifiers.killHealRatio);
        const heal = Math.max(4, Math.round(s.player.maxHp * healRatio));
        if (s.player.hp < s.player.maxHp) {
          s.player.hp = Math.min(s.player.maxHp, s.player.hp + heal);
          this.spawnFloatingText(s.player.x, s.player.y - 34, I18n.t('ftKillSiphon', { n: heal }), '#34d399', 1.12);
        }
      }
    }

    if (s.relicIds.includes('vamp_fangs')) {
      s.player.vampCounter += 1;
      if (s.player.vampCounter >= 18) {
        s.player.vampCounter = 0;
        const heal = Math.round(s.player.maxHp * 0.08);
        s.player.hp = Math.min(s.player.maxHp, s.player.hp + heal);
        this.spawnFloatingText(s.player.x, s.player.y - 30, I18n.t('ftNanoHeal', { n: heal }), '#4ade80', 1.15);
      }
    }

    // 自爆脓毒尸：阵亡瞬间引爆脓毒气浪，对周围尸群造成连锁轰炸，近身贴脸时亦会炸伤贪刀玩家！
    if (z.kind === 'boomer' && this.explosionDepth < 2) {
      this.triggerBoomerDetonation(z.x, z.y, Math.round(z.damage * 0.95));
    } else if (z.kind === 'frost') {
      // 极寒冰晶尸：碎裂释放寒霜冲击，冻结减速周围尸群
      this.spawnHitSparks(z.x, z.y, '#67e8f9', 10);
      for (const oz of s.zombies) {
        if (oz && oz.hp > 0 && Math.hypot(oz.x - z.x, oz.y - z.y) <= 115) {
          oz.slowTimer = Math.max(oz.slowTimer, 2.2);
        }
      }
    }

    const dropPt = this.getSafeIndoorDropPoint(z);
    const cashMult = s.modifiers.cashMult * (s.powerUpTimers.double_cash > 0 ? 2 : 1);
    const cashVal = Math.round(z.cashReward * cashMult);
    this.spawnMergedDrop(
      'cash',
      cashVal,
      dropPt.x + (Math.random() - 0.5) * 18,
      dropPt.y + (Math.random() - 0.5) * 18,
      25
    );
    this.spawnMergedDrop(
      'xp',
      z.xpReward,
      dropPt.x + (Math.random() - 0.5) * 22,
      dropPt.y + (Math.random() - 0.5) * 22,
      25
    );

    // 战地急救包掉落（严格控量保持硬核紧张感：仅在生命低于 72% 且场上无血包、单波至多 2 个时低概率掉落！）
    const anyInjured =
      s.player.hp < s.player.maxHp * 0.72 ||
      s.remotePlayers.some((rp) => !rp.downed && !rp.spectating && rp.hp < rp.maxHp * 0.72);
    const medOnGround = s.drops.filter((dr) => dr.kind === 'heal').length;
    const isSpecialKind =
      z.kind === 'boomer' || z.kind === 'riot' || z.kind === 'frost' || z.kind === 'necro' || z.kind === 'spitter';
    const medChance = isBoss
      ? 1.0
      : z.kind === 'miniboss'
        ? anyInjured && medOnGround < 1
          ? 0.35
          : 0
        : anyInjured && medOnGround < 1 && s.medkitsDroppedThisWave < 2
          ? isSpecialKind
            ? 0.045
            : 0.018
          : 0;
    if (medChance > 0 && Math.random() < medChance) {
      s.medkitsDroppedThisWave += 1;
      s.drops.push({
        id: this.nextEntityId++,
        kind: 'heal',
        value: 15,
        x: dropPt.x + (Math.random() - 0.5) * 24,
        y: dropPt.y + (Math.random() - 0.5) * 24,
        life: 22,
        bobPhase: Math.random() * 6,
      });
    }

    if (z.kind === 'thief' || isBoss) {
      const rm = this.getRoomAt(dropPt.x, dropPt.y) || s.rooms[0];
      s.chests.push({
        id: this.nextEntityId++,
        x: dropPt.x,
        y: dropPt.y,
        roomId: rm.id,
        progress: 0,
        bobPhase: 0,
      });
      SoundFX.fanfare();
      this.spawnFloatingText(dropPt.x, dropPt.y - 26, I18n.t('ftDropChest'), '#fde047', 1.25);
    } else if (Math.random() < (z.kind === 'miniboss' ? 0.55 : 0.035)) {
      const types: PowerUpType[] = ['overdrive', 'nuke', 'carpenter', 'double_cash', 'freeze'];
      const pType = types[Math.floor(Math.random() * types.length)];
      s.drops.push({
        id: this.nextEntityId++,
        kind: 'powerup',
        powerUp: pType,
        value: 0,
        x: dropPt.x,
        y: dropPt.y,
        life: 18,
        bobPhase: 0,
      });
    }

    // 限制连环爆裂最大递归层数为 2，既保留连爆爽感又 100% 杜绝高密度尸潮无限递归爆栈！
    if (this.explosionDepth < 2 && s.relicIds.includes('chain_blast') && Math.random() < 0.2) {
      this.explodeAt(z.x, z.y, 115, 85 * s.modifiers.damageMult);
    }
  }

  private triggerBoomerDetonation(x: number, y: number, playerDmg: number): void {
    const s = this.state!;
    this.explosionDepth += 1;
    try {
      this.spawnExplosionVisuals(x, y, 118, true);
      this.spawnHitSparks(x, y, '#a3e635', 12);
      this.spawnFloatingText(x, y - 22, I18n.t('ftBoomerBlast'), '#fb923c', 1.1);
      if (s.isCoop && CoopManager.role === 'host' && !CoopManager.isCongested()) {
        CoopManager.broadcastToClients({ type: 'evt_fx', kind: 'explode', x, y, radius: 118 });
      }
      const zBlast = Math.round(135 * (1 + (s.stage.index - 1) * 0.2));
      const snap = [...s.zombies];
      for (const oz of snap) {
        if (!oz || oz.hp <= 0 || this.deadZombieIds.has(oz.id)) continue;
        const d = Math.hypot(oz.x - x, oz.y - y);
        if (d <= 122) {
          const ang = Math.atan2(oz.y - y, oz.x - x);
          this.damageZombie(oz, zBlast * (1 - d / 165), Math.cos(ang) * 90, Math.sin(ang) * 90, false, false, false);
        }
      }
      for (const c of this.getAliveCombatants()) {
        if (Math.hypot(c.x - x, c.y - y) <= 92 + c.radius) {
          this.inflictDamageOnCombatant(c.id, Math.max(12, playerDmg));
        }
      }
    } finally {
      this.explosionDepth -= 1;
    }
  }

  private spawnExplosionVisuals(x: number, y: number, radius: number, isBio = false): void {
    const s = this.state!;
    SoundFX.explosion();
    s.camera.shake = Math.max(s.camera.shake, 0.92);

    if (s.explosions.length >= 10) s.explosions.shift();
    s.explosions.push({
      x,
      y,
      radius,
      life: 0.38,
      maxLife: 0.38,
      seed: Math.random() * 10,
      isBio,
    });

    if (s.decals.length > 52) s.decals.shift();
    s.decals.push({
      x,
      y,
      radius: Math.min(62, radius * 0.38),
      color: isBio ? 'rgba(132, 204, 22, 0.44)' : 'rgba(9, 13, 22, 0.58)',
      life: 7.5,
      maxLife: 7.5,
      seed: Math.random() * 10,
      isScorch: !isBio,
    });

    const shardCount = Math.min(20, Math.max(6, 150 - s.particles.length));
    for (let i = 0; i < shardCount; i++) {
      const ang = (i / shardCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.42;
      const spd = 155 + Math.random() * 285;
      s.particles.push({
        x: x + Math.cos(ang) * 8,
        y: y + Math.sin(ang) * 8,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        size: 3.4 + Math.random() * 3.8,
        color: isBio
          ? i % 2 === 0
            ? '#bef264'
            : '#f97316'
          : i % 3 === 0
            ? '#fef9c3'
            : i % 3 === 1
              ? '#fb923c'
              : '#ef4444',
        life: 0.22 + Math.random() * 0.2,
        maxLife: 0.42,
        isShard: true,
        angle: ang,
      });
    }
    const smokeCount = Math.min(8, Math.max(2, 155 - s.particles.length));
    for (let i = 0; i < smokeCount; i++) {
      const ang = (i / smokeCount) * Math.PI * 2 + Math.random() * 0.6;
      const spd = 48 + Math.random() * 92;
      s.particles.push({
        x: x + Math.cos(ang) * 14,
        y: y + Math.sin(ang) * 14,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        size: 6.5 + Math.random() * 5,
        color: isBio ? 'rgba(63, 98, 18, 0.42)' : 'rgba(15, 23, 42, 0.42)',
        life: 0.36 + Math.random() * 0.2,
        maxLife: 0.56,
        isSmoke: true,
        angle: Math.random() * Math.PI * 2,
      });
    }
  }

  private explodeAt(x: number, y: number, radius: number, damage: number): void {
    const s = this.state!;
    this.spawnExplosionVisuals(x, y, radius);

    if (this.explosionDepth === 0) {
      this.spawnFloatingText(x, y - 18, I18n.t('ftBlast'), '#fde047', 1.38);
      if (s.isCoop && CoopManager.role === 'host') {
        CoopManager.broadcastToClients({ type: 'evt_fx', kind: 'explode', x, y, radius });
      }
    }

    this.explosionDepth += 1;
    try {
      const snapshot = [...s.zombies];
      for (const z of snapshot) {
        if (!z || z.hp <= 0 || this.deadZombieIds.has(z.id)) continue;
        const d = Math.hypot(z.x - x, z.y - y);
        if (d <= radius + z.radius) {
          const ang = Math.atan2(z.y - y, z.x - x);
          this.damageZombie(
            z,
            damage * Math.max(0.35, 1 - d / (radius * 1.4)),
            Math.cos(ang) * 260,
            Math.sin(ang) * 260,
            true,
            true,
            false
          );
        }
      }
    } finally {
      this.explosionDepth -= 1;
    }
  }

  private triggerChainLightning(x: number, y: number, damage: number, jumps: number, ignoreId?: number): void {
    const s = this.state!;
    if (s.isCoop && CoopManager.role === 'client') return;
    const visited = new Set<number>(ignoreId ? [ignoreId] : []);
    const pts: { x: number; y: number }[] = [{ x, y }];
    let curX = x;
    let curY = y;

    for (let j = 0; j < jumps; j++) {
      let nearest: ZombieEntity | null = null;
      let bestD = 250;
      for (const z of s.zombies) {
        if (!z || z.hp <= 0 || visited.has(z.id) || this.deadZombieIds.has(z.id)) continue;
        const d = Math.hypot(z.x - curX, z.y - curY);
        if (d < bestD) {
          bestD = d;
          nearest = z;
        }
      }
      if (!nearest) break;
      visited.add(nearest.id);
      pts.push({ x: nearest.x, y: nearest.y });
      curX = nearest.x;
      curY = nearest.y;
      this.damageZombie(nearest, damage, 0, 0, false, false, false);
    }

    if (pts.length > 1) {
      if (s.lightnings.length >= 18) s.lightnings.shift();
      s.lightnings.push({ points: pts, color: '#38bdf8', life: 0.18 });
      if (s.isCoop && CoopManager.role === 'host') {
        CoopManager.broadcastToClients({ type: 'evt_fx', kind: 'lightning', points: pts, color: '#38bdf8' });
      }
    }
  }

  private updateZombies(dt: number): void {
    const s = this.state!;
    const p = s.player;
    const freezeMult = s.powerUpTimers.freeze > 0 ? 0.22 : 1;

    for (let i = s.zombies.length - 1; i >= 0; i--) {
      if (i >= s.zombies.length) {
        i = s.zombies.length - 1;
        if (i < 0) break;
      }
      const z = s.zombies[i];
      if (!z || this.deadZombieIds.has(z.id)) {
        s.zombies.splice(i, 1);
        continue;
      }
      if (z.hp <= 0) {
        this.killZombie(z);
        continue;
      }
      z.wobblePhase += dt * (z.kind === 'runner' ? 11 : 7.5);
      if (z.hitFlash > 0) z.hitFlash -= dt;
      if (z.attackCd > 0) z.attackCd -= dt;
      if (z.attackAnim > 0) z.attackAnim = Math.max(0, z.attackAnim - dt * 5.2);

      if (z.burnTimer > 0) {
        z.burnTimer -= dt;
        z.hp -= 26 * s.modifiers.damageMult * dt;
        if (z.hp <= 0) {
          this.killZombie(z);
          continue;
        }
      }
      if (z.slowTimer > 0) z.slowTimer -= dt;
      if (z.frenzyTimer && z.frenzyTimer > 0) z.frenzyTimer = Math.max(0, z.frenzyTimer - dt);
      if (z.stunTimer > 0) {
        z.stunTimer -= dt;
        z.vx = 0;
        z.vy = 0;
        continue;
      }

      const prevZx = z.x;
      const prevZy = z.y;

      const isBoss = isBossKind(z.kind);
      const bossEnraged = isBoss && z.hp < z.maxHp * 0.55;
      const chargeBoost = z.insideBuilding && z.kind === 'miniboss' && z.fleeTimer > 0 ? 1.85 : 1;
      const frenzyBoost = z.frenzyTimer && z.frenzyTimer > 0 ? 1.32 : 1;
      const effFreeze = z.kind === 'boss_cryo' ? 1 : freezeMult;
      const spd =
        z.speed *
        effFreeze *
        (z.slowTimer > 0 ? 0.55 : 1) *
        (bossEnraged ? 1.26 : 1) *
        chargeBoost *
        frenzyBoost;

      if (!z.insideBuilding && z.targetWindowId) {
        const win = s.windows.find((w) => w.id === z.targetWindowId);
        if (!win) {
          z.insideBuilding = true;
          z.targetWindowId = null;
          continue;
        }

        const wf = this.getWindowFrame(win);
        const relX = z.x - wf.wcx;
        const relY = z.y - wf.wcy;
        // outDist > 0 表示位于窗心外侧；outDist = 0 为窗框中心；outDist < 0 为跨入室内侧
        const outDist = relX * wf.outX + relY * wf.outY;
        const latOff = relX * wf.latX + relY * wf.latY;

        // 窗户净通行半宽（扣除两侧 14px 混凝土窗框立柱与僵尸自身半径，确保尸王翻窗也绝不卡墙角！）
        const clearHalfSpan = Math.max(0, wf.winSpan / 2 - 14 - z.radius - 3);
        const slotFrac = ((z.id * 73) % 19) / 9 - 1;
        const slotOffset = slotFrac * Math.min(clearHalfSpan, 28);
        const standOutDist = 14 + z.radius + 3;

        // 户外远端荒野冲刺倍率：从地图边缘快步冲向建筑防线，抵达沙袋区后平滑恢复标准战斗移速
        const approachMult =
          outDist > 160 ? Math.min(1.58, 1 + (outDist - 160) / 360) : 1;

        if (win.planks > 0 || win.armorPlanks > 0) {
          const tx = wf.wcx + wf.outX * standOutDist + wf.latX * slotOffset;
          const ty = wf.wcy + wf.outY * standOutDist + wf.latY * slotOffset;
          const dx = tx - z.x;
          const dy = ty - z.y;

          if (outDist > standOutDist + 6 || Math.abs(latOff) > clearHalfSpan + 20) {
            this.steerOutdoorZombieSwarm(
              z,
              win,
              wf,
              tx,
              ty,
              outDist,
              latOff,
              standOutDist,
              spd * approachMult,
              dt,
              false
            );
          } else {
            // 紧贴外窗台外侧挥爪拆窗（绝不把半截身体穿模戳进完好防线内！）
            z.x += dx * Math.min(1, dt * 8);
            z.y += dy * Math.min(1, dt * 8);
            z.vx = 0;
            z.vy = 0;
            this.resolveOutdoorZombieObstacles(z, win, false);
            z.facingAngle = this.lerpAngle(
              z.facingAngle,
              Math.atan2(wf.inY, wf.inX),
              Math.min(1, dt * 12)
            );

            if (z.attackCd <= 0) {
              const baseTearCd =
                isBoss || z.kind === 'miniboss'
                  ? 0.42
                  : z.kind === 'runner' || z.kind === 'thief'
                    ? Math.max(0.36, 0.7 - s.wave * 0.03)
                    : Math.max(0.44, 0.94 - s.wave * 0.04);
              z.attackAnim = 1.0;
              z.slashAngle = Math.atan2(wf.inY, wf.inX);
              const tearAmt = isBoss ? 2 : 1;

              // 优先消耗外层 $80【⚡合金电击装甲层】：1.8倍抗拆延迟 + 真实高压电击反伤（可直接电毙残血丧尸！）
              if (win.armorPlanks > 0) {
                z.attackCd = baseTearCd * 1.8;
                win.armorPlanks = Math.max(0, win.armorPlanks - tearAmt);
                this.spawnHitSparks(wf.wcx, wf.wcy, '#38bdf8', 7);
                const pts = [
                  { x: wf.wcx, y: wf.wcy },
                  {
                    x: (wf.wcx + z.x) * 0.5 + (Math.random() - 0.5) * 16,
                    y: (wf.wcy + z.y) * 0.5 + (Math.random() - 0.5) * 16,
                  },
                  { x: z.x, y: z.y },
                ];
                if (s.lightnings.length >= 18) s.lightnings.shift();
                s.lightnings.push({ points: pts, color: '#38bdf8', life: 0.2 });
                if (s.isCoop && CoopManager.role === 'host' && !CoopManager.isCongested()) {
                  CoopManager.broadcastToClients({ type: 'evt_fx', kind: 'lightning', points: pts, color: '#38bdf8' });
                }
                const shockDmg = Math.round((26 + s.wave * 3.5) * this.getSectorDamageMult());
                this.damageZombie(z, shockDmg, wf.outX * 42, wf.outY * 42, false, false, false);
                if (z.hp > 0 && !this.deadZombieIds.has(z.id)) {
                  z.slowTimer = Math.max(z.slowTimer, 2.6);
                  z.stunTimer = Math.max(z.stunTimer, 0.24);
                  this.resolveOutdoorZombieObstacles(z, win, false);
                } else {
                  continue;
                }
              } else {
                z.attackCd = baseTearCd;
                const prevPlanks = win.planks;
                win.planks = Math.max(0, win.planks - tearAmt);
                this.spawnHitSparks(wf.wcx, wf.wcy, '#fbbf24', 4);

                // 全图支援高压电击钢网：非致命麻痹减速与拆窗迟滞
                if (s.electricFortifyWaves > 0) {
                  z.attackCd *= 1.85;
                  z.stunTimer = 0.42;
                  z.slowTimer = 2.8;
                  z.hitFlash = 0.1;
                  if (z.hp > z.maxHp * 0.45) {
                    z.hp = Math.max(z.maxHp * 0.45, z.hp - z.maxHp * 0.08);
                  }
                  s.lightnings.push({
                    points: [
                      { x: wf.wcx, y: wf.wcy },
                      { x: z.x, y: z.y },
                    ],
                    color: '#38bdf8',
                    life: 0.18,
                  });
                }

                // 震荡铆钉板：仅在最后一块木板被彻底拆破时触发非致命气浪击退与眩晕！
                if (prevPlanks > 0 && win.planks === 0 && s.relicIds.includes('explosive_planks')) {
                  this.spawnHitSparks(wf.wcx, wf.wcy, '#38bdf8', 14);
                  this.spawnFloatingText(wf.wcx, wf.wcy - 18, I18n.t('ftShockPlank'), '#38bdf8', 1.2);
                  for (const oz of s.zombies) {
                    if (!oz.insideBuilding && Math.hypot(oz.x - wf.wcx, oz.y - wf.wcy) <= 130) {
                      oz.x += wf.outX * 78;
                      oz.y += wf.outY * 78;
                      oz.stunTimer = Math.max(oz.stunTimer, 1.5);
                      oz.slowTimer = Math.max(oz.slowTimer, 3.0);
                      this.resolveOutdoorZombieObstacles(oz, win, true);
                    }
                  }
                }
              }
            }
          }
        } else {
          // 木板已破：杜绝旧版瞬间瞬移 80px 的穿窗闪烁 Bug，改为平滑对齐窗心、真实翻越窗框进入室内！
          const entryCompleteDist = -(14 + z.radius + 4);
          if (outDist > standOutDist + 8 || Math.abs(latOff) > clearHalfSpan + 14) {
            // 仍在窗外或侧翼斜向包抄中：沿弧形轨迹聚拢至窗台外口净空区
            const alignLat = slotOffset * 0.55;
            const tx = wf.wcx + wf.outX * (14 + z.radius * 0.55) + wf.latX * alignLat;
            const ty = wf.wcy + wf.outY * (14 + z.radius * 0.55) + wf.latY * alignLat;
            this.steerOutdoorZombieSwarm(
              z,
              win,
              wf,
              tx,
              ty,
              outDist,
              latOff,
              standOutDist,
              spd * approachMult,
              dt,
              true
            );
          } else {
            // 正在跨越窗台：横向丝滑收束在窗框净空内（绝不刮蹭左右墙垛），纵向平滑爬入室内！
            const clampedLat = Math.max(
              -clearHalfSpan,
              Math.min(clearHalfSpan, latOff * Math.max(0, 1 - dt * 6) + slotOffset * 0.25 * dt * 6)
            );
            const targetInDist = 14 + z.radius + 10;
            const tx = wf.wcx + wf.inX * targetInDist + wf.latX * clampedLat;
            const ty = wf.wcy + wf.inY * targetInDist + wf.latY * clampedLat;
            const dx = tx - z.x;
            const dy = ty - z.y;
            const d = Math.hypot(dx, dy) || 1;
            const vaultSpd = spd * 0.9;
            z.vx = (dx / d) * vaultSpd;
            z.vy = (dy / d) * vaultSpd;
            z.facingAngle = this.lerpAngle(
              z.facingAngle,
              Math.atan2(wf.inY, wf.inX),
              Math.min(1, dt * 12)
            );
            z.x += z.vx * dt;
            z.y += z.vy * dt;

            // 严格约束翻窗期间横向不碰两侧墙柱
            const newRelX = z.x - wf.wcx;
            const newRelY = z.y - wf.wcy;
            const newOutDist = newRelX * wf.outX + newRelY * wf.outY;
            const newLat = Math.max(
              -clearHalfSpan,
              Math.min(clearHalfSpan, newRelX * wf.latX + newRelY * wf.latY)
            );
            z.x = wf.wcx + wf.outX * newOutDist + wf.latX * newLat;
            z.y = wf.wcy + wf.outY * newOutDist + wf.latY * newLat;

            // 若任意存活队员贴脸堵在破开的空窗台前，翻窗中的僵尸触发挥爪击退
            if (z.damage > 0) {
              const nearC = this.getNearestAliveCombatant(z.x, z.y);
              const pDist = Math.hypot(nearC.x - z.x, nearC.y - z.y);
              if (pDist <= nearC.radius + z.radius + 14 && z.attackCd <= 0) {
                z.attackCd = bossEnraged ? 0.72 : 0.92;
                z.attackAnim = 1.0;
                z.slashAngle = Math.atan2(nearC.y - z.y, nearC.x - z.x);
                this.inflictDamageOnCombatant(nearC.id, z.damage);
                if (nearC.isLocal) {
                  const pushA = z.slashAngle;
                  p.x += Math.cos(pushA) * 20;
                  p.y += Math.sin(pushA) * 20;
                  this.resolveEntityInsideWalls(p);
                }
              }
            }

            // 完全跨过内侧窗沿后无缝切换为室内流场寻路（此时距窗框已有 ≥4px 净空，零弹跳零卡墙！）
            if (newOutDist <= entryCompleteDist) {
              z.insideBuilding = true;
              z.targetWindowId = null;
              this.resolveEntityInsideWalls(z);
            }
            if (dt > 0.0005) {
              z.vx = (z.x - prevZx) / dt;
              z.vy = (z.y - prevZy) / dt;
            }
          }
        }
        continue;
      }

      const targetP = this.getNearestAliveCombatant(z.x, z.y);

      if (z.kind === 'thief') {
        z.fleeTimer -= dt;
        if (z.fleeTimer <= 0) {
          this.spawnFloatingText(z.x, z.y - 20, I18n.t('ftThiefEscaped'), '#cbd5e1', 1.15);
          s.zombies.splice(i, 1);
          continue;
        }
        const awayAng = Math.atan2(z.y - targetP.y, z.x - targetP.x) + Math.sin(z.wobblePhase * 0.4) * 0.8;
        z.vx = Math.cos(awayAng) * z.speed * freezeMult;
        z.vy = Math.sin(awayAng) * z.speed * freezeMult;
        z.facingAngle = this.lerpAngle(z.facingAngle, awayAng, Math.min(1, dt * 10));
        z.x += z.vx * dt;
        z.y += z.vy * dt;
        this.resolveEntityInsideWalls(z);
        if (dt > 0.0005) {
          z.vx = (z.x - prevZx) / dt;
          z.vy = (z.y - prevZy) / dt;
        }
        continue;
      }

      {
        if (z.kind === 'miniboss') {
          if (z.fleeTimer > 0) z.fleeTimer = Math.max(0, z.fleeTimer - dt);
          z.rangedCd -= dt;
          const pDistCharge = Math.hypot(targetP.x - z.x, targetP.y - z.y);
          if (z.rangedCd <= 0 && pDistCharge < 390 && pDistCharge > 75) {
            z.rangedCd = 4.2;
            z.fleeTimer = 0.65;
            z.attackAnim = 1.0;
            this.spawnFloatingText(z.x, z.y - z.radius - 16, I18n.t('ftTyrantCharge'), '#c084fc', 1.15);
          }
        } else if (isBoss) {
          if (bossEnraged && z.fleeTimer === 0) {
            z.fleeTimer = 1;
            SoundFX.alarm();
            s.camera.shake = Math.max(s.camera.shake, 0.9);
            const bp = getBossProfile(z.kind);
            const bText = I18n.isZh() ? bp.zhRage : bp.enRage;
            this.showBanner(bText, 3.4);
            if (s.isCoop && CoopManager.role === 'host') {
              CoopManager.broadcastToClients({ type: 'evt_fx', kind: 'banner', text: bText, dur: 3.4 });
            }
            const summonPool: ZombieKind[] =
              z.kind === 'boss_warden'
                ? ['riot', 'riot', 'runner']
                : z.kind === 'boss_chainsaw'
                  ? ['runner', 'runner', 'runner']
                  : z.kind === 'boss_venom'
                    ? ['boomer', 'boomer', 'spitter']
                    : z.kind === 'boss_surgeon'
                      ? ['necro', 'runner', 'runner']
                      : z.kind === 'boss_kraken'
                        ? ['riot', 'boomer', 'spitter']
                        : z.kind === 'boss_tesla'
                          ? ['frost', 'runner', 'runner']
                          : z.kind === 'boss_cryo'
                            ? ['frost', 'frost', 'riot']
                            : ['miniboss', 'boomer', 'runner'];
            const totalSummons = summonPool.length + Math.max(0, s.squadCount - 1);
            for (let k = 0; k < totalSummons; k++) {
              this.spawnZombie(summonPool[k % summonPool.length]);
            }
          }
          z.rangedCd -= dt;
          const pDistBoss = Math.hypot(targetP.x - z.x, targetP.y - z.y);
          if (z.rangedCd <= 0 && pDistBoss < 580) {
            this.executeStageBossSkill(z, targetP, bossEnraged);
          }
        }

        const toPlayerX = targetP.x - z.x;
        const toPlayerY = targetP.y - z.y;
        const pDist = Math.hypot(toPlayerX, toPlayerY) || 1;

        // ===== 三段式真实僵尸近战（蓄力后仰 -> 扑击挥爪 -> 攻击后主动弹退拉开身位，绝不死贴玩家！） =====
        if (z.damage > 0 && z.attackState !== 'none') {
          z.attackStateTimer -= dt;
          if (z.attackState === 'windup') {
            z.facingAngle = this.lerpAngle(z.facingAngle, z.slashAngle, Math.min(1, dt * 14));
            z.vx = -Math.cos(z.slashAngle) * 44;
            z.vy = -Math.sin(z.slashAngle) * 44;
            z.x += z.vx * dt;
            z.y += z.vy * dt;
            this.resolveEntityInsideWalls(z);

            if (z.attackStateTimer <= 0) {
              z.attackState = 'slash';
              z.attackStateTimer = 0.16;
              z.attackAnim = 1.0;
              const strikeDist = Math.hypot(targetP.x - z.x, targetP.y - z.y);
              const strikeReach = targetP.radius + z.radius + 34;
              if (strikeDist <= strikeReach) {
                const hitAng = Math.atan2(targetP.y - z.y, targetP.x - z.x);
                let angDiff = hitAng - z.slashAngle;
                while (angDiff > Math.PI) angDiff -= Math.PI * 2;
                while (angDiff < -Math.PI) angDiff += Math.PI * 2;
                if (Math.abs(angDiff) <= 1.25 || strikeDist <= targetP.radius + z.radius + 14) {
                  if (z.kind === 'boomer') {
                    z.hp = 0;
                    this.killZombie(z);
                    continue;
                  }
                  this.inflictDamageOnCombatant(targetP.id, z.damage);
                  this.spawnHitSparks(
                    targetP.x - Math.cos(hitAng) * targetP.radius * 0.5,
                    targetP.y - Math.sin(hitAng) * targetP.radius * 0.5,
                    z.kind === 'frost' ? '#38bdf8' : '#ef4444',
                    6
                  );
                  if (targetP.isLocal) {
                    if ((z.kind === 'frost' || z.kind === 'boss_cryo') && p.chillImmuneTimer <= 0) {
                      p.chillTimer = 0.85;
                      p.chillImmuneTimer = 3.2;
                    }
                    p.x += Math.cos(hitAng) * 18;
                    p.y += Math.sin(hitAng) * 18;
                    this.resolveEntityInsideWalls(p);
                  }
                }
              }
            }
          } else if (z.attackState === 'slash') {
            z.vx = Math.cos(z.slashAngle) * 145;
            z.vy = Math.sin(z.slashAngle) * 145;
            z.x += z.vx * dt;
            z.y += z.vy * dt;
            this.maintainZombiePlayerSeparation(z, targetP, targetP.radius + z.radius + 10);
            this.resolveEntityInsideWalls(z);

            if (z.attackStateTimer <= 0) {
              z.attackState = 'recover';
              z.attackStateTimer = bossEnraged ? 0.44 : z.kind === 'runner' ? 0.48 : 0.58;
              z.attackCd = bossEnraged ? 0.52 : z.kind === 'runner' ? 0.62 : 0.78;
              const awayAng = Math.atan2(z.y - targetP.y, z.x - targetP.x);
              const backSpd = isBoss ? 155 : z.kind === 'miniboss' ? 175 : 225;
              z.recoilVx = Math.cos(awayAng) * backSpd;
              z.recoilVy = Math.sin(awayAng) * backSpd;
            }
          } else if (z.attackState === 'recover') {
            const damp = Math.pow(0.04, dt);
            z.recoilVx *= damp;
            z.recoilVy *= damp;
            z.vx = z.recoilVx;
            z.vy = z.recoilVy;
            z.x += z.vx * dt;
            z.y += z.vy * dt;
            z.facingAngle = this.lerpAngle(
              z.facingAngle,
              Math.atan2(targetP.y - z.y, targetP.x - z.x),
              Math.min(1, dt * 8)
            );
            this.maintainZombiePlayerSeparation(z, targetP, targetP.radius + z.radius + 26);
            this.resolveEntityInsideWalls(z);

            if (z.attackStateTimer <= 0) {
              z.attackState = 'none';
            }
          }
          if (dt > 0.0005) {
            z.vx = (z.x - prevZx) / dt;
            z.vy = (z.y - prevZy) / dt;
          }
          continue;
        }

        const standoffDist = targetP.radius + z.radius + 20;
        if (z.damage > 0 && pDist <= targetP.radius + z.radius + 26 && z.attackCd <= 0) {
          z.attackState = 'windup';
          z.attackStateTimer =
            z.kind === 'runner' ? 0.16 : isBoss || z.kind === 'miniboss' ? 0.23 : 0.2;
          z.slashAngle = Math.atan2(toPlayerY, toPlayerX);
          z.vx = 0;
          z.vy = 0;
          continue;
        }

        const goal = this.getFlowVelocityTarget(z.x, z.y);
        const dx = goal.x - z.x;
        const dy = goal.y - z.y;
        const dist = Math.hypot(dx, dy) || 1;

        if (pDist < standoffDist && z.attackCd > 0) {
          const awayAng = Math.atan2(z.y - targetP.y, z.x - targetP.x);
          const strafeSign = z.id % 2 === 0 ? 1 : -1;
          const orbitAng = awayAng + strafeSign * 1.15;
          z.vx = Math.cos(orbitAng) * spd * 0.45 + Math.cos(awayAng) * 48;
          z.vy = Math.sin(orbitAng) * spd * 0.45 + Math.sin(awayAng) * 48;
          z.facingAngle = this.lerpAngle(z.facingAngle, Math.atan2(toPlayerY, toPlayerX), Math.min(1, dt * 10));
        } else {
          z.vx = (dx / dist) * spd;
          z.vy = (dy / dist) * spd;
          z.facingAngle = this.lerpAngle(z.facingAngle, Math.atan2(dy, dx), Math.min(1, dt * 9));
        }

        for (let j = 0; j < s.zombies.length; j++) {
          const oz = s.zombies[j];
          if (!oz || oz.id === z.id) continue;
          const minD = z.radius + oz.radius;
          const sx = z.x - oz.x;
          if (Math.abs(sx) >= minD) continue;
          const sy = z.y - oz.y;
          if (Math.abs(sy) >= minD) continue;
          const sd = Math.hypot(sx, sy);
          if (sd > 0 && sd < minD) {
            z.vx += (sx / sd) * 78;
            z.vy += (sy / sd) * 78;
          }
        }

        z.x += z.vx * dt;
        z.y += z.vy * dt;
        this.maintainZombiePlayerSeparation(z, targetP, targetP.radius + z.radius + 9);
        this.resolveEntityInsideWalls(z);
        if (dt > 0.0005) {
          z.vx = (z.x - prevZx) / dt;
          z.vy = (z.y - prevZy) / dt;
        }

        if (z.kind === 'spitter') {
          z.rangedCd -= dt;
          if (z.rangedCd <= 0 && pDist < 420 && this.hasBulletLineOfSight(z.x, z.y, targetP.x, targetP.y)) {
            z.rangedCd = Math.max(1.85, 2.65 - s.wave * 0.05);
            const ang = Math.atan2(targetP.y - z.y, targetP.x - z.x);
            z.attackAnim = 0.85;
            z.slashAngle = ang;
            s.spits.push({
              x: z.x,
              y: z.y,
              vx: Math.cos(ang) * 355,
              vy: Math.sin(ang) * 355,
              radius: 8,
              damage: z.damage,
              life: 1.9,
              projKind: 'acid',
            });
          }
        } else if (z.kind === 'necro') {
          z.rangedCd -= dt;
          if (z.rangedCd <= 0) {
            z.rangedCd = 3.4;
            z.attackAnim = 0.9;
            let buffedCount = 0;
            for (const oz of s.zombies) {
              if (!oz || oz.id === z.id || oz.hp <= 0 || isBossKind(oz.kind)) continue;
              if (Math.hypot(oz.x - z.x, oz.y - z.y) <= 210) {
                oz.hp = Math.min(oz.maxHp, oz.hp + Math.round(oz.maxHp * 0.14));
                oz.frenzyTimer = Math.max(oz.frenzyTimer || 0, 2.4);
                buffedCount += 1;
              }
            }
            if (buffedCount > 0) {
              this.spawnHitSparks(z.x, z.y, '#c084fc', 9);
              this.spawnFloatingText(z.x, z.y - z.radius - 14, I18n.t('ftNecroBuff'), '#d8b4fe', 1.0);
            }
            if (pDist < 430 && this.hasBulletLineOfSight(z.x, z.y, targetP.x, targetP.y)) {
              const ang = Math.atan2(targetP.y - z.y, targetP.x - z.x);
              z.slashAngle = ang;
              s.spits.push({
                x: z.x,
                y: z.y,
                vx: Math.cos(ang) * 380,
                vy: Math.sin(ang) * 380,
                radius: 7.5,
                damage: Math.round(z.damage * 0.85),
                life: 1.8,
                projKind: 'shock',
              });
            }
          }
        }
      }
    }
  }

  private executeStageBossSkill(
    z: ZombieEntity,
    targetP: { id: string; x: number; y: number; radius: number; isLocal: boolean },
    enraged: boolean
  ): void {
    const s = this.state!;
    const baseAng = Math.atan2(targetP.y - z.y, targetP.x - z.x);
    z.attackAnim = 1.0;
    z.slashAngle = baseAng;
    const shotDmg = Math.round(z.damage * 0.56);

    switch (z.kind) {
      case 'boss_warden': {
        // 第1关【镇暴重盾局长】：开启警笛突击加速 + 3发高压电击警棍脉冲弹
        z.rangedCd = enraged ? 2.4 : 3.3;
        z.frenzyTimer = 1.25;
        this.spawnHitSparks(z.x, z.y, '#60a5fa', 8);
        for (let k = -1; k <= 1; k++) {
          const a = baseAng + k * 0.24;
          s.spits.push({
            x: z.x + Math.cos(a) * 32,
            y: z.y + Math.sin(a) * 32,
            vx: Math.cos(a) * 410,
            vy: Math.sin(a) * 410,
            radius: 9,
            damage: shotDmg,
            life: 1.9,
            projKind: 'shock',
          });
        }
        break;
      }
      case 'boss_chainsaw': {
        // 第2关【电锯狂欢小丑】：引擎狂飙冲刺 + 3枚可弹墙折射的高速旋转飞锯！
        z.rangedCd = enraged ? 2.1 : 3.0;
        z.frenzyTimer = 0.95;
        const count = enraged ? 4 : 3;
        for (let i = 0; i < count; i++) {
          const a = baseAng + (i - (count - 1) / 2) * 0.26;
          s.spits.push({
            x: z.x + Math.cos(a) * 34,
            y: z.y + Math.sin(a) * 34,
            vx: Math.cos(a) * 450,
            vy: Math.sin(a) * 450,
            radius: 11,
            damage: Math.round(z.damage * 0.62),
            life: 2.3,
            projKind: 'saw',
            bouncesLeft: 1,
          });
        }
        break;
      }
      case 'boss_venom': {
        // 第3关【零号毒液母体】：5连扇形高腐蚀强酸臼炮，落地铺设大范围毒液池！
        z.rangedCd = enraged ? 2.2 : 3.1;
        for (let k = -2; k <= 2; k++) {
          const a = baseAng + k * 0.23;
          s.spits.push({
            x: z.x + Math.cos(a) * 32,
            y: z.y + Math.sin(a) * 32,
            vx: Math.cos(a) * 355,
            vy: Math.sin(a) * 355,
            radius: 10,
            damage: shotDmg,
            life: 2.1,
            projKind: 'acid',
          });
        }
        break;
      }
      case 'boss_surgeon': {
        // 第4关【血疫外科屠夫】：鲜血虹吸自愈（火焰灼烧可重创抑制其回血！）+ 高速外科骨锯飞刃
        z.rangedCd = enraged ? 2.3 : 3.2;
        const selfHealPct = z.burnTimer > 0 ? 0.012 : 0.035;
        if (z.hp < z.maxHp) {
          const regen = Math.round(z.maxHp * selfHealPct);
          z.hp = Math.min(z.maxHp, z.hp + regen);
          this.spawnHitSparks(z.x, z.y, '#fb7185', 8);
          this.spawnFloatingText(z.x, z.y - z.radius - 18, `+${regen} HP`, '#fb7185', 1.05);
        }
        for (let k = -1; k <= 1; k++) {
          const a = baseAng + k * 0.19;
          s.spits.push({
            x: z.x + Math.cos(a) * 34,
            y: z.y + Math.sin(a) * 34,
            vx: Math.cos(a) * 475,
            vy: Math.sin(a) * 475,
            radius: 10.5,
            damage: Math.round(z.damage * 0.6),
            life: 2.0,
            projKind: 'saw',
          });
        }
        break;
      }
      case 'boss_kraken': {
        // 第5关【深海铁锚巨兽】：8向环形深海寒潮震波 + 近身震地击退！
        z.rangedCd = enraged ? 2.5 : 3.4;
        s.camera.shake = Math.max(s.camera.shake, 0.45);
        const spokes = enraged ? 10 : 8;
        for (let i = 0; i < spokes; i++) {
          const a = baseAng + (i / spokes) * Math.PI * 2;
          s.spits.push({
            x: z.x + Math.cos(a) * 34,
            y: z.y + Math.sin(a) * 34,
            vx: Math.cos(a) * 325,
            vy: Math.sin(a) * 325,
            radius: 10,
            damage: shotDmg,
            life: 2.0,
            projKind: 'cryo',
          });
        }
        break;
      }
      case 'boss_tesla': {
        // 第6关【高压电弧督军】：超导雷霆闪现突进 + 4发连锁高压电球！
        z.rangedCd = enraged ? 2.2 : 3.0;
        const oldX = z.x;
        const oldY = z.y;
        const blinkDist = 96;
        const nx = z.x + Math.cos(baseAng) * blinkDist;
        const ny = z.y + Math.sin(baseAng) * blinkDist;
        if (
          Math.hypot(targetP.x - z.x, targetP.y - z.y) > 150 &&
          !this.findBlockingWallOrLockedDoor(nx, ny, z.radius) &&
          this.hasClearWalkLine(z.x, z.y, nx, ny)
        ) {
          z.x = nx;
          z.y = ny;
          this.resolveEntityInsideWalls(z);
          const pts = [
            { x: oldX, y: oldY },
            { x: (oldX + z.x) * 0.5 + 14, y: (oldY + z.y) * 0.5 - 14 },
            { x: z.x, y: z.y },
          ];
          if (s.lightnings.length >= 18) s.lightnings.shift();
          s.lightnings.push({ points: pts, color: '#38bdf8', life: 0.24 });
          if (s.isCoop && CoopManager.role === 'host' && !CoopManager.isCongested()) {
            CoopManager.broadcastToClients({ type: 'evt_fx', kind: 'lightning', points: pts, color: '#38bdf8' });
          }
        }
        for (let k = -1.5; k <= 1.5; k += 1) {
          const a = baseAng + k * 0.2;
          s.spits.push({
            x: z.x + Math.cos(a) * 30,
            y: z.y + Math.sin(a) * 30,
            vx: Math.cos(a) * 435,
            vy: Math.sin(a) * 435,
            radius: 9.5,
            damage: shotDmg,
            life: 1.9,
            projKind: 'shock',
          });
        }
        break;
      }
      case 'boss_cryo': {
        // 第7关【极寒机甲统帅】：绝对零度 5 发冰封火箭齐射（命中附带寒霜减速）！
        z.rangedCd = enraged ? 2.2 : 3.1;
        for (let k = -2; k <= 2; k++) {
          const a = baseAng + k * 0.16;
          s.spits.push({
            x: z.x + Math.cos(a) * 34,
            y: z.y + Math.sin(a) * 34,
            vx: Math.cos(a) * 425,
            vy: Math.sin(a) * 425,
            radius: 9.5,
            damage: shotDmg,
            life: 2.1,
            projKind: 'cryo',
          });
        }
        break;
      }
      default: {
        // 第8关【深渊核熔尸皇】：5向熔岩火球扇射 + 二阶段额外释放 8 向地狱火新星！
        z.rangedCd = enraged ? 2.1 : 3.0;
        for (let k = -2; k <= 2; k++) {
          const a = baseAng + k * 0.22;
          s.spits.push({
            x: z.x + Math.cos(a) * 34,
            y: z.y + Math.sin(a) * 34,
            vx: Math.cos(a) * 375,
            vy: Math.sin(a) * 375,
            radius: 10.5,
            damage: Math.round(z.damage * 0.6),
            life: 2.2,
            projKind: 'fire',
          });
        }
        if (enraged) {
          for (let r = 0; r < 6; r++) {
            const ra = baseAng + Math.PI / 6 + (r / 6) * Math.PI * 2;
            s.spits.push({
              x: z.x + Math.cos(ra) * 30,
              y: z.y + Math.sin(ra) * 30,
              vx: Math.cos(ra) * 290,
              vy: Math.sin(ra) * 290,
              radius: 9.5,
              damage: shotDmg,
              life: 1.9,
              projKind: 'fire',
            });
          }
        }
        break;
      }
    }
  }

  private maintainZombiePlayerSeparation(
    z: ZombieEntity,
    p: { x: number; y: number },
    minSep: number
  ): void {
    const dx = z.x - p.x;
    const dy = z.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d < minSep) {
      const nx = d > 0.001 ? dx / d : Math.cos(z.facingAngle + Math.PI);
      const ny = d > 0.001 ? dy / d : Math.sin(z.facingAngle + Math.PI);
      z.x = p.x + nx * minSep;
      z.y = p.y + ny * minSep;
    }
  }

  private getRoomAt(x: number, y: number) {
    return this.state!.rooms.find((rm) =>
      rm.rects.some((r) => x >= r.x - 20 && x <= r.x + r.w + 20 && y >= r.y - 20 && y <= r.y + r.h + 20)
    );
  }

  private damagePlayer(amount: number, invulnDur = 0.32): void {
    const s = this.state!;
    const p = s.player;
    if (p.downed || p.spectating || p.invulnTimer > 0 || s.waveState === 'ended') return;

    let hpLoss = amount;
    let armorAbsorbed = 0;
    if (p.armor > 0) {
      armorAbsorbed = Math.min(p.armor, Math.round(amount * 0.7));
      p.armor = Math.max(0, p.armor - armorAbsorbed);
      hpLoss = Math.max(1, amount - armorAbsorbed);
    }

    p.hp = Math.max(0, p.hp - hpLoss);
    p.invulnTimer = invulnDur;
    p.hitFlashTimer = 0.24;
    s.camera.shake = Math.max(s.camera.shake, 0.58);
    this.spawnFloatingText(
      p.x,
      p.y - 30,
      armorAbsorbed > 0 ? `-${hpLoss} (🛡️-${armorAbsorbed})` : `-${hpLoss}`,
      armorAbsorbed > 0 ? '#7dd3fc' : '#f87171',
      1.2
    );

    if (p.hp <= 0) {
      if (s.isCoop) {
        // 多人联机进入倒地求救状态（35秒救援窗口，队友靠近 2.3秒可拉起，波次清空自动起身！）
        p.downed = true;
        p.bleedoutTimer = 35;
        p.reviveProgress = 0;
        p.reloadTimer = 0;
        this.input.resetStates();
        SoundFX.alarm();
        this.showBanner(I18n.t('bannerSelfDown'), 3.4);
        if (CoopManager.role === 'client') {
          CoopManager.sendToHost({ type: 'player_sync', p: this.buildLocalPlayerSync() });
        }
        return;
      }

      PlatformSDK.gameplayStop();
      if (s.mode === 'endless') {
        SaveManager.recordEndlessWave(s.stage.id, s.wave);
      }
      this.flushRunTelemetry(false);
      this.modalPaused = true;
      this.input.resetStates();
      this.callbacks.onPlayerDowned(!s.reviveUsed);
    }
  }

  private spawnAcidPool(x: number, y: number, isBoss: boolean): void {
    const s = this.state!;
    if (s.acidPools.length >= 16) s.acidPools.shift();
    const dur = isBoss ? 3.8 : 3.2;
    s.acidPools.push({
      x,
      y,
      radius: isBoss ? 44 : 34,
      life: dur,
      maxLife: dur,
      isBoss,
    });
  }

  private updateSpits(dt: number): void {
    const s = this.state!;
    const aliveList = this.getAliveCombatants();
    for (let i = s.spits.length - 1; i >= 0; i--) {
      const sp = s.spits[i];
      const pk = sp.projKind || 'acid';
      const isBoss = sp.radius >= 9;
      sp.life -= dt;
      const nx = sp.x + sp.vx * dt;
      const ny = sp.y + sp.vy * dt;
      const blocked = this.findBulletBlocker(nx, ny, sp.radius);
      if (sp.life <= 0 || blocked) {
        if (blocked && sp.bouncesLeft && sp.bouncesLeft > 0 && sp.life > 0) {
          sp.bouncesLeft -= 1;
          if (this.findBulletBlocker(nx, sp.y, sp.radius)) sp.vx = -sp.vx;
          else sp.vy = -sp.vy;
          sp.x += sp.vx * dt;
          sp.y += sp.vy * dt;
          this.spawnHitSparks(sp.x, sp.y, '#fde047', 4);
          continue;
        }
        if (pk === 'acid' || pk === 'fire') {
          const nearAny = aliveList.some((c) => Math.hypot(sp.x - c.x, sp.y - c.y) < 320);
          if (!blocked || nearAny) {
            this.spawnAcidPool(sp.x, sp.y, isBoss);
          }
        } else {
          this.spawnHitSparks(
            sp.x,
            sp.y,
            pk === 'cryo' ? '#67e8f9' : pk === 'shock' ? '#38bdf8' : '#fda4af',
            4
          );
        }
        s.spits.splice(i, 1);
        continue;
      }
      sp.x = nx;
      sp.y = ny;
      let hitSomeone = false;
      for (const c of aliveList) {
        if (Math.hypot(sp.x - c.x, sp.y - c.y) <= sp.radius + c.radius) {
          if (pk === 'acid' || pk === 'fire') {
            this.spawnAcidPool(sp.x, sp.y, isBoss);
          } else {
            this.spawnHitSparks(
              sp.x,
              sp.y,
              pk === 'cryo' ? '#67e8f9' : pk === 'shock' ? '#38bdf8' : '#fda4af',
              6
            );
          }
          if (pk === 'cryo' && c.isLocal && s.player.chillImmuneTimer <= 0) {
            s.player.chillTimer = 0.85;
            s.player.chillImmuneTimer = 3.2;
          }
          s.spits.splice(i, 1);
          this.inflictDamageOnCombatant(c.id, sp.damage);
          hitSomeone = true;
          break;
        }
      }
      if (hitSomeone) continue;
    }
  }

  private updateAcidPools(dt: number): void {
    const s = this.state!;
    const aliveList = this.getAliveCombatants();
    for (let i = s.acidPools.length - 1; i >= 0; i--) {
      const ap = s.acidPools[i];
      ap.life -= dt;
      if (ap.life <= 0) {
        s.acidPools.splice(i, 1);
        continue;
      }
      for (const c of aliveList) {
        if (Math.hypot(c.x - ap.x, c.y - ap.y) <= ap.radius + c.radius * 0.45) {
          this.inflictDamageOnCombatant(c.id, ap.isBoss ? 9 : 6, 0.55);
        }
      }
    }
  }

  private updateDrops(dt: number): void {
    const s = this.state!;
    const aliveList = this.getAliveCombatants();
    const baseMagnet = s.powerUpTimers.overdrive > 0 ? 230 : 125;
    const magnetRange = baseMagnet * SaveManager.getEffectivePlayerStats().magnetMult;

    for (let i = s.drops.length - 1; i >= 0; i--) {
      const d = s.drops[i];
      d.life -= dt;
      if (d.life <= 0) {
        s.drops.splice(i, 1);
        continue;
      }

      let nearestC = aliveList[0];
      let bestDist = Infinity;
      for (const c of aliveList) {
        const dist = Math.hypot(c.x - d.x, c.y - d.y);
        if (dist < bestDist) {
          bestDist = dist;
          nearestC = c;
        }
      }
      const distDog = s.mechDog.active ? Math.hypot(s.mechDog.x - d.x, s.mechDog.y - d.y) : Infinity;

      if (bestDist < magnetRange) {
        d.x += ((nearestC.x - d.x) / (bestDist || 1)) * 390 * dt;
        d.y += ((nearestC.y - d.y) / (bestDist || 1)) * 390 * dt;
      }

      if (bestDist <= nearestC.radius + 20) {
        this.collectDrop(d, nearestC.id);
        s.drops.splice(i, 1);
      } else if (distDog <= 28) {
        this.collectDrop(d, 'dog');
        s.drops.splice(i, 1);
      }
    }
  }

  private addBattleXpLocal(xpVal: number): void {
    const s = this.state!;
    s.battleXp += xpVal;
    SoundFX.xp();
    while (s.battleXp >= s.battleXpNext) {
      s.battleXp -= s.battleXpNext;
      s.battleLevel += 1;
      s.battleXpNext = Math.round(s.battleXpNext * 1.38 + 22);
      if (!s.player.downed && !s.player.spectating) {
        s.player.hp = Math.min(s.player.maxHp, s.player.hp + Math.round(s.player.maxHp * 0.15));
      }
      this.triggerBattleLevelUp();
    }
  }

  private collectDrop(d: DropItem, pickerId = CoopManager.myPeerId): void {
    const s = this.state!;
    if (d.kind === 'cash') {
      if (!s.isCoop) {
        s.cash += d.value;
        SoundFX.coin();
        this.spawnFloatingText(d.x, d.y - 10, `+$${d.value}`, '#4ade80', 1);
      } else {
        // 多人联机：拾取者得 80%，其余守窗队友同步分得 45% 协防军费，保证人人买得起枪并合资开门！
        const pickerShare = pickerId === 'dog' ? Math.max(1, Math.round(d.value * 0.65)) : Math.max(1, Math.round(d.value * 0.8));
        const mateShare = pickerId === 'dog' ? pickerShare : Math.max(1, Math.round(d.value * 0.45));
        const myGain = pickerId === CoopManager.myPeerId ? pickerShare : mateShare;
        s.cash += myGain;
        SoundFX.coin();
        this.spawnFloatingText(d.x, d.y - 10, `+$${myGain}`, '#4ade80', 1);

        if (CoopManager.role === 'host') {
          for (const rp of s.remotePlayers) {
            const gain = rp.peerId === pickerId ? pickerShare : mateShare;
            CoopManager.sendToClient(rp.peerId, {
              type: 'evt_team_reward',
              targetId: rp.peerId,
              cashDelta: gain,
            });
          }
        }
      }
    } else if (d.kind === 'heal') {
      const pStats = SaveManager.getEffectivePlayerStats();
      const myRatio = pickerId === CoopManager.myPeerId || pickerId === 'dog' ? 0.15 * pStats.medDropHealMult : 0.08;
      if (!s.player.downed && !s.player.spectating) {
        const healAmt = Math.max(8, Math.round(s.player.maxHp * myRatio));
        s.player.hp = Math.min(s.player.maxHp, s.player.hp + healAmt);
        this.spawnFloatingText(s.player.x, s.player.y - 28, I18n.t('ftMedDrop', { n: healAmt }), '#4ade80', 1.15);
      }
      SoundFX.fanfare();
      if (s.isCoop && CoopManager.role === 'host') {
        for (const rp of s.remotePlayers) {
          const rRatio = rp.peerId === pickerId ? 0.15 : 0.08;
          CoopManager.sendToClient(rp.peerId, {
            type: 'evt_team_reward',
            targetId: rp.peerId,
            healRatio: rRatio,
          });
        }
      }
    } else if (d.kind === 'xp') {
      this.addBattleXpLocal(d.value);
      if (s.isCoop && CoopManager.role === 'host') {
        CoopManager.broadcastToClients({ type: 'evt_team_reward', xpDelta: d.value });
      }
    } else if (d.kind === 'powerup' && d.powerUp) {
      const meta = POWERUP_META[d.powerUp];
      const pName = I18n.powerupName(d.powerUp, meta.name);
      SoundFX.fanfare();
      this.spawnFloatingText(s.player.x, s.player.y - 36, `${meta.icon} ${pName}!`, meta.color, 1.25);
      if (s.isCoop && CoopManager.role === 'host') {
        CoopManager.broadcastToClients({ type: 'evt_team_reward', powerUp: d.powerUp });
      }
      if (d.powerUp === 'nuke') {
        s.camera.shake = 1.25;
        this.spawnExplosionVisuals(d.x, d.y, 260);
        const snapshot = [...s.zombies];
        for (const z of snapshot) {
          if (!z || z.hp <= 0 || this.deadZombieIds.has(z.id)) continue;
          if (isBossKind(z.kind) || z.kind === 'miniboss') {
            this.damageZombie(z, z.maxHp * 0.3, 0, 0, true, false, false);
          } else {
            this.killZombie(z);
          }
        }
      } else if (d.powerUp === 'carpenter') {
        for (const w of s.windows) {
          w.planks = w.maxPlanks;
          this.pushOutdoorZombiesOutsidePlanks(w);
        }
        s.cash += 40;
      } else {
        s.powerUpTimers[d.powerUp] = meta.duration;
      }
    }
  }

  private onWaveSurvivedLocal(clearedWave: number): void {
    const s = this.state;
    if (!s) return;
    const pStats = SaveManager.getEffectivePlayerStats();
    s.player.chillTimer = 0;
    if (!s.player.downed && !s.player.spectating) {
      if (s.player.hp < s.player.maxHp) {
        const waveHeal = Math.max(5, Math.round(s.player.maxHp * 0.06));
        s.player.hp = Math.min(s.player.maxHp, s.player.hp + waveHeal);
        this.spawnFloatingText(
          s.player.x,
          s.player.y - 36,
          I18n.t('ftWaveHeal', { n: waveHeal }),
          '#4ade80',
          1.05
        );
      }
      if (pStats.waveArmorRegen > 0) {
        s.player.armor = Math.min(s.player.maxArmor, s.player.armor + pStats.waveArmorRegen);
      }
    }
    if (pStats.grenadeWaveSupply && clearedWave % 2 === 0) {
      s.player.grenades += 1;
    }
    const extraRooms = this.getUnlockedExtraRoomsCount();
    if (extraRooms > 0 && !(s.mode === 'standard' && clearedWave >= s.maxWaves)) {
      const stipend = extraRooms * 50;
      s.cash += stipend;
      SoundFX.coin();
      this.spawnFloatingText(
        s.player.x,
        s.player.y - 54,
        I18n.t('ftSectorStipend', { n: stipend }),
        '#fde047',
        1.22
      );
    }
    SaveManager.addDailyProgress('waves', 1);
    if (s.mode === 'endless' && clearedWave >= 8) {
      SaveManager.addDailyProgress('clear', 1);
    }
    this.flushRunTelemetry(false);
  }

  public flushRunTelemetry(_victory: boolean): void {
    const s = this.state;
    if (!s) return;
    const deltaKills = Math.max(0, s.kills - s.lastRecordedKills);
    s.lastRecordedKills = s.kills;
    const mates = s.isCoop
      ? s.remotePlayers.map((rp) => ({
          callsign: rp.callsign,
          wave: s.wave,
          kills: Math.max(rp.kills, Math.round(s.kills / Math.max(1, s.squadCount))),
        }))
      : [];
    SaveManager.recordRunTelemetry(deltaKills, mates);
  }

  private triggerBattleLevelUp(): void {
    const s = this.state!;
    const lv = s.battleLevel;

    // 联机模式不暂停、不弹窗，直接自动装配强化并显示轻提示，彻底避免选卡时挨打暴毙！
    if (s.isCoop) {
      const picked = IN_RUN_PERKS[Math.floor(Math.random() * IN_RUN_PERKS.length)];
      picked.apply(s.modifiers);
      const pMeta = I18n.perkMeta(picked.id, picked.name, picked.desc);
      SoundFX.fanfare();
      s.lootToast = {
        sprite: picked.sprite,
        badge: I18n.t('badgeBattleLv', { lv }),
        title: pMeta.name,
        desc: pMeta.desc,
        color: picked.color,
        timer: 2.8,
      };
      this.spawnFloatingText(
        s.player.x,
        s.player.y - 40,
        `Lv.${lv} · ${pMeta.name}`,
        '#fde047',
        1.22
      );
      return;
    }

    // 单人模式：暂停并弹出肉鸽三选一战术强化卡
    const pool = [...IN_RUN_PERKS];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    const choices = pool.slice(0, 3);

    this.pendingModals.push(() => {
      if (!this.state || this.state.waveState === 'ended' || this.state.player.hp <= 0) return;
      this.modalPaused = true;
      PlatformSDK.gameplayStop();
      this.input.resetStates();
      SoundFX.fanfare();
      this.callbacks.onShowPerkChoices(choices, lv, (picked) => {
        if (!this.state) return;
        picked.apply(this.state.modifiers);
        const pMeta = I18n.perkMeta(picked.id, picked.name, picked.desc);
        this.modalPaused = false;
        PlatformSDK.gameplayStart();
        SoundFX.fanfare();
        this.spawnFloatingText(
          this.state.player.x,
          this.state.player.y - 40,
          `Lv.${lv} · ${pMeta.name}`,
          picked.color,
          1.25
        );
        this.flushQueuedModals();
      });
    });
    this.flushQueuedModals();
  }

  private updateFX(dt: number): void {
    const s = this.state!;
    for (let i = s.explosions.length - 1; i >= 0; i--) {
      s.explosions[i].life -= dt;
      if (s.explosions[i].life <= 0) s.explosions.splice(i, 1);
    }
    for (let i = s.decals.length - 1; i >= 0; i--) {
      s.decals[i].life -= dt;
      if (s.decals[i].life <= 0) s.decals.splice(i, 1);
    }
    for (let i = s.particles.length - 1; i >= 0; i--) {
      const pt = s.particles[i];
      pt.life -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= 0.92;
      pt.vy *= 0.92;
      if (pt.isSmoke) {
        pt.size += dt * 16;
      }
      if (pt.life <= 0) s.particles.splice(i, 1);
    }
    for (let i = s.floatingTexts.length - 1; i >= 0; i--) {
      const ft = s.floatingTexts[i];
      ft.life -= dt;
      ft.y += ft.vy * dt;
      if (ft.life <= 0) s.floatingTexts.splice(i, 1);
    }
    for (let i = s.lightnings.length - 1; i >= 0; i--) {
      s.lightnings[i].life -= dt;
      if (s.lightnings[i].life <= 0) s.lightnings.splice(i, 1);
    }
  }

  private spawnHitSparks(x: number, y: number, color: string, count: number): void {
    const s = this.state!;
    const allowed = Math.min(count, Math.max(2, 130 - s.particles.length));
    for (let i = 0; i < allowed; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 60 + Math.random() * 170;
      s.particles.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        size: 3 + Math.random() * 3.5,
        color,
        life: 0.22 + Math.random() * 0.18,
        maxLife: 0.4,
      });
    }
  }

  public spawnFloatingText(x: number, y: number, text: string, color: string, scale = 1): void {
    if (!this.state) return;
    if (this.state.floatingTexts.length >= 40) {
      this.state.floatingTexts.shift();
    }
    this.state.floatingTexts.push({
      x,
      y,
      vy: -42,
      text,
      color,
      scale,
      life: 0.78,
      maxLife: 0.78,
    });
  }

  // ==================== 窗户坐标系、翻窗保护与墙壁碰撞 ====================

  private getWindowFrame(win: RunSnapshot['windows'][number]) {
    const wcx = win.x + win.w / 2;
    const wcy = win.y + win.h / 2;
    const outX = Math.sign(win.spawnOutsideOffset.dx);
    const outY = Math.sign(win.spawnOutsideOffset.dy);
    const inX = -outX;
    const inY = -outY;
    const latX = outY !== 0 ? 1 : 0;
    const latY = outX !== 0 ? 1 : 0;
    const winSpan = win.orientation === 'horizontal' ? win.w : win.h;
    return { wcx, wcy, outX, outY, inX, inY, latX, latY, winSpan };
  }

  private isPointInsideAnyRoom(x: number, y: number, pad = 28): boolean {
    for (const rm of this.state!.rooms) {
      for (const r of rm.rects) {
        if (x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad) {
          return true;
        }
      }
    }
    return false;
  }

  private isOutdoorSegmentClear(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    radius: number
  ): boolean {
    const samples = 6;
    for (let i = 1; i <= samples; i++) {
      const t = i / (samples + 1);
      const mx = x1 + (x2 - x1) * t;
      const my = y1 + (y2 - y1) * t;
      if (this.findBlockingWallOrLockedDoor(mx, my, radius * 0.72)) {
        return false;
      }
    }
    return true;
  }

  private steerOutdoorZombieSwarm(
    z: ZombieEntity,
    win: RunSnapshot['windows'][number],
    wf: ReturnType<GameEngine['getWindowFrame']>,
    goalX: number,
    goalY: number,
    _outDist: number,
    latOff: number,
    standOutDist: number,
    moveSpeed: number,
    dt: number,
    allowOpenWindowPass: boolean
  ): void {
    const s = this.state!;
    const bb = s.stage.buildingBounds;
    const distToGoal = Math.hypot(goalX - z.x, goalY - z.y);

    // 侧翼大角度包抄时先汇聚到窗外弧形漏斗锚点，避免紧贴外墙横向摩擦
    const throatOut = Math.max(standOutDist + 16, Math.min(108, 22 + Math.abs(latOff) * 0.48));
    const throatX = wf.wcx + wf.outX * throatOut;
    const throatY = wf.wcy + wf.outY * throatOut;

    let aimX = distToGoal > 105 && Math.abs(latOff) > 42 ? throatX : goalX;
    let aimY = distToGoal > 105 && Math.abs(latOff) > 42 ? throatY : goalY;

    // 若侧翼与窗户之间隔着凸出的建筑翼楼，先自动绕向外围空旷拐角再包抄破窗
    if (!this.isOutdoorSegmentClear(z.x, z.y, throatX, throatY, z.radius)) {
      aimX = wf.outX !== 0 ? (wf.outX < 0 ? bb.x - 105 : bb.x + bb.w + 105) : wf.wcx;
      aimY = wf.outY !== 0 ? (wf.outY < 0 ? bb.y - 105 : bb.y + bb.h + 105) : wf.wcy;
    }

    const baseAng = Math.atan2(aimY - z.y, aimX - z.x);
    // 远距离赋予每只僵尸独立的弧形包抄曲率 + 蹒跚摇摆偏移，呈现四面八方散点涌入感
    const curveWeight = Math.min(1, Math.max(0, (distToGoal - 68) / 240));
    const flankBias = (((z.id * 53) % 15) / 7 - 1) * 0.44 * curveWeight;
    const shamblingSway = Math.sin(z.wobblePhase * 0.38 + z.id * 1.9) * 0.24 * curveWeight;

    let steerAng = baseAng + flankBias + shamblingSway;
    const probeX = z.x + Math.cos(steerAng) * 26;
    const probeY = z.y + Math.sin(steerAng) * 26;
    if (this.findBlockingWallOrLockedDoor(probeX, probeY, z.radius * 0.85)) {
      steerAng = baseAng;
    }

    z.vx = Math.cos(steerAng) * moveSpeed;
    z.vy = Math.sin(steerAng) * moveSpeed;

    // 户外尸潮拉开宽松散兵间距，拒绝排成一条单列直线
    const sepScale = distToGoal > 76 ? 1.42 : 0.88;
    const sepForce = distToGoal > 76 ? 86 : 56;
    for (let j = 0; j < s.zombies.length; j++) {
      const oz = s.zombies[j];
      if (!oz || oz.id === z.id || oz.insideBuilding) continue;
      const minD = (z.radius + oz.radius) * sepScale;
      const sx = z.x - oz.x;
      if (Math.abs(sx) >= minD) continue;
      const sy = z.y - oz.y;
      if (Math.abs(sy) >= minD) continue;
      const sd = Math.hypot(sx, sy);
      if (sd > 0 && sd < minD) {
        z.vx += (sx / sd) * sepForce;
        z.vy += (sy / sd) * sepForce;
      }
    }

    const prevOutX = z.x;
    const prevOutY = z.y;
    const moveAng = Math.atan2(z.vy, z.vx);
    z.facingAngle = this.lerpAngle(z.facingAngle, moveAng, Math.min(1, dt * 9.5));
    z.x += z.vx * dt;
    z.y += z.vy * dt;
    this.resolveOutdoorZombieObstacles(z, win, allowOpenWindowPass);
    if (dt > 0.0005) {
      z.vx = (z.x - prevOutX) / dt;
      z.vy = (z.y - prevOutY) / dt;
    }
  }

  private hasZombieVaultingWindow(win: RunSnapshot['windows'][number]): boolean {
    const s = this.state!;
    const wf = this.getWindowFrame(win);
    for (const z of s.zombies) {
      if (!z || z.hp <= 0 || z.insideBuilding) continue;
      const rx = z.x - wf.wcx;
      const ry = z.y - wf.wcy;
      const outDist = rx * wf.outX + ry * wf.outY;
      const latOff = rx * wf.latX + ry * wf.latY;
      if (Math.abs(outDist) < 14 + z.radius * 0.65 && Math.abs(latOff) <= wf.winSpan * 0.52) {
        return true;
      }
    }
    return false;
  }

  private pushOutdoorZombiesOutsidePlanks(win: RunSnapshot['windows'][number]): void {
    const s = this.state!;
    const wf = this.getWindowFrame(win);
    for (const z of s.zombies) {
      if (!z || z.hp <= 0 || z.insideBuilding) continue;
      const rx = z.x - wf.wcx;
      const ry = z.y - wf.wcy;
      const outDist = rx * wf.outX + ry * wf.outY;
      const latOff = rx * wf.latX + ry * wf.latY;
      const minOut = 14 + z.radius + 4;
      if (Math.abs(latOff) <= wf.winSpan * 0.65 && outDist < minOut && outDist > -z.radius) {
        z.x = wf.wcx + wf.outX * minOut + wf.latX * latOff;
        z.y = wf.wcy + wf.outY * minOut + wf.latY * latOff;
      }
    }
  }

  private resolveOutdoorZombieObstacles(
    z: { x: number; y: number; radius: number },
    targetWin: RunSnapshot['windows'][number],
    allowOpenWindowPass: boolean
  ): void {
    const s = this.state!;
    for (const w of s.walls) {
      this.pushCircleOutOfRect(z, w);
    }
    for (const d of s.doors) {
      if (!d.unlocked) this.pushCircleOutOfRect(z, d);
    }
    for (const win of s.windows) {
      if (allowOpenWindowPass && win.id === targetWin.id && win.planks <= 0 && win.armorPlanks <= 0) {
        continue;
      }
      this.pushCircleOutOfRect(z, win);
    }
  }

  private getSafeIndoorDropPoint(z: ZombieEntity): { x: number; y: number } {
    if (z.insideBuilding || !z.targetWindowId) {
      return { x: z.x, y: z.y };
    }
    const win = this.state!.windows.find((w) => w.id === z.targetWindowId);
    if (!win) {
      return { x: z.x, y: z.y };
    }
    const wf = this.getWindowFrame(win);
    const rx = z.x - wf.wcx;
    const ry = z.y - wf.wcy;
    const latOff = Math.max(-32, Math.min(32, rx * wf.latX + ry * wf.latY));
    return {
      x: wf.wcx + wf.inX * 42 + wf.latX * latOff,
      y: wf.wcy + wf.inY * 42 + wf.latY * latOff,
    };
  }

  private resolveEntityInsideWalls(ent: { x: number; y: number; radius: number }): void {
    for (let i = 0; i < this.staticBlockers.length; i++) {
      this.pushCircleOutOfRect(ent, this.staticBlockers[i]);
    }
  }

  private findBlockingWallOrLockedDoor(x: number, y: number, radius: number): Rect | null {
    const s = this.state!;
    for (const w of s.walls) {
      if (this.circleIntersectsRect(x, y, radius, w)) return w;
    }
    for (const d of s.doors) {
      if (!d.unlocked && this.circleIntersectsRect(x, y, radius, d)) return d;
    }
    return null;
  }

  private findBulletBlocker(x: number, y: number, radius: number): Rect | null {
    const wall = this.findBlockingWallOrLockedDoor(x, y, radius);
    if (wall) return wall;
    for (const pr of this.state!.props) {
      if (!pr.blocksBullets) continue; // 低矮办公桌/沙发/冷冻舱允许隔掩体射击！高大军用箱/铁柜/警车/街机阻挡子弹
      const { ew, eh } = this.getEffectivePropDims(pr);
      const r = { x: pr.x - ew * 0.4, y: pr.y - eh * 0.4, w: ew * 0.8, h: eh * 0.8 };
      if (this.circleIntersectsRect(x, y, radius, r)) return r;
    }
    return null;
  }

  private circleIntersectsRect(cx: number, cy: number, cr: number, r: Rect): boolean {
    const nx = Math.max(r.x, Math.min(cx, r.x + r.w));
    const ny = Math.max(r.y, Math.min(cy, r.y + r.h));
    return (cx - nx) ** 2 + (cy - ny) ** 2 < cr * cr;
  }

  private pushCircleOutOfRect(ent: { x: number; y: number; radius: number }, r: Rect): void {
    const nx = Math.max(r.x, Math.min(ent.x, r.x + r.w));
    const ny = Math.max(r.y, Math.min(ent.y, r.y + r.h));
    const dx = ent.x - nx;
    const dy = ent.y - ny;
    const distSq = dx * dx + dy * dy;
    if (distSq >= ent.radius * ent.radius) return;

    if (distSq > 0.0001) {
      const dist = Math.sqrt(distSq);
      const overlap = ent.radius - dist;
      ent.x += (dx / dist) * overlap;
      ent.y += (dy / dist) * overlap;
    } else {
      const left = ent.x - r.x;
      const right = r.x + r.w - ent.x;
      const top = ent.y - r.y;
      const bottom = r.y + r.h - ent.y;
      const min = Math.min(left, right, top, bottom);
      if (min === left) ent.x = r.x - ent.radius;
      else if (min === right) ent.x = r.x + r.w + ent.radius;
      else if (min === top) ent.y = r.y - ent.radius;
      else ent.y = r.y + r.h + ent.radius;
    }
  }

  // ==================== WebRTC P2P 多人协作（2~4人）核心同步层 ====================

  private interpolateRemotePlayers(dt: number): void {
    const s = this.state!;
    const angLerp = Math.min(1, dt * 18);
    for (const rp of s.remotePlayers) {
      // 速度航位推测（Dead-Reckoning）：在两次快照之间平滑向前预测至多 160ms，遇到墙壁自动止步，彻底消除停顿与回拉！
      if ((rp.vx !== 0 || rp.vy !== 0) && rp.extrapAge < 0.16 && !rp.spectating) {
        const step = Math.min(dt, 0.16 - rp.extrapAge);
        rp.extrapAge += step;
        const nx = rp.netTx + rp.vx * step;
        const ny = rp.netTy + rp.vy * step;
        if (!this.findBlockingWallOrLockedDoor(nx, rp.netTy, 15)) {
          rp.netTx = nx;
        }
        if (!this.findBlockingWallOrLockedDoor(rp.netTx, ny, 15)) {
          rp.netTy = ny;
        }
      }
      const errDist = Math.hypot(rp.netTx - rp.x, rp.netTy - rp.y);
      const posLerp = Math.min(1, dt * (errDist > 85 ? 21 : 14));
      rp.x += (rp.netTx - rp.x) * posLerp;
      rp.y += (rp.netTy - rp.y) * posLerp;
      rp.angle = this.lerpAngle(rp.angle, rp.netAngle, angLerp);
      if (rp.isMoving) {
        rp.walkPhase += dt * 11;
      }
      if (rp.muzzleFlashTimer > 0) rp.muzzleFlashTimer = Math.max(0, rp.muzzleFlashTimer - dt);
      if (rp.recoilOffset > 0) rp.recoilOffset = Math.max(0, rp.recoilOffset - dt * 40);
      if (rp.hitFlashTimer > 0) rp.hitFlashTimer = Math.max(0, rp.hitFlashTimer - dt);
      if (rp.invulnTimer > 0) rp.invulnTimer = Math.max(0, rp.invulnTimer - dt);
    }
  }

  private updateCoopRevive(dt: number): void {
    const s = this.state!;
    const p = s.player;
    const revDt = dt * SaveManager.getEffectivePlayerStats().reviveSpeedMultiplier;
    const now = performance.now();
    let clientRevivingId = '';

    // 存活玩家靠近倒地队友 92px 内自动读条战地救援（约 2.2 秒扶起，放宽半径容忍网络插值微偏）
    if (!p.downed && !p.spectating && p.hp > 0) {
      for (const rp of s.remotePlayers) {
        if (!rp.downed || rp.spectating) continue;
        if (Math.hypot(p.x - rp.x, p.y - rp.y) <= 92) {
          if (CoopManager.role === 'host') {
            this.advanceReviveOnHost(rp.peerId, CoopManager.myPeerId, s.localCallsign, revDt);
          } else if (!clientRevivingId) {
            clientRevivingId = rp.peerId;
            // 客户端本地乐观推进救援进度环，消除高延迟下读条卡顿感
            rp.reviveProgress = Math.min(0.99, rp.reviveProgress + revDt / 2.2);
          }
        }
      }
    }

    // 主机端仅在没有任何队友在过去 480ms 内对该目标发送救援心跳时才缓慢回退读条，彻底消除主机误扣队友救援进度的 Bug！
    if (CoopManager.role === 'host') {
      for (const rp of s.remotePlayers) {
        if (rp.downed && !rp.spectating && now - (this.lastReviveTickAt.get(rp.peerId) || 0) > 480) {
          rp.reviveProgress = Math.max(0, rp.reviveProgress - dt * 0.32);
        }
      }
    }

    if (CoopManager.role === 'client') {
      if (clientRevivingId) {
        if (this.reviveTickTargetId && this.reviveTickTargetId !== clientRevivingId && this.reviveTickAccum > 0) {
          CoopManager.sendToHost({
            type: 'cmd_revive_tick',
            reviverId: CoopManager.myPeerId,
            reviverName: s.localCallsign,
            targetId: this.reviveTickTargetId,
            dt: +this.reviveTickAccum.toFixed(3),
          });
          this.reviveTickAccum = 0;
        }
        this.reviveTickTargetId = clientRevivingId;
        this.reviveTickAccum += revDt;
        this.reviveTickTimer -= dt;
        if (this.reviveTickTimer <= 0) {
          this.reviveTickTimer = 0.09;
          const sendDt = +this.reviveTickAccum.toFixed(3);
          this.reviveTickAccum = 0;
          CoopManager.sendToHost({
            type: 'cmd_revive_tick',
            reviverId: CoopManager.myPeerId,
            reviverName: s.localCallsign,
            targetId: clientRevivingId,
            dt: sendDt,
          });
        }
      } else if (this.reviveTickAccum > 0 && this.reviveTickTargetId) {
        CoopManager.sendToHost({
          type: 'cmd_revive_tick',
          reviverId: CoopManager.myPeerId,
          reviverName: s.localCallsign,
          targetId: this.reviveTickTargetId,
          dt: +this.reviveTickAccum.toFixed(3),
        });
        this.reviveTickAccum = 0;
        this.reviveTickTargetId = '';
        this.reviveTickTimer = 0;
      }
    }

    if (CoopManager.role === 'host' && p.downed && !p.spectating) {
      if (now - (this.lastReviveTickAt.get(CoopManager.myPeerId) || 0) > 480) {
        p.reviveProgress = Math.max(0, p.reviveProgress - dt * 0.32);
      }
    }
  }

  private advanceReviveOnHost(targetId: string, reviverId: string, reviverName: string, dt: number): void {
    const s = this.state;
    if (!s || CoopManager.role !== 'host') return;
    const now = performance.now();
    this.lastReviveTickAt.set(targetId, now);

    if (targetId === CoopManager.myPeerId) {
      const p = s.player;
      if (!p.downed || p.spectating) return;
      p.reviveProgress = Math.min(1, p.reviveProgress + dt / 2.2);
      if (p.reviveProgress >= 1) {
        this.reviveLocalPlayerFromWaveOrTeammate(reviverName);
        CoopManager.broadcastToClients({
          type: 'evt_player_revived',
          targetId,
          reviverId,
          reviverName,
        });
        if (reviverId !== CoopManager.myPeerId) {
          CoopManager.sendToClient(reviverId, {
            type: 'evt_team_reward',
            targetId: reviverId,
            cashDelta: 65,
          });
        }
      }
      return;
    }

    const rp = s.remotePlayers.find((item) => item.peerId === targetId);
    if (!rp || !rp.downed || rp.spectating) return;
    rp.reviveProgress = Math.min(1, rp.reviveProgress + dt / 2.2);
    if (rp.reviveProgress >= 1) {
      rp.downed = false;
      rp.spectating = false;
      rp.reviveProgress = 0;
      rp.bleedoutTimer = 0;
      rp.hp = Math.round(rp.maxHp * 0.55);
      rp.invulnTimer = 3.2;
      this.reviveSyncGraceUntil.set(rp.peerId, now + 2200);
      SoundFX.fanfare();
      this.spawnFloatingText(rp.x, rp.y - 36, I18n.t('ftRescuedAlly', { name: rp.callsign }), '#4ade80', 1.2);
      CoopManager.broadcastToClients({
        type: 'evt_player_revived',
        targetId: rp.peerId,
        reviverId,
        reviverName,
      });
      if (reviverId === CoopManager.myPeerId) {
        s.cash += 65;
        this.spawnFloatingText(s.player.x, s.player.y - 24, I18n.t('ftRescueBonus'), '#fde047', 1.1);
      } else {
        CoopManager.sendToClient(reviverId, {
          type: 'evt_team_reward',
          targetId: reviverId,
          cashDelta: 65,
        });
      }
    }
  }

  private checkCoopSquadWipe(): void {
    const s = this.state;
    if (!s || !s.isCoop || CoopManager.role !== 'host' || s.waveState === 'ended') return;
    const hostOut = s.player.downed || s.player.spectating || s.player.hp <= 0;
    const allMatesOut = s.remotePlayers.every((rp) => rp.downed || rp.spectating || rp.hp <= 0);
    if (hostOut && allMatesOut) {
      s.waveState = 'ended';
      PlatformSDK.gameplayStop();
      if (s.mode === 'endless') {
        SaveManager.recordEndlessWave(s.stage.id, s.wave);
      }
      this.flushRunTelemetry(false);
      CoopManager.broadcastToClients({ type: 'evt_run_finished', victory: false });
      this.callbacks.onRunFinished(false, s);
    }
  }

  private updateClientInteractions(dt: number): void {
    const s = this.state!;
    const p = s.player;
    if (p.downed || p.spectating) {
      p.repairProgress = 0;
      return;
    }
    const pStats = SaveManager.getEffectivePlayerStats();

    // 1. 客机修窗：读条完成后向房主发送修补请求（合金电击窗升级已移至军火库【补给】页签）
    let repairingAny = false;
    for (const win of s.windows) {
      const room = s.rooms.find((r) => r.id === win.roomId);
      if (!room?.unlocked || win.planks >= win.maxPlanks) continue;
      const cx = win.x + win.w / 2;
      const cy = win.y + win.h / 2;
      if (Math.hypot(p.x - cx, p.y - cy) <= 82) {
        if (win.planks === 0 && win.armorPlanks <= 0 && this.hasZombieVaultingWindow(win)) continue;
        repairingAny = true;
        p.repairProgress += dt * 1.35 * pStats.repairSpeedMultiplier;
        if (p.repairProgress >= 1) {
          p.repairProgress = 0;
          win.planks = Math.min(win.maxPlanks, win.planks + 1);
          SoundFX.repair();
          SaveManager.addDailyProgress('repairs', 1);
          CoopManager.sendToHost({
            type: 'cmd_repair_win',
            ownerId: CoopManager.myPeerId,
            winId: win.id,
          });
        }
        break;
      }
    }
    if (!repairingAny) p.repairProgress = 0;

    // 2. 客机合资开门
    for (const door of s.doors) {
      if (door.unlocked) continue;
      const cx = door.x + door.w / 2;
      const cy = door.y + door.h / 2;
      const needed = Math.max(0, door.cost - door.paidAmount);
      if (Math.hypot(p.x - cx, p.y - cy) <= 74 && needed > 0 && s.cash >= Math.min(50, needed)) {
        door.progress += dt * 1.65;
        if (door.progress >= 1) {
          door.progress = 0;
          const pay = Math.min(s.cash, needed);
          s.cash -= pay;
          CoopManager.sendToHost({
            type: 'cmd_fund_door',
            ownerId: CoopManager.myPeerId,
            doorId: door.id,
            amount: pay,
          });
        }
      } else {
        door.progress = Math.max(0, door.progress - dt * 2.5);
      }
    }

    // 3. 客机开启战术空投宝箱
    for (let i = s.chests.length - 1; i >= 0; i--) {
      const c = s.chests[i];
      if (Math.hypot(p.x - c.x, p.y - c.y) <= 56) {
        c.progress += dt * 1.8;
        if (c.progress >= 1) {
          c.progress = 0;
          CoopManager.sendToHost({
            type: 'cmd_open_chest',
            ownerId: CoopManager.myPeerId,
            chestId: c.id,
          });
          s.chests.splice(i, 1);
          break;
        }
      } else {
        c.progress = Math.max(0, c.progress - dt * 2);
      }
    }

    // 4. 客机使用房间战术站点
    for (const st of s.stations) {
      const room = s.rooms.find((r) => r.id === st.roomId);
      if (!room?.unlocked) continue;
      if (st.used && (st.type === 'starter_airdrop' || st.type === 'mech_dog_cage')) continue;
      if (st.type === 'laser_trap' && st.activeTimer > 0) continue;

      const dist = Math.hypot(p.x - st.x, p.y - st.y);
      const canAfford = st.type === 'starter_airdrop' || st.type === 'armory_kiosk' || s.cash >= st.cost;
      if (dist <= 42 && canAfford && this.canUseStation(st)) {
        st.progress += dt * 1.65;
        if (st.progress >= 1) {
          st.progress = 0;
          if (st.type === 'mech_dog_cage' || st.type === 'laser_trap') {
            s.cash -= st.cost;
            CoopManager.sendToHost({
              type: 'cmd_use_station',
              ownerId: CoopManager.myPeerId,
              stationId: st.id,
            });
          } else {
            this.triggerStation(st);
          }
        }
      } else {
        st.progress = Math.max(0, st.progress - dt * 2.5);
      }
    }
  }

  private updateClientWorldVisuals(dt: number): void {
    const s = this.state!;

    for (const z of s.zombies) {
      z.wobblePhase += dt * (z.kind === 'runner' ? 11 : 7.5);
      if (z.hitFlash > 0) z.hitFlash = Math.max(0, z.hitFlash - dt);
      if (z.attackAnim > 0) z.attackAnim = Math.max(0, z.attackAnim - dt * 4.8);
      if (z.netTx !== undefined && z.netTy !== undefined) {
        const age = z.extrapAge ?? 0;
        if ((z.vx !== 0 || z.vy !== 0) && age < 0.15) {
          const step = Math.min(dt, 0.15 - age);
          z.extrapAge = age + step;
          const nx = z.netTx + z.vx * step;
          const ny = z.netTy + z.vy * step;
          if (!z.insideBuilding || !this.findBlockingWallOrLockedDoor(nx, ny, z.radius * 0.65)) {
            z.netTx = nx;
            z.netTy = ny;
          }
        }
        const err = Math.hypot(z.netTx - z.x, z.netTy - z.y);
        const zLerp = Math.min(1, dt * (err > 75 ? 19 : 13));
        z.x += (z.netTx - z.x) * zLerp;
        z.y += (z.netTy - z.y) * zLerp;
      }
    }

    for (let i = s.bullets.length - 1; i >= 0; i--) {
      const b = s.bullets[i];
      b.life -= dt;
      if (b.life <= 0) {
        s.bullets.splice(i, 1);
        continue;
      }
      const nx = b.x + b.vx * dt;
      const ny = b.y + b.vy * dt;
      if (this.findBulletBlocker(nx, ny, b.radius)) {
        if (b.bouncesLeft > 0) {
          b.bouncesLeft -= 1;
          if (this.findBulletBlocker(nx, b.y, b.radius)) b.vx = -b.vx;
          else b.vy = -b.vy;
          b.x += b.vx * dt;
          b.y += b.vy * dt;
        } else {
          this.spawnHitSparks(b.x, b.y, b.color, 3);
          s.bullets.splice(i, 1);
        }
        continue;
      }
      b.x = nx;
      b.y = ny;
      for (const z of s.zombies) {
        if (b.hitIds.has(z.id)) continue;
        if (Math.hypot(b.x - z.x, b.y - z.y) <= z.radius + b.radius) {
          b.hitIds.add(z.id);
          z.hitFlash = 0.08;
          this.spawnHitSparks(b.x, b.y, b.color, 3);
          if (b.pierceLeft > 0) b.pierceLeft -= 1;
          else {
            s.bullets.splice(i, 1);
            break;
          }
        }
      }
    }

    for (let i = s.grenadesThrown.length - 1; i >= 0; i--) {
      const g = s.grenadesThrown[i];
      g.fuse -= dt;
      g.vz -= 520 * dt;
      g.z += g.vz * dt;
      if (g.z <= 0) {
        g.z = 0;
        g.vz = Math.abs(g.vz) * 0.45;
        g.vx *= 0.65;
        g.vy *= 0.65;
      }
      g.spinAngle += dt * 9;
      const nx = g.x + g.vx * dt;
      const ny = g.y + g.vy * dt;
      if (this.findBlockingWallOrLockedDoor(nx, g.y, 8)) g.vx = -g.vx * 0.6;
      else g.x = nx;
      if (this.findBlockingWallOrLockedDoor(g.x, ny, 8)) g.vy = -g.vy * 0.6;
      else g.y = ny;
      if (g.fuse <= 0) {
        s.grenadesThrown.splice(i, 1);
      }
    }

    for (let i = s.spits.length - 1; i >= 0; i--) {
      const sp = s.spits[i];
      sp.life -= dt;
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      if (sp.life <= 0 || this.findBulletBlocker(sp.x, sp.y, sp.radius)) {
        s.spits.splice(i, 1);
      }
    }

    for (let i = s.acidPools.length - 1; i >= 0; i--) {
      s.acidPools[i].life -= dt;
      if (s.acidPools[i].life <= 0) {
        s.acidPools.splice(i, 1);
      }
    }
  }

  private buildLocalPlayerSync(): PlayerSyncPayload {
    const s = this.state!;
    const p = s.player;
    const activeWep = p.weapons[p.activeSlot] || p.weapons[0];
    return {
      seq: ++this.playerSyncSeq,
      peerId: CoopManager.myPeerId,
      slot: s.localSlot,
      callsign: s.localCallsign,
      color: SQUAD_SLOTS[s.localSlot]?.color || '#38bdf8',
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      vx: Math.round(this.localPlayerVx),
      vy: Math.round(this.localPlayerVy),
      angle: +p.angle.toFixed(2),
      legAngle: +p.legAngle.toFixed(2),
      walkPhase: +p.walkPhase.toFixed(2),
      isMoving: p.isMoving,
      hp: Math.round(p.hp),
      maxHp: Math.round(p.maxHp),
      armor: Math.round(p.armor),
      downed: p.downed,
      spectating: p.spectating,
      bleedoutTimer: +p.bleedoutTimer.toFixed(1),
      reviveProgress: +p.reviveProgress.toFixed(2),
      activeWepId: activeWep.defId,
      evolved: activeWep.evolved,
      muzzleFlash: p.muzzleFlashTimer > 0,
      recoilOffset: +p.recoilOffset.toFixed(1),
      repairProgress: +p.repairProgress.toFixed(2),
      invuln: p.invulnTimer > 0,
      cash: Math.round(s.cash),
      kills: s.kills,
    };
  }

  private buildAllPlayersSync(): PlayerSyncPayload[] {
    const s = this.state!;
    return [
      this.buildLocalPlayerSync(),
      ...s.remotePlayers.map((rp) => ({
        seq: rp.lastSeq,
        peerId: rp.peerId,
        slot: rp.slot,
        callsign: rp.callsign,
        color: rp.color,
        x: Math.round(rp.netTx * 10) / 10,
        y: Math.round(rp.netTy * 10) / 10,
        vx: Math.round(rp.vx),
        vy: Math.round(rp.vy),
        angle: +rp.netAngle.toFixed(2),
        legAngle: +rp.legAngle.toFixed(2),
        walkPhase: +rp.walkPhase.toFixed(2),
        isMoving: rp.isMoving,
        hp: Math.round(rp.hp),
        maxHp: Math.round(rp.maxHp),
        armor: Math.round(rp.armor),
        downed: rp.downed,
        spectating: rp.spectating,
        bleedoutTimer: +rp.bleedoutTimer.toFixed(1),
        reviveProgress: +rp.reviveProgress.toFixed(2),
        activeWepId: rp.activeWepId,
        evolved: rp.evolved,
        muzzleFlash: rp.muzzleFlashTimer > 0,
        recoilOffset: +rp.recoilOffset.toFixed(1),
        repairProgress: +rp.repairProgress.toFixed(2),
        invuln: rp.invulnTimer > 0,
        cash: Math.round(rp.cash),
        kills: rp.kills,
      })),
    ];
  }

  private buildWorldSyncPayload(): WorldSyncPayload {
    const s = this.state!;
    const allPlayers = this.buildAllPlayersSync();

    return {
      seq: ++this.worldSyncSeq,
      wave: s.wave,
      waveState: s.waveState,
      intermissionTimer: +s.intermissionTimer.toFixed(1),
      extractionProgress: +s.extractionProgress.toFixed(3),
      zombiesRemainingInWave: s.zombiesRemainingInWave,
      kills: s.kills,
      fever: Math.round(s.fever),
      feverTimer: +s.feverTimer.toFixed(1),
      electricFortifyWaves: s.electricFortifyWaves,
      powerUpTimers: { ...s.powerUpTimers },
      squadCount: s.squadCount,
      wins: s.windows.map((w) => (w.planks & 15) | ((w.armorPlanks & 15) << 4)),
      doors: s.doors.map((d) => [d.unlocked ? 1 : 0, d.paidAmount, Math.round(d.progress * 100)]),
      stations: s.stations.map((st) => [
        st.used ? 1 : 0,
        Math.round(st.progress * 100),
        Math.round(st.activeTimer * 10),
      ]),
      barrels: s.barrels.map((b) => (b.alive ? 1 : 0)),
      chests: s.chests.map((c) => [c.id, Math.round(c.x), Math.round(c.y), c.roomId, Math.round(c.progress * 100)]),
      turrets: s.turrets.map((t) => [Math.round(t.x), Math.round(t.y), +t.angle.toFixed(2), +t.life.toFixed(1)]),
      mechDog: [
        s.mechDog.active ? 1 : 0,
        Math.round(s.mechDog.x),
        Math.round(s.mechDog.y),
        +s.mechDog.angle.toFixed(2),
      ],
      zombies: s.zombies.map((z) => [
        z.id,
        z.kind,
        Math.round(z.x),
        Math.round(z.y),
        Math.round(z.vx),
        Math.round(z.vy),
        Math.round(z.hp),
        Math.round(z.maxHp),
        +z.facingAngle.toFixed(2),
        z.attackState,
        z.attackAnim > 0.01 ? +z.attackAnim.toFixed(2) : 0,
        z.attackState !== 'none' || z.attackAnim > 0.01 ? +z.slashAngle.toFixed(2) : 0,
        (z.hitFlash > 0 ? 1 : 0) |
          (z.burnTimer > 0 ? 2 : 0) |
          (z.slowTimer > 0 ? 4 : 0) |
          (z.insideBuilding ? 8 : 0),
        z.fleeTimer > 0.05 ? +z.fleeTimer.toFixed(1) : 0,
      ]),
      spits: s.spits.map((sp) => [
        Math.round(sp.x),
        Math.round(sp.y),
        Math.round(sp.vx),
        Math.round(sp.vy),
        sp.radius,
        sp.projKind === 'saw'
          ? 1
          : sp.projKind === 'cryo'
            ? 2
            : sp.projKind === 'shock'
              ? 3
              : sp.projKind === 'fire'
                ? 4
                : 0,
      ]),
      pools: s.acidPools.map((ap) => [
        Math.round(ap.x),
        Math.round(ap.y),
        ap.radius,
        +ap.life.toFixed(1),
        ap.isBoss ? 1 : 0,
      ]),
      drops: s.drops.map((dr) => [
        dr.id,
        dr.kind,
        dr.powerUp || '',
        dr.value,
        Math.round(dr.x),
        Math.round(dr.y),
        +dr.life.toFixed(1),
      ]),
      players: allPlayers,
    };
  }

  private applyWorldSyncPayload(w: WorldSyncPayload): void {
    const s = this.state;
    if (!s || CoopManager.role !== 'client') return;
    if (w.seq <= this.lastAppliedWorldSeq) return;
    this.lastAppliedWorldSeq = w.seq;

    const prevWave = s.wave;
    s.wave = w.wave;
    s.waveState = w.waveState;
    s.intermissionTimer = w.intermissionTimer;
    s.extractionProgress = w.extractionProgress;
    s.zombiesRemainingInWave = w.zombiesRemainingInWave;
    s.kills = w.kills;
    s.fever = w.fever;
    s.feverTimer = w.feverTimer;
    s.electricFortifyWaves = w.electricFortifyWaves;
    s.powerUpTimers = { ...w.powerUpTimers };
    s.squadCount = w.squadCount;

    if (w.wave > prevWave) {
      this.onWaveSurvivedLocal(prevWave);
      // 推进临时空投武器波数寿命
      for (let i = s.player.weapons.length - 1; i >= 0; i--) {
        const pw = s.player.weapons[i];
        if (pw.tempWavesLeft !== undefined) {
          pw.tempWavesLeft -= 1;
          if (pw.tempWavesLeft <= 0 && s.player.weapons.length > 1) {
            s.player.weapons.splice(i, 1);
            s.player.activeSlot = Math.min(s.player.activeSlot, s.player.weapons.length - 1);
          }
        }
      }
    }

    w.wins.forEach((packed, idx) => {
      const win = s.windows[idx];
      if (win) {
        win.planks = packed & 15;
        win.armorPlanks = (packed >> 4) & 15;
      }
    });

    let doorOpened = false;
    w.doors.forEach(([unlocked, paidAmount], idx) => {
      const door = s.doors[idx];
      if (!door) return;
      door.paidAmount = paidAmount;
      if (unlocked && !door.unlocked) {
        door.unlocked = true;
        doorOpened = true;
        const rmU = s.rooms.find((r) => r.id === door.unlockRoomId);
        if (rmU) rmU.unlocked = true;
        const rmA = s.rooms.find((r) => r.id === door.roomA);
        if (rmA) rmA.unlocked = true;
        const rmB = s.rooms.find((r) => r.id === door.roomB);
        if (rmB) rmB.unlocked = true;
      }
    });
    if (w.waveState === 'extraction') {
      const yard = s.rooms.find((r) => r.id === 'courtyard');
      if (yard && !yard.unlocked) {
        s.rooms.forEach((rm) => (rm.unlocked = true));
        s.doors.forEach((d) => (d.unlocked = true));
        doorOpened = true;
      }
    }
    if (doorOpened) {
      s.mapRevision += 1;
      this.rebuildWalkableMask();
    }

    w.stations.forEach(([used, _prog, activeTenths], idx) => {
      const st = s.stations[idx];
      if (!st) return;
      if (st.type === 'mech_dog_cage' || st.type === 'laser_trap') {
        st.used = Boolean(used);
      }
      st.activeTimer = activeTenths / 10;
    });

    w.barrels.forEach((alive, idx) => {
      if (s.barrels[idx]) s.barrels[idx].alive = Boolean(alive);
    });

    s.chests = w.chests.map(([id, cx, cy, roomId, progPct]) => {
      const prev = s.chests.find((item) => item.id === id);
      return {
        id,
        x: cx,
        y: cy,
        roomId,
        progress: prev ? prev.progress : progPct / 100,
        bobPhase: prev ? prev.bobPhase : 0,
      };
    });

    s.turrets = w.turrets.map(([tx, ty, tang, tlife]) => ({
      x: tx,
      y: ty,
      angle: tang,
      fireCd: 0,
      life: tlife,
    }));

    s.mechDog.active = Boolean(w.mechDog[0]);
    s.mechDog.x = w.mechDog[1];
    s.mechDog.y = w.mechDog[2];
    s.mechDog.angle = w.mechDog[3];

    // 同步僵尸列表并保持平滑插值目标
    const existingZ = new Map<number, ZombieEntity>();
    for (const z of s.zombies) existingZ.set(z.id, z);

    const nextZombies: ZombieEntity[] = [];
    const incomingIds = new Set<number>();
    for (const tup of w.zombies) {
      const [id, kind, zx, zy, zvx, zvy, hp, maxHp, facing, atkState, atkAnim, slashAng, flags, fleeTimer] = tup;
      incomingIds.add(id);
      const prev = existingZ.get(id);
      if (prev) {
        prev.netTx = zx;
        prev.netTy = zy;
        prev.vx = zvx;
        prev.vy = zvy;
        prev.extrapAge = 0;
        if (Math.hypot(zx - prev.x, zy - prev.y) > 380) {
          prev.x = zx;
          prev.y = zy;
        }
        prev.hp = hp;
        prev.maxHp = maxHp;
        prev.facingAngle = facing;
        prev.attackState = atkState;
        prev.attackAnim = Math.max(prev.attackAnim, atkAnim);
        if (atkState !== 'none' || atkAnim > 0.01) {
          prev.slashAngle = slashAng;
        }
        if (flags & 1) prev.hitFlash = 0.08;
        prev.burnTimer = flags & 2 ? 0.5 : 0;
        prev.slowTimer = flags & 4 ? 0.5 : 0;
        prev.insideBuilding = Boolean(flags & 8);
        prev.fleeTimer = fleeTimer;
        nextZombies.push(prev);
      } else {
        nextZombies.push({
          id,
          kind,
          x: zx,
          y: zy,
          netTx: zx,
          netTy: zy,
          extrapAge: 0,
          vx: zvx,
          vy: zvy,
          radius: ZOMBIE_RADIUS_BY_KIND[kind] || 24,
          hp,
          maxHp,
          speed: 120,
          damage: 18,
          cashReward: 10,
          xpReward: 10,
          color: ZOMBIE_COLOR_BY_KIND[kind] || '#4ade80',
          targetWindowId: null,
          insideBuilding: Boolean(flags & 8),
          hitFlash: flags & 1 ? 0.08 : 0,
          burnTimer: flags & 2 ? 0.5 : 0,
          slowTimer: flags & 4 ? 0.5 : 0,
          stunTimer: 0,
          attackCd: 0,
          rangedCd: 0,
          fleeTimer,
          wobblePhase: Math.random() * Math.PI * 2,
          facingAngle: facing,
          attackAnim: atkAnim,
          attackState: atkState,
          attackStateTimer: 0,
          slashAngle: slashAng,
          recoilVx: 0,
          recoilVy: 0,
        });
      }
    }

    // 被击杀消失的僵尸在客机生成血迹火花反馈
    for (const [oldId, oldZ] of existingZ) {
      if (!incomingIds.has(oldId)) {
        this.spawnHitSparks(oldZ.x, oldZ.y, oldZ.color, 6);
        if (s.decals.length > 52) s.decals.shift();
        s.decals.push({
          x: oldZ.x,
          y: oldZ.y,
          radius: oldZ.radius * 0.95,
          color: 'rgba(34, 197, 94, 0.32)',
          life: 7,
          maxLife: 7,
          seed: Math.random() * 10,
        });
      }
    }
    s.zombies = nextZombies;

    s.spits = w.spits.map(([sx, sy, svx, svy, sr, pk]) => ({
      x: sx,
      y: sy,
      vx: svx,
      vy: svy,
      radius: sr,
      damage: 15,
      life: 0.35,
      projKind: pk === 1 ? 'saw' : pk === 2 ? 'cryo' : pk === 3 ? 'shock' : pk === 4 ? 'fire' : 'acid',
    }));

    s.acidPools = w.pools.map(([px, py, pr, plife, isB]) => ({
      x: px,
      y: py,
      radius: pr,
      life: plife,
      maxLife: isB ? 3.8 : 3.2,
      isBoss: Boolean(isB),
    }));

    s.drops = w.drops.map(([id, kind, pow, val, dx, dy, dlife]) => ({
      id,
      kind,
      powerUp: pow || undefined,
      value: val,
      x: dx,
      y: dy,
      life: dlife,
      bobPhase: (id % 6) * 0.9,
    }));

    // 同步所有队友状态（含本机被救援进度）
    for (const ps of w.players) {
      if (ps.peerId === CoopManager.myPeerId) {
        if (s.player.downed) {
          s.player.reviveProgress = ps.reviveProgress;
        }
        continue;
      }
      this.upsertRemotePlayer(ps);
    }
  }

  private upsertRemotePlayer(ps: PlayerSyncPayload): void {
    const s = this.state;
    if (!s) return;
    let rp = s.remotePlayers.find((item) => item.peerId === ps.peerId);
    if (!rp) {
      rp = {
        peerId: ps.peerId,
        slot: ps.slot,
        callsign: ps.callsign,
        color: ps.color,
        x: ps.x,
        y: ps.y,
        netTx: ps.x,
        netTy: ps.y,
        vx: ps.vx,
        vy: ps.vy,
        extrapAge: 0,
        lastSeq: ps.seq || 0,
        angle: ps.angle,
        netAngle: ps.angle,
        legAngle: ps.legAngle,
        walkPhase: ps.walkPhase,
        isMoving: ps.isMoving,
        hp: ps.hp,
        maxHp: ps.maxHp,
        armor: ps.armor,
        maxArmor: 100,
        downed: ps.downed,
        spectating: ps.spectating,
        bleedoutTimer: ps.bleedoutTimer,
        reviveProgress: ps.reviveProgress,
        activeWepId: ps.activeWepId,
        evolved: ps.evolved,
        muzzleFlashTimer: ps.muzzleFlash ? 0.07 : 0,
        recoilOffset: ps.recoilOffset,
        repairProgress: ps.repairProgress,
        hitFlashTimer: 0,
        invulnTimer: ps.invuln ? 0.2 : 0,
        cash: ps.cash,
        kills: ps.kills,
      };
      s.remotePlayers.push(rp);
      s.remotePlayers.sort((a, b) => a.slot - b.slot);
      return;
    }

    // 严格拒绝乱序旧包，彻底杜绝队友身位往返瞬移乱跳！
    if (ps.seq && rp.lastSeq && ps.seq < rp.lastSeq) {
      return;
    }
    if (CoopManager.role === 'host' && ps.seq && rp.lastSeq && ps.seq <= rp.lastSeq) {
      return;
    }

    const isFreshSample = !ps.seq || ps.seq > rp.lastSeq;
    if (ps.seq && ps.seq > rp.lastSeq) {
      rp.lastSeq = ps.seq;
    }

    rp.callsign = ps.callsign;
    if (isFreshSample) {
      rp.netTx = ps.x;
      rp.netTy = ps.y;
      rp.vx = ps.vx;
      rp.vy = ps.vy;
      rp.extrapAge = 0;
      if (Math.hypot(ps.x - rp.x, ps.y - rp.y) > 480) {
        rp.x = ps.x;
        rp.y = ps.y;
      }
      rp.netAngle = ps.angle;
      rp.legAngle = ps.legAngle;
      rp.isMoving = ps.isMoving;
      rp.activeWepId = ps.activeWepId;
      rp.evolved = ps.evolved;
      if (ps.muzzleFlash) rp.muzzleFlashTimer = 0.07;
      rp.recoilOffset = Math.max(rp.recoilOffset, ps.recoilOffset);
      rp.repairProgress = ps.repairProgress;
    }

    rp.maxHp = ps.maxHp;
    rp.armor = ps.armor;

    // 刚被扶起后的 2.2 秒保护窗口内，屏蔽网络在途旧 player_sync 包把队友重新覆盖回倒地/0血状态！
    const graceUntil = CoopManager.role === 'host' ? this.reviveSyncGraceUntil.get(rp.peerId) || 0 : 0;
    if (graceUntil > performance.now()) {
      if (!ps.downed && !ps.spectating && ps.hp > 0) {
        this.reviveSyncGraceUntil.delete(rp.peerId);
        rp.hp = ps.hp;
        rp.downed = false;
        rp.spectating = false;
        rp.bleedoutTimer = 0;
      }
    } else {
      rp.hp = ps.hp;
      rp.downed = ps.downed;
      rp.spectating = ps.spectating;
      rp.bleedoutTimer = ps.bleedoutTimer;
    }

    if (CoopManager.role === 'client') {
      if (this.reviveTickTargetId === rp.peerId && rp.downed) {
        rp.reviveProgress = Math.max(rp.reviveProgress, ps.reviveProgress);
      } else {
        rp.reviveProgress = ps.reviveProgress;
      }
    }
    rp.cash = ps.cash;
    rp.kills = ps.kills;
  }

  private handleCoopMessage(msg: CoopNetMessage, _fromPeerId: string): void {
    const s = this.state;
    if (!s || !s.isCoop) return;

    if (msg.type === 'player_sync' && CoopManager.role === 'host') {
      this.upsertRemotePlayer(msg.p);
      return;
    }

    if (msg.type === 'players_fast' && CoopManager.role === 'client') {
      for (const ps of msg.list) {
        if (ps.peerId === CoopManager.myPeerId) {
          if (s.player.downed) {
            s.player.reviveProgress = ps.reviveProgress;
          }
          continue;
        }
        this.upsertRemotePlayer(ps);
      }
      return;
    }

    if (msg.type === 'world_sync' && CoopManager.role === 'client') {
      this.applyWorldSyncPayload(msg.w);
      return;
    }

    if (msg.type === 'cmd_fire') {
      if (msg.ownerId === CoopManager.myPeerId) return;
      const rp = s.remotePlayers.find((item) => item.peerId === msg.ownerId);
      if (rp) {
        rp.muzzleFlashTimer = 0.07;
        rp.recoilOffset = 6.5;
      }
      for (const b of msg.bullets) {
        if (s.bullets.length >= 185) s.bullets.shift();
        s.bullets.push({
          ...b,
          hitIds: new Set(),
          localVisualOnly: CoopManager.role === 'client',
        });
      }
      if (CoopManager.role === 'host') {
        CoopManager.broadcastToClients(msg, msg.ownerId);
      }
      return;
    }

    if (msg.type === 'cmd_grenade') {
      if (msg.ownerId === CoopManager.myPeerId) return;
      s.grenadesThrown.push({ ...msg.g, spinAngle: 0 });
      if (CoopManager.role === 'host') {
        CoopManager.broadcastToClients(msg, msg.ownerId);
      }
      return;
    }

    if (msg.type === 'cmd_repair_win' && CoopManager.role === 'host') {
      const win = s.windows.find((w) => w.id === msg.winId);
      if (win && win.planks < win.maxPlanks) {
        win.planks += 1;
        this.pushOutdoorZombiesOutsidePlanks(win);
        SoundFX.repair();
        const maxPaidRepairs = 6 * s.squadCount;
        if (s.repairsPaidThisWave < maxPaidRepairs) {
          s.repairsPaidThisWave += 1;
          CoopManager.sendToClient(msg.ownerId, {
            type: 'evt_team_reward',
            targetId: msg.ownerId,
            cashDelta: 8,
          });
        }
      }
      return;
    }

    if (msg.type === 'cmd_fortify_win' && CoopManager.role === 'host') {
      const targets =
        msg.winId === 'ALL'
          ? s.windows.filter((w) => s.rooms.find((r) => r.id === w.roomId)?.unlocked)
          : s.windows.filter((w) => w.id === msg.winId);
      for (const win of targets) {
        win.planks = win.maxPlanks;
        win.armorPlanks = win.maxPlanks;
        this.pushOutdoorZombiesOutsidePlanks(win);
      }
      if (targets.length > 0) {
        SoundFX.fanfare();
        const ftMsg = I18n.t('ftWinFortified');
        this.spawnFloatingText(s.player.x, s.player.y - 26, ftMsg, '#38bdf8', 1.12);
        CoopManager.broadcastToClients(
          {
            type: 'evt_fx',
            kind: 'floating',
            x: s.player.x,
            y: s.player.y - 26,
            text: ftMsg,
            color: '#38bdf8',
            scale: 1.12,
          },
          msg.ownerId
        );
      }
      return;
    }

    if (msg.type === 'cmd_fund_door' && CoopManager.role === 'host') {
      const door = s.doors.find((d) => d.id === msg.doorId);
      if (door && !door.unlocked) {
        this.applyDoorFunding(door, msg.amount, msg.ownerId);
      } else if (door && door.unlocked) {
        // 门刚被队友开完则全额退还
        CoopManager.sendToClient(msg.ownerId, {
          type: 'evt_team_reward',
          targetId: msg.ownerId,
          cashDelta: msg.amount,
        });
      }
      return;
    }

    if (msg.type === 'cmd_open_chest' && CoopManager.role === 'host') {
      const idx = s.chests.findIndex((c) => c.id === msg.chestId);
      if (idx >= 0) {
        const c = s.chests[idx];
        s.chests.splice(idx, 1);
        this.grantChestRelicInline(c.x, c.y);
        CoopManager.broadcastToClients({ type: 'evt_team_reward', grantChestRelic: true });
      }
      return;
    }

    if (msg.type === 'cmd_use_station' && CoopManager.role === 'host') {
      const st = s.stations.find((item) => item.id === msg.stationId);
      if (!st) return;
      if (st.type === 'mech_dog_cage' && !st.used) {
        st.used = true;
        s.mechDog.active = true;
        s.mechDog.x = st.x;
        s.mechDog.y = st.y;
        SoundFX.fanfare();
        this.spawnFloatingText(st.x, st.y - 34, I18n.t('ftMechDog'), '#7dd3fc', 1.2);
      } else if (st.type === 'laser_trap' && st.activeTimer <= 0) {
        st.activeTimer = 18;
        SoundFX.alarm();
        this.spawnFloatingText(st.x, st.y - 34, I18n.t('ftLaserOn'), '#f87171', 1.15);
      }
      return;
    }

    if (msg.type === 'cmd_deploy_turret' && CoopManager.role === 'host') {
      s.turrets.push({ x: msg.x, y: msg.y, angle: 0, fireCd: 0, life: msg.life });
      return;
    }

    if (msg.type === 'cmd_electric_fortify' && CoopManager.role === 'host') {
      s.electricFortifyWaves = 2;
      for (const win of s.windows) {
        win.planks = win.maxPlanks;
        this.pushOutdoorZombiesOutsidePlanks(win);
      }
      const bText = I18n.t('bannerAllyElec');
      this.showBanner(bText, 3.2);
      CoopManager.broadcastToClients({ type: 'evt_fx', kind: 'banner', text: bText, dur: 3.2 }, msg.ownerId);
      return;
    }

    if (msg.type === 'cmd_revive_tick' && CoopManager.role === 'host') {
      this.advanceReviveOnHost(msg.targetId, msg.reviverId, msg.reviverName, msg.dt);
      return;
    }

    if (msg.type === 'evt_fx' && CoopManager.role === 'client') {
      if (msg.kind === 'explode' && msg.x !== undefined && msg.y !== undefined && msg.radius !== undefined) {
        this.spawnExplosionVisuals(msg.x, msg.y, msg.radius);
      } else if (msg.kind === 'lightning' && msg.points) {
        if (s.lightnings.length >= 18) s.lightnings.shift();
        s.lightnings.push({ points: msg.points, color: msg.color || '#38bdf8', life: 0.18 });
      } else if (msg.kind === 'floating' && msg.x !== undefined && msg.y !== undefined && msg.text) {
        this.spawnFloatingText(msg.x, msg.y, msg.text, msg.color || '#fde047', msg.scale || 1);
      } else if (msg.kind === 'banner' && msg.text) {
        this.showBanner(msg.text, msg.dur || 2.6);
      }
      return;
    }

    if (msg.type === 'evt_player_hit' && msg.targetId === CoopManager.myPeerId) {
      this.damagePlayer(msg.damage);
      return;
    }

    if (msg.type === 'evt_player_revived') {
      if (msg.targetId === CoopManager.myPeerId) {
        this.reviveLocalPlayerFromWaveOrTeammate(msg.reviverName);
      } else {
        const rp = s.remotePlayers.find((item) => item.peerId === msg.targetId);
        if (rp) {
          rp.downed = false;
          rp.spectating = false;
          rp.reviveProgress = 0;
          this.spawnFloatingText(rp.x, rp.y - 36, I18n.t('ftAllySaved', { name: rp.callsign }), '#4ade80', 1.15);
        }
      }
      return;
    }

    if (msg.type === 'evt_team_reward') {
      if (msg.targetId && msg.targetId !== CoopManager.myPeerId) return;
      if (msg.waveAutoRevive) {
        this.reviveLocalPlayerFromWaveOrTeammate();
      }
      if (msg.cashDelta) {
        s.cash += msg.cashDelta;
        SoundFX.coin();
        this.spawnFloatingText(s.player.x, s.player.y - 24, `+$${msg.cashDelta}`, '#4ade80', 1.05);
      }
      if (msg.xpDelta) {
        this.addBattleXpLocal(msg.xpDelta);
      }
      if (msg.healRatio && !s.player.downed && !s.player.spectating) {
        const pStats = SaveManager.getEffectivePlayerStats();
        const healAmt = Math.max(8, Math.round(s.player.maxHp * msg.healRatio * pStats.medDropHealMult));
        s.player.hp = Math.min(s.player.maxHp, s.player.hp + healAmt);
        this.spawnFloatingText(s.player.x, s.player.y - 28, I18n.t('ftMedDrop', { n: healAmt }), '#4ade80', 1.12);
      }
      if (msg.grantChestRelic) {
        this.grantChestRelicInline(s.player.x, s.player.y);
      }
      if (msg.powerUp) {
        const meta = POWERUP_META[msg.powerUp];
        const pName = I18n.powerupName(msg.powerUp, meta.name);
        SoundFX.fanfare();
        this.spawnFloatingText(s.player.x, s.player.y - 36, `${meta.icon} ${pName}!`, meta.color, 1.2);
        if (msg.powerUp === 'carpenter') {
          s.cash += 40;
        }
      }
      return;
    }

    if (msg.type === 'evt_run_finished' && CoopManager.role === 'client') {
      if (s.waveState === 'ended') return;
      s.waveState = 'ended';
      PlatformSDK.gameplayStop();
      if (msg.victory) {
        PlatformSDK.happyTime();
        SaveManager.markStageCleared(s.stage.id);
        SaveManager.addDailyProgress('clear', 1);
      } else if (s.mode === 'endless') {
        SaveManager.recordEndlessWave(s.stage.id, s.wave);
      }
      this.flushRunTelemetry(msg.victory);
      this.callbacks.onRunFinished(msg.victory, s);
    }
  }

  private handlePeerLeave(peerId: string): void {
    const s = this.state;
    if (!s || !s.isCoop || s.waveState === 'ended') return;

    if (peerId === 'host' && CoopManager.role === 'client') {
      this.showBanner(I18n.t('bannerHostDisc'), 4);
      s.waveState = 'ended';
      this.callbacks.onRunFinished(false, s);
      return;
    }

    const idx = s.remotePlayers.findIndex((rp) => rp.peerId === peerId);
    if (idx >= 0) {
      const leftName = s.remotePlayers[idx].callsign;
      s.remotePlayers.splice(idx, 1);
      s.squadCount = Math.max(1, 1 + s.remotePlayers.length);
      this.showBanner(I18n.t('bannerPeerLeft', { name: leftName }), 3.2);
      if (CoopManager.role === 'host') {
        this.checkCoopSquadWipe();
      }
    }
  }
}
