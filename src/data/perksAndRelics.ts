import { InRunPerkDef, PowerUpType, RelicDef } from '../types';

export const IN_RUN_PERKS: InRunPerkDef[] = [
  {
    id: 'hollow_point',
    name: '强装火药',
    desc: '所有武器伤害提升 +18%',
    icon: '💥',
    sprite: './assets/gun_rifle.png',
    color: '#ef4444',
    apply: (m) => {
      m.damageMult *= 1.18;
    },
  },
  {
    id: 'sleight_hand',
    name: '极速弹匣',
    desc: '换弹时间缩短 22%，弹匣容量 +20%',
    icon: '⚡',
    sprite: './assets/prop_ammo_box.png',
    color: '#3b82f6',
    apply: (m) => {
      m.reloadMult *= 0.78;
      m.magMult *= 1.2;
    },
  },
  {
    id: 'ap_rounds',
    name: '钨芯穿甲弹',
    desc: '所有子弹穿透数量 +1，轻松洞穿尸潮防线',
    icon: '🎯',
    sprite: './assets/gun_sniper.png',
    color: '#f59e0b',
    apply: (m) => {
      m.extraPierce += 1;
    },
  },
  {
    id: 'split_chamber',
    name: '分裂膛线',
    desc: '每次开火有 35% 概率额外连射 1 颗弹头（可叠加）',
    icon: '✨',
    sprite: './assets/gun_autoshotgun.png',
    color: '#a855f7',
    apply: (m) => {
      m.extraPellets += 0.35;
    },
  },
  {
    id: 'crit_hunter',
    name: '弱点狙击',
    desc: '暴击率 +15%（暴击造成 200% 致命伤害）',
    icon: '🎯',
    sprite: './assets/gun_revolver.png',
    color: '#ec4899',
    apply: (m) => {
      m.critChance += 0.15;
    },
  },
  {
    id: 'sprinter',
    name: '轻量化战术靴',
    desc: '移动速度 +15%，机动拉扯尸王更从容',
    icon: '👟',
    sprite: './assets/player_boot.png',
    color: '#10b981',
    apply: (m) => {
      m.moveSpeedMult *= 1.15;
    },
  },
  {
    id: 'combat_medic',
    name: '战地工兵',
    desc: '每次修好一块防线木板回复 8% 生命值',
    icon: '🩹',
    sprite: './assets/prop_wood_plank.png',
    color: '#14b8a6',
    apply: (m) => {
      m.repairHealRatio += 0.08;
    },
  },
  {
    id: 'bounty_badge',
    name: '赏金军牌',
    desc: '击杀僵尸掉落的战地军费增加 +22%',
    icon: '💰',
    sprite: './assets/drop_cash.png',
    color: '#eab308',
    apply: (m) => {
      m.cashMult *= 1.22;
    },
  },
  {
    id: 'ammo_scavenger',
    name: '嗜血回弹',
    desc: '击杀僵尸有 36% 概率直接向当前弹夹回填子弹，火力不断档',
    icon: '🔄',
    sprite: './assets/gear_backpack.png',
    color: '#22c55e',
    apply: (m) => {
      m.killRefillChance = Math.min(0.85, m.killRefillChance + 0.36);
    },
  },
  {
    id: 'cryo_coating',
    name: '极寒弹头',
    desc: '射击有 28% 概率发射液氮冰冻弹，大幅减速冻结尸潮与尸王',
    icon: '❄️',
    sprite: './assets/gun_cryogun.png',
    color: '#06b6d4',
    apply: (m) => {
      m.cryoShotChance = Math.min(0.85, m.cryoShotChance + 0.28);
    },
  },
  {
    id: 'arc_overload',
    name: '高压电弧',
    desc: '射击有 24% 概率触发连锁闪电弹射周围尸群',
    icon: '⚡',
    sprite: './assets/gun_tesla.png',
    color: '#38bdf8',
    apply: (m) => {
      m.electricShotChance = Math.min(0.8, m.electricShotChance + 0.24);
    },
  },
  {
    id: 'berserk_blood',
    name: '狂战血怒',
    desc: '全武器射速提升 +14%，生命值低于 55% 时伤害额外暴涨 +30%',
    icon: '🔥',
    sprite: './assets/gun_minigun.png',
    color: '#f97316',
    apply: (m) => {
      m.fireRateMult *= 1.14;
      m.lowHpDamageBonus += 0.3;
    },
  },
];

export const RELICS: RelicDef[] = [
  {
    id: 'rubber_bullets',
    name: '钨合金跳弹芯',
    desc: '子弹命中墙壁可折射反弹 1 次，且反弹伤害提升 25%',
    icon: '🔸',
    sprite: './assets/relic_ricochet.png',
    rarity: 'epic',
  },
  {
    id: 'explosive_planks',
    name: '爆破反应装甲板',
    desc: '窗户最后一块木板破碎瞬间，释放高爆气浪震退并眩晕尸群',
    icon: '🛡️',
    sprite: './assets/relic_shock_plank.png',
    rarity: 'rare',
  },
  {
    id: 'piggy_bank',
    name: '战地金条密码箱',
    desc: '每波结束时按结余军费发放 10% 战备利息（单波上限 $180）',
    icon: '💼',
    sprite: './assets/relic_war_bonds.png',
    rarity: 'epic',
  },
  {
    id: 'static_boots',
    name: '磁暴动能战靴',
    desc: '移动蓄积高压电荷，每奔跑一段距离自动劈出闪电链清怪',
    icon: '⚡',
    sprite: './assets/relic_tesla_boots.png',
    rarity: 'legendary',
  },
  {
    id: 'vamp_fangs',
    name: '纳米肾上腺注射器',
    desc: '每歼灭 18 只僵尸自动注射纳米血清，恢复 8% 最大生命',
    icon: '💉',
    sprite: './assets/relic_vamp_core.png',
    rarity: 'rare',
  },
  {
    id: 'dragon_oil',
    name: '白磷铝热燃烧剂',
    desc: '所有子弹命中概率引燃僵尸，3 秒内持续高温灼烧掉血',
    icon: '🔥',
    sprite: './assets/relic_napalm.png',
    rarity: 'rare',
  },
  {
    id: 'chain_blast',
    name: '高爆子母破片核',
    desc: '击败僵尸时有 20% 概率引发高热破片连锁爆炸，波及周围尸群',
    icon: '💣',
    sprite: './assets/relic_cluster_core.png',
    rarity: 'legendary',
  },
];

export const POWERUP_META: Record<
  PowerUpType,
  { name: string; icon: string; sprite: string; color: string; duration: number; banner: string }
> = {
  overdrive: {
    name: '无限火力',
    icon: '🔥',
    sprite: './assets/prop_ammo_box.png',
    color: '#f97316',
    duration: 7,
    banner: '无限火力 · 7秒免换弹狂扫！',
  },
  nuke: {
    name: '战术震爆弹',
    icon: '☢️',
    sprite: './assets/prop_grenade.png',
    color: '#ef4444',
    duration: 0,
    banner: '战术震爆弹 · 全场冲击清屏！',
  },
  carpenter: {
    name: '工程抢修',
    icon: '🔨',
    sprite: './assets/prop_wood_plank.png',
    color: '#f59e0b',
    duration: 0,
    banner: '工程抢修 · 全图窗户防线已封满！',
  },
  double_cash: {
    name: '双倍赏金',
    icon: '💰',
    sprite: './assets/drop_cash.png',
    color: '#eab308',
    duration: 12,
    banner: '双倍赏金 · 12秒击杀收益翻倍！',
  },
  freeze: {
    name: '极寒液氮',
    icon: '❄️',
    sprite: './assets/gun_cryogun.png',
    color: '#06b6d4',
    duration: 7,
    banner: '极寒液氮 · 全场尸潮减速冻结！',
  },
};
