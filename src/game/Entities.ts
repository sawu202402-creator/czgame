import {
  AgentClassId,
  DoorConfig,
  GameMode,
  InteriorPropConfig,
  PowerUpType,
  Rect,
  RoomConfig,
  RunModifiers,
  StageDef,
  StationConfig,
  WeaponInstance,
  WindowConfig,
} from '../types';
import { RemotePlayerState } from '../net/CoopProtocol';

export type ZombieKind = 'walker' | 'runner' | 'spitter' | 'thief' | 'miniboss' | 'boss';

export interface RuntimeRoom extends RoomConfig {
  unlocked: boolean;
}

export interface RuntimeWindow extends WindowConfig {
  planks: number;
  maxPlanks: number;
  armorPlanks: number;
  fortifyProgress: number;
  attackCooldown: number;
}

export interface RuntimeDoor extends DoorConfig {
  unlocked: boolean;
  progress: number;
  paidAmount: number;
}

export interface RuntimeStation extends StationConfig {
  used: boolean;
  progress: number;
  activeTimer: number;
}

export interface ZombieEntity {
  id: number;
  kind: ZombieKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  cashReward: number;
  xpReward: number;
  color: string;
  targetWindowId: string | null;
  insideBuilding: boolean;
  hitFlash: number;
  burnTimer: number;
  slowTimer: number;
  stunTimer: number;
  attackCd: number;
  rangedCd: number;
  fleeTimer: number;
  wobblePhase: number;
  facingAngle: number;
  attackAnim: number;
  attackState: 'none' | 'windup' | 'slash' | 'recover';
  attackStateTimer: number;
  slashAngle: number;
  recoilVx: number;
  recoilVy: number;
  netTx?: number;
  netTy?: number;
  extrapAge?: number;
}

export interface BulletEntity {
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
  hitIds: Set<number>;
  life: number;
  localVisualOnly?: boolean;
}

export interface GrenadeEntity {
  x: number;
  y: number;
  vx: number;
  vy: number;
  z: number; // height above floor
  vz: number;
  fuse: number;
  maxFuse: number;
  spinAngle: number;
  damage: number;
  radius: number;
}

export interface ExplosionFX {
  x: number;
  y: number;
  radius: number;
  life: number;
  maxLife: number;
  seed: number;
}

export interface AcidSpitEntity {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  life: number;
}

export interface AcidPoolEntity {
  x: number;
  y: number;
  radius: number;
  life: number;
  maxLife: number;
  isBoss: boolean;
}

export interface DropItem {
  id: number;
  kind: 'cash' | 'xp' | 'powerup';
  powerUp?: PowerUpType;
  value: number;
  x: number;
  y: number;
  life: number;
  bobPhase: number;
}

export interface TreasureChestEntity {
  id: number;
  x: number;
  y: number;
  roomId: string;
  progress: number;
  bobPhase: number;
}

export interface BarrelEntity {
  x: number;
  y: number;
  roomId: string;
  alive: boolean;
  respawnWaves: number;
}

export interface GroundDecal {
  x: number;
  y: number;
  radius: number;
  color: string;
  life: number;
  maxLife: number;
  seed: number;
  isScorch?: boolean;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
  isShell?: boolean;
  isSmoke?: boolean;
  isShard?: boolean;
  angle?: number;
}

export interface FloatingText {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  scale: number;
  life: number;
  maxLife: number;
}

export interface LightningArc {
  points: { x: number; y: number }[];
  color: string;
  life: number;
}

export interface TurretEntity {
  x: number;
  y: number;
  angle: number;
  fireCd: number;
  life: number;
}

export interface MechDogEntity {
  active: boolean;
  x: number;
  y: number;
  angle: number;
  biteCd: number;
}

export interface RunSnapshot {
  stage: StageDef;
  mode: GameMode;
  wave: number;
  maxWaves: number;
  waveState: 'fighting' | 'intermission' | 'extraction' | 'ended';
  intermissionTimer: number;
  extractionProgress: number;
  extractionTimer: number;
  lootToast: {
    sprite: string;
    badge: string;
    title: string;
    desc: string;
    color: string;
    timer: number;
  } | null;
  zombiesRemainingInWave: number;
  cash: number;
  battleLevel: number;
  battleXp: number;
  battleXpNext: number;
  kills: number;
  fever: number;
  feverTimer: number;
  electricFortifyWaves: number;
  repairsPaidThisWave: number;
  powerUpTimers: Record<PowerUpType, number>;
  isCoop: boolean;
  localSlot: number;
  localCallsign: string;
  squadCount: number;
  remotePlayers: RemotePlayerState[];
  lastPrimaryWeaponId: string | null;
  classId: AgentClassId;
  skillCooldown: number;
  skillMaxCooldown: number;
  lastRecordedKills: number;
  lastRecordedWave: number;
  player: {
    x: number;
    y: number;
    radius: number;
    angle: number;
    hp: number;
    maxHp: number;
    armor: number;
    maxArmor: number;
    downed: boolean;
    spectating: boolean;
    bleedoutTimer: number;
    reviveProgress: number;
    hitFlashTimer: number;
    invulnTimer: number;
    weapons: WeaponInstance[];
    activeSlot: number;
    grenades: number;
    grenadeCooldown: number;
    reloadTimer: number;
    reloadDuration: number;
    fireCooldown: number;
    muzzleFlashTimer: number;
    repairProgress: number;
    walkPhase: number;
    legAngle: number;
    isMoving: boolean;
    recoilOffset: number;
    barrelSpin: number;
    weaponSwapTimer: number;
    akimboAlt: boolean;
    footDustCd: number;
    distanceAccum: number;
    vampCounter: number;
  };
  mapRevision: number;
  modifiers: RunModifiers;
  relicIds: string[];
  rooms: RuntimeRoom[];
  windows: RuntimeWindow[];
  doors: RuntimeDoor[];
  props: InteriorPropConfig[];
  stations: RuntimeStation[];
  walls: Rect[];
  barrels: BarrelEntity[];
  zombies: ZombieEntity[];
  bullets: BulletEntity[];
  grenadesThrown: GrenadeEntity[];
  explosions: ExplosionFX[];
  spits: AcidSpitEntity[];
  acidPools: AcidPoolEntity[];
  drops: DropItem[];
  chests: TreasureChestEntity[];
  turrets: TurretEntity[];
  mechDog: MechDogEntity;
  decals: GroundDecal[];
  particles: Particle[];
  floatingTexts: FloatingText[];
  lightnings: LightningArc[];
  bannerText: string;
  bannerTimer: number;
  reviveUsed: boolean;
  hqSupportCooldown: number;
  armoryAdCooldown: number;
  camera: { x: number; y: number; zoom: number; shake: number };
}
