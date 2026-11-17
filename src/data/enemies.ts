import { SpriteKey } from '../game/AssetLoader';

export type BossKind =
  | 'boss_warden'
  | 'boss_chainsaw'
  | 'boss_venom'
  | 'boss_surgeon'
  | 'boss_kraken'
  | 'boss_tesla'
  | 'boss_cryo'
  | 'boss_overlord';

export type ZombieKind =
  | 'walker'
  | 'runner'
  | 'spitter'
  | 'boomer'
  | 'riot'
  | 'frost'
  | 'necro'
  | 'thief'
  | 'miniboss'
  | BossKind;

export interface BossProfile {
  kind: BossKind;
  stageId: string;
  sprite: SpriteKey;
  color: string;
  radius: number;
  hpMult: number;
  speedBase: number;
  zhName: string;
  enName: string;
  zhIntro: string;
  enIntro: string;
  zhRage: string;
  enRage: string;
}

export const STAGE_BOSS_PROFILES: BossProfile[] = [
  {
    kind: 'boss_warden',
    stageId: 'stage_police',
    sprite: 'boss_warden',
    color: '#3b82f6',
    radius: 50,
    hpMult: 1.0,
    speedBase: 102,
    zhName: '镇暴重盾局长',
    enName: 'Riot Shield Warden',
    zhIntro: '👑 镇暴重盾局长破门压境 · 正面防弹重盾减伤！',
    enIntro: '👑 Riot Shield Warden Incoming · Frontal Shield Armor!',
    zhRage: '🚨 重盾局长开启警笛狂暴冲锋，召唤防暴盾卫小队！',
    enRage: '🚨 Warden Enraged! Siren Charge + Riot Squad Summoned!',
  },
  {
    kind: 'boss_chainsaw',
    stageId: 'stage_mall',
    sprite: 'boss_chainsaw',
    color: '#ec4899',
    radius: 49,
    hpMult: 0.96,
    speedBase: 112,
    zhName: '电锯狂欢小丑',
    enName: 'Chainsaw Jester',
    zhIntro: '👑 电锯狂欢小丑杀入商场 · 小心飞旋锯片弹射！',
    enIntro: '👑 Chainsaw Jester Incoming · Watch Out for Ricochet Saws!',
    zhRage: '🪚 电锯小丑引擎过载狂飙，高速抛射夺命飞锯！',
    enRage: '🪚 Chainsaw Jester Overdrive! Rapid Sawblade Frenzy!',
  },
  {
    kind: 'boss_venom',
    stageId: 'stage_lab',
    sprite: 'boss_venom',
    color: '#84cc16',
    radius: 52,
    hpMult: 1.04,
    speedBase: 98,
    zhName: '零号毒液母体',
    enName: 'Subject Zero Matriarch',
    zhIntro: '👑 零号毒液母体突破培养舱 · 强酸毒池覆盖！',
    enIntro: '👑 Subject Zero Matriarch Escaped · Corrosive Acid Barrage!',
    zhRage: '🧪 毒液母体突变分裂，孵化自爆脓毒尸潮！',
    enRage: '🧪 Matriarch Mutated! Volatile Boomers Spawned!',
  },
  {
    kind: 'boss_surgeon',
    stageId: 'stage_hospital',
    sprite: 'boss_surgeon',
    color: '#f43f5e',
    radius: 50,
    hpMult: 1.02,
    speedBase: 106,
    zhName: '血疫外科屠夫',
    enName: 'Plague Surgeon',
    zhIntro: '👑 血疫外科屠夫降临 · 警惕骨锯飞刃与鲜血虹吸！',
    enIntro: '👑 Plague Surgeon Incoming · Bone-Saws & Blood Siphon!',
    zhRage: '💉 外科屠夫注射狂暴血清，召唤唤灵巫医助阵！',
    enRage: '💉 Plague Surgeon Injected Berserk Serum + Necromancers!',
  },
  {
    kind: 'boss_kraken',
    stageId: 'stage_harbor',
    sprite: 'boss_kraken',
    color: '#14b8a6',
    radius: 54,
    hpMult: 1.16,
    speedBase: 94,
    zhName: '深海铁锚巨兽',
    enName: 'Abyssal Dreadnought',
    zhIntro: '👑 深海铁锚巨兽登陆码头 · 范围震地冲击波预警！',
    enIntro: '👑 Abyssal Dreadnought Ashore · Anchor Shockwave Alert!',
    zhRage: '⚓ 铁锚巨兽掀起深海怒涛，环形铁锚震波连发！',
    enRage: '⚓ Dreadnought Unleashes Tidal Anchor Shockwaves!',
  },
  {
    kind: 'boss_tesla',
    stageId: 'stage_subway',
    sprite: 'boss_tesla',
    color: '#38bdf8',
    radius: 50,
    hpMult: 1.04,
    speedBase: 108,
    zhName: '高压电弧督军',
    enName: 'High-Voltage Conduit',
    zhIntro: '👑 高压电弧督军接管轨道 · 警惕雷霆闪现突袭！',
    enIntro: '👑 High-Voltage Conduit Online · Lightning Blink Alert!',
    zhRage: '⚡ 电弧督军超导过载，高频雷暴闪现轰击！',
    enRage: '⚡ Conduit Overloaded! High-Voltage Teleport Storm!',
  },
  {
    kind: 'boss_cryo',
    stageId: 'stage_airbase',
    sprite: 'boss_cryo',
    color: '#06b6d4',
    radius: 52,
    hpMult: 1.1,
    speedBase: 102,
    zhName: '极寒机甲统帅',
    enName: 'Cryo-Mech Warlord',
    zhIntro: '👑 极寒机甲统帅空降机库 · 绝对零度冰封齐射！',
    enIntro: '👑 Cryo-Mech Warlord Deployed · Sub-Zero Cryo Salvo!',
    zhRage: '❄️ 机甲统帅启动极寒风暴，召唤冰晶重装卫队！',
    enRage: '❄️ Cryo-Mech Blizzard Core Active + Frost Guard!',
  },
  {
    kind: 'boss_overlord',
    stageId: 'stage_bunker',
    sprite: 'zombie_boss',
    color: '#ef4444',
    radius: 55,
    hpMult: 1.22,
    speedBase: 102,
    zhName: '深渊核熔尸皇',
    enName: 'Nuclear Magma Overlord',
    zhIntro: '👑 终局首领【深渊核熔尸皇】苏醒 · 毁天灭地熔核弹幕！',
    enIntro: '👑 Nuclear Magma Overlord Awakened · Doomsday Hellfire!',
    zhRage: '☄️ 核熔尸皇进入二阶段熔毁狂暴，全屏炎爆+精英尸潮降临！',
    enRage: '☄️ Overlord Core Meltdown! Radial Hellfire + Elite Horde!',
  },
];

const BOSS_KIND_SET = new Set<string>(STAGE_BOSS_PROFILES.map((b) => b.kind));

export function isBossKind(kind: ZombieKind): kind is BossKind {
  return BOSS_KIND_SET.has(kind);
}

export function getBossProfile(kind: ZombieKind): BossProfile {
  return STAGE_BOSS_PROFILES.find((b) => b.kind === kind) || STAGE_BOSS_PROFILES[STAGE_BOSS_PROFILES.length - 1];
}

export function getStageBossKind(stageId: string, wave = 10): BossKind {
  const primaryIdx = STAGE_BOSS_PROFILES.findIndex((b) => b.stageId === stageId);
  const baseIdx = primaryIdx >= 0 ? primaryIdx : 0;
  // 标准第 10 波固定出场本关专属首领；无尽模式后续首领波（15, 20, 25...）轮换其他战区首领并在整 20 波回归本关首领！
  if (wave <= 10 || wave % 20 === 10) {
    return STAGE_BOSS_PROFILES[baseIdx].kind;
  }
  const rotOffset = Math.floor((wave - 10) / 5);
  return STAGE_BOSS_PROFILES[(baseIdx + rotOffset) % STAGE_BOSS_PROFILES.length].kind;
}

export const ZOMBIE_SPRITE_BY_KIND: Record<ZombieKind, SpriteKey> = {
  walker: 'zombie_walker',
  runner: 'zombie_runner',
  spitter: 'zombie_spitter',
  boomer: 'zombie_boomer',
  riot: 'zombie_riot',
  frost: 'zombie_frost',
  necro: 'zombie_necro',
  thief: 'zombie_thief',
  miniboss: 'zombie_miniboss',
  boss_warden: 'boss_warden',
  boss_chainsaw: 'boss_chainsaw',
  boss_venom: 'boss_venom',
  boss_surgeon: 'boss_surgeon',
  boss_kraken: 'boss_kraken',
  boss_tesla: 'boss_tesla',
  boss_cryo: 'boss_cryo',
  boss_overlord: 'zombie_boss',
};

export const ZOMBIE_RADIUS_BY_KIND: Record<ZombieKind, number> = {
  walker: 24,
  runner: 21,
  spitter: 27,
  boomer: 26,
  riot: 27,
  frost: 23,
  necro: 26,
  thief: 25,
  miniboss: 38,
  boss_warden: 50,
  boss_chainsaw: 49,
  boss_venom: 52,
  boss_surgeon: 50,
  boss_kraken: 54,
  boss_tesla: 50,
  boss_cryo: 52,
  boss_overlord: 55,
};

export const ZOMBIE_COLOR_BY_KIND: Record<ZombieKind, string> = {
  walker: '#4ade80',
  runner: '#fb7185',
  spitter: '#a3e635',
  boomer: '#f97316',
  riot: '#60a5fa',
  frost: '#38bdf8',
  necro: '#c084fc',
  thief: '#facc15',
  miniboss: '#a855f7',
  boss_warden: '#3b82f6',
  boss_chainsaw: '#ec4899',
  boss_venom: '#84cc16',
  boss_surgeon: '#f43f5e',
  boss_kraken: '#14b8a6',
  boss_tesla: '#38bdf8',
  boss_cryo: '#06b6d4',
  boss_overlord: '#ef4444',
};
