import { POWERUP_META } from '../data/perksAndRelics';
import { WEAPONS } from '../data/weapons';
import { SaveManager } from '../meta/SaveManager';
import { FloorTheme, PropKind, Rect } from '../types';
import { Assets, SpriteKey, TileKey } from './AssetLoader';
import { RunSnapshot, ZombieKind } from './Entities';
import { InputManager } from './InputManager';

const ZOMBIE_SPRITE_MAP: Record<ZombieKind, SpriteKey> = {
  walker: 'zombie_walker',
  runner: 'zombie_runner',
  spitter: 'zombie_spitter',
  thief: 'zombie_thief',
  miniboss: 'zombie_miniboss',
  boss: 'zombie_boss',
};

const FLOOR_THEME_TILE: Record<FloorTheme, TileKey> = {
  lobby: 'tile_floor_lobby',
  armory: 'tile_floor_armory',
  lab: 'tile_floor_lab',
  mall: 'tile_floor_mall',
  asphalt: 'tile_asphalt',
};

const PROP_SPRITE_MAP: Record<PropKind, SpriteKey> = {
  desk: 'prop_desk',
  crates: 'prop_crates',
  swat_van: 'prop_swat_van',
  fountain: 'prop_fountain',
  police_car: 'prop_police_car',
  sofa: 'prop_sofa',
  lockers: 'prop_lockers',
  cryo_pod: 'prop_cryo_pod',
  arcade: 'prop_arcade',
};

const MAP_PAD = 640;

function hash2D(x: number, y: number, seed = 1337): number {
  let h = (Math.imul(Math.floor(x), 374761393) + Math.imul(Math.floor(y), 668265263) + seed) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function shadeHex(hex: string, delta: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return hex;
  const r = Math.max(0, Math.min(255, parseInt(clean.slice(0, 2), 16) + delta));
  const g = Math.max(0, Math.min(255, parseInt(clean.slice(2, 4), 16) + delta));
  const b = Math.max(0, Math.min(255, parseInt(clean.slice(4, 6), 16) + delta));
  return `rgb(${r}, ${g}, ${b})`;
}

function pointInAnyRect(px: number, py: number, rects: Rect[], pad = 0): boolean {
  for (const r of rects) {
    if (px >= r.x - pad && px <= r.x + r.w + pad && py >= r.y - pad && py <= r.y + r.h + pad) {
      return true;
    }
  }
  return false;
}

export class CartoonRenderer {
  // 静态世界地图离屏烘焙缓存（包含多层立体墙体、四向环境光遮蔽AO、室内战术灯光、线缆、防爆地垫与户外工事，零帧率损耗！）
  private mapCanvas: HTMLCanvasElement | null = null;
  private mapOriginX = 0;
  private mapOriginY = 0;
  private cachedStageId = '';
  private cachedMapRevision = -1;

  // 描边文字微缓存
  private labelCache = new Map<string, HTMLCanvasElement>();

  // 当前帧视口世界坐标边界（用于实体视锥剔除 Frustum Culling）
  private vLeft = 0;
  private vTop = 0;
  private vRight = 0;
  private vBottom = 0;

  private inView(x: number, y: number, margin = 90): boolean {
    return (
      x >= this.vLeft - margin &&
      x <= this.vRight + margin &&
      y >= this.vTop - margin &&
      y <= this.vBottom + margin
    );
  }

  public render(
    ctx: CanvasRenderingContext2D,
    viewW: number,
    viewH: number,
    state: RunSnapshot,
    input: InputManager
  ): void {
    this.ensureStaticMapCache(state);

    const zoom = state.camera.zoom;
    const shakeX = state.camera.shake > 0 ? (Math.random() - 0.5) * state.camera.shake * 12 : 0;
    const shakeY = state.camera.shake > 0 ? (Math.random() - 0.5) * state.camera.shake * 12 : 0;
    const camX = state.camera.x - shakeX;
    const camY = state.camera.y - shakeY;

    const halfW = viewW / (2 * zoom);
    const halfH = viewH / (2 * zoom);
    this.vLeft = camX - halfW;
    this.vRight = camX + halfW;
    this.vTop = camY - halfH;
    this.vBottom = camY + halfH;

    ctx.save();
    ctx.translate(viewW / 2, viewH / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-camX, -camY);

    // 1. 单次极速 Blit 预烘焙的高精度立体战术地图
    this.blitStaticMapViewport(ctx);

    // 2. 地面爆汁贴花与冒泡腐蚀毒潭
    this.drawDecals(ctx, state);

    // 3. 停机坪标志 & 直升机撤离光圈
    this.drawHelipad(ctx, state);

    // 4. 90° 纯正俯视高精度互动站点设备
    this.drawStations(ctx, state);

    // 5. 立体防爆钢门与钉木板破窗防线
    this.drawWindowsAndDoors(ctx, state);

    // 6. 掉落物、空投武器箱、做旧工业爆炸红油桶
    this.drawDropsAndChests(ctx, state);
    this.drawBarrels(ctx, state);

    // 7. 自动机枪塔与机械警犬伙伴
    this.drawTurretsAndDog(ctx, state);

    // 8. 纯正俯视角动态步态僵尸群与酸液弹
    this.drawZombies(ctx, state);
    this.drawSpits(ctx, state);

    // 9. 特种部队主角（夜视仪头盔躯干 + 战术护肘双臂 + 9把枪械俯视建模 + 枪口地面火光）
    this.drawPlayer(ctx, state);

    // 10. 抛物线手雷、流光曳光弹、闪电链、粒子与跳字
    this.drawGrenades(ctx, state);
    this.drawBulletsAndFX(ctx, state);

    ctx.restore();

    // 11. 屏幕层：雷达小地图（手机端自动避让左拇指摇杆区）、屏幕外目标箭头、触屏双摇杆
    this.drawTacticalMinimap(ctx, viewW, viewH, state, input.usingTouch);
    this.drawOffscreenIndicators(ctx, viewW, viewH, state);
    this.drawTouchSticks(ctx, viewW, viewH, state, input);
  }

  // ==================== 离屏高精度建筑地图烘焙（仅在开局与开门瞬间执行 1 次） ====================

  private ensureStaticMapCache(state: RunSnapshot): void {
    if (
      this.mapCanvas &&
      this.cachedStageId === state.stage.id &&
      this.cachedMapRevision === state.mapRevision
    ) {
      return;
    }

    this.cachedStageId = state.stage.id;
    this.cachedMapRevision = state.mapRevision;

    const bb = state.stage.buildingBounds;
    this.mapOriginX = bb.x - MAP_PAD;
    this.mapOriginY = bb.y - MAP_PAD;
    const totalW = bb.w + MAP_PAD * 2;
    const totalH = bb.h + MAP_PAD * 2;

    if (!this.mapCanvas) {
      this.mapCanvas = document.createElement('canvas');
    }
    if (this.mapCanvas.width !== totalW || this.mapCanvas.height !== totalH) {
      this.mapCanvas.width = totalW;
      this.mapCanvas.height = totalH;
    }

    const mctx = this.mapCanvas.getContext('2d')!;
    const allRoomRects: Rect[] = [];
    for (const rm of state.rooms) {
      for (const r of rm.rects) allRoomRects.push(r);
    }

    mctx.save();
    mctx.clearRect(0, 0, totalW, totalH);
    mctx.translate(-this.mapOriginX, -this.mapOriginY);

    // A. 末世暗调苔藓荒地背景 + 自然明暗斑驳层（彻底消除平铺重复感）
    const grassPat = Assets.getPattern(mctx, 'tile_grass', 0.74);
    mctx.fillStyle = grassPat || '#1e3124';
    mctx.fillRect(this.mapOriginX, this.mapOriginY, totalW, totalH);

    const stageSeed = state.stage.index * 9173;
    for (let py = this.mapOriginY + 80; py < this.mapOriginY + totalH - 80; py += 150) {
      for (let px = this.mapOriginX + 80; px < this.mapOriginX + totalW - 80; px += 150) {
        const jx = px + (hash2D(px, py, stageSeed) - 0.5) * 110;
        const jy = py + (hash2D(py, px, stageSeed + 7) - 0.5) * 110;
        if (pointInAnyRect(jx, jy, allRoomRects, 55)) continue;
        const rad = 65 + hash2D(px, py, stageSeed + 19) * 85;
        const g = mctx.createRadialGradient(jx, jy, 6, jx, jy, rad);
        const darkPatch = hash2D(px, py, stageSeed + 31) > 0.45;
        g.addColorStop(0, darkPatch ? 'rgba(6, 12, 10, 0.26)' : 'rgba(42, 68, 44, 0.16)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        mctx.fillStyle = g;
        mctx.beginPath();
        mctx.arc(jx, jy, rad, 0, Math.PI * 2);
        mctx.fill();
      }
    }

    // B. 建筑整体厚重接地大投影 + 户外钢筋混凝土战备护坡道与路缘石
    mctx.fillStyle = 'rgba(2, 6, 23, 0.48)';
    for (const r of allRoomRects) {
      mctx.beginPath();
      mctx.roundRect(r.x - 42, r.y - 38, r.w + 98, r.h + 94, 22);
      mctx.fill();
    }
    mctx.fillStyle = 'rgba(2, 6, 23, 0.34)';
    for (const r of allRoomRects) {
      mctx.beginPath();
      mctx.roundRect(r.x - 48, r.y - 44, r.w + 104, r.h + 100, 24);
      mctx.fill();
    }

    // 户外外圈混凝土路基与路缘石高光/切缝
    const asphaltPat = Assets.getPattern(mctx, 'tile_asphalt', 0.68);
    for (const r of allRoomRects) {
      mctx.save();
      mctx.beginPath();
      mctx.roundRect(r.x - 42, r.y - 42, r.w + 84, r.h + 84, 14);
      mctx.fillStyle = asphaltPat || '#2c3543';
      mctx.fill();
      mctx.lineWidth = 4;
      mctx.strokeStyle = '#0f172a';
      mctx.stroke();
      mctx.lineWidth = 1.6;
      mctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
      mctx.strokeRect(r.x - 39, r.y - 39, r.w + 78, r.h + 78);
      mctx.restore();
    }

    // B2. 户外环城沥青公路、废弃巡逻警车封锁线、街灯与丧尸突袭泥泞通道
    this.bakeExteriorSiegeDetails(mctx, state, allRoomRects, stageSeed);

    // B3. 第 3 关专属：双连廊中央围合地下反应堆深渊涡轮天井（消除中庭草地违和感！）
    if (state.stage.id === 'stage_lab') {
      this.bakeLabCentralAbyssShaft(mctx, state.stage.cellSize);
    }

    // C. 各房间高精度石材/钢板/实验室地砖 + 内嵌地脚线 + 战术标线 + 场景叙事细节 + 地面动力线缆
    for (const room of state.rooms) {
      const tileKey = FLOOR_THEME_TILE[room.floorTheme];
      const pat = Assets.getPattern(mctx, tileKey, 0.68);

      mctx.save();
      mctx.beginPath();
      for (const r of room.rects) {
        mctx.rect(r.x, r.y, r.w, r.h);
      }
      mctx.clip();

      for (const r of room.rects) {
        mctx.fillStyle = pat || '#475569';
        mctx.fillRect(r.x, r.y, r.w, r.h);

        // 房间内侧战术装饰地垫/地砖缝隙/警戒标线/地漏格栅
        this.bakeRoomFloorMarkings(mctx, room.floorTheme, r, stageSeed);
      }

      if (room.unlocked) {
        // 房间专属真实感场景叙事细节（警徽地毯/牢房分区线/快餐黑白棋盘地砖/电玩霓虹地毯/冷冻管线/散落卷宗/防滑门垫）
        this.bakeRoomStorytellingDetails(mctx, room, state, stageSeed);

        // 站点连接至最近墙体的橡胶护线槽电缆（让军火终端与改造台真正锚定在地面建筑中！）
        for (const st of state.stations) {
          if (st.roomId !== room.id) continue;
          if (st.type === 'starter_airdrop' || st.type === 'ammo_box') continue;
          this.bakeStationFloorCable(mctx, st.x, st.y, room.rects);
        }

        // 四向立体墙根环境光遮蔽（4-Sided Wall Contact AO）——赋予室内极强的立体空间纵深！
        this.bakeWallAmbientOcclusion(mctx, state.walls);

        // 顶部战术吊灯柔和暖白/冷白光池 + 互动设施地面环境反光
        this.bakeRoomTacticalLighting(mctx, room, state);

        // 低调蚀刻地面战术区域编号与名称水印
        mctx.font = '900 17px system-ui, sans-serif';
        mctx.textAlign = 'center';
        mctx.textBaseline = 'middle';
        mctx.fillStyle = 'rgba(2, 6, 23, 0.34)';
        mctx.fillText(room.name, room.labelPos.x + 1, room.labelPos.y + 1.5);
        mctx.fillStyle =
          room.floorTheme === 'lobby'
            ? 'rgba(15, 23, 42, 0.24)'
            : 'rgba(226, 232, 240, 0.16)';
        mctx.fillText(room.name, room.labelPos.x, room.labelPos.y);
      } else {
        // 未解锁区域：深邃战术蓝图迷雾 + 扫描斜纹 + 锁定徽章
        mctx.fillStyle = 'rgba(7, 11, 22, 0.84)';
        for (const r of room.rects) {
          mctx.fillRect(r.x, r.y, r.w, r.h);
        }
        const minX = Math.min(...room.rects.map((r) => r.x));
        const minY = Math.min(...room.rects.map((r) => r.y));
        const maxX = Math.max(...room.rects.map((r) => r.x + r.w));
        const maxY = Math.max(...room.rects.map((r) => r.y + r.h));

        mctx.strokeStyle = 'rgba(56, 189, 248, 0.07)';
        mctx.lineWidth = 1;
        mctx.beginPath();
        for (let gx = minX; gx <= maxX; gx += 28) {
          mctx.moveTo(gx, minY);
          mctx.lineTo(gx, maxY);
        }
        for (let gy = minY; gy <= maxY; gy += 28) {
          mctx.moveTo(minX, gy);
          mctx.lineTo(maxX, gy);
        }
        mctx.stroke();

        this.bakeWallAmbientOcclusion(mctx, state.walls);
        this.drawCachedLabel(mctx, `🔒 未开启 · ${room.name}`, room.labelPos.x, room.labelPos.y, '#94a3b8', 15);
      }
      mctx.restore();
    }

    // D. 门框与窗框底部嵌入式防滑钢制门槛踏板（Threshold Plates）
    for (const door of state.doors) {
      this.bakeSteelThreshold(mctx, door.x, door.y, door.w, door.h, door.orientation);
    }
    for (const win of state.windows) {
      this.bakeSteelThreshold(mctx, win.x, win.y, win.w, win.h, win.orientation);
    }

    // E. 室内静态战术掩体家具（双层柔和接地阴影 + 警车/喷泉环境光晕 + 90°高清俯视贴图）
    for (const pr of state.props) {
      const room = state.rooms.find((r) => r.id === pr.roomId);
      if (!room?.unlocked) continue;
      const spKey = PROP_SPRITE_MAP[pr.kind];
      const img = Assets.getSprite(spKey);

      mctx.save();
      mctx.translate(pr.x, pr.y);
      if (pr.rotation) mctx.rotate(pr.rotation);

      // 车辆警灯/前大灯、喷泉/冷冻舱冷光、街机霓虹环境反光
      if (pr.kind === 'swat_van' || pr.kind === 'police_car') {
        const rg = mctx.createRadialGradient(4, -22, 4, 4, -22, 68);
        rg.addColorStop(0, 'rgba(239, 68, 68, 0.25)');
        rg.addColorStop(1, 'rgba(239, 68, 68, 0)');
        mctx.fillStyle = rg;
        mctx.fillRect(-72, -92, 150, 140);

        const bg = mctx.createRadialGradient(4, 22, 4, 4, 22, 68);
        bg.addColorStop(0, 'rgba(59, 130, 246, 0.25)');
        bg.addColorStop(1, 'rgba(59, 130, 246, 0)');
        mctx.fillStyle = bg;
        mctx.fillRect(-72, -45, 150, 140);

        if (pr.kind === 'police_car') {
          // 巡逻警车车头双束暖白近光灯锥
          const hg = mctx.createLinearGradient(pr.w * 0.42, 0, pr.w * 0.42 + 125, 0);
          hg.addColorStop(0, 'rgba(254, 249, 195, 0.24)');
          hg.addColorStop(1, 'rgba(254, 249, 195, 0)');
          mctx.fillStyle = hg;
          mctx.beginPath();
          mctx.moveTo(pr.w * 0.42, -24);
          mctx.lineTo(pr.w * 0.42 + 125, -52);
          mctx.lineTo(pr.w * 0.42 + 125, 52);
          mctx.lineTo(pr.w * 0.42, 24);
          mctx.closePath();
          mctx.fill();
        }
      } else if (pr.kind === 'fountain' || pr.kind === 'cryo_pod') {
        const glowRgb = pr.kind === 'cryo_pod' ? '34, 211, 238' : '56, 189, 248';
        const fg = mctx.createRadialGradient(0, 0, pr.w * 0.18, 0, 0, pr.w * 0.82);
        fg.addColorStop(0, `rgba(${glowRgb}, ${pr.kind === 'cryo_pod' ? 0.28 : 0.16})`);
        fg.addColorStop(1, `rgba(${glowRgb}, 0)`);
        mctx.fillStyle = fg;
        mctx.beginPath();
        mctx.arc(0, 0, pr.w * 0.82, 0, Math.PI * 2);
        mctx.fill();
      } else if (pr.kind === 'arcade') {
        const ag = mctx.createRadialGradient(0, pr.h * 0.35, 6, 0, pr.h * 0.35, 76);
        ag.addColorStop(0, 'rgba(232, 121, 249, 0.22)');
        ag.addColorStop(0.55, 'rgba(34, 211, 238, 0.12)');
        ag.addColorStop(1, 'rgba(0, 0, 0, 0)');
        mctx.fillStyle = ag;
        mctx.beginPath();
        mctx.arc(0, pr.h * 0.35, 76, 0, Math.PI * 2);
        mctx.fill();
      }

      // 柔和接地 AO + 定向投影
      mctx.fillStyle = 'rgba(2, 6, 23, 0.44)';
      mctx.beginPath();
      if (pr.kind === 'fountain' || pr.kind === 'cryo_pod') {
        mctx.arc(5, 7, pr.w * 0.49, 0, Math.PI * 2);
      } else {
        mctx.roundRect(-pr.w / 2 + 5, -pr.h / 2 + 7, pr.w + 2, pr.h + 2, 10);
      }
      mctx.fill();

      const scaleMult =
        pr.kind === 'desk'
          ? 1.22
          : pr.kind === 'swat_van' || pr.kind === 'police_car'
            ? 1.12
            : pr.kind === 'sofa' || pr.kind === 'lockers' || pr.kind === 'arcade'
              ? 1.06
              : 1.08;
      const drawDim = Math.max(pr.w, pr.h) * scaleMult;
      if (img) {
        mctx.drawImage(img, -drawDim / 2, -drawDim / 2, drawDim, drawDim);
      } else {
        mctx.fillStyle = '#475569';
        mctx.fillRect(-pr.w / 2, -pr.h / 2, pr.w, pr.h);
      }
      mctx.restore();
    }

    // F. 3D 倒角装甲混凝土立体墙体 + 铆钉切缝面板 + 转角/门框重型钢柱帽
    this.bake3DArchitecturalWalls(mctx, state);

    // G. 户外远景暗角氛围压暗（聚焦建筑防线视觉中心！）
    const cx = bb.x + bb.w / 2;
    const cy = bb.y + bb.h / 2;
    const outerR = Math.hypot(totalW, totalH) * 0.52;
    const vig = mctx.createRadialGradient(cx, cy, Math.min(bb.w, bb.h) * 0.42, cx, cy, outerR);
    vig.addColorStop(0, 'rgba(2, 6, 23, 0)');
    vig.addColorStop(0.72, 'rgba(2, 6, 23, 0.14)');
    vig.addColorStop(1, 'rgba(2, 6, 23, 0.56)');
    mctx.fillStyle = vig;
    mctx.fillRect(this.mapOriginX, this.mapOriginY, totalW, totalH);

    mctx.restore();
  }

  private isNearAnyWindowLane(
    tx: number,
    ty: number,
    windows: RunSnapshot['windows'],
    minDist: number
  ): boolean {
    for (const win of windows) {
      const wcx = win.x + win.w / 2;
      const wcy = win.y + win.h / 2;
      const ox = wcx + win.spawnOutsideOffset.dx;
      const oy = wcy + win.spawnOutsideOffset.dy;
      const segDx = ox - wcx;
      const segDy = oy - wcy;
      const segLenSq = segDx * segDx + segDy * segDy || 1;
      const proj = Math.max(0, Math.min(1, ((tx - wcx) * segDx + (ty - wcy) * segDy) / segLenSq));
      const distToLane = Math.hypot(tx - (wcx + segDx * proj), ty - (wcy + segDy * proj));
      if (distToLane < minDist) {
        return true;
      }
    }
    return false;
  }

  private bakeExteriorSiegeDetails(
    mctx: CanvasRenderingContext2D,
    state: RunSnapshot,
    allRoomRects: Rect[],
    stageSeed: number
  ): void {
    const bb = state.stage.buildingBounds;
    const asphaltPat = Assets.getPattern(mctx, 'tile_asphalt', 0.68);

    // 0. 环绕建筑外围的真实城市沥青双车道封锁线（双黄虚线 + 斑马线 + 急刹轮胎印）
    const roadOffset = 148;
    const roadW = 104;
    const rx = bb.x - roadOffset;
    const ry = bb.y - roadOffset;
    const rw = bb.w + roadOffset * 2;
    const rh = bb.h + roadOffset * 2;

    mctx.save();
    mctx.strokeStyle = '#090e17';
    mctx.lineWidth = roadW + 8;
    mctx.lineJoin = 'round';
    mctx.strokeRect(rx, ry, rw, rh);

    mctx.strokeStyle = asphaltPat || '#262f3d';
    mctx.lineWidth = roadW;
    mctx.strokeRect(rx, ry, rw, rh);

    // 道路两侧做旧白实线
    mctx.strokeStyle = 'rgba(226, 232, 240, 0.24)';
    mctx.lineWidth = 2;
    mctx.strokeRect(rx - roadW * 0.43, ry - roadW * 0.43, rw + roadW * 0.86, rh + roadW * 0.86);
    mctx.strokeRect(rx + roadW * 0.43, ry + roadW * 0.43, rw - roadW * 0.86, rh - roadW * 0.86);

    // 道路中央城市交通黄虚线
    mctx.strokeStyle = 'rgba(234, 179, 8, 0.42)';
    mctx.lineWidth = 3;
    mctx.setLineDash([24, 20]);
    mctx.strokeRect(rx, ry, rw, rh);
    mctx.setLineDash([]);

    // 四向路口人行横道斑马线
    mctx.fillStyle = 'rgba(226, 232, 240, 0.22)';
    for (const cxCross of [bb.x + bb.w * 0.28, bb.x + bb.w * 0.72]) {
      for (let i = -3; i <= 3; i++) {
        mctx.fillRect(cxCross - 18, ry + i * 11 - 3, 36, 6);
        mctx.fillRect(cxCross - 18, ry + rh + i * 11 - 3, 36, 6);
      }
    }
    for (const cyCross of [bb.y + bb.h * 0.32, bb.y + bb.h * 0.68]) {
      for (let i = -3; i <= 3; i++) {
        mctx.fillRect(rx + i * 11 - 3, cyCross - 18, 6, 36);
        mctx.fillRect(rx + rw + i * 11 - 3, cyCross - 18, 6, 36);
      }
    }
    mctx.restore();

    // 1. 每扇破窗外侧：扇形散乱踩踏泥印、反光碎玻璃碴与两侧战术沙袋残骸（去除生硬直线土路，呈现四面八方围攻感！）
    for (const win of state.windows) {
      const wcx = win.x + win.w / 2;
      const wcy = win.y + win.h / 2;
      const nx = Math.sign(win.spawnOutsideOffset.dx);
      const ny = Math.sign(win.spawnOutsideOffset.dy);
      const baseOutAng = Math.atan2(ny, nx);

      // 窗外扇形不规则泥泞踩踏斑块（无固定直线路径）
      const fanCenterDist = 38;
      const fcx = wcx + nx * fanCenterDist;
      const fcy = wcy + ny * fanCenterDist;
      const breachGrad = mctx.createRadialGradient(fcx, fcy, 8, fcx, fcy, 96);
      breachGrad.addColorStop(0, 'rgba(32, 18, 16, 0.42)');
      breachGrad.addColorStop(0.55, 'rgba(22, 18, 14, 0.22)');
      breachGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      mctx.fillStyle = breachGrad;
      mctx.beginPath();
      mctx.arc(fcx, fcy, 96, 0, Math.PI * 2);
      mctx.fill();

      for (let k = 0; k < 7; k++) {
        const h1 = hash2D(wcx + k * 29, wcy, stageSeed + 41);
        const h2 = hash2D(wcy + k * 37, wcx, stageSeed + 59);
        const patchAng = baseOutAng + (h1 - 0.5) * 2.1;
        const patchDist = 36 + h2 * 105;
        const px = wcx + Math.cos(patchAng) * patchDist;
        const py = wcy + Math.sin(patchAng) * patchDist;
        if (pointInAnyRect(px, py, allRoomRects, 8)) continue;
        const pr = 14 + h1 * 18;
        const pg = mctx.createRadialGradient(px, py, 2, px, py, pr);
        pg.addColorStop(0, 'rgba(24, 16, 12, 0.28)');
        pg.addColorStop(1, 'rgba(0, 0, 0, 0)');
        mctx.fillStyle = pg;
        mctx.beginPath();
        mctx.arc(px, py, pr, 0, Math.PI * 2);
        mctx.fill();
      }

      // 窗台内外散落的反光碎玻璃碴
      for (let i = 0; i < 9; i++) {
        const s1 = hash2D(wcx + i * 13, wcy, stageSeed);
        const s2 = hash2D(wcy + i * 17, wcx, stageSeed + 5);
        const gx = wcx + (nx !== 0 ? (s1 - 0.35) * 44 * nx : (s1 - 0.5) * (win.w * 0.75));
        const gy = wcy + (ny !== 0 ? (s1 - 0.35) * 44 * ny : (s1 - 0.5) * (win.h * 0.75));
        mctx.fillStyle = i % 2 === 0 ? 'rgba(186, 230, 253, 0.45)' : 'rgba(226, 232, 240, 0.32)';
        mctx.beginPath();
        mctx.moveTo(gx, gy);
        mctx.lineTo(gx + 4 + s2 * 3, gy + 1.5);
        mctx.lineTo(gx + 1.5, gy + 4 + s1 * 3);
        mctx.closePath();
        mctx.fill();
      }

      // 窗外两侧沙袋残骸掩体 + 警戒路灯暖光池
      const perpX = ny !== 0 ? 1 : 0;
      const perpY = nx !== 0 ? 1 : 0;
      for (const side of [-1, 1]) {
        const sbx = wcx + nx * 46 + perpX * side * 68;
        const sby = wcy + ny * 46 + perpY * side * 68;
        if (!pointInAnyRect(sbx, sby, allRoomRects, 16)) {
          this.bakeSandbagCluster(mctx, sbx, sby, Math.atan2(ny, nx) + side * 0.35);
        }
      }

      const lampX = wcx + nx * 58;
      const lampY = wcy + ny * 58;
      const lg = mctx.createRadialGradient(lampX, lampY, 4, lampX, lampY, 96);
      lg.addColorStop(0, 'rgba(251, 191, 36, 0.16)');
      lg.addColorStop(0.6, 'rgba(245, 158, 11, 0.05)');
      lg.addColorStop(1, 'rgba(0, 0, 0, 0)');
      mctx.fillStyle = lg;
      mctx.beginPath();
      mctx.arc(lampX, lampY, 96, 0, Math.PI * 2);
      mctx.fill();
    }

    // 2. 公路沿线废弃封锁警车/特警车 + 高杆钠灯路灯（严格避开所有窗户冲锋通道，绝不让僵尸穿模踩车！）
    const cruiserImg = Assets.getSprite('prop_police_car');
    const vanImg = Assets.getSprite('prop_swat_van');
    const crateImg = Assets.getSprite('prop_crates');

    const roadCandidates: { x: number; y: number; baseAng: number }[] = [];
    for (let x = rx + 110; x <= rx + rw - 110; x += 240) {
      roadCandidates.push({ x, y: ry, baseAng: 0.16 });
      roadCandidates.push({ x, y: ry + rh, baseAng: Math.PI - 0.18 });
    }
    for (let y = ry + 120; y <= ry + rh - 120; y += 240) {
      roadCandidates.push({ x: rx, y, baseAng: Math.PI / 2 + 0.15 });
      roadCandidates.push({ x: rx + rw, y, baseAng: -Math.PI / 2 + 0.18 });
    }

    let placedVehicles = 0;
    for (let idx = 0; idx < roadCandidates.length; idx++) {
      const c = roadCandidates[idx];
      const hVal = hash2D(c.x, c.y, stageSeed + 311);
      if (pointInAnyRect(c.x, c.y, allRoomRects, 110)) continue;
      if (this.isNearAnyWindowLane(c.x, c.y, state.windows, 128)) continue;

      if (hVal > 0.56 && placedVehicles < 8 && (cruiserImg || vanImg)) {
        placedVehicles += 1;
        const ang = c.baseAng + (hVal - 0.5) * 0.65;
        const useVan = idx % 4 === 0 && vanImg;
        const vImg = useVan ? vanImg! : cruiserImg!;
        const vDim = useVan ? 156 : 142;

        // 急刹双道黑胎印
        mctx.save();
        mctx.translate(c.x, c.y);
        mctx.rotate(ang);
        mctx.strokeStyle = 'rgba(9, 13, 22, 0.46)';
        mctx.lineWidth = 5;
        mctx.beginPath();
        mctx.moveTo(-98, -18);
        mctx.quadraticCurveTo(-55, -24, -20, -18);
        mctx.moveTo(-98, 18);
        mctx.quadraticCurveTo(-55, 12, -20, 18);
        mctx.stroke();

        // 车头前照灯光束与红蓝顶灯反光
        const hg = mctx.createLinearGradient(45, 0, 165, 0);
        hg.addColorStop(0, 'rgba(254, 249, 195, 0.22)');
        hg.addColorStop(1, 'rgba(254, 249, 195, 0)');
        mctx.fillStyle = hg;
        mctx.beginPath();
        mctx.moveTo(45, -22);
        mctx.lineTo(165, -54);
        mctx.lineTo(165, 54);
        mctx.lineTo(45, 22);
        mctx.closePath();
        mctx.fill();

        const rg = mctx.createRadialGradient(0, -20, 3, 0, -20, 62);
        rg.addColorStop(0, 'rgba(239, 68, 68, 0.24)');
        rg.addColorStop(1, 'rgba(239, 68, 68, 0)');
        mctx.fillStyle = rg;
        mctx.fillRect(-65, -85, 130, 130);

        const bg = mctx.createRadialGradient(0, 20, 3, 0, 20, 62);
        bg.addColorStop(0, 'rgba(59, 130, 246, 0.24)');
        bg.addColorStop(1, 'rgba(59, 130, 246, 0)');
        mctx.fillStyle = bg;
        mctx.fillRect(-65, -45, 130, 130);

        mctx.fillStyle = 'rgba(2, 6, 23, 0.48)';
        mctx.beginPath();
        mctx.roundRect(-58, -28, 122, 62, 12);
        mctx.fill();

        mctx.drawImage(vImg, -vDim / 2, -vDim / 2, vDim, vDim);
        mctx.restore();

        // 车旁配套封锁拒马
        this.bakeJerseyBarrier(mctx, c.x + Math.cos(ang + 1.4) * 58, c.y + Math.sin(ang + 1.4) * 58, ang + 0.6);
      } else {
        // 公路内侧高杆路灯柱 + 暖黄钠灯光晕池
        this.bakeStreetLampPost(mctx, c.x, c.y, c.baseAng + Math.PI / 2);
      }
    }

    // 3. 户外远端荒野：针叶树林、混凝土封锁拒马与遗弃军火木箱（严格避开所有窗户冲锋通道！）
    for (let gy = bb.y - 460; gy <= bb.y + bb.h + 460; gy += 150) {
      for (let gx = bb.x - 460; gx <= bb.x + bb.w + 460; gx += 150) {
        const r1 = hash2D(gx, gy, stageSeed + 101);
        if (r1 < 0.36) continue;
        const tx = gx + (hash2D(gx, gy, stageSeed + 109) - 0.5) * 90;
        const ty = gy + (hash2D(gy, gx, stageSeed + 113) - 0.5) * 90;
        if (pointInAnyRect(tx, ty, allRoomRects, 96)) continue;
        // 避开环城公路主路面，让树丛长在公路外侧荒野与绿化带
        const onRoadX = Math.abs(tx - rx) < 58 || Math.abs(tx - (rx + rw)) < 58;
        const onRoadY = Math.abs(ty - ry) < 58 || Math.abs(ty - (ry + rh)) < 58;
        const inRoadBand =
          tx >= rx - 58 && tx <= rx + rw + 58 && ty >= ry - 58 && ty <= ry + rh + 58 && (onRoadX || onRoadY);
        if (this.isNearAnyWindowLane(tx, ty, state.windows, 96)) continue;

        if (!inRoadBand && r1 > 0.68) {
          this.bakeTopDownShrubCluster(mctx, tx, ty, 24 + r1 * 20, stageSeed + gx);
        } else if (r1 > 0.52) {
          this.bakeJerseyBarrier(mctx, tx, ty, r1 * Math.PI);
        } else if (!inRoadBand && crateImg && r1 > 0.44) {
          mctx.save();
          mctx.translate(tx, ty);
          mctx.rotate(r1 * 2.4);
          mctx.fillStyle = 'rgba(2, 6, 23, 0.44)';
          mctx.fillRect(-24, -22, 52, 52);
          mctx.drawImage(crateImg, -28, -28, 56, 56);
          mctx.restore();
        }
      }
    }
  }

  private bakeStreetLampPost(mctx: CanvasRenderingContext2D, x: number, y: number, armAngle: number): void {
    mctx.save();
    mctx.translate(x, y);
    const lx = Math.cos(armAngle) * 24;
    const ly = Math.sin(armAngle) * 24;

    const lg = mctx.createRadialGradient(lx, ly, 4, lx, ly, 108);
    lg.addColorStop(0, 'rgba(253, 224, 71, 0.2)');
    lg.addColorStop(0.55, 'rgba(245, 158, 11, 0.06)');
    lg.addColorStop(1, 'rgba(0, 0, 0, 0)');
    mctx.fillStyle = lg;
    mctx.beginPath();
    mctx.arc(lx, ly, 108, 0, Math.PI * 2);
    mctx.fill();

    // 灯杆底座与挑臂
    mctx.strokeStyle = '#090e17';
    mctx.lineWidth = 6;
    mctx.lineCap = 'round';
    mctx.beginPath();
    mctx.moveTo(0, 0);
    mctx.lineTo(lx, ly);
    mctx.stroke();

    mctx.strokeStyle = '#64748b';
    mctx.lineWidth = 3;
    mctx.stroke();

    mctx.fillStyle = '#334155';
    mctx.beginPath();
    mctx.arc(0, 0, 6, 0, Math.PI * 2);
    mctx.fill();

    mctx.fillStyle = '#fef08a';
    mctx.beginPath();
    mctx.arc(lx, ly, 4.2, 0, Math.PI * 2);
    mctx.fill();
    mctx.restore();
  }

  private bakeLabCentralAbyssShaft(mctx: CanvasRenderingContext2D, G: number): void {
    // 73号研究所西翼(gx 20..24)与东翼(gx 32..36)之间的围合中庭 (gx: 24..32, gy: 15..26)
    const sx = 24 * G;
    const sy = 15 * G;
    const sw = 8 * G;
    const sh = 11 * G;

    mctx.save();
    mctx.beginPath();
    mctx.rect(sx, sy, sw, sh);
    mctx.clip();

    // 深不见底的地下反应堆排热竖井黑蓝深渊
    const bg = mctx.createRadialGradient(sx + sw / 2, sy + sh / 2, 24, sx + sw / 2, sy + sh / 2, sh * 0.62);
    bg.addColorStop(0, '#082f49');
    bg.addColorStop(0.55, '#071324');
    bg.addColorStop(1, '#020617');
    mctx.fillStyle = bg;
    mctx.fillRect(sx, sy, sw, sh);

    // 井壁四周黄黑工程防坠警戒斜纹框
    mctx.strokeStyle = '#eab308';
    mctx.lineWidth = 10;
    mctx.strokeRect(sx + 16, sy + 16, sw - 32, sh - 32);
    mctx.strokeStyle = '#090e17';
    mctx.setLineDash([14, 14]);
    mctx.strokeRect(sx + 16, sy + 16, sw - 32, sh - 32);
    mctx.setLineDash([]);

    // 上下两座巨型工业冷却涡轮风机井口
    for (const fy of [sy + sh * 0.3, sy + sh * 0.7]) {
      const fx = sx + sw / 2;
      const fr = sw * 0.33;

      const glow = mctx.createRadialGradient(fx, fy, 8, fx, fy, fr * 1.15);
      glow.addColorStop(0, 'rgba(34, 211, 238, 0.34)');
      glow.addColorStop(0.7, 'rgba(14, 116, 144, 0.14)');
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      mctx.fillStyle = glow;
      mctx.beginPath();
      mctx.arc(fx, fy, fr * 1.15, 0, Math.PI * 2);
      mctx.fill();

      // 涡轮扇叶
      mctx.save();
      mctx.translate(fx, fy);
      for (let b = 0; b < 7; b++) {
        mctx.rotate((Math.PI * 2) / 7);
        mctx.fillStyle = '#1e293b';
        mctx.strokeStyle = '#090e17';
        mctx.lineWidth = 2;
        mctx.beginPath();
        mctx.moveTo(14, -6);
        mctx.lineTo(fr - 8, -18);
        mctx.lineTo(fr - 4, 10);
        mctx.lineTo(14, 8);
        mctx.closePath();
        mctx.fill();
        mctx.stroke();
      }
      mctx.fillStyle = '#334155';
      mctx.beginPath();
      mctx.arc(0, 0, 22, 0, Math.PI * 2);
      mctx.fill();
      mctx.stroke();

      mctx.fillStyle = '#22d3ee';
      mctx.beginPath();
      mctx.arc(0, 0, 8, 0, Math.PI * 2);
      mctx.fill();
      mctx.restore();

      // 井口十字承重钢梁
      mctx.strokeStyle = '#334155';
      mctx.lineWidth = 8;
      mctx.beginPath();
      mctx.moveTo(sx + 20, fy);
      mctx.lineTo(sx + sw - 20, fy);
      mctx.stroke();

      mctx.strokeStyle = '#475569';
      mctx.lineWidth = 5;
      mctx.beginPath();
      mctx.arc(fx, fy, fr, 0, Math.PI * 2);
      mctx.stroke();
    }

    // 贯穿竖井的纵向检修钢栈桥与红光警示灯
    mctx.fillStyle = 'rgba(30, 41, 59, 0.88)';
    mctx.strokeStyle = '#090e17';
    mctx.lineWidth = 2;
    mctx.fillRect(sx + sw / 2 - 14, sy + 18, 28, sh - 36);
    mctx.strokeRect(sx + sw / 2 - 14, sy + 18, 28, sh - 36);
    for (const ly of [sy + 48, sy + sh / 2, sy + sh - 48]) {
      mctx.fillStyle = '#ef4444';
      mctx.beginPath();
      mctx.arc(sx + sw / 2, ly, 4.5, 0, Math.PI * 2);
      mctx.fill();
    }

    mctx.restore();
  }

  private bakeSandbagCluster(mctx: CanvasRenderingContext2D, x: number, y: number, angle: number): void {
    mctx.save();
    mctx.translate(x, y);
    mctx.rotate(angle);
    mctx.fillStyle = 'rgba(2, 6, 23, 0.42)';
    mctx.beginPath();
    mctx.roundRect(-10, -20, 22, 42, 8);
    mctx.fill();

    const offsets = [
      { dx: -2, dy: -11, rot: -0.12 },
      { dx: 1, dy: 0, rot: 0.06 },
      { dx: -2, dy: 11, rot: 0.14 },
      { dx: 4, dy: -5, rot: 0.08 },
    ];
    for (const o of offsets) {
      mctx.save();
      mctx.translate(o.dx, o.dy);
      mctx.rotate(o.rot);
      mctx.fillStyle = '#6b6650';
      mctx.strokeStyle = '#1e2019';
      mctx.lineWidth = 1.8;
      mctx.beginPath();
      mctx.roundRect(-6.5, -7.5, 13, 15, 4.5);
      mctx.fill();
      mctx.stroke();
      mctx.strokeStyle = 'rgba(214, 211, 196, 0.25)';
      mctx.lineWidth = 1;
      mctx.beginPath();
      mctx.moveTo(-3, -4);
      mctx.lineTo(-3, 4);
      mctx.stroke();
      mctx.restore();
    }
    mctx.restore();
  }

  private bakeJerseyBarrier(mctx: CanvasRenderingContext2D, x: number, y: number, angle: number): void {
    mctx.save();
    mctx.translate(x, y);
    mctx.rotate(angle);
    mctx.fillStyle = 'rgba(2, 6, 23, 0.42)';
    mctx.fillRect(-24, -7, 52, 18);

    mctx.fillStyle = '#475569';
    mctx.strokeStyle = '#0f172a';
    mctx.lineWidth = 2.2;
    mctx.beginPath();
    mctx.roundRect(-25, -9, 50, 16, 3);
    mctx.fill();
    mctx.stroke();

    // 顶部混凝土脊梁高光与警示黄黑边标
    mctx.fillStyle = '#64748b';
    mctx.fillRect(-23, -4, 46, 6);
    mctx.fillStyle = '#eab308';
    mctx.fillRect(-22, -7, 8, 2.5);
    mctx.fillRect(14, -7, 8, 2.5);
    mctx.restore();
  }

  private bakeTopDownShrubCluster(
    mctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    seed: number
  ): void {
    mctx.save();
    mctx.translate(x, y);
    // 树冠接地软投影
    mctx.fillStyle = 'rgba(2, 6, 23, 0.45)';
    mctx.beginPath();
    mctx.arc(7, 9, radius * 1.04, 0, Math.PI * 2);
    mctx.fill();

    const shades = ['#132419', '#1c3323', '#26422d', '#315137'];
    for (let layer = 0; layer < 4; layer++) {
      const count = 6 - layer;
      const lr = radius * (1 - layer * 0.2);
      mctx.fillStyle = shades[layer];
      mctx.strokeStyle = '#0a140e';
      mctx.lineWidth = 1.6;
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2 + hash2D(i, layer, seed) * 0.9;
        const dist = lr * 0.36;
        const lx = Math.cos(ang) * dist;
        const ly = Math.sin(ang) * dist;
        mctx.beginPath();
        mctx.arc(lx, ly, lr * 0.68, 0, Math.PI * 2);
        mctx.fill();
        if (layer < 2) mctx.stroke();
      }
    }
    mctx.restore();
  }

  private bakeRoomFloorMarkings(
    mctx: CanvasRenderingContext2D,
    theme: FloorTheme,
    r: Rect,
    seed: number
  ): void {
    // 1. 建筑板块接缝网格线（消除大面积地面空旷单调感，赋予真实石材/钢板/无菌舱拼接尺度！）
    const step = theme === 'asphalt' ? 168 : theme === 'lobby' || theme === 'mall' ? 112 : 84;
    mctx.strokeStyle =
      theme === 'lab'
        ? 'rgba(56, 189, 248, 0.08)'
        : theme === 'lobby' || theme === 'mall'
          ? 'rgba(15, 23, 42, 0.13)'
          : 'rgba(9, 14, 23, 0.22)';
    mctx.lineWidth = 1.2;
    mctx.beginPath();
    for (let gx = Math.ceil(r.x / step) * step; gx < r.x + r.w; gx += step) {
      mctx.moveTo(gx, r.y);
      mctx.lineTo(gx, r.y + r.h);
    }
    for (let gy = Math.ceil(r.y / step) * step; gy < r.y + r.h; gy += step) {
      mctx.moveTo(r.x, gy);
      mctx.lineTo(r.x + r.w, gy);
    }
    mctx.stroke();

    // 2. 室内外周内嵌暗色金属收边条
    mctx.strokeStyle = 'rgba(15, 23, 42, 0.34)';
    mctx.lineWidth = 2;
    mctx.strokeRect(r.x + 18, r.y + 18, Math.max(0, r.w - 36), Math.max(0, r.h - 36));

    if (theme === 'lobby' && r.w >= 300 && r.h >= 240) {
      // 接待大厅中央深蓝战术防尘地毯 + 金色双线徽章圆环
      const rw = Math.min(280, r.w * 0.44);
      const rh = Math.min(170, r.h * 0.38);
      const rx = r.x + (r.w - rw) / 2;
      const ry = r.y + (r.h - rh) / 2;
      mctx.fillStyle = 'rgba(15, 28, 52, 0.38)';
      mctx.beginPath();
      mctx.roundRect(rx, ry, rw, rh, 6);
      mctx.fill();
      mctx.strokeStyle = 'rgba(234, 179, 8, 0.42)';
      mctx.lineWidth = 2;
      mctx.strokeRect(rx + 6, ry + 6, rw - 12, rh - 12);
      mctx.beginPath();
      mctx.arc(rx + rw / 2, ry + rh / 2, Math.min(rw, rh) * 0.28, 0, Math.PI * 2);
      mctx.stroke();
    } else if (theme === 'mall' && r.w >= 320 && r.h >= 260) {
      // 商场中庭星芒八角拼花水磨石纹饰
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const rad = Math.min(r.w, r.h) * 0.26;
      mctx.strokeStyle = 'rgba(244, 114, 182, 0.22)';
      mctx.lineWidth = 2.5;
      mctx.beginPath();
      mctx.arc(cx, cy, rad, 0, Math.PI * 2);
      mctx.stroke();
      mctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
      mctx.beginPath();
      mctx.arc(cx, cy, rad * 0.72, 0, Math.PI * 2);
      mctx.stroke();
    } else if (theme === 'armory' || theme === 'asphalt') {
      // 工业区与停机坪黄黑安全警戒虚线与双金属排水地漏
      mctx.save();
      mctx.strokeStyle = 'rgba(234, 179, 8, 0.25)';
      mctx.lineWidth = 3;
      mctx.setLineDash([16, 12]);
      mctx.strokeRect(r.x + 28, r.y + 28, Math.max(0, r.w - 56), Math.max(0, r.h - 56));
      mctx.restore();

      if (r.w >= 220 && r.h >= 200) {
        this.bakeFloorGrate(mctx, r.x + r.w * 0.32 - 26, r.y + r.h * 0.78 - 9, 52, 18);
        if (r.w >= 520) {
          this.bakeFloorGrate(mctx, r.x + r.w * 0.72 - 26, r.y + r.h * 0.24 - 9, 52, 18);
        }
      }
    } else if (theme === 'lab') {
      // 实验室高能蓝光导流槽节点与检修舱盖
      mctx.strokeStyle = 'rgba(56, 189, 248, 0.19)';
      mctx.lineWidth = 2;
      mctx.strokeRect(r.x + 26, r.y + 26, Math.max(0, r.w - 52), Math.max(0, r.h - 52));
      if (r.w >= 260 && r.h >= 220) {
        this.bakeFloorGrate(mctx, r.x + 42, r.y + r.h - 60, 46, 16);
      }
    }

    // 自然地面微磨损暗斑与战场尘土痕迹
    const wearCount = Math.min(6, Math.floor((r.w * r.h) / 75000) + 2);
    for (let i = 0; i < wearCount; i++) {
      const wx = r.x + 45 + hash2D(r.x + i * 31, r.y, seed) * Math.max(20, r.w - 90);
      const wy = r.y + 45 + hash2D(r.y + i * 47, r.x, seed + 13) * Math.max(20, r.h - 90);
      const wr = 28 + hash2D(wx, wy, seed + 29) * 42;
      const wg = mctx.createRadialGradient(wx, wy, 2, wx, wy, wr);
      wg.addColorStop(0, 'rgba(9, 13, 22, 0.2)');
      wg.addColorStop(1, 'rgba(9, 13, 22, 0)');
      mctx.fillStyle = wg;
      mctx.beginPath();
      mctx.arc(wx, wy, wr, 0, Math.PI * 2);
      mctx.fill();
    }
  }

  private bakeRoomStorytellingDetails(
    mctx: CanvasRenderingContext2D,
    room: RunSnapshot['rooms'][number],
    state: RunSnapshot,
    seed: number
  ): void {
    const r0 = room.rects[0];
    if (!r0) return;

    // 1. 所有房门与窗户内侧自动铺设防滑重型橡胶迎宾/除菌地垫
    for (const d of state.doors) {
      if (d.roomA !== room.id && d.roomB !== room.id) continue;
      const dcx = d.x + d.w / 2;
      const dcy = d.y + d.h / 2;
      for (const offset of [-32, 32]) {
        const mx = d.orientation === 'vertical' ? dcx + offset : dcx;
        const my = d.orientation === 'horizontal' ? dcy + offset : dcy;
        if (pointInAnyRect(mx, my, room.rects, -12)) {
          mctx.save();
          mctx.translate(mx, my);
          if (d.orientation === 'vertical') mctx.rotate(Math.PI / 2);
          mctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
          mctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
          mctx.lineWidth = 1.4;
          mctx.fillRect(-38, -12, 76, 24);
          mctx.strokeRect(-38, -12, 76, 24);
          mctx.restore();
        }
      }
    }

    // 2. 各关卡专属房间叙事装饰层（纯视觉零阻挡，彻底告别“空房间”！）
    if (room.id === 'diner') {
      // 快餐长廊：经典美式复古黑白棋盘格过道地砖 + 粉色霓虹灯带投影
      const stripeX = r0.x + 34;
      const tileSz = 24;
      for (let y = r0.y + 36; y < r0.y + r0.h - 42; y += tileSz) {
        for (let col = 0; col < 3; col++) {
          const isWhite = ((Math.floor(y / tileSz) + col) & 1) === 0;
          mctx.fillStyle = isWhite ? 'rgba(248, 250, 252, 0.22)' : 'rgba(15, 23, 42, 0.36)';
          mctx.fillRect(stripeX + col * tileSz, y, tileSz, tileSz);
        }
      }
    } else if (room.id === 'arcade') {
      // 星际电玩城：深紫赛博霓虹地毯跑道与像素星芒图案
      const pad = 42;
      mctx.fillStyle = 'rgba(46, 16, 101, 0.34)';
      mctx.strokeStyle = 'rgba(232, 121, 249, 0.32)';
      mctx.lineWidth = 2.2;
      mctx.beginPath();
      mctx.roundRect(r0.x + pad, r0.y + pad, Math.max(40, r0.w - pad * 2), Math.max(40, r0.h - pad * 2), 12);
      mctx.fill();
      mctx.stroke();
      for (let px = r0.x + 95; px < r0.x + r0.w - 80; px += 120) {
        mctx.strokeStyle = 'rgba(34, 211, 238, 0.25)';
        mctx.strokeRect(px - 14, r0.y + r0.h * 0.52 - 14, 28, 28);
      }
    } else if (room.id === 'cells') {
      // 拘留羁押室：地面黄色警戒牢房隔间线与编号水印 (CELL-01 / CELL-02)
      mctx.save();
      mctx.strokeStyle = 'rgba(250, 204, 21, 0.28)';
      mctx.lineWidth = 2.5;
      mctx.setLineDash([10, 8]);
      const cellY = r0.y + 150;
      mctx.beginPath();
      mctx.moveTo(r0.x + 30, cellY);
      mctx.lineTo(r0.x + r0.w - 30, cellY);
      mctx.moveTo(r0.x + r0.w * 0.5, r0.y + 24);
      mctx.lineTo(r0.x + r0.w * 0.5, cellY);
      mctx.stroke();
      mctx.setLineDash([]);
      mctx.font = '800 13px monospace';
      mctx.fillStyle = 'rgba(250, 204, 21, 0.26)';
      mctx.fillText('CELL-01', r0.x + r0.w * 0.25, r0.y + 62);
      mctx.fillText('CELL-02', r0.x + r0.w * 0.75, r0.y + 62);
      mctx.restore();
    } else if (room.id === 'corridor') {
      // 审讯狭长走廊：中央红白紧急疏散导向带
      mctx.fillStyle = 'rgba(239, 68, 68, 0.22)';
      mctx.fillRect(r0.x + 36, r0.y + r0.h / 2 - 5, Math.max(20, r0.w - 72), 10);
      mctx.fillStyle = 'rgba(254, 240, 138, 0.26)';
      for (let ax = r0.x + 65; ax < r0.x + r0.w - 65; ax += 95) {
        mctx.beginPath();
        mctx.moveTo(ax + 12, r0.y + r0.h / 2);
        mctx.lineTo(ax - 4, r0.y + r0.h / 2 - 5);
        mctx.lineTo(ax - 4, r0.y + r0.h / 2 + 5);
        mctx.closePath();
        mctx.fill();
      }
    } else if (room.id === 'west_wing' || room.id === 'east_wing') {
      // 73号研究所双翼：地面嵌入式液氮/高能冷却金属管道槽
      mctx.strokeStyle = '#0f172a';
      mctx.lineWidth = 10;
      mctx.lineCap = 'round';
      mctx.beginPath();
      mctx.moveTo(r0.x + r0.w * 0.5, r0.y + 45);
      mctx.lineTo(r0.x + r0.w * 0.5, r0.y + r0.h - 45);
      mctx.stroke();
      mctx.strokeStyle = room.id === 'west_wing' ? 'rgba(34, 211, 238, 0.36)' : 'rgba(248, 113, 113, 0.34)';
      mctx.lineWidth = 3.5;
      mctx.stroke();
    } else if (room.id === 'courtyard' || room.id === 'cargo') {
      // 停机坪与卸货区：地面车位标线与叉车/装甲车轮胎印
      mctx.save();
      mctx.strokeStyle = 'rgba(250, 204, 21, 0.24)';
      mctx.lineWidth = 2.5;
      mctx.strokeRect(r0.x + 48, r0.y + 44, 145, 78);
      mctx.strokeStyle = 'rgba(9, 14, 23, 0.28)';
      mctx.lineWidth = 5;
      mctx.beginPath();
      mctx.moveTo(r0.x + 70, r0.y + r0.h - 60);
      mctx.quadraticCurveTo(r0.x + r0.w * 0.45, r0.y + r0.h * 0.65, r0.x + r0.w * 0.72, r0.y + r0.h * 0.52);
      mctx.stroke();
      mctx.restore();
    }

    // 3. 办公桌/掩体周边散落的紧急撤离纸张档案与战术警示雪糕筒（营造仓促沦陷真实氛围！）
    const roomProps = state.props.filter((p) => p.roomId === room.id);
    for (let i = 0; i < roomProps.length; i++) {
      const pr = roomProps[i];
      if (pr.kind === 'desk' || pr.kind === 'lockers') {
        for (let pIdx = 0; pIdx < 3; pIdx++) {
          const ang = hash2D(pr.x + pIdx * 19, pr.y, seed) * Math.PI * 2;
          const dist = 36 + hash2D(pr.y + pIdx * 23, pr.x, seed + 7) * 24;
          const px = pr.x + Math.cos(ang) * dist;
          const py = pr.y + Math.sin(ang) * dist;
          if (!pointInAnyRect(px, py, room.rects, -16)) continue;
          mctx.save();
          mctx.translate(px, py);
          mctx.rotate(ang * 1.7);
          mctx.fillStyle = pIdx === 0 ? 'rgba(254, 243, 199, 0.72)' : 'rgba(226, 232, 240, 0.68)';
          mctx.strokeStyle = 'rgba(15, 23, 42, 0.45)';
          mctx.lineWidth = 1;
          mctx.fillRect(-5, -6.5, 10, 13);
          mctx.strokeRect(-5, -6.5, 10, 13);
          mctx.fillStyle = 'rgba(71, 85, 105, 0.55)';
          mctx.fillRect(-3, -3.5, 6, 1.5);
          mctx.fillRect(-3, 0, 5, 1.5);
          mctx.restore();
        }
      } else if (pr.kind === 'crates' || pr.kind === 'police_car' || pr.kind === 'swat_van') {
        // 车辆/货箱边摆放俯视橙白反光警示锥（雪糕筒）
        const cx = pr.x + pr.w * 0.52 + 16;
        const cy = pr.y + pr.h * 0.32;
        if (pointInAnyRect(cx, cy, room.rects, -18)) {
          mctx.save();
          mctx.translate(cx, cy);
          mctx.fillStyle = 'rgba(2, 6, 23, 0.42)';
          mctx.fillRect(-6, -5, 14, 14);
          mctx.fillStyle = '#ea580c';
          mctx.strokeStyle = '#090e17';
          mctx.lineWidth = 1.6;
          mctx.beginPath();
          mctx.roundRect(-7, -7, 14, 14, 3);
          mctx.fill();
          mctx.stroke();
          mctx.beginPath();
          mctx.arc(0, 0, 4.6, 0, Math.PI * 2);
          mctx.fillStyle = '#f8fafc';
          mctx.fill();
          mctx.beginPath();
          mctx.arc(0, 0, 2.2, 0, Math.PI * 2);
          mctx.fillStyle = '#f97316';
          mctx.fill();
          mctx.restore();
        }
      }
    }
  }

  private bakeFloorGrate(mctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    mctx.fillStyle = '#0f172a';
    mctx.strokeStyle = '#475569';
    mctx.lineWidth = 1.8;
    mctx.fillRect(x, y, w, h);
    mctx.strokeRect(x, y, w, h);
    mctx.fillStyle = '#334155';
    for (let sx = x + 5; sx < x + w - 4; sx += 6) {
      mctx.fillRect(sx, y + 3, 2.5, h - 6);
    }
  }

  private bakeStationFloorCable(
    mctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    rects: Rect[]
  ): void {
    // 寻找最近的一面房间边界墙，铺设重型橡胶过线槽
    let bestX = sx;
    let bestY = sy - 90;
    let bestDist = 9999;
    for (const r of rects) {
      if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) {
        const candidates = [
          { x: sx, y: r.y + 6, d: Math.abs(sy - r.y) },
          { x: sx, y: r.y + r.h - 6, d: Math.abs(r.y + r.h - sy) },
          { x: r.x + 6, y: sy, d: Math.abs(sx - r.x) },
          { x: r.x + r.w - 6, y: sy, d: Math.abs(r.x + r.w - sx) },
        ];
        for (const c of candidates) {
          if (c.d < bestDist) {
            bestDist = c.d;
            bestX = c.x;
            bestY = c.y;
          }
        }
      }
    }
    if (bestDist > 260) return;

    mctx.save();
    mctx.strokeStyle = '#0f172a';
    mctx.lineWidth = 8;
    mctx.lineCap = 'round';
    mctx.beginPath();
    mctx.moveTo(sx, sy);
    mctx.lineTo(bestX, bestY);
    mctx.stroke();

    mctx.strokeStyle = '#334155';
    mctx.lineWidth = 4;
    mctx.stroke();

    // 中段黄黑防踩踏过线桥板
    const mx = (sx + bestX) * 0.5;
    const my = (sy + bestY) * 0.5;
    if (bestDist > 55) {
      mctx.translate(mx, my);
      mctx.rotate(Math.atan2(bestY - sy, bestX - sx));
      mctx.fillStyle = '#eab308';
      mctx.strokeStyle = '#0f172a';
      mctx.lineWidth = 1.6;
      mctx.fillRect(-9, -6, 18, 12);
      mctx.strokeRect(-9, -6, 18, 12);
      mctx.fillStyle = '#0f172a';
      mctx.fillRect(-5, -5, 4, 10);
      mctx.fillRect(2, -5, 4, 10);
    }
    mctx.restore();
  }

  private bakeWallAmbientOcclusion(mctx: CanvasRenderingContext2D, walls: Rect[]): void {
    const aoSize = 30;
    for (const w of walls) {
      // 东南向主光源墙体厚投影
      mctx.fillStyle = 'rgba(2, 6, 23, 0.34)';
      mctx.fillRect(w.x + 7, w.y + 10, w.w, w.h);

      // 南侧柔和墙根 AO
      const gs = mctx.createLinearGradient(0, w.y + w.h, 0, w.y + w.h + aoSize);
      gs.addColorStop(0, 'rgba(2, 6, 23, 0.48)');
      gs.addColorStop(1, 'rgba(2, 6, 23, 0)');
      mctx.fillStyle = gs;
      mctx.fillRect(w.x - 4, w.y + w.h, w.w + 8, aoSize);

      // 北侧柔和墙根 AO
      const gn = mctx.createLinearGradient(0, w.y, 0, w.y - aoSize * 0.72);
      gn.addColorStop(0, 'rgba(2, 6, 23, 0.36)');
      gn.addColorStop(1, 'rgba(2, 6, 23, 0)');
      mctx.fillStyle = gn;
      mctx.fillRect(w.x - 4, w.y - aoSize * 0.72, w.w + 8, aoSize * 0.72);

      // 东侧柔和墙根 AO
      const ge = mctx.createLinearGradient(w.x + w.w, 0, w.x + w.w + aoSize, 0);
      ge.addColorStop(0, 'rgba(2, 6, 23, 0.44)');
      ge.addColorStop(1, 'rgba(2, 6, 23, 0)');
      mctx.fillStyle = ge;
      mctx.fillRect(w.x + w.w, w.y - 4, aoSize, w.h + 8);

      // 西侧柔和墙根 AO
      const gw = mctx.createLinearGradient(w.x, 0, w.x - aoSize * 0.72, 0);
      gw.addColorStop(0, 'rgba(2, 6, 23, 0.34)');
      gw.addColorStop(1, 'rgba(2, 6, 23, 0)');
      mctx.fillStyle = gw;
      mctx.fillRect(w.x - aoSize * 0.72, w.y - 4, aoSize * 0.72, w.h + 8);
    }
  }

  private bakeRoomTacticalLighting(
    mctx: CanvasRenderingContext2D,
    room: RunSnapshot['rooms'][number],
    state: RunSnapshot
  ): void {
    mctx.save();
    mctx.globalCompositeOperation = 'screen';

    // 1. 每个矩形区域中心顶部战术吸顶灯柔和照明池（让房间中央通透明亮、墙角深邃有层次）
    for (const r of room.rects) {
      const lcx = r.x + r.w / 2;
      const lcy = r.y + r.h / 2;
      const rad = Math.max(r.w, r.h) * 0.62;
      const lg = mctx.createRadialGradient(lcx, lcy, 12, lcx, lcy, rad);
      const tint =
        room.floorTheme === 'lab'
          ? 'rgba(125, 211, 252, 0.11)'
          : room.floorTheme === 'mall'
            ? 'rgba(199, 210, 254, 0.11)'
            : 'rgba(254, 243, 199, 0.12)';
      lg.addColorStop(0, tint);
      lg.addColorStop(1, 'rgba(0, 0, 0, 0)');
      mctx.fillStyle = lg;
      mctx.fillRect(r.x, r.y, r.w, r.h);
    }

    // 2. 房间内战术终端、改装台、贩卖机的彩色环境地面反光
    for (const st of state.stations) {
      if (st.roomId !== room.id) continue;
      if (st.used && (st.type === 'starter_airdrop' || st.type === 'mech_dog_cage')) continue;
      const glowColor =
        st.type === 'armory_kiosk'
          ? 'rgba(52, 211, 153, 0.22)'
          : st.type === 'pack_a_punch'
            ? 'rgba(192, 132, 252, 0.25)'
            : st.type === 'vending_machine'
              ? 'rgba(244, 114, 182, 0.22)'
              : st.type === 'laser_trap'
                ? 'rgba(248, 113, 113, 0.2)'
                : 'rgba(251, 191, 36, 0.18)';
      const sg = mctx.createRadialGradient(st.x, st.y, 6, st.x, st.y, 92);
      sg.addColorStop(0, glowColor);
      sg.addColorStop(1, 'rgba(0, 0, 0, 0)');
      mctx.fillStyle = sg;
      mctx.beginPath();
      mctx.arc(st.x, st.y, 92, 0, Math.PI * 2);
      mctx.fill();
    }

    mctx.restore();
  }

  private bakeSteelThreshold(
    mctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    orientation: 'horizontal' | 'vertical'
  ): void {
    mctx.save();
    const pad = 5;
    const tx = orientation === 'horizontal' ? x : x - pad;
    const ty = orientation === 'horizontal' ? y - pad : y;
    const tw = orientation === 'horizontal' ? w : w + pad * 2;
    const th = orientation === 'horizontal' ? h + pad * 2 : h;

    mctx.fillStyle = '#1e293b';
    mctx.strokeStyle = '#090d16';
    mctx.lineWidth = 2;
    mctx.fillRect(tx, ty, tw, th);
    mctx.strokeRect(tx, ty, tw, th);

    // 防滑金属凹槽纹理
    mctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
    mctx.lineWidth = 1.2;
    mctx.beginPath();
    if (orientation === 'horizontal') {
      for (let gx = tx + 10; gx < tx + tw - 6; gx += 12) {
        mctx.moveTo(gx, ty + 4);
        mctx.lineTo(gx, ty + th - 4);
      }
    } else {
      for (let gy = ty + 10; gy < ty + th - 6; gy += 12) {
        mctx.moveTo(tx + 4, gy);
        mctx.lineTo(tx + tw - 4, gy);
      }
    }
    mctx.stroke();
    mctx.restore();
  }

  private bake3DArchitecturalWalls(mctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    const baseDark = state.stage.wallColor;
    const capMain = state.stage.wallTopColor;
    const capHighlight = shadeHex(capMain, 32);
    const capShadow = shadeHex(capMain, -24);

    // 1. 先绘制所有墙段外部投影
    mctx.fillStyle = 'rgba(2, 6, 23, 0.5)';
    for (const w of state.walls) {
      mctx.fillRect(w.x + 6, w.y + 8, w.w, w.h);
    }

    // 2. 绘制多层 3D 倒角墙体结构与装甲接缝铆钉
    const pillarMap = new Map<string, { x: number; y: number }>();

    for (const w of state.walls) {
      const isHoriz = w.w >= w.h;

      // 外壳黑钢底座
      mctx.fillStyle = '#090e17';
      mctx.fillRect(w.x, w.y, w.w, w.h);

      // 墙体斜坡立面
      mctx.fillStyle = baseDark;
      mctx.fillRect(w.x + 2, w.y + 2, Math.max(0, w.w - 4), Math.max(0, w.h - 4));

      // 顶部装甲混凝土盖板（带北西向受光高光边与南东向背光暗边）
      const inset = 4.5;
      const cx = w.x + inset;
      const cy = w.y + inset - 1;
      const cw = Math.max(0, w.w - inset * 2);
      const ch = Math.max(0, w.h - inset * 2 - 1);

      mctx.fillStyle = capShadow;
      mctx.fillRect(cx, cy, cw, ch);

      mctx.fillStyle = capMain;
      mctx.fillRect(cx, cy, Math.max(0, cw - 2), Math.max(0, ch - 2));

      // 受光亮边
      mctx.fillStyle = capHighlight;
      mctx.fillRect(cx, cy, cw, 2);
      mctx.fillRect(cx, cy, 2, ch);

      // 每隔 56px 网格绘制装甲墙顶伸缩接缝与双铆钉
      mctx.strokeStyle = 'rgba(9, 14, 23, 0.55)';
      mctx.lineWidth = 1.6;
      mctx.fillStyle = 'rgba(226, 232, 240, 0.34)';
      if (isHoriz) {
        const startX = Math.ceil((w.x + 24) / 56) * 56;
        for (let sx = startX; sx < w.x + w.w - 20; sx += 56) {
          mctx.beginPath();
          mctx.moveTo(sx, cy + 1);
          mctx.lineTo(sx, cy + ch - 1);
          mctx.stroke();
          mctx.fillRect(sx - 4, cy + 3, 2, 2);
          mctx.fillRect(sx + 2, cy + ch - 5, 2, 2);
        }
        // 记录两端门框/转角钢柱坐标
        const py = w.y + w.h / 2;
        const p1x = w.x + 14;
        const p2x = w.x + w.w - 14;
        pillarMap.set(`${Math.round(p1x / 8)},${Math.round(py / 8)}`, { x: p1x, y: py });
        pillarMap.set(`${Math.round(p2x / 8)},${Math.round(py / 8)}`, { x: p2x, y: py });
      } else {
        const startY = Math.ceil((w.y + 24) / 56) * 56;
        for (let sy = startY; sy < w.y + w.h - 20; sy += 56) {
          mctx.beginPath();
          mctx.moveTo(cx + 1, sy);
          mctx.lineTo(cx + cw - 1, sy);
          mctx.stroke();
          mctx.fillRect(cx + 3, sy - 4, 2, 2);
          mctx.fillRect(cx + cw - 5, sy + 2, 2, 2);
        }
        const px = w.x + w.w / 2;
        const p1y = w.y + 14;
        const p2y = w.y + w.h - 14;
        pillarMap.set(`${Math.round(px / 8)},${Math.round(p1y / 8)}`, { x: px, y: p1y });
        pillarMap.set(`${Math.round(px / 8)},${Math.round(p2y / 8)}`, { x: px, y: p2y });
      }
    }

    // 3. 在所有墙体转角、门框立柱、窗框立柱处加盖重型铆接钢结构承重柱帽！
    const pHalf = 15.5;
    for (const p of pillarMap.values()) {
      mctx.fillStyle = '#090e17';
      mctx.fillRect(p.x - pHalf, p.y - pHalf, pHalf * 2, pHalf * 2);

      mctx.fillStyle = shadeHex(capMain, 10);
      mctx.fillRect(p.x - pHalf + 2.5, p.y - pHalf + 2.5, pHalf * 2 - 5, pHalf * 2 - 6);

      mctx.fillStyle = shadeHex(capMain, 38);
      mctx.fillRect(p.x - pHalf + 2.5, p.y - pHalf + 2.5, pHalf * 2 - 5, 2.2);
      mctx.fillRect(p.x - pHalf + 2.5, p.y - pHalf + 2.5, 2.2, pHalf * 2 - 6);

      // 四角重型螺栓钉头
      mctx.fillStyle = '#cbd5e1';
      const bo = pHalf - 6.5;
      mctx.fillRect(p.x - bo - 1, p.y - bo - 1, 2.4, 2.4);
      mctx.fillRect(p.x + bo - 1, p.y - bo - 1, 2.4, 2.4);
      mctx.fillRect(p.x - bo - 1, p.y + bo - 2, 2.4, 2.4);
      mctx.fillRect(p.x + bo - 1, p.y + bo - 2, 2.4, 2.4);
    }
  }

  private blitStaticMapViewport(ctx: CanvasRenderingContext2D): void {
    if (!this.mapCanvas) return;
    if (
      this.vLeft < this.mapOriginX ||
      this.vTop < this.mapOriginY ||
      this.vRight > this.mapOriginX + this.mapCanvas.width ||
      this.vBottom > this.mapOriginY + this.mapCanvas.height
    ) {
      const grassPat = Assets.getPattern(ctx, 'tile_grass', 0.74);
      ctx.fillStyle = grassPat || '#1e3124';
      ctx.fillRect(this.vLeft - 8, this.vTop - 8, this.vRight - this.vLeft + 16, this.vBottom - this.vTop + 16);
    }

    const sx = Math.max(0, Math.floor(this.vLeft - this.mapOriginX - 8));
    const sy = Math.max(0, Math.floor(this.vTop - this.mapOriginY - 8));
    const ex = Math.min(this.mapCanvas.width, Math.ceil(this.vRight - this.mapOriginX + 8));
    const ey = Math.min(this.mapCanvas.height, Math.ceil(this.vBottom - this.mapOriginY + 8));
    const sw = ex - sx;
    const sh = ey - sy;
    if (sw <= 0 || sh <= 0) return;

    ctx.drawImage(this.mapCanvas, sx, sy, sw, sh, sx + this.mapOriginX, sy + this.mapOriginY, sw, sh);
  }

  // ==================== 地面与房间动态交互物 ====================

  private drawDecals(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    for (const dc of state.decals) {
      if (!this.inView(dc.x, dc.y, dc.radius + 30)) continue;
      ctx.save();
      if (dc.isScorch) {
        // 高爆焦黑放射状弹坑贴花 + 初爆余烬微光边
        const alpha = Math.min(0.9, dc.life / 3.2);
        ctx.globalAlpha = alpha;
        ctx.translate(dc.x, dc.y);

        const cg = ctx.createRadialGradient(0, 0, dc.radius * 0.12, 0, 0, dc.radius);
        cg.addColorStop(0, 'rgba(2, 6, 23, 0.86)');
        cg.addColorStop(0.55, 'rgba(15, 23, 42, 0.56)');
        cg.addColorStop(1, 'rgba(15, 23, 42, 0)');
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(0, 0, dc.radius, 0, Math.PI * 2);
        ctx.fill();

        // 放射状冲击波灼痕射线
        ctx.strokeStyle = 'rgba(9, 13, 22, 0.62)';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        for (let r = 0; r < 10; r++) {
          const ang = (r / 10) * Math.PI * 2 + dc.seed;
          const rLen = dc.radius * (0.72 + ((r * 37) % 5) * 0.11);
          ctx.moveTo(Math.cos(ang) * dc.radius * 0.2, Math.sin(ang) * dc.radius * 0.2);
          ctx.lineTo(Math.cos(ang) * rLen, Math.sin(ang) * rLen);
        }
        ctx.stroke();

        // 刚爆炸后 2.5 秒内的坑心暗红余烬
        const fresh = Math.max(0, 1 - (dc.maxLife - dc.life) / 2.5);
        if (fresh > 0) {
          ctx.fillStyle = `rgba(249, 115, 22, ${0.42 * fresh})`;
          ctx.beginPath();
          ctx.arc(0, 0, dc.radius * 0.28, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.globalAlpha = Math.min(0.88, dc.life / 3.5);
        ctx.fillStyle = dc.color;
        ctx.beginPath();
        ctx.arc(dc.x, dc.y, dc.radius * 0.72, 0, Math.PI * 2);
        ctx.arc(
          dc.x + Math.cos(dc.seed) * dc.radius * 0.44,
          dc.y + Math.sin(dc.seed) * dc.radius * 0.44,
          dc.radius * 0.42,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
      ctx.restore();
    }

    // 地面强酸/腐蚀熔岩毒潭
    const now = performance.now() * 0.007;
    for (const ap of state.acidPools) {
      if (!this.inView(ap.x, ap.y, ap.radius + 20)) continue;
      const alpha = Math.min(1, ap.life / 0.8);
      const pulse = 0.94 + Math.sin(now + ap.x * 0.05) * 0.06;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(ap.x, ap.y, ap.radius * pulse, 0, Math.PI * 2);
      ctx.fillStyle = ap.isBoss ? 'rgba(225, 29, 72, 0.42)' : 'rgba(132, 204, 22, 0.42)';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = ap.isBoss ? '#fb7185' : '#bef264';
      ctx.setLineDash([7, 5]);
      ctx.stroke();
      ctx.setLineDash([]);

      const bx = ap.x + Math.cos(now * 1.3 + ap.y) * ap.radius * 0.38;
      const by = ap.y + Math.sin(now * 1.1 + ap.x) * ap.radius * 0.38;
      ctx.beginPath();
      ctx.arc(bx, by, 5, 0, Math.PI * 2);
      ctx.fillStyle = ap.isBoss ? '#fda4af' : '#ecfccb';
      ctx.fill();
      ctx.restore();
    }
  }

  private drawHelipad(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    const courtyard = state.rooms.find((r) => r.id === 'courtyard');
    if (!courtyard?.unlocked && state.waveState !== 'extraction') return;

    const { x, y } = state.stage.helipadPos;
    if (!this.inView(x, y, 130)) return;
    const isExtracting = state.waveState === 'extraction';
    const pulse = 0.85 + Math.sin(performance.now() * 0.008) * 0.15;

    ctx.save();
    // 装甲停机坪八角战术底座与外圈警示标线
    ctx.beginPath();
    ctx.arc(x, y, 78, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(9, 14, 23, 0.54)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.8)';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, 68, 0, Math.PI * 2);
    ctx.fillStyle = isExtracting ? `rgba(34, 197, 94, ${0.32 * pulse})` : 'rgba(15, 23, 42, 0.36)';
    ctx.fill();
    ctx.lineWidth = 4.5;
    ctx.strokeStyle = isExtracting ? '#4ade80' : 'rgba(234, 179, 8, 0.78)';
    ctx.setLineDash([14, 9]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 四向跑道助航灯点
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * 73, y + Math.sin(a) * 73, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = isExtracting ? '#4ade80' : i % 2 === 0 ? '#facc15' : '#38bdf8';
      ctx.fill();
    }

    ctx.font = '900 38px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isExtracting ? '#4ade80' : 'rgba(250, 204, 21, 0.68)';
    ctx.fillText('H', x, y);

    if (isExtracting) {
      ctx.beginPath();
      ctx.arc(x, y, 82, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * state.extractionProgress);
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 8;
      ctx.stroke();

      const rotorAngle = performance.now() * 0.018;
      ctx.save();
      ctx.translate(x, y - 10);
      ctx.rotate(rotorAngle);
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.48)';
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-80, 0);
      ctx.lineTo(80, 0);
      ctx.moveTo(0, -80);
      ctx.lineTo(0, 80);
      ctx.stroke();
      ctx.restore();

      this.drawCachedLabel(ctx, '踩入光圈撤离!', x, y - 96, '#fef08a', 15);
    }
    ctx.restore();
  }

  private drawStations(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    const save = SaveManager.get();
    const now = performance.now() * 0.005;

    for (const st of state.stations) {
      if (!this.inView(st.x, st.y, 85)) continue;
      const room = state.rooms.find((r) => r.id === st.roomId);
      if (!room?.unlocked) continue;
      if (st.used && (st.type === 'starter_airdrop' || st.type === 'mech_dog_cage')) continue;

      const padR = 33;
      let ringColor = '#38bdf8';
      let priceTag = st.cost > 0 ? `$${st.cost}` : '';

      if (st.type === 'armory_kiosk') {
        ringColor = '#10b981';
        const near = Math.hypot(state.player.x - st.x, state.player.y - st.y) < 120;
        priceTag = near ? '踩入或按 B' : '';
      } else if (st.type === 'starter_airdrop') {
        ringColor = '#f59e0b';
        priceTag = save.freeStarterUsedCount < 2 ? '免费试用' : '看广告领';
      } else if (st.type === 'ammo_box') {
        ringColor = '#22c55e';
      } else if (st.type === 'pack_a_punch') {
        ringColor = '#a855f7';
      } else if (st.type === 'mech_dog_cage') {
        ringColor = '#38bdf8';
      } else if (st.type === 'vending_machine') {
        ringColor = '#ec4899';
      } else if (st.type === 'laser_trap') {
        ringColor = '#ef4444';
        if (st.activeTimer > 0) priceTag = `${st.activeTimer.toFixed(0)}s`;
      }

      ctx.save();

      // 重型金属防滑底座盘 + 呼吸指示光环
      ctx.beginPath();
      ctx.arc(st.x, st.y, padR + 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(2, 6, 23, 0.58)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(st.x, st.y, padR, 0, Math.PI * 2);
      ctx.fillStyle = '#1e293b';
      ctx.fill();
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = ringColor;
      ctx.stroke();

      if (st.progress > 0) {
        ctx.beginPath();
        ctx.arc(st.x, st.y, padR + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * st.progress);
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 5.5;
        ctx.stroke();
      }

      // 全部采用 90° 纯正俯视高精度写实战术设备精灵！
      if (st.type === 'armory_kiosk') {
        this.drawCenteredSprite(ctx, 'prop_armory_kiosk', st.x, st.y, 54, 0);
      } else if (st.type === 'pack_a_punch') {
        this.drawCenteredSprite(ctx, 'prop_pap', st.x, st.y, 58, 0);
      } else if (st.type === 'starter_airdrop') {
        this.drawCenteredSprite(ctx, 'prop_chest', st.x, st.y + Math.sin(now * 1.3) * 1.8, 50, 0);
      } else if (st.type === 'mech_dog_cage') {
        this.drawCenteredSprite(ctx, 'mech_dog', st.x, st.y, 48, -0.4);
        // 能量束缚格栅条
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
        ctx.lineWidth = 2;
        ctx.strokeRect(st.x - 18, st.y - 18, 36, 36);
      } else if (st.type === 'ammo_box') {
        this.drawCenteredSprite(ctx, 'prop_ammo_box', st.x, st.y, 50, 0);
      } else if (st.type === 'vending_machine') {
        this.drawCenteredSprite(ctx, 'prop_vending', st.x, st.y, 54, 0);
      } else if (st.type === 'laser_trap') {
        const towerRot = st.activeTimer > 0 ? performance.now() * 0.0045 : 0;
        this.drawCenteredSprite(ctx, 'prop_laser_tower', st.x, st.y, 56, towerRot);
      }

      if (st.type === 'laser_trap' && st.activeTimer > 0) {
        const beamAngle = performance.now() * 0.0045;
        for (let i = 0; i < 2; i++) {
          const a = beamAngle + i * Math.PI;
          ctx.beginPath();
          ctx.moveTo(st.x, st.y);
          ctx.lineTo(st.x + Math.cos(a) * 255, st.y + Math.sin(a) * 255);
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.58)';
          ctx.lineWidth = 14;
          ctx.stroke();
          ctx.strokeStyle = '#fef08a';
          ctx.lineWidth = 3.5;
          ctx.stroke();
        }
      }

      const nearStation = Math.hypot(state.player.x - st.x, state.player.y - st.y) < 145;
      if (nearStation) {
        this.drawCachedLabel(ctx, st.label, st.x, st.y - 40, '#f8fafc', 11);
        if (priceTag) {
          this.drawCachedLabel(ctx, priceTag, st.x, st.y + 40, '#fde047', 11);
        }
      } else if (st.type === 'laser_trap' && st.activeTimer > 0 && priceTag) {
        this.drawCachedLabel(ctx, priceTag, st.x, st.y + 38, '#fca5a5', 10);
      }
      ctx.restore();
    }
  }

  private drawWindowsAndDoors(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    const electricActive = state.electricFortifyWaves > 0;

    // 1. 立体钢框窗户与带钉头木纹防线板
    for (const win of state.windows) {
      if (!this.inView(win.x + win.w / 2, win.y + win.h / 2, 85)) continue;
      ctx.save();

      // 深色凹陷窗槽与两侧钢制窗托
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(win.x, win.y, win.w, win.h);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(win.x + 3, win.y + 3, win.w - 6, win.h - 6);
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(win.x + 2, win.y + 2, win.w - 4, win.h - 4);

      // 中央金属窗棂导轨
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 3;
      ctx.beginPath();
      if (win.orientation === 'horizontal') {
        ctx.moveTo(win.x + 4, win.y + win.h / 2);
        ctx.lineTo(win.x + win.w - 4, win.y + win.h / 2);
      } else {
        ctx.moveTo(win.x + win.w / 2, win.y + 4);
        ctx.lineTo(win.x + win.w / 2, win.y + win.h - 4);
      }
      ctx.stroke();

      const count = win.planks;
      for (let i = 0; i < count; i++) {
        const ratio = (i + 0.5) / Math.max(1, win.maxPlanks);
        const tilt = ((i % 3) - 1) * 0.022;
        const plankMain = electricActive ? '#0284c7' : i % 2 === 0 ? '#92400e' : '#b45309';
        const plankHi = electricActive ? '#7dd3fc' : i % 2 === 0 ? '#d97706' : '#f59e0b';

        if (win.orientation === 'horizontal') {
          const cx = win.x + win.w / 2;
          const cy = win.y + 4 + ratio * (win.h - 8);
          const pw = win.w - 14;
          const ph = 6.5;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(tilt);
          ctx.fillStyle = plankMain;
          ctx.strokeStyle = '#090d16';
          ctx.lineWidth = 1.8;
          ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
          ctx.strokeRect(-pw / 2, -ph / 2, pw, ph);
          ctx.fillStyle = plankHi;
          ctx.fillRect(-pw / 2 + 1, -ph / 2 + 1, pw - 2, 1.8);
          // 两端钢钉钉帽
          ctx.fillStyle = '#e2e8f0';
          ctx.fillRect(-pw / 2 + 5, -1.2, 2.5, 2.5);
          ctx.fillRect(pw / 2 - 7.5, -1.2, 2.5, 2.5);
          ctx.restore();
        } else {
          const cx = win.x + 4 + ratio * (win.w - 8);
          const cy = win.y + win.h / 2;
          const pw = 6.5;
          const ph = win.h - 14;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(tilt);
          ctx.fillStyle = plankMain;
          ctx.strokeStyle = '#090d16';
          ctx.lineWidth = 1.8;
          ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
          ctx.strokeRect(-pw / 2, -ph / 2, pw, ph);
          ctx.fillStyle = plankHi;
          ctx.fillRect(-pw / 2 + 1, -ph / 2 + 1, 1.8, ph - 2);
          ctx.fillStyle = '#e2e8f0';
          ctx.fillRect(-1.2, -ph / 2 + 5, 2.5, 2.5);
          ctx.fillRect(-1.2, ph / 2 - 7.5, 2.5, 2.5);
          ctx.restore();
        }
      }

      if (win.planks === 0) {
        const blink = 0.35 + Math.sin(performance.now() * 0.01) * 0.25;
        ctx.fillStyle = `rgba(239, 68, 68, ${blink})`;
        ctx.fillRect(win.x + 3, win.y + 3, win.w - 6, win.h - 6);
      }
      ctx.restore();
    }

    // 2. 重型液压对开防爆钢门（Blast Bulkhead Doors）
    for (const door of state.doors) {
      if (!this.inView(door.x + door.w / 2, door.y + door.h / 2, 90)) continue;
      if (door.unlocked) {
        // 开启后露出两侧门框收纳钢槽
        ctx.save();
        ctx.fillStyle = '#334155';
        ctx.strokeStyle = '#090d16';
        ctx.lineWidth = 1.8;
        if (door.orientation === 'horizontal') {
          ctx.fillRect(door.x, door.y + 2, 10, door.h - 4);
          ctx.strokeRect(door.x, door.y + 2, 10, door.h - 4);
          ctx.fillRect(door.x + door.w - 10, door.y + 2, 10, door.h - 4);
          ctx.strokeRect(door.x + door.w - 10, door.y + 2, 10, door.h - 4);
        } else {
          ctx.fillRect(door.x + 2, door.y, door.w - 4, 10);
          ctx.strokeRect(door.x + 2, door.y, door.w - 4, 10);
          ctx.fillRect(door.x + 2, door.y + door.h - 10, door.w - 4, 10);
          ctx.strokeRect(door.x + 2, door.y + door.h - 10, door.w - 4, 10);
        }
        ctx.restore();
        continue;
      }

      ctx.save();
      // 门体接地阴影
      ctx.fillStyle = 'rgba(2, 6, 23, 0.45)';
      ctx.fillRect(door.x + 4, door.y + 6, door.w, door.h);

      // 重型深灰装甲门扇主体 + 黄黑工程警戒边条
      ctx.fillStyle = '#334155';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 3;
      ctx.fillRect(door.x, door.y, door.w, door.h);
      ctx.strokeRect(door.x, door.y, door.w, door.h);

      const cx = door.x + door.w / 2;
      const cy = door.y + door.h / 2;

      if (door.orientation === 'horizontal') {
        // 上下黄黑警戒封边
        ctx.fillStyle = '#eab308';
        ctx.fillRect(door.x + 3, door.y + 2, door.w - 6, 4.5);
        ctx.fillRect(door.x + 3, door.y + door.h - 6.5, door.w - 6, 4.5);
        ctx.fillStyle = '#0f172a';
        for (let sx = door.x + 8; sx < door.x + door.w - 8; sx += 16) {
          ctx.fillRect(sx, door.y + 2, 7, 4.5);
          ctx.fillRect(sx + 4, door.y + door.h - 6.5, 7, 4.5);
        }
        // 中央对开门缝与液压闭锁栓
        ctx.fillStyle = '#090d16';
        ctx.fillRect(cx - 1.5, door.y + 2, 3, door.h - 4);
        ctx.fillStyle = '#475569';
        ctx.fillRect(cx - 14, cy - 6, 28, 12);
        ctx.strokeRect(cx - 14, cy - 6, 28, 12);
      } else {
        ctx.fillStyle = '#eab308';
        ctx.fillRect(door.x + 2, door.y + 3, 4.5, door.h - 6);
        ctx.fillRect(door.x + door.w - 6.5, door.y + 3, 4.5, door.h - 6);
        ctx.fillStyle = '#0f172a';
        for (let sy = door.y + 8; sy < door.y + door.h - 8; sy += 16) {
          ctx.fillRect(door.x + 2, sy, 4.5, 7);
          ctx.fillRect(door.x + door.w - 6.5, sy + 4, 4.5, 7);
        }
        ctx.fillStyle = '#090d16';
        ctx.fillRect(door.x + 2, cy - 1.5, door.w - 4, 3);
        ctx.fillStyle = '#475569';
        ctx.fillRect(cx - 6, cy - 14, 12, 28);
        ctx.strokeRect(cx - 6, cy - 14, 12, 28);
      }

      // 门禁红/绿状态指示灯
      ctx.beginPath();
      ctx.arc(cx, cy, 3.8, 0, Math.PI * 2);
      ctx.fillStyle = state.cash >= door.cost ? '#4ade80' : '#ef4444';
      ctx.fill();

      if (door.progress > 0) {
        ctx.beginPath();
        ctx.arc(cx, cy, 31, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * door.progress);
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 6;
        ctx.stroke();
      }
      const nearDoor = Math.hypot(state.player.x - cx, state.player.y - cy) < 175;
      if (nearDoor) {
        this.drawCachedLabel(ctx, door.label, cx, cy - 13, '#f8fafc', 11);
      }
      this.drawCachedLabel(
        ctx,
        `$${door.cost}`,
        cx,
        nearDoor ? cy + 13 : cy,
        state.cash >= door.cost ? '#86efac' : '#fde047',
        11
      );
      ctx.restore();
    }
  }

  private drawDropsAndChests(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    const now = performance.now() * 0.006;
    for (const d of state.drops) {
      if (!this.inView(d.x, d.y, 44)) continue;
      const bob = Math.sin(now + d.bobPhase) * 2.5;
      ctx.save();
      ctx.translate(d.x, d.y + bob);
      if (d.kind === 'cash') {
        // 立体成捆美金钞票叠层 + 银行扎带与高光
        ctx.fillStyle = 'rgba(2, 6, 23, 0.42)';
        ctx.beginPath();
        ctx.ellipse(2, 6 - bob * 0.4, 13, 6.5, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.rotate(-0.16);
        // 底层钞票厚度侧边
        ctx.fillStyle = '#064e3b';
        ctx.strokeStyle = '#022c22';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.roundRect(-11, -4, 22, 13, 2.5);
        ctx.fill();
        ctx.stroke();

        // 顶层翠绿钞票面与内框防伪纹
        ctx.fillStyle = '#16a34a';
        ctx.beginPath();
        ctx.roundRect(-11, -7.5, 22, 12.5, 2.5);
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = 'rgba(187, 247, 208, 0.55)';
        ctx.lineWidth = 1;
        ctx.strokeRect(-8.5, -5.5, 17, 8.5);

        // 中央米白封签扎带
        ctx.fillStyle = '#fef3c7';
        ctx.fillRect(-3.2, -7.5, 6.4, 15.5);
        ctx.strokeStyle = '#78350f';
        ctx.strokeRect(-3.2, -7.5, 6.4, 15.5);
        this.drawCachedLabel(ctx, '$', 0, -1, '#15803d', 10);
      } else if (d.kind === 'xp') {
        // 战术棱镜能量数据晶片（多层折射切面 + 柔和蓝青光晕）
        ctx.fillStyle = 'rgba(56, 189, 248, 0.24)';
        ctx.beginPath();
        ctx.arc(0, 0, 12, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#0284c7';
        ctx.strokeStyle = '#090d16';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -9.5);
        ctx.lineTo(7.5, -2.5);
        ctx.lineTo(5.5, 8.5);
        ctx.lineTo(-5.5, 8.5);
        ctx.lineTo(-7.5, -2.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 内部高光切面
        ctx.fillStyle = '#7dd3fc';
        ctx.beginPath();
        ctx.moveTo(0, -6.5);
        ctx.lineTo(4.2, -1.5);
        ctx.lineTo(0, 4.5);
        ctx.lineTo(-4.2, -1.5);
        ctx.closePath();
        ctx.fill();
      } else if (d.kind === 'powerup' && d.powerUp) {
        const meta = POWERUP_META[d.powerUp];
        // 军用战术补给能量罐（外发光呼吸环 + 金属装甲边圈 + 玻璃高光）
        ctx.beginPath();
        ctx.arc(0, 0, 21 + Math.sin(now * 2) * 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(0, 2, 16.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(2, 6, 23, 0.5)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(0, 0, 16, 0, Math.PI * 2);
        ctx.fillStyle = '#1e293b';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#090d16';
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, 0, 12.5, 0, Math.PI * 2);
        ctx.fillStyle = meta.color;
        ctx.fill();
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = '#f8fafc';
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.beginPath();
        ctx.ellipse(-3.5, -4.5, 5, 2.5, -0.5, 0, Math.PI * 2);
        ctx.fill();

        this.drawCachedLabel(ctx, meta.icon, 0, 0.5, '#ffffff', 12);
      }
      ctx.restore();
    }

    for (const c of state.chests) {
      if (!this.inView(c.x, c.y, 65)) continue;
      const bounce = Math.abs(Math.sin(now * 1.25 + c.bobPhase)) * 4;
      ctx.save();
      ctx.beginPath();
      ctx.arc(c.x, c.y, 28, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(245, 158, 11, 0.22)';
      ctx.fill();

      this.drawCenteredSprite(ctx, 'prop_chest', c.x, c.y - bounce, 50, 0);

      if (c.progress > 0) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, 32, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * c.progress);
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 5;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawBarrels(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    for (const b of state.barrels) {
      if (!b.alive || !this.inView(b.x, b.y, 50)) continue;
      const room = state.rooms.find((r) => r.id === b.roomId);
      if (!room?.unlocked) continue;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(b.x + 3, b.y + 8, 18, 14, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(2, 6, 23, 0.42)';
      ctx.fill();
      this.drawCenteredSprite(ctx, 'prop_barrel', b.x, b.y, 44, 0);
      ctx.restore();
    }
  }

  private drawTurretsAndDog(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    for (const t of state.turrets) {
      if (!this.inView(t.x, t.y, 60)) continue;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(t.x + 3, t.y + 10, 20, 13, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(2, 6, 23, 0.42)';
      ctx.fill();
      this.drawCenteredSprite(ctx, 'prop_turret', t.x, t.y, 56, t.angle);
      this.drawCachedLabel(ctx, `${t.life.toFixed(0)}s`, t.x, t.y - 28, '#7dd3fc', 10);
      ctx.restore();
    }

    if (state.mechDog.active && this.inView(state.mechDog.x, state.mechDog.y, 60)) {
      const d = state.mechDog;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(d.x + 2, d.y + 10, 17, 10, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(2, 6, 23, 0.4)';
      ctx.fill();
      this.drawCenteredSprite(ctx, 'mech_dog', d.x, d.y, 54, d.angle);
      ctx.restore();
    }
  }

  // ==================== 写实俯视僵尸群 ====================

  private drawZombies(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    const frozen = state.powerUpTimers.freeze > 0;
    for (const z of state.zombies) {
      if (z.hp <= 0 || !this.inView(z.x, z.y, 115)) continue;
      const spKey = ZOMBIE_SPRITE_MAP[z.kind];
      const sway = Math.sin(z.wobblePhase) * 0.12;
      const squash = 1 + Math.sin(z.wobblePhase * 2) * 0.05;
      const lunge = z.attackAnim * 11;
      const angle = z.facingAngle + sway;
      const drawSize = z.radius * 3.55;

      ctx.save();
      ctx.translate(z.x, z.y);

      // 立体角色接地暗影
      ctx.beginPath();
      ctx.ellipse(3, z.radius * 0.55, z.radius * 1.02, z.radius * 0.62, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(2, 6, 23, 0.46)';
      ctx.fill();

      if (frozen || z.slowTimer > 0) {
        ctx.beginPath();
        ctx.arc(0, 0, z.radius + 7, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(103, 232, 249, 0.34)';
        ctx.fill();
      } else if (z.burnTimer > 0) {
        ctx.beginPath();
        ctx.arc(0, 0, z.radius + 7, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(249, 115, 22, 0.38)';
        ctx.fill();
      }

      // 僵尸脚底交替迈步步伐
      ctx.save();
      ctx.rotate(z.facingAngle);
      const stride = Math.sin(z.wobblePhase) * (z.radius * 0.34);
      const footSpread = z.radius * 0.42;
      ctx.fillStyle = '#1e293b';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(stride - 2, -footSpread, 6.5, 4.2, 0, 0, Math.PI * 2);
      ctx.ellipse(-stride - 2, footSpread, 6.5, 4.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.rotate(angle);
      ctx.translate(lunge, 0);
      this.drawEntitySpriteWithFlash(ctx, spKey, drawSize, 0, squash, 2 - squash, z.hitFlash > 0);
      ctx.restore();

      ctx.restore();

      if (z.kind === 'thief') {
        this.drawCachedLabel(ctx, `盗宝怪 ${z.fleeTimer.toFixed(0)}s`, z.x, z.y - z.radius - 22, '#fde047', 11);
      } else if (z.kind === 'boss' || z.kind === 'miniboss') {
        this.drawCachedLabel(
          ctx,
          z.kind === 'boss' ? '深渊尸王' : '重装暴君',
          z.x,
          z.y - z.radius - 24,
          '#fca5a5',
          12
        );
      }

      if (z.hp < z.maxHp || z.kind === 'boss' || z.kind === 'miniboss' || z.kind === 'thief') {
        const bw = Math.max(36, z.radius * 1.9);
        const bx = z.x - bw / 2;
        const by = z.y - z.radius - 13;
        ctx.fillStyle = '#090d16';
        ctx.fillRect(bx - 1.5, by - 1.5, bw + 3, 7);
        ctx.fillStyle = z.kind === 'thief' ? '#facc15' : '#ef4444';
        ctx.fillRect(bx, by, bw * Math.max(0, z.hp / z.maxHp), 4);
      }
    }
  }

  private drawSpits(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    for (const s of state.spits) {
      if (!this.inView(s.x, s.y, 36)) continue;
      const isBossOrb = s.radius >= 9;
      const ang = Math.atan2(s.vy, s.vx);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(ang);

      // 腐蚀酸液彗星尾迹与液滴
      ctx.fillStyle = isBossOrb ? 'rgba(244, 63, 94, 0.34)' : 'rgba(163, 230, 53, 0.32)';
      ctx.beginPath();
      ctx.moveTo(s.radius, -s.radius * 0.85);
      ctx.lineTo(-s.radius * 2.8, 0);
      ctx.lineTo(s.radius, s.radius * 0.85);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(0, 0, s.radius * 1.25, s.radius * 0.92, 0, 0, Math.PI * 2);
      ctx.fillStyle = isBossOrb ? '#fb7185' : '#a3e635';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = isBossOrb ? '#4c0519' : '#1a2e05';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(s.radius * 0.25, -s.radius * 0.2, s.radius * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = isBossOrb ? '#ffe4e6' : '#ecfccb';
      ctx.fill();
      ctx.restore();
    }
  }

  // ==================== 全身骨骼特种兵主角（夜视仪头盔躯干 + 战术护袖 + 枪口地面火光） ====================

  private drawPlayer(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    const p = state.player;
    const activeWep = p.weapons[p.activeSlot];
    const isFever = state.feverTimer > 0;
    const now = performance.now();
    const rigScale = 0.68;

    const idleBreath = 1 + Math.sin(now * 0.0042) * 0.024;
    const walkTwist = p.isMoving ? Math.sin(p.walkPhase) * 0.095 : 0;
    const walkBob = p.isMoving ? Math.abs(Math.cos(p.walkPhase)) * 1.4 : 0;
    const torsoKick = p.recoilOffset * 0.42;
    const activeDef = WEAPONS[activeWep.defId];

    ctx.save();
    ctx.translate(p.x, p.y);

    // 0. 开火瞬间枪口照亮地面的零GC双层动态战术火光池！
    if (p.muzzleFlashTimer > 0) {
      const fx = Math.cos(p.angle) * 34;
      const fy = Math.sin(p.angle) * 34;
      const flashRgb = activeWep.evolved
        ? '56, 189, 248'
        : activeWep.defId === 'cryogun' || activeWep.defId === 'tesla' || activeWep.defId === 'plasma'
          ? '34, 211, 238'
          : '251, 191, 36';
      ctx.fillStyle = `rgba(${flashRgb}, 0.14)`;
      ctx.beginPath();
      ctx.arc(fx, fy, 94, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${flashRgb}, 0.24)`;
      ctx.beginPath();
      ctx.arc(fx, fy, 48, 0, Math.PI * 2);
      ctx.fill();
    }

    // 1. 柔和角色脚底接地投影
    ctx.beginPath();
    ctx.ellipse(2, p.radius * 0.58, p.radius * 1.12, p.radius * 0.64, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(2, 6, 23, 0.48)';
    ctx.fill();

    // 2. 防弹护甲微光环 & 无敌 / Fever 狂热光环
    if (p.armor > 0) {
      ctx.beginPath();
      ctx.arc(0, 0, p.radius + 5.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.78)';
      ctx.lineWidth = 2.2;
      ctx.stroke();
    }
    if (isFever || state.powerUpTimers.overdrive > 0 || p.invulnTimer > 0) {
      ctx.beginPath();
      ctx.arc(0, 0, p.radius + 10, 0, Math.PI * 2);
      ctx.fillStyle = p.invulnTimer > 0 ? 'rgba(56, 189, 248, 0.2)' : 'rgba(250, 204, 21, 0.24)';
      ctx.fill();
      ctx.strokeStyle = p.invulnTimer > 0 ? '#38bdf8' : '#facc15';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    ctx.save();
    ctx.scale(rigScale, rigScale);

    // 3. 下半身独立骨骼：战术军靴
    ctx.save();
    ctx.rotate(p.legAngle);
    const stride = p.isMoving ? Math.sin(p.walkPhase) * 10.5 : 0;
    this.drawTacticalBoot(ctx, stride + 2, -10.5);
    this.drawTacticalBoot(ctx, -stride + 2, 10.5);
    ctx.restore();

    // 4. 上半身独立骨骼：专属背包挂件 -> 夜视仪特种兵头盔躯干 -> 差异化激光/扇形准星 -> 前置无遮挡高辨识度持枪模型！
    ctx.save();
    ctx.translate(0, -walkBob);
    ctx.rotate(p.angle);

    // 4a. 重武器专属背部装备（双火焰罐 / 液氮冷媒罐 / 加特林弹链箱 / 特斯拉电容组）
    this.drawWeaponBackpackGear(ctx, activeWep.defId, activeWep.evolved, torsoKick);

    // 4b. 先绘制特种兵头盔与肩甲躯干（略微后移，绝不遮挡前方双手持握的枪械本体！）
    ctx.save();
    ctx.translate(-torsoKick - 9, 0);
    ctx.rotate(walkTwist);
    ctx.scale(idleBreath, 2 - idleBreath);
    const torsoImg = Assets.getSprite('player_torso');
    if (torsoImg) {
      const torsoSz = 60;
      ctx.drawImage(torsoImg, -torsoSz / 2, -torsoSz / 2, torsoSz, torsoSz);
    }
    ctx.restore();

    // 4c. 枪械专属瞄准辅助线（霰弹扇面 / 巴雷特远距红点 / 超武双持双轨激光 / 电弧能量线）
    this.drawWeaponAimSight(ctx, activeWep.defId, activeWep.evolved, Boolean(activeDef.akimboOnEvolve && activeWep.evolved));

    // 4d. 最顶层绘制双手护袖与 15 把高辨识度俯视枪械（含切枪上膛弹出动画！）
    this.drawEquippedTopDownWeaponAndArms(ctx, activeWep.defId, activeWep.evolved, p, now);

    ctx.restore();
    ctx.restore(); // 结束 rigScale

    if (p.reloadTimer > 0 && p.reloadDuration > 0) {
      const pct = 1 - p.reloadTimer / p.reloadDuration;
      const bw = 40;
      ctx.fillStyle = '#090d16';
      ctx.fillRect(-bw / 2 - 1.5, -p.radius - 19, bw + 3, 7);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(-bw / 2, -p.radius - 17.5, bw * pct, 4.2);
    } else {
      const def = WEAPONS[activeWep.defId];
      const maxMag = Math.max(2, Math.round(def.magSize * state.modifiers.magMult * (activeWep.evolved ? 1.5 : 1)));
      if (activeWep.mag > 0 && activeWep.mag <= Math.max(2, Math.floor(maxMag * 0.2))) {
        this.drawCachedLabel(ctx, '弹药偏低!', 0, -p.radius - 18, '#fde047', 10);
      }
    }

    if (p.repairProgress > 0) {
      ctx.beginPath();
      ctx.arc(0, 0, p.radius + 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.repairProgress);
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 4.5;
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawTacticalBoot(ctx: CanvasRenderingContext2D, fx: number, fy: number): void {
    ctx.fillStyle = '#1c2430';
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.roundRect(fx - 7, fy - 4.5, 15, 9, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#4b5563';
    ctx.fillRect(fx + 2, fy - 2.5, 4, 5);
  }

  private drawWeaponBackpackGear(
    ctx: CanvasRenderingContext2D,
    wepId: string,
    evolved: boolean,
    torsoKick: number
  ): void {
    ctx.save();
    ctx.translate(-torsoKick, 0);
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 2.4;

    if (wepId === 'flamethrower') {
      // 背部双联高压燃油气瓶 + 右侧黄色编织输油软管
      const tankColor = evolved ? '#0284c7' : '#ea580c';
      const stripeColor = evolved ? '#7dd3fc' : '#fde047';
      for (const ty of [-10, 10]) {
        ctx.fillStyle = tankColor;
        ctx.beginPath();
        ctx.roundRect(-34, ty - 5.5, 18, 11, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = stripeColor;
        ctx.fillRect(-28, ty - 4.5, 4, 9);
      }
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(-18, 11);
      ctx.quadraticCurveTo(4, 24, 26, 8);
      ctx.stroke();
    } else if (wepId === 'cryogun') {
      // 背部发光液氮冷媒钢瓶 + 冰蓝保温导管
      ctx.fillStyle = evolved ? '#2563eb' : '#0891b2';
      ctx.beginPath();
      ctx.roundRect(-35, -13, 17, 26, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#bae6fd';
      ctx.fillRect(-30, -9, 7, 18);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(-19, 10);
      ctx.quadraticCurveTo(4, 23, 26, 7);
      ctx.stroke();
    } else if (wepId === 'minigun') {
      // 背部重型军绿弹药箱 + 侧面黄铜金属供弹链条
      ctx.fillStyle = evolved ? '#4c1d95' : '#365314';
      ctx.beginPath();
      ctx.roundRect(-35, -14, 17, 28, 4);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = evolved ? '#e879f9' : '#facc15';
      ctx.lineWidth = 5;
      ctx.setLineDash([3.5, 2.2]);
      ctx.beginPath();
      ctx.moveTo(-19, 11);
      ctx.quadraticCurveTo(4, 25, 25, 8);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (wepId === 'tesla') {
      // 背部双紫铜电磁电容塔
      for (const ty of [-10, 10]) {
        ctx.fillStyle = '#b45309';
        ctx.beginPath();
        ctx.roundRect(-33, ty - 5.5, 15, 11, 3.5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = evolved ? '#c084fc' : '#22d3ee';
        ctx.beginPath();
        ctx.arc(-26, ty, 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  private drawWeaponAimSight(
    ctx: CanvasRenderingContext2D,
    wepId: string,
    evolved: boolean,
    isAkimbo: boolean
  ): void {
    if (wepId === 'shotgun' || wepId === 'autoshotgun') {
      const spreadAng = wepId === 'autoshotgun' ? 0.22 : 0.19;
      const coneLen = 175;
      ctx.save();
      ctx.fillStyle = evolved ? 'rgba(249, 115, 22, 0.08)' : 'rgba(251, 191, 36, 0.06)';
      ctx.beginPath();
      ctx.moveTo(46, 0);
      ctx.arc(46, 0, coneLen, -spreadAng, spreadAng);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = evolved ? 'rgba(249, 115, 22, 0.36)' : 'rgba(251, 191, 36, 0.3)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([7, 7]);
      ctx.beginPath();
      ctx.moveTo(46, 0);
      ctx.lineTo(46 + Math.cos(-spreadAng) * coneLen, Math.sin(-spreadAng) * coneLen);
      ctx.moveTo(46, 0);
      ctx.lineTo(46 + Math.cos(spreadAng) * coneLen, Math.sin(spreadAng) * coneLen);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      return;
    }

    if (isAkimbo) {
      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.42)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([9, 7]);
      for (const sy of [-15, 15]) {
        ctx.beginPath();
        ctx.moveTo(46, sy);
        ctx.lineTo(255, sy);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
      return;
    }

    if (wepId === 'sniper') {
      ctx.save();
      ctx.strokeStyle = evolved ? 'rgba(34, 211, 238, 0.62)' : 'rgba(239, 68, 68, 0.56)';
      ctx.lineWidth = 2.1;
      ctx.beginPath();
      ctx.moveTo(98, 0);
      ctx.lineTo(420, 0);
      ctx.stroke();
      ctx.fillStyle = evolved ? '#22d3ee' : '#ef4444';
      ctx.beginPath();
      ctx.arc(420, 0, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    if (wepId === 'flamethrower' || wepId === 'cryogun') {
      return;
    }

    ctx.beginPath();
    ctx.moveTo(52, 0);
    ctx.lineTo(265, 0);
    ctx.strokeStyle =
      wepId === 'tesla' || wepId === 'plasma'
        ? 'rgba(34, 211, 238, 0.42)'
        : evolved
          ? 'rgba(56, 189, 248, 0.42)'
          : 'rgba(239, 68, 68, 0.34)';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([10, 8]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawEquippedTopDownWeaponAndArms(
    ctx: CanvasRenderingContext2D,
    wepId: string,
    evolved: boolean,
    p: RunSnapshot['player'],
    now: number
  ): void {
    const kick = p.recoilOffset;
    const isReloading = p.reloadTimer > 0 && p.reloadDuration > 0;
    const reloadPhase = isReloading ? 1 - p.reloadTimer / p.reloadDuration : 0;
    const reloadTilt = isReloading ? Math.sin(reloadPhase * Math.PI) * 0.42 : 0;

    // 切枪瞬间（0.32s）干脆利落的上膛弹出与微放大反馈！
    const swapRatio = Math.max(0, Math.min(1, p.weaponSwapTimer / 0.32));
    const swapScale = 1 + Math.sin(swapRatio * Math.PI) * 0.22;
    const swapTilt = -swapRatio * 0.34;

    const def = WEAPONS[wepId];
    const isAkimbo = Boolean(def?.akimboOnEvolve && evolved);

    ctx.save();
    ctx.translate(-kick, 0);
    ctx.rotate(reloadTilt + swapTilt);
    ctx.scale(swapScale, swapScale);

    // ===== A. 超武双持模式（黄金双持沙鹰 / 猩红双持左轮 / 幻影双持冲锋枪） =====
    if (isAkimbo) {
      const leftKick = p.akimboAlt ? kick * 0.65 : 0;
      const rightKick = !p.akimboAlt ? kick * 0.65 : 0;
      const lhX = 24 - leftKick;
      const lhY = -15;
      const rhX = 24 - rightKick;
      const rhY = 15;

      this.drawForearmToHand(ctx, 2, -16, lhX, lhY);
      this.drawForearmToHand(ctx, 2, 16, rhX, rhY);

      const drawSingleSidearm = (gx: number, gy: number, sideSign: number) => {
        ctx.save();
        ctx.translate(gx, gy);
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = '#090d16';
        if (wepId === 'pistol') {
          // 黄金双持沙漠之鹰
          ctx.fillStyle = '#facc15';
          ctx.beginPath();
          ctx.roundRect(-2, -4.5, 28, 9, 2.5);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#fef08a';
          ctx.fillRect(4, -2.2, 18, 4.4);
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(24, -2.5, 4, 5);
        } else if (wepId === 'revolver') {
          // 猩红鎏金双持长管左轮
          ctx.fillStyle = '#7f1d1d';
          ctx.fillRect(-3, -3.5, 10, 7);
          ctx.fillStyle = '#facc15';
          ctx.beginPath();
          ctx.roundRect(4, -6, 11, 12, 3);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.roundRect(15, -3.2, 24, 6.4, 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#fde047';
          ctx.fillRect(17, -1.2, 18, 2.4);
        } else {
          // 幻影霓虹双持微冲（带外侧弹匣 + 消音管）
          ctx.fillStyle = '#0f172a';
          ctx.beginPath();
          ctx.roundRect(-3, -4.5, 27, 9, 3);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#38bdf8';
          ctx.fillRect(8, sideSign < 0 ? -13 : 4.5, 5.5, 8.5);
          ctx.strokeRect(8, sideSign < 0 ? -13 : 4.5, 5.5, 8.5);
          ctx.fillStyle = '#22d3ee';
          ctx.fillRect(3, -1.8, 17, 3.6);
          ctx.fillStyle = '#64748b';
          ctx.beginPath();
          ctx.roundRect(24, -3, 12, 6, 2);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      };

      drawSingleSidearm(lhX, lhY, -1);
      drawSingleSidearm(rhX, rhY, 1);
      this.drawGlovedHand(ctx, lhX, lhY);
      this.drawGlovedHand(ctx, rhX, rhY);

      if (p.muzzleFlashTimer > 0) {
        const flashY = p.akimboAlt ? 15 : -15;
        const flashX = wepId === 'revolver' ? 63 : wepId === 'smg' ? 60 : 52;
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.moveTo(flashX, flashY);
        ctx.lineTo(flashX + 22, flashY - 9);
        ctx.lineTo(flashX + 14, flashY);
        ctx.lineTo(flashX + 22, flashY + 9);
        ctx.closePath();
        ctx.fill();
      }

      ctx.restore();
      return;
    }

    // ===== B. 单把主武器握持手部坐标（整体前探至头盔前方 x=20..104，100% 清晰无遮挡！） =====
    let rightHandX = 21;
    let rightHandY = 8;
    let leftHandX = 39;
    let leftHandY = -5;
    let muzzleTipX = 68;

    if (wepId === 'pistol') {
      rightHandX = 23;
      rightHandY = 4.5;
      leftHandX = 26;
      leftHandY = -4;
      muzzleTipX = 49;
    } else if (wepId === 'revolver') {
      rightHandX = 22;
      rightHandY = 4.5;
      leftHandX = 26;
      leftHandY = -4;
      muzzleTipX = 60;
    } else if (wepId === 'smg') {
      rightHandX = 21;
      rightHandY = 7;
      leftHandX = 35;
      leftHandY = -5;
      muzzleTipX = 62;
    } else if (wepId === 'shotgun') {
      rightHandX = 20;
      rightHandY = 7.5;
      leftHandX = 43 - kick * 0.55;
      leftHandY = -4.5;
      muzzleTipX = 74;
    } else if (wepId === 'autoshotgun') {
      rightHandX = 20;
      rightHandY = 8;
      leftHandX = 46;
      leftHandY = -5.5;
      muzzleTipX = 74;
    } else if (wepId === 'rifle') {
      rightHandX = 20;
      rightHandY = 7.5;
      leftHandX = 44;
      leftHandY = -5;
      muzzleTipX = 82;
    } else if (wepId === 'crossbow') {
      rightHandX = 20;
      rightHandY = 7.5;
      leftHandX = 42;
      leftHandY = -5;
      muzzleTipX = 78;
    } else if (wepId === 'flamethrower' || wepId === 'cryogun') {
      rightHandX = 20;
      rightHandY = 9.5;
      leftHandX = 42;
      leftHandY = -7.5;
      muzzleTipX = 75;
    } else if (wepId === 'sniper') {
      rightHandX = 19;
      rightHandY = 7.5;
      leftHandX = 48;
      leftHandY = -5;
      muzzleTipX = 104;
    } else if (wepId === 'launcher') {
      rightHandX = 20;
      rightHandY = 9;
      leftHandX = 47;
      leftHandY = -6.5;
      muzzleTipX = 72;
    } else if (wepId === 'sawlauncher') {
      rightHandX = 20;
      rightHandY = 9.5;
      leftHandX = 42;
      leftHandY = -9;
      muzzleTipX = 85;
    } else if (wepId === 'minigun') {
      rightHandX = 18;
      rightHandY = 14;
      leftHandX = 37;
      leftHandY = -12;
      muzzleTipX = 90;
    } else if (wepId === 'tesla') {
      rightHandX = 20;
      rightHandY = 8.5;
      leftHandX = 44;
      leftHandY = -6.5;
      muzzleTipX = 88;
    } else if (wepId === 'plasma') {
      rightHandX = 20;
      rightHandY = 8.5;
      leftHandX = 45;
      leftHandY = -6.5;
      muzzleTipX = 92;
    }

    if (isReloading) {
      const slap = Math.sin(reloadPhase * Math.PI * 2);
      leftHandX = 26 + slap * 7;
      leftHandY = -12 + Math.abs(slap) * 9;
    }

    // 先画双臂战术护袖
    this.drawForearmToHand(ctx, 2, 16, rightHandX, rightHandY);
    this.drawForearmToHand(ctx, 2, -16, leftHandX, leftHandY);

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#090d16';

    if (wepId === 'pistol') {
      // 战术银黑双色 USP 手枪（短小精悍、亮银套筒）
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.roundRect(22, -4.5, 26, 9, 2.5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.roundRect(25, -3.2, 21, 6.4, 1.8);
      ctx.fill();
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(44, -1.2, 2.5, 2.4);
    } else if (wepId === 'revolver') {
      // 蟒蛇 .357 左轮（红木握把 + 醒目宽大六连发转轮鼓 + 修长亮银枪管）
      ctx.fillStyle = '#9a3412';
      ctx.beginPath();
      ctx.roundRect(20, -4, 10, 8, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#cbd5e1';
      ctx.beginPath();
      ctx.roundRect(28, -6.2, 12, 12.4, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#64748b';
      ctx.fillRect(30, -4.2, 8, 2);
      ctx.fillRect(30, 2.2, 8, 2);
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.roundRect(40, -3, 20, 6, 2);
      ctx.fill();
      ctx.stroke();
    } else if (wepId === 'smg') {
      // MP5 冲锋枪（蓝灰机匣 + 左侧大幅弧形香蕉弹匣 + 前置消音筒）
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.moveTo(33, -4);
      ctx.lineTo(39, -18);
      ctx.lineTo(44, -16);
      ctx.lineTo(39, -4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.roundRect(18, -4.8, 30, 9.6, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#64748b';
      ctx.beginPath();
      ctx.roundRect(48, -3.2, 14, 6.4, 2.5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(25, -1.8, 12, 3.6);
    } else if (wepId === 'shotgun') {
      // 雷明顿泵动霰弹枪（暖棕胡桃木枪托/滑动护木 + 双管长枪管 + 侧面 3 发红壳霰弹排）
      ctx.fillStyle = evolved ? '#991b1b' : '#92400e';
      ctx.beginPath();
      ctx.roundRect(16, -4.5, 13, 9, 2.5);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#475569';
      ctx.beginPath();
      ctx.roundRect(28, -4.2, 45, 8.4, 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(30, -1.8, 41, 3.6);

      // 侧面 3 颗鲜红霰弹壳
      ctx.fillStyle = '#ef4444';
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(30 + i * 4.2, 4.2, 3, 2.6);
      }

      // 随射击后坐滑动的泵动木护木
      ctx.fillStyle = evolved ? '#f97316' : '#d97706';
      ctx.beginPath();
      ctx.roundRect(leftHandX - 7, -6, 16, 12, 3);
      ctx.fill();
      ctx.stroke();
    } else if (wepId === 'autoshotgun') {
      // AA-12 全自动连喷（宽厚军绿/深红方匣机身 + 右侧超大 20 发圆形大弹鼓 + 散热孔护套！）
      ctx.fillStyle = evolved ? '#f97316' : '#eab308';
      ctx.beginPath();
      ctx.arc(39, 10.5, 9.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.arc(39, 10.5, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = evolved ? '#b91c1c' : '#4d7c0f';
      ctx.beginPath();
      ctx.roundRect(17, -6.5, 40, 13, 3.5);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.roundRect(57, -4.8, 17, 9.6, 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(24, -2.5, 26, 5);
    } else if (wepId === 'rifle') {
      // 经典 AK-47 突击步枪（琥珀木护木/暗物质紫机身 + 橙色弯月弹匣 + 全息红点镜 + 细长导气管与斜口制退器）
      ctx.fillStyle = evolved ? '#a855f7' : '#ea580c';
      ctx.beginPath();
      ctx.moveTo(36, -4.5);
      ctx.lineTo(44, -18.5);
      ctx.lineTo(50, -16);
      ctx.lineTo(43, -4.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = evolved ? '#4c1d95' : '#92400e';
      ctx.beginPath();
      ctx.roundRect(16, -4.5, 13, 9, 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = evolved ? '#6d28d9' : '#334155';
      ctx.beginPath();
      ctx.roundRect(28, -5, 22, 10, 2.5);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = evolved ? '#c084fc' : '#d97706';
      ctx.beginPath();
      ctx.roundRect(49, -4.5, 16, 9, 2.5);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#1e293b';
      ctx.fillRect(65, -2.4, 16, 4.8);
      ctx.strokeRect(65, -2.4, 16, 4.8);

      // 顶部战术导轨红点镜
      ctx.fillStyle = evolved ? '#38bdf8' : '#facc15';
      ctx.fillRect(32, -2.2, 10, 4.4);
    } else if (wepId === 'crossbow') {
      // 爆裂猎弩（极具辨识度的 56px 超宽横向反曲弓臂 + 绷紧白色弓弦 + 红色爆炸箭头！）
      const limbColor = evolved ? '#facc15' : '#a3e635';

      // 绷紧弓弦（两侧弓梢拉向弩机卡扣）
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(41, -27);
      ctx.lineTo(28, 0);
      ctx.lineTo(41, 27);
      ctx.stroke();

      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 2.5;
      // 左右反曲大弓臂
      for (const sgn of [-1, 1]) {
        ctx.fillStyle = limbColor;
        ctx.beginPath();
        ctx.moveTo(56, sgn * 3.5);
        ctx.quadraticCurveTo(53, sgn * 20, 40, sgn * 28);
        ctx.lineTo(36, sgn * 25);
        ctx.quadraticCurveTo(47, sgn * 16, 48, sgn * 3.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      // 碳纤维中轴弩身
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.roundRect(17, -4.2, 54, 8.4, 3);
      ctx.fill();
      ctx.stroke();

      // 待发箭杆与鲜红/鎏金爆裂三棱箭簇
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(28, -1.3, 44, 2.6);
      ctx.fillStyle = evolved ? '#38bdf8' : '#ef4444';
      ctx.beginPath();
      ctx.moveTo(81, 0);
      ctx.lineTo(69, -6.5);
      ctx.lineTo(72, 0);
      ctx.lineTo(69, 6.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (wepId === 'flamethrower') {
      // 烈焰喷射器（橙红加厚储压腔 + 黄铜网状隔热罩 + 前端常亮跳动火苗！）
      ctx.fillStyle = evolved ? '#0284c7' : '#ea580c';
      ctx.beginPath();
      ctx.roundRect(17, -6.5, 34, 13, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ca8a04';
      ctx.beginPath();
      ctx.roundRect(51, -5, 20, 10, 2.5);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#090d16';
      for (let hx = 54; hx <= 66; hx += 5) {
        ctx.fillRect(hx, -2.5, 2.5, 5);
      }

      // 实时跳动的常亮引火嘴火苗
      const flicker = 4.6 + Math.sin(now * 0.028) * 1.6;
      ctx.fillStyle = evolved ? 'rgba(56, 189, 248, 0.85)' : 'rgba(249, 115, 22, 0.88)';
      ctx.beginPath();
      ctx.arc(77, 0, flicker * 1.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(75, 0, flicker * 0.7, 0, Math.PI * 2);
      ctx.fill();
    } else if (wepId === 'cryogun') {
      // 极寒液氮炮（纯白冰蓝机身 + 醒目喇叭状扩口冷冻喷嘴 + 缭绕冰晶寒雾！）
      ctx.fillStyle = '#e0f2fe';
      ctx.beginPath();
      ctx.roundRect(17, -6.5, 36, 13, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = evolved ? '#3b82f6' : '#06b6d4';
      ctx.fillRect(24, -3.2, 24, 6.4);

      // 喇叭形扩口急冻喷口
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.moveTo(53, -4.5);
      ctx.lineTo(73, -10);
      ctx.lineTo(73, 10);
      ctx.lineTo(53, 4.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      const frostPulse = 4 + Math.cos(now * 0.022) * 1.5;
      ctx.fillStyle = 'rgba(186, 230, 253, 0.85)';
      ctx.beginPath();
      ctx.arc(78, 0, frostPulse * 1.3, 0, Math.PI * 2);
      ctx.fill();
    } else if (wepId === 'sniper') {
      // 巴雷特 .50 重型反器材大狙（超长 88px 枪身 + 折叠两脚架 + 巨型瞄准镜 + 标志性箭头形大制退器！）
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(68, -4);
      ctx.lineTo(56, -13);
      ctx.moveTo(68, 4);
      ctx.lineTo(56, 13);
      ctx.stroke();

      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 2.5;
      ctx.fillStyle = evolved ? '#0e7490' : '#4d7c0f';
      ctx.beginPath();
      ctx.roundRect(16, -5.2, 44, 10.4, 2.5);
      ctx.fill();
      ctx.stroke();

      // 超长重型浮置枪管
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(60, -2.6, 38, 5.2);
      ctx.strokeRect(60, -2.6, 38, 5.2);

      // 标志性巴雷特 V 型宽大箭头炮口制退器
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.moveTo(105, -5);
      ctx.lineTo(95, -10);
      ctx.lineTo(95, 10);
      ctx.lineTo(105, 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 顶部大口径高倍光学狙击镜 + 红宝石/青色镀膜镜片
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.roundRect(25, -3.8, 26, 7.6, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = evolved ? '#22d3ee' : '#ef4444';
      ctx.fillRect(48, -2.8, 3.5, 5.6);
    } else if (wepId === 'launcher') {
      // M32 六连发转轮榴弹炮（超肥厚 20px 转轮弹巢鼓 + 粗壮 40mm 大口径炮管 + 黄黑警示环！）
      ctx.fillStyle = '#3f6212';
      ctx.beginPath();
      ctx.roundRect(16, -5, 13, 10, 3);
      ctx.fill();
      ctx.stroke();

      // 宽大六连发榴弹转轮鼓
      ctx.fillStyle = evolved ? '#b91c1c' : '#475569';
      ctx.beginPath();
      ctx.roundRect(27, -10, 22, 20, 5);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#facc15';
      ctx.fillRect(34, -9, 6, 18);
      ctx.fillStyle = '#090d16';
      ctx.fillRect(29, -4, 18, 2);
      ctx.fillRect(29, 2, 18, 2);

      // 粗壮大口径榴弹发射筒
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.roundRect(49, -6.5, 22, 13, 2.5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(67, -6.5, 4, 13);
    } else if (wepId === 'sawlauncher') {
      // 回旋锯盘发射器（醒目工程黄黑双叉轨道架 + 前端实时高速旋转的大号带齿合金圆锯盘！）
      ctx.fillStyle = '#eab308';
      ctx.beginPath();
      ctx.roundRect(17, -8.5, 34, 17, 4);
      ctx.fill();
      ctx.stroke();

      // 工程黑斜纹警示块
      ctx.fillStyle = '#090d16';
      ctx.fillRect(25, -7.5, 5, 15);
      ctx.fillRect(36, -7.5, 5, 15);

      // 双侧夹持导轨叉臂
      ctx.fillStyle = '#475569';
      ctx.fillRect(51, -9, 20, 4.5);
      ctx.strokeRect(51, -9, 20, 4.5);
      ctx.fillRect(51, 4.5, 20, 4.5);
      ctx.strokeRect(51, 4.5, 20, 4.5);

      // 前端待发高速旋转圆锯盘
      this.drawSpinningSawDisc(
        ctx,
        72,
        0,
        13.5,
        now * 0.014 + p.barrelSpin,
        evolved ? '#fb7185' : '#f1f5f9',
        evolved ? '#facc15' : '#ef4444'
      );
    } else if (wepId === 'minigun') {
      // M134 加特林火神炮（宽体电机座 + 顶部横向提把 + 6 根高速旋转长枪管束 + 双道金属箍环！）
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.roundRect(15, -9.5, 25, 19, 4.5);
      ctx.fill();
      ctx.stroke();

      const spinShift = Math.sin(p.barrelSpin) * 2.6;
      ctx.fillStyle = evolved ? '#e879f9' : '#cbd5e1';
      ctx.fillRect(40, -8, 48, 3.6);
      ctx.fillRect(40, -3.2 + spinShift * 0.45, 48, 3.6);
      ctx.fillRect(40, 1.6 - spinShift * 0.45, 48, 3.6);
      ctx.fillRect(40, 4.6, 48, 3.6);
      ctx.strokeRect(40, -8.2, 48, 16.4);

      // 两道重型旋转枪管束箍环
      ctx.fillStyle = evolved ? '#38bdf8' : '#facc15';
      ctx.fillRect(58, -9, 5, 18);
      ctx.strokeRect(58, -9, 5, 18);
      ctx.fillRect(80, -9, 6, 18);
      ctx.strokeRect(80, -9, 6, 18);

      // 顶部横向链锯式握持护杠
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 3.6;
      ctx.beginPath();
      ctx.moveTo(35, -12);
      ctx.lineTo(35, 11);
      ctx.stroke();
    } else if (wepId === 'tesla') {
      // 特斯拉电弧炮（深灰机身 + 3 道紫铜发光电磁线圈环 + 前端双音叉电极与实时跳跃电弧！）
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.roundRect(17, -6.5, 56, 13, 4);
      ctx.fill();
      ctx.stroke();

      const glowCol = evolved ? '#c084fc' : '#22d3ee';
      ctx.fillStyle = glowCol;
      ctx.fillRect(24, -2.5, 48, 5);

      // 3 道醒目紫铜电磁感应线圈环
      for (const cx of [36, 50, 64]) {
        ctx.fillStyle = '#ea580c';
        ctx.beginPath();
        ctx.roundRect(cx - 3.5, -9, 7, 18, 2.5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = glowCol;
        ctx.fillRect(cx - 1.2, -7.5, 2.4, 15);
      }

      // 前端双叉放电电极
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(73, -7.5, 13, 3.8);
      ctx.strokeRect(73, -7.5, 13, 3.8);
      ctx.fillRect(73, 3.7, 13, 3.8);
      ctx.strokeRect(73, 3.7, 13, 3.8);

      // 电极间实时跳跃的闪电电弧
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.9;
      ctx.beginPath();
      ctx.moveTo(85, -5.5);
      ctx.lineTo(89 + Math.sin(now * 0.05) * 2.5, 0);
      ctx.lineTo(85, 5.5);
      ctx.stroke();
    } else {
      // 等离子磁轨炮（科幻分体双翼导轨 + 暴露式高亮脉冲能量核心槽 + 枪口电浆球！）
      const railBody = evolved ? '#4c0519' : '#064e3b';
      const coreGlow = evolved ? '#fb7185' : '#34d399';

      ctx.fillStyle = railBody;
      ctx.beginPath();
      ctx.roundRect(16, -8.5, 32, 17, 4.5);
      ctx.fill();
      ctx.stroke();

      // 上下分体磁轨翼片
      ctx.fillStyle = evolved ? '#e11d48' : '#10b981';
      ctx.beginPath();
      ctx.roundRect(46, -8.5, 44, 5.8, 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.roundRect(46, 2.7, 44, 5.8, 2);
      ctx.fill();
      ctx.stroke();

      // 中央高能脉冲等离子光槽
      ctx.fillStyle = coreGlow;
      ctx.fillRect(24, -2.5, 64, 5);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(89, 0, 3.6 + Math.sin(now * 0.025) * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }

    this.drawGlovedHand(ctx, rightHandX, rightHandY);
    this.drawGlovedHand(ctx, leftHandX, leftHandY);

    if (p.muzzleFlashTimer > 0 && wepId !== 'flamethrower' && wepId !== 'cryogun' && wepId !== 'sawlauncher') {
      ctx.fillStyle =
        wepId === 'tesla' || wepId === 'plasma' || evolved ? '#38bdf8' : '#fde047';
      ctx.beginPath();
      ctx.moveTo(muzzleTipX, 0);
      ctx.lineTo(muzzleTipX + 24, -11);
      ctx.lineTo(muzzleTipX + 15, 0);
      ctx.lineTo(muzzleTipX + 24, 11);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  private drawSpinningSawDisc(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    spinAngle: number,
    bladeColor: string,
    hubColor: string
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(spinAngle);

    const teeth = 8;
    ctx.fillStyle = bladeColor;
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    for (let i = 0; i < teeth; i++) {
      const a0 = (i / teeth) * Math.PI * 2;
      const aTip = a0 + (0.55 / teeth) * Math.PI * 2;
      const a1 = ((i + 1) / teeth) * Math.PI * 2;
      const innerR = radius * 0.72;
      if (i === 0) {
        ctx.moveTo(Math.cos(a0) * innerR, Math.sin(a0) * innerR);
      }
      ctx.lineTo(Math.cos(aTip) * radius, Math.sin(aTip) * radius);
      ctx.lineTo(Math.cos(a1) * innerR, Math.sin(a1) * innerR);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = hubColor;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawForearmToHand(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    hx: number,
    hy: number
  ): void {
    ctx.strokeStyle = '#090d16';
    ctx.lineCap = 'round';
    ctx.lineWidth = 9.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(hx, hy);
    ctx.stroke();

    // 战术深藏青作战服衣袖
    ctx.strokeStyle = '#243042';
    ctx.lineWidth = 5.6;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(hx, hy);
    ctx.stroke();

    // 橄榄卡其护肘块
    const ex = sx + (hx - sx) * 0.42;
    const ey = sy + (hy - sy) * 0.42;
    ctx.fillStyle = '#757459';
    ctx.beginPath();
    ctx.arc(ex, ey, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawGlovedHand(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.fillStyle = '#3f3f37';
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(x, y, 4.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // ==================== 投掷物、极速子弹曳光与粒子 ====================

  private drawGrenades(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    const grenImg = Assets.getSprite('prop_grenade');
    const grenFlash = Assets.getWhiteFlash('prop_grenade');

    for (const g of state.grenadesThrown) {
      if (!this.inView(g.x, g.y, g.radius + 20)) continue;
      const progress = Math.max(0, Math.min(1, 1 - g.fuse / Math.max(0.1, g.maxFuse || 1.05)));
      const urgent = g.fuse < 0.36;

      ctx.save();
      // 1. 地面战术爆炸杀伤范围预警圈（随引信倒计时收缩聚能，临爆高频红光警示！）
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.radius, 0, Math.PI * 2);
      ctx.fillStyle = urgent ? 'rgba(239, 68, 68, 0.12)' : 'rgba(239, 68, 68, 0.05)';
      ctx.fill();
      ctx.lineWidth = urgent ? 2.2 : 1.4;
      ctx.strokeStyle = urgent ? 'rgba(248, 113, 113, 0.62)' : 'rgba(248, 113, 113, 0.28)';
      ctx.setLineDash([10, 8]);
      ctx.stroke();
      ctx.setLineDash([]);

      // 内圈充能扩散进度环
      ctx.beginPath();
      ctx.arc(g.x, g.y, Math.max(8, g.radius * progress), 0, Math.PI * 2);
      ctx.strokeStyle = urgent ? 'rgba(254, 240, 138, 0.55)' : 'rgba(251, 146, 60, 0.28)';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // 2. 随抛物线高度动态缩放的真实地面投影
      const shadowScale = Math.max(0.45, 1 - g.z / 120);
      ctx.beginPath();
      ctx.ellipse(g.x + 2, g.y + 5, 12 * shadowScale, 6.5 * shadowScale, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(2, 6, 23, ${0.48 * shadowScale})`;
      ctx.fill();

      // 3. 空中旋转高精度 M67 铸铁破片手雷贴图 + 引信红热火花
      const drawSz = 30 + Math.min(10, g.z * 0.14);
      ctx.translate(g.x, g.y - g.z);
      ctx.rotate(g.spinAngle);

      if (grenImg) {
        ctx.drawImage(grenImg, -drawSz / 2, -drawSz / 2, drawSz, drawSz);
        if (urgent && Math.floor(g.fuse * 18) % 2 === 0 && grenFlash) {
          ctx.globalAlpha = 0.48;
          ctx.drawImage(grenFlash, -drawSz / 2, -drawSz / 2, drawSz, drawSz);
          ctx.globalAlpha = 1;
        }
      } else {
        ctx.fillStyle = '#3f6212';
        ctx.strokeStyle = '#090d16';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.ellipse(0, 0, 8, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // 引信颈部闪烁火星
      ctx.fillStyle = Math.floor(g.fuse * 22) % 2 === 0 ? '#fef08a' : '#ef4444';
      ctx.beginPath();
      ctx.arc(2, -drawSz * 0.36, urgent ? 4.2 : 2.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  private drawBulletsAndFX(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    const now = performance.now();

    // 0. 多层立体高爆火球 + 超音速冲击波扩散光环（彻底告别简陋小圆点爆炸！）
    for (const ex of state.explosions) {
      if (!this.inView(ex.x, ex.y, ex.radius + 45)) continue;
      const t = 1 - ex.life / ex.maxLife; // 0 -> 1
      const shockR = ex.radius * (0.22 + 0.88 * Math.pow(t, 0.55));
      const fireR = ex.radius * (t < 0.32 ? (t / 0.32) * 0.78 : 0.78 * (1 - (t - 0.32) * 0.45));
      const alpha = Math.max(0, 1 - Math.pow(t, 1.35));

      ctx.save();
      ctx.translate(ex.x, ex.y);

      // 外层超音速空气折射冲击波环
      ctx.beginPath();
      ctx.arc(0, 0, shockR, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(254, 243, 199, ${alpha * 0.78})`;
      ctx.lineWidth = Math.max(2, (1 - t) * 10);
      ctx.stroke();

      // 初爆瞬间锋利爆裂星芒尖刺
      if (t < 0.38) {
        const spikeAlpha = (1 - t / 0.38) * 0.85;
        ctx.fillStyle = `rgba(254, 240, 138, ${spikeAlpha})`;
        ctx.beginPath();
        const spikes = 9;
        for (let i = 0; i < spikes * 2; i++) {
          const ang = (i / (spikes * 2)) * Math.PI * 2 + ex.seed;
          const rad = i % 2 === 0 ? ex.radius * 0.85 * (0.5 + t) : ex.radius * 0.28;
          if (i === 0) ctx.moveTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
          else ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
        }
        ctx.closePath();
        ctx.fill();
      }

      // 立体炽白→烈焰橙→暗红滚滚火球核心
      if (fireR > 4) {
        const fg = ctx.createRadialGradient(0, 0, fireR * 0.08, 0, 0, fireR);
        fg.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
        fg.addColorStop(0.28, `rgba(254, 240, 138, ${alpha * 0.95})`);
        fg.addColorStop(0.62, `rgba(249, 115, 22, ${alpha * 0.82})`);
        fg.addColorStop(0.88, `rgba(185, 28, 28, ${alpha * 0.45})`);
        fg.addColorStop(1, 'rgba(30, 41, 59, 0)');
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.arc(0, 0, fireR, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    for (const b of state.bullets) {
      if (!this.inView(b.x, b.y, 65)) continue;
      const ang = Math.atan2(b.vy, b.vx);
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(ang);

      if (b.sawblade) {
        ctx.globalAlpha = 0.34;
        ctx.strokeStyle = b.color;
        ctx.lineWidth = b.radius * 1.45;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-26, 0);
        ctx.lineTo(0, 0);
        ctx.stroke();
        ctx.globalAlpha = 1;
        this.drawSpinningSawDisc(
          ctx,
          0,
          0,
          b.radius * 1.18,
          now * 0.026,
          b.color === '#fb7185' ? '#fda4af' : '#f8fafc',
          b.color === '#fb7185' ? '#facc15' : '#ef4444'
        );
        ctx.restore();
        continue;
      }

      if (b.cryo) {
        ctx.beginPath();
        ctx.arc(0, 0, b.radius * 1.9, 0, Math.PI * 2);
        ctx.fillStyle = b.color === '#60a5fa' ? 'rgba(96, 165, 250, 0.58)' : 'rgba(103, 232, 249, 0.56)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, 0, b.radius * 0.92, 0, Math.PI * 2);
        ctx.fillStyle = '#f0f9ff';
        ctx.fill();
        ctx.restore();
        continue;
      }

      if (b.flame) {
        ctx.beginPath();
        ctx.arc(0, 0, b.radius * 2.0, 0, Math.PI * 2);
        ctx.fillStyle = b.color === '#38bdf8' ? 'rgba(56, 189, 248, 0.68)' : 'rgba(249, 115, 22, 0.72)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, 0, b.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#fef08a';
        ctx.fill();
        ctx.restore();
        continue;
      }

      if (b.explosiveRadius > 0) {
        // 40mm 尾翼高爆榴弹/爆破弹头（推进尾焰 + 浓烟拖尾 + 军绿弹体 + 红金引信尖锥！）
        const smokeGrad = ctx.createLinearGradient(-44, 0, -6, 0);
        smokeGrad.addColorStop(0, 'rgba(148, 163, 184, 0)');
        smokeGrad.addColorStop(0.65, 'rgba(203, 213, 225, 0.36)');
        smokeGrad.addColorStop(1, 'rgba(251, 146, 60, 0.72)');
        ctx.strokeStyle = smokeGrad;
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-42, 0);
        ctx.lineTo(-7, 0);
        ctx.stroke();

        // 尾部推进喷火核
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.moveTo(-8, -3.2);
        ctx.lineTo(-18 - Math.sin(now * 0.06) * 4, 0);
        ctx.lineTo(-8, 3.2);
        ctx.closePath();
        ctx.fill();

        // 稳定尾翼
        ctx.fillStyle = '#334155';
        ctx.strokeStyle = '#090d16';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(-6, -3);
        ctx.lineTo(-11, -7);
        ctx.lineTo(-4, -3);
        ctx.moveTo(-6, 3);
        ctx.lineTo(-11, 7);
        ctx.lineTo(-4, 3);
        ctx.stroke();

        // 圆柱金属弹体 + 金色高爆铜环 + 赤红尖拱弹头
        ctx.fillStyle = '#3f6212';
        ctx.strokeStyle = '#090d16';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.roundRect(-8, -4.4, 13, 8.8, 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#facc15';
        ctx.fillRect(1, -4.2, 3, 8.4);

        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.moveTo(5, -4.3);
        ctx.quadraticCurveTo(13, 0, 5, 4.3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.restore();
        continue;
      }

      const trailLen = b.laser ? 56 : 28;
      ctx.globalAlpha = 0.48;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = b.radius * 1.95;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-trailLen, 0);
      ctx.lineTo(2, 0);
      ctx.stroke();

      ctx.globalAlpha = 1;
      const len = b.laser ? 26 : 13;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.roundRect(-len / 2, -b.radius * 0.78, len, b.radius * 1.56, 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    for (const arc of state.lightnings) {
      if (arc.points.length < 2) continue;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(arc.points[0].x, arc.points[0].y);
      for (let i = 1; i < arc.points.length; i++) {
        ctx.lineTo(
          arc.points[i].x + (Math.random() - 0.5) * 10,
          arc.points[i].y + (Math.random() - 0.5) * 10
        );
      }
      ctx.strokeStyle = arc.color;
      ctx.lineWidth = 4.5;
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.restore();
    }

    for (const pt of state.particles) {
      if (!this.inView(pt.x, pt.y, 26)) continue;
      const lifeRatio = Math.max(0, pt.life / pt.maxLife);
      ctx.save();
      ctx.globalAlpha = lifeRatio;
      if (pt.isShell) {
        // 抛壳窗飞旋黄铜弹壳
        ctx.translate(pt.x, pt.y);
        ctx.rotate((pt.angle || 0) + pt.life * 16);
        ctx.fillStyle = '#f59e0b';
        ctx.strokeStyle = '#451a03';
        ctx.lineWidth = 1.1;
        ctx.fillRect(-3.5, -1.5, 7, 3);
        ctx.strokeRect(-3.5, -1.5, 7, 3);
        ctx.fillStyle = '#fef3c7';
        ctx.fillRect(-2.5, -1, 4, 1);
      } else if (pt.isShard) {
        // 爆炸高热破片流光棱刺
        ctx.translate(pt.x, pt.y);
        ctx.rotate(Math.atan2(pt.vy, pt.vx));
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.moveTo(pt.size * 1.8, 0);
        ctx.lineTo(-pt.size * 1.4, -pt.size * 0.55);
        ctx.lineTo(-pt.size * 1.4, pt.size * 0.55);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    for (const ft of state.floatingTexts) {
      if (!this.inView(ft.x, ft.y, 60)) continue;
      ctx.save();
      ctx.globalAlpha = Math.min(1, (ft.life / ft.maxLife) * 1.6);
      this.drawCachedLabel(ctx, ft.text, ft.x, ft.y, ft.color, Math.round(14 * ft.scale));
      ctx.restore();
    }
  }

  // ==================== 屏幕层紧凑战术雷达与指示器 ====================

  private drawTacticalMinimap(
    ctx: CanvasRenderingContext2D,
    viewW: number,
    viewH: number,
    state: RunSnapshot,
    usingTouch: boolean
  ): void {
    const mobileLandscape = usingTouch || viewH < 520 || viewW < 920;
    const mapW = mobileLandscape ? 104 : 144;
    const mapH = mobileLandscape ? 72 : 104;
    // 全面屏横屏避开左侧刘海/挖孔安全区，并上移至左上角血条下方避开左拇指摇杆区
    const ultraWide = viewW / Math.max(1, viewH) > 1.9;
    const mx = mobileLandscape ? (ultraWide ? 34 : 12) : 12;
    const hasRelics = state.relicIds.length > 0;
    const my = mobileLandscape ? (hasRelics ? 70 : 44) : viewH - mapH - 12;
    const bb = state.stage.buildingBounds;
    const scale = Math.min((mapW - 14) / bb.w, (mapH - 14) / bb.h);
    const ox = mx + (mapW - bb.w * scale) / 2 - bb.x * scale;
    const oy = my + (mapH - bb.h * scale) / 2 - bb.y * scale;

    ctx.save();
    ctx.fillStyle = 'rgba(9, 14, 23, 0.84)';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(mx, my, mapW, mapH, 8);
    ctx.fill();
    ctx.stroke();

    for (const room of state.rooms) {
      ctx.fillStyle = room.unlocked ? 'rgba(148, 163, 184, 0.42)' : 'rgba(30, 41, 59, 0.55)';
      for (const r of room.rects) {
        ctx.fillRect(ox + r.x * scale, oy + r.y * scale, r.w * scale, r.h * scale);
      }
    }

    for (const d of state.doors) {
      if (d.unlocked) continue;
      ctx.fillStyle = '#eab308';
      ctx.fillRect(ox + d.x * scale - 1, oy + d.y * scale - 1, Math.max(3, d.w * scale), Math.max(3, d.h * scale));
    }

    for (const w of state.windows) {
      if (w.planks > 0) continue;
      ctx.fillStyle = '#fb7185';
      ctx.fillRect(ox + (w.x + w.w / 2) * scale - 2, oy + (w.y + w.h / 2) * scale - 2, 4, 4);
    }

    for (const st of state.stations) {
      if (st.type === 'armory_kiosk') {
        const rm = state.rooms.find((r) => r.id === st.roomId);
        if (rm?.unlocked) {
          ctx.fillStyle = '#10b981';
          ctx.fillRect(ox + st.x * scale - 2.5, oy + st.y * scale - 2.5, 5, 5);
        }
      }
    }

    for (const c of state.chests) {
      ctx.fillStyle = '#fde047';
      ctx.fillRect(ox + c.x * scale - 2.5, oy + c.y * scale - 2.5, 5, 5);
    }

    ctx.fillStyle = '#ef4444';
    for (const z of state.zombies) {
      const sz = z.kind === 'boss' ? 5 : 3.2;
      ctx.fillRect(ox + z.x * scale - sz / 2, oy + z.y * scale - sz / 2, sz, sz);
    }

    ctx.fillStyle = '#4ade80';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ox + state.player.x * scale, oy + state.player.y * scale, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  private drawOffscreenIndicators(
    ctx: CanvasRenderingContext2D,
    viewW: number,
    viewH: number,
    state: RunSnapshot
  ): void {
    const zoom = state.camera.zoom;
    const targets: { x: number; y: number; tag: string; color: string }[] = [];
    for (const c of state.chests) {
      targets.push({ x: c.x, y: c.y, tag: '箱', color: '#f59e0b' });
    }
    for (const z of state.zombies) {
      if (z.kind === 'thief') targets.push({ x: z.x, y: z.y, tag: '$', color: '#fde047' });
      else if (z.kind === 'boss') targets.push({ x: z.x, y: z.y, tag: 'BOSS', color: '#ef4444' });
    }
    if (state.waveState === 'extraction') {
      targets.push({ x: state.stage.helipadPos.x, y: state.stage.helipadPos.y, tag: 'H', color: '#4ade80' });
    }

    const halfW = viewW / (2 * zoom) - 40;
    const halfH = viewH / (2 * zoom) - 50;
    for (const t of targets) {
      const dx = t.x - state.camera.x;
      const dy = t.y - state.camera.y;
      if (Math.abs(dx) <= halfW && Math.abs(dy) <= halfH) continue;
      const angle = Math.atan2(dy, dx);
      const ix = viewW / 2 + Math.cos(angle) * Math.min(viewW / 2 - 44, 320);
      const iy = viewH / 2 + Math.sin(angle) * Math.min(viewH / 2 - 58, 195);
      ctx.save();
      ctx.beginPath();
      ctx.arc(ix, iy, 15, 0, Math.PI * 2);
      ctx.fillStyle = t.color;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#090d16';
      ctx.stroke();
      this.drawCachedLabel(ctx, t.tag, ix, iy, '#ffffff', 10);
      ctx.restore();
    }
  }

  private drawTouchSticks(
    ctx: CanvasRenderingContext2D,
    viewW: number,
    viewH: number,
    state: RunSnapshot,
    input: InputManager
  ): void {
    // 触屏首波起步前轻量化手势引导圈（一移动即自动消隐，零弹窗遮挡）
    if (
      input.usingTouch &&
      state.wave === 1 &&
      state.player.walkPhase < 1.2 &&
      !input.moveStick.active &&
      !input.aimStick.active
    ) {
      const pulse = 0.28 + Math.sin(performance.now() * 0.005) * 0.08;
      const leftY = Math.min(viewH - 86, Math.max(viewH * 0.66, 190));
      const rightY = Math.min(viewH - 135, Math.max(viewH * 0.48, 150));
      const leftX = Math.min(110, viewW * 0.2);
      const rightX = Math.min(viewW - 150, viewW * 0.7);

      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 2;

      ctx.strokeStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(leftX, leftY, 38, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(rightX, rightY, 38, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.globalAlpha = Math.min(0.75, pulse * 2.1);
      this.drawCachedLabel(ctx, '左手移动', leftX, leftY, '#bae6fd', 11);
      this.drawCachedLabel(ctx, '右手瞄准', rightX, rightY, '#fde68a', 11);
      ctx.restore();
    }

    const outerR = Math.min(viewW, viewH) < 420 ? 42 : 48;
    const innerR = Math.min(viewW, viewH) < 420 ? 18 : 21;

    const sticks: { stick: typeof input.moveStick; ringColor: string; nubColor: string; isAim: boolean }[] = [
      { stick: input.moveStick, ringColor: 'rgba(56, 189, 248, 0.78)', nubColor: 'rgba(125, 211, 252, 0.92)', isAim: false },
      { stick: input.aimStick, ringColor: 'rgba(251, 191, 36, 0.82)', nubColor: 'rgba(250, 204, 21, 0.94)', isAim: true },
    ];

    for (const item of sticks) {
      const { stick, ringColor, nubColor, isAim } = item;
      if (!stick.active) continue;
      ctx.save();

      ctx.beginPath();
      ctx.arc(stick.startX, stick.startY, outerR, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(9, 14, 23, 0.36)';
      ctx.fill();
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = ringColor;
      ctx.stroke();

      // 摇杆连线与准星刻度
      if (stick.curX !== stick.startX || stick.curY !== stick.startY) {
        ctx.beginPath();
        ctx.moveTo(stick.startX, stick.startY);
        ctx.lineTo(stick.curX, stick.curY);
        ctx.lineWidth = 3;
        ctx.strokeStyle = isAim ? 'rgba(251, 191, 36, 0.55)' : 'rgba(56, 189, 248, 0.5)';
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(stick.curX, stick.curY, innerR, 0, Math.PI * 2);
      ctx.fillStyle = nubColor;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#0f172a';
      ctx.stroke();

      ctx.restore();
    }
  }

  // ==================== 精灵与缓存文字工具 ====================

  private drawCenteredSprite(
    ctx: CanvasRenderingContext2D,
    key: SpriteKey,
    x: number,
    y: number,
    size: number,
    angle: number
  ): void {
    const img = Assets.getSprite(key);
    ctx.save();
    ctx.translate(x, y);
    if (angle) ctx.rotate(angle);
    if (img) {
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
    } else {
      ctx.fillStyle = '#eab308';
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawEntitySpriteWithFlash(
    ctx: CanvasRenderingContext2D,
    key: SpriteKey,
    size: number,
    angle: number,
    scaleX: number,
    scaleY: number,
    flash: boolean
  ): void {
    const img = Assets.getSprite(key);
    ctx.save();
    if (angle) ctx.rotate(angle);
    ctx.scale(scaleX, scaleY);
    if (img) {
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
      if (flash) {
        const sil = Assets.getWhiteFlash(key);
        if (sil) {
          ctx.globalAlpha = 0.72;
          ctx.drawImage(sil, -size / 2, -size / 2, size, size);
        }
      }
    }
    ctx.restore();
  }

  private drawCachedLabel(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    fill: string,
    fontSize: number
  ): void {
    const key = `${fontSize}|${fill}|${text}`;
    let badge = this.labelCache.get(key);
    if (!badge) {
      while (this.labelCache.size >= 380) {
        const oldestKey = this.labelCache.keys().next().value;
        if (oldestKey === undefined) break;
        this.labelCache.delete(oldestKey);
      }
      badge = document.createElement('canvas');
      const bctx = badge.getContext('2d')!;
      const scale = 1.5;
      const font = `900 ${fontSize}px system-ui, -apple-system, sans-serif`;
      bctx.font = font;
      const metrics = bctx.measureText(text);
      const w = Math.ceil(metrics.width + 14);
      const h = Math.ceil(fontSize * 1.45 + 8);
      badge.width = Math.ceil(w * scale);
      badge.height = Math.ceil(h * scale);

      bctx.scale(scale, scale);
      bctx.font = font;
      bctx.textAlign = 'center';
      bctx.textBaseline = 'middle';
      bctx.lineJoin = 'round';
      bctx.lineWidth = 3.8;
      bctx.strokeStyle = '#090d16';
      bctx.strokeText(text, w / 2, h / 2);
      bctx.fillStyle = fill;
      bctx.fillText(text, w / 2, h / 2);
      this.labelCache.set(key, badge);
    }

    const lw = badge.width / 1.5;
    const lh = badge.height / 1.5;
    ctx.drawImage(badge, x - lw / 2, y - lh / 2, lw, lh);
  }
}
