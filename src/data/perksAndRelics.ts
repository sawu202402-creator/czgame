import { InRunPerkDef, PowerUpType, RelicDef } from '../types';

export const IN_RUN_PERKS: InRunPerkDef[] = [
  {
    id: 'hollow_point',
    name: '强装火药',
    desc: '所有武器伤害提升 +18%',
    icon: '💥',
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
    color: '#3b82f6',
    apply: (m) => {
      m.reloadMult *= 0.78;
      m.magMult *= 1.2;
    },
  },
  {
    id: 'ap_rounds',
    name: '钨芯穿甲弹',
    desc: '所有子弹穿透数量 +1，一枪串糖葫芦',
    icon: '🎯',
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
    color: '#a855f7',
    apply: (m) => {
      m.extraPellets += 0.35;
    },
  },
  {
    id: 'crit_hunter',
    name: '弱点狙击',
    desc: '暴击率 +15%（暴击造成 200% 大字伤害）',
    icon: '🎲',
    color: '#ec4899',
    apply: (m) => {
      m.critChance += 0.15;
    },
  },
  {
    id: 'sprinter',
    name: '涡轮滑板鞋',
    desc: '移动速度 +15%，拉扯尸王更轻松',
    icon: '👟',
    color: '#10b981',
    apply: (m) => {
      m.moveSpeedMult *= 1.15;
    },
  },
  {
    id: 'combat_medic',
    name: '战地木匠',
    desc: '每次修好一块木板回复 8% 生命值',
    icon: '🩹',
    color: '#14b8a6',
    apply: (m) => {
      m.repairHealRatio += 0.08;
    },
  },
  {
    id: 'bounty_badge',
    name: '赏金警徽',
    desc: '击杀僵尸掉落的钞票增加 +22%',
    icon: '💰',
    color: '#eab308',
    apply: (m) => {
      m.cashMult *= 1.22;
    },
  },
];

export const RELICS: RelicDef[] = [
  {
    id: 'rubber_bullets',
    name: '跳跳橡胶弹',
    desc: '子弹碰到墙壁可反弹 1 次，反弹伤害提高 25%！',
    icon: '🪃',
    rarity: 'epic',
  },
  {
    id: 'explosive_planks',
    name: '震荡铆钉板',
    desc: '窗户最后一块木板被拆碎瞬间，释放气浪震退并眩晕窗边尸群！',
    icon: '🛡️',
    rarity: 'rare',
  },
  {
    id: 'piggy_bank',
    name: '黄金存钱罐',
    desc: '每波结束时，按当前未花完的钞票额外发放 20% 理财利息！',
    icon: '🐷',
    rarity: 'epic',
  },
  {
    id: 'static_boots',
    name: '静电跑鞋',
    desc: '跑动蓄积电荷，每移动一段距离自动劈出闪电链电击附近僵尸！',
    icon: '🌩️',
    rarity: 'legendary',
  },
  {
    id: 'vamp_fangs',
    name: '吸血蝙蝠挂件',
    desc: '每击杀 12 只僵尸立刻回复 10% 最大生命值！',
    icon: '🦇',
    rarity: 'rare',
  },
  {
    id: 'dragon_oil',
    name: '辣椒燃烧油',
    desc: '所有子弹命中概率点燃僵尸，3秒内持续灼烧掉血！',
    icon: '🌶️',
    rarity: 'rare',
  },
  {
    id: 'chain_blast',
    name: '连环爆破罐',
    desc: '击败僵尸时有 25% 概率引发卡通彩花爆炸，波及周围怪物！',
    icon: '🎉',
    rarity: 'legendary',
  },
];

export const POWERUP_META: Record<
  PowerUpType,
  { name: string; icon: string; color: string; duration: number; banner: string }
> = {
  overdrive: {
    name: '无限火力',
    icon: '🔥',
    color: '#f97316',
    duration: 10,
    banner: '🔥 无限火力！10秒免换弹狂扫！',
  },
  nuke: {
    name: '战术震爆弹',
    icon: '☢️',
    color: '#ef4444',
    duration: 0,
    banner: '☢️ 全屏震爆清场！',
  },
  carpenter: {
    name: '神工木匠',
    icon: '🔨',
    color: '#f59e0b',
    duration: 0,
    banner: '🔨 全图窗户瞬间满耐久加固！',
  },
  double_cash: {
    name: '双倍赏金',
    icon: '💎',
    color: '#eab308',
    duration: 14,
    banner: '💎 双倍钞票时间！疯狂刷钱！',
  },
  freeze: {
    name: '急冻寒流',
    icon: '❄️',
    color: '#06b6d4',
    duration: 9,
    banner: '❄️ 急冻时刻！全场僵尸变冰雕！',
  },
};
