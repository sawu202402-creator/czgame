import { AgentClassId, AgentUpgradeLevels, DailyMissionKind, SaveData } from '../types';
import { PlatformSDK } from '../platform/PlatformSDK';
import {
  AGENT_CLASSES,
  DAILY_CHECKIN_REWARDS,
  DAILY_GRAND_BONUS,
  getAgentClassDef,
  getDailyMissionsForDate,
  getTodayDateKey,
  getYesterdayDateKey,
} from './ProgressionDefs';

const SAVE_KEY = 'czgame_zombie_defense_save_v1';

const DEFAULT_SAVE: SaveData = {
  agentLevel: 1,
  agentXp: 0,
  gold: 120,
  selectedClass: 'vanguard',
  unlockedClasses: ['vanguard'],
  careerKills: 0,
  upgrades: {
    hp: 0,
    reload: 0,
    speed: 0,
    repair: 0,
    startCash: 0,
    crit: 0,
    armor: 0,
    magnet: 0,
    ammo: 0,
    ordnance: 0,
  },
  clearedStages: [],
  endlessBestWave: {},
  totalRuns: 0,
  tutorialDone: false,
  freeStarterUsedCount: 0,
  freeHqSupportUsed: false,
  autoBuyAmmo: false,
  daily: {
    dateKey: '',
    lastSignDate: '',
    signStreak: 0,
    missionProgress: {},
    claimedIds: [],
    grandChestClaimed: false,
  },
  coopRivals: [],
};

export interface UpgradeTrackMeta {
  key: keyof AgentUpgradeLevels;
  name: string;
  icon: string;
  desc: string;
  maxLevel: number;
  baseCost: number;
  costStep: number;
  valueText: (lvl: number) => string;
}

export const UPGRADE_TRACKS: UpgradeTrackMeta[] = [
  {
    key: 'hp',
    name: '强健体魄',
    icon: '❤️',
    desc: '永久提升角色最大生命值',
    maxLevel: 10,
    baseCost: 110,
    costStep: 85,
    valueText: (lvl) => `${100 + lvl * 18} HP`,
  },
  {
    key: 'reload',
    name: '快手换弹',
    icon: '⚡',
    desc: '永久加快所有武器换弹速度',
    maxLevel: 10,
    baseCost: 120,
    costStep: 90,
    valueText: (lvl) => `+${lvl * 6}% 速度`,
  },
  {
    key: 'speed',
    name: '街机滑步',
    icon: '👟',
    desc: '永久提升角色移动与拉扯速度',
    maxLevel: 8,
    baseCost: 135,
    costStep: 100,
    valueText: (lvl) => `+${lvl * 3.5}% 移速`,
  },
  {
    key: 'repair',
    name: '加固大师',
    icon: '🔨',
    desc: '提升修窗速度与木板耐久上限',
    maxLevel: 8,
    baseCost: 100,
    costStep: 75,
    valueText: (lvl) => `+${lvl * 12}% 修筑`,
  },
  {
    key: 'startCash',
    name: '战备私房钱',
    icon: '💵',
    desc: '每局开局自带更多初始钞票',
    maxLevel: 10,
    baseCost: 125,
    costStep: 95,
    valueText: (lvl) => `$${80 + lvl * 45}`,
  },
  {
    key: 'crit',
    name: '致命弱点',
    icon: '🎯',
    desc: '永久提升初始暴击率与暴击伤害倍率',
    maxLevel: 10,
    baseCost: 130,
    costStep: 95,
    valueText: (lvl) => `+${(lvl * 2.5).toFixed(1)}% 暴击`,
  },
  {
    key: 'armor',
    name: '复合防弹衣',
    icon: '🦺',
    desc: '每局开局自带护甲，且每波清场自动回甲',
    maxLevel: 8,
    baseCost: 125,
    costStep: 90,
    valueText: (lvl) => `开局 +${lvl * 10} 甲`,
  },
  {
    key: 'magnet',
    name: '磁力搜刮',
    icon: '🧲',
    desc: '扩大钞票与经验吸附范围，并提升赏金掉落',
    maxLevel: 8,
    baseCost: 115,
    costStep: 85,
    valueText: (lvl) => `+${lvl * 18}% 吸附`,
  },
  {
    key: 'ammo',
    name: '弹药后勤',
    icon: '📦',
    desc: '提升所有主武器备弹上限，并降低局内补弹费',
    maxLevel: 8,
    baseCost: 130,
    costStep: 95,
    valueText: (lvl) => `+${lvl * 8}% 备弹`,
  },
  {
    key: 'ordnance',
    name: '高爆挂具',
    icon: '💣',
    desc: '提升手雷威力，高阶额外增加初始与波次手雷补给',
    maxLevel: 8,
    baseCost: 120,
    costStep: 90,
    valueText: (lvl) => `+${lvl * 12}% 爆伤`,
  },
];

class SaveService {
  private data: SaveData = structuredClone(DEFAULT_SAVE);

  public load(): SaveData {
    const raw = PlatformSDK.getStorageItem(SAVE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<SaveData>;
        this.data = {
          ...structuredClone(DEFAULT_SAVE),
          ...parsed,
          selectedClass: parsed.selectedClass || 'vanguard',
          unlockedClasses:
            Array.isArray(parsed.unlockedClasses) && parsed.unlockedClasses.length > 0
              ? parsed.unlockedClasses
              : ['vanguard'],
          careerKills: typeof parsed.careerKills === 'number' ? parsed.careerKills : 0,
          tutorialDone:
            typeof parsed.tutorialDone === 'boolean'
              ? parsed.tutorialDone
              : (parsed.totalRuns || 0) > 0,
          upgrades: {
            ...DEFAULT_SAVE.upgrades,
            ...(parsed.upgrades || {}),
          },
          endlessBestWave: {
            ...(parsed.endlessBestWave || {}),
          },
          daily: {
            ...structuredClone(DEFAULT_SAVE.daily),
            ...(parsed.daily || {}),
            missionProgress: { ...(parsed.daily?.missionProgress || {}) },
            claimedIds: Array.isArray(parsed.daily?.claimedIds) ? parsed.daily!.claimedIds : [],
          },
          coopRivals: Array.isArray(parsed.coopRivals) ? parsed.coopRivals : [],
        };
      } catch {
        this.data = structuredClone(DEFAULT_SAVE);
      }
    }
    this.syncDailyDate();
    return this.data;
  }

  public get(): SaveData {
    this.syncDailyDate();
    return this.data;
  }

  public save(): void {
    PlatformSDK.setStorageItem(SAVE_KEY, JSON.stringify(this.data));
  }

  public syncDailyDate(): void {
    const today = getTodayDateKey();
    if (this.data.daily.dateKey !== today) {
      this.data.daily.dateKey = today;
      this.data.daily.missionProgress = {};
      this.data.daily.claimedIds = [];
      this.data.daily.grandChestClaimed = false;
      this.save();
    }
  }

  public canClaimTodayCheckIn(): boolean {
    this.syncDailyDate();
    return this.data.daily.lastSignDate !== getTodayDateKey();
  }

  public getCurrentSignDisplayDay(): number {
    this.syncDailyDate();
    const today = getTodayDateKey();
    const yesterday = getYesterdayDateKey();
    if (this.data.daily.lastSignDate === today) {
      return ((Math.max(1, this.data.daily.signStreak) - 1) % 7) + 1;
    }
    if (this.data.daily.lastSignDate === yesterday) {
      return (this.data.daily.signStreak % 7) + 1;
    }
    return 1;
  }

  public claimTodayCheckIn(): { ok: boolean; day: number; gold: number; xp: number } {
    this.syncDailyDate();
    const today = getTodayDateKey();
    if (this.data.daily.lastSignDate === today) {
      return { ok: false, day: 1, gold: 0, xp: 0 };
    }
    const yesterday = getYesterdayDateKey();
    const nextStreak = this.data.daily.lastSignDate === yesterday ? this.data.daily.signStreak + 1 : 1;
    const dayIdx = ((nextStreak - 1) % 7) + 1;
    const rew = DAILY_CHECKIN_REWARDS[dayIdx - 1];
    this.data.daily.lastSignDate = today;
    this.data.daily.signStreak = nextStreak;
    this.addRewards(rew.gold, rew.xp);
    return { ok: true, day: dayIdx, gold: rew.gold, xp: rew.xp };
  }

  public addDailyProgress(kind: DailyMissionKind, delta: number, persistNow = false): void {
    if (delta <= 0) return;
    this.syncDailyDate();
    const cur = this.data.daily.missionProgress[kind] || 0;
    this.data.daily.missionProgress[kind] = cur + delta;
    if (persistNow) {
      this.save();
    }
  }

  public claimDailyMission(missionId: string): { ok: boolean; gold: number; xp: number } {
    this.syncDailyDate();
    const todayMissions = getDailyMissionsForDate(this.data.daily.dateKey);
    const m = todayMissions.find((item) => item.id === missionId);
    if (!m || this.data.daily.claimedIds.includes(m.id)) {
      return { ok: false, gold: 0, xp: 0 };
    }
    const prog = this.data.daily.missionProgress[m.kind] || 0;
    if (prog < m.target) {
      return { ok: false, gold: 0, xp: 0 };
    }
    this.data.daily.claimedIds.push(m.id);
    this.addRewards(m.rewardGold, m.rewardXp);
    return { ok: true, gold: m.rewardGold, xp: m.rewardXp };
  }

  public canClaimDailyGrandChest(): boolean {
    this.syncDailyDate();
    if (this.data.daily.grandChestClaimed) return false;
    const todayMissions = getDailyMissionsForDate(this.data.daily.dateKey);
    return todayMissions.every((m) => (this.data.daily.missionProgress[m.kind] || 0) >= m.target);
  }

  public claimDailyGrandChest(): { ok: boolean; gold: number; xp: number } {
    if (!this.canClaimDailyGrandChest()) {
      return { ok: false, gold: 0, xp: 0 };
    }
    this.data.daily.grandChestClaimed = true;
    this.addRewards(DAILY_GRAND_BONUS.gold, DAILY_GRAND_BONUS.xp);
    return { ok: true, gold: DAILY_GRAND_BONUS.gold, xp: DAILY_GRAND_BONUS.xp };
  }

  public hasUnclaimedDailyRewards(): boolean {
    if (this.canClaimTodayCheckIn()) return true;
    const todayMissions = getDailyMissionsForDate(this.data.daily.dateKey);
    for (const m of todayMissions) {
      const prog = this.data.daily.missionProgress[m.kind] || 0;
      if (prog >= m.target && !this.data.daily.claimedIds.includes(m.id)) {
        return true;
      }
    }
    return this.canClaimDailyGrandChest();
  }

  public toggleAutoBuyAmmo(): boolean {
    this.data.autoBuyAmmo = !this.data.autoBuyAmmo;
    this.save();
    return this.data.autoBuyAmmo;
  }

  public unlockOrSelectClass(classId: AgentClassId): boolean {
    const def = AGENT_CLASSES.find((c) => c.id === classId);
    if (!def) return false;
    if (this.data.unlockedClasses.includes(classId)) {
      this.data.selectedClass = classId;
      this.save();
      return true;
    }
    if (this.data.gold < def.unlockCost) return false;
    this.data.gold -= def.unlockCost;
    this.data.unlockedClasses.push(classId);
    this.data.selectedClass = classId;
    this.save();
    return true;
  }

  public recordRunTelemetry(
    killsDelta: number,
    coopMates: { callsign: string; wave: number; kills: number }[] = []
  ): void {
    if (killsDelta > 0) {
      this.data.careerKills = (this.data.careerKills || 0) + killsDelta;
    }
    for (const mate of coopMates) {
      if (!mate.callsign) continue;
      const existing = this.data.coopRivals.find((r) => r.callsign === mate.callsign);
      if (existing) {
        existing.bestWave = Math.max(existing.bestWave, mate.wave);
        existing.totalKills += Math.max(0, mate.kills);
        existing.updatedAt = Date.now();
      } else {
        this.data.coopRivals.push({
          callsign: mate.callsign,
          bestWave: Math.max(1, mate.wave),
          totalKills: Math.max(1, mate.kills),
          classId: 'vanguard',
          updatedAt: Date.now(),
        });
      }
    }
    if (this.data.coopRivals.length > 16) {
      this.data.coopRivals.sort((a, b) => b.updatedAt - a.updatedAt);
      this.data.coopRivals.length = 16;
    }
    this.save();
  }

  public xpForNextLevel(level: number): number {
    return 120 + (level - 1) * 85;
  }

  public addRewards(goldEarned: number, xpEarned: number): { leveledUp: boolean; oldLevel: number; newLevel: number } {
    const oldLevel = this.data.agentLevel;
    this.data.gold += Math.round(goldEarned);
    this.data.agentXp += Math.round(xpEarned);

    let leveledUp = false;
    while (this.data.agentXp >= this.xpForNextLevel(this.data.agentLevel)) {
      this.data.agentXp -= this.xpForNextLevel(this.data.agentLevel);
      this.data.agentLevel += 1;
      this.data.gold += 40;
      leveledUp = true;
    }
    this.save();
    return { leveledUp, oldLevel, newLevel: this.data.agentLevel };
  }

  public getUpgradeCost(key: keyof AgentUpgradeLevels): number {
    const meta = UPGRADE_TRACKS.find((t) => t.key === key)!;
    const lvl = this.data.upgrades[key] || 0;
    return meta.baseCost + lvl * meta.costStep;
  }

  public buyUpgrade(key: keyof AgentUpgradeLevels): boolean {
    const meta = UPGRADE_TRACKS.find((t) => t.key === key)!;
    const lvl = this.data.upgrades[key] || 0;
    if (lvl >= meta.maxLevel) return false;
    const cost = this.getUpgradeCost(key);
    if (this.data.gold < cost) return false;
    this.data.gold -= cost;
    this.data.upgrades[key] = lvl + 1;
    this.save();
    return true;
  }

  public markTutorialDone(): void {
    if (!this.data.tutorialDone) {
      this.data.tutorialDone = true;
      this.save();
    }
  }

  public markStageCleared(stageId: string): void {
    if (stageId === 'stage_tutorial') {
      this.markTutorialDone();
      return;
    }
    if (!this.data.clearedStages.includes(stageId)) {
      this.data.clearedStages.push(stageId);
      this.save();
    }
  }

  public recordEndlessWave(stageId: string, wave: number): void {
    const prev = this.data.endlessBestWave[stageId] || 0;
    if (wave > prev) {
      this.data.endlessBestWave[stageId] = wave;
      this.save();
    }
  }

  public getEffectivePlayerStats() {
    const u = this.data.upgrades;
    const cls = getAgentClassDef(this.data.selectedClass || 'vanguard');
    const isVanguard = cls.id === 'vanguard';
    const isEngineer = cls.id === 'engineer';
    const isMedic = cls.id === 'medic';
    const isDemo = cls.id === 'demolisher';

    return {
      classId: cls.id,
      skillCooldown: cls.skillCooldown,
      maxHp: 100 + u.hp * 18 + (this.data.agentLevel - 1) * 4,
      reloadMultiplier: Math.max(0.38, 1 - u.reload * 0.06),
      fireRateMultiplier: isVanguard ? 1.12 : 1,
      moveSpeed: 232 * (1 + u.speed * 0.035 + (isVanguard ? 0.05 : 0)),
      repairSpeedMultiplier: 1 + u.repair * 0.12,
      killHealRatio: isMedic ? 0.08 : 0,
      medDropHealMult: isMedic ? 1.5 : 1,
      reviveSpeedMultiplier: isMedic ? 1.65 : 1,
      turretDurationMultiplier: isEngineer ? 1.35 : 1,
      maxPlanks: 4 + Math.floor(u.repair / 3),
      startCash: 80 + u.startCash * 45,
      startArmor: Math.min(100, u.armor * 10 + (isEngineer ? 35 : 0)),
      waveArmorRegen: u.armor * 4,
      startGrenades: 2 + (u.ordnance >= 3 ? 1 : 0) + (isDemo ? 2 : 0),
      grenadeDamageMult: 1 + u.ordnance * 0.12,
      grenadeWaveSupply: u.ordnance >= 6,
      critChance: 0.05 + u.crit * 0.025,
      critDamageMult: 2 + u.crit * 0.05,
      magnetMult: 1 + u.magnet * 0.18,
      cashBonusMult: 1 + u.magnet * 0.04,
      reserveAmmoMult: 1 + u.ammo * 0.08,
      ammoCostMult: Math.max(0.55, (1 - u.ammo * 0.04) * (isDemo ? 0.88 : 1)),
      gunShopCostMult: isDemo ? 0.88 : 1,
      agentDamageBonus: 1 + (this.data.agentLevel - 1) * 0.03,
    };
  }
}

export const SaveManager = new SaveService();
