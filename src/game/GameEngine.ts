import { SoundFX } from '../audio/SoundFX';
import { IN_RUN_PERKS, POWERUP_META, RELICS } from '../data/perksAndRelics';
import { WEAPONS } from '../data/weapons';
import { SaveManager } from '../meta/SaveManager';
import { PlatformSDK } from '../platform/PlatformSDK';
import { GameMode, InRunPerkDef, PowerUpType, Rect, RelicDef, StageDef } from '../types';
import {
  DropItem,
  RunSnapshot,
  RuntimeStation,
  ZombieEntity,
  ZombieKind,
} from './Entities';
import { InputManager } from './InputManager';
import { CartoonRenderer } from './Renderer';

export interface EngineCallbacks {
  onToggleArmoryShop: () => void;
  onBattleLevelUp: (choices: InRunPerkDef[], onPick: (perk: InRunPerkDef) => void) => void;
  onOpenTreasureChest: (
    choices: RelicDef[],
    onPickOne: (relic: RelicDef) => void,
    onTakeAllAd: () => Promise<boolean>
  ) => void;
  onPlayerDowned: (canRevive: boolean) => void;
  onRunFinished: (victory: boolean, snapshot: RunSnapshot) => void;
}

export class GameEngine {
  public state: RunSnapshot | null = null;
  public paused = false;
  public modalPaused = false;
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

  constructor(
    private canvas: HTMLCanvasElement,
    private ctx: CanvasRenderingContext2D,
    public input: InputManager,
    private callbacks: EngineCallbacks
  ) {
    this.input.bindActions(
      () => this.switchWeapon(),
      () => this.startReload(),
      () => {
        if (this.state && this.state.waveState !== 'ended') {
          this.callbacks.onToggleArmoryShop();
        }
      },
      () => this.throwGrenade()
    );
  }

  public startRun(stage: StageDef, mode: GameMode): void {
    const pStats = SaveManager.getEffectivePlayerStats();
    const save = SaveManager.get();
    save.totalRuns += 1;
    SaveManager.save();

    const pistolDef = WEAPONS.pistol;
    this.nextEntityId = 1;
    this.deadZombieIds.clear();
    this.explosionDepth = 0;
    this.pendingModals = [];
    this.modalPaused = false;
    this.paused = false;

    this.state = {
      stage,
      mode,
      wave: 1,
      maxWaves: mode === 'standard' ? 10 : 9999,
      waveState: 'fighting',
      intermissionTimer: 0,
      extractionProgress: 0,
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
      powerUpTimers: {
        overdrive: 0,
        nuke: 0,
        carpenter: 0,
        double_cash: 0,
        freeze: 0,
      },
      player: {
        x: stage.playerSpawn.x,
        y: stage.playerSpawn.y,
        radius: 15,
        angle: 0,
        hp: pStats.maxHp,
        maxHp: pStats.maxHp,
        armor: 0,
        maxArmor: 100,
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
        grenades: 2,
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
      },
      mapRevision: 1,
      modifiers: {
        damageMult: pStats.agentDamageBonus,
        reloadMult: pStats.reloadMultiplier,
        magMult: 1,
        moveSpeedMult: 1,
        extraPierce: 0,
        extraPellets: 0,
        critChance: 0.05,
        repairHealRatio: 0,
        cashMult: 1,
      },
      relicIds: [],
      rooms: stage.rooms.map((r) => ({ ...r, unlocked: r.initiallyUnlocked })),
      windows: stage.windows.map((w) => ({
        ...w,
        planks: pStats.maxPlanks,
        maxPlanks: pStats.maxPlanks,
        attackCooldown: 0,
      })),
      doors: stage.doors.map((d) => ({ ...d, unlocked: false, progress: 0 })),
      props: stage.props,
      stations: stage.stations.map((s) => ({ ...s, used: false, progress: 0, activeTimer: 0 })),
      walls: stage.walls,
      barrels: stage.barrels.map((b) => ({ ...b, alive: true, respawnWaves: 0 })),
      zombies: [],
      bullets: [],
      grenadesThrown: [],
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
      bannerText: `🚨 第 1 波来袭！按 B 键或踩终端随时打开【军火商店】买枪！`,
      bannerTimer: 4.0,
      reviveUsed: false,
      hqSupportCooldown: 0,
      armoryAdCooldown: 0,
      camera: { x: stage.playerSpawn.x, y: stage.playerSpawn.y, zoom: 1.02, shake: 0 },
    };

    this.paused = false;
    this.modalPaused = false;
    this.rebuildWalkableMask();
    this.rebuildFlowField();
    this.prepareWave(1);
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
      const x0 = Math.max(0, Math.floor((pr.x - pr.w * 0.36) / G));
      const y0 = Math.max(0, Math.floor((pr.y - pr.h * 0.36) / G));
      const x1 = Math.min(cols - 1, Math.floor((pr.x + pr.w * 0.36) / G));
      const y1 = Math.min(rows - 1, Math.floor((pr.y + pr.h * 0.36) / G));
      for (let gy = y0; gy <= y1; gy++) {
        for (let gx = x0; gx <= x1; gx++) {
          this.walkableGrid[gy * cols + gx] = 0;
        }
      }
    }

    const propRects: Rect[] = s.props.map((pr) => ({
      x: pr.x - pr.w * 0.42,
      y: pr.y - pr.h * 0.42,
      w: pr.w * 0.84,
      h: pr.h * 0.84,
    }));
    this.staticBlockers = [
      ...s.walls,
      ...s.windows,
      ...s.doors.filter((d) => !d.unlocked),
      ...propRects,
    ];
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

  private rebuildFlowField(): void {
    const s = this.state;
    if (!s) return;
    const { gridCols: cols, gridRows: rows, cellSize: G } = s.stage;
    const total = cols * rows;
    if (this.flowDist.length !== total) {
      this.flowDist = new Int16Array(total);
    }
    this.flowDist.fill(30000);

    const pgx = Math.max(0, Math.min(cols - 1, Math.floor(s.player.x / G)));
    const pgy = Math.max(0, Math.min(rows - 1, Math.floor(s.player.y / G)));

    const q = new Int32Array(total);
    let head = 0;
    let tail = 0;

    // 若玩家紧贴家具边缘，允许周围相邻可走格同时作为源点
    const seedCells: [number, number][] = [[pgx, pgy]];
    if (!this.walkableGrid[pgy * cols + pgx]) {
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

    for (const [sx, sy] of seedCells) {
      const idx = sy * cols + sx;
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
    const p = s.player;

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
        if (this.circleIntersectsRect(mx, my, 14, { x: pr.x - pr.w / 2, y: pr.y - pr.h / 2, w: pr.w, h: pr.h })) {
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

  public buyOrRefillWeaponFromShop(weaponId: string): { ok: boolean; msg: string } {
    const s = this.state;
    if (!s) return { ok: false, msg: '' };
    const def = WEAPONS[weaponId];
    const unlockedRooms = this.getUnlockedExtraRoomsCount();
    // 严格按照 SAS2 规则：必须真实花钱开门拓展新防区，才能授权解锁对应高阶重火器！
    if (unlockedRooms < def.unlockRoomsRequired) {
      return { ok: false, msg: `🔒 需先在地图中开门解锁 ${def.unlockRoomsRequired} 个新区域！` };
    }

    const ownedIdx = s.player.weapons.findIndex((w) => w.defId === weaponId);
    if (ownedIdx >= 0) {
      const w = s.player.weapons[ownedIdx];
      if (def.maxReserve < 0) {
        s.player.activeSlot = ownedIdx;
        s.player.reloadTimer = 0;
        s.player.weaponSwapTimer = 0.32;
        return { ok: true, msg: '已切换至该武器！' };
      }
      const maxRes = def.maxReserve * (w.evolved ? 2 : 1);
      if (w.reserve >= maxRes && w.mag >= this.getMaxMag(weaponId, w.evolved)) {
        s.player.activeSlot = ownedIdx;
        s.player.reloadTimer = 0;
        s.player.weaponSwapTimer = 0.32;
        return { ok: true, msg: '弹药已满，已装备上阵！' };
      }
      if (s.cash < def.ammoCost) return { ok: false, msg: `钞票不足 ($${def.ammoCost})！` };
      s.cash -= def.ammoCost;
      w.mag = this.getMaxMag(weaponId, w.evolved);
      w.reserve = maxRes;
      s.player.activeSlot = ownedIdx;
      s.player.reloadTimer = 0;
      s.player.weaponSwapTimer = 0.32;
      SoundFX.reloadDone();
      return { ok: true, msg: `已补满【${def.name}】弹药！` };
    }

    if (s.cash < def.shopCost) return { ok: false, msg: `钞票不足 ($${def.shopCost})！迎战尸潮攒军费` };
    s.cash -= def.shopCost;
    this.giveOrRefillWeapon(weaponId, false);
    SoundFX.fanfare();
    return { ok: true, msg: `成功购入并装备【${def.name}】！` };
  }

  public evolveActiveWeaponInShop(cost = 1850): { ok: boolean; msg: string } {
    const s = this.state;
    if (!s) return { ok: false, msg: '' };
    const wep = s.player.weapons[s.player.activeSlot];
    const def = WEAPONS[wep.defId];
    if (wep.evolved) return { ok: false, msg: '当前武器已经是超武形态！' };
    if (s.cash < cost) return { ok: false, msg: `钞票不足 ($${cost})！` };

    s.cash -= cost;
    wep.evolved = true;
    wep.mag = this.getMaxMag(wep.defId, true);
    if (def.maxReserve > 0) wep.reserve = def.maxReserve * 2;
    s.player.weaponSwapTimer = 0.35;
    this.spawnFloatingText(s.player.x, s.player.y - 36, `⚡ ${def.superName}`, def.superColor, 1.3);
    SoundFX.fanfare();
    PlatformSDK.happyTime();
    return { ok: true, msg: `⚡ 超武觉醒：【${def.superName}】！` };
  }

  public buyShopTacticalItem(
    item: 'grenades' | 'medkit' | 'turret' | 'all_ammo' | 'armor'
  ): { ok: boolean; msg: string } {
    const s = this.state;
    if (!s) return { ok: false, msg: '' };
    if (item === 'armor') {
      if (s.player.armor >= s.player.maxArmor) return { ok: false, msg: '当前防弹护甲已满 (100/100)！' };
      if (s.cash < 380) return { ok: false, msg: '钞票不足 ($380)' };
      s.cash -= 380;
      s.player.armor = Math.min(s.player.maxArmor, s.player.armor + 65);
      SoundFX.fanfare();
      return { ok: true, msg: '🦺 已穿戴凯夫拉防弹插板 (+65 护甲，抵消 70% 受击伤害)！' };
    }
    if (item === 'grenades') {
      if (s.cash < 220) return { ok: false, msg: '钞票不足 ($220)' };
      s.cash -= 220;
      s.player.grenades += 3;
      SoundFX.reloadDone();
      return { ok: true, msg: '💣 已购入 3 颗高爆破片手雷！' };
    }
    if (item === 'medkit') {
      if (s.player.hp >= s.player.maxHp) return { ok: false, msg: '当前生命值已满！' };
      if (s.cash < 300) return { ok: false, msg: '钞票不足 ($300)' };
      s.cash -= 300;
      s.player.hp = s.player.maxHp;
      SoundFX.fanfare();
      return { ok: true, msg: '❤️ 战地急救完成，生命值已回满！' };
    }
    if (item === 'turret') {
      if (s.cash < 650) return { ok: false, msg: '钞票不足 ($650)' };
      s.cash -= 650;
      s.turrets.push({ x: s.player.x + 25, y: s.player.y, angle: s.player.angle, fireCd: 0, life: 38 });
      SoundFX.fanfare();
      return { ok: true, msg: '🛰️ 自动哨戒机枪塔已部署 (38秒)！' };
    }
    if (s.cash < 320) return { ok: false, msg: '钞票不足 ($320)' };
    s.cash -= 320;
    for (const w of s.player.weapons) {
      const def = WEAPONS[w.defId];
      w.mag = this.getMaxMag(w.defId, w.evolved);
      if (def.maxReserve > 0) w.reserve = def.maxReserve * (w.evolved ? 2 : 1);
    }
    SoundFX.reloadDone();
    return { ok: true, msg: '📦 全身所有枪械弹药已补满！' };
  }

  public throwGrenade(): void {
    const s = this.state;
    if (!s || this.paused || this.modalPaused || s.waveState === 'ended') return;
    const p = s.player;
    if (p.grenades <= 0 || p.grenadeCooldown > 0) return;

    p.grenades -= 1;
    p.grenadeCooldown = 0.65;
    s.grenadesThrown.push({
      x: p.x + Math.cos(p.angle) * 20,
      y: p.y + Math.sin(p.angle) * 20,
      vx: Math.cos(p.angle) * 430,
      vy: Math.sin(p.angle) * 430,
      z: 18,
      vz: 190,
      fuse: 1.05,
      damage: 320 * s.modifiers.damageMult,
      radius: 175,
    });
    SoundFX.repair();
  }

  // ==================== 波次与刷怪 ====================

  private prepareWave(wave: number): void {
    const s = this.state;
    if (!s) return;
    s.wave = wave;
    s.waveState = 'fighting';
    s.repairsPaidThisWave = 0;

    const p = s.player;
    for (let i = p.weapons.length - 1; i >= 0; i--) {
      const w = p.weapons[i];
      if (w.tempWavesLeft !== undefined) {
        w.tempWavesLeft -= 1;
        if (w.tempWavesLeft <= 0 && p.weapons.length > 1) {
          this.spawnFloatingText(p.x, p.y - 38, '空投试用超武已到期', '#cbd5e1', 1.1);
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

    const queue: ZombieKind[] = [];
    const totalCount = Math.round(
      10 + wave * 6.2 + Math.pow(Math.max(0, wave - 3), 1.45) * 2.8 + (s.stage.index - 1) * 6
    );
    const spitterChance = wave >= 4 ? Math.min(0.27, 0.14 + (wave - 4) * 0.022) : 0;
    const runnerChance = wave >= 2 ? Math.min(0.66, 0.34 + (wave - 2) * 0.04) : 0.12;

    for (let i = 0; i < totalCount; i++) {
      const r = Math.random();
      if (r < spitterChance) queue.push('spitter');
      else if (r < runnerChance) queue.push('runner');
      else queue.push('walker');
    }

    if (wave % 3 === 0) {
      queue.splice(Math.floor(queue.length * 0.45), 0, 'thief');
    }

    // 中后期（第 5 波起）混编重装暴君精英，层层施压不再割草！
    let miniBossCount = 0;
    if (wave === 5 || wave === 6) miniBossCount = 1;
    else if (wave === 7 || wave === 8) miniBossCount = 2;
    else if (wave === 9) miniBossCount = 3;
    else if (wave === 10) miniBossCount = 2;
    else if (wave > 10) miniBossCount = 2 + Math.floor((wave - 9) / 2);

    for (let m = 0; m < miniBossCount; m++) {
      const insertIdx = Math.min(
        queue.length,
        Math.floor(((m + 1) / (miniBossCount + 1)) * queue.length)
      );
      queue.splice(insertIdx, 0, 'miniboss');
    }

    if (wave % 10 === 0 || (wave > 10 && wave % 5 === 0)) {
      queue.splice(Math.floor(queue.length * 0.72), 0, 'boss');
    }

    if (wave >= 2 && (wave - 2) % 3 === 0 && s.chests.length < 2) {
      this.spawnRoomTreasureChest();
    }

    this.spawnQueue = queue;
    s.zombiesRemainingInWave = queue.length;
    this.spawnTimer = 0.55;

    if (wave % 5 === 0) {
      SoundFX.alarm();
      this.showBanner(wave % 10 === 0 ? `👑 警告！第 ${wave} 波狂暴尸王降临！` : `🛡️ 第 ${wave} 波！重装精英突袭！`, 3.6);
    } else {
      this.showBanner(`🧟 第 ${wave} 波尸潮来袭！`, 2.4);
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
    this.showBanner(`🎁 【${room.name}】空降了神秘宝物箱！`, 3.2);
  }

  public showBanner(text: string, dur = 2.8): void {
    if (!this.state) return;
    this.state.bannerText = text;
    this.state.bannerTimer = dur;
  }

  public switchWeapon(slotIndex?: number): void {
    const s = this.state;
    if (!s || s.player.weapons.length < 2) return;
    const next = slotIndex !== undefined ? slotIndex : (s.player.activeSlot + 1) % s.player.weapons.length;
    if (next !== s.player.activeSlot && s.player.weapons[next]) {
      s.player.activeSlot = next;
      s.player.reloadTimer = 0;
      s.player.reloadDuration = 0;
      s.player.weaponSwapTimer = 0.28;
      const wep = s.player.weapons[next];
      const def = WEAPONS[wep.defId];
      SoundFX.reloadDone();
      this.spawnFloatingText(
        s.player.x,
        s.player.y - 34,
        `🔫 ${wep.evolved ? def.superName : def.name}`,
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
    s.reviveUsed = true;
    s.player.hp = s.player.maxHp;
    s.player.invulnTimer = 4.5;
    s.player.grenades += 2;
    for (const w of s.player.weapons) {
      const def = WEAPONS[w.defId];
      w.mag = this.getMaxMag(w.defId, w.evolved);
      if (def.maxReserve > 0) w.reserve = def.maxReserve * (w.evolved ? 2 : 1);
    }
    for (const win of s.windows) {
      win.planks = win.maxPlanks;
    }
    for (const z of s.zombies) {
      const dx = z.x - s.player.x;
      const dy = z.y - s.player.y;
      const d = Math.hypot(dx, dy) || 1;
      z.x += (dx / d) * 150;
      z.y += (dy / d) * 150;
      z.stunTimer = 3.2;
      if (z.kind !== 'boss' && z.kind !== 'miniboss') z.hp -= z.maxHp * 0.65;
    }
    s.camera.shake = 1.2;
    SoundFX.explosion();
    this.showBanner('⚡ 震爆空投支援抵达！全窗加固 + 满血满弹复活！', 3.5);
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
      if (def.maxReserve > 0) w.reserve = def.maxReserve * (w.evolved ? 2 : 1);
    }
    s.turrets.push({ x: s.player.x, y: s.player.y, angle: 0, fireCd: 0, life: 45 });
    this.showBanner('🛰️ 弹药&手雷已补给！自动哨戒机枪塔已部署 (45秒)！', 3.2);
    PlatformSDK.gameplayStart();
  }

  public applyElectricFortify(): void {
    const s = this.state;
    if (!s) return;
    s.electricFortifyWaves = 2;
    for (const win of s.windows) win.planks = win.maxPlanks;
    this.showBanner('⚡ 全图窗户已升级为【高压电击钢网】(持续2波)！', 3.2);
    PlatformSDK.gameplayStart();
  }

  // ==================== 主更新循环 ====================

  private isRunHalted(): boolean {
    return (
      !this.state ||
      this.paused ||
      this.modalPaused ||
      this.state.waveState === 'ended' ||
      this.state.player.hp <= 0
    );
  }

  public update(dt: number, viewW: number, viewH: number): void {
    if (!this.state || this.paused || this.modalPaused || this.state.waveState === 'ended') return;
    const s = this.state;

    // 自适应桌面与手机横竖屏视野缩放（手机端自动拉远镜头，完整看清宽敞房间与四面窗户！）
    const fitZoom = Math.min(viewW / 1180, viewH / 680);
    s.camera.zoom = Math.max(0.54, Math.min(1.1, fitZoom));

    if (s.bannerTimer > 0) s.bannerTimer -= dt;
    if (s.hqSupportCooldown > 0) s.hqSupportCooldown -= dt;
    if (s.armoryAdCooldown > 0) s.armoryAdCooldown -= dt;
    if (s.camera.shake > 0) s.camera.shake = Math.max(0, s.camera.shake - dt * 2.8);

    (Object.keys(s.powerUpTimers) as PowerUpType[]).forEach((k) => {
      if (s.powerUpTimers[k] > 0) s.powerUpTimers[k] = Math.max(0, s.powerUpTimers[k] - dt);
    });
    if (s.feverTimer > 0) {
      s.feverTimer = Math.max(0, s.feverTimer - dt);
    } else if (s.fever > 0) {
      s.fever = Math.max(0, s.fever - dt * 7);
    }

    // 定期刷新流场寻路
    this.flowTimer -= dt;
    if (this.flowTimer <= 0) {
      this.flowTimer = 0.18;
      this.rebuildFlowField();
    }

    this.updateWaveLogic(dt);
    if (this.isRunHalted()) return;

    this.updatePlayer(dt, viewW, viewH);
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

    const lerp = Math.min(1, dt * 8.5);
    s.camera.x += (s.player.x - s.camera.x) * lerp;
    s.camera.y += (s.player.y - s.camera.y) * lerp;
  }

  public render(viewW: number, viewH: number): void {
    if (!this.state) return;
    this.renderer.render(this.ctx, viewW, viewH, this.state, this.input);
  }

  private updateWaveLogic(dt: number): void {
    const s = this.state!;
    if (s.waveState === 'fighting') {
      if (this.spawnQueue.length > 0) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          if (s.zombies.length >= 68) {
            // 同屏在场僵尸上限保护，待击杀腾出空位后无缝续刷，彻底杜绝无尽后期同屏百怪卡死
            this.spawnTimer = 0.22;
          } else {
            // 中后期多窗口并发涌入，营造四面楚歌的防守张力
            const maxBurst = s.wave >= 10 ? 3 : s.wave >= 7 ? 3 : s.wave >= 4 ? 2 : 1;
            const burst =
              maxBurst > 1 ? 1 + Math.floor(Math.random() * maxBurst) : 1;
            for (let b = 0; b < burst && this.spawnQueue.length > 0 && s.zombies.length < 68; b++) {
              const kind = this.spawnQueue.shift()!;
              this.spawnZombie(kind);
              if (kind === 'boss' || kind === 'miniboss') break;
            }
            const baseInterval = Math.max(0.24, 1.12 - s.wave * 0.068);
            this.spawnTimer = baseInterval * (0.72 + Math.random() * 0.45);
          }
        }
      } else if (s.zombies.length === 0) {
        if (s.electricFortifyWaves > 0) s.electricFortifyWaves -= 1;

        if (s.relicIds.includes('piggy_bank') && s.cash > 0) {
          const interest = Math.min(180, Math.round(s.cash * 0.1));
          s.cash += interest;
          this.spawnFloatingText(s.player.x, s.player.y - 42, `🐷 存钱罐利息 +$${interest}!`, '#fde047', 1.3);
          SoundFX.coin();
        }

        if (s.mode === 'standard' && s.wave >= s.maxWaves) {
          s.waveState = 'extraction';
          this.extractionSpawnTimer = 1.2;
          const yard = s.rooms.find((r) => r.id === 'courtyard');
          if (yard && !yard.unlocked) {
            // 紧急全图破拆连通停机坪
            s.rooms.forEach((rm) => (rm.unlocked = true));
            s.doors.forEach((d) => (d.unlocked = true));
            s.mapRevision += 1;
            this.rebuildWalkableMask();
            this.rebuildFlowField();
          }
          SoundFX.fanfare();
          PlatformSDK.happyTime();
          this.showBanner('🚁 救援直升机已降落停机坪！边打边撤，前往 H 光圈坚守登机！', 6);
        } else {
          s.waveState = 'intermission';
          s.intermissionTimer = 5.0;
          this.showBanner(`✅ 第 ${s.wave} 波肃清！按 B 打开【军火商店】换新枪！(5秒后下一波)`, 4.0);
        }
      }
      s.zombiesRemainingInWave = this.spawnQueue.length + s.zombies.length;
    } else if (s.waveState === 'intermission') {
      s.intermissionTimer -= dt;
      if (s.intermissionTimer <= 0) {
        this.prepareWave(s.wave + 1);
      }
    } else if (s.waveState === 'extraction') {
      // 撤离突围阶段持续刷出追击尸潮，拒绝白给通关！
      this.extractionSpawnTimer -= dt;
      if (this.extractionSpawnTimer <= 0 && s.zombies.length < 14) {
        this.extractionSpawnTimer = 1.35;
        this.spawnZombie(Math.random() < 0.6 ? 'runner' : 'walker');
      }

      const dist = Math.hypot(s.player.x - s.stage.helipadPos.x, s.player.y - s.stage.helipadPos.y);
      if (dist <= 86) {
        s.extractionProgress = Math.min(1, s.extractionProgress + dt / 2.8);
        if (s.extractionProgress >= 1) {
          s.waveState = 'ended';
          PlatformSDK.gameplayStop();
          PlatformSDK.happyTime();
          SaveManager.markStageCleared(s.stage.id);
          this.callbacks.onRunFinished(true, s);
        }
      } else {
        s.extractionProgress = Math.max(0, s.extractionProgress - dt * 0.55);
      }
    }
  }

  private spawnZombie(kind: ZombieKind): void {
    const s = this.state!;
    const activeWindows = s.windows.filter((w) => {
      const r = s.rooms.find((rm) => rm.id === w.roomId);
      return r?.unlocked;
    });
    const win = activeWindows[Math.floor(Math.random() * activeWindows.length)] || s.windows[0];

    if (kind === 'thief') {
      const unlocked = s.rooms.filter((r) => r.unlocked);
      const rm = unlocked[Math.floor(Math.random() * unlocked.length)];
      const rc = rm.rects[0];
      const thiefHp = Math.round((320 + s.wave * 110 + Math.pow(Math.max(0, s.wave - 3), 1.65) * 75) * (1 + (s.stage.index - 1) * 0.34));
      s.zombies.push({
        id: this.nextEntityId++,
        kind: 'thief',
        x: rc.x + rc.w / 2,
        y: rc.y + rc.h / 2,
        vx: 0,
        vy: 0,
        radius: 25,
        hp: thiefHp,
        maxHp: thiefHp,
        speed: 214,
        damage: 0,
        cashReward: 130,
        xpReward: 42,
        color: '#facc15',
        targetWindowId: null,
        insideBuilding: true,
        hitFlash: 0,
        burnTimer: 0,
        slowTimer: 0,
        stunTimer: 0,
        attackCd: 0,
        rangedCd: 5, // 最多受击掉落 5 枚金币，杜绝高频冲锋枪无限刷钱！
        fleeTimer: 14,
        wobblePhase: Math.random() * 6,
        facingAngle: 0,
        attackAnim: 0,
      });
      this.showBanner('💰 黄金盗宝僵尸出现！集火打爆它抢夺神秘宝物箱！', 3.5);
      return;
    }

    // 紧绷硬核的尸潮血量/移速膨胀与赏金衰减曲线！
    const stageMult = 1 + (s.stage.index - 1) * 0.38;
    const hpScale =
      (1 + (s.wave - 1) * 0.42 + Math.pow(Math.max(0, s.wave - 3), 1.76) * 0.36) * stageMult;
    const dmgScale = 1 + Math.max(0, s.wave - 1) * 0.095 + (s.stage.index - 1) * 0.16;
    const cashTaper = 1 / (1 + Math.max(0, s.wave - 3) * 0.14);

    let hp = 68 * hpScale;
    let speed = 108 + Math.min(86, s.wave * 7.2);
    let radius = 24;
    let damage = Math.round(17 * dmgScale);
    let cash = Math.max(5, Math.round(10 * cashTaper));
    let xp = 10;
    let color = '#4ade80';

    if (kind === 'runner') {
      hp = 50 * hpScale;
      speed = 182 + Math.min(92, s.wave * 7.8);
      radius = 21;
      damage = Math.round(15 * dmgScale);
      cash = Math.max(6, Math.round(12 * cashTaper));
      xp = 12;
      color = '#fb7185';
    } else if (kind === 'spitter') {
      hp = 98 * hpScale;
      speed = 104 + Math.min(54, s.wave * 4.5);
      radius = 27;
      damage = Math.round(18 * dmgScale);
      cash = Math.max(8, Math.round(16 * cashTaper));
      xp = 16;
      color = '#a3e635';
    } else if (kind === 'miniboss') {
      hp = 880 * hpScale;
      speed = 102 + Math.min(58, s.wave * 5);
      radius = 38;
      damage = Math.round(32 * dmgScale);
      cash = 110;
      xp = 62;
      color = '#a855f7';
    } else if (kind === 'boss') {
      hp = 2450 * hpScale;
      speed = 98 + Math.min(54, s.wave * 4.5);
      radius = 52;
      damage = Math.round(42 * dmgScale);
      cash = 280;
      xp = 140;
      color = '#ef4444';
    }

    const wx = win.x + win.w / 2 + win.spawnOutsideOffset.dx + (Math.random() - 0.5) * 35;
    const wy = win.y + win.h / 2 + win.spawnOutsideOffset.dy + (Math.random() - 0.5) * 35;

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
      rangedCd: 2.2,
      fleeTimer: 0,
      wobblePhase: Math.random() * Math.PI * 2,
      facingAngle: Math.atan2(s.player.y - wy, s.player.x - wx),
      attackAnim: 0,
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
    if (p.footDustCd > 0) p.footDustCd -= dt;
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
      (inAcid ? 0.72 : 1);
    if (s.feverTimer > 0 || s.powerUpTimers.overdrive > 0) speed *= 1.24;

    const oldX = p.x;
    const oldY = p.y;
    p.x += mv.x * speed * dt;
    p.y += mv.y * speed * dt;
    this.resolveEntityInsideWalls(p);

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
    if (this.input.aimStick.active && (this.input.aimStick.dx !== 0 || this.input.aimStick.dy !== 0)) {
      p.angle = Math.atan2(this.input.aimStick.dy, this.input.aimStick.dx);
      wantFire = true;
    } else if (!this.input.usingTouch && !this.input.autoFireEnabled) {
      p.angle = Math.atan2(worldMouseY - p.y, worldMouseX - p.x);
      wantFire = this.input.mouseDown;
    } else {
      if (!this.input.usingTouch && this.input.mouseDown) {
        p.angle = Math.atan2(worldMouseY - p.y, worldMouseX - p.x);
        wantFire = true;
      } else {
        const target = this.findNearestTarget(p.x, p.y, 480);
        if (target) {
          p.angle = Math.atan2(target.y - p.y, target.x - p.x);
          wantFire = true;
        } else if (mv.x !== 0 || mv.y !== 0) {
          p.angle = Math.atan2(mv.y, mv.x);
        }
      }
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
    // 木板尚未被拆光时，自动射击与哨戒炮不会隔着封窗提前把室外破门僵尸打死！
    if (win.planks > 0) return false;
    const wcx = win.x + win.w / 2;
    const wcy = win.y + win.h / 2;
    return Math.hypot(z.x - wcx, z.y - wcy) <= 48;
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
      const score = z.kind === 'thief' ? d * 0.55 : z.insideBuilding ? d * 0.78 : d * 1.15;
      // 先判断分数是否优于当前最优目标，再执行昂贵的墙壁穿刺射线检测（减少 ~90% 射线开销！）
      if (score >= bestScore) continue;
      if (!this.isZombieTargetableForAutoAim(z)) continue;
      if (!this.hasBulletLineOfSight(x, y, z.x, z.y)) continue;
      bestScore = score;
      best = z;
    }
    return best;
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
        if (p.activeSlot !== 0) {
          p.activeSlot = 0;
          this.spawnFloatingText(p.x, p.y - 34, '弹药耗尽！切回手枪', '#fca5a5', 1);
        }
      } else {
        this.startReload();
      }
      return;
    }
    if (p.fireCooldown > 0) return;

    const rateMult = (overdrive ? 1.6 : 1) * (s.feverTimer > 0 ? 1.26 : 1) * (wep.evolved ? 1.16 : 1);
    p.fireCooldown = 1 / (def.fireRate * rateMult);

    if (!overdrive) {
      wep.mag -= 1;
      if (wep.mag <= 0 && (wep.reserve > 0 || wep.reserve < 0)) {
        this.startReload();
      }
    }

    const extraFloor = Math.floor(s.modifiers.extraPellets);
    const extraFrac = s.modifiers.extraPellets - extraFloor;
    const totalPellets = def.pellets + extraFloor + (Math.random() < extraFrac ? 1 : 0);
    const isCrit = Math.random() < s.modifiers.critChance;
    const baseDmg = def.damage * s.modifiers.damageMult * (wep.evolved ? 1.58 : 1) * (isCrit ? 2 : 1);

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

    for (let i = 0; i < totalPellets; i++) {
      const offset =
        totalPellets === 1
          ? (Math.random() - 0.5) * def.spread
          : (i / (totalPellets - 1) - 0.5) * def.spread + (Math.random() - 0.5) * 0.04;
      const ang = p.angle + offset;

      if (s.bullets.length >= 165) {
        s.bullets.shift();
      }
      s.bullets.push({
        x: muzzleX,
        y: muzzleY,
        vx: Math.cos(ang) * def.bulletSpeed,
        vy: Math.sin(ang) * def.bulletSpeed,
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
        damage: baseDmg,
        knockback: def.knockback,
        pierceLeft: def.pierce + s.modifiers.extraPierce + (wep.evolved ? 1 : 0),
        bouncesLeft:
          (def.bounces || 0) +
          (def.sawblade && wep.evolved ? 2 : 0) +
          (s.relicIds.includes('rubber_bullets') && !def.explosiveRadius ? 1 : 0),
        explosiveRadius: def.explosiveRadius ? def.explosiveRadius * (wep.evolved ? 1.35 : 1) : 0,
        color: isCrit ? '#fde047' : wep.evolved ? def.superColor : def.color,
        isCrit,
        flame: Boolean(def.flame || (def.id === 'shotgun' && wep.evolved) || s.relicIds.includes('dragon_oil')),
        cryo: Boolean(def.cryo),
        electric: Boolean(def.electric || ((def.id === 'smg' || def.id === 'sniper') && wep.evolved)),
        laser: Boolean(def.laser),
        sawblade: Boolean(def.sawblade),
        hitIds: new Set(),
        life: def.flame || def.cryo ? 0.44 : def.sawblade ? 2.4 : 1.4,
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
        size: 3,
        color: '#fbbf24',
        life: 0.35,
        maxLife: 0.35,
        isShell: true,
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
    SoundFX.shoot(sfxMap[def.id] || 'rifle', wep.evolved);
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

      const nx = g.x + g.vx * dt;
      const ny = g.y + g.vy * dt;
      if (this.findBlockingWallOrLockedDoor(nx, g.y, 8)) g.vx = -g.vx * 0.6;
      else g.x = nx;
      if (this.findBlockingWallOrLockedDoor(g.x, ny, 8)) g.vy = -g.vy * 0.6;
      else g.y = ny;

      if (g.fuse <= 0) {
        this.explodeAt(g.x, g.y, g.radius, g.damage);
        s.grenadesThrown.splice(i, 1);
      }
    }
  }

  private updateInteractions(dt: number): void {
    const s = this.state!;
    const p = s.player;
    const pStats = SaveManager.getEffectivePlayerStats();

    // 1. 自动修窗
    let repairingAny = false;
    for (const win of s.windows) {
      const room = s.rooms.find((r) => r.id === win.roomId);
      if (!room?.unlocked || win.planks >= win.maxPlanks) continue;
      const cx = win.x + win.w / 2;
      const cy = win.y + win.h / 2;
      if (Math.hypot(p.x - cx, p.y - cy) <= 82) {
        repairingAny = true;
        p.repairProgress += dt * 1.35 * pStats.repairSpeedMultiplier;
        if (p.repairProgress >= 1) {
          p.repairProgress = 0;
          win.planks += 1;
          SoundFX.repair();
          // 每波最多前 6 块修补木板发放赏金，杜绝留最后一只僵尸无限修窗刷钱！
          if (s.repairsPaidThisWave < 6) {
            s.repairsPaidThisWave += 1;
            const cashBonus = 8;
            s.cash += cashBonus;
            this.spawnFloatingText(cx, cy - 16, `🔨 修窗 +$${cashBonus}`, '#fde047', 1);
          } else {
            this.spawnFloatingText(cx, cy - 16, '🔨 已加固', '#cbd5e1', 0.9);
          }
          if (s.modifiers.repairHealRatio > 0 && s.repairsPaidThisWave <= 6) {
            const heal = Math.round(p.maxHp * s.modifiers.repairHealRatio);
            p.hp = Math.min(p.maxHp, p.hp + heal);
            this.spawnFloatingText(p.x, p.y - 26, `+${heal} HP`, '#4ade80', 1);
          }
        }
        break;
      }
    }
    if (!repairingAny) p.repairProgress = 0;

    // 2. 靠近未解锁大门读条开门 + 重建寻路流场！
    for (const door of s.doors) {
      if (door.unlocked) continue;
      const cx = door.x + door.w / 2;
      const cy = door.y + door.h / 2;
      if (Math.hypot(p.x - cx, p.y - cy) <= 74 && s.cash >= door.cost) {
        door.progress += dt * 1.5;
        if (door.progress >= 1) {
          s.cash -= door.cost;
          const room = s.rooms.find((r) => r.id === door.unlockRoomId);
          if (room) room.unlocked = true;
          const roomAObj = s.rooms.find((r) => r.id === door.roomA);
          if (roomAObj) roomAObj.unlocked = true;
          const roomBObj = s.rooms.find((r) => r.id === door.roomB);
          if (roomBObj) roomBObj.unlocked = true;

          // 同步开启连通两个已解锁房间之间的门
          s.doors.forEach((d) => {
            const ra = s.rooms.find((r) => r.id === d.roomA)?.unlocked;
            const rb = s.rooms.find((r) => r.id === d.roomB)?.unlocked;
            if (ra && rb) {
              d.unlocked = true;
              d.progress = 0;
            }
          });

          s.mapRevision += 1;
          this.rebuildWalkableMask();
          this.rebuildFlowField();
          SoundFX.fanfare();
          PlatformSDK.happyTime();
          this.showBanner(`🔓 已开启【${door.label}】！军火商店已解锁更多强力枪械！`, 3.5);
        }
      } else {
        door.progress = Math.max(0, door.progress - dt * 2.5);
      }
    }

    // 3. 踩房间神秘宝物箱
    for (let i = s.chests.length - 1; i >= 0; i--) {
      const c = s.chests[i];
      if (Math.hypot(p.x - c.x, p.y - c.y) <= 56) {
        c.progress += dt * 1.8;
        if (c.progress >= 1) {
          s.chests.splice(i, 1);
          this.openRelicChestModal();
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
      return activeWep.reserve < def.maxReserve * (activeWep.evolved ? 2 : 1);
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
        this.showBanner(`🪂 空投超武已装备！尽情横扫 3 波尸潮！`, 3.2);
      }
      return;
    }

    s.cash -= st.cost;

    if (st.type === 'ammo_box') {
      const wep = p.weapons[p.activeSlot];
      const def = WEAPONS[wep.defId];
      wep.mag = this.getMaxMag(wep.defId, wep.evolved);
      wep.reserve = def.maxReserve * (wep.evolved ? 2 : 1);
      SoundFX.reloadDone();
      this.spawnFloatingText(st.x, st.y - 34, '📦 弹药已补满！', '#4ade80', 1.2);
    } else if (st.type === 'pack_a_punch') {
      const wep = p.weapons[p.activeSlot];
      const def = WEAPONS[wep.defId];
      wep.evolved = true;
      wep.mag = this.getMaxMag(wep.defId, true);
      if (def.maxReserve > 0) wep.reserve = def.maxReserve * 2;
      SoundFX.fanfare();
      PlatformSDK.happyTime();
      this.showBanner(`⚡ 超武觉醒：【${def.superName}】！`, 3.6);
    } else if (st.type === 'mech_dog_cage') {
      st.used = true;
      s.mechDog.active = true;
      s.mechDog.x = st.x;
      s.mechDog.y = st.y;
      SoundFX.fanfare();
      this.showBanner('🐕 机械警犬已出笼！自动帮你捡全图钞票并撕咬僵尸！', 3.4);
    } else if (st.type === 'vending_machine') {
      const roll = Math.random();
      if (roll < 0.36) {
        p.hp = p.maxHp;
        p.armor = Math.min(p.maxArmor, p.armor + 35);
        this.spawnFloatingText(st.x, st.y - 34, '🍔 能量汉堡：满血 + 35护甲！', '#4ade80', 1.25);
      } else if (roll < 0.75) {
        s.powerUpTimers.overdrive = 7;
        this.spawnFloatingText(st.x, st.y - 34, '🥤 狂暴汽水：7秒无限火力！', '#f97316', 1.25);
      } else {
        s.cash += 300;
        this.spawnFloatingText(st.x, st.y - 34, '🎰 扭蛋头奖 +$300!', '#fde047', 1.35);
      }
      SoundFX.fanfare();
    } else if (st.type === 'laser_trap') {
      st.activeTimer = 18;
      SoundFX.alarm();
      this.showBanner('🚨 旋转激光柱已激活！把尸群引过来绞碎！', 2.8);
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
      w.mag = this.getMaxMag(weaponId, w.evolved);
      if (def.maxReserve > 0) w.reserve = def.maxReserve * (w.evolved ? 2 : 1);
      p.activeSlot = existingIdx;
    } else {
      const inst = {
        defId: weaponId,
        evolved,
        mag: this.getMaxMag(weaponId, evolved),
        reserve: def.maxReserve > 0 ? def.maxReserve * (evolved ? 2 : 1) : -1,
        tempWavesLeft: tempWaves,
      };
      if (p.weapons.length < 2) {
        p.weapons.push(inst);
        p.activeSlot = p.weapons.length - 1;
      } else {
        p.weapons[1] = inst;
        p.activeSlot = 1;
      }
    }
    p.reloadTimer = 0;
    p.weaponSwapTimer = 0.32;
    this.spawnFloatingText(
      p.x,
      p.y - 36,
      `🔫 装备：${evolved ? def.superName : def.name}`,
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

  private openRelicChestModal(): void {
    const s = this.state!;
    this.pendingModals.push(() => {
      if (!this.state || this.state.waveState === 'ended' || this.state.player.hp <= 0) return;
      const pool = RELICS.filter((r) => !s.relicIds.includes(r.id));
      if (pool.length === 0) {
        s.cash += 350;
        this.spawnFloatingText(s.player.x, s.player.y - 32, '🎁 奇物已集齐！奖励 +$350', '#fde047', 1.3);
        this.flushQueuedModals();
        return;
      }
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      const choices = shuffled.slice(0, Math.min(2, shuffled.length));
      this.modalPaused = true;
      this.input.resetStates();
      SoundFX.fanfare();

      this.callbacks.onOpenTreasureChest(
        choices,
        (picked) => {
          if (!s.relicIds.includes(picked.id)) s.relicIds.push(picked.id);
          this.modalPaused = false;
          this.showBanner(`✨ 获得宝物【${picked.name}】：${picked.desc}`, 3.5);
          this.flushQueuedModals();
        },
        async () => {
          const ok = await PlatformSDK.showRewardedAd('relic_take_all', '神秘宝物箱 2 件全收');
          if (ok) {
            choices.forEach((c) => {
              if (!s.relicIds.includes(c.id)) s.relicIds.push(c.id);
            });
            this.modalPaused = false;
            PlatformSDK.gameplayStart();
            this.showBanner(`🎉 爽翻！2 件宝物全部收入囊中！`, 3.5);
            this.flushQueuedModals();
            return true;
          }
          // 若用户取消激励视频，保持宝物箱界面可继续免费任选 1 件，绝不出现空屏假死！
          return false;
        }
      );
    });
    this.flushQueuedModals();
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
            this.damageZombie(z, 280 * dt, 0, 0, false, true, false);
          }
        }
      }
    }
  }

  private updateTurretsAndDog(dt: number): void {
    const s = this.state!;
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
            damage: 25 * s.modifiers.damageMult,
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
          this.damageZombie(nearZombie, 48 * s.modifiers.damageMult, 0, 0, false, false, true);
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
          this.explodeAt(barrel.x, barrel.y, 185, 250 * s.modifiers.damageMult);
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
          const plankCover =
            !z.insideBuilding &&
            z.targetWindowId &&
            (s.windows.find((w) => w.id === z.targetWindowId)?.planks ?? 0) > 0
              ? 0.6
              : 1;
          this.damageZombie(
            z,
            b.damage * plankCover,
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
    if (cryo) {
      z.slowTimer = Math.max(z.slowTimer, 3.2);
      if (Math.random() < 0.25 && z.kind !== 'boss') {
        z.stunTimer = Math.max(z.stunTimer, 0.22);
      }
    }
    if (electric) z.slowTimer = Math.max(z.slowTimer, 2.2);

    const kbResist = z.kind === 'boss' ? 0.12 : z.kind === 'miniboss' ? 0.3 : 1;
    z.x += kx * 0.08 * kbResist;
    z.y += ky * 0.08 * kbResist;
    if (z.insideBuilding) {
      this.resolveEntityInsideWalls(z);
    }

    if (isCrit || (s.floatingTexts.length < 28 && (dmg >= 12 || Math.random() < 0.2))) {
      this.spawnFloatingText(
        z.x + (Math.random() - 0.5) * 14,
        z.y - z.radius - 8,
        `${Math.round(dmg)}${isCrit ? '!' : ''}`,
        isCrit ? '#fde047' : '#ffffff',
        isCrit ? 1.25 : 0.92
      );
    }

    if (z.kind === 'thief' && z.rangedCd > 0 && Math.random() < 0.38) {
      z.rangedCd -= 1;
      this.spawnMergedDrop(
        'cash',
        12,
        z.x + (Math.random() - 0.5) * 28,
        z.y + (Math.random() - 0.5) * 28,
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
    this.spawnHitSparks(z.x, z.y, z.color, 8);
    if (s.decals.length > 52) s.decals.shift();
    s.decals.push({
      x: z.x,
      y: z.y,
      radius: z.radius * (0.85 + Math.random() * 0.35),
      color:
        z.kind === 'thief'
          ? 'rgba(250, 204, 21, 0.38)'
          : z.kind === 'spitter'
            ? 'rgba(163, 230, 53, 0.42)'
            : 'rgba(34, 197, 94, 0.32)',
      life: 14,
      maxLife: 14,
      seed: Math.random() * 10,
    });

    if (s.feverTimer <= 0) {
      s.fever = Math.min(100, s.fever + (z.kind === 'boss' ? 40 : 10));
      if (s.fever >= 100) {
        s.feverTimer = 6.5;
        s.fever = 0;
        SoundFX.fanfare();
        this.showBanner('🌈 FEVER 狂热时刻！射速与移速飙升！', 2.8);
      }
    }

    if (s.relicIds.includes('vamp_fangs')) {
      s.player.vampCounter += 1;
      if (s.player.vampCounter >= 18) {
        s.player.vampCounter = 0;
        const heal = Math.round(s.player.maxHp * 0.08);
        s.player.hp = Math.min(s.player.maxHp, s.player.hp + heal);
        this.spawnFloatingText(s.player.x, s.player.y - 30, `🦇 吸血 +${heal}`, '#4ade80', 1.15);
      }
    }

    const cashMult = s.modifiers.cashMult * (s.powerUpTimers.double_cash > 0 ? 2 : 1);
    const cashVal = Math.round(z.cashReward * cashMult);
    this.spawnMergedDrop(
      'cash',
      cashVal,
      z.x + (Math.random() - 0.5) * 18,
      z.y + (Math.random() - 0.5) * 18,
      25
    );
    this.spawnMergedDrop(
      'xp',
      z.xpReward,
      z.x + (Math.random() - 0.5) * 22,
      z.y + (Math.random() - 0.5) * 22,
      25
    );

    if (z.kind === 'thief') {
      const rm = this.getRoomAt(z.x, z.y) || s.rooms[0];
      s.chests.push({
        id: this.nextEntityId++,
        x: z.x,
        y: z.y,
        roomId: rm.id,
        progress: 0,
        bobPhase: 0,
      });
      SoundFX.fanfare();
      this.showBanner('💰 成功击毙盗宝僵尸！爆出【神秘宝物箱】！', 3.2);
    } else if (Math.random() < (z.kind === 'miniboss' || z.kind === 'boss' ? 0.55 : 0.035)) {
      const types: PowerUpType[] = ['overdrive', 'nuke', 'carpenter', 'double_cash', 'freeze'];
      const pType = types[Math.floor(Math.random() * types.length)];
      s.drops.push({
        id: this.nextEntityId++,
        kind: 'powerup',
        powerUp: pType,
        value: 0,
        x: z.x,
        y: z.y,
        life: 18,
        bobPhase: 0,
      });
    }

    // 限制连环爆裂最大递归层数为 2，既保留连爆爽感又 100% 杜绝高密度尸潮无限递归爆栈！
    if (this.explosionDepth < 2 && s.relicIds.includes('chain_blast') && Math.random() < 0.2) {
      this.explodeAt(z.x, z.y, 115, 85 * s.modifiers.damageMult);
    }
  }

  private explodeAt(x: number, y: number, radius: number, damage: number): void {
    const s = this.state!;
    SoundFX.explosion();
    s.camera.shake = Math.max(s.camera.shake, 0.9);
    this.spawnHitSparks(x, y, '#f97316', 14);
    if (this.explosionDepth === 0) {
      this.spawnFloatingText(x, y - 16, '💥 BOOM!', '#fde047', 1.45);
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
      if (!z || z.hp <= 0 || this.deadZombieIds.has(z.id)) continue;
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
      if (z.stunTimer > 0) {
        z.stunTimer -= dt;
        continue;
      }

      if (z.kind === 'thief') {
        z.fleeTimer -= dt;
        if (z.fleeTimer <= 0) {
          this.spawnFloatingText(z.x, z.y - 20, '💨 盗宝怪溜走了!', '#cbd5e1', 1.15);
          s.zombies.splice(i, 1);
          continue;
        }
        const awayAng = Math.atan2(z.y - p.y, z.x - p.x) + Math.sin(z.wobblePhase * 0.4) * 0.8;
        z.vx = Math.cos(awayAng) * z.speed * freezeMult;
        z.vy = Math.sin(awayAng) * z.speed * freezeMult;
        z.facingAngle = this.lerpAngle(z.facingAngle, awayAng, Math.min(1, dt * 10));
        z.x += z.vx * dt;
        z.y += z.vy * dt;
        this.resolveEntityInsideWalls(z);
        continue;
      }

      const bossEnraged = z.kind === 'boss' && z.hp < z.maxHp * 0.55;
      const chargeBoost = z.kind === 'miniboss' && z.fleeTimer > 0 ? 1.85 : 1;
      const spd = z.speed * freezeMult * (z.slowTimer > 0 ? 0.55 : 1) * (bossEnraged ? 1.28 : 1) * chargeBoost;

      if (!z.insideBuilding && z.targetWindowId) {
        const win = s.windows.find((w) => w.id === z.targetWindowId);
        if (!win) {
          z.insideBuilding = true;
          z.targetWindowId = null;
          continue;
        }
        const wcx = win.x + win.w / 2;
        const wcy = win.y + win.h / 2;
        const dx = wcx - z.x;
        const dy = wcy - z.y;
        const dist = Math.hypot(dx, dy) || 1;
        z.facingAngle = this.lerpAngle(z.facingAngle, Math.atan2(dy, dx), Math.min(1, dt * 10));

        if (dist > 28) {
          z.vx = (dx / dist) * spd;
          z.vy = (dy / dist) * spd;
          z.x += z.vx * dt;
          z.y += z.vy * dt;
        } else if (win.planks > 0) {
          z.vx = dx * 0.2;
          z.vy = dy * 0.2;
          if (z.attackCd <= 0) {
            const baseTearCd =
              z.kind === 'boss' || z.kind === 'miniboss'
                ? 0.42
                : z.kind === 'runner'
                  ? Math.max(0.38, 0.72 - s.wave * 0.03)
                  : Math.max(0.44, 0.94 - s.wave * 0.04);
            z.attackCd = baseTearCd;
            z.attackAnim = 1.0;

            const prevPlanks = win.planks;
            win.planks = Math.max(0, win.planks - (z.kind === 'boss' ? 2 : 1));
            this.spawnHitSparks(wcx, wcy, '#fbbf24', 4);

            // 高压电击钢网：仅提供非致命麻痹减速与拆窗迟滞，绝不让僵尸撞窗暴毙！
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
                  { x: wcx, y: wcy },
                  { x: z.x, y: z.y },
                ],
                color: '#38bdf8',
                life: 0.18,
              });
            }

            // 震荡铆钉板：仅在最后一块木板被彻底拆破时触发非致命气浪击退与眩晕！
            if (prevPlanks > 0 && win.planks === 0 && s.relicIds.includes('explosive_planks')) {
              this.spawnHitSparks(wcx, wcy, '#38bdf8', 14);
              this.spawnFloatingText(wcx, wcy - 18, '🛡️ 震荡弹开!', '#38bdf8', 1.2);
              for (const oz of s.zombies) {
                if (!oz.insideBuilding && Math.hypot(oz.x - wcx, oz.y - wcy) <= 130) {
                  const pushAng = Math.atan2(oz.y - wcy, oz.x - wcx);
                  oz.x += Math.cos(pushAng) * 78;
                  oz.y += Math.sin(pushAng) * 78;
                  oz.stunTimer = Math.max(oz.stunTimer, 1.5);
                  oz.slowTimer = Math.max(oz.slowTimer, 3.0);
                }
              }
            }
          }
        } else {
          // 跨入窗内房间安全点
          const inSignX = win.spawnOutsideOffset.dx !== 0 ? -Math.sign(win.spawnOutsideOffset.dx) : 0;
          const inSignY = win.spawnOutsideOffset.dy !== 0 ? -Math.sign(win.spawnOutsideOffset.dy) : 0;
          z.x = wcx + inSignX * (z.radius + 18);
          z.y = wcy + inSignY * (z.radius + 18);
          z.insideBuilding = true;
          z.targetWindowId = null;
        }
      } else {
        if (z.kind === 'miniboss') {
          if (z.fleeTimer > 0) z.fleeTimer = Math.max(0, z.fleeTimer - dt);
          z.rangedCd -= dt;
          const pDistCharge = Math.hypot(p.x - z.x, p.y - z.y);
          if (z.rangedCd <= 0 && pDistCharge < 390 && pDistCharge > 75) {
            z.rangedCd = 4.2;
            z.fleeTimer = 0.65;
            z.attackAnim = 1.0;
            this.spawnFloatingText(z.x, z.y - z.radius - 16, '💢 暴君冲锋!', '#c084fc', 1.15);
          }
        } else if (z.kind === 'boss') {
          // 尸王半血狂暴召唤疾行猎犬护卫！
          if (bossEnraged && z.fleeTimer === 0) {
            z.fleeTimer = 1;
            SoundFX.alarm();
            s.camera.shake = Math.max(s.camera.shake, 0.9);
            this.showBanner('👑 尸王进入狂暴二阶段！移速飙升并召唤嗜血猎犬！', 3.2);
            for (let k = 0; k < 3; k++) {
              this.spawnZombie('runner');
            }
          }
          z.rangedCd -= dt;
          const pDistBoss = Math.hypot(p.x - z.x, p.y - z.y);
          if (z.rangedCd <= 0 && pDistBoss < 560) {
            z.rangedCd = bossEnraged ? 2.3 : 3.1;
            z.attackAnim = 1.0;
            const baseAng = Math.atan2(p.y - z.y, p.x - z.x);
            for (let k = -2; k <= 2; k++) {
              const fanAng = baseAng + k * 0.22;
              s.spits.push({
                x: z.x + Math.cos(fanAng) * (z.radius * 0.6),
                y: z.y + Math.sin(fanAng) * (z.radius * 0.6),
                vx: Math.cos(fanAng) * 350,
                vy: Math.sin(fanAng) * 350,
                radius: 9.5,
                damage: Math.round(z.damage * 0.55),
                life: 2.1,
              });
            }
          }
        }

        const goal = this.getFlowVelocityTarget(z.x, z.y);
        const dx = goal.x - z.x;
        const dy = goal.y - z.y;
        const dist = Math.hypot(dx, dy) || 1;
        z.vx = (dx / dist) * spd;
        z.vy = (dy / dist) * spd;
        z.facingAngle = this.lerpAngle(z.facingAngle, Math.atan2(dy, dx), Math.min(1, dt * 9));

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
        this.resolveEntityInsideWalls(z);

        if (z.kind === 'spitter') {
          z.rangedCd -= dt;
          const pDist = Math.hypot(p.x - z.x, p.y - z.y);
          if (z.rangedCd <= 0 && pDist < 420 && this.hasBulletLineOfSight(z.x, z.y, p.x, p.y)) {
            z.rangedCd = Math.max(1.85, 2.65 - s.wave * 0.05);
            const ang = Math.atan2(p.y - z.y, p.x - z.x);
            s.spits.push({
              x: z.x,
              y: z.y,
              vx: Math.cos(ang) * 355,
              vy: Math.sin(ang) * 355,
              radius: 8,
              damage: z.damage,
              life: 1.9,
            });
          }
        }

        const pDist = Math.hypot(p.x - z.x, p.y - z.y);
        if (pDist <= p.radius + z.radius + 4 && z.attackCd <= 0) {
          z.attackCd = bossEnraged ? 0.65 : 0.82;
          z.attackAnim = 1.0;
          this.damagePlayer(z.damage);
        }
      }
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
    if (p.invulnTimer > 0 || s.waveState === 'ended') return;

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
      PlatformSDK.gameplayStop();
      if (s.mode === 'endless') {
        SaveManager.recordEndlessWave(s.stage.id, s.wave);
      }
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
    for (let i = s.spits.length - 1; i >= 0; i--) {
      const sp = s.spits[i];
      const isBoss = sp.radius >= 9;
      sp.life -= dt;
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      const blocked = this.findBulletBlocker(sp.x, sp.y, sp.radius);
      if (sp.life <= 0 || blocked) {
        if (!blocked || Math.hypot(sp.x - s.player.x, sp.y - s.player.y) < 320) {
          this.spawnAcidPool(sp.x - sp.vx * dt, sp.y - sp.vy * dt, isBoss);
        }
        s.spits.splice(i, 1);
        continue;
      }
      if (Math.hypot(sp.x - s.player.x, sp.y - s.player.y) <= sp.radius + s.player.radius) {
        this.spawnAcidPool(sp.x, sp.y, isBoss);
        s.spits.splice(i, 1);
        this.damagePlayer(sp.damage);
      }
    }
  }

  private updateAcidPools(dt: number): void {
    const s = this.state!;
    const p = s.player;
    for (let i = s.acidPools.length - 1; i >= 0; i--) {
      const ap = s.acidPools[i];
      ap.life -= dt;
      if (ap.life <= 0) {
        s.acidPools.splice(i, 1);
        continue;
      }
      if (
        p.invulnTimer <= 0 &&
        Math.hypot(p.x - ap.x, p.y - ap.y) <= ap.radius + p.radius * 0.45
      ) {
        this.damagePlayer(ap.isBoss ? 9 : 6, 0.55);
      }
    }
  }

  private updateDrops(dt: number): void {
    const s = this.state!;
    const p = s.player;
    const magnetRange = s.powerUpTimers.overdrive > 0 ? 230 : 125;

    for (let i = s.drops.length - 1; i >= 0; i--) {
      const d = s.drops[i];
      d.life -= dt;
      if (d.life <= 0) {
        s.drops.splice(i, 1);
        continue;
      }

      const distPlayer = Math.hypot(p.x - d.x, p.y - d.y);
      const distDog = s.mechDog.active ? Math.hypot(s.mechDog.x - d.x, s.mechDog.y - d.y) : Infinity;

      if (distPlayer < magnetRange) {
        d.x += ((p.x - d.x) / (distPlayer || 1)) * 390 * dt;
        d.y += ((p.y - d.y) / (distPlayer || 1)) * 390 * dt;
      }

      if (distPlayer <= p.radius + 20 || distDog <= 28) {
        this.collectDrop(d);
        s.drops.splice(i, 1);
      }
    }
  }

  private collectDrop(d: DropItem): void {
    const s = this.state!;
    if (d.kind === 'cash') {
      s.cash += d.value;
      SoundFX.coin();
      this.spawnFloatingText(d.x, d.y - 10, `+$${d.value}`, '#4ade80', 1);
    } else if (d.kind === 'xp') {
      s.battleXp += d.value;
      SoundFX.xp();
      while (s.battleXp >= s.battleXpNext) {
        s.battleXp -= s.battleXpNext;
        s.battleLevel += 1;
        s.battleXpNext = Math.round(s.battleXpNext * 1.38 + 22);
        s.player.hp = Math.min(s.player.maxHp, s.player.hp + Math.round(s.player.maxHp * 0.15));
        this.triggerBattleLevelUp();
      }
    } else if (d.kind === 'powerup' && d.powerUp) {
      const meta = POWERUP_META[d.powerUp];
      SoundFX.fanfare();
      this.showBanner(meta.banner, 3.0);
      if (d.powerUp === 'nuke') {
        s.camera.shake = 1.2;
        SoundFX.explosion();
        const snapshot = [...s.zombies];
        for (const z of snapshot) {
          if (!z || z.hp <= 0 || this.deadZombieIds.has(z.id)) continue;
          if (z.kind === 'boss' || z.kind === 'miniboss') {
            this.damageZombie(z, z.maxHp * 0.3, 0, 0, true, false, false);
          } else {
            this.killZombie(z);
          }
        }
      } else if (d.powerUp === 'carpenter') {
        for (const w of s.windows) w.planks = w.maxPlanks;
        s.cash += 40;
      } else {
        s.powerUpTimers[d.powerUp] = meta.duration;
      }
    }
  }

  private triggerBattleLevelUp(): void {
    const s = this.state!;
    this.pendingModals.push(() => {
      if (!this.state || this.state.waveState === 'ended' || this.state.player.hp <= 0) return;
      const shuffled = [...IN_RUN_PERKS].sort(() => Math.random() - 0.5);
      const choices = shuffled.slice(0, 3);
      this.modalPaused = true;
      this.input.resetStates();
      SoundFX.fanfare();
      this.callbacks.onBattleLevelUp(choices, (picked) => {
        picked.apply(s.modifiers);
        this.modalPaused = false;
        this.showBanner(`🆙 战斗升至 Lv.${s.battleLevel}！解锁【${picked.name}】！`, 2.8);
        this.flushQueuedModals();
      });
    });
    this.flushQueuedModals();
  }

  private updateFX(dt: number): void {
    const s = this.state!;
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

  // ==================== 墙壁、门锁与室内掩体碰撞 ====================

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
      if (!pr.blocksBullets) continue; // 低矮办公桌和喷泉允许隔桌射击！高大军用箱和SWAT装甲车阻挡子弹
      const r = { x: pr.x - pr.w * 0.4, y: pr.y - pr.h * 0.4, w: pr.w * 0.8, h: pr.h * 0.8 };
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
}
