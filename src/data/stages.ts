import {
  DoorConfig,
  FloorTheme,
  InteriorPropConfig,
  Rect,
  RoomConfig,
  StageDef,
  StationConfig,
  WindowConfig,
} from '../types';

const G = 56; // 56px 宽敞战术建筑网格（室内面积扩大近 2 倍，尽情走位拉扯！）
const WALL_T = 28;
const HALF_T = WALL_T / 2;

interface GridBox {
  gx: number;
  gy: number;
  gw: number;
  gh: number;
}

interface BlueprintRoom {
  id: string;
  name: string;
  floorTheme: FloorTheme;
  boxes: GridBox[];
  initiallyUnlocked: boolean;
}

interface BlueprintDoor {
  id: string;
  orientation: 'horizontal' | 'vertical';
  gx: number;
  gy: number;
  span: number; // grid cells (typically 3 = 120px wide doorway)
  roomA: string;
  roomB: string;
  unlockRoomId: string;
  cost: number;
  label: string;
}

interface BlueprintWindow {
  id: string;
  roomId: string;
  orientation: 'horizontal' | 'vertical';
  gx: number;
  gy: number;
  span: number; // typically 3 = 120px window
  outDir: 'N' | 'S' | 'W' | 'E';
}

function buildArchitecturalStage(opts: {
  id: string;
  index: number;
  name: string;
  subtitle: string;
  wallColor: string;
  wallTopColor: string;
  cols: number;
  rows: number;
  playerSpawnCell: { gx: number; gy: number };
  helipadCell: { gx: number; gy: number };
  rooms: BlueprintRoom[];
  doors: BlueprintDoor[];
  windows: BlueprintWindow[];
  props: InteriorPropConfig[];
  stations: StationConfig[];
  barrels: { x: number; y: number; roomId: string }[];
}): StageDef {
  const { cols, rows } = opts;
  const grid: (string | null)[][] = Array.from({ length: rows }, () => Array(cols).fill(null));

  let minGX = cols;
  let minGY = rows;
  let maxGX = 0;
  let maxGY = 0;

  for (const br of opts.rooms) {
    for (const b of br.boxes) {
      for (let y = b.gy; y < b.gy + b.gh; y++) {
        for (let x = b.gx; x < b.gx + b.gw; x++) {
          if (y >= 0 && y < rows && x >= 0 && x < cols) {
            grid[y][x] = br.id;
          }
        }
      }
      minGX = Math.min(minGX, b.gx);
      minGY = Math.min(minGY, b.gy);
      maxGX = Math.max(maxGX, b.gx + b.gw);
      maxGY = Math.max(maxGY, b.gy + b.gh);
    }
  }

  // 直接从最终网格提取合并矩形，确保房间地板与墙体100%严丝合缝、绝不重叠！
  const builtRooms: RoomConfig[] = opts.rooms.map((br) => {
    const rowRuns: { gx: number; gy: number; gw: number; gh: number }[] = [];
    for (let gy = 0; gy < rows; gy++) {
      let sx = -1;
      for (let gx = 0; gx <= cols; gx++) {
        const match = gx < cols && grid[gy][gx] === br.id;
        if (match) {
          if (sx < 0) sx = gx;
        } else if (sx >= 0) {
          const gw = gx - sx;
          const prev = rowRuns.find(
            (r) => r.gx === sx && r.gw === gw && r.gy + r.gh === gy
          );
          if (prev) {
            prev.gh += 1;
          } else {
            rowRuns.push({ gx: sx, gy, gw, gh: 1 });
          }
          sx = -1;
        }
      }
    }
    const rects: Rect[] = rowRuns.map((r) => ({
      x: r.gx * G,
      y: r.gy * G,
      w: r.gw * G,
      h: r.gh * G,
    }));
    const main = rowRuns[0] || br.boxes[0];
    return {
      id: br.id,
      name: br.name,
      floorTheme: br.floorTheme,
      rects,
      labelPos: { x: (main.gx + main.gw / 2) * G, y: (main.gy + main.gh / 2) * G },
      initiallyUnlocked: br.initiallyUnlocked,
    };
  });

  // 记录门和窗占据的网格边，自动从墙体中留出精准开口
  const hOpenings = new Set<string>();
  const vOpenings = new Set<string>();

  const builtDoors: DoorConfig[] = opts.doors.map((d) => {
    if (d.orientation === 'horizontal') {
      for (let i = 0; i < d.span; i++) hOpenings.add(`${d.gx + i},${d.gy}`);
      return {
        id: d.id,
        x: d.gx * G,
        y: d.gy * G - HALF_T,
        w: d.span * G,
        h: WALL_T,
        orientation: 'horizontal',
        roomA: d.roomA,
        roomB: d.roomB,
        unlockRoomId: d.unlockRoomId,
        cost: d.cost,
        label: d.label,
      };
    } else {
      for (let i = 0; i < d.span; i++) vOpenings.add(`${d.gx},${d.gy + i}`);
      return {
        id: d.id,
        x: d.gx * G - HALF_T,
        y: d.gy * G,
        w: WALL_T,
        h: d.span * G,
        orientation: 'vertical',
        roomA: d.roomA,
        roomB: d.roomB,
        unlockRoomId: d.unlockRoomId,
        cost: d.cost,
        label: d.label,
      };
    }
  });

  const builtWindows: WindowConfig[] = opts.windows.map((w) => {
    const off =
      w.outDir === 'N'
        ? { dx: 0, dy: -118 }
        : w.outDir === 'S'
          ? { dx: 0, dy: 118 }
          : w.outDir === 'W'
            ? { dx: -118, dy: 0 }
            : { dx: 118, dy: 0 };

    if (w.orientation === 'horizontal') {
      for (let i = 0; i < w.span; i++) hOpenings.add(`${w.gx + i},${w.gy}`);
      return {
        id: w.id,
        roomId: w.roomId,
        x: w.gx * G,
        y: w.gy * G - HALF_T,
        w: w.span * G,
        h: WALL_T,
        orientation: 'horizontal',
        spawnOutsideOffset: off,
      };
    } else {
      for (let i = 0; i < w.span; i++) vOpenings.add(`${w.gx},${w.gy + i}`);
      return {
        id: w.id,
        roomId: w.roomId,
        x: w.gx * G - HALF_T,
        y: w.gy * G,
        w: WALL_T,
        h: w.span * G,
        orientation: 'vertical',
        spawnOutsideOffset: off,
      };
    }
  });

  // 自动扫描并合并所有水平与垂直墙段（支持任意不规则多边形房间架构！）
  const walls: Rect[] = [];

  for (let gy = 0; gy <= rows; gy++) {
    let runStart = -1;
    for (let gx = 0; gx <= cols; gx++) {
      const topId = gy > 0 && gx < cols ? grid[gy - 1][gx] : null;
      const botId = gy < rows && gx < cols ? grid[gy][gx] : null;
      const needWall = gx < cols && topId !== botId && !hOpenings.has(`${gx},${gy}`);
      if (needWall) {
        if (runStart < 0) runStart = gx;
      } else if (runStart >= 0) {
        walls.push({
          x: runStart * G - HALF_T,
          y: gy * G - HALF_T,
          w: (gx - runStart) * G + WALL_T,
          h: WALL_T,
        });
        runStart = -1;
      }
    }
  }

  for (let gx = 0; gx <= cols; gx++) {
    let runStart = -1;
    for (let gy = 0; gy <= rows; gy++) {
      const leftId = gx > 0 && gy < rows ? grid[gy][gx - 1] : null;
      const rightId = gx < cols && gy < rows ? grid[gy][gx] : null;
      const needWall = gy < rows && leftId !== rightId && !vOpenings.has(`${gx},${gy}`);
      if (needWall) {
        if (runStart < 0) runStart = gy;
      } else if (runStart >= 0) {
        walls.push({
          x: gx * G - HALF_T,
          y: runStart * G - HALF_T,
          w: WALL_T,
          h: (gy - runStart) * G + WALL_T,
        });
        runStart = -1;
      }
    }
  }

  return {
    id: opts.id,
    index: opts.index,
    name: opts.name,
    subtitle: opts.subtitle,
    wallColor: opts.wallColor,
    wallTopColor: opts.wallTopColor,
    gridCols: cols,
    gridRows: rows,
    cellSize: G,
    worldWidth: cols * G,
    worldHeight: rows * G,
    buildingBounds: {
      x: (minGX - 1) * G,
      y: (minGY - 1) * G,
      w: (maxGX - minGX + 2) * G,
      h: (maxGY - minGY + 2) * G,
    },
    playerSpawn: { x: opts.playerSpawnCell.gx * G, y: opts.playerSpawnCell.gy * G },
    helipadPos: { x: opts.helipadCell.gx * G, y: opts.helipadCell.gy * G },
    rooms: builtRooms,
    walls,
    doors: builtDoors,
    windows: builtWindows,
    props: opts.props,
    stations: opts.stations,
    barrels: opts.barrels,
  };
}

// ============================================================================
// 第 1 关：洛城警署总部（T型接待大厅 + L型重案组 + 狭长审讯走廊 + 牢房 + 特警金库 + 装甲停机坪）
// ============================================================================
const stagePolice = buildArchitecturalStage({
  id: 'stage_police',
  index: 1,
  name: '第 1 关 · 洛城警署总部',
  subtitle: '不规则 6 区战术警署：守住狭长审讯走廊、解救羁押警犬、开启重装金库！',
  wallColor: '#1e293b',
  wallTopColor: '#475569',
  cols: 56,
  rows: 40,
  playerSpawnCell: { gx: 21, gy: 18 },
  helipadCell: { gx: 39, gy: 27 },
  rooms: [
    {
      id: 'lobby',
      name: '报案接待大厅',
      floorTheme: 'lobby',
      boxes: [
        { gx: 14, gy: 14, gw: 14, gh: 9 },
        { gx: 18, gy: 23, gw: 6, gh: 5 }, // 南侧凸出玄关，形成 T 字大厅
      ],
      initiallyUnlocked: true,
    },
    {
      id: 'detective',
      name: '重案组办公翼',
      floorTheme: 'armory',
      boxes: [
        { gx: 8, gy: 6, gw: 14, gh: 8 },
        { gx: 8, gy: 14, gw: 6, gh: 9 }, // 包裹西北角的 L 型侧翼
      ],
      initiallyUnlocked: false,
    },
    {
      id: 'corridor',
      name: '审讯狭长走廊',
      floorTheme: 'armory',
      boxes: [{ gx: 28, gy: 16, gw: 12, gh: 5 }],
      initiallyUnlocked: false,
    },
    {
      id: 'cells',
      name: '拘留羁押室',
      floorTheme: 'lab',
      boxes: [{ gx: 34, gy: 7, gw: 12, gh: 9 }],
      initiallyUnlocked: false,
    },
    {
      id: 'vault',
      name: '特警重装金库',
      floorTheme: 'lab',
      boxes: [{ gx: 9, gy: 23, gw: 9, gh: 7 }],
      initiallyUnlocked: false,
    },
    {
      id: 'courtyard',
      name: '后院装甲停机坪',
      floorTheme: 'asphalt',
      boxes: [
        { gx: 28, gy: 21, gw: 18, gh: 12 },
        { gx: 24, gy: 24, gw: 4, gh: 6 }, // 与南侧玄关连通的L折角庭院
      ],
      initiallyUnlocked: false,
    },
  ],
  doors: [
    { id: 'd_det', orientation: 'horizontal', gx: 17, gy: 14, span: 3, roomA: 'lobby', roomB: 'detective', unlockRoomId: 'detective', cost: 420, label: '重案组办公翼' },
    { id: 'd_cor', orientation: 'vertical', gx: 28, gy: 17, span: 3, roomA: 'lobby', roomB: 'corridor', unlockRoomId: 'corridor', cost: 480, label: '审讯走廊' },
    { id: 'd_cel', orientation: 'horizontal', gx: 36, gy: 16, span: 3, roomA: 'corridor', roomB: 'cells', unlockRoomId: 'cells', cost: 820, label: '拘留羁押室' },
    { id: 'd_vau1', orientation: 'vertical', gx: 18, gy: 24, span: 3, roomA: 'lobby', roomB: 'vault', unlockRoomId: 'vault', cost: 1050, label: '特警重装金库' },
    { id: 'd_vau2', orientation: 'horizontal', gx: 10, gy: 23, span: 3, roomA: 'detective', roomB: 'vault', unlockRoomId: 'vault', cost: 1050, label: '特警重装金库' },
    { id: 'd_yrd1', orientation: 'vertical', gx: 24, gy: 25, span: 3, roomA: 'lobby', roomB: 'courtyard', unlockRoomId: 'courtyard', cost: 1600, label: '装甲停机坪' },
    { id: 'd_yrd2', orientation: 'horizontal', gx: 31, gy: 21, span: 3, roomA: 'corridor', roomB: 'courtyard', unlockRoomId: 'courtyard', cost: 1600, label: '装甲停机坪' },
  ],
  windows: [
    { id: 'p_w1', roomId: 'lobby', orientation: 'vertical', gx: 14, gy: 16, span: 3, outDir: 'W' },
    { id: 'p_w2', roomId: 'lobby', orientation: 'horizontal', gx: 19, gy: 28, span: 3, outDir: 'S' },
    { id: 'p_w3', roomId: 'detective', orientation: 'horizontal', gx: 13, gy: 6, span: 3, outDir: 'N' },
    { id: 'p_w4', roomId: 'detective', orientation: 'vertical', gx: 8, gy: 15, span: 3, outDir: 'W' },
    { id: 'p_w5', roomId: 'corridor', orientation: 'horizontal', gx: 31, gy: 16, span: 3, outDir: 'N' },
    { id: 'p_w6', roomId: 'cells', orientation: 'horizontal', gx: 39, gy: 7, span: 3, outDir: 'N' },
    { id: 'p_w7', roomId: 'cells', orientation: 'vertical', gx: 46, gy: 10, span: 3, outDir: 'E' },
    { id: 'p_w8', roomId: 'vault', orientation: 'vertical', gx: 9, gy: 25, span: 3, outDir: 'W' },
    { id: 'p_w9', roomId: 'vault', orientation: 'horizontal', gx: 12, gy: 30, span: 3, outDir: 'S' },
    { id: 'p_w10', roomId: 'courtyard', orientation: 'vertical', gx: 46, gy: 25, span: 3, outDir: 'E' },
    { id: 'p_w11', roomId: 'courtyard', orientation: 'horizontal', gx: 35, gy: 33, span: 3, outDir: 'S' },
  ],
  props: [
    { id: 'pr_1', roomId: 'lobby', kind: 'desk', x: 16.5 * G, y: 15.8 * G, w: 80, h: 50, blocksBullets: false },
    { id: 'pr_2', roomId: 'detective', kind: 'desk', x: 14 * G, y: 8.2 * G, w: 80, h: 50, rotation: 0.18, blocksBullets: false },
    { id: 'pr_3', roomId: 'detective', kind: 'crates', x: 10 * G, y: 8.5 * G, w: 66, h: 66, blocksBullets: true },
    { id: 'pr_4', roomId: 'cells', kind: 'crates', x: 43.2 * G, y: 13.8 * G, w: 66, h: 66, blocksBullets: true },
    { id: 'pr_5', roomId: 'vault', kind: 'crates', x: 15.2 * G, y: 28 * G, w: 68, h: 68, blocksBullets: true },
    { id: 'pr_6', roomId: 'courtyard', kind: 'swat_van', x: 33 * G, y: 29.2 * G, w: 152, h: 84, rotation: -0.18, blocksBullets: true },
  ],
  stations: [
    { id: 'st_shop1', roomId: 'lobby', type: 'armory_kiosk', x: 26.2 * G, y: 15.4 * G, cost: 0, label: '军火终端 [B]' },
    { id: 'st_air1', roomId: 'lobby', type: 'starter_airdrop', x: 15.8 * G, y: 21.4 * G, cost: 0, weaponId: 'plasma', label: '超武空投' },
    { id: 'st_ammo1', roomId: 'detective', type: 'ammo_box', x: 20.2 * G, y: 8 * G, cost: 180, label: '弹药箱' },
    { id: 'st_dog1', roomId: 'cells', type: 'mech_dog_cage', x: 36.5 * G, y: 9.2 * G, cost: 460, label: '解救警犬' },
    { id: 'st_pap1', roomId: 'vault', type: 'pack_a_punch', x: 11.5 * G, y: 25.2 * G, cost: 1250, label: '超武改装台' },
    { id: 'st_shop2', roomId: 'courtyard', type: 'armory_kiosk', x: 30 * G, y: 23.2 * G, cost: 0, label: '军火终端 [B]' },
  ],
  barrels: [
    { x: 23 * G, y: 21 * G, roomId: 'lobby' },
    { x: 11.5 * G, y: 17 * G, roomId: 'detective' },
    { x: 34.5 * G, y: 18.5 * G, roomId: 'corridor' },
    { x: 43 * G, y: 10 * G, roomId: 'cells' },
    { x: 36.5 * G, y: 24.5 * G, roomId: 'courtyard' },
    { x: 43 * G, y: 30 * G, roomId: 'courtyard' },
  ],
});

// ============================================================================
// 第 2 关：星光霓虹商场（十字喷泉中庭 + 复古快餐长廊 + L型电玩城 + 曲折货栈 + 露台激光广场）
// ============================================================================
const stageMall = buildArchitecturalStage({
  id: 'stage_mall',
  index: 2,
  name: '第 2 关 · 星光霓虹商场',
  subtitle: '十字喷泉中庭拉扯尸群，探索复古街机厅与幸运贩卖机！',
  wallColor: '#312e81',
  wallTopColor: '#6366f1',
  cols: 58,
  rows: 42,
  playerSpawnCell: { gx: 25, gy: 21 },
  helipadCell: { gx: 40, gy: 31 },
  rooms: [
    {
      id: 'lobby',
      name: '十字喷泉中庭',
      floorTheme: 'mall',
      boxes: [
        { gx: 20, gy: 15, gw: 14, gh: 10 },
        { gx: 23, gy: 12, gw: 8, gh: 16 }, // 十字形开阔商场中心！
      ],
      initiallyUnlocked: true,
    },
    {
      id: 'diner',
      name: '霓虹快餐长廊',
      floorTheme: 'lobby',
      boxes: [{ gx: 11, gy: 13, gw: 9, gh: 15 }],
      initiallyUnlocked: false,
    },
    {
      id: 'arcade',
      name: '星际电玩城',
      floorTheme: 'lab',
      boxes: [
        { gx: 21, gy: 5, gw: 17, gh: 7 },
        { gx: 34, gy: 12, gw: 6, gh: 5 },
      ],
      initiallyUnlocked: false,
    },
    {
      id: 'cargo',
      name: '东侧卸货通道',
      floorTheme: 'armory',
      boxes: [{ gx: 34, gy: 17, gw: 13, gh: 7 }],
      initiallyUnlocked: false,
    },
    {
      id: 'courtyard',
      name: '星空露台广场',
      floorTheme: 'asphalt',
      boxes: [
        { gx: 25, gy: 28, gw: 21, gh: 9 },
        { gx: 36, gy: 24, gw: 10, gh: 4 },
      ],
      initiallyUnlocked: false,
    },
  ],
  doors: [
    { id: 'm_d1', orientation: 'vertical', gx: 20, gy: 18, span: 3, roomA: 'lobby', roomB: 'diner', unlockRoomId: 'diner', cost: 500, label: '霓虹快餐长廊' },
    { id: 'm_d2', orientation: 'horizontal', gx: 25, gy: 12, span: 3, roomA: 'lobby', roomB: 'arcade', unlockRoomId: 'arcade', cost: 900, label: '星际电玩城' },
    { id: 'm_d3', orientation: 'vertical', gx: 34, gy: 19, span: 3, roomA: 'lobby', roomB: 'cargo', unlockRoomId: 'cargo', cost: 850, label: '东侧卸货通道' },
    { id: 'm_d4', orientation: 'horizontal', gx: 26, gy: 28, span: 3, roomA: 'lobby', roomB: 'courtyard', unlockRoomId: 'courtyard', cost: 1700, label: '星空露台广场' },
    { id: 'm_d5', orientation: 'horizontal', gx: 38, gy: 24, span: 3, roomA: 'cargo', roomB: 'courtyard', unlockRoomId: 'courtyard', cost: 1700, label: '星空露台广场' },
  ],
  windows: [
    { id: 'mw1', roomId: 'lobby', orientation: 'vertical', gx: 23, gy: 12, span: 2, outDir: 'W' },
    { id: 'mw2', roomId: 'lobby', orientation: 'vertical', gx: 23, gy: 25, span: 2, outDir: 'W' },
    { id: 'mw3', roomId: 'diner', orientation: 'vertical', gx: 11, gy: 18, span: 3, outDir: 'W' },
    { id: 'mw4', roomId: 'diner', orientation: 'horizontal', gx: 14, gy: 28, span: 3, outDir: 'S' },
    { id: 'mw5', roomId: 'arcade', orientation: 'horizontal', gx: 27, gy: 5, span: 3, outDir: 'N' },
    { id: 'mw6', roomId: 'arcade', orientation: 'vertical', gx: 40, gy: 13, span: 3, outDir: 'E' },
    { id: 'mw7', roomId: 'cargo', orientation: 'vertical', gx: 47, gy: 19, span: 3, outDir: 'E' },
    { id: 'mw8', roomId: 'courtyard', orientation: 'horizontal', gx: 33, gy: 37, span: 3, outDir: 'S' },
    { id: 'mw9', roomId: 'courtyard', orientation: 'vertical', gx: 46, gy: 30, span: 3, outDir: 'E' },
  ],
  props: [
    { id: 'mp1', roomId: 'lobby', kind: 'fountain', x: 27 * G, y: 19.5 * G, w: 88, h: 88, blocksBullets: false },
    { id: 'mp2', roomId: 'diner', kind: 'desk', x: 15 * G, y: 16.5 * G, w: 82, h: 52, blocksBullets: false },
    { id: 'mp3', roomId: 'diner', kind: 'desk', x: 15 * G, y: 23.5 * G, w: 82, h: 52, blocksBullets: false },
    { id: 'mp4', roomId: 'cargo', kind: 'crates', x: 40 * G, y: 20.5 * G, w: 68, h: 68, blocksBullets: true },
    { id: 'mp5', roomId: 'courtyard', kind: 'fountain', x: 31 * G, y: 32.5 * G, w: 82, h: 82, blocksBullets: false },
  ],
  stations: [
    { id: 'ms_shop', roomId: 'lobby', type: 'armory_kiosk', x: 31.4 * G, y: 17 * G, cost: 0, label: '军火终端 [B]' },
    { id: 'ms_air', roomId: 'lobby', type: 'starter_airdrop', x: 22 * G, y: 22.5 * G, cost: 0, weaponId: 'launcher', label: '榴弹空投' },
    { id: 'ms_vend', roomId: 'diner', type: 'vending_machine', x: 14.5 * G, y: 20 * G, cost: 160, label: '幸运贩卖机' },
    { id: 'ms_dog', roomId: 'arcade', type: 'mech_dog_cage', x: 24 * G, y: 8.5 * G, cost: 460, label: '激活警犬' },
    { id: 'ms_pap', roomId: 'arcade', type: 'pack_a_punch', x: 34 * G, y: 8.5 * G, cost: 1250, label: '超武改装舱' },
    { id: 'ms_ammo', roomId: 'cargo', type: 'ammo_box', x: 43.5 * G, y: 19.5 * G, cost: 180, label: '弹药补给' },
    { id: 'ms_laser', roomId: 'courtyard', type: 'laser_trap', x: 34.5 * G, y: 30 * G, cost: 260, label: '旋转激光塔' },
  ],
  barrels: [
    { x: 29.5 * G, y: 23.5 * G, roomId: 'lobby' },
    { x: 17.5 * G, y: 25.5 * G, roomId: 'diner' },
    { x: 30 * G, y: 9.5 * G, roomId: 'arcade' },
    { x: 37.5 * G, y: 21.5 * G, roomId: 'cargo' },
    { x: 43 * G, y: 28 * G, roomId: 'courtyard' },
  ],
});

// ============================================================================
// 第 3 关：73号深渊研究所（双平行连廊回环 + 冷冻培养舱室 + 反应堆核心 + 地下升降坪）
// ============================================================================
const stageLab = buildArchitecturalStage({
  id: 'stage_lab',
  index: 3,
  name: '第 3 关 · 73号深渊研究所',
  subtitle: '双平行连廊战术回环地形，启动高能反应堆激光粉碎尸王！',
  wallColor: '#0f172a',
  wallTopColor: '#0284c7',
  cols: 58,
  rows: 42,
  playerSpawnCell: { gx: 28, gy: 11 },
  helipadCell: { gx: 28, gy: 32 },
  rooms: [
    {
      id: 'lobby',
      name: '无菌隔离气闸大厅',
      floorTheme: 'lab',
      boxes: [{ gx: 20, gy: 7, gw: 16, gh: 8 }],
      initiallyUnlocked: true,
    },
    {
      id: 'west_wing',
      name: '西翼冷冻培养室',
      floorTheme: 'armory',
      boxes: [
        { gx: 11, gy: 12, gw: 9, gh: 14 },
        { gx: 20, gy: 15, gw: 4, gh: 11 }, // 西侧连廊
      ],
      initiallyUnlocked: false,
    },
    {
      id: 'east_wing',
      name: '东翼高能反应堆',
      floorTheme: 'lab',
      boxes: [
        { gx: 36, gy: 12, gw: 10, gh: 14 },
        { gx: 32, gy: 15, gw: 4, gh: 11 }, // 东侧平行连廊（中间24..32留出中空天井！）
      ],
      initiallyUnlocked: false,
    },
    {
      id: 'courtyard',
      name: '南区地下升降平台',
      floorTheme: 'asphalt',
      boxes: [{ gx: 18, gy: 26, gw: 20, gh: 10 }],
      initiallyUnlocked: false,
    },
  ],
  doors: [
    { id: 'l_d1', orientation: 'horizontal', gx: 20, gy: 15, span: 3, roomA: 'lobby', roomB: 'west_wing', unlockRoomId: 'west_wing', cost: 580, label: '西翼冷冻培养室' },
    { id: 'l_d2', orientation: 'horizontal', gx: 33, gy: 15, span: 3, roomA: 'lobby', roomB: 'east_wing', unlockRoomId: 'east_wing', cost: 680, label: '东翼高能反应堆' },
    { id: 'l_d3', orientation: 'horizontal', gx: 20, gy: 26, span: 3, roomA: 'west_wing', roomB: 'courtyard', unlockRoomId: 'courtyard', cost: 1650, label: '地下升降平台' },
    { id: 'l_d4', orientation: 'horizontal', gx: 33, gy: 26, span: 3, roomA: 'east_wing', roomB: 'courtyard', unlockRoomId: 'courtyard', cost: 1650, label: '地下升降平台' },
  ],
  windows: [
    { id: 'lw1', roomId: 'lobby', orientation: 'horizontal', gx: 26, gy: 7, span: 3, outDir: 'N' },
    { id: 'lw2', roomId: 'lobby', orientation: 'vertical', gx: 36, gy: 9, span: 2, outDir: 'E' },
    { id: 'lw3', roomId: 'west_wing', orientation: 'vertical', gx: 11, gy: 17, span: 3, outDir: 'W' },
    { id: 'lw4', roomId: 'west_wing', orientation: 'horizontal', gx: 14, gy: 26, span: 3, outDir: 'S' },
    { id: 'lw5', roomId: 'east_wing', orientation: 'vertical', gx: 46, gy: 17, span: 3, outDir: 'E' },
    { id: 'lw6', roomId: 'east_wing', orientation: 'horizontal', gx: 40, gy: 26, span: 3, outDir: 'S' },
    { id: 'lw7', roomId: 'courtyard', orientation: 'horizontal', gx: 26, gy: 36, span: 4, outDir: 'S' },
    { id: 'lw8', roomId: 'courtyard', orientation: 'vertical', gx: 18, gy: 30, span: 3, outDir: 'W' },
  ],
  props: [
    { id: 'lp1', roomId: 'lobby', kind: 'desk', x: 25 * G, y: 11 * G, w: 82, h: 52, blocksBullets: false },
    { id: 'lp2', roomId: 'west_wing', kind: 'fountain', x: 15.5 * G, y: 16.5 * G, w: 82, h: 82, blocksBullets: false },
    { id: 'lp3', roomId: 'west_wing', kind: 'fountain', x: 15.5 * G, y: 22 * G, w: 82, h: 82, blocksBullets: false },
    { id: 'lp4', roomId: 'east_wing', kind: 'crates', x: 41 * G, y: 16 * G, w: 68, h: 68, blocksBullets: true },
    { id: 'lp5', roomId: 'courtyard', kind: 'swat_van', x: 22.5 * G, y: 31.5 * G, w: 148, h: 82, rotation: 0.15, blocksBullets: true },
  ],
  stations: [
    { id: 'ls_shop', roomId: 'lobby', type: 'armory_kiosk', x: 32.8 * G, y: 10.5 * G, cost: 0, label: '军火终端 [B]' },
    { id: 'ls_air', roomId: 'lobby', type: 'starter_airdrop', x: 22.2 * G, y: 10.5 * G, cost: 0, weaponId: 'minigun', label: '加特林空投' },
    { id: 'ls_dog', roomId: 'west_wing', type: 'mech_dog_cage', x: 15 * G, y: 13.5 * G, cost: 460, label: '释放机械犬' },
    { id: 'ls_ammo', roomId: 'west_wing', type: 'ammo_box', x: 19 * G, y: 23.5 * G, cost: 180, label: '弹药补给柜' },
    { id: 'ls_pap', roomId: 'east_wing', type: 'pack_a_punch', x: 41 * G, y: 22.5 * G, cost: 1250, label: '超武改造舱' },
    { id: 'ls_laser', roomId: 'east_wing', type: 'laser_trap', x: 39 * G, y: 19.5 * G, cost: 240, label: '激光矩阵' },
    { id: 'ls_shop2', roomId: 'courtyard', type: 'armory_kiosk', x: 34.5 * G, y: 30.5 * G, cost: 0, label: '军火终端 [B]' },
  ],
  barrels: [
    { x: 29 * G, y: 13.2 * G, roomId: 'lobby' },
    { x: 21.8 * G, y: 20.5 * G, roomId: 'west_wing' },
    { x: 34.2 * G, y: 20.5 * G, roomId: 'east_wing' },
    { x: 32 * G, y: 33 * G, roomId: 'courtyard' },
  ],
});

export const STAGES: StageDef[] = [stagePolice, stageMall, stageLab];
