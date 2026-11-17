import { AgentClassId, CoopRivalRecord, DailyMissionKind, SaveData } from '../types';
import { I18n } from '../i18n/I18n';

export interface AgentClassDef {
  id: AgentClassId;
  sprite: string;
  skillSprite: string;
  color: string;
  unlockCost: number;
  skillCooldown: number;
  zhName: string;
  enName: string;
  zhPassive: string;
  enPassive: string;
  zhSkillName: string;
  enSkillName: string;
  zhSkillDesc: string;
  enSkillDesc: string;
}

export const AGENT_CLASSES: AgentClassDef[] = [
  {
    id: 'vanguard',
    sprite: './assets/player_hero.png',
    skillSprite: './assets/prop_ammo_box.png',
    color: '#f97316',
    unlockCost: 0,
    skillCooldown: 32,
    zhName: '狂暴突击兵',
    enName: 'Berserk Vanguard',
    zhPassive: '全枪射速 +12% · 移动速度 +5%',
    enPassive: 'All Fire Rate +12% · Move Speed +5%',
    zhSkillName: '肾上腺超载',
    enSkillName: 'Adrenaline Overdrive',
    zhSkillDesc: '开启 5.5 秒免耗弹极速狂扫，并立即填满当前弹夹（CD 32秒）',
    enSkillDesc: '5.5s zero-ammo rapid overdrive + instant mag refill (32s CD)',
  },
  {
    id: 'engineer',
    sprite: './assets/prop_turret.png',
    skillSprite: './assets/prop_turret.png',
    color: '#38bdf8',
    unlockCost: 420,
    skillCooldown: 36,
    zhName: '重装机械师',
    enName: 'Heavy Engineer',
    zhPassive: '开局自带 +35 护甲 · 哨戒炮持续时间 +35%',
    enPassive: 'Start +35 Armor · Turret Duration +35%',
    zhSkillName: '空投哨戒塔',
    enSkillName: 'Deploy Auto-Turret',
    zhSkillDesc: '原地立即架设一挺自动机枪哨戒塔协同守窗，并修复近处窗户（CD 36秒）',
    enSkillDesc: 'Deploy an auto-targeting sentry turret & reinforce nearby window (36s CD)',
  },
  {
    id: 'medic',
    sprite: './assets/item_medkit.png',
    skillSprite: './assets/item_medkit.png',
    color: '#4ade80',
    unlockCost: 420,
    skillCooldown: 30,
    zhName: '战地医疗官',
    enName: 'Combat Medic',
    zhPassive: '救援队友速度 +65% · 修窗自动回复 6% 生命',
    enPassive: 'Revive Speed +65% · Barricade Heals 6% HP',
    zhSkillName: '纳米急救脉冲',
    enSkillName: 'Nano Heal Pulse',
    zhSkillDesc: '瞬间回复 45% 生命与 +35 护甲，联机时直接拉起身边倒地队友（CD 30秒）',
    enSkillDesc: 'Restore 45% HP + 35 Armor & instantly revive nearby downed allies (30s CD)',
  },
  {
    id: 'demolisher',
    sprite: './assets/relic_cluster_core.png',
    skillSprite: './assets/prop_grenade.png',
    color: '#facc15',
    unlockCost: 520,
    skillCooldown: 28,
    zhName: '赏金爆破手',
    enName: 'Bounty Demolisher',
    zhPassive: '开局手雷 +2 · 局内买枪与补弹全部享 88 折',
    enPassive: 'Start +2 Grenades · 12% Discount on Guns & Ammo',
    zhSkillName: '集束磁暴轰炸',
    enSkillName: 'Cluster Barrage',
    zhSkillDesc: '向四周环状抛射 4 颗高爆集束雷轰炸清场，并麻痹震退周围尸群（CD 28秒）',
    enSkillDesc: 'Launch 4 cluster frag grenades around you & shock-stun nearby hordes (28s CD)',
  },
];

export function getAgentClassDef(id: AgentClassId): AgentClassDef {
  return AGENT_CLASSES.find((c) => c.id === id) || AGENT_CLASSES[0];
}

export function getLocalizedClassText(c: AgentClassDef) {
  const zh = I18n.isZh();
  return {
    name: zh ? c.zhName : c.enName,
    passive: zh ? c.zhPassive : c.enPassive,
    skillName: zh ? c.zhSkillName : c.enSkillName,
    skillDesc: zh ? c.zhSkillDesc : c.enSkillDesc,
  };
}

export interface CheckInDayReward {
  day: number;
  gold: number;
  xp: number;
  sprite: string;
}

export const DAILY_CHECKIN_REWARDS: CheckInDayReward[] = [
  { day: 1, gold: 150, xp: 40, sprite: './assets/ui_coin.png' },
  { day: 2, gold: 220, xp: 70, sprite: './assets/drop_cash.png' },
  { day: 3, gold: 300, xp: 90, sprite: './assets/prop_ammo_box.png' },
  { day: 4, gold: 380, xp: 120, sprite: './assets/item_armor.png' },
  { day: 5, gold: 480, xp: 150, sprite: './assets/relic_war_bonds.png' },
  { day: 6, gold: 600, xp: 190, sprite: './assets/prop_turret.png' },
  { day: 7, gold: 900, xp: 300, sprite: './assets/prop_chest.png' },
];

export interface DailyMissionDef {
  id: string;
  kind: DailyMissionKind;
  target: number;
  rewardGold: number;
  rewardXp: number;
  sprite: string;
  zhTitle: string;
  enTitle: string;
}

export const DAILY_MISSION_POOL: DailyMissionDef[] = [
  {
    id: 'dm_kills_120',
    kind: 'kills',
    target: 120,
    rewardGold: 180,
    rewardXp: 65,
    sprite: './assets/gun_rifle.png',
    zhTitle: '清剿先锋：今日累计击杀 120 只僵尸',
    enTitle: 'Exterminator: Eliminate 120 zombies today',
  },
  {
    id: 'dm_waves_8',
    kind: 'waves',
    target: 8,
    rewardGold: 180,
    rewardXp: 65,
    sprite: './assets/prop_sandbags.png',
    zhTitle: '钢铁防线：今日累计成功抵御 8 波尸潮',
    enTitle: 'Hold the Line: Survive 8 waves today',
  },
  {
    id: 'dm_repairs_18',
    kind: 'repairs',
    target: 18,
    rewardGold: 150,
    rewardXp: 55,
    sprite: './assets/prop_wood_plank.png',
    zhTitle: '战地工兵：今日累计修复加固 18 块窗户木板',
    enTitle: 'Field Sapper: Reinforce 18 window planks today',
  },
  {
    id: 'dm_doors_4',
    kind: 'doors',
    target: 4,
    rewardGold: 170,
    rewardXp: 60,
    sprite: './assets/prop_blast_door.png',
    zhTitle: '防区拓荒：今日累计解锁开启 4 道防区大门',
    enTitle: 'Breacher: Unlock 4 sector doors today',
  },
  {
    id: 'dm_bosses_2',
    kind: 'bosses',
    target: 2,
    rewardGold: 230,
    rewardXp: 85,
    sprite: './assets/zombie_boss.png',
    zhTitle: '猎魔行动：今日击败 2 只重装暴君或狂暴尸王',
    enTitle: 'Boss Hunter: Defeat 2 Elite Tyrants or Bosses today',
  },
  {
    id: 'dm_evolve_2',
    kind: 'evolve',
    target: 2,
    rewardGold: 210,
    rewardXp: 75,
    sprite: './assets/prop_chest.png',
    zhTitle: '军备升级：今日完成超武进化或开启遗物宝箱共 2 次',
    enTitle: 'Arms Race: Evolve weapons or open relic chests 2 times',
  },
  {
    id: 'dm_skills_6',
    kind: 'skills',
    target: 6,
    rewardGold: 160,
    rewardXp: 60,
    sprite: './assets/prop_grenade.png',
    zhTitle: '战术轰炸：今日投掷手雷或释放职业大招共 6 次',
    enTitle: 'Tactical Specialist: Use grenades or class skills 6 times',
  },
  {
    id: 'dm_clear_1',
    kind: 'clear',
    target: 1,
    rewardGold: 260,
    rewardXp: 100,
    sprite: './assets/prop_helicopter.png',
    zhTitle: '王牌撤离：今日通关任意战区 1 次（或无尽达到第 8 波）',
    enTitle: 'Ace Extraction: Clear any stage or reach Endless Wave 8',
  },
];

export const DAILY_GRAND_BONUS = {
  gold: 380,
  xp: 150,
};

export function getTodayDateKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getYesterdayDateKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getDailyMissionsForDate(dateKey: string): DailyMissionDef[] {
  let seed = 2166136261;
  for (let i = 0; i < dateKey.length; i++) {
    seed ^= dateKey.charCodeAt(i);
    seed = Math.imul(seed, 16777619) >>> 0;
  }
  const indices = DAILY_MISSION_POOL.map((_, idx) => idx);
  for (let i = indices.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    const tmp = indices[i];
    indices[i] = indices[j];
    indices[j] = tmp;
  }
  // 每日固定抽 4 个不重复任务，节奏充实且易达成
  return indices.slice(0, 4).map((idx) => DAILY_MISSION_POOL[idx]);
}

export interface LeaderboardEntry {
  rank: number;
  callsign: string;
  classId: AgentClassId;
  bestWave: number;
  totalKills: number;
  clearedCount: number;
  isMe: boolean;
  isCoopFriend: boolean;
  badgeText: string;
}

const ELITE_LADDER_RIVALS: {
  callsign: string;
  classId: AgentClassId;
  bestWave: number;
  totalKills: number;
  clearedCount: number;
  zhBadge: string;
  enBadge: string;
}[] = [
  { callsign: 'Ghost_SAS', classId: 'vanguard', bestWave: 29, totalKills: 6420, clearedCount: 8, zhBadge: '传奇统帅', enBadge: 'Marshal' },
  { callsign: '夜刃指挥官', classId: 'demolisher', bestWave: 26, totalKills: 5380, clearedCount: 8, zhBadge: '传奇统帅', enBadge: 'Marshal' },
  { callsign: 'Valkyrie7', classId: 'medic', bestWave: 24, totalKills: 4690, clearedCount: 8, zhBadge: '王牌指挥', enBadge: 'Ace Cmdr' },
  { callsign: '铁血重装_K', classId: 'engineer', bestWave: 21, totalKills: 3920, clearedCount: 7, zhBadge: '王牌指挥', enBadge: 'Ace Cmdr' },
  { callsign: 'Kurogane', classId: 'vanguard', bestWave: 19, totalKills: 3340, clearedCount: 6, zhBadge: '王牌指挥', enBadge: 'Ace Cmdr' },
  { callsign: '雷霆破门手', classId: 'demolisher', bestWave: 17, totalKills: 2780, clearedCount: 6, zhBadge: '铁血军士', enBadge: 'Sgt Major' },
  { callsign: 'NovaStrike', classId: 'engineer', bestWave: 15, totalKills: 2260, clearedCount: 5, zhBadge: '铁血军士', enBadge: 'Sgt Major' },
  { callsign: '零号防疫官', classId: 'medic', bestWave: 13, totalKills: 1750, clearedCount: 4, zhBadge: '铁血军士', enBadge: 'Sgt Major' },
  { callsign: 'Raptor_BR', classId: 'vanguard', bestWave: 11, totalKills: 1290, clearedCount: 3, zhBadge: '破阵先锋', enBadge: 'Vanguard' },
  { callsign: '火线老兵88', classId: 'engineer', bestWave: 9, totalKills: 860, clearedCount: 2, zhBadge: '破阵先锋', enBadge: 'Vanguard' },
  { callsign: 'rookie_Leo', classId: 'medic', bestWave: 7, totalKills: 480, clearedCount: 1, zhBadge: '新锐特工', enBadge: 'Rookie' },
  { callsign: '守窗练习生', classId: 'vanguard', bestWave: 4, totalKills: 190, clearedCount: 0, zhBadge: '新锐特工', enBadge: 'Rookie' },
];

export function buildLeaderboardRows(
  sortBy: 'endless' | 'kills',
  save: SaveData,
  myCallsign: string,
  myRankTitle: string
): LeaderboardEntry[] {
  const zh = I18n.isZh();
  const myBestEndless = Math.max(
    save.clearedStages.length > 0 ? 10 : 0,
    ...Object.values(save.endlessBestWave)
  );

  const rows: Omit<LeaderboardEntry, 'rank'>[] = ELITE_LADDER_RIVALS.map((r) => ({
    callsign: r.callsign,
    classId: r.classId,
    bestWave: r.bestWave,
    totalKills: r.totalKills,
    clearedCount: r.clearedCount,
    isMe: false,
    isCoopFriend: false,
    badgeText: zh ? r.zhBadge : r.enBadge,
  }));

  for (const fr of save.coopRivals as CoopRivalRecord[]) {
    if (!fr.callsign || fr.callsign === myCallsign) continue;
    rows.push({
      callsign: fr.callsign,
      classId: fr.classId || 'vanguard',
      bestWave: Math.max(1, fr.bestWave),
      totalKills: Math.max(1, fr.totalKills),
      clearedCount: Math.min(8, Math.floor(fr.bestWave / 3)),
      isMe: false,
      isCoopFriend: true,
      badgeText: zh ? '🤝 联机战友' : '🤝 Squad Ally',
    });
  }

  rows.push({
    callsign: myCallsign,
    classId: save.selectedClass || 'vanguard',
    bestWave: myBestEndless,
    totalKills: save.careerKills || 0,
    clearedCount: save.clearedStages.length,
    isMe: true,
    isCoopFriend: false,
    badgeText: myRankTitle,
  });

  rows.sort((a, b) => {
    if (sortBy === 'endless') {
      if (b.bestWave !== a.bestWave) return b.bestWave - a.bestWave;
      return b.totalKills - a.totalKills;
    }
    if (b.totalKills !== a.totalKills) return b.totalKills - a.totalKills;
    return b.bestWave - a.bestWave;
  });

  return rows.map((item, idx) => ({
    ...item,
    rank: idx + 1,
  }));
}
