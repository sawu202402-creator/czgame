import { AgentUpgradeLevels, PowerUpType, StationType } from '../types';

export type LangCode = 'en' | 'zh' | 'es' | 'pt' | 'ru' | 'ja';

export const LANG_OPTIONS: { code: LangCode; label: string; short: string }[] = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'zh', label: '简体中文', short: '中文' },
  { code: 'es', label: 'Español', short: 'ES' },
  { code: 'pt', label: 'Português', short: 'PT' },
  { code: 'ru', label: 'Русский', short: 'RU' },
  { code: 'ja', label: '日本語', short: 'JA' },
];

const LANG_STORAGE_KEY = 'czgame_lang_v1';

type DictMap = Record<string, string>;

const UI_TEXT: Record<LangCode, DictMap> = {
  en: {
    gameTitle: 'Zombie Room Defense',
    gameSub: 'SAS TACTICAL SIEGE · 1–4P CO-OP',
    rotateTitle: 'Rotate Device to Landscape',
    rotateDesc: 'Widescreen dual-stick controls deliver the best combat experience',
    rotateBtn: '⛶ Fullscreen & Lock Landscape',
    tabStages: '🗺️ Solo Stages',
    tabCoop: '🤝 Co-op (1-4P)',
    tabUpgrades: '⚡ Upgrades',
    tabDaily: '📅 Daily',
    tabRank: '🏆 Ranks',
    footerTip:
      '📱 Touch: Left thumb move · Right wheel fire/drag-aim + switch/grenade/reload ｜ 💻 PC: WASD · Mouse Aim/Fire · B Shop · V Quick Ammo · Q Switch · G Grenade',
    rank1: 'Rookie Agent',
    rank3: 'Vanguard',
    rank5: 'Sergeant Major',
    rank8: 'Ace Commander',
    rank12: 'Legendary Marshal',
    allGunDmgBonus: 'All Weapon DMG +{pct}%',
    xpProgress: 'XP {cur}/{next}',
    clearedStat: '🏆 Cleared {done}/{total}',
    bestEndlessStat: '♾️ Best {wave}',
    noRecord: 'None',
    arsenalStat: '🔫 15 Evo Weapons',
    modeStandard: '🚁 10-Wave Evac',
    modeEndless: '♾️ Endless Horde',
    modeDescStandard: 'Hold the line for 10 waves, defeat the Abyss King, and board the evac chopper!',
    modeDescEndless: 'Infinite escalating waves with Elite Tyrants and Bosses — push your survival record!',
    heroCaption: '🔨 Barricade Windows · 🔓 Unlock Sectors · ⚡ Evolve Super Weapons',
    deployStandard: '▶ Deploy (10-Wave Evac)',
    deployEndless: '▶ Enter Endless Horde',
    stageCleared: '✅ Cleared',
    stageLockedBadge: '🔒 Locked',
    stageLockedBtn: '🔒 Clear Stage {n} First',
    stageEndlessBest: '🏆 Wave {w}',
    stageEndlessTry: '♾️ Endless Survival',
    arsenalPreviewTitle: '🔥 Field Armory Preview',
    arsenalPreviewSub: 'Unlock sectors in-match · Every weapon evolves into a Super Weapon',
    pillRepair: '🔨 Auto-Barricade',
    pillChest: '🎁 Relic Supply Drops',
    pillBoss: '👑 Boss Showdown',
    upgPermanentBonus: 'Permanent All-Weapon Damage +{pct}%',
    upgMaxed: 'MAXED',
    upgBuy: 'Upgrade',
    classSecTitle: '🪖 Agent Specialization (Passive + Active Skill [F])',
    classEquipped: '✅ Active',
    classSelect: 'Equip',
    classUnlock: 'Unlock',
    classSkillTag: 'Active [F]:',
    upgSecTitle: '🧬 Permanent Tech Upgrades (10 Tracks)',
    dailySignTitle: '📅 7-Day Supply Check-In',
    dailyStreakBadge: '🔥 {n}-Day Streak',
    dailyDayLabel: 'Day {d}',
    dailyClaimed: '✅ Claimed',
    dailyClaimNow: '🎁 Claim Today',
    dailyTomorrow: 'Come back tomorrow',
    dailyMissionsTitle: '📋 Daily Combat Bounties (Resets Daily at 00:00)',
    dailyGrandTitle: '🎁 Daily All-Clear Bonus Chest',
    dailyGrandDesc: 'Complete all 4 daily bounties to claim bonus Gold & XP!',
    dailyGoBtn: 'In Progress',
    dailyClaimBtn: 'Claim',
    rankTitleEndless: '♾️ Endless Survival Ladder',
    rankTitleKills: '🎖️ Career Exterminator Ladder',
    rankMySummary: 'Your Rank: <strong>#{rank}</strong> · Best Wave <strong>{w}</strong> · Total Kills <strong>{k}</strong>',
    rankChaseHint: '🔥 Only <strong>{gap}</strong> behind #{prevRank} [{name}]!',
    rankTopOneHint: '👑 You are #1 Supreme Marshal on the Leaderboard!',
    rankColRank: 'Rank',
    rankColAgent: 'Agent',
    rankColWave: 'Best Wave',
    rankColKills: 'Total Kills',
    rankColCleared: 'Cleared',
    perkPickTitle: '⚡ Battle Promotion Lv.{lv} — Choose 1 Tactical Perk',
    perkPickHint: 'Tap a card or press [1] / [2] / [3] to equip immediately',
    ftSkillReady: '⚡ [{name}] Activated!',
    ftAmmoScav: '+{n} Ammo',
    // Co-op Hub
    coopRule1: '🧟 <strong>Dynamic Scaling</strong>: 2–4P scales horde size up to ×3.04 · Boss HP ×2.65 · Extra Elites',
    coopRule2: '💰 <strong>Personal Cash + Pooled Doors</strong>: Shared bounty split on pickups · Pool cash together to unlock doors',
    coopRule3: '💉 <strong>Downed & Revive</strong>: Crawl when downed, revive allies in 2.2s, auto-revive on wave clear',
    callsignLabel: '🪖 Callsign:',
    callsignPlaceholder: 'Agent Name',
    saveCallsign: 'Save',
    callsignSaved: 'Callsign updated to [{name}]',
    p2pBadge: '🌐 WebRTC P2P Direct · Zero Server Cost · Cross-Platform PC & Mobile',
    connectingMsg: '⏳ Establishing tactical P2P channel, please wait...',
    createCardTitle: '📡 Create Squad Room (Host)',
    createCardDesc: 'Generate a 5-letter Room Code or copy a direct invite link for up to 4 players.',
    createRoomBtn: '➕ Create 1–4P Co-op Room',
    joinCardTitle: '🔑 Join Squad by Code',
    joinCardDesc: 'Enter the 5-letter Room Code shared by the host to join the defense squad.',
    codePlaceholder: '5-Char Code',
    joinRoomBtn: '🚀 Join Squad',
    roomCodeLabel: 'ROOM CODE',
    copyCodeBtn: '📋 Copy Code',
    copyLinkBtn: '🔗 Copy Invite Link',
    leaveRoomBtn: '🚪 Leave',
    codeCopied: 'Room code {code} copied! Share it with friends.',
    linkCopied: 'Direct invite link copied! Friends join automatically on click.',
    waitingFriend: 'Waiting for ally...',
    shareCodeHint: 'Room Code: {code}',
    hostBadge: '👑 Host',
    readyYes: '✅ Ready',
    readyNo: '⏳ Not Ready',
    meSuffix: ' (You)',
    stageSelectLabel: 'Mission Stage:',
    launchSquadBtn: '🚀 Deploy Squad ({n}/4P)',
    launchSoloRoomBtn: '🚀 Test Solo ({n}/4P)',
    hostPickedLabel: '🗺️ Stage:',
    clickReady: '🙋 Ready Up',
    readyWaitingHost: '✅ Ready (Waiting for Host)',
    scaleActiveInfo:
      'Active <strong>{n}P Squad</strong> Scaling: Horde <strong>×{c}</strong> · Zombie/Boss HP <strong>×{hp}</strong> · DMG <strong>×{dmg}</strong> · Door Cost <strong>×{door}</strong>',
    scalePreviewInfo:
      'Waiting for allies (2P Scaling: Horde <strong>×{c}</strong> · HP <strong>×{hp}</strong>; 4P Max: Horde <strong>×3.04</strong> · HP <strong>×2.65</strong>)',
    slot0: 'P1 Lead',
    slot1: 'P2 Assault',
    slot2: 'P3 Heavy',
    slot3: 'P4 Recon',
    defaultCallsignPrefix: 'Agent',
    errInvalidCode: 'Please enter a valid 5-character room code!',
    errRoomInGame: 'Match already in progress — cannot join mid-run!',
    errRoomFull: 'Squad is full (max 4 players)!',
    errRoomNotFound: 'Room [{code}] not found. Make sure the host is online!',
    errSignal: 'Connection error: {msg}',
    errHostLeft: 'Disconnected from host.',
    // HUD & In-Game
    shopBtn: 'Shop',
    subWepBadge: 'Sub',
    reloadingShort: 'Reload',
    waveEvac: 'Chopper Boarding {pct}%',
    waveBreak: 'Next Wave in {s}s',
    waveStd: 'Wave {w}/{m} · Left {n}',
    waveEndl: 'Endless W{w} · Left {n}',
    coopCountSuffix: ' · 👥{n}P',
    bossKing: 'Abyss King',
    bossTyrant: 'Armored Tyrant',
    feverActive: 'FEVER {s}s',
    squadWaitWave: '⏳ Next Wave',
    squadSOS: '🆘 SOS {s}s',
    // Pause & Modals
    pauseTitle: '⏸ Tactical Pause',
    pauseSub: 'Wave {w} · Kills {k} · Battle Lv.{lv}',
    resumeBtn: '▶ Resume Combat',
    autoFireBtn: '🎯 Auto-Fire: {state}',
    on: 'ON',
    off: 'OFF',
    soundMuted: '🔇 Sound: Muted',
    soundOn: '🔊 Sound: ON',
    fsBtn: '⛶ Fullscreen: {state}',
    langBtn: '🌐 Language: {lang}',
    quitHubBtn: '🏠 Return to Hub',
    // Armory Shop
    armoryTitle: '🛒 Armory',
    tabGuns: '🔫 Weapons',
    tabSupplies: '🧰 Supplies & Support',
    unlockedSectors: 'Sectors {n}',
    evolvedDone: '⚡ Equipped weapon evolved: [{name}]',
    evolvePrompt: '⚡ Evolve [{base}] into [{sup}]',
    evolveBtn: '${cost} Evolve',
    arsenalKeepHint:
      '🎒 All purchased weapons stay in your inventory (Owned: <strong>{n}</strong> · Free instant switch anytime via Shop, Q, Wheel, or Switch button)',
    buyBtn: '${cost} Buy',
    needDoors: '🔒 Open {n} Door(s)',
    freeSwitch: 'Equip Free',
    buyPermanent: '${cost} Keep Forever',
    equipNow: 'Equip',
    refillBtn: '+${cost} Ammo',
    equippedTag: 'Equipped',
    equippedFull: 'Equipped · Full',
    refillMainBtn: 'Ammo $${cost}',
    pillEquipped: 'Equipped',
    pillOwned: 'Owned',
    pillTrial: 'Trial {n}W',
    gunStatsTag: 'DMG {dmg} · Rate {rate}/s',
    // Supplies
    supArmorName: 'Kevlar Armor +65',
    supArmorMeta: 'Current {cur}/100 · Blocks 70% DMG',
    supAlloyWinName: 'Alloy Shock Windows',
    supAlloyWinMeta: 'Fortified {done}/{total} · 2x HP + Shock Counter-DMG',
    supAlloyWinBtn: '$180 Fortify All',
    supAlloyWinFullBtn: 'All Fortified',
    msgAlloyWinFull: 'All unlocked room windows already have full Alloy Shock Grids!',
    msgAlloyWinBought: '⚡ Fortified {n} sector windows with Alloy Shock Grids!',
    supMedkitName: 'Combat Medkit',
    supMedkitMeta: 'HP {hp}/{max}',
    supMedkitBtn: '$300 Full Heal',
    supGrenName: 'M67 Frag Grenade x3',
    supGrenMeta: 'Carried x{n}',
    supAllAmmoName: 'Max All Ammo',
    supAllAmmoMeta: 'Refills every owned weapon',
    supAllAmmoBtn: '$320 Refill',
    supTurretName: 'Auto Sentry Turret',
    supTurretMeta: 'Assists for 38 seconds',
    supTurretBtn: '$650 Deploy',
    supCashName: 'Emergency Cash Drop',
    supCashMeta: 'Instant +$450 field funds',
    supCashBtn: '🎬 Airdrop +$450',
    supHqName: 'HQ Turret + Full Ammo',
    supHqMeta: 'Full Ammo + 2 Grenades + 45s Turret',
    supElecName: 'High-Voltage Grid',
    supElecMeta: 'Barricade all + 2-wave shock slow',
    supFreeFirst: '🎁 Free 1st Use',
    supWatchAd: '🎬 Get Support',
    supCooldown: 'CD {s}s',
    supActiveWaves: 'Active ({w}W)',
    cashAddedToast: '💰 +$450 Field Funds Received!',
    // Revive & Settlement
    downedTitle: '🚨 Agent Down',
    downedSub: 'Reached Wave {w} · Eliminated {k} zombies',
    revPerk1: 'Shockwave Blast',
    revPerk2: 'Full HP & Ammo',
    revPerk3: 'Seal All Windows',
    reviveAdBtn: '🎬 Airdrop Revive',
    skipReviveBtn: 'Finish Run',
    victoryTitle: '🚁 Evac Complete!',
    settleTitle: '🎖️ Mission Report',
    multClaimBtn: '🎬 Bonus Claim',
    normalClaimBtn: 'Claim Rewards',
    // Mock Ad
    mockAdBadge: 'Dev Mode · Simulated Rewarded Ad',
    mockAdTitle: '📡 Calling HQ Supply Drop...',
    mockAdReward: 'Unlocking: <strong>{title}</strong>',
    mockAdTimer: 'Game muted & paused · {s}s remaining',
    mockAdCancel: 'Cancel',
    adUnavailableNotice: '⚠️ Video ad unavailable right now (disabled during Basic Launch test or blocked by AdBlocker)',
    // Engine / Renderer combat texts
    roomLocked: '🔒 Locked · {name}',
    boardChopper: 'Step onto Helipad [H] to Evac!',
    stepOrB: 'Step in / Press B',
    freeTrialTag: 'Free Trial',
    watchAdTag: 'Watch Ad',
    doorNeedMore: '${n} Left',
    thiefLabel: 'Loot Thief {s}s',
    lowAmmoWarn: 'Low Ammo!',
    sosAlly: '🆘 {name} SOS {s}s',
    sosSelf: '🆘 Downed {s}s',
    leftMoveHint: 'Move',
    bannerCoopStart: '🤝 {n}P Tactical Squad Deployed · Horde ×{m}',
    msgNeedRooms: '🔒 Unlock {n} new sector(s) on the map first!',
    msgNoCash: 'Not enough cash ($${c})!',
    msgBoughtPerm: 'Unlocked & equipped [{name}] permanently!',
    msgSwitched: 'Equipped [{name}]!',
    msgInfAmmo: 'Infinite reserve — equipped!',
    msgAmmoFull: 'Ammo already full — equipped!',
    msgRefilled: 'Refilled [{name}] ammo!',
    msgBoughtGun: 'Purchased [{name}] (Old weapons kept — press Q or Switch anytime)!',
    msgAlreadyEvo: 'Current weapon is already evolved!',
    msgEvolved: '⚡ Super Evolution: [{name}]!',
    msgArmorFull: 'Armor is already full (100/100)!',
    msgArmorBought: '🦺 Equipped Kevlar Plate (+65 Armor, absorbs 70% DMG)!',
    msgGrenBought: '💣 Purchased 3 M67 Frag Grenades!',
    msgHpFull: 'HP is already full!',
    msgHealed: '❤️ Full HP restored!',
    msgTurretDeployed: '🛰️ Auto Sentry Turret deployed (38s)!',
    msgAllAmmoFull: '📦 All carried weapons refilled!',
    ftRevivedBy: '💉 Revived by {name}!',
    ftWaveRevive: '💉 Wave Clear Auto-Revive!',
    ftTrialExpired: 'Trial Super Weapon Expired',
    bannerBossWave: '👑 Wave {w} · Abyss King Incoming!',
    bannerEliteWave: '🛡️ Wave {w} · Armored Tyrants Incoming!',
    bannerReviveDrop: '⚡ Shockwave Revive Drop · Full HP!',
    bannerHqSupport: '🛰️ Full Ammo & Grenades + 45s Sentry Deployed!',
    bannerElecGrid: '⚡ All Windows Upgraded to High-Voltage Shock Grid (2 Waves)!',
    bannerAllyElec: '⚡ Ally Support: High-Voltage Window Grid Activated!',
    ftInterest: 'War Bonds +$${n}!',
    bannerEvacReady: '🚁 Evac Chopper Inbound · Reach Helipad [H]!',
    bannerBledOut: '⏳ Critically Downed · Auto-reviving when wave clears',
    ftOutOfAmmo: '⚠️ [{name}] Empty! Switched to Pistol',
    bannerOutOfAmmo: '⚠️ [{name}] Out of Ammo! Switched to Pistol — Tap [Refill ${cost}] to re-equip',
    quickAmmoBtn: 'Ammo ${cost}',
    quickAmmoReequipBtn: 'Refill & Equip ${cost}',
    ftQuickRefilled: '📦 [{name}] Full Ammo!',
    bannerDoorOpen: '🔓 Unlocked [{name}]',
    bannerDoorBreach: '🔓 Captured [{name}]! Free Relic Chest + Cash Dropped · Squad DMG +{dmg}% · +${bonus}/Wave',
    ftBreachLoot: '🎁 Breach Supply Drop!',
    ftSectorStipend: '🏰 Sector Stipend +${n}!',
    hudSectorBuff: '🏰 ×{n} +{dmg}%',
    hudSectorTip: 'Captured {n} sector(s): Squad DMG +{dmg}% · Wave Stipend +${bonus}',
    winUpgradePrompt: '⚡ $80 Alloy Shock Grid',
    ftWinFortified: '⚡ Alloy Shock Window Active!',
    ftDoorPool: '💰 Door +$${paid} ($${left} left)',
    ftRepairCash: '🔨 Barricade +$${n}',
    ftRepaired: '🔨 Reinforced',
    ftAmmoFull: '📦 Max Ammo',
    ftMechDog: '🐕 Cyber Hound Deployed!',
    ftVendHeal: '🍔 Full HP + 35 Armor',
    ftVendOverdrive: '🥤 7s Overdrive!',
    ftVendJackpot: '🎰 Jackpot +$300!',
    ftLaserOn: '🚨 Laser Matrix Active!',
    ftEquipped: 'Equipped: {name}',
    ftRelicMax: 'All Relics Owned +$350',
    rarityLeg: 'Legendary Relic',
    rarityEpic: 'Epic Device',
    rarityRare: 'Rare Module',
    ftGotRelic: 'Relic: {name}',
    ftFever: '🔥 FEVER MODE!',
    ftNanoHeal: 'Nano Heal +{n}',
    ftKillSiphon: '💉 Blood Siphon +{n} HP',
    ftMedDrop: '❤️ Medkit +{n} HP',
    ftWaveHeal: '💚 Wave Recovery +{n} HP',
    ftRiotBlock: '🛡️ Shield Ricochet!',
    ftNecroBuff: '🔮 Dark Frenzy!',
    ftBoomerBlast: '💥 Bio-Explosion!',
    ftDropChest: 'Supply Chest Dropped!',
    ftBlast: '💥 High-Ex Blast!',
    ftShockPlank: '🛡️ Shockwave!',
    ftThiefEscaped: '💨 Loot Thief Escaped!',
    ftTyrantCharge: '💢 Tyrant Charge!',
    bannerBossRage: '👑 Abyss King Enraged! Speed Boost + Hellhounds Summoned!',
    bannerSelfDown: '🆘 You are DOWNED! Crawl to teammates for rescue',
    badgeBattleLv: 'Battle Perk Lv.{lv}',
    ftRescuedAlly: '💉 Rescued {name}!',
    ftRescueBonus: 'Rescue Bonus +$65',
    ftAllySaved: '💉 {name} Revived!',
    bannerHostDisc: '⚠️ Host Disconnected · Mission Aborted',
    bannerPeerLeft: '📡 [{name}] Left · Horde Difficulty Rebalanced',
  },
  zh: {
    gameTitle: '僵尸防线大作战',
    gameSub: 'SAS ZOMBIE FRONTLINE · 1~4人联机突围',
    rotateTitle: '请将手机横过来游玩',
    rotateDesc: '横屏宽幅视野，双摇杆走位与射击体验最佳',
    rotateBtn: '⛶ 一键全屏并锁定横屏',
    tabStages: '🗺️ 单人战区',
    tabCoop: '🤝 多人联机',
    tabUpgrades: '⚡ 特工强化',
    tabDaily: '📅 每日任务',
    tabRank: '🏆 排行榜',
    footerTip:
      '📱 触屏：左手摇杆走位 · 右下角轮盘射击/拖动瞄准 + 切枪/手雷/换弹 ｜ 💻 键鼠：WASD · 鼠标射击 · B 商店 · V 快捷补弹 · Q 切枪 · G 手雷',
    rank1: '新锐特工',
    rank3: '破阵先锋',
    rank5: '铁血军士长',
    rank8: '王牌指挥官',
    rank12: '传奇统帅',
    allGunDmgBonus: '全枪伤害 +{pct}%',
    xpProgress: '经验 {cur}/{next}',
    clearedStat: '🏆 通关 {done}/{total}',
    bestEndlessStat: '♾️ 最高 {wave} 波',
    noRecord: '待挑战',
    arsenalStat: '🔫 15把超武重火器',
    modeStandard: '🚁 10波撤离',
    modeEndless: '♾️ 无尽尸潮',
    modeDescStandard: '坚守 10 波防线并击毙狂暴尸王，前往停机坪搭乘直升机撤离',
    modeDescEndless: '无波次上限，精英暴君与尸王轮番压境，冲击最高生存波次纪录',
    heroCaption: '🔨 修窗固防 · 🔓 开门拓荒 · ⚡ 超武觉醒',
    deployStandard: '▶ 空降出击 (10波撤离)',
    deployEndless: '▶ 迎战无尽尸潮',
    stageCleared: '✅ 已通关',
    stageLockedBadge: '🔒 未解锁',
    stageLockedBtn: '🔒 通关第 {n} 关解锁',
    stageEndlessBest: '🏆 最高 {w} 波',
    stageEndlessTry: '♾️ 极限生存',
    arsenalPreviewTitle: '🔥 战地军火库图鉴',
    arsenalPreviewSub: '局内开门解锁 · 全枪械支持超武进化',
    pillRepair: '🔨 近窗自动钉板',
    pillChest: '🎁 奇物空投箱',
    pillBoss: '👑 决战狂暴尸王',
    upgPermanentBonus: '全枪械永久伤害加成 +{pct}%',
    upgMaxed: '已满级',
    upgBuy: '强化升级',
    classSecTitle: '🪖 特工专精流派（专属被动 + 局内主动大招 [F]）',
    classEquipped: '✅ 出战中',
    classSelect: '切换出战',
    classUnlock: '解锁专精',
    classSkillTag: '主动技 [F]：',
    upgSecTitle: '🧬 核心科技永久强化（10大模块）',
    dailySignTitle: '📅 七日战备签到补给',
    dailyStreakBadge: '🔥 连续签到 {n} 天',
    dailyDayLabel: '第 {d} 天',
    dailyClaimed: '✅ 已领取',
    dailyClaimNow: '🎁 立即签到领奖',
    dailyTomorrow: '明日再来领取',
    dailyMissionsTitle: '📋 每日战地悬赏任务（每日 0 点刷新）',
    dailyGrandTitle: '🎁 每日全勤终极补给箱',
    dailyGrandDesc: '完成今日全部 4 项悬赏任务即可额外开启大奖宝箱！',
    dailyGoBtn: '进行中',
    dailyClaimBtn: '领取奖励',
    rankTitleEndless: '♾️ 无尽尸潮生存天梯榜',
    rankTitleKills: '🎖️ 特工总歼敌军功榜',
    rankMySummary: '我的当前排名：<strong>第 #{rank} 名</strong> · 最高无尽 <strong>{w} 波</strong> · 生涯总击杀 <strong>{k}</strong>',
    rankChaseHint: '🔥 距离第 #{prevRank} 名【{name}】仅差 <strong>{gap}</strong>，再冲一把即可超越！',
    rankTopOneHint: '👑 你已登顶全服天梯榜第一名 · 传奇统帅！',
    rankColRank: '名次',
    rankColAgent: '特工代号',
    rankColWave: '最高波次',
    rankColKills: '累计歼敌',
    rankColCleared: '通关战区',
    perkPickTitle: '⚡ 战地晋升 Lv.{lv} · 选择 1 项战术强化',
    perkPickHint: '点击卡片或按键盘 [1] / [2] / [3] 立即生效',
    ftSkillReady: '⚡ 【{name}】释放!',
    ftAmmoScav: '回弹 +{n}',
    coopRule1: '🧟 <strong>动态尸潮强化</strong>：2~4 人尸潮规模最高 ×3.04 · 尸王血量 ×2.65 · 双暴君突袭',
    coopRule2: '💰 <strong>独立钱包+合资开门</strong>：掉落赏金全队协防分成，防爆门可多人凑钱解锁',
    coopRule3: '💉 <strong>倒地救援</strong>：重伤可爬行求援，队友靠近 2.2s 拉起，波次清空全员自动起身',
    callsignLabel: '🪖 特工代号：',
    callsignPlaceholder: '输入昵称',
    saveCallsign: '保存代号',
    callsignSaved: '特工代号已更新为【{name}】',
    p2pBadge: '🌐 WebRTC P2P 直连 · 零服务器延迟 · 支持电脑/手机跨平台组队',
    connectingMsg: '⏳ 正在建立加密战术通信频道，请稍候...',
    createCardTitle: '📡 创建战术小队（房主）',
    createCardDesc: '生成 5 位房间码或一键复制直连邀请链接，发给好友点开即进（最多 4 人）。',
    createRoomBtn: '➕ 创建 1~4 人联机房间',
    joinCardTitle: '🔑 输入房间码加入小队',
    joinCardDesc: '输入房主分享的 5 位房间码，立即加入防守编队协同作战。',
    codePlaceholder: '输入5位房间码',
    joinRoomBtn: '🚀 加入房间',
    roomCodeLabel: '小队房间码',
    copyCodeBtn: '📋 复制房间码',
    copyLinkBtn: '🔗 复制直连邀请链接',
    leaveRoomBtn: '🚪 离开房间',
    codeCopied: '房间码 {code} 已复制，快发给好友吧！',
    linkCopied: '直连邀请链接已复制！好友点开链接即可秒进房间',
    waitingFriend: '等待好友加入...',
    shareCodeHint: '分享房间码 {code}',
    hostBadge: '👑 房主',
    readyYes: '✅ 已准备',
    readyNo: '⏳ 准备中',
    meSuffix: ' (我)',
    stageSelectLabel: '作战地图：',
    launchSquadBtn: '🚀 全队空降出击 ({n}/4人)',
    launchSoloRoomBtn: '🚀 单人试跑此房间 ({n}/4人)',
    hostPickedLabel: '🗺️ 房主已选：',
    clickReady: '🙋 点击准备就绪',
    readyWaitingHost: '✅ 已就绪（等待房主发车）',
    scaleActiveInfo:
      '当前 <strong>{n}人小队</strong> 生效难度：尸潮数量 <strong>×{c}</strong> · 僵尸/尸王血量 <strong>×{hp}</strong> · 伤害 <strong>×{dmg}</strong> · 合资门费 <strong>×{door}</strong>',
    scalePreviewInfo:
      '待好友加入（2人时预计难度：尸潮数量 <strong>×{c}</strong> · 血量 <strong>×{hp}</strong>；4人满编尸潮 <strong>×3.04</strong> · 血量 <strong>×2.65</strong>）',
    slot0: 'P1 队长',
    slot1: 'P2 突击',
    slot2: 'P3 重装',
    slot3: 'P4 侦察',
    defaultCallsignPrefix: '特工',
    errInvalidCode: '请输入有效的 5 位小队房间码！',
    errRoomInGame: '该小队已经空降开战，无法中途加入！',
    errRoomFull: '小队人数已满（最多 4 人）！',
    errRoomNotFound: '未找到房间【{code}】，请确认房间码正确且房主在线！',
    errSignal: '连接异常：{msg}',
    errHostLeft: '与房主连接已断开',
    shopBtn: '商店',
    subWepBadge: '副武',
    reloadingShort: '换弹中',
    waveEvac: '直升机登机撤离 {pct}%',
    waveBreak: '战备休整 {s}s',
    waveStd: '第 {w}/{m} 波 · 剩余 {n}',
    waveEndl: '无尽 第 {w} 波 · 剩余 {n}',
    coopCountSuffix: ' · 👥{n}人',
    bossKing: '深渊尸王',
    bossTyrant: '重装暴君',
    feverActive: '狂暴火力 {s}s',
    squadWaitWave: '⏳ 待下波起身',
    squadSOS: '🆘 求救 {s}s',
    pauseTitle: '⏸ 战术暂停',
    pauseSub: '第 {w} 波 · 击杀 {k} · 战斗 Lv.{lv}',
    resumeBtn: '▶ 继续战斗',
    autoFireBtn: '🎯 自动射击：{state}',
    on: '开启',
    off: '关闭',
    soundMuted: '🔇 音效：已静音',
    soundOn: '🔊 音效：开启',
    fsBtn: '⛶ 全屏模式：{state}',
    langBtn: '🌐 语言：{lang}',
    quitHubBtn: '🏠 返回基地大厅',
    armoryTitle: '🛒 军火库',
    tabGuns: '🔫 枪械',
    tabSupplies: '🧰 补给与支援',
    unlockedSectors: '已开防区 {n}',
    evolvedDone: '⚡ 当前主武器已进化为超武【{name}】',
    evolvePrompt: '⚡ 将【{base}】进化为超武【{sup}】',
    evolveBtn: '${cost} 进化',
    arsenalKeepHint:
      '🎒 本局已购枪械全部保留（当前持有 <strong>{n}</strong> 把 · 已拥有枪械可随时免费切换，或按 Q / 滚轮 / 右下切枪键轮换）',
    buyBtn: '${cost} 购买',
    needDoors: '🔒 需开 {n} 扇门',
    freeSwitch: '免费切换',
    buyPermanent: '${cost} 转永久',
    equipNow: '切换上阵',
    refillBtn: '+${cost} 补弹',
    equippedTag: '装备中',
    equippedFull: '装备中·满弹',
    refillMainBtn: '补弹 $${cost}',
    pillEquipped: '当前装备',
    pillOwned: '已拥有',
    pillTrial: '试用{n}波',
    gunStatsTag: '威力 {dmg} · 射速 {rate}/s',
    supArmorName: '防弹护甲 +65',
    supArmorMeta: '当前 {cur}/100 · 减伤70%',
    supAlloyWinName: '防区合金电击窗',
    supAlloyWinMeta: '已加固 {done}/{total} 扇 · 双倍耐久+扒窗电击反伤',
    supAlloyWinBtn: '$180 全防区加固',
    supAlloyWinFullBtn: '已全部加固',
    msgAlloyWinFull: '当前所有已开启防区的窗户均已满载合金电网！',
    msgAlloyWinBought: '⚡ 已为当前防区 {n} 扇窗户加装【合金电击装甲】！',
    supMedkitName: '战地急救包',
    supMedkitMeta: '生命 {hp}/{max}',
    supMedkitBtn: '$300 恢复满血',
    supGrenName: 'M67 破片手雷 x3',
    supGrenMeta: '当前持有 x{n}',
    supAllAmmoName: '全枪弹药补满',
    supAllAmmoMeta: '补满携带的所有枪械',
    supAllAmmoBtn: '$320 补满',
    supTurretName: '自动哨戒机枪塔',
    supTurretMeta: '持续协防 38 秒',
    supTurretBtn: '$650 部署',
    supCashName: '紧急军费空投',
    supCashMeta: '立即获得 $450 战地经费',
    supCashBtn: '🎬 空投 +$450',
    supHqName: '总部炮塔+满弹支援',
    supHqMeta: '满弹 + 手雷x2 + 45秒炮塔',
    supElecName: '全图高压电网',
    supElecMeta: '全窗封满 + 持续2波电击减速',
    supFreeFirst: '🎁 首次免费',
    supWatchAd: '🎬 支援获取',
    supCooldown: '冷却 {s}s',
    supActiveWaves: '生效中({w}波)',
    cashAddedToast: '💰 军费 +$450 已到账',
    downedTitle: '🚨 特工倒地',
    downedSub: '坚守至第 {w} 波 · 歼灭 {k} 只僵尸',
    revPerk1: '全屏震飞',
    revPerk2: '满血满弹',
    revPerk3: '全窗封死',
    reviveAdBtn: '🎬 空投复活',
    skipReviveBtn: '直接结算',
    victoryTitle: '🚁 撤离成功',
    settleTitle: '🎖️ 行动结算',
    multClaimBtn: '🎬 翻倍领取',
    normalClaimBtn: '普通领取',
    mockAdBadge: '开发调试 · 模拟激励视频',
    mockAdTitle: '📡 正在呼叫总部空投支援...',
    mockAdReward: '即将解锁：<strong>{title}</strong>',
    mockAdTimer: '游戏已自动静音并暂停 · 剩余 {s} 秒',
    mockAdCancel: '放弃奖励',
    adUnavailableNotice: '⚠️ 当前暂无可用视频广告（平台测试期未开启广告或被插件拦截）',
    roomLocked: '🔒 未开启 · {name}',
    boardChopper: '踩入停机坪登机撤离!',
    stepOrB: '踩入或按 B',
    freeTrialTag: '免费试用',
    watchAdTag: '看广告领',
    doorNeedMore: '还差 ${n}',
    thiefLabel: '盗宝怪 {s}s',
    lowAmmoWarn: '弹药偏低!',
    sosAlly: '🆘 {name} 求救 {s}s',
    sosSelf: '🆘 倒地待救 {s}s',
    leftMoveHint: '左手移动',
    bannerCoopStart: '🤝 {n}人战术小队集结 · 尸潮强度 ×{m}',
    msgNeedRooms: '🔒 需先在地图中开门解锁 {n} 个新区域！',
    msgNoCash: '钞票不足 ($${c})！',
    msgBoughtPerm: '已永久买断并装备【{name}】！',
    msgSwitched: '已切换装备【{name}】！',
    msgInfAmmo: '该武器无限备弹，已装备上阵！',
    msgAmmoFull: '弹药已满，已装备上阵！',
    msgRefilled: '已补满【{name}】弹药！',
    msgBoughtGun: '成功购入【{name}】（原有武器已保留，可随时切换）！',
    msgAlreadyEvo: '当前武器已经是超武形态！',
    msgEvolved: '⚡ 超武觉醒：【{name}】！',
    msgArmorFull: '当前防弹护甲已满 (100/100)！',
    msgArmorBought: '🦺 已穿戴凯夫拉防弹插板 (+65 护甲，抵消 70% 受击伤害)！',
    msgGrenBought: '💣 已购入 3 颗高爆破片手雷！',
    msgHpFull: '当前生命值已满！',
    msgHealed: '❤️ 战地急救完成，生命值已回满！',
    msgTurretDeployed: '🛰️ 自动哨戒机枪塔已部署 (38秒)！',
    msgAllAmmoFull: '📦 全身所有枪械弹药已补满！',
    ftRevivedBy: '💉 {name} 战地救援!',
    ftWaveRevive: '💉 波次集结自动起身!',
    ftTrialExpired: '空投试用超武已到期',
    bannerBossWave: '👑 第 {w} 波 · 狂暴尸王降临',
    bannerEliteWave: '🛡️ 第 {w} 波 · 重装精英突袭',
    bannerReviveDrop: '⚡ 震爆空投支援抵达 · 满血复活',
    bannerHqSupport: '🛰️ 弹药&手雷已补给！自动哨戒机枪塔已部署 (45秒)！',
    bannerElecGrid: '⚡ 全图窗户已升级为【高压电击钢网】(持续2波)！',
    bannerAllyElec: '⚡ 队友支援：全图窗户已升级为【高压电击钢网】！',
    ftInterest: '战备利息 +$${n}!',
    bannerEvacReady: '🚁 救援直升机已就位 · 全队前往 H 停机坪集结撤离',
    bannerBledOut: '⏳ 重伤失血昏迷 · 本波清场后将自动起身参战',
    ftOutOfAmmo: '⚠️ 【{name}】子弹耗尽！已切回手枪',
    bannerOutOfAmmo: '⚠️ 【{name}】子弹耗尽，已切回手枪！点击右侧【补弹切回 ${cost}】立即重装',
    quickAmmoBtn: '补弹 ${cost}',
    quickAmmoReequipBtn: '补弹切回 ${cost}',
    ftQuickRefilled: '📦 【{name}】满弹上膛!',
    bannerDoorOpen: '🔓 已开启【{name}】',
    bannerDoorBreach: '🔓 占领【{name}】！已空投免费遗物箱&赏金 · 全队伤害 +{dmg}% · 每波津贴 +${bonus}',
    ftBreachLoot: '🎁 破门战术补给箱!',
    ftSectorStipend: '🏰 防区占领津贴 +${n}!',
    hudSectorBuff: '🏰 防区×{n} 伤+{dmg}%',
    hudSectorTip: '已占领 {n} 个防区：全队枪械/炮塔伤害 +{dmg}% · 每波结算津贴 +${bonus}',
    winUpgradePrompt: '⚡ $80 升级合金电网',
    ftWinFortified: '⚡ 合金电击装甲窗已激活!',
    ftDoorPool: '💰 合资开门 +$${paid} (还差 $${left})',
    ftRepairCash: '🔨 修窗 +$${n}',
    ftRepaired: '🔨 已加固',
    ftAmmoFull: '📦 弹药已满',
    ftMechDog: '🐕 机械警犬出击!',
    ftVendHeal: '🍔 满血 + 35护甲',
    ftVendOverdrive: '🥤 7秒无限火力',
    ftVendJackpot: '🎰 头奖 +$300',
    ftLaserOn: '🚨 激光绞杀已激活',
    ftEquipped: '装备：{name}',
    ftRelicMax: '战术模组满阶 +$350',
    rarityLeg: '传奇战术遗物',
    rarityEpic: '史诗战术装置',
    rarityRare: '精良战术模组',
    ftGotRelic: '获得 {name}',
    ftFever: '🔥 狂暴时刻!',
    ftNanoHeal: '纳米修复 +{n}',
    ftKillSiphon: '💉 嗜血虹吸 +{n} HP',
    ftMedDrop: '❤️ 急救包 +{n} HP',
    ftWaveHeal: '💚 波次喘息 +{n} HP',
    ftRiotBlock: '🛡️ 重盾格挡!',
    ftNecroBuff: '🔮 巫医狂化!',
    ftBoomerBlast: '💥 脓毒自爆!',
    ftDropChest: '掉落战术空投箱!',
    ftBlast: '💥 高爆轰击!',
    ftShockPlank: '🛡️ 震荡弹开!',
    ftThiefEscaped: '💨 盗宝怪溜走了!',
    ftTyrantCharge: '💢 暴君冲锋!',
    bannerBossRage: '👑 尸王进入狂暴二阶段！移速飙升并召唤嗜血猎犬！',
    bannerSelfDown: '🆘 你已重伤倒地！向队友爬行等待救援',
    badgeBattleLv: '战地晋升 Lv.{lv}',
    ftRescuedAlly: '💉 已救起 {name}!',
    ftRescueBonus: '战地救援 +$65',
    ftAllySaved: '💉 {name} 已获救!',
    bannerHostDisc: '⚠️ 房主连接已断开 · 小队行动中止',
    bannerPeerLeft: '📡 队友【{name}】已离线 · 尸潮强度已自动重平衡',
  },
  es: {
    gameTitle: 'Zombie Room Defense',
    gameSub: ' ASEDIO TÁCTICO SAS · CO-OP 1–4J',
    rotateTitle: 'Gira tu dispositivo en horizontal',
    rotateDesc: 'La vista panorámica ofrece el mejor control de doble joystick',
    rotateBtn: '⛶ Pantalla completa horizontal',
    tabStages: '🗺️ Misiones',
    tabCoop: '🤝 Co-op (1-4J)',
    tabUpgrades: '⚡ Mejoras',
    tabDaily: '📅 Diario',
    tabRank: '🏆 Rango',
    footerTip: '📱 Táctil: Izq. mover · Der. disparar/apuntar ｜ 💻 PC: WASD · Ratón · B Tienda · Q Cambiar · G Granada',
    rank1: 'Agente Novato',
    rank3: 'Vanguardia',
    rank5: 'Sargento Mayor',
    rank8: 'Comandante As',
    rank12: 'Mariscal Legendario',
    allGunDmgBonus: 'Daño de armas +{pct}%',
    xpProgress: 'EXP {cur}/{next}',
    clearedStat: '🏆 Superados {done}/{total}',
    bestEndlessStat: '♾️ Récord {wave}',
    noRecord: 'Sin récord',
    arsenalStat: '🔫 15 Armas Evo',
    modeStandard: '🚁 Evac 10 Oleadas',
    modeEndless: '♾️ Horda Infinita',
    modeDescStandard: '¡Resiste 10 oleadas, derrota al Rey Abisal y sube al helicóptero!',
    modeDescEndless: '¡Oleadas infinitas cada vez más letales para batir tu récord!',
    heroCaption: '🔨 Repara Ventanas · 🔓 Abre Sectores · ⚡ Evoluciona Armas',
    deployStandard: '▶ Desplegar (10 Oleadas)',
    deployEndless: '▶ Modo Infinito',
    stageCleared: '✅ Completado',
    stageEndlessBest: '🏆 Oleada {w}',
    stageEndlessTry: '♾️ Supervivencia',
    arsenalPreviewTitle: '🔥 Arsenal Táctico',
    arsenalPreviewSub: 'Abre puertas para desbloquear · Todas evolucionan',
    pillRepair: '🔨 Barricadas Auto',
    pillChest: '🎁 Cofres de Reliquias',
    pillBoss: '👑 Jefe Final',
    upgPermanentBonus: 'Daño permanente de armas +{pct}%',
    upgMaxed: 'MÁX',
    upgBuy: 'Mejorar',
    coopRule1: '🧟 <strong>Dificultad Dinámica</strong>: Hasta ×3.04 zombis y ×2.65 vida de Jefe en 4J',
    coopRule2: '💰 <strong>Fondo Individual + Puertas Grupales</strong>: Recompensas compartidas y pago conjunto de puertas',
    coopRule3: '💉 <strong>Reanimación</strong>: Arrástrate al caer, reanima en 2.2s o al limpiar la oleada',
    callsignLabel: '🪖 Alias:',
    callsignPlaceholder: 'Tu nombre',
    saveCallsign: 'Guardar',
    callsignSaved: 'Alias actualizado a [{name}]',
    p2pBadge: '🌐 Conexión P2P directa · PC y Móvil',
    connectingMsg: '⏳ Conectando canal táctico...',
    createCardTitle: '📡 Crear Escuadrón (Anfitrión)',
    createCardDesc: 'Genera un código de 5 letras o enlace directo para hasta 4 jugadores.',
    createRoomBtn: '➕ Crear Sala 1–4J',
    joinCardTitle: '🔑 Unirse con Código',
    joinCardDesc: 'Introduce el código de 5 letras del anfitrión para unirte.',
    codePlaceholder: 'Código 5 letras',
    joinRoomBtn: '🚀 Unirse',
    roomCodeLabel: 'CÓDIGO',
    copyCodeBtn: '📋 Copiar Código',
    copyLinkBtn: '🔗 Copiar Enlace',
    leaveRoomBtn: '🚪 Salir',
    codeCopied: '¡Código {code} copiado!',
    linkCopied: '¡Enlace de invitación copiado!',
    waitingFriend: 'Esperando aliado...',
    shareCodeHint: 'Código: {code}',
    hostBadge: '👑 Líder',
    readyYes: '✅ Listo',
    readyNo: '⏳ Esperando',
    meSuffix: ' (Tú)',
    stageSelectLabel: 'Mapa:',
    launchSquadBtn: '🚀 Desplegar Escuadrón ({n}/4J)',
    launchSoloRoomBtn: '🚀 Probar Solo ({n}/4J)',
    hostPickedLabel: '🗺️ Mapa:',
    clickReady: '🙋 Estoy Listo',
    readyWaitingHost: '✅ Listo (Esperando al líder)',
    shopBtn: 'Tienda',
    quickAmmoBtn: 'Munición ${cost}',
    quickAmmoReequipBtn: 'Recargar ${cost}',
    bannerOutOfAmmo: '⚠️ ¡[{name}] sin munición! Pulsa [Recargar ${cost}] para reequipar',
    ftOutOfAmmo: '⚠️ ¡[{name}] vacía! Pistola equipada',
    ftQuickRefilled: '📦 ¡[{name}] munición llena!',
    subWepBadge: 'Sec',
    reloadingShort: 'Recarg.',
    waveEvac: 'Evacuación {pct}%',
    waveBreak: 'Descanso {s}s',
    waveStd: 'Oleada {w}/{m} · Quedan {n}',
    waveEndl: 'Infinito O{w} · Quedan {n}',
    coopCountSuffix: ' · 👥{n}J',
    bossKing: 'Rey Abisal',
    bossTyrant: 'Tirano Blindado',
    feverActive: 'FRENESÍ {s}s',
    pauseTitle: '⏸ Pausa Táctica',
    resumeBtn: '▶ Continuar',
    autoFireBtn: '🎯 Auto-Disparo: {state}',
    on: 'SÍ',
    off: 'NO',
    soundMuted: '🔇 Sonido: Silencio',
    soundOn: '🔊 Sonido: Activo',
    fsBtn: '⛶ Pantalla Completa: {state}',
    langBtn: '🌐 Idioma: {lang}',
    quitHubBtn: '🏠 Volver a la Base',
    armoryTitle: '🛒 Armería',
    tabGuns: '🔫 Armas',
    tabSupplies: '🧰 Suministros',
    unlockedSectors: 'Sectores {n}',
    buyBtn: '${cost} Comprar',
    needDoors: '🔒 Abre {n} Puerta(s)',
    equipNow: 'Equipar',
    refillBtn: '+${cost} Munición',
    equippedTag: 'Equipada',
    equippedFull: 'Equipada · Llena',
    refillMainBtn: 'Munición $${cost}',
    pillEquipped: 'En uso',
    pillOwned: 'Adquirida',
    victoryTitle: '🚁 ¡Evacuación Exitosa!',
    settleTitle: '🎖️ Informe de Misión',
    multClaimBtn: '🎬 Multiplicar',
    normalClaimBtn: 'Reclamar',
  },
  pt: {
    gameTitle: 'Zombie Room Defense',
    gameSub: 'CERCO TÁTICO SAS · CO-OP 1–4J',
    rotateTitle: 'Gire o celular para horizontal',
    rotateDesc: 'A tela panorâmica oferece a melhor jogabilidade',
    rotateBtn: '⛶ Tela Cheia Horizontal',
    tabStages: '🗺️ Missões',
    tabCoop: '🤝 Co-op (1-4J)',
    tabUpgrades: '⚡ Melhorias',
    tabDaily: '📅 Diário',
    tabRank: '🏆 Ranking',
    modeStandard: '🚁 Evac 10 Ondas',
    modeEndless: '♾️ Horda Infinita',
    deployStandard: '▶ Iniciar (10 Ondas)',
    deployEndless: '▶ Horda Infinita',
    stageCleared: '✅ Concluído',
    upgMaxed: 'MÁX',
    upgBuy: 'Melhorar',
    createRoomBtn: '➕ Criar Sala 1–4J',
    joinRoomBtn: '🚀 Entrar na Sala',
    copyCodeBtn: '📋 Copiar Código',
    copyLinkBtn: '🔗 Link de Convite',
    leaveRoomBtn: '🚪 Sair',
    shopBtn: 'Loja',
    quickAmmoBtn: 'Munição ${cost}',
    quickAmmoReequipBtn: 'Recarregar ${cost}',
    bannerOutOfAmmo: '⚠️ [{name}] sem munição! Toque em [Recarregar ${cost}]',
    ftOutOfAmmo: '⚠️ [{name}] sem munição! Pistola equipada',
    ftQuickRefilled: '📦 [{name}] munição cheia!',
    reloadingShort: 'Recarreg.',
    waveEvac: 'Evacuação {pct}%',
    waveBreak: 'Preparar {s}s',
    waveStd: 'Onda {w}/{m} · Restam {n}',
    waveEndl: 'Infinito O{w} · Restam {n}',
    pauseTitle: '⏸ Pausa Tática',
    resumeBtn: '▶ Continuar',
    langBtn: '🌐 Idioma: {lang}',
    quitHubBtn: '🏠 Voltar ao Menu',
    armoryTitle: '🛒 Arsenal',
    tabGuns: '🔫 Armas',
    tabSupplies: '🧰 Suprimentos',
    buyBtn: '${cost} Comprar',
    equipNow: 'Equipar',
    equippedTag: 'Equipada',
    victoryTitle: '🚁 Evacuação Concluída!',
    settleTitle: '🎖️ Relatório Final',
    multClaimBtn: '🎬 Multiplicar',
    normalClaimBtn: 'Coletar',
  },
  ru: {
    gameTitle: 'Zombie Room Defense',
    gameSub: 'ТАКТИЧЕСКАЯ ОБОРОНА · КО-ОП 1–4',
    rotateTitle: 'Поверните устройство горизонтально',
    rotateDesc: 'Широкий экран удобнее для стрельбы и движения',
    rotateBtn: '⛶ Полный экран',
    tabStages: '🗺️ Миссии',
    tabCoop: '🤝 Ко-оп (1-4)',
    tabUpgrades: '⚡ Улучшения',
    tabDaily: '📅 Задания',
    tabRank: '🏆 Рейтинг',
    modeStandard: '🚁 Эвакуация (10 волн)',
    modeEndless: '♾️ Бесконечный режим',
    deployStandard: '▶ В бой (10 волн)',
    deployEndless: '▶ Бесконечная орда',
    stageCleared: '✅ Пройдено',
    upgMaxed: 'МАКС',
    upgBuy: 'Улучшить',
    createRoomBtn: '➕ Создать комнату (1–4)',
    joinRoomBtn: '🚀 Войти по коду',
    copyCodeBtn: '📋 Копировать код',
    copyLinkBtn: '🔗 Ссылка-приглашение',
    leaveRoomBtn: '🚪 Выйти',
    shopBtn: 'Магазин',
    quickAmmoBtn: 'Патроны ${cost}',
    quickAmmoReequipBtn: 'Купить и взять ${cost}',
    bannerOutOfAmmo: '⚠️ [{name}] без патронов! Нажмите [Купить ${cost}]',
    ftOutOfAmmo: '⚠️ [{name}] пусто! Взят пистолет',
    ftQuickRefilled: '📦 [{name}] боезапас полон!',
    reloadingShort: 'Перезар.',
    waveEvac: 'Эвакуация {pct}%',
    waveBreak: 'Передышка {s}с',
    waveStd: 'Волна {w}/{m} · Осталось {n}',
    waveEndl: 'Волна {w} · Осталось {n}',
    pauseTitle: '⏸ Пауза',
    resumeBtn: '▶ Продолжить',
    langBtn: '🌐 Язык: {lang}',
    quitHubBtn: '🏠 В главное меню',
    armoryTitle: '🛒 Арсенал',
    tabGuns: '🔫 Оружие',
    tabSupplies: '🧰 Припасы',
    buyBtn: '${cost} Купить',
    equipNow: 'Взять',
    equippedTag: 'В руках',
    victoryTitle: '🚁 Эвакуация успешна!',
    settleTitle: '🎖️ Итоги боя',
    multClaimBtn: '🎬 Умножить',
    normalClaimBtn: 'Забрать',
  },
  ja: {
    gameTitle: 'Zombie Room Defense',
    gameSub: 'タクティカル防衛 · 1〜4人協力プレイ',
    rotateTitle: '画面を横向きにしてください',
    rotateDesc: 'ワイド画面で快適なデュアルスティック操作が可能です',
    rotateBtn: '⛶ 全画面＆横向き固定',
    tabStages: '🗺️ ソロ戦区',
    tabCoop: '🤝 マルチ協力',
    tabUpgrades: '⚡ エージェント強化',
    tabDaily: '📅 デイリー',
    tabRank: '🏆 ランキング',
    modeStandard: '🚁 10ウェーブ脱出',
    modeEndless: '♾️ エンドレス',
    deployStandard: '▶ 出撃 (10W脱出)',
    deployEndless: '▶ エンドレス出撃',
    stageCleared: '✅ クリア済',
    upgMaxed: '最大',
    upgBuy: '強化する',
    createRoomBtn: '➕ ルーム作成 (1〜4人)',
    joinRoomBtn: '🚀 コードで参加',
    copyCodeBtn: '📋 コードをコピー',
    copyLinkBtn: '🔗 招待リンクをコピー',
    leaveRoomBtn: '🚪 退出',
    shopBtn: 'ショップ',
    quickAmmoBtn: '弾薬補充 ${cost}',
    quickAmmoReequipBtn: '補充＆再装備 ${cost}',
    bannerOutOfAmmo: '⚠️ 【{name}】弾切れ！ハンドガンに切替 — 右上【補充 ${cost}】で即再装備',
    ftOutOfAmmo: '⚠️ 【{name}】弾切れ！ハンドガンに切替',
    ftQuickRefilled: '📦 【{name}】弾薬満タン！',
    reloadingShort: '装填中',
    waveEvac: 'ヘリ搭乗 {pct}%',
    waveBreak: '準備時間 {s}秒',
    waveStd: 'Wave {w}/{m} · 残り {n}',
    waveEndl: '無限 W{w} · 残り {n}',
    pauseTitle: '⏸ ポーズ',
    resumeBtn: '▶ 戦闘再開',
    langBtn: '🌐 言語: {lang}',
    quitHubBtn: '🏠 ロビーへ戻る',
    armoryTitle: '🛒 武器庫',
    tabGuns: '🔫 銃器',
    tabSupplies: '🧰 補給・支援',
    buyBtn: '${cost} 購入',
    equipNow: '装備する',
    equippedTag: '装備中',
    victoryTitle: '🚁 脱出成功！',
    settleTitle: '🎖️ 作戦結果',
    multClaimBtn: '🎬 倍率受取',
    normalClaimBtn: '報酬受取',
  },
};

const WEAPON_EN: Record<string, { name: string; superName: string; desc: string }> = {
  pistol: { name: 'USP Tactical', superName: 'Akimbo Gold Deagles', desc: 'Infinite reserve sidearm' },
  revolver: { name: 'Python .357', superName: 'Crimson Dual Magnums', desc: 'High-impact piercing revolver' },
  smg: { name: 'MP5 Tactical SMG', superName: 'Dual Volt Storm', desc: 'Fast-firing mobile submachine gun' },
  shotgun: { name: 'M870 Breacher', superName: 'Dragonbreath Buckshot', desc: '6-pellet spread with heavy knockback' },
  rifle: { name: 'AK-47 Assault Rifle', superName: 'Crimson Sunpiercer', desc: 'Piercing full-auto combat rifle' },
  autoshotgun: { name: 'AA-12 Auto Shotgun', superName: 'Doomsday Shredder', desc: '20-round drum full-auto shotgun' },
  flamethrower: { name: 'Hellfire Thrower', superName: 'Blue Plasma Dragon', desc: 'Continuous piercing flame stream' },
  crossbow: { name: 'Blast Crossbow', superName: 'Thunderbolt Repeater', desc: 'High-velocity explosive bolts' },
  sniper: { name: 'Barrett .50 Cal', superName: 'Thor Railgun Sniper', desc: 'Pierces 5 zombies — Boss killer' },
  cryogun: { name: 'Cryo Nitrogen Gun', superName: 'Absolute Zero Cannon', desc: 'Freezing mist slows entire hordes' },
  launcher: { name: 'M32 Grenade Launcher', superName: 'Hellstorm Bomber', desc: '6-shot rotary explosive launcher' },
  sawlauncher: { name: 'Ripper Saw Launcher', superName: 'Bloodmoon Ricochet', desc: 'Bouncing tungsten sawblades' },
  minigun: { name: 'Vulcan Minigun', superName: 'Volcano Gattling', desc: '90-round rotary bullet storm' },
  tesla: { name: 'Tesla Arc Cannon', superName: 'Zeus Thunderstorm', desc: 'Chain lightning ball shocks crowds' },
  plasma: { name: 'Plasma Railgun', superName: 'Supernova Beam Cannon', desc: 'Ultimate hyper-piercing plasma beam' },
};

const STAGE_EN: Record<
  string,
  { name: string; sub: string; sector: string; diff: string; tags: [string, string, string] }
> = {
  stage_police: {
    name: 'Stage 1 · Metro Police HQ',
    sub: '6-sector precinct: hold interrogation corridors, rescue the Cyber Hound, and breach the SWAT vault!',
    sector: 'SECTOR 01 · PRECINCT',
    diff: '★☆☆☆☆ Recommended',
    tags: ['6 Sectors', 'Cyber Hound', 'SWAT Vault'],
  },
  stage_mall: {
    name: 'Stage 2 · Starlight Neon Mall',
    sub: 'Kite hordes around the fountain atrium, explore the retro arcade, and spin the lucky vending machine!',
    sector: 'SECTOR 02 · NEON MALL',
    diff: '★★☆☆☆ Urban Outbreak',
    tags: ['5 Sectors', 'Lucky Vending', 'Arcade Cover'],
  },
  stage_lab: {
    name: 'Stage 3 · Abyss Bio-Lab 73',
    sub: 'Twin-wing containment loop — fire up reactor laser towers to vaporize the Abyss King!',
    sector: 'SECTOR 03 · BIO-LAB',
    diff: '★★★☆☆ Classified',
    tags: ['Twin Corridors', 'Laser Matrix', 'Cryo Pods'],
  },
  stage_hospital: {
    name: 'Stage 4 · St. Mary Quarantine',
    sub: 'Fight through triage halls, isolated ICU wards, and sterile surgery corridors to reach evac!',
    sector: 'SECTOR 04 · HOSPITAL',
    diff: '★★★☆☆ Biohazard',
    tags: ['6 Sectors', 'ICU Wards', 'Purge Lasers'],
  },
  stage_harbor: {
    name: 'Stage 5 · Rustport Container Dock',
    sub: 'Navigate shipping container alleys and detonate fuel barrels across the cargo pier!',
    sector: 'SECTOR 05 · CARGO PORT',
    diff: '★★★★☆ Labyrinth',
    tags: ['Container Maze', 'Forklift Cover', 'Fuel Barrels'],
  },
  stage_subway: {
    name: 'Stage 6 · Doomsday Metro Hub',
    sub: 'Set up crossfire around derailed subway cars and defend the twin-track underground platform!',
    sector: 'SECTOR 06 · METRO HUB',
    diff: '★★★★☆ Underground',
    tags: ['Twin Tracks', 'Subway Cars', 'Arc Tower'],
  },
  stage_airbase: {
    name: 'Stage 7 · Area 66 Airbase',
    sub: 'Fortify heavy transport hangars and radar command with dual sentry laser matrices!',
    sector: 'SECTOR 07 · AIRBASE',
    diff: '★★★★★ Fortified',
    tags: ['Heavy Hangar', 'Dual Lasers', 'Ordnance Bay'],
  },
  stage_bunker: {
    name: 'Stage 8 · Nuclear Bunker Zero',
    sub: 'Endgame warzone! Defend twin ICBM missile silos and fusion core against the ultimate horde!',
    sector: 'SECTOR 08 · NUKE BUNKER',
    diff: '★★★★★ Endgame',
    tags: ['Twin ICBM Silos', 'War Room', 'Final Showdown'],
  },
};

const ROOM_EN: Record<string, string> = {
  lobby: 'Main Lobby',
  detective: 'Detective Wing',
  corridor: 'Interrogation Hall',
  cells: 'Holding Cells',
  vault: 'SWAT Vault',
  courtyard: 'Evac Helipad',
  diner: 'Neon Diner',
  arcade: 'Starlight Arcade',
  cargo: 'Cargo Bay',
  west_wing: 'West Cryo Lab',
  east_wing: 'East Reactor',
  icu: 'Isolation ICU',
  pharmacy: 'Bio-Pharmacy',
  surgery: 'Surgery Corridor',
  morgue: 'Sub-Level Morgue',
  customs: 'Customs Warehouse',
  containers: 'Container Maze',
  workshop: 'Engine Dockyard',
  cold_storage: 'Deep Cold Storage',
  concourse: 'Metro Concourse',
  power_room: 'Traction Substation',
  platform: 'Twin-Track Platform',
  maint: 'Track Armory',
  hangar_w: 'Transport Hangar 1',
  radar: 'Radar Command',
  fuel_bay: 'Fuel Nexus',
  ordnance: 'Ordnance Depot',
  silo_w: 'ICBM Silo Alpha',
  silo_e: 'ICBM Silo Bravo',
  reactor: 'Fusion Cooling Core',
  armory_s: 'Prototype Weapons Lab',
};

const PERK_EN: Record<string, { name: string; desc: string }> = {
  hollow_point: { name: 'Magnum Load', desc: 'All weapon damage +18%' },
  sleight_hand: { name: 'Fast Mag', desc: 'Reload time -22%, magazine size +20%' },
  ap_rounds: { name: 'Tungsten AP', desc: 'Bullet pierce +1 across all weapons' },
  split_chamber: { name: 'Split Chamber', desc: '35% chance to fire +1 extra projectile' },
  crit_hunter: { name: 'Deadeye', desc: 'Crit chance +15% (200% crit damage)' },
  sprinter: { name: 'Tactical Boots', desc: 'Move speed +15%' },
  combat_medic: { name: 'Blood Siphon', desc: 'Heal 8% Max HP every 10 zombie kills (stackable)' },
  bounty_badge: { name: 'Bounty Tag', desc: 'Zombie cash drops +22%' },
  ammo_scavenger: { name: 'Ammo Scavenger', desc: '36% chance on kill to refill rounds directly into magazine' },
  cryo_coating: { name: 'Cryo Rounds', desc: '28% chance to fire freezing cryo bullets that slow hordes' },
  arc_overload: { name: 'Arc Overload', desc: '24% chance to trigger chain lightning across nearby zombies' },
  berserk_blood: { name: 'Berserker Fury', desc: 'Fire rate +14%, plus +30% extra DMG when HP is below 55%' },
};

const RELIC_EN: Record<string, { name: string; desc: string }> = {
  rubber_bullets: { name: 'Ricochet Core', desc: 'Bullets bounce off walls once with +25% DMG' },
  explosive_planks: { name: 'Reactive Planks', desc: 'Breaking the last window plank blasts & stuns zombies' },
  piggy_bank: { name: 'War Bond Briefcase', desc: 'Earn 10% interest on unspent cash each wave (up to $180)' },
  static_boots: { name: 'Tesla Stride Boots', desc: 'Sprinting builds charge and zaps nearby zombies' },
  vamp_fangs: { name: 'Nano Adrenaline', desc: 'Every 18 kills restores 8% Max HP' },
  dragon_oil: { name: 'Thermite Coating', desc: 'Bullets ignite enemies for 3s burn damage' },
  chain_blast: { name: 'Cluster Shrapnel', desc: '20% chance for slain zombies to detonate' },
};

const POWERUP_EN: Record<PowerUpType, { name: string }> = {
  overdrive: { name: 'Overdrive' },
  nuke: { name: 'Tactical Nuke' },
  carpenter: { name: 'Max Barricade' },
  double_cash: { name: '2x Cash' },
  freeze: { name: 'Cryo Freeze' },
};

const UPGRADE_EN: Record<keyof AgentUpgradeLevels, { name: string; desc: string; val: (lvl: number) => string }> = {
  hp: { name: 'Juggernaut Vitality', desc: 'Permanently boosts Max HP', val: (l) => `${100 + l * 18} HP` },
  reload: { name: 'Speed Reloader', desc: 'Permanently speeds up reloading', val: (l) => `+${l * 6}% Speed` },
  speed: { name: 'Combat Mobility', desc: 'Permanently increases movement speed', val: (l) => `+${l * 3.5}% Move` },
  repair: { name: 'Fortify Master', desc: 'Faster plank repairs & higher plank cap', val: (l) => `+${l * 12}% Build` },
  startCash: { name: 'Starting War Chest', desc: 'Begin every match with extra cash', val: (l) => `$${80 + l * 45}` },
  crit: { name: 'Lethal Precision', desc: 'Boosts base Crit Chance & Crit Damage', val: (l) => `+${(l * 2.5).toFixed(1)}% Crit` },
  armor: { name: 'Composite Kevlar', desc: 'Start with Armor & regen Armor every wave', val: (l) => `Start +${l * 10} Armor` },
  magnet: { name: 'Loot Magnet', desc: 'Wider Cash/XP pickup radius & bonus cash', val: (l) => `+${l * 18}% Range` },
  ammo: { name: 'Ammo Logistics', desc: 'Higher max reserve ammo & cheaper refills', val: (l) => `+${l * 8}% Reserve` },
  ordnance: { name: 'Heavy Ordnance', desc: 'Higher grenade DMG & extra grenade supply', val: (l) => `+${l * 12}% Blast` },
};

class LocalizationService {
  public lang: LangCode = 'en';

  public init(savedGetter?: (k: string) => string | null): void {
    let picked: LangCode | null = null;
    try {
      const saved = (savedGetter ? savedGetter(LANG_STORAGE_KEY) : localStorage.getItem(LANG_STORAGE_KEY)) as LangCode | null;
      if (saved && UI_TEXT[saved]) {
        picked = saved;
      }
    } catch {
      // ignore
    }

    if (!picked) {
      const navLangs =
        typeof navigator !== 'undefined'
          ? navigator.languages && navigator.languages.length > 0
            ? navigator.languages
            : [navigator.language || 'en']
          : ['en'];

      for (const raw of navLangs) {
        const low = (raw || '').toLowerCase();
        if (low.startsWith('zh')) {
          picked = 'zh';
          break;
        }
        if (low.startsWith('es')) {
          picked = 'es';
          break;
        }
        if (low.startsWith('pt')) {
          picked = 'pt';
          break;
        }
        if (low.startsWith('ru') || low.startsWith('uk') || low.startsWith('kk') || low.startsWith('be')) {
          picked = 'ru';
          break;
        }
        if (low.startsWith('ja')) {
          picked = 'ja';
          break;
        }
        if (low.startsWith('en')) {
          picked = 'en';
          break;
        }
      }
    }

    this.lang = picked || 'en';
    this.syncStaticDOM();
  }

  public setLang(next: LangCode, savedSetter?: (k: string, v: string) => void): void {
    if (!UI_TEXT[next]) return;
    this.lang = next;
    try {
      if (savedSetter) savedSetter(LANG_STORAGE_KEY, next);
      else localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      // ignore
    }
    this.syncStaticDOM();
  }

  public cycleLang(savedSetter?: (k: string, v: string) => void): LangCode {
    const idx = LANG_OPTIONS.findIndex((o) => o.code === this.lang);
    const next = LANG_OPTIONS[(idx + 1) % LANG_OPTIONS.length].code;
    this.setLang(next, savedSetter);
    return next;
  }

  public getLangLabel(): string {
    return LANG_OPTIONS.find((o) => o.code === this.lang)?.label || 'English';
  }

  public getLangShort(): string {
    return LANG_OPTIONS.find((o) => o.code === this.lang)?.short || 'EN';
  }

  public isZh(): boolean {
    return this.lang === 'zh';
  }

  public syncStaticDOM(): void {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = this.lang === 'zh' ? 'zh-CN' : this.lang;
    document.title = this.isZh() ? '僵尸防线大作战 | Zombie Room Defense' : 'Zombie Room Defense';

    const guard = document.getElementById('landscape-guard');
    if (guard) {
      const h2 = guard.querySelector('h2');
      const p = guard.querySelector('p');
      const btn = guard.querySelector('#btn-guard-landscape');
      if (h2) h2.textContent = this.t('rotateTitle');
      if (p) p.textContent = this.t('rotateDesc');
      if (btn) btn.textContent = this.t('rotateBtn');
    }
  }

  public t(key: string, vars?: Record<string, string | number>): string {
    const table = UI_TEXT[this.lang] || UI_TEXT.en;
    let raw = table[key] ?? UI_TEXT.en[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        raw = raw.replaceAll(`{${k}}`, String(v));
      }
    }
    return raw;
  }

  public wName(id: string, fallback: string): string {
    if (this.isZh()) return fallback;
    return WEAPON_EN[id]?.name || fallback;
  }

  public wSuperName(id: string, fallback: string): string {
    if (this.isZh()) return fallback;
    return WEAPON_EN[id]?.superName || fallback;
  }

  public stageMeta(
    stageId: string,
    zhFallback: { name: string; subtitle: string; sector: string; diffLabel: string; tags: string[] }
  ) {
    if (this.isZh()) return zhFallback;
    const en = STAGE_EN[stageId];
    if (!en) return zhFallback;
    return {
      name: en.name,
      subtitle: en.sub,
      sector: en.sector,
      diffLabel: en.diff,
      tags: en.tags,
    };
  }

  public roomOrDoorName(roomId: string, fallback: string): string {
    if (this.isZh()) return fallback;
    return ROOM_EN[roomId] || fallback;
  }

  public stationLabel(type: StationType, fallback: string): string {
    if (this.isZh()) return fallback;
    switch (type) {
      case 'armory_kiosk':
        return 'Armory [B]';
      case 'starter_airdrop':
        return 'Super Drop';
      case 'ammo_box':
        return 'Ammo Crate';
      case 'pack_a_punch':
        return 'Weapon Evo';
      case 'mech_dog_cage':
        return 'Cyber Hound';
      case 'vending_machine':
        return 'Supply Vend';
      case 'laser_trap':
        return 'Laser Tower';
      default:
        return fallback;
    }
  }

  public perkMeta(id: string, zhName: string, zhDesc: string): { name: string; desc: string } {
    if (this.isZh()) return { name: zhName, desc: zhDesc };
    return PERK_EN[id] || { name: zhName, desc: zhDesc };
  }

  public relicMeta(id: string, zhName: string, zhDesc: string): { name: string; desc: string } {
    if (this.isZh()) return { name: zhName, desc: zhDesc };
    return RELIC_EN[id] || { name: zhName, desc: zhDesc };
  }

  public powerupName(id: PowerUpType, zhName: string): string {
    if (this.isZh()) return zhName;
    return POWERUP_EN[id]?.name || zhName;
  }

  public upgradeMeta(
    key: keyof AgentUpgradeLevels,
    lvl: number,
    zhFallback: { name: string; desc: string; val: string }
  ): { name: string; desc: string; val: string } {
    if (this.isZh()) return zhFallback;
    const en = UPGRADE_EN[key];
    if (!en) return zhFallback;
    return { name: en.name, desc: en.desc, val: en.val(lvl) };
  }

  public slotLabel(slot: number): string {
    return this.t(`slot${slot}`);
  }
}

export const I18n = new LocalizationService();
