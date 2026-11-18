import { DifficultyTier, GameMode, PowerUpType } from '../types';
import { ZombieKind } from '../game/Entities';

export const SQUAD_SLOTS = [
  { slot: 0, label: 'P1 队长', color: '#38bdf8', badgeBg: '#0284c7' },
  { slot: 1, label: 'P2 突击', color: '#4ade80', badgeBg: '#16a34a' },
  { slot: 2, label: 'P3 重装', color: '#facc15', badgeBg: '#ca8a04' },
  { slot: 3, label: 'P4 侦察', color: '#fb7185', badgeBg: '#e11d48' },
] as const;

export interface CoopScalingInfo {
  playerCount: number;
  countMult: number;
  hpMult: number;
  dmgMult: number;
  doorCostMult: number;
  maxActiveZombies: number;
  spawnRateMult: number;
  extraMiniBoss: number;
}

/**
 * 1~4 人动态难度缩放公式：
 * 人数越多，四面八方涌入的尸潮规模、同屏上限、僵尸/Boss血量、精英暴君数量同步跃升！
 */
export function getCoopScaling(playerCount: number): CoopScalingInfo {
  const n = Math.max(1, Math.min(4, Math.round(playerCount)));
  if (n <= 1) {
    return {
      playerCount: 1,
      countMult: 1,
      hpMult: 1,
      dmgMult: 1,
      doorCostMult: 1,
      maxActiveZombies: 68,
      spawnRateMult: 1,
      extraMiniBoss: 0,
    };
  }
  return {
    playerCount: n,
    countMult: +(1 + 0.68 * (n - 1)).toFixed(2), // 2P: 1.68x, 3P: 2.36x, 4P: 3.04x
    hpMult: +(1 + 0.55 * (n - 1)).toFixed(2), // 2P: 1.55x, 3P: 2.10x, 4P: 2.65x
    dmgMult: +(1 + 0.12 * (n - 1)).toFixed(2), // 2P: 1.12x, 3P: 1.24x, 4P: 1.36x
    doorCostMult: +(1 + 0.25 * (n - 1)).toFixed(2), // 2P: 1.25x, 3P: 1.50x, 4P: 1.75x（支持全队合资开门）
    maxActiveZombies: 68 + (n - 1) * 15, // 2P: 83, 3P: 98, 4P: 113
    spawnRateMult: +(1 + 0.32 * (n - 1)).toFixed(2),
    extraMiniBoss: n >= 4 ? 2 : n >= 2 ? 1 : 0,
  };
}

export interface LobbyMember {
  peerId: string;
  slot: number;
  callsign: string;
  color: string;
  ready: boolean;
  isHost: boolean;
}

export interface LobbyState {
  roomCode: string;
  stageId: string;
  mode: GameMode;
  tier?: DifficultyTier;
  members: LobbyMember[];
  inGame: boolean;
}

export interface RemotePlayerState {
  peerId: string;
  slot: number;
  callsign: string;
  color: string;
  x: number;
  y: number;
  netTx: number;
  netTy: number;
  vx: number;
  vy: number;
  extrapAge: number;
  lastSeq: number;
  angle: number;
  netAngle: number;
  legAngle: number;
  walkPhase: number;
  isMoving: boolean;
  hp: number;
  maxHp: number;
  armor: number;
  maxArmor: number;
  downed: boolean;
  spectating: boolean;
  bleedoutTimer: number;
  reviveProgress: number;
  activeWepId: string;
  evolved: boolean;
  muzzleFlashTimer: number;
  recoilOffset: number;
  repairProgress: number;
  hitFlashTimer: number;
  invulnTimer: number;
  cash: number;
  kills: number;
}

export interface PlayerSyncPayload {
  seq: number;
  peerId: string;
  slot: number;
  callsign: string;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  legAngle: number;
  walkPhase: number;
  isMoving: boolean;
  hp: number;
  maxHp: number;
  armor: number;
  downed: boolean;
  spectating: boolean;
  bleedoutTimer: number;
  reviveProgress: number;
  activeWepId: string;
  evolved: boolean;
  muzzleFlash: boolean;
  recoilOffset: number;
  repairProgress: number;
  invuln: boolean;
  cash: number;
  kills: number;
}

export interface SerializedBullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  knockback: number;
  pierceLeft: number;
  bouncesLeft: number;
  explosiveRadius: number;
  color: string;
  isCrit: boolean;
  flame: boolean;
  cryo: boolean;
  electric: boolean;
  laser: boolean;
  sawblade: boolean;
  life: number;
}

export interface SerializedGrenade {
  x: number;
  y: number;
  vx: number;
  vy: number;
  z: number;
  vz: number;
  fuse: number;
  maxFuse: number;
  damage: number;
  radius: number;
}

export type ZombieNetTuple = [
  id: number,
  kind: ZombieKind,
  x: number,
  y: number,
  vx: number,
  vy: number,
  hp: number,
  maxHp: number,
  facing: number,
  atkState: 'none' | 'windup' | 'slash' | 'recover',
  atkAnim: number,
  slashAng: number,
  flags: number, // bit0: hitFlash, bit1: burn, bit2: slow, bit3: insideBuilding
  fleeTimer: number,
];

export interface WorldSyncPayload {
  seq: number;
  wave: number;
  waveState: 'fighting' | 'intermission' | 'extraction' | 'ended';
  intermissionTimer: number;
  extractionProgress: number;
  zombiesRemainingInWave: number;
  kills: number;
  fever: number;
  feverTimer: number;
  electricFortifyWaves: number;
  powerUpTimers: Record<PowerUpType, number>;
  squadCount: number;
  wins: number[];
  doors: [unlocked: number, paidAmount: number, progressPct: number][];
  stations: [used: number, progressPct: number, activeTimerTenths: number][];
  barrels: number[];
  chests: [id: number, x: number, y: number, roomId: string, progressPct: number][];
  turrets: [x: number, y: number, angle: number, life: number][];
  mechDog: [active: number, x: number, y: number, angle: number];
  zombies: ZombieNetTuple[];
  spits: [x: number, y: number, vx: number, vy: number, radius: number, pKind?: number][];
  pools: [x: number, y: number, radius: number, life: number, isBoss: number][];
  drops: [id: number, kind: 'cash' | 'xp' | 'powerup' | 'heal', powerUp: PowerUpType | '', val: number, x: number, y: number, life: number][];
  players: PlayerSyncPayload[];
}

export type CoopNetMessage =
  | { type: 'join_req'; callsign: string }
  | { type: 'join_ack'; ok: boolean; reason?: string; assignedPeerId?: string; slot?: number; lobby?: LobbyState }
  | { type: 'lobby_state'; lobby: LobbyState }
  | { type: 'ready_toggle'; ready: boolean; callsign: string }
  | { type: 'start_game'; stageId: string; mode: GameMode; lobby: LobbyState }
  | { type: 'player_sync'; p: PlayerSyncPayload }
  | { type: 'players_fast'; list: PlayerSyncPayload[] }
  | { type: 'world_sync'; w: WorldSyncPayload }
  | { type: 'cmd_fire'; ownerId: string; bullets: SerializedBullet[]; sfxKey: string; evolved: boolean }
  | { type: 'cmd_grenade'; ownerId: string; g: SerializedGrenade }
  | { type: 'cmd_repair_win'; ownerId: string; winId: string }
  | { type: 'cmd_fortify_win'; ownerId: string; winId: string }
  | { type: 'cmd_fund_door'; ownerId: string; doorId: string; amount: number }
  | { type: 'cmd_use_station'; ownerId: string; stationId: string }
  | { type: 'cmd_open_chest'; ownerId: string; chestId: number }
  | { type: 'cmd_deploy_turret'; ownerId: string; x: number; y: number; life: number }
  | { type: 'cmd_electric_fortify'; ownerId: string }
  | { type: 'cmd_revive_tick'; reviverId: string; reviverName: string; targetId: string; dt: number }
  | {
      type: 'evt_fx';
      kind: 'explode' | 'lightning' | 'floating' | 'banner';
      x?: number;
      y?: number;
      radius?: number;
      points?: { x: number; y: number }[];
      color?: string;
      text?: string;
      scale?: number;
      dur?: number;
    }
  | { type: 'evt_player_hit'; targetId: string; damage: number }
  | {
      type: 'evt_team_reward';
      targetId?: string; // undefined = 全队生效
      cashDelta?: number;
      xpDelta?: number;
      healRatio?: number;
      powerUp?: PowerUpType;
      grantChestRelic?: boolean;
      waveAutoRevive?: boolean;
    }
  | { type: 'evt_player_revived'; targetId: string; reviverId: string; reviverName: string }
  | { type: 'evt_run_finished'; victory: boolean };
