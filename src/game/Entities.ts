import {
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

export type ZombieKind = 'walker' | 'runner' | 'spitter' | 'thief' | 'miniboss' | 'boss';

export interface RuntimeRoom extends RoomConfig {
  unlocked: boolean;
}

export interface RuntimeWindow extends WindowConfig {
  planks: number;
  maxPlanks: number;
  attackCooldown: number;
}

export interface RuntimeDoor extends DoorConfig {
  unlocked: boolean;
  progress: number;
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
  electric: boolean;
  laser: boolean;
  hitIds: Set<number>;
  life: number;
}

export interface GrenadeEntity {
  x: number;
  y: number;
  vx: number;
  vy: number;
  z: number; // height above floor
  vz: number;
  fuse: number;
  damage: number;
  radius: number;
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
  zombiesRemainingInWave: number;
  cash: number;
  battleLevel: number;
  battleXp: number;
  battleXpNext: number;
  kills: number;
  fever: number;
  feverTimer: number;
  electricFortifyWaves: number;
  powerUpTimers: Record<PowerUpType, number>;
  player: {
    x: number;
    y: number;
    radius: number;
    angle: number;
    hp: number;
    maxHp: number;
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
  spits: AcidSpitEntity[];
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
