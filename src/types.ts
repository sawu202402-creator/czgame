export type GameMode = 'standard' | 'endless';

export type AdPlacement =
  | 'revive_shockwave'
  | 'starter_super_crate'
  | 'relic_take_all'
  | 'hq_ammo_turret'
  | 'electric_fortify'
  | 'settlement_multiplier'
  | 'armory_free_cash';

export interface WeaponDef {
  id: string;
  name: string;
  superName: string;
  category: 'sidearm' | 'light' | 'rifle' | 'heavy';
  shopCost: number;
  ammoCost: number;
  unlockRoomsRequired: number; // 0 = immediate, 1 = unlock 1 room, 2 = unlock 2 rooms
  desc: string;
  superDesc: string;
  color: string;
  superColor: string;
  damage: number;
  fireRate: number;
  magSize: number;
  maxReserve: number; // -1 for infinite
  reloadTime: number;
  pellets: number;
  spread: number;
  bulletSpeed: number;
  knockback: number;
  pierce: number;
  moveSpeedMult: number;
  flame?: boolean;
  cryo?: boolean;
  electric?: boolean;
  laser?: boolean;
  sawblade?: boolean;
  bounces?: number;
  akimboOnEvolve?: boolean;
  explosiveRadius?: number; // for grenade launcher / crossbow!
}

export interface WeaponInstance {
  defId: string;
  evolved: boolean;
  mag: number;
  reserve: number;
  tempWavesLeft?: number;
}

export interface InRunPerkDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  color: string;
  apply: (stats: RunModifiers) => void;
}

export interface RelicDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  rarity: 'rare' | 'epic' | 'legendary';
}

export type PowerUpType = 'overdrive' | 'nuke' | 'carpenter' | 'double_cash' | 'freeze';

export interface RunModifiers {
  damageMult: number;
  reloadMult: number;
  magMult: number;
  moveSpeedMult: number;
  extraPierce: number;
  extraPellets: number;
  critChance: number;
  repairHealRatio: number;
  cashMult: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type FloorTheme = 'lobby' | 'armory' | 'lab' | 'mall' | 'asphalt';

export interface RoomConfig {
  id: string;
  name: string;
  floorTheme: FloorTheme;
  rects: Rect[]; // Supports L-shaped, T-shaped, corridors, irregular rooms!
  labelPos: { x: number; y: number };
  initiallyUnlocked: boolean;
}

export interface DoorConfig {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  orientation: 'horizontal' | 'vertical';
  roomA: string;
  roomB: string;
  unlockRoomId: string;
  cost: number;
  label: string;
}

export interface WindowConfig {
  id: string;
  roomId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  orientation: 'horizontal' | 'vertical';
  spawnOutsideOffset: { dx: number; dy: number };
}

export type PropKind = 'desk' | 'crates' | 'swat_van' | 'fountain';

export interface InteriorPropConfig {
  id: string;
  roomId: string;
  kind: PropKind;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  blocksBullets: boolean; // Low cover (desk/fountain) lets bullets fly over; tall cover (crates/van) blocks bullets!
}

export type StationType =
  | 'armory_kiosk'
  | 'ammo_box'
  | 'pack_a_punch'
  | 'mech_dog_cage'
  | 'vending_machine'
  | 'laser_trap'
  | 'starter_airdrop';

export interface StationConfig {
  id: string;
  roomId: string;
  type: StationType;
  x: number;
  y: number;
  cost: number;
  weaponId?: string;
  label: string;
  subLabel?: string;
}

export interface StageDef {
  id: string;
  index: number;
  name: string;
  subtitle: string;
  wallColor: string;
  wallTopColor: string;
  gridCols: number;
  gridRows: number;
  cellSize: number; // 40px
  worldWidth: number;
  worldHeight: number;
  buildingBounds: Rect;
  playerSpawn: { x: number; y: number };
  helipadPos: { x: number; y: number };
  rooms: RoomConfig[];
  walls: Rect[];
  doors: DoorConfig[];
  windows: WindowConfig[];
  props: InteriorPropConfig[];
  stations: StationConfig[];
  barrels: { x: number; y: number; roomId: string }[];
}

export interface AgentUpgradeLevels {
  hp: number;
  reload: number;
  speed: number;
  repair: number;
  startCash: number;
}

export interface SaveData {
  agentLevel: number;
  agentXp: number;
  gold: number;
  upgrades: AgentUpgradeLevels;
  clearedStages: string[];
  endlessBestWave: Record<string, number>;
  totalRuns: number;
  freeStarterUsedCount: number;
  freeHqSupportUsed: boolean;
}
