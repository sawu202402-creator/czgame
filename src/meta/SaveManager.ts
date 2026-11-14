import { AgentUpgradeLevels, SaveData } from '../types';
import { PlatformSDK } from '../platform/PlatformSDK';

const SAVE_KEY = 'czgame_zombie_defense_save_v1';

const DEFAULT_SAVE: SaveData = {
  agentLevel: 1,
  agentXp: 0,
  gold: 80,
  upgrades: {
    hp: 0,
    reload: 0,
    speed: 0,
    repair: 0,
    startCash: 0,
  },
  clearedStages: [],
  endlessBestWave: {},
  totalRuns: 0,
  freeStarterUsedCount: 0,
  freeHqSupportUsed: false,
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
          upgrades: {
            ...DEFAULT_SAVE.upgrades,
            ...(parsed.upgrades || {}),
          },
          endlessBestWave: {
            ...(parsed.endlessBestWave || {}),
          },
        };
      } catch {
        this.data = structuredClone(DEFAULT_SAVE);
      }
    }
    return this.data;
  }

  public get(): SaveData {
    return this.data;
  }

  public save(): void {
    PlatformSDK.setStorageItem(SAVE_KEY, JSON.stringify(this.data));
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
      // 每次特工升级额外赠送一笔奖金，且每级被动提升 3% 全枪械伤害！
      this.data.gold += 40;
      leveledUp = true;
    }
    this.save();
    return { leveledUp, oldLevel, newLevel: this.data.agentLevel };
  }

  public getUpgradeCost(key: keyof AgentUpgradeLevels): number {
    const meta = UPGRADE_TRACKS.find((t) => t.key === key)!;
    const lvl = this.data.upgrades[key];
    return meta.baseCost + lvl * meta.costStep;
  }

  public buyUpgrade(key: keyof AgentUpgradeLevels): boolean {
    const meta = UPGRADE_TRACKS.find((t) => t.key === key)!;
    const lvl = this.data.upgrades[key];
    if (lvl >= meta.maxLevel) return false;
    const cost = this.getUpgradeCost(key);
    if (this.data.gold < cost) return false;
    this.data.gold -= cost;
    this.data.upgrades[key] = lvl + 1;
    this.save();
    return true;
  }

  public markStageCleared(stageId: string): void {
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
    return {
      maxHp: 100 + u.hp * 18 + (this.data.agentLevel - 1) * 4,
      reloadMultiplier: Math.max(0.4, 1 - u.reload * 0.06),
      moveSpeed: 232 * (1 + u.speed * 0.035),
      repairSpeedMultiplier: 1 + u.repair * 0.12,
      maxPlanks: 4 + Math.floor(u.repair / 3),
      startCash: 80 + u.startCash * 45,
      agentDamageBonus: 1 + (this.data.agentLevel - 1) * 0.03,
    };
  }
}

export const SaveManager = new SaveService();
