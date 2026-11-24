import { ZombieKind } from '../data/enemies';
import { I18n } from '../i18n/I18n';
import { DifficultyTier, ParagonKey } from '../types';

// ==================== 1. 三大危机星级难度（★ 标准 / ★★ 噩梦 / ★★★ 炼狱） ====================

export interface DifficultyTierMeta {
  tier: DifficultyTier;
  stars: string;
  color: string;
  hpMult: number;
  dmgMult: number;
  speedMult: number;
  countMult: number;
  rewardMult: number;
  clearTechCores: number;
  doubleBossOnFinal: boolean;
  periodicBlackout: boolean;
  hazardCdMult: number;
  zhName: string;
  enName: string;
  zhRule: string;
  enRule: string;
}

export const DIFFICULTY_TIERS: Record<DifficultyTier, DifficultyTierMeta> = {
  1: {
    tier: 1,
    stars: '★',
    color: '#4ade80',
    hpMult: 1.0,
    dmgMult: 1.0,
    speedMult: 1.0,
    countMult: 1.0,
    rewardMult: 1.0,
    clearTechCores: 0,
    doubleBossOnFinal: false,
    periodicBlackout: false,
    hazardCdMult: 1.0,
    zhName: '★ 标准行动',
    enName: '★ Normal Ops',
    zhRule: '标准尸潮强度 · 通关当前战区后解锁 ★★ 噩梦难度',
    enRule: 'Standard horde intensity · Clear to unlock ★★ Nightmare Tier',
  },
  2: {
    tier: 2,
    stars: '★★',
    color: '#f59e0b',
    hpMult: 2.15,
    dmgMult: 1.42,
    speedMult: 1.12,
    countMult: 1.25,
    rewardMult: 1.85,
    clearTechCores: 2,
    doubleBossOnFinal: false,
    periodicBlackout: false,
    hazardCdMult: 0.82,
    zhName: '★★ 噩梦危机',
    enName: '★★ Nightmare',
    zhRule: '丧尸血量 ×2.15 · 移速 +12% · 危机事件加速 ｜ 结算金币经验 ×1.85 + 必掉 2 枚战术核心💠',
    enRule: 'Horde HP ×2.15 · Speed +12% · Faster Hazards ｜ Rewards ×1.85 + 2 Tech Cores 💠',
  },
  3: {
    tier: 3,
    stars: '★★★',
    color: '#f43f5e',
    hpMult: 3.6,
    dmgMult: 1.9,
    speedMult: 1.2,
    countMult: 1.45,
    rewardMult: 3.0,
    clearTechCores: 5,
    doubleBossOnFinal: true,
    periodicBlackout: true,
    hazardCdMult: 0.68,
    zhName: '★★★ 炼狱死斗',
    enName: '★★★ Hell Inferno',
    zhRule: '血量 ×3.6 · 双倍终局尸王同屏 · 断电夜战突袭 ｜ 结算金币经验 ×3.0 + 必掉 5 枚战术核心💠',
    enRule: 'HP ×3.6 · Twin Final Bosses · Blackout Raids ｜ Rewards ×3.0 + 5 Tech Cores 💠',
  },
};

export function getDifficultyMeta(tier: DifficultyTier): DifficultyTierMeta {
  return DIFFICULTY_TIERS[tier] || DIFFICULTY_TIERS[1];
}

// ==================== 2. 八大战区阶梯难度、专属怪物生态与动态环境机关 ====================

export type StageHazardKind =
  | 'swat_flare'
  | 'neon_overcharge'
  | 'cryo_leak'
  | 'bio_spore'
  | 'mortar_barrage'
  | 'blackout'
  | 'airstrike'
  | 'reactor_meltdown';

export interface StageEcologyConfig {
  stageId: string;
  hpMult: number;
  dmgMult: number;
  speedMult: number;
  countBonus: number;
  rewardMult: number;
  miniBossStartWave: number;
  extraMiniBoss: number;
  weights: Partial<Record<ZombieKind, number>>; // 专属怪群权重（第 1 波起即按战区特色刷出！）
  hazardKind: StageHazardKind;
  hazardInterval: number;
  zhEcologyTag: string;
  enEcologyTag: string;
  zhHazardBanner: string;
  enHazardBanner: string;
}

export const STAGE_ECOLOGY_MAP: Record<string, StageEcologyConfig> = {
  stage_police: {
    stageId: 'stage_police',
    hpMult: 1.0,
    dmgMult: 1.0,
    speedMult: 1.0,
    countBonus: 0,
    rewardMult: 1.0,
    miniBossStartWave: 5,
    extraMiniBoss: 0,
    weights: { walker: 0.42, runner: 0.16, spitter: 0.18, riot: 0.18, boomer: 0.06 },
    hazardKind: 'swat_flare',
    hazardInterval: 34,
    zhEcologyTag: '🛡️ 防暴盾卫群 · 闪光震爆支援',
    enEcologyTag: '🛡️ Riot Shielders · SWAT Stun Drops',
    zhHazardBanner: '🚨 警局战术支援：空投闪光震爆弹麻痹尸群（防暴盾卫增援逼近）！',
    enHazardBanner: '🚨 Precinct Event: Orbital Stun Flare Deployed — Riot Breachers Inbound!',
  },
  stage_mall: {
    stageId: 'stage_mall',
    hpMult: 1.32,
    dmgMult: 1.1,
    speedMult: 1.05,
    countBonus: 4,
    rewardMult: 1.18,
    miniBossStartWave: 5,
    extraMiniBoss: 0,
    weights: { walker: 0.2, runner: 0.42, spitter: 0.18, boomer: 0.12, frost: 0.08 },
    hazardKind: 'neon_overcharge',
    hazardInterval: 32,
    zhEcologyTag: '⚡ 极速狂奔潮 · 霓虹高压电涌',
    enEcologyTag: '⚡ Sprinter Swarm · Neon Power Surge',
    zhHazardBanner: '⚡ 商场霓虹超载：特工移速飙升 + 电弧轰击地面，盗宝小丑趁乱出没！',
    enHazardBanner: '⚡ Mall Neon Surge: Agent Speed Boost + Floor Arcs — Loot Thief Spotted!',
  },
  stage_lab: {
    stageId: 'stage_lab',
    hpMult: 1.72,
    dmgMult: 1.22,
    speedMult: 1.08,
    countBonus: 7,
    rewardMult: 1.38,
    miniBossStartWave: 4,
    extraMiniBoss: 0,
    weights: { walker: 0.24, frost: 0.28, spitter: 0.28, runner: 0.2 },
    hazardKind: 'cryo_leak',
    hazardInterval: 30,
    zhEcologyTag: '❄️ 冰晶酸液潮 · 液氮管道泄露',
    enEcologyTag: '❄️ Cryo-Acid Breach · Nitrogen Leaks',
    zhHazardBanner: '❄️ 实验室警报：低温液氮管道破裂！注意避开蓝色极寒喷口（可冻伤尸群）！',
    enHazardBanner: '❄️ Lab Alert: Liquid Nitrogen Pipe Rupture! Lure hordes into Cryo Vents!',
  },
  stage_hospital: {
    stageId: 'stage_hospital',
    hpMult: 2.2,
    dmgMult: 1.34,
    speedMult: 1.11,
    countBonus: 10,
    rewardMult: 1.6,
    miniBossStartWave: 4,
    extraMiniBoss: 1,
    weights: { walker: 0.18, necro: 0.2, boomer: 0.24, spitter: 0.22, runner: 0.16 },
    hazardKind: 'bio_spore',
    hazardInterval: 30,
    zhEcologyTag: '🔮 巫医自爆潮 · 疫区剧毒孢子雾',
    enEcologyTag: '🔮 Necro & Boomers · Bio-Spore Fog',
    zhHazardBanner: '☣️ 急诊室疫雾泄露：剧毒孢子团正在扩散，切勿在绿雾区停留！',
    enHazardBanner: '☣️ Bio-Hazard Alert: Toxic Spore Clouds Expanding — Stay Clear of Green Zones!',
  },
  stage_harbor: {
    stageId: 'stage_harbor',
    hpMult: 2.75,
    dmgMult: 1.48,
    speedMult: 1.14,
    countBonus: 14,
    rewardMult: 1.88,
    miniBossStartWave: 3,
    extraMiniBoss: 1,
    weights: { riot: 0.26, boomer: 0.22, runner: 0.2, spitter: 0.2, walker: 0.12 },
    hazardKind: 'mortar_barrage',
    hazardInterval: 28,
    zhEcologyTag: '💥 重盾破阵潮 · 舰炮火力覆盖',
    enEcologyTag: '💥 Heavy Breachers · Naval Barrage',
    zhHazardBanner: '💣 港口舰炮轰击：红圈预警区即将落弹（可引诱重盾尸群进入轰炸圈）！',
    enHazardBanner: '💣 Naval Artillery Incoming: Dodge Red Target Rings — Bait Zombies Inside!',
  },
  stage_subway: {
    stageId: 'stage_subway',
    hpMult: 3.4,
    dmgMult: 1.62,
    speedMult: 1.17,
    countBonus: 18,
    rewardMult: 2.18,
    miniBossStartWave: 3,
    extraMiniBoss: 1,
    weights: { runner: 0.34, spitter: 0.18, necro: 0.16, frost: 0.16, boomer: 0.1, riot: 0.06 },
    hazardKind: 'blackout',
    hazardInterval: 32,
    zhEcologyTag: '🔦 暗影猎杀潮 · 隧道断电夜战',
    enEcologyTag: '🔦 Shadow Stalkers · Tunnel Blackout',
    zhHazardBanner: '🔦 地铁全线断电：已自动开启战术手电筒与夜视仪，小心黑暗突袭！',
    enHazardBanner: '🔦 Subway Power Outage: Tactical Flashlight Engaged — Watch Your Flanks!',
  },
  stage_airbase: {
    stageId: 'stage_airbase',
    hpMult: 4.15,
    dmgMult: 1.78,
    speedMult: 1.2,
    countBonus: 22,
    rewardMult: 2.55,
    miniBossStartWave: 2,
    extraMiniBoss: 2,
    weights: { riot: 0.26, spitter: 0.22, frost: 0.18, necro: 0.14, runner: 0.2 },
    hazardKind: 'airstrike',
    hazardInterval: 27,
    zhEcologyTag: '✈️ 暴君装甲师 · 机库地毯轰炸',
    enEcologyTag: '✈️ Armored Division · Carpet Airstrike',
    zhHazardBanner: '✈️ 空军精确制导轰炸：多连发航弹锁定战场，注意规避红色轰炸圈！',
    enHazardBanner: '✈️ Tactical Airstrike Inbound: Multiple Bombing Zones Locked!',
  },
  stage_bunker: {
    stageId: 'stage_bunker',
    hpMult: 5.0,
    dmgMult: 1.95,
    speedMult: 1.24,
    countBonus: 26,
    rewardMult: 3.0,
    miniBossStartWave: 2,
    extraMiniBoss: 2,
    weights: { necro: 0.2, riot: 0.22, frost: 0.18, boomer: 0.18, spitter: 0.22 },
    hazardKind: 'reactor_meltdown',
    hazardInterval: 26,
    zhEcologyTag: '☢️ 全变异终局军团 · 核芯断电脉冲',
    enEcologyTag: '☢️ Apex Mutants · Reactor Meltdown',
    zhHazardBanner: '☢️ 零号地堡核芯过载：断电夜战 + 高能等离子辐射圈爆发！',
    enHazardBanner: '☢️ Core Meltdown: Blackout Engaged + High-Energy Plasma Detonations!',
  },
};

export function getStageEcology(stageId: string): StageEcologyConfig {
  return STAGE_ECOLOGY_MAP[stageId] || STAGE_ECOLOGY_MAP.stage_police;
}

// ==================== 3. 15 把武器独立专精突破（★1 ~ ★5 黄金觉醒） ====================

export const WEAPON_MASTERY_MAX = 5;
const MASTERY_GOLD_COSTS = [350, 650, 1100, 1750, 2600];

export function getWeaponMasteryCost(curRank: number): { gold: number; cores: number } {
  const r = Math.max(0, Math.min(WEAPON_MASTERY_MAX - 1, curRank));
  // ★4 和 ★5 黄金突破可选消耗少量战术核心（或金币充足直接突破）
  return {
    gold: MASTERY_GOLD_COSTS[r],
    cores: r === 4 ? 2 : r === 3 ? 1 : 0,
  };
}

export interface WeaponMasteryBonuses {
  rank: number;
  damageMult: number;
  capacityMult: number;
  costMult: number;
  bonusPierce: number;
  bonusCrit: number;
  isGoldenAwakened: boolean;
}

export function getWeaponMasteryBonuses(rank: number): WeaponMasteryBonuses {
  const r = Math.max(0, Math.min(WEAPON_MASTERY_MAX, rank || 0));
  return {
    rank: r,
    damageMult: 1 + r * 0.09 + (r >= 5 ? 0.15 : 0), // ★5 累计 +60% 专精伤！
    capacityMult: 1 + r * 0.07, // ★5 累计 +35% 弹夹与备弹
    costMult: Math.max(0.65, 1 - r * 0.04),
    bonusPierce: r >= 3 ? 1 : 0,
    bonusCrit: r >= 3 ? 0.08 : 0,
    isGoldenAwakened: r >= 5,
  };
}

export function getWeaponAwakeningDesc(weaponId: string): string {
  const zh = I18n.isZh();
  if (weaponId === 'shotgun' || weaponId === 'autoshotgun') {
    return zh
      ? '★5黄金觉醒：每次开火额外迸发 +2 颗黄金破片弹丸，进化费用立减 25%'
      : '★5 Golden Awakening: Fires +2 extra golden pellets per blast & -25% Evolve cost';
  }
  if (weaponId === 'sniper' || weaponId === 'crossbow' || weaponId === 'tesla' || weaponId === 'plasma') {
    return zh
      ? '★5黄金觉醒：命中必定跃迁 2 道黄金高压电弧轰击周围目标，进化立减 25%'
      : '★5 Golden Awakening: Hits chain 2 Golden Lightning Arcs to nearby foes & -25% Evolve cost';
  }
  if (weaponId === 'flamethrower' || weaponId === 'cryogun' || weaponId === 'launcher' || weaponId === 'sawlauncher') {
    return zh
      ? '★5黄金觉醒：爆炸/喷流范围扩大 +28%，锯片/榴弹额外弹射爆裂，进化立减 25%'
      : '★5 Golden Awakening: +28% Blast/Stream radius + extra ricochet/cluster & -25% Evolve cost';
  }
  return zh
    ? '★5黄金觉醒：黄金流光弹道，每第 5 发子弹触发高爆金弹轰击尸群，进化立减 25%'
    : '★5 Golden Awakening: Every 5th shot detonates a High-Ex Golden Blast & -25% Evolve cost';
}

// ==================== 4. 战术芯片流派装配系统（9 大核心模组 · 3 槽自由构筑） ====================

export const MAX_EQUIPPED_CHIPS = 3;
export const CHIP_MAX_LEVEL = 5;

export interface TacticalChipDef {
  id: string;
  sprite: string;
  color: string;
  baseGoldCost: number;
  coreCost: number;
  zhName: string;
  enName: string;
  zhDesc: (lvl: number) => string;
  enDesc: (lvl: number) => string;
}

export const TACTICAL_CHIPS: TacticalChipDef[] = [
  {
    id: 'chip_berserker',
    sprite: './assets/relic_napalm.png',
    color: '#ef4444',
    baseGoldCost: 550,
    coreCost: 1,
    zhName: '狂战超频芯',
    enName: 'Berserk Overclock',
    zhDesc: (lv) => `全武器伤害 +${12 + lv * 5}%；生命低于 65% 时射速再 +${15 + lv * 4}%`,
    enDesc: (lv) => `All Weapon DMG +${12 + lv * 5}%; +${15 + lv * 4}% Fire Rate below 65% HP`,
  },
  {
    id: 'chip_vampire',
    sprite: './assets/relic_vamp_core.png',
    color: '#ec4899',
    baseGoldCost: 600,
    coreCost: 1,
    zhName: '嗜血纳米核',
    enName: 'Vampiric Nanocore',
    zhDesc: (lv) => `击杀回血效率提升 +${4 + lv * 2}%，满血时溢出治疗转化为 +${2 + lv} 点护甲`,
    enDesc: (lv) => `Kill Siphon +${4 + lv * 2}% HP; overheal grants +${2 + lv} Kevlar Armor`,
  },
  {
    id: 'chip_thunder',
    sprite: './assets/relic_tesla_boots.png',
    color: '#38bdf8',
    baseGoldCost: 650,
    coreCost: 1,
    zhName: '雷神电弧芯',
    enName: 'Mjolnir Arc Chip',
    zhDesc: (lv) => `任何武器射击有 ${14 + lv * 4}% 概率触发连锁闪电轰击 3 个目标`,
    enDesc: (lv) => `${14 + lv * 4}% chance on any shot to chain lightning across 3 zombies`,
  },
  {
    id: 'chip_bottomless',
    sprite: './assets/prop_ammo_box.png',
    color: '#facc15',
    baseGoldCost: 580,
    coreCost: 1,
    zhName: '无底弹鼓芯',
    enName: 'Bottomless Drum',
    zhDesc: (lv) => `开火有 ${16 + lv * 5}% 概率不消耗子弹，且换弹速度额外 +${10 + lv * 3}%`,
    enDesc: (lv) => `${16 + lv * 5}% chance shots cost 0 ammo + Reload Speed +${10 + lv * 3}%`,
  },
  {
    id: 'chip_architect',
    sprite: './assets/item_emp_grid.png',
    color: '#22d3ee',
    baseGoldCost: 620,
    coreCost: 1,
    zhName: '防线总师芯',
    enName: 'Fortress Architect',
    zhDesc: (lv) => `开局自动将出生房窗户升为合金电网，哨戒炮伤害与时长 +${18 + lv * 6}%`,
    enDesc: (lv) => `Start with Room 1 Alloy Shock Windows + Turret DMG/Duration +${18 + lv * 6}%`,
  },
  {
    id: 'chip_boss_slayer',
    sprite: './assets/gun_sniper.png',
    color: '#a855f7',
    baseGoldCost: 680,
    coreCost: 2,
    zhName: '弑君重装芯',
    enName: 'Bossbreaker Core',
    zhDesc: (lv) => `对精英暴君与各关 Boss 造成 +${22 + lv * 7}% 巨额增伤，受 Boss 伤害 -${10 + lv * 3}%`,
    enDesc: (lv) => `+${22 + lv * 7}% Bonus DMG vs Elites & Bosses, -${10 + lv * 3}% Boss DMG taken`,
  },
  {
    id: 'chip_cryo_nova',
    sprite: './assets/gun_cryogun.png',
    color: '#7dd3fc',
    baseGoldCost: 560,
    coreCost: 1,
    zhName: '极寒新星芯',
    enName: 'Cryo Nova Matrix',
    zhDesc: (lv) => `释放 [F] 职业大招时额外爆发极寒冰环冻结周围尸潮，冰冻弹率 +${12 + lv * 4}%`,
    enDesc: (lv) => `Using [F] Skill unleashes a Freezing Nova + Cryo Shot chance +${12 + lv * 4}%`,
  },
  {
    id: 'chip_demolition',
    sprite: './assets/relic_cluster_core.png',
    color: '#fb923c',
    baseGoldCost: 600,
    coreCost: 1,
    zhName: '毁灭爆破芯',
    enName: 'Demolition Matrix',
    zhDesc: (lv) => `所有爆炸与红油桶伤害 +${20 + lv * 7}%，每过一波自动免费补给 +1 颗手雷`,
    enDesc: (lv) => `All Explosion/Barrel DMG +${20 + lv * 7}% & regenerate +1 Grenade each wave`,
  },
  {
    id: 'chip_midas',
    sprite: './assets/relic_war_bonds.png',
    color: '#4ade80',
    baseGoldCost: 520,
    coreCost: 0,
    zhName: '黄金财阀芯',
    enName: 'Midas Syndicate',
    zhDesc: (lv) => `局内钞票掉落 +${16 + lv * 5}%，局外结算金币与经验收益额外 +${15 + lv * 5}%`,
    enDesc: (lv) => `In-run Cash +${16 + lv * 5}% & Settlement Gold/XP +${15 + lv * 5}%`,
  },
];

export function getChipUpgradeCost(def: TacticalChipDef, curLvl: number): { gold: number; cores: number } {
  return {
    gold: Math.round(def.baseGoldCost * (1 + curLvl * 0.65)),
    cores: curLvl === 0 ? def.coreCost : Math.max(1, def.coreCost + Math.floor(curLvl / 2)),
  };
}

// ==================== 5. 无限巅峰军衔突破（Paragon Levels — 无上限金币回收池） ====================

export interface ParagonTrackDef {
  key: ParagonKey;
  sprite: string;
  color: string;
  zhName: string;
  enName: string;
  zhVal: (lv: number) => string;
  enVal: (lv: number) => string;
}

export const PARAGON_TRACKS: ParagonTrackDef[] = [
  {
    key: 'might',
    sprite: './assets/gun_plasma.png',
    color: '#f97316',
    zhName: '🔥 无限火力巅峰',
    enName: '🔥 Apex Firepower',
    zhVal: (lv) => `全伤害 +${(lv * 2.5).toFixed(1)}%`,
    enVal: (lv) => `All DMG +${(lv * 2.5).toFixed(1)}%`,
  },
  {
    key: 'haste',
    sprite: './assets/prop_laser_tower.png',
    color: '#38bdf8',
    zhName: '⚡ 无限超频巅峰',
    enName: '⚡ Apex Overclock',
    zhVal: (lv) => `射速 +${(lv * 1.5).toFixed(1)}% · 大招冷却 -${Math.min(40, lv * 1.2).toFixed(1)}%`,
    enVal: (lv) => `Fire Rate +${(lv * 1.5).toFixed(1)}% · Skill CD -${Math.min(40, lv * 1.2).toFixed(1)}%`,
  },
  {
    key: 'fortune',
    sprite: './assets/ui_coin.png',
    color: '#facc15',
    zhName: '💰 无限财阀巅峰',
    enName: '💰 Apex Fortune',
    zhVal: (lv) => `结算金币 +${lv * 3}% · 开局钞票 +$${lv * 15}`,
    enVal: (lv) => `Gold Gain +${lv * 3}% · Start Cash +$${lv * 15}`,
  },
  {
    key: 'vitality',
    sprite: './assets/item_armor.png',
    color: '#4ade80',
    zhName: '🛡️ 无限不朽巅峰',
    enName: '🛡️ Apex Juggernaut',
    zhVal: (lv) => `最大生命 +${lv * 12} · 每波回甲 +${lv * 2}`,
    enVal: (lv) => `Max HP +${lv * 12} · Wave Armor +${lv * 2}`,
  },
];

export function getParagonCost(curLevel: number): number {
  return Math.round(450 + curLevel * 180 + Math.pow(curLevel, 1.35) * 45);
}
