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

  const buildingBounds: Rect = {
    x: (minGX - 1) * G,
    y: (minGY - 1) * G,
    w: (maxGX - minGX + 2) * G,
    h: (maxGY - minGY + 2) * G,
  };
  // 所有僵尸统一从建筑外围的地图最边缘荒野防线涌入（绝不在窗外凭空刷出，也绝不穿过任何其他房间！）
  const MAP_EDGE_SPAWN_PAD = 480;

  const builtWindows: WindowConfig[] = opts.windows.map((w) => {
    if (w.span < 3) {
      throw new Error(`[Stage ${opts.id}] Window ${w.id} span must be >= 3 so Bosses never jam`);
    }

    // 严格建筑几何校验：每扇窗户内侧必须属于本房间，且朝向户外方向直到地图最边缘的整条走廊（含两侧肩宽）必须 100% 是纯户外空地！
    if (w.orientation === 'horizontal') {
      const inGY = w.outDir === 'N' ? w.gy : w.gy - 1;
      for (let i = 0; i < w.span; i++) {
        if (grid[inGY]?.[w.gx + i] !== w.roomId) {
          throw new Error(`[Stage ${opts.id}] Window ${w.id} indoor side does not match room ${w.roomId}`);
        }
      }
      const startY = w.outDir === 'N' ? 0 : w.gy;
      const endY = w.outDir === 'N' ? w.gy - 1 : rows - 1;
      for (let gy = startY; gy <= endY; gy++) {
        for (let gx = Math.max(0, w.gx - 1); gx <= Math.min(cols - 1, w.gx + w.span); gx++) {
          if (grid[gy][gx] !== null) {
            throw new Error(
              `[Stage ${opts.id}] Window ${w.id} outdoor lane to map edge hits room "${grid[gy][gx]}" at (${gx},${gy})`
            );
          }
        }
      }

      for (let i = 0; i < w.span; i++) hOpenings.add(`${w.gx + i},${w.gy}`);
      const wx = w.gx * G;
      const wy = w.gy * G - HALF_T;
      const ww = w.span * G;
      const wh = WALL_T;
      const wcy = wy + wh / 2;
      const edgeY =
        w.outDir === 'N'
          ? buildingBounds.y - MAP_EDGE_SPAWN_PAD
          : buildingBounds.y + buildingBounds.h + MAP_EDGE_SPAWN_PAD;
      return {
        id: w.id,
        roomId: w.roomId,
        x: wx,
        y: wy,
        w: ww,
        h: wh,
        orientation: 'horizontal',
        spawnOutsideOffset: { dx: 0, dy: edgeY - wcy },
      };
    } else {
      const inGX = w.outDir === 'W' ? w.gx : w.gx - 1;
      for (let i = 0; i < w.span; i++) {
        if (grid[w.gy + i]?.[inGX] !== w.roomId) {
          throw new Error(`[Stage ${opts.id}] Window ${w.id} indoor side does not match room ${w.roomId}`);
        }
      }
      const startX = w.outDir === 'W' ? 0 : w.gx;
      const endX = w.outDir === 'W' ? w.gx - 1 : cols - 1;
      for (let gx = startX; gx <= endX; gx++) {
        for (let gy = Math.max(0, w.gy - 1); gy <= Math.min(rows - 1, w.gy + w.span); gy++) {
          if (grid[gy][gx] !== null) {
            throw new Error(
              `[Stage ${opts.id}] Window ${w.id} outdoor lane to map edge hits room "${grid[gy][gx]}" at (${gx},${gy})`
            );
          }
        }
      }

      for (let i = 0; i < w.span; i++) vOpenings.add(`${w.gx},${w.gy + i}`);
      const wx = w.gx * G - HALF_T;
      const wy = w.gy * G;
      const ww = WALL_T;
      const wh = w.span * G;
      const wcx = wx + ww / 2;
      const edgeX =
        w.outDir === 'W'
          ? buildingBounds.x - MAP_EDGE_SPAWN_PAD
          : buildingBounds.x + buildingBounds.w + MAP_EDGE_SPAWN_PAD;
      return {
        id: w.id,
        roomId: w.roomId,
        x: wx,
        y: wy,
        w: ww,
        h: wh,
        orientation: 'vertical',
        spawnOutsideOffset: { dx: edgeX - wcx, dy: 0 },
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
    buildingBounds,
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
// 全部 11 扇防线窗户 100% 朝向纯户外荒野边界，绝无任何内窗！
// ============================================================================
const stagePolice = buildArchitecturalStage({
  id: 'stage_police',
  index: 1,
  name: '第 1 关 · 洛城警署总部',
  subtitle: '不规则 6 区战术警署：守住狭长审讯走廊、解救羁押警犬、开启重装金库！',
  wallColor: '#172030',
  wallTopColor: '#3d4b5f',
  cols: 56,
  rows: 40,
  playerSpawnCell: { gx: 21, gy: 19 },
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
    { id: 'p_w1', roomId: 'lobby', orientation: 'horizontal', gx: 23, gy: 14, span: 3, outDir: 'N' },
    { id: 'p_w2', roomId: 'lobby', orientation: 'horizontal', gx: 19, gy: 28, span: 3, outDir: 'S' },
    { id: 'p_w3', roomId: 'detective', orientation: 'horizontal', gx: 13, gy: 6, span: 3, outDir: 'N' },
    { id: 'p_w4', roomId: 'detective', orientation: 'vertical', gx: 8, gy: 15, span: 3, outDir: 'W' },
    { id: 'p_w5', roomId: 'corridor', orientation: 'horizontal', gx: 29, gy: 16, span: 3, outDir: 'N' },
    { id: 'p_w6', roomId: 'cells', orientation: 'horizontal', gx: 39, gy: 7, span: 3, outDir: 'N' },
    { id: 'p_w7', roomId: 'cells', orientation: 'vertical', gx: 46, gy: 10, span: 3, outDir: 'E' },
    { id: 'p_w8', roomId: 'vault', orientation: 'vertical', gx: 9, gy: 25, span: 3, outDir: 'W' },
    { id: 'p_w9', roomId: 'vault', orientation: 'horizontal', gx: 12, gy: 30, span: 3, outDir: 'S' },
    { id: 'p_w10', roomId: 'courtyard', orientation: 'vertical', gx: 46, gy: 25, span: 3, outDir: 'E' },
    { id: 'p_w11', roomId: 'courtyard', orientation: 'horizontal', gx: 35, gy: 33, span: 3, outDir: 'S' },
  ],
  props: [
    // 报案接待大厅：前台接待桌、市民等候皮沙发、警务装备铁柜、值班警长办公台
    { id: 'pr_1', roomId: 'lobby', kind: 'desk', x: 16.4 * G, y: 16.4 * G, w: 92, h: 54, blocksBullets: false },
    { id: 'pr_1b', roomId: 'lobby', kind: 'sofa', x: 15.2 * G, y: 18.8 * G, w: 92, h: 46, rotation: Math.PI / 2, blocksBullets: false },
    { id: 'pr_1c', roomId: 'lobby', kind: 'lockers', x: 26.6 * G, y: 15.0 * G, w: 88, h: 42, blocksBullets: true },
    { id: 'pr_1d', roomId: 'lobby', kind: 'desk', x: 23.6 * G, y: 18.6 * G, w: 84, h: 50, blocksBullets: false },
    // 重案组办公翼：双排刑侦办公桌、档案卷宗重型铁柜、证物木箱与审讯休息沙发
    { id: 'pr_2', roomId: 'detective', kind: 'desk', x: 18.2 * G, y: 10.6 * G, w: 86, h: 52, rotation: 0.12, blocksBullets: false },
    { id: 'pr_2b', roomId: 'detective', kind: 'desk', x: 11.8 * G, y: 11.2 * G, w: 86, h: 52, rotation: -0.08, blocksBullets: false },
    { id: 'pr_2c', roomId: 'detective', kind: 'lockers', x: 17.8 * G, y: 7.0 * G, w: 92, h: 42, blocksBullets: true },
    { id: 'pr_3', roomId: 'detective', kind: 'crates', x: 9.6 * G, y: 7.8 * G, w: 66, h: 66, blocksBullets: true },
    { id: 'pr_3b', roomId: 'detective', kind: 'sofa', x: 12.6 * G, y: 19.6 * G, w: 90, h: 46, rotation: -Math.PI / 2, blocksBullets: false },
    // 审讯狭长走廊：东端防暴器械铁柜
    { id: 'pr_cor1', roomId: 'corridor', kind: 'lockers', x: 38.4 * G, y: 19.8 * G, w: 84, h: 40, rotation: Math.PI, blocksBullets: true },
    // 拘留羁押室：看守登记台、囚犯随身物铁柜与防暴补给箱
    { id: 'pr_4', roomId: 'cells', kind: 'crates', x: 43.6 * G, y: 14.2 * G, w: 66, h: 66, blocksBullets: true },
    { id: 'pr_4b', roomId: 'cells', kind: 'desk', x: 39.8 * G, y: 12.0 * G, w: 84, h: 50, blocksBullets: false },
    { id: 'pr_4c', roomId: 'cells', kind: 'lockers', x: 35.1 * G, y: 12.8 * G, w: 84, h: 42, rotation: Math.PI / 2, blocksBullets: true },
    // 特警重装金库：重装防弹衣铁柜与军火箱
    { id: 'pr_5', roomId: 'vault', kind: 'crates', x: 16.0 * G, y: 28.4 * G, w: 68, h: 68, blocksBullets: true },
    { id: 'pr_5b', roomId: 'vault', kind: 'lockers', x: 15.6 * G, y: 24.0 * G, w: 86, h: 42, blocksBullets: true },
    // 后院装甲停机坪：SWAT重型防暴车、洛城黑白巡逻警车与空投物资垛
    { id: 'pr_6', roomId: 'courtyard', kind: 'swat_van', x: 31.2 * G, y: 29.4 * G, w: 152, h: 84, rotation: -0.18, blocksBullets: true },
    { id: 'pr_6b', roomId: 'courtyard', kind: 'police_car', x: 42.2 * G, y: 22.8 * G, w: 134, h: 68, rotation: 0.22, blocksBullets: true },
    { id: 'pr_6c', roomId: 'courtyard', kind: 'crates', x: 26.0 * G, y: 28.6 * G, w: 64, h: 64, blocksBullets: true },
  ],
  stations: [
    { id: 'st_shop1', roomId: 'lobby', type: 'armory_kiosk', x: 25.8 * G, y: 21 * G, cost: 0, label: '军火终端 [B]' },
    { id: 'st_air1', roomId: 'lobby', type: 'starter_airdrop', x: 15.8 * G, y: 21 * G, cost: 0, weaponId: 'plasma', label: '超武空投' },
    { id: 'st_ammo1', roomId: 'detective', type: 'ammo_box', x: 20.2 * G, y: 8 * G, cost: 220, label: '弹药箱' },
    { id: 'st_dog1', roomId: 'cells', type: 'mech_dog_cage', x: 36.5 * G, y: 9.2 * G, cost: 580, label: '解救警犬' },
    { id: 'st_pap1', roomId: 'vault', type: 'pack_a_punch', x: 13.5 * G, y: 25.2 * G, cost: 1850, label: '超武改装台' },
    { id: 'st_shop2', roomId: 'courtyard', type: 'armory_kiosk', x: 30 * G, y: 23.2 * G, cost: 0, label: '军火终端 [B]' },
  ],
  barrels: [
    { x: 20.5 * G, y: 21.5 * G, roomId: 'lobby' },
    { x: 11.5 * G, y: 17 * G, roomId: 'detective' },
    { x: 34.5 * G, y: 18.5 * G, roomId: 'corridor' },
    { x: 43 * G, y: 10 * G, roomId: 'cells' },
    { x: 36.5 * G, y: 24.5 * G, roomId: 'courtyard' },
    { x: 43 * G, y: 30 * G, roomId: 'courtyard' },
  ],
});

// ============================================================================
// 第 2 关：星光霓虹商场（西南迎宾喷泉中庭 + 复古快餐长廊 + L型电玩城 + 曲折货栈 + 露台激光广场）
// 全部 9 扇窗户 100% 直通地图四向户外边缘！
// ============================================================================
const stageMall = buildArchitecturalStage({
  id: 'stage_mall',
  index: 2,
  name: '第 2 关 · 星光霓虹商场',
  subtitle: '喷泉迎宾中庭拉扯尸群，探索复古街机厅与幸运贩卖机！',
  wallColor: '#191d32',
  wallTopColor: '#3b4366',
  cols: 58,
  rows: 42,
  playerSpawnCell: { gx: 24, gy: 21 },
  helipadCell: { gx: 40, gy: 31 },
  rooms: [
    {
      id: 'lobby',
      name: '喷泉迎宾中庭',
      floorTheme: 'mall',
      boxes: [
        { gx: 20, gy: 14, gw: 14, gh: 11 },
        { gx: 20, gy: 25, gw: 8, gh: 6 }, // 西南迎宾外立面大堂，直面西/南开阔户外！
      ],
      initiallyUnlocked: true,
    },
    {
      id: 'diner',
      name: '霓虹快餐长廊',
      floorTheme: 'lobby',
      boxes: [{ gx: 10, gy: 11, gw: 10, gh: 13 }],
      initiallyUnlocked: false,
    },
    {
      id: 'arcade',
      name: '星际电玩城',
      floorTheme: 'lab',
      boxes: [
        { gx: 21, gy: 6, gw: 17, gh: 8 },
        { gx: 34, gy: 14, gw: 6, gh: 3 },
      ],
      initiallyUnlocked: false,
    },
    {
      id: 'cargo',
      name: '东侧卸货通道',
      floorTheme: 'armory',
      boxes: [{ gx: 34, gy: 17, gw: 13, gh: 8 }],
      initiallyUnlocked: false,
    },
    {
      id: 'courtyard',
      name: '星空露台广场',
      floorTheme: 'asphalt',
      boxes: [{ gx: 28, gy: 25, gw: 18, gh: 11 }],
      initiallyUnlocked: false,
    },
  ],
  doors: [
    { id: 'm_d1', orientation: 'vertical', gx: 20, gy: 17, span: 3, roomA: 'lobby', roomB: 'diner', unlockRoomId: 'diner', cost: 500, label: '霓虹快餐长廊' },
    { id: 'm_d2', orientation: 'horizontal', gx: 25, gy: 14, span: 3, roomA: 'lobby', roomB: 'arcade', unlockRoomId: 'arcade', cost: 900, label: '星际电玩城' },
    { id: 'm_d3', orientation: 'vertical', gx: 34, gy: 19, span: 3, roomA: 'lobby', roomB: 'cargo', unlockRoomId: 'cargo', cost: 850, label: '东侧卸货通道' },
    { id: 'm_d4', orientation: 'vertical', gx: 28, gy: 26, span: 3, roomA: 'lobby', roomB: 'courtyard', unlockRoomId: 'courtyard', cost: 1700, label: '星空露台广场' },
    { id: 'm_d5', orientation: 'horizontal', gx: 38, gy: 25, span: 3, roomA: 'cargo', roomB: 'courtyard', unlockRoomId: 'courtyard', cost: 1700, label: '星空露台广场' },
  ],
  windows: [
    { id: 'mw1', roomId: 'lobby', orientation: 'vertical', gx: 20, gy: 26, span: 3, outDir: 'W' },
    { id: 'mw2', roomId: 'lobby', orientation: 'horizontal', gx: 22, gy: 31, span: 3, outDir: 'S' },
    { id: 'mw3', roomId: 'diner', orientation: 'vertical', gx: 10, gy: 16, span: 3, outDir: 'W' },
    { id: 'mw4', roomId: 'diner', orientation: 'horizontal', gx: 13, gy: 11, span: 3, outDir: 'N' },
    { id: 'mw5', roomId: 'arcade', orientation: 'horizontal', gx: 27, gy: 6, span: 3, outDir: 'N' },
    { id: 'mw6', roomId: 'arcade', orientation: 'vertical', gx: 38, gy: 8, span: 3, outDir: 'E' },
    { id: 'mw7', roomId: 'cargo', orientation: 'vertical', gx: 47, gy: 19, span: 3, outDir: 'E' },
    { id: 'mw8', roomId: 'courtyard', orientation: 'horizontal', gx: 34, gy: 36, span: 3, outDir: 'S' },
    { id: 'mw9', roomId: 'courtyard', orientation: 'vertical', gx: 46, gy: 29, span: 3, outDir: 'E' },
  ],
  props: [
    // 喷泉迎宾中庭：中央景观喷泉、两侧真皮休息沙发区与导购服务台
    { id: 'mp1', roomId: 'lobby', kind: 'fountain', x: 27 * G, y: 19.5 * G, w: 92, h: 92, blocksBullets: false },
    { id: 'mp1b', roomId: 'lobby', kind: 'sofa', x: 22.4 * G, y: 16.0 * G, w: 94, h: 48, blocksBullets: false },
    { id: 'mp1c', roomId: 'lobby', kind: 'sofa', x: 32.2 * G, y: 22.2 * G, w: 94, h: 48, rotation: -Math.PI / 2, blocksBullets: false },
    { id: 'mp1d', roomId: 'lobby', kind: 'desk', x: 25.8 * G, y: 28.0 * G, w: 84, h: 50, blocksBullets: false },
    // 霓虹快餐长廊：美式卡座皮沙发与快餐桌组合
    { id: 'mp2', roomId: 'diner', kind: 'sofa', x: 17.6 * G, y: 12.6 * G, w: 92, h: 46, blocksBullets: false },
    { id: 'mp2b', roomId: 'diner', kind: 'desk', x: 17.6 * G, y: 14.8 * G, w: 84, h: 50, blocksBullets: false },
    { id: 'mp3', roomId: 'diner', kind: 'desk', x: 13.4 * G, y: 20.6 * G, w: 84, h: 50, blocksBullets: false },
    { id: 'mp3b', roomId: 'diner', kind: 'sofa', x: 13.4 * G, y: 22.6 * G, w: 92, h: 46, rotation: Math.PI, blocksBullets: false },
    // 星际电玩城：三组双联霓虹复古街机框体 + 玩家休息沙发
    { id: 'mp_arc1', roomId: 'arcade', kind: 'arcade', x: 23.0 * G, y: 7.3 * G, w: 94, h: 54, blocksBullets: true },
    { id: 'mp_arc2', roomId: 'arcade', kind: 'arcade', x: 22.6 * G, y: 12.4 * G, w: 94, h: 54, rotation: Math.PI, blocksBullets: true },
    { id: 'mp_arc3', roomId: 'arcade', kind: 'arcade', x: 31.6 * G, y: 12.5 * G, w: 94, h: 54, rotation: Math.PI, blocksBullets: true },
    { id: 'mp_arc4', roomId: 'arcade', kind: 'sofa', x: 37.0 * G, y: 15.5 * G, w: 88, h: 44, rotation: Math.PI, blocksBullets: false },
    // 东侧卸货通道：仓储重型货架柜与双层集装木箱垛
    { id: 'mp4', roomId: 'cargo', kind: 'crates', x: 40.0 * G, y: 20.2 * G, w: 70, h: 70, blocksBullets: true },
    { id: 'mp4b', roomId: 'cargo', kind: 'crates', x: 43.6 * G, y: 23.2 * G, w: 68, h: 68, blocksBullets: true },
    { id: 'mp4c', roomId: 'cargo', kind: 'lockers', x: 37.6 * G, y: 18.0 * G, w: 92, h: 42, blocksBullets: true },
    // 星空露台广场：露台喷泉、商场安保巡逻警车与观景长椅
    { id: 'mp5', roomId: 'courtyard', kind: 'fountain', x: 31.5 * G, y: 31.8 * G, w: 86, h: 86, blocksBullets: false },
    { id: 'mp5b', roomId: 'courtyard', kind: 'police_car', x: 42.4 * G, y: 34.0 * G, w: 132, h: 68, rotation: -0.22, blocksBullets: true },
    { id: 'mp5c', roomId: 'courtyard', kind: 'sofa', x: 33.4 * G, y: 26.4 * G, w: 90, h: 44, blocksBullets: false },
  ],
  stations: [
    { id: 'ms_shop', roomId: 'lobby', type: 'armory_kiosk', x: 31.4 * G, y: 16.5 * G, cost: 0, label: '军火终端 [B]' },
    { id: 'ms_air', roomId: 'lobby', type: 'starter_airdrop', x: 23.5 * G, y: 23 * G, cost: 0, weaponId: 'launcher', label: '榴弹空投' },
    { id: 'ms_vend', roomId: 'diner', type: 'vending_machine', x: 14.5 * G, y: 18 * G, cost: 240, label: '幸运贩卖机' },
    { id: 'ms_dog', roomId: 'arcade', type: 'mech_dog_cage', x: 24 * G, y: 9.5 * G, cost: 580, label: '激活警犬' },
    { id: 'ms_pap', roomId: 'arcade', type: 'pack_a_punch', x: 34 * G, y: 9.5 * G, cost: 1850, label: '超武改装舱' },
    { id: 'ms_ammo', roomId: 'cargo', type: 'ammo_box', x: 43.5 * G, y: 19.5 * G, cost: 220, label: '弹药补给' },
    { id: 'ms_laser', roomId: 'courtyard', type: 'laser_trap', x: 35.5 * G, y: 29.5 * G, cost: 320, label: '旋转激光塔' },
  ],
  barrels: [
    { x: 29.8 * G, y: 23 * G, roomId: 'lobby' },
    { x: 17.5 * G, y: 21.8 * G, roomId: 'diner' },
    { x: 30 * G, y: 10.5 * G, roomId: 'arcade' },
    { x: 37.5 * G, y: 22 * G, roomId: 'cargo' },
    { x: 43 * G, y: 28 * G, roomId: 'courtyard' },
  ],
});

// ============================================================================
// 第 3 关：73号深渊研究所（双平行连廊回环 + 冷冻培养舱室 + 反应堆核心 + 地下升降坪）
// 全部 8 扇窗户 100% 宽敞外窗直通户外荒野边界！
// ============================================================================
const stageLab = buildArchitecturalStage({
  id: 'stage_lab',
  index: 3,
  name: '第 3 关 · 73号深渊研究所',
  subtitle: '双平行连廊战术回环地形，启动高能反应堆激光粉碎尸王！',
  wallColor: '#0f1926',
  wallTopColor: '#2c4459',
  cols: 58,
  rows: 42,
  playerSpawnCell: { gx: 28, gy: 11 },
  helipadCell: { gx: 28, gy: 32 },
  rooms: [
    {
      id: 'lobby',
      name: '无菌隔离气闸大厅',
      floorTheme: 'lab',
      boxes: [{ gx: 20, gy: 6, gw: 16, gh: 9 }],
      initiallyUnlocked: true,
    },
    {
      id: 'west_wing',
      name: '西翼冷冻培养室',
      floorTheme: 'armory',
      boxes: [
        { gx: 11, gy: 13, gw: 9, gh: 13 },
        { gx: 20, gy: 15, gw: 4, gh: 11 }, // 西侧连廊
      ],
      initiallyUnlocked: false,
    },
    {
      id: 'east_wing',
      name: '东翼高能反应堆',
      floorTheme: 'lab',
      boxes: [
        { gx: 36, gy: 13, gw: 10, gh: 13 },
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
    { id: 'lw1', roomId: 'lobby', orientation: 'horizontal', gx: 26, gy: 6, span: 4, outDir: 'N' },
    { id: 'lw2', roomId: 'lobby', orientation: 'vertical', gx: 36, gy: 7, span: 3, outDir: 'E' },
    { id: 'lw3', roomId: 'west_wing', orientation: 'vertical', gx: 11, gy: 17, span: 3, outDir: 'W' },
    { id: 'lw4', roomId: 'west_wing', orientation: 'horizontal', gx: 13, gy: 26, span: 3, outDir: 'S' },
    { id: 'lw5', roomId: 'east_wing', orientation: 'vertical', gx: 46, gy: 17, span: 3, outDir: 'E' },
    { id: 'lw6', roomId: 'east_wing', orientation: 'horizontal', gx: 40, gy: 26, span: 3, outDir: 'S' },
    { id: 'lw7', roomId: 'courtyard', orientation: 'horizontal', gx: 26, gy: 36, span: 4, outDir: 'S' },
    { id: 'lw8', roomId: 'courtyard', orientation: 'vertical', gx: 18, gy: 30, span: 3, outDir: 'W' },
  ],
  props: [
    // 无菌隔离气闸大厅：检疫主控台、隔离样本冷冻舱与防化服服务器机柜
    { id: 'lp1', roomId: 'lobby', kind: 'desk', x: 25.2 * G, y: 10.8 * G, w: 86, h: 52, blocksBullets: false },
    { id: 'lp1b', roomId: 'lobby', kind: 'cryo_pod', x: 21.8 * G, y: 7.8 * G, w: 76, h: 76, blocksBullets: false },
    { id: 'lp1c', roomId: 'lobby', kind: 'lockers', x: 32.0 * G, y: 7.1 * G, w: 88, h: 42, blocksBullets: true },
    // 西翼冷冻培养室：三座高能生物低温培养舱阵列 + 低温监控服务器机柜
    { id: 'lp2', roomId: 'west_wing', kind: 'cryo_pod', x: 15.6 * G, y: 17.2 * G, w: 82, h: 82, blocksBullets: false },
    { id: 'lp3', roomId: 'west_wing', kind: 'cryo_pod', x: 15.6 * G, y: 21.6 * G, w: 82, h: 82, blocksBullets: false },
    { id: 'lp3b', roomId: 'west_wing', kind: 'cryo_pod', x: 18.6 * G, y: 19.4 * G, w: 74, h: 74, blocksBullets: false },
    { id: 'lp3c', roomId: 'west_wing', kind: 'lockers', x: 12.6 * G, y: 14.1 * G, w: 84, h: 42, blocksBullets: true },
    // 东翼高能反应堆：反应堆冷却核心舱、主机服务器阵列、同位素防爆箱与监控台
    { id: 'lp4', roomId: 'east_wing', kind: 'crates', x: 43.2 * G, y: 14.8 * G, w: 68, h: 68, blocksBullets: true },
    { id: 'lp4b', roomId: 'east_wing', kind: 'lockers', x: 38.6 * G, y: 14.1 * G, w: 92, h: 42, blocksBullets: true },
    { id: 'lp4c', roomId: 'east_wing', kind: 'cryo_pod', x: 37.5 * G, y: 23.0 * G, w: 78, h: 78, blocksBullets: false },
    { id: 'lp4d', roomId: 'east_wing', kind: 'desk', x: 44.2 * G, y: 22.6 * G, w: 82, h: 48, rotation: -Math.PI / 2, blocksBullets: false },
    // 南区地下升降平台：重装特勤装甲车、安保巡逻警车与高危物资集装箱
    { id: 'lp5', roomId: 'courtyard', kind: 'swat_van', x: 23.0 * G, y: 31.2 * G, w: 148, h: 82, rotation: 0.15, blocksBullets: true },
    { id: 'lp5b', roomId: 'courtyard', kind: 'police_car', x: 35.4 * G, y: 34.0 * G, w: 132, h: 68, rotation: -0.2, blocksBullets: true },
    { id: 'lp5c', roomId: 'courtyard', kind: 'crates', x: 29.8 * G, y: 27.6 * G, w: 66, h: 66, blocksBullets: true },
  ],
  stations: [
    { id: 'ls_shop', roomId: 'lobby', type: 'armory_kiosk', x: 32.5 * G, y: 11.8 * G, cost: 0, label: '军火终端 [B]' },
    { id: 'ls_air', roomId: 'lobby', type: 'starter_airdrop', x: 22.2 * G, y: 10.5 * G, cost: 0, weaponId: 'minigun', label: '加特林空投' },
    { id: 'ls_dog', roomId: 'west_wing', type: 'mech_dog_cage', x: 15.5 * G, y: 14.3 * G, cost: 580, label: '释放机械犬' },
    { id: 'ls_ammo', roomId: 'west_wing', type: 'ammo_box', x: 19 * G, y: 23.5 * G, cost: 220, label: '弹药补给柜' },
    { id: 'ls_pap', roomId: 'east_wing', type: 'pack_a_punch', x: 41 * G, y: 22.5 * G, cost: 1850, label: '超武改造舱' },
    { id: 'ls_laser', roomId: 'east_wing', type: 'laser_trap', x: 39 * G, y: 19.5 * G, cost: 300, label: '激光矩阵' },
    { id: 'ls_shop2', roomId: 'courtyard', type: 'armory_kiosk', x: 34.5 * G, y: 30.5 * G, cost: 0, label: '军火终端 [B]' },
  ],
  barrels: [
    { x: 29 * G, y: 13.2 * G, roomId: 'lobby' },
    { x: 21.8 * G, y: 20.5 * G, roomId: 'west_wing' },
    { x: 34.2 * G, y: 20.5 * G, roomId: 'east_wing' },
    { x: 32 * G, y: 33 * G, roomId: 'courtyard' },
  ],
});

// ============================================================================
// 第 4 关：圣玛丽隔离医院（T型急诊分诊大厅 + L型重症ICU + 生化药剂冷库 + 无菌手术廊 + 停尸样本库 + 救护停机坪）
// ============================================================================
const stageHospital = buildArchitecturalStage({
  id: 'stage_hospital',
  index: 4,
  name: '第 4 关 · 圣玛丽隔离医院',
  subtitle: '深入沦陷疫区急诊中心，穿越隔离病床阵与无菌手术廊突围撤离！',
  wallColor: '#132226',
  wallTopColor: '#365860',
  cols: 58,
  rows: 42,
  playerSpawnCell: { gx: 25, gy: 20 },
  helipadCell: { gx: 40, gy: 29 },
  rooms: [
    {
      id: 'lobby',
      name: '急诊分诊大厅',
      floorTheme: 'hospital',
      boxes: [
        { gx: 18, gy: 15, gw: 15, gh: 8 },
        { gx: 22, gy: 23, gw: 7, gh: 7 },
      ],
      initiallyUnlocked: true,
    },
    {
      id: 'icu',
      name: '重症隔离ICU',
      floorTheme: 'hospital',
      boxes: [
        { gx: 8, gy: 7, gw: 13, gh: 8 },
        { gx: 8, gy: 15, gw: 10, gh: 8 },
      ],
      initiallyUnlocked: false,
    },
    {
      id: 'pharmacy',
      name: '生化药剂冷库',
      floorTheme: 'lab',
      boxes: [{ gx: 26, gy: 6, gw: 14, gh: 9 }],
      initiallyUnlocked: false,
    },
    {
      id: 'surgery',
      name: '无菌手术长廊',
      floorTheme: 'hospital',
      boxes: [{ gx: 33, gy: 15, gw: 14, gh: 8 }],
      initiallyUnlocked: false,
    },
    {
      id: 'morgue',
      name: '地下样本停尸房',
      floorTheme: 'lab',
      boxes: [{ gx: 11, gy: 23, gw: 11, gh: 8 }],
      initiallyUnlocked: false,
    },
    {
      id: 'courtyard',
      name: '急诊救护停机坪',
      floorTheme: 'asphalt',
      boxes: [{ gx: 29, gy: 23, gw: 18, gh: 12 }],
      initiallyUnlocked: false,
    },
  ],
  doors: [
    { id: 'h_d1', orientation: 'vertical', gx: 18, gy: 18, span: 3, roomA: 'lobby', roomB: 'icu', unlockRoomId: 'icu', cost: 480, label: '重症隔离ICU' },
    { id: 'h_d2', orientation: 'horizontal', gx: 27, gy: 15, span: 3, roomA: 'lobby', roomB: 'pharmacy', unlockRoomId: 'pharmacy', cost: 620, label: '生化药剂冷库' },
    { id: 'h_d3', orientation: 'vertical', gx: 33, gy: 18, span: 3, roomA: 'lobby', roomB: 'surgery', unlockRoomId: 'surgery', cost: 680, label: '无菌手术长廊' },
    { id: 'h_d4', orientation: 'vertical', gx: 22, gy: 26, span: 3, roomA: 'lobby', roomB: 'morgue', unlockRoomId: 'morgue', cost: 980, label: '地下样本停尸房' },
    { id: 'h_d5', orientation: 'horizontal', gx: 13, gy: 23, span: 3, roomA: 'icu', roomB: 'morgue', unlockRoomId: 'morgue', cost: 980, label: '地下样本停尸房' },
    { id: 'h_d6', orientation: 'vertical', gx: 29, gy: 26, span: 3, roomA: 'lobby', roomB: 'courtyard', unlockRoomId: 'courtyard', cost: 1680, label: '救护停机坪' },
    { id: 'h_d7', orientation: 'horizontal', gx: 37, gy: 23, span: 3, roomA: 'surgery', roomB: 'courtyard', unlockRoomId: 'courtyard', cost: 1680, label: '救护停机坪' },
  ],
  windows: [
    { id: 'hw1', roomId: 'lobby', orientation: 'horizontal', gx: 24, gy: 30, span: 3, outDir: 'S' },
    { id: 'hw1_n', roomId: 'lobby', orientation: 'horizontal', gx: 22, gy: 15, span: 3, outDir: 'N' },
    { id: 'hw2', roomId: 'icu', orientation: 'horizontal', gx: 13, gy: 7, span: 3, outDir: 'N' },
    { id: 'hw3', roomId: 'icu', orientation: 'vertical', gx: 8, gy: 16, span: 3, outDir: 'W' },
    { id: 'hw4', roomId: 'pharmacy', orientation: 'horizontal', gx: 31, gy: 6, span: 3, outDir: 'N' },
    { id: 'hw5', roomId: 'pharmacy', orientation: 'vertical', gx: 40, gy: 9, span: 3, outDir: 'E' },
    { id: 'hw6', roomId: 'surgery', orientation: 'vertical', gx: 47, gy: 17, span: 3, outDir: 'E' },
    { id: 'hw7', roomId: 'morgue', orientation: 'vertical', gx: 11, gy: 25, span: 3, outDir: 'W' },
    { id: 'hw8', roomId: 'morgue', orientation: 'horizontal', gx: 15, gy: 31, span: 3, outDir: 'S' },
    { id: 'hw9', roomId: 'courtyard', orientation: 'vertical', gx: 47, gy: 27, span: 3, outDir: 'E' },
    { id: 'hw10', roomId: 'courtyard', orientation: 'horizontal', gx: 35, gy: 35, span: 4, outDir: 'S' },
  ],
  props: [
    // 急诊分诊大厅：急诊导医台、候诊长排沙发、隔离检疫病床与医疗器械柜
    { id: 'hp1', roomId: 'lobby', kind: 'desk', x: 22.0 * G, y: 18.2 * G, w: 88, h: 52, blocksBullets: false },
    { id: 'hp2', roomId: 'lobby', kind: 'sofa', x: 29.5 * G, y: 16.4 * G, w: 92, h: 46, blocksBullets: false },
    { id: 'hp3', roomId: 'lobby', kind: 'hospital_bed', x: 20.6 * G, y: 21.2 * G, w: 96, h: 54, rotation: 0.14, blocksBullets: false },
    { id: 'hp4', roomId: 'lobby', kind: 'lockers', x: 30.8 * G, y: 16.2 * G, w: 86, h: 42, blocksBullets: true },
    // 重症隔离ICU：多张检疫隔离病床阵列与药品铁柜
    { id: 'hp5', roomId: 'icu', kind: 'hospital_bed', x: 12.6 * G, y: 10.4 * G, w: 98, h: 54, blocksBullets: false },
    { id: 'hp6', roomId: 'icu', kind: 'hospital_bed', x: 18.8 * G, y: 11.2 * G, w: 98, h: 54, rotation: -0.1, blocksBullets: false },
    { id: 'hp7', roomId: 'icu', kind: 'hospital_bed', x: 13.5 * G, y: 19.6 * G, w: 96, h: 54, rotation: Math.PI / 2, blocksBullets: false },
    { id: 'hp8', roomId: 'icu', kind: 'lockers', x: 19.6 * G, y: 8.1 * G, w: 86, h: 42, blocksBullets: true },
    // 生化药剂冷库：低温疫苗培养舱与冷链储药箱
    { id: 'hp9', roomId: 'pharmacy', kind: 'cryo_pod', x: 28.0 * G, y: 10.2 * G, w: 78, h: 78, blocksBullets: false },
    { id: 'hp10', roomId: 'pharmacy', kind: 'crates', x: 36.2 * G, y: 13.0 * G, w: 66, h: 66, blocksBullets: true },
    { id: 'hp11', roomId: 'pharmacy', kind: 'lockers', x: 27.6 * G, y: 7.1 * G, w: 86, h: 42, blocksBullets: true },
    // 无菌手术长廊：无影手术床与器械监护台
    { id: 'hp12', roomId: 'surgery', kind: 'hospital_bed', x: 38.4 * G, y: 18.0 * G, w: 100, h: 56, blocksBullets: false },
    { id: 'hp13', roomId: 'surgery', kind: 'hospital_bed', x: 43.2 * G, y: 20.6 * G, w: 100, h: 56, blocksBullets: false },
    { id: 'hp14', roomId: 'surgery', kind: 'desk', x: 40.2 * G, y: 16.2 * G, w: 84, h: 48, blocksBullets: false },
    // 地下样本停尸房：冷冻隔离舱与生物高危封存箱
    { id: 'hp15', roomId: 'morgue', kind: 'cryo_pod', x: 15.2 * G, y: 27.2 * G, w: 78, h: 78, blocksBullets: false },
    { id: 'hp16', roomId: 'morgue', kind: 'crates', x: 19.6 * G, y: 29.2 * G, w: 66, h: 66, blocksBullets: true },
    // 急诊救护停机坪：急救车、特警防疫车与防疫物资箱
    { id: 'hp17', roomId: 'courtyard', kind: 'ambulance', x: 33.4 * G, y: 31.2 * G, w: 146, h: 74, rotation: -0.18, blocksBullets: true },
    { id: 'hp18', roomId: 'courtyard', kind: 'ambulance', x: 43.4 * G, y: 25.0 * G, w: 144, h: 72, rotation: 2.85, blocksBullets: true },
    { id: 'hp19', roomId: 'courtyard', kind: 'crates', x: 32.0 * G, y: 24.8 * G, w: 64, h: 64, blocksBullets: true },
  ],
  stations: [
    { id: 'hs_shop1', roomId: 'lobby', type: 'armory_kiosk', x: 30.8 * G, y: 20.8 * G, cost: 0, label: '军火终端 [B]' },
    { id: 'hs_air', roomId: 'lobby', type: 'starter_airdrop', x: 25.5 * G, y: 23.2 * G, cost: 0, weaponId: 'cryogun', label: '液氮炮空投' },
    { id: 'hs_dog', roomId: 'icu', type: 'mech_dog_cage', x: 11.4 * G, y: 13.2 * G, cost: 580, label: '释放搜救机械犬' },
    { id: 'hs_vend', roomId: 'pharmacy', type: 'vending_machine', x: 34.8 * G, y: 8.4 * G, cost: 240, label: '医疗补给机' },
    { id: 'hs_ammo', roomId: 'surgery', type: 'ammo_box', x: 44.5 * G, y: 16.5 * G, cost: 220, label: '弹药补给箱' },
    { id: 'hs_pap', roomId: 'morgue', type: 'pack_a_punch', x: 18.2 * G, y: 25.2 * G, cost: 1850, label: '超武改造台' },
    { id: 'hs_laser', roomId: 'courtyard', type: 'laser_trap', x: 35.6 * G, y: 28.0 * G, cost: 320, label: '防疫消杀激光塔' },
    { id: 'hs_shop2', roomId: 'courtyard', type: 'armory_kiosk', x: 31.8 * G, y: 33.4 * G, cost: 0, label: '军火终端 [B]' },
  ],
  barrels: [
    { x: 27.6 * G, y: 22.0 * G, roomId: 'lobby' },
    { x: 16.0 * G, y: 14.2 * G, roomId: 'icu' },
    { x: 31.8 * G, y: 12.2 * G, roomId: 'pharmacy' },
    { x: 36.2 * G, y: 20.8 * G, roomId: 'surgery' },
    { x: 44.2 * G, y: 32.8 * G, roomId: 'courtyard' },
  ],
});

// ============================================================================
// 第 5 关：铁锈港集装箱码头（港务大厅 + 海关扣押仓 + 集装箱CQB迷宫 + 轮机船坞 + 深海冷库 + 防波堤停机坪）
// ============================================================================
const stageHarbor = buildArchitecturalStage({
  id: 'stage_harbor',
  index: 5,
  name: '第 5 关 · 铁锈港集装箱码头',
  subtitle: '在巨型海运集装箱巷战迷宫与重型叉车掩体间穿梭，引爆油桶粉碎尸潮！',
  wallColor: '#161e29',
  wallTopColor: '#475569',
  cols: 60,
  rows: 42,
  playerSpawnCell: { gx: 14, gy: 19 },
  helipadCell: { gx: 43, gy: 31 },
  rooms: [
    {
      id: 'lobby',
      name: '港务调度大厅',
      floorTheme: 'dock',
      boxes: [{ gx: 7, gy: 14, gw: 14, gh: 11 }],
      initiallyUnlocked: true,
    },
    {
      id: 'customs',
      name: '海关扣押军火仓',
      floorTheme: 'armory',
      boxes: [{ gx: 10, gy: 6, gw: 11, gh: 8 }],
      initiallyUnlocked: false,
    },
    {
      id: 'containers',
      name: '冷链集装箱迷宫',
      floorTheme: 'dock',
      boxes: [{ gx: 21, gy: 11, gw: 17, gh: 14 }],
      initiallyUnlocked: false,
    },
    {
      id: 'workshop',
      name: '重机轮机船坞',
      floorTheme: 'armory',
      boxes: [{ gx: 13, gy: 25, gw: 14, gh: 9 }],
      initiallyUnlocked: false,
    },
    {
      id: 'cold_storage',
      name: '深海冷冻货栈',
      floorTheme: 'lab',
      boxes: [{ gx: 38, gy: 8, gw: 12, gh: 12 }],
      initiallyUnlocked: false,
    },
    {
      id: 'courtyard',
      name: '深水防波堤停机坪',
      floorTheme: 'asphalt',
      boxes: [{ gx: 31, gy: 25, gw: 19, gh: 11 }],
      initiallyUnlocked: false,
    },
  ],
  doors: [
    { id: 'hb_d1', orientation: 'horizontal', gx: 14, gy: 14, span: 3, roomA: 'lobby', roomB: 'customs', unlockRoomId: 'customs', cost: 500, label: '海关扣押仓' },
    { id: 'hb_d2', orientation: 'vertical', gx: 21, gy: 18, span: 3, roomA: 'lobby', roomB: 'containers', unlockRoomId: 'containers', cost: 640, label: '集装箱迷宫' },
    { id: 'hb_d3', orientation: 'horizontal', gx: 15, gy: 25, span: 3, roomA: 'lobby', roomB: 'workshop', unlockRoomId: 'workshop', cost: 720, label: '重机轮机船坞' },
    { id: 'hb_d4', orientation: 'horizontal', gx: 23, gy: 25, span: 3, roomA: 'containers', roomB: 'workshop', unlockRoomId: 'workshop', cost: 720, label: '重机轮机船坞' },
    { id: 'hb_d5', orientation: 'vertical', gx: 38, gy: 14, span: 3, roomA: 'containers', roomB: 'cold_storage', unlockRoomId: 'cold_storage', cost: 1050, label: '深海冷冻货栈' },
    { id: 'hb_d6', orientation: 'horizontal', gx: 33, gy: 25, span: 3, roomA: 'containers', roomB: 'courtyard', unlockRoomId: 'courtyard', cost: 1750, label: '防波堤停机坪' },
  ],
  windows: [
    { id: 'hbw1', roomId: 'lobby', orientation: 'vertical', gx: 7, gy: 17, span: 3, outDir: 'W' },
    { id: 'hbw1_s', roomId: 'lobby', orientation: 'horizontal', gx: 9, gy: 25, span: 3, outDir: 'S' },
    { id: 'hbw2', roomId: 'customs', orientation: 'horizontal', gx: 15, gy: 6, span: 3, outDir: 'N' },
    { id: 'hbw3', roomId: 'customs', orientation: 'vertical', gx: 10, gy: 8, span: 3, outDir: 'W' },
    { id: 'hbw4', roomId: 'containers', orientation: 'horizontal', gx: 28, gy: 11, span: 4, outDir: 'N' },
    { id: 'hbw5', roomId: 'cold_storage', orientation: 'horizontal', gx: 42, gy: 8, span: 3, outDir: 'N' },
    { id: 'hbw6', roomId: 'cold_storage', orientation: 'vertical', gx: 50, gy: 13, span: 3, outDir: 'E' },
    { id: 'hbw7', roomId: 'workshop', orientation: 'horizontal', gx: 18, gy: 34, span: 3, outDir: 'S' },
    { id: 'hbw8', roomId: 'workshop', orientation: 'vertical', gx: 13, gy: 28, span: 3, outDir: 'W' },
    { id: 'hbw9', roomId: 'courtyard', orientation: 'vertical', gx: 50, gy: 29, span: 3, outDir: 'E' },
    { id: 'hbw10', roomId: 'courtyard', orientation: 'horizontal', gx: 38, gy: 36, span: 4, outDir: 'S' },
  ],
  props: [
    // 港务调度大厅：货运叉车、调度桌与报关集装木箱
    { id: 'hbp1', roomId: 'lobby', kind: 'forklift', x: 12.2 * G, y: 16.4 * G, w: 96, h: 52, rotation: 0.25, blocksBullets: false },
    { id: 'hbp2', roomId: 'lobby', kind: 'desk', x: 17.8 * G, y: 21.8 * G, w: 86, h: 50, blocksBullets: false },
    { id: 'hbp3', roomId: 'lobby', kind: 'crates', x: 9.2 * G, y: 21.8 * G, w: 66, h: 66, blocksBullets: true },
    // 海关扣押军火仓：查扣重武器柜与走私木箱垛
    { id: 'hbp4', roomId: 'customs', kind: 'crates', x: 18.8 * G, y: 11.4 * G, w: 68, h: 68, blocksBullets: true },
    { id: 'hbp5', roomId: 'customs', kind: 'lockers', x: 18.6 * G, y: 7.2 * G, w: 90, h: 42, blocksBullets: true },
    // 冷链集装箱迷宫：三座错落重型海运集装箱 + 货运叉车构成黄金战术绕柱走廊！
    { id: 'hbp6', roomId: 'containers', kind: 'container', x: 26.2 * G, y: 15.4 * G, w: 156, h: 82, rotation: 0.04, blocksBullets: true },
    { id: 'hbp7', roomId: 'containers', kind: 'container', x: 33.4 * G, y: 19.8 * G, w: 156, h: 82, rotation: -0.05, blocksBullets: true },
    { id: 'hbp8', roomId: 'containers', kind: 'forklift', x: 25.4 * G, y: 21.4 * G, w: 96, h: 52, rotation: -0.35, blocksBullets: false },
    // 重机轮机船坞：维修叉车与重机零件货箱
    { id: 'hbp9', roomId: 'workshop', kind: 'forklift', x: 23.2 * G, y: 31.2 * G, w: 98, h: 54, rotation: Math.PI - 0.2, blocksBullets: false },
    { id: 'hbp10', roomId: 'workshop', kind: 'crates', x: 15.2 * G, y: 30.8 * G, w: 68, h: 68, blocksBullets: true },
    // 深海冷冻货栈：冷链集装箱与冷冻舱
    { id: 'hbp11', roomId: 'cold_storage', kind: 'cryo_pod', x: 42.0 * G, y: 12.2 * G, w: 78, h: 78, blocksBullets: false },
    { id: 'hbp12', roomId: 'cold_storage', kind: 'crates', x: 46.8 * G, y: 17.4 * G, w: 68, h: 68, blocksBullets: true },
    // 深水防波堤停机坪：集装箱掩体、军用卡车与港警巡逻车
    { id: 'hbp13', roomId: 'courtyard', kind: 'container', x: 35.4 * G, y: 32.6 * G, w: 152, h: 80, rotation: 0.12, blocksBullets: true },
    { id: 'hbp14', roomId: 'courtyard', kind: 'military_truck', x: 46.4 * G, y: 27.2 * G, w: 148, h: 72, rotation: 2.9, blocksBullets: true },
  ],
  stations: [
    { id: 'hbs_shop1', roomId: 'lobby', type: 'armory_kiosk', x: 18.6 * G, y: 16.0 * G, cost: 0, label: '军火终端 [B]' },
    { id: 'hbs_air', roomId: 'lobby', type: 'starter_airdrop', x: 13.8 * G, y: 22.6 * G, cost: 0, weaponId: 'sawlauncher', label: '圆锯炮空投' },
    { id: 'hbs_dog', roomId: 'customs', type: 'mech_dog_cage', x: 13.0 * G, y: 11.2 * G, cost: 580, label: '释放缉私机械犬' },
    { id: 'hbs_ammo', roomId: 'containers', type: 'ammo_box', x: 34.8 * G, y: 13.4 * G, cost: 220, label: '弹药补给箱' },
    { id: 'hbs_laser', roomId: 'containers', type: 'laser_trap', x: 29.8 * G, y: 17.6 * G, cost: 300, label: '港口切割激光塔' },
    { id: 'hbs_vend', roomId: 'workshop', type: 'vending_machine', x: 19.6 * G, y: 28.2 * G, cost: 240, label: '船坞补给机' },
    { id: 'hbs_pap', roomId: 'cold_storage', type: 'pack_a_punch', x: 45.6 * G, y: 11.6 * G, cost: 1850, label: '超武改造台' },
    { id: 'hbs_shop2', roomId: 'courtyard', type: 'armory_kiosk', x: 38.2 * G, y: 27.2 * G, cost: 0, label: '军火终端 [B]' },
  ],
  barrels: [
    { x: 16.5 * G, y: 18.5 * G, roomId: 'lobby' },
    { x: 29.8 * G, y: 22.2 * G, roomId: 'containers' },
    { x: 23.0 * G, y: 13.8 * G, roomId: 'containers' },
    { x: 20.2 * G, y: 31.8 * G, roomId: 'workshop' },
    { x: 41.2 * G, y: 17.0 * G, roomId: 'cold_storage' },
    { x: 47.4 * G, y: 33.4 * G, roomId: 'courtyard' },
  ],
});

// ============================================================================
// 第 6 关：末日地铁枢纽站（安检售票大厅 + 地下商业街 + 牵引变电所 + 36格超宽双轨列车月台 + 抢修室 + 地面广场）
// ============================================================================
const stageSubway = buildArchitecturalStage({
  id: 'stage_subway',
  index: 6,
  name: '第 6 关 · 末日地铁枢纽站',
  subtitle: '依托脱轨地铁车厢构筑纵深交叉火力网，死守贯通东西的地下双轨月台！',
  wallColor: '#15182a',
  wallTopColor: '#414b6e',
  cols: 60,
  rows: 42,
  playerSpawnCell: { gx: 30, gy: 12 },
  helipadCell: { gx: 41, gy: 32 },
  rooms: [
    {
      id: 'lobby',
      name: '安检售票中庭',
      floorTheme: 'lobby',
      boxes: [{ gx: 22, gy: 6, gw: 16, gh: 13 }],
      initiallyUnlocked: true,
    },
    {
      id: 'concourse',
      name: '地下商业街廊',
      floorTheme: 'mall',
      boxes: [{ gx: 9, gy: 9, gw: 13, gh: 10 }],
      initiallyUnlocked: false,
    },
    {
      id: 'power_room',
      name: '高压牵引变电所',
      floorTheme: 'lab',
      boxes: [{ gx: 38, gy: 9, gw: 12, gh: 10 }],
      initiallyUnlocked: false,
    },
    {
      id: 'platform',
      name: '一号双轨列车月台',
      floorTheme: 'dock',
      boxes: [{ gx: 12, gy: 19, gw: 36, gh: 9 }],
      initiallyUnlocked: false,
    },
    {
      id: 'maint',
      name: '轨道抢修军械室',
      floorTheme: 'armory',
      boxes: [{ gx: 10, gy: 28, gw: 14, gh: 8 }],
      initiallyUnlocked: false,
    },
    {
      id: 'courtyard',
      name: '地面换乘广场停机坪',
      floorTheme: 'asphalt',
      boxes: [{ gx: 28, gy: 28, gw: 20, gh: 9 }],
      initiallyUnlocked: false,
    },
  ],
  doors: [
    { id: 'sw_d1', orientation: 'vertical', gx: 22, gy: 12, span: 3, roomA: 'lobby', roomB: 'concourse', unlockRoomId: 'concourse', cost: 520, label: '地下商业街廊' },
    { id: 'sw_d2', orientation: 'vertical', gx: 38, gy: 12, span: 3, roomA: 'lobby', roomB: 'power_room', unlockRoomId: 'power_room', cost: 640, label: '高压牵引变电所' },
    { id: 'sw_d3', orientation: 'horizontal', gx: 28, gy: 19, span: 4, roomA: 'lobby', roomB: 'platform', unlockRoomId: 'platform', cost: 780, label: '一号双轨月台' },
    { id: 'sw_d4', orientation: 'horizontal', gx: 15, gy: 19, span: 3, roomA: 'concourse', roomB: 'platform', unlockRoomId: 'platform', cost: 780, label: '一号双轨月台' },
    { id: 'sw_d5', orientation: 'horizontal', gx: 41, gy: 19, span: 3, roomA: 'power_room', roomB: 'platform', unlockRoomId: 'platform', cost: 780, label: '一号双轨月台' },
    { id: 'sw_d6', orientation: 'horizontal', gx: 16, gy: 28, span: 3, roomA: 'platform', roomB: 'maint', unlockRoomId: 'maint', cost: 1050, label: '轨道抢修军械室' },
    { id: 'sw_d7', orientation: 'horizontal', gx: 34, gy: 28, span: 4, roomA: 'platform', roomB: 'courtyard', unlockRoomId: 'courtyard', cost: 1780, label: '地面换乘停机坪' },
  ],
  windows: [
    { id: 'sww1', roomId: 'lobby', orientation: 'horizontal', gx: 24, gy: 6, span: 3, outDir: 'N' },
    { id: 'sww2', roomId: 'lobby', orientation: 'horizontal', gx: 33, gy: 6, span: 3, outDir: 'N' },
    { id: 'sww3', roomId: 'concourse', orientation: 'horizontal', gx: 13, gy: 9, span: 3, outDir: 'N' },
    { id: 'sww4', roomId: 'concourse', orientation: 'vertical', gx: 9, gy: 13, span: 3, outDir: 'W' },
    { id: 'sww5', roomId: 'power_room', orientation: 'horizontal', gx: 43, gy: 9, span: 3, outDir: 'N' },
    { id: 'sww6', roomId: 'power_room', orientation: 'vertical', gx: 50, gy: 13, span: 3, outDir: 'E' },
    { id: 'sww7', roomId: 'platform', orientation: 'vertical', gx: 12, gy: 22, span: 3, outDir: 'W' },
    { id: 'sww8', roomId: 'platform', orientation: 'vertical', gx: 48, gy: 22, span: 3, outDir: 'E' },
    { id: 'sww9', roomId: 'maint', orientation: 'horizontal', gx: 15, gy: 36, span: 3, outDir: 'S' },
    { id: 'sww10', roomId: 'courtyard', orientation: 'horizontal', gx: 36, gy: 37, span: 4, outDir: 'S' },
    { id: 'sww11', roomId: 'courtyard', orientation: 'vertical', gx: 48, gy: 31, span: 3, outDir: 'E' },
  ],
  props: [
    // 安检售票中庭：售票服务台、候车长椅沙发与安检设备柜
    { id: 'swp1', roomId: 'lobby', kind: 'desk', x: 26.2 * G, y: 10.6 * G, w: 88, h: 52, blocksBullets: false },
    { id: 'swp2', roomId: 'lobby', kind: 'sofa', x: 34.2 * G, y: 10.6 * G, w: 92, h: 46, blocksBullets: false },
    { id: 'swp3', roomId: 'lobby', kind: 'lockers', x: 29.8 * G, y: 7.2 * G, w: 88, h: 42, blocksBullets: true },
    // 地下商业街廊：复古街机与休闲卡座
    { id: 'swp4', roomId: 'concourse', kind: 'arcade', x: 18.8 * G, y: 10.4 * G, w: 94, h: 54, blocksBullets: true },
    { id: 'swp5', roomId: 'concourse', kind: 'sofa', x: 13.0 * G, y: 16.6 * G, w: 90, h: 46, blocksBullets: false },
    // 高压牵引变电所：电力监控雷达台与防爆器材箱
    { id: 'swp6', roomId: 'power_room', kind: 'radar_console', x: 43.4 * G, y: 14.0 * G, w: 86, h: 86, blocksBullets: false },
    { id: 'swp7', roomId: 'power_room', kind: 'crates', x: 47.6 * G, y: 10.8 * G, w: 66, h: 66, blocksBullets: true },
    // 一号双轨列车月台：两节脱轨横停的不锈钢地铁列车车厢！
    { id: 'swp8', roomId: 'platform', kind: 'subway_car', x: 22.4 * G, y: 23.5 * G, w: 196, h: 72, rotation: 0.04, blocksBullets: true },
    { id: 'swp9', roomId: 'platform', kind: 'subway_car', x: 38.2 * G, y: 23.5 * G, w: 196, h: 72, rotation: -0.05, blocksBullets: true },
    // 轨道抢修军械室：抢修工程叉车与备件箱
    { id: 'swp10', roomId: 'maint', kind: 'forklift', x: 13.6 * G, y: 31.8 * G, w: 96, h: 52, rotation: 0.18, blocksBullets: false },
    { id: 'swp11', roomId: 'maint', kind: 'crates', x: 21.2 * G, y: 33.4 * G, w: 68, h: 68, blocksBullets: true },
    // 地面换乘广场停机坪：特警防暴车与救护车封锁阵
    { id: 'swp12', roomId: 'courtyard', kind: 'swat_van', x: 31.8 * G, y: 33.6 * G, w: 148, h: 82, rotation: -0.15, blocksBullets: true },
    { id: 'swp13', roomId: 'courtyard', kind: 'police_car', x: 45.2 * G, y: 29.8 * G, w: 132, h: 68, rotation: 2.8, blocksBullets: true },
  ],
  stations: [
    { id: 'sws_shop1', roomId: 'lobby', type: 'armory_kiosk', x: 34.8 * G, y: 16.0 * G, cost: 0, label: '军火终端 [B]' },
    { id: 'sws_air', roomId: 'lobby', type: 'starter_airdrop', x: 25.0 * G, y: 15.8 * G, cost: 0, weaponId: 'tesla', label: '电弧炮空投' },
    { id: 'sws_vend', roomId: 'concourse', type: 'vending_machine', x: 12.6 * G, y: 12.6 * G, cost: 240, label: '地铁补给贩卖机' },
    { id: 'sws_dog', roomId: 'concourse', type: 'mech_dog_cage', x: 19.2 * G, y: 16.4 * G, cost: 580, label: '释放巡逻机械犬' },
    { id: 'sws_laser', roomId: 'power_room', type: 'laser_trap', x: 46.8 * G, y: 16.4 * G, cost: 300, label: '高压电弧激光塔' },
    { id: 'sws_ammo', roomId: 'platform', type: 'ammo_box', x: 30.4 * G, y: 23.5 * G, cost: 220, label: '月台弹药箱' },
    { id: 'sws_pap', roomId: 'maint', type: 'pack_a_punch', x: 19.8 * G, y: 30.2 * G, cost: 1850, label: '超武改造台' },
    { id: 'sws_shop2', roomId: 'courtyard', type: 'armory_kiosk', x: 30.6 * G, y: 30.2 * G, cost: 0, label: '军火终端 [B]' },
  ],
  barrels: [
    { x: 30.0 * G, y: 15.2 * G, roomId: 'lobby' },
    { x: 15.8 * G, y: 23.5 * G, roomId: 'platform' },
    { x: 44.6 * G, y: 23.5 * G, roomId: 'platform' },
    { x: 41.2 * G, y: 16.8 * G, roomId: 'power_room' },
    { x: 36.8 * G, y: 34.4 * G, roomId: 'courtyard' },
  ],
});

// ============================================================================
// 第 7 关：66号荒漠空军基地（战备值班厅 + 一号重装机库 + 战略雷达中心 + 燃油调度厅 + 航空弹药库 + 主跑道停机坪）
// ============================================================================
const stageAirbase = buildArchitecturalStage({
  id: 'stage_airbase',
  index: 7,
  name: '第 7 关 · 66号荒漠空军基地',
  subtitle: '驻守战略空军重装机库与全息雷达中心，启动双联激光矩阵迎击重装尸潮！',
  wallColor: '#1b1e19',
  wallTopColor: '#4e5746',
  cols: 62,
  rows: 44,
  playerSpawnCell: { gx: 31, gy: 12 },
  helipadCell: { gx: 43, gy: 32 },
  rooms: [
    {
      id: 'lobby',
      name: '空勤战备值班厅',
      floorTheme: 'armory',
      boxes: [{ gx: 24, gy: 6, gw: 14, gh: 11 }],
      initiallyUnlocked: true,
    },
    {
      id: 'hangar_w',
      name: '一号重装运输机库',
      floorTheme: 'dock',
      boxes: [{ gx: 8, gy: 10, gw: 16, gh: 16 }],
      initiallyUnlocked: false,
    },
    {
      id: 'radar',
      name: '战略雷达指管中心',
      floorTheme: 'bunker',
      boxes: [{ gx: 38, gy: 11, gw: 14, gh: 10 }],
      initiallyUnlocked: false,
    },
    {
      id: 'fuel_bay',
      name: '中央航空燃油枢纽',
      floorTheme: 'dock',
      boxes: [{ gx: 24, gy: 17, gw: 14, gh: 9 }],
      initiallyUnlocked: false,
    },
    {
      id: 'ordnance',
      name: '航空弹药挂载库',
      floorTheme: 'armory',
      boxes: [{ gx: 11, gy: 26, gw: 16, gh: 10 }],
      initiallyUnlocked: false,
    },
    {
      id: 'courtyard',
      name: '主跑道战备停机坪',
      floorTheme: 'asphalt',
      boxes: [{ gx: 29, gy: 26, gw: 22, gh: 12 }],
      initiallyUnlocked: false,
    },
  ],
  doors: [
    { id: 'ab_d1', orientation: 'vertical', gx: 24, gy: 12, span: 3, roomA: 'lobby', roomB: 'hangar_w', unlockRoomId: 'hangar_w', cost: 560, label: '一号重装机库' },
    { id: 'ab_d2', orientation: 'vertical', gx: 38, gy: 13, span: 3, roomA: 'lobby', roomB: 'radar', unlockRoomId: 'radar', cost: 680, label: '战略雷达中心' },
    { id: 'ab_d3', orientation: 'horizontal', gx: 29, gy: 17, span: 4, roomA: 'lobby', roomB: 'fuel_bay', unlockRoomId: 'fuel_bay', cost: 620, label: '中央燃油枢纽' },
    { id: 'ab_d4', orientation: 'horizontal', gx: 16, gy: 26, span: 3, roomA: 'hangar_w', roomB: 'ordnance', unlockRoomId: 'ordnance', cost: 1080, label: '航空弹药挂载库' },
    { id: 'ab_d5', orientation: 'horizontal', gx: 24, gy: 26, span: 3, roomA: 'fuel_bay', roomB: 'ordnance', unlockRoomId: 'ordnance', cost: 1080, label: '航空弹药挂载库' },
    { id: 'ab_d6', orientation: 'horizontal', gx: 32, gy: 26, span: 4, roomA: 'fuel_bay', roomB: 'courtyard', unlockRoomId: 'courtyard', cost: 1850, label: '主跑道停机坪' },
  ],
  windows: [
    { id: 'abw1', roomId: 'lobby', orientation: 'horizontal', gx: 26, gy: 6, span: 3, outDir: 'N' },
    { id: 'abw1_e', roomId: 'lobby', orientation: 'vertical', gx: 38, gy: 7, span: 3, outDir: 'E' },
    { id: 'abw2', roomId: 'hangar_w', orientation: 'horizontal', gx: 14, gy: 10, span: 4, outDir: 'N' },
    { id: 'abw3', roomId: 'hangar_w', orientation: 'vertical', gx: 8, gy: 16, span: 4, outDir: 'W' },
    { id: 'abw4', roomId: 'radar', orientation: 'horizontal', gx: 43, gy: 11, span: 3, outDir: 'N' },
    { id: 'abw5', roomId: 'radar', orientation: 'vertical', gx: 52, gy: 15, span: 3, outDir: 'E' },
    { id: 'abw6', roomId: 'ordnance', orientation: 'vertical', gx: 11, gy: 29, span: 3, outDir: 'W' },
    { id: 'abw7', roomId: 'ordnance', orientation: 'horizontal', gx: 17, gy: 36, span: 3, outDir: 'S' },
    { id: 'abw8', roomId: 'courtyard', orientation: 'vertical', gx: 51, gy: 30, span: 3, outDir: 'E' },
    { id: 'abw9', roomId: 'courtyard', orientation: 'horizontal', gx: 38, gy: 38, span: 4, outDir: 'S' },
  ],
  props: [
    // 空勤战备值班厅：战术简报桌与飞行员装备柜
    { id: 'abp1', roomId: 'lobby', kind: 'desk', x: 27.6 * G, y: 11.4 * G, w: 88, h: 52, blocksBullets: false },
    { id: 'abp2', roomId: 'lobby', kind: 'lockers', x: 33.2 * G, y: 7.2 * G, w: 90, h: 42, blocksBullets: true },
    // 一号重装运输机库：两辆 6x6 重装军用运输卡车、机库叉车与空投集装箱
    { id: 'abp3', roomId: 'hangar_w', kind: 'military_truck', x: 14.2 * G, y: 15.2 * G, w: 156, h: 76, rotation: 0.08, blocksBullets: true },
    { id: 'abp4', roomId: 'hangar_w', kind: 'container', x: 19.6 * G, y: 20.8 * G, w: 152, h: 80, rotation: -0.06, blocksBullets: true },
    { id: 'abp5', roomId: 'hangar_w', kind: 'forklift', x: 12.2 * G, y: 22.4 * G, w: 96, h: 52, rotation: -0.3, blocksBullets: false },
    // 战略雷达指管中心：中央全息雷达沙盘主控台与加密机柜
    { id: 'abp6', roomId: 'radar', kind: 'radar_console', x: 45.2 * G, y: 16.2 * G, w: 96, h: 96, blocksBullets: false },
    { id: 'abp7', roomId: 'radar', kind: 'lockers', x: 49.4 * G, y: 12.2 * G, w: 88, h: 42, blocksBullets: true },
    // 中央航空燃油枢纽：军用补给木箱与监控台
    { id: 'abp8', roomId: 'fuel_bay', kind: 'crates', x: 26.8 * G, y: 21.2 * G, w: 68, h: 68, blocksBullets: true },
    { id: 'abp9', roomId: 'fuel_bay', kind: 'desk', x: 35.2 * G, y: 21.2 * G, w: 84, h: 50, blocksBullets: false },
    // 航空弹药挂载库：战术导弹发射巢与重火器军火箱
    { id: 'abp10', roomId: 'ordnance', kind: 'missile_pod', x: 16.4 * G, y: 31.2 * G, w: 92, h: 92, blocksBullets: true },
    { id: 'abp11', roomId: 'ordnance', kind: 'crates', x: 23.6 * G, y: 33.2 * G, w: 68, h: 68, blocksBullets: true },
    // 主跑道战备停机坪：军用装甲卡车与战地救护车
    { id: 'abp12', roomId: 'courtyard', kind: 'military_truck', x: 34.0 * G, y: 33.2 * G, w: 154, h: 74, rotation: -0.16, blocksBullets: true },
    { id: 'abp13', roomId: 'courtyard', kind: 'swat_van', x: 47.4 * G, y: 28.0 * G, w: 146, h: 80, rotation: 2.85, blocksBullets: true },
  ],
  stations: [
    { id: 'abs_shop1', roomId: 'lobby', type: 'armory_kiosk', x: 35.2 * G, y: 14.8 * G, cost: 0, label: '军火终端 [B]' },
    { id: 'abs_air', roomId: 'lobby', type: 'starter_airdrop', x: 26.8 * G, y: 14.8 * G, cost: 0, weaponId: 'autoshotgun', label: '连喷空投' },
    { id: 'abs_dog', roomId: 'hangar_w', type: 'mech_dog_cage', x: 20.8 * G, y: 12.2 * G, cost: 580, label: '释放军用机械犬' },
    { id: 'abs_ammo', roomId: 'hangar_w', type: 'ammo_box', x: 11.4 * G, y: 12.2 * G, cost: 220, label: '机库弹药柜' },
    { id: 'abs_laser1', roomId: 'radar', type: 'laser_trap', x: 41.2 * G, y: 18.0 * G, cost: 300, label: '防空激光塔' },
    { id: 'abs_vend', roomId: 'fuel_bay', type: 'vending_machine', x: 31.0 * G, y: 21.2 * G, cost: 240, label: '空勤补给机' },
    { id: 'abs_pap', roomId: 'ordnance', type: 'pack_a_punch', x: 22.4 * G, y: 29.4 * G, cost: 1850, label: '超武改造台' },
    { id: 'abs_laser2', roomId: 'courtyard', type: 'laser_trap', x: 37.8 * G, y: 29.8 * G, cost: 320, label: '跑道哨戒激光' },
    { id: 'abs_shop2', roomId: 'courtyard', type: 'armory_kiosk', x: 31.4 * G, y: 28.6 * G, cost: 0, label: '军火终端 [B]' },
  ],
  barrels: [
    { x: 31.2 * G, y: 14.6 * G, roomId: 'lobby' },
    { x: 16.4 * G, y: 18.6 * G, roomId: 'hangar_w' },
    { x: 28.6 * G, y: 23.8 * G, roomId: 'fuel_bay' },
    { x: 33.4 * G, y: 18.8 * G, roomId: 'fuel_bay' },
    { x: 19.8 * G, y: 33.6 * G, roomId: 'ordnance' },
    { x: 47.6 * G, y: 35.4 * G, roomId: 'courtyard' },
  ],
});

// ============================================================================
// 第 8 关：零号核能地堡核心（北向气闸通道 + 战略核指控主厅 + 东西双洲际导弹发射井 + 聚变反应堆 + 重装试验场 + 地表装甲升降坪）
// ============================================================================
const stageBunker = buildArchitecturalStage({
  id: 'stage_bunker',
  index: 8,
  name: '第 8 关 · 零号核能地堡核心',
  subtitle: '终局禁区！死守地下洲际导弹发射井与战略指控核心，迎战最高强度深渊尸潮！',
  wallColor: '#141118',
  wallTopColor: '#4c3e52',
  cols: 62,
  rows: 44,
  playerSpawnCell: { gx: 31, gy: 20 },
  helipadCell: { gx: 31, gy: 32 },
  rooms: [
    {
      id: 'lobby',
      name: '战略核指控主厅',
      floorTheme: 'bunker',
      boxes: [
        { gx: 23, gy: 15, gw: 16, gh: 11 },
        { gx: 27, gy: 5, gw: 8, gh: 10 },
      ],
      initiallyUnlocked: true,
    },
    {
      id: 'silo_w',
      name: '一号洲际导弹井',
      floorTheme: 'bunker',
      boxes: [{ gx: 9, gy: 11, gw: 14, gh: 9 }],
      initiallyUnlocked: false,
    },
    {
      id: 'silo_e',
      name: '二号洲际导弹井',
      floorTheme: 'bunker',
      boxes: [{ gx: 39, gy: 11, gw: 14, gh: 9 }],
      initiallyUnlocked: false,
    },
    {
      id: 'reactor',
      name: '聚变反应堆冷却室',
      floorTheme: 'lab',
      boxes: [{ gx: 9, gy: 21, gw: 14, gh: 12 }],
      initiallyUnlocked: false,
    },
    {
      id: 'armory_s',
      name: '末日重装武器试验场',
      floorTheme: 'armory',
      boxes: [{ gx: 39, gy: 21, gw: 14, gh: 12 }],
      initiallyUnlocked: false,
    },
    {
      id: 'courtyard',
      name: '地表装甲升降停机坪',
      floorTheme: 'asphalt',
      boxes: [{ gx: 23, gy: 26, gw: 16, gh: 12 }],
      initiallyUnlocked: false,
    },
  ],
  doors: [
    { id: 'bk_d1', orientation: 'vertical', gx: 23, gy: 15, span: 3, roomA: 'lobby', roomB: 'silo_w', unlockRoomId: 'silo_w', cost: 620, label: '一号洲际导弹井' },
    { id: 'bk_d2', orientation: 'vertical', gx: 39, gy: 15, span: 3, roomA: 'lobby', roomB: 'silo_e', unlockRoomId: 'silo_e', cost: 620, label: '二号洲际导弹井' },
    { id: 'bk_d3', orientation: 'vertical', gx: 23, gy: 22, span: 3, roomA: 'lobby', roomB: 'reactor', unlockRoomId: 'reactor', cost: 980, label: '聚变反应堆室' },
    { id: 'bk_d4', orientation: 'vertical', gx: 39, gy: 22, span: 3, roomA: 'lobby', roomB: 'armory_s', unlockRoomId: 'armory_s', cost: 1100, label: '重装武器试验场' },
    { id: 'bk_d5', orientation: 'horizontal', gx: 29, gy: 26, span: 4, roomA: 'lobby', roomB: 'courtyard', unlockRoomId: 'courtyard', cost: 1950, label: '装甲升降停机坪' },
    { id: 'bk_d6', orientation: 'vertical', gx: 23, gy: 28, span: 3, roomA: 'reactor', roomB: 'courtyard', unlockRoomId: 'courtyard', cost: 1950, label: '装甲升降停机坪' },
    { id: 'bk_d7', orientation: 'vertical', gx: 39, gy: 28, span: 3, roomA: 'armory_s', roomB: 'courtyard', unlockRoomId: 'courtyard', cost: 1950, label: '装甲升降停机坪' },
  ],
  windows: [
    { id: 'bkw1', roomId: 'lobby', orientation: 'horizontal', gx: 29, gy: 5, span: 4, outDir: 'N' },
    { id: 'bkw1_w', roomId: 'lobby', orientation: 'vertical', gx: 27, gy: 7, span: 3, outDir: 'W' },
    { id: 'bkw1_e', roomId: 'lobby', orientation: 'vertical', gx: 35, gy: 7, span: 3, outDir: 'E' },
    { id: 'bkw2', roomId: 'silo_w', orientation: 'horizontal', gx: 14, gy: 11, span: 4, outDir: 'N' },
    { id: 'bkw3', roomId: 'silo_w', orientation: 'vertical', gx: 9, gy: 14, span: 3, outDir: 'W' },
    { id: 'bkw4', roomId: 'silo_e', orientation: 'horizontal', gx: 44, gy: 11, span: 4, outDir: 'N' },
    { id: 'bkw5', roomId: 'silo_e', orientation: 'vertical', gx: 53, gy: 14, span: 3, outDir: 'E' },
    { id: 'bkw6', roomId: 'reactor', orientation: 'vertical', gx: 9, gy: 25, span: 3, outDir: 'W' },
    { id: 'bkw7', roomId: 'reactor', orientation: 'horizontal', gx: 14, gy: 33, span: 3, outDir: 'S' },
    { id: 'bkw8', roomId: 'armory_s', orientation: 'vertical', gx: 53, gy: 25, span: 3, outDir: 'E' },
    { id: 'bkw9', roomId: 'armory_s', orientation: 'horizontal', gx: 45, gy: 33, span: 3, outDir: 'S' },
    { id: 'bkw10', roomId: 'courtyard', orientation: 'horizontal', gx: 29, gy: 38, span: 4, outDir: 'S' },
  ],
  props: [
    // 战略核指控主厅：中央全息核战略雷达沙盘与两侧加密控制台
    { id: 'bkp1', roomId: 'lobby', kind: 'radar_console', x: 31.0 * G, y: 18.2 * G, w: 94, h: 94, blocksBullets: false },
    { id: 'bkp2', roomId: 'lobby', kind: 'desk', x: 25.8 * G, y: 18.2 * G, w: 84, h: 50, rotation: Math.PI / 2, blocksBullets: false },
    { id: 'bkp3', roomId: 'lobby', kind: 'desk', x: 36.2 * G, y: 18.2 * G, w: 84, h: 50, rotation: -Math.PI / 2, blocksBullets: false },
    // 一号与二号洲际导弹发射井：四联装核弹头垂发井盖与防爆集装箱
    { id: 'bkp4', roomId: 'silo_w', kind: 'missile_pod', x: 16.0 * G, y: 15.6 * G, w: 100, h: 100, blocksBullets: true },
    { id: 'bkp5', roomId: 'silo_w', kind: 'crates', x: 11.4 * G, y: 18.0 * G, w: 66, h: 66, blocksBullets: true },
    { id: 'bkp6', roomId: 'silo_e', kind: 'missile_pod', x: 46.0 * G, y: 15.6 * G, w: 100, h: 100, blocksBullets: true },
    { id: 'bkp7', roomId: 'silo_e', kind: 'crates', x: 50.6 * G, y: 18.0 * G, w: 66, h: 66, blocksBullets: true },
    // 聚变反应堆冷却室：高能低温冷却舱阵列与监控机柜
    { id: 'bkp8', roomId: 'reactor', kind: 'cryo_pod', x: 14.2 * G, y: 25.2 * G, w: 82, h: 82, blocksBullets: false },
    { id: 'bkp9', roomId: 'reactor', kind: 'cryo_pod', x: 18.6 * G, y: 28.8 * G, w: 82, h: 82, blocksBullets: false },
    { id: 'bkp10', roomId: 'reactor', kind: 'lockers', x: 13.0 * G, y: 22.1 * G, w: 88, h: 42, blocksBullets: true },
    // 末日重装武器试验场：导弹发射巢、军火集装箱与雷达测试台
    { id: 'bkp11', roomId: 'armory_s', kind: 'container', x: 46.2 * G, y: 26.8 * G, w: 148, h: 78, rotation: 0.06, blocksBullets: true },
    { id: 'bkp12', roomId: 'armory_s', kind: 'lockers', x: 43.2 * G, y: 22.1 * G, w: 90, h: 42, blocksBullets: true },
    // 地表装甲升降停机坪：重装军用卡车与掩体箱
    { id: 'bkp13', roomId: 'courtyard', kind: 'military_truck', x: 26.4 * G, y: 34.6 * G, w: 146, h: 72, rotation: -0.2, blocksBullets: true },
    { id: 'bkp14', roomId: 'courtyard', kind: 'crates', x: 36.4 * G, y: 35.2 * G, w: 66, h: 66, blocksBullets: true },
  ],
  stations: [
    { id: 'bks_shop1', roomId: 'lobby', type: 'armory_kiosk', x: 36.2 * G, y: 23.6 * G, cost: 0, label: '军火终端 [B]' },
    { id: 'bks_air', roomId: 'lobby', type: 'starter_airdrop', x: 25.8 * G, y: 23.6 * G, cost: 0, weaponId: 'plasma', label: '等离子炮空投' },
    { id: 'bks_dog', roomId: 'silo_w', type: 'mech_dog_cage', x: 20.2 * G, y: 12.6 * G, cost: 580, label: '激活重装战犬' },
    { id: 'bks_laser1', roomId: 'silo_e', type: 'laser_trap', x: 41.8 * G, y: 12.8 * G, cost: 300, label: '导弹井防卫激光' },
    { id: 'bks_vend', roomId: 'reactor', type: 'vending_machine', x: 19.6 * G, y: 23.6 * G, cost: 240, label: '地堡战备补给机' },
    { id: 'bks_ammo', roomId: 'reactor', type: 'ammo_box', x: 12.2 * G, y: 30.2 * G, cost: 220, label: '弹药补给箱' },
    { id: 'bks_pap', roomId: 'armory_s', type: 'pack_a_punch', x: 48.8 * G, y: 22.8 * G, cost: 1850, label: '终极超武改造舱' },
    { id: 'bks_laser2', roomId: 'armory_s', type: 'laser_trap', x: 42.6 * G, y: 30.4 * G, cost: 320, label: '试验场激光矩阵' },
    { id: 'bks_shop2', roomId: 'courtyard', type: 'armory_kiosk', x: 36.0 * G, y: 28.2 * G, cost: 0, label: '军火终端 [B]' },
  ],
  barrels: [
    { x: 31.0 * G, y: 12.2 * G, roomId: 'lobby' },
    { x: 19.8 * G, y: 16.8 * G, roomId: 'silo_w' },
    { x: 42.2 * G, y: 16.8 * G, roomId: 'silo_e' },
    { x: 16.0 * G, y: 30.8 * G, roomId: 'reactor' },
    { x: 49.6 * G, y: 30.8 * G, roomId: 'armory_s' },
    { x: 26.2 * G, y: 29.2 * G, roomId: 'courtyard' },
  ],
});

export const TUTORIAL_STAGE: StageDef = {
  ...buildArchitecturalStage({
    id: 'stage_tutorial',
    index: 1,
    name: '新兵全武器实战靶场',
    subtitle: '2波极速教学 · 全15把武器&超武免费爽玩 · 击败尸王登机撤离',
    wallColor: '#334155',
    wallTopColor: '#1e293b',
    cols: 28,
    rows: 20,
    playerSpawnCell: { gx: 9, gy: 10 },
    helipadCell: { gx: 19, gy: 10 },
    rooms: [
      {
        id: 'lobby',
        name: '实战教学靶场',
        floorTheme: 'lobby',
        boxes: [{ gx: 5, gy: 6, gw: 9, gh: 8 }],
        initiallyUnlocked: true,
      },
      {
        id: 'courtyard',
        name: '撤离停机坪',
        floorTheme: 'asphalt',
        boxes: [{ gx: 14, gy: 6, gw: 9, gh: 8 }],
        initiallyUnlocked: false,
      },
    ],
    doors: [
      {
        id: 'tut_d1',
        orientation: 'vertical',
        gx: 14,
        gy: 9,
        span: 3,
        roomA: 'lobby',
        roomB: 'courtyard',
        unlockRoomId: 'courtyard',
        cost: 100,
        label: '撤离停机坪',
      },
    ],
    windows: [
      { id: 'tut_w1', roomId: 'lobby', orientation: 'horizontal', gx: 8, gy: 6, span: 3, outDir: 'N' },
      { id: 'tut_w2', roomId: 'lobby', orientation: 'vertical', gx: 5, gy: 9, span: 3, outDir: 'W' },
      { id: 'tut_w3', roomId: 'courtyard', orientation: 'vertical', gx: 23, gy: 9, span: 3, outDir: 'E' },
      { id: 'tut_w4', roomId: 'courtyard', orientation: 'horizontal', gx: 17, gy: 14, span: 3, outDir: 'S' },
    ],
    props: [
      { id: 'tut_p1', roomId: 'lobby', kind: 'desk', x: 10.0 * G, y: 12.4 * G, w: 96, h: 48, blocksBullets: false },
    ],
    stations: [
      { id: 'tut_shop', roomId: 'lobby', type: 'armory_kiosk', x: 8.0 * G, y: 7.7 * G, cost: 0, label: '全武器免费试用 [B]' },
      { id: 'tut_pap', roomId: 'lobby', type: 'pack_a_punch', x: 11.8 * G, y: 7.7 * G, cost: 0, label: '免费超武改造' },
      { id: 'tut_ammo', roomId: 'lobby', type: 'ammo_box', x: 6.8 * G, y: 12.5 * G, cost: 0, label: '免费弹药箱' },
    ],
    barrels: [
      { x: 12.4 * G, y: 10.2 * G, roomId: 'lobby' },
      { x: 16.2 * G, y: 7.8 * G, roomId: 'courtyard' },
    ],
  }),
  isTutorial: true,
  totalWaves: 2,
};

export const STAGES: StageDef[] = [
  stagePolice,
  stageMall,
  stageLab,
  stageHospital,
  stageHarbor,
  stageSubway,
  stageAirbase,
  stageBunker,
];
