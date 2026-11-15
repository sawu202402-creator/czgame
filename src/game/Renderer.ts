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
};

const MAP_PAD = 560;

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

    // 11. 屏幕层：左下角紧凑雷达小地图、屏幕外目标箭头、触屏摇杆
    this.drawTacticalMinimap(ctx, viewW, viewH, state);
    this.drawOffscreenIndicators(ctx, viewW, viewH, state);
    this.drawTouchSticks(ctx, input);
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

    // B2. 破窗外侧丧尸突袭泥泞血迹通道、碎玻璃渣与两侧沙袋掩体
    this.bakeExteriorSiegeDetails(mctx, state, allRoomRects, stageSeed);

    // C. 各房间高精度石材/钢板/实验室地砖 + 内嵌地脚线 + 战术标线 + 排水格栅 + 地面动力线缆
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

        // 房间内侧战术装饰地垫/警戒标线/地漏格栅
        this.bakeRoomFloorMarkings(mctx, room.floorTheme, r, stageSeed);
      }

      if (room.unlocked) {
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

      // 特警装甲车红蓝爆闪灯地面环境反光 / 喷泉水波蓝光晕
      if (pr.kind === 'swat_van') {
        const rg = mctx.createRadialGradient(8, -26, 4, 8, -26, 68);
        rg.addColorStop(0, 'rgba(239, 68, 68, 0.22)');
        rg.addColorStop(1, 'rgba(239, 68, 68, 0)');
        mctx.fillStyle = rg;
        mctx.fillRect(-70, -95, 150, 140);

        const bg = mctx.createRadialGradient(8, 26, 4, 8, 26, 68);
        bg.addColorStop(0, 'rgba(59, 130, 246, 0.22)');
        bg.addColorStop(1, 'rgba(59, 130, 246, 0)');
        mctx.fillStyle = bg;
        mctx.fillRect(-70, -45, 150, 140);
      } else if (pr.kind === 'fountain') {
        const fg = mctx.createRadialGradient(0, 0, pr.w * 0.2, 0, 0, pr.w * 0.72);
        fg.addColorStop(0, 'rgba(56, 189, 248, 0.16)');
        fg.addColorStop(1, 'rgba(56, 189, 248, 0)');
        mctx.fillStyle = fg;
        mctx.beginPath();
        mctx.arc(0, 0, pr.w * 0.72, 0, Math.PI * 2);
        mctx.fill();
      }

      // 柔和接地 AO + 定向投影
      mctx.fillStyle = 'rgba(2, 6, 23, 0.42)';
      mctx.beginPath();
      if (pr.kind === 'fountain') {
        mctx.arc(5, 7, pr.w * 0.49, 0, Math.PI * 2);
      } else {
        mctx.roundRect(-pr.w / 2 + 5, -pr.h / 2 + 7, pr.w + 2, pr.h + 2, 10);
      }
      mctx.fill();

      const scaleMult = pr.kind === 'desk' ? 1.24 : pr.kind === 'swat_van' ? 1.12 : 1.08;
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

  private bakeExteriorSiegeDetails(
    mctx: CanvasRenderingContext2D,
    state: RunSnapshot,
    allRoomRects: Rect[],
    stageSeed: number
  ): void {
    // 1. 每扇破窗外侧：丧尸冲锋泥泞血痕路径、散落碎玻璃与两侧战术沙袋堆
    for (const win of state.windows) {
      const wcx = win.x + win.w / 2;
      const wcy = win.y + win.h / 2;
      const ox = wcx + win.spawnOutsideOffset.dx;
      const oy = wcy + win.spawnOutsideOffset.dy;

      // 从地图外围边缘一路延伸至破窗的泥泞尸潮踩踏土路（直观提示户外来袭方向！）
      const mudGrad = mctx.createLinearGradient(ox, oy, wcx, wcy);
      mudGrad.addColorStop(0, 'rgba(15, 12, 10, 0.05)');
      mudGrad.addColorStop(0.25, 'rgba(24, 18, 14, 0.28)');
      mudGrad.addColorStop(0.75, 'rgba(28, 18, 14, 0.38)');
      mudGrad.addColorStop(1, 'rgba(38, 16, 16, 0.48)');
      mctx.strokeStyle = mudGrad;
      mctx.lineWidth = 64;
      mctx.lineCap = 'round';
      mctx.beginPath();
      mctx.moveTo(ox, oy);
      mctx.lineTo(wcx, wcy);
      mctx.stroke();

      // 土路两侧车辙/踩踏暗痕
      const rutPerpX = win.spawnOutsideOffset.dy !== 0 ? 1 : 0;
      const rutPerpY = win.spawnOutsideOffset.dx !== 0 ? 1 : 0;
      mctx.strokeStyle = 'rgba(12, 10, 8, 0.22)';
      mctx.lineWidth = 6;
      mctx.setLineDash([18, 14]);
      for (const rSide of [-18, 18]) {
        mctx.beginPath();
        mctx.moveTo(ox + rutPerpX * rSide, oy + rutPerpY * rSide);
        mctx.lineTo(wcx + rutPerpX * rSide, wcy + rutPerpY * rSide);
        mctx.stroke();
      }
      mctx.setLineDash([]);

      // 窗台内外散落的反光碎玻璃碴
      const nx = Math.sign(win.spawnOutsideOffset.dx);
      const ny = Math.sign(win.spawnOutsideOffset.dy);
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
        const sbx = wcx + nx * 46 + perpX * side * 66;
        const sby = wcy + ny * 46 + perpY * side * 66;
        if (!pointInAnyRect(sbx, sby, allRoomRects, 14)) {
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

    // 2. 户外远端荒野：俯视暗调针叶灌木丛与战术混凝土拒马（严格避开所有房间及整条地图边缘至窗户的冲锋通道！）
    const bb = state.stage.buildingBounds;
    for (let gy = bb.y - 460; gy <= bb.y + bb.h + 460; gy += 160) {
      for (let gx = bb.x - 460; gx <= bb.x + bb.w + 460; gx += 160) {
        const r1 = hash2D(gx, gy, stageSeed + 101);
        if (r1 < 0.42) continue;
        const tx = gx + (hash2D(gx, gy, stageSeed + 109) - 0.5) * 95;
        const ty = gy + (hash2D(gy, gx, stageSeed + 113) - 0.5) * 95;
        if (pointInAnyRect(tx, ty, allRoomRects, 96)) continue;

        let nearWindowLane = false;
        for (const win of state.windows) {
          const wcx = win.x + win.w / 2;
          const wcy = win.y + win.h / 2;
          const ox = wcx + win.spawnOutsideOffset.dx;
          const oy = wcy + win.spawnOutsideOffset.dy;
          const segDx = ox - wcx;
          const segDy = oy - wcy;
          const segLenSq = segDx * segDx + segDy * segDy || 1;
          const proj = Math.max(0, Math.min(1, ((tx - wcx) * segDx + (ty - wcy) * segDy) / segLenSq));
          const distToLane = Math.hypot(tx - (wcx + segDx * proj), ty - (wcy + segDy * proj));
          if (distToLane < 94) {
            nearWindowLane = true;
            break;
          }
        }
        if (nearWindowLane) continue;

        if (r1 > 0.72) {
          this.bakeTopDownShrubCluster(mctx, tx, ty, 24 + r1 * 18, stageSeed + gx);
        } else if (r1 > 0.58) {
          this.bakeJerseyBarrier(mctx, tx, ty, r1 * Math.PI);
        }
      }
    }
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
    // 室内外周内嵌暗色金属收边条（让地板拥有建筑镶边细节）
    mctx.strokeStyle = 'rgba(15, 23, 42, 0.32)';
    mctx.lineWidth = 2;
    mctx.strokeRect(r.x + 18, r.y + 18, Math.max(0, r.w - 36), Math.max(0, r.h - 36));

    if (theme === 'lobby' && r.w >= 300 && r.h >= 240) {
      // 接待大厅中央深蓝战术防尘地毯边框与徽记线
      const rw = Math.min(250, r.w * 0.42);
      const rh = Math.min(150, r.h * 0.36);
      const rx = r.x + (r.w - rw) / 2;
      const ry = r.y + (r.h - rh) / 2;
      mctx.fillStyle = 'rgba(15, 23, 42, 0.24)';
      mctx.beginPath();
      mctx.roundRect(rx, ry, rw, rh, 6);
      mctx.fill();
      mctx.strokeStyle = 'rgba(234, 179, 8, 0.32)';
      mctx.lineWidth = 2;
      mctx.strokeRect(rx + 6, ry + 6, rw - 12, rh - 12);
    } else if (theme === 'armory' || theme === 'asphalt') {
      // 工业区与停机坪黄黑安全警戒虚线与金属排水地漏
      mctx.save();
      mctx.strokeStyle = 'rgba(234, 179, 8, 0.22)';
      mctx.lineWidth = 3;
      mctx.setLineDash([16, 12]);
      mctx.strokeRect(r.x + 28, r.y + 28, Math.max(0, r.w - 56), Math.max(0, r.h - 56));
      mctx.restore();

      if (r.w >= 220 && r.h >= 200) {
        const gx = r.x + r.w * 0.5 - 26;
        const gy = r.y + r.h * 0.78 - 9;
        this.bakeFloorGrate(mctx, gx, gy, 52, 18);
      }
    } else if (theme === 'lab') {
      // 实验室高能蓝光导流槽节点
      mctx.strokeStyle = 'rgba(56, 189, 248, 0.16)';
      mctx.lineWidth = 2;
      mctx.strokeRect(r.x + 26, r.y + 26, Math.max(0, r.w - 52), Math.max(0, r.h - 52));
    }

    // 自然地面微磨损暗斑（2~3处极柔和做旧痕迹，提升真实战场质感）
    const wearCount = Math.min(4, Math.floor((r.w * r.h) / 95000) + 1);
    for (let i = 0; i < wearCount; i++) {
      const wx = r.x + 45 + hash2D(r.x + i * 31, r.y, seed) * Math.max(20, r.w - 90);
      const wy = r.y + 45 + hash2D(r.y + i * 47, r.x, seed + 13) * Math.max(20, r.h - 90);
      const wr = 28 + hash2D(wx, wy, seed + 29) * 38;
      const wg = mctx.createRadialGradient(wx, wy, 2, wx, wy, wr);
      wg.addColorStop(0, 'rgba(9, 13, 22, 0.18)');
      wg.addColorStop(1, 'rgba(9, 13, 22, 0)');
      mctx.fillStyle = wg;
      mctx.beginPath();
      mctx.arc(wx, wy, wr, 0, Math.PI * 2);
      mctx.fill();
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
      if (!this.inView(dc.x, dc.y, 40)) continue;
      ctx.save();
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

      this.drawCachedLabel(ctx, st.label, st.x, st.y - 41, '#ffffff', 11);
      if (priceTag) {
        this.drawCachedLabel(ctx, priceTag, st.x, st.y + 41, '#fde047', 11);
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
        const cx = win.x + win.w / 2;
        const cy = win.y + win.h / 2;
        const blink = 0.45 + Math.sin(performance.now() * 0.012) * 0.35;
        ctx.fillStyle = `rgba(239, 68, 68, ${blink})`;
        ctx.fillRect(win.x + 3, win.y + 3, win.w - 6, win.h - 6);
        this.drawCachedLabel(ctx, '破窗!', cx, cy, '#fecaca', 11);
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
      this.drawCachedLabel(ctx, door.label, cx, cy - 13, '#f8fafc', 11);
      this.drawCachedLabel(
        ctx,
        `$${door.cost}`,
        cx,
        cy + 13,
        state.cash >= door.cost ? '#86efac' : '#fde047',
        12
      );
      ctx.restore();
    }
  }

  private drawDropsAndChests(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    const now = performance.now() * 0.006;
    for (const d of state.drops) {
      if (!this.inView(d.x, d.y, 40)) continue;
      const bob = Math.sin(now + d.bobPhase) * 2.5;
      ctx.save();
      ctx.translate(d.x, d.y + bob);
      if (d.kind === 'cash') {
        ctx.fillStyle = 'rgba(2, 6, 23, 0.35)';
        ctx.fillRect(-9, -4, 20, 14);
        ctx.fillStyle = '#15803d';
        ctx.strokeStyle = '#052e16';
        ctx.lineWidth = 2.2;
        ctx.fillRect(-10, -7, 20, 14);
        ctx.strokeRect(-10, -7, 20, 14);
        ctx.fillStyle = '#86efac';
        ctx.fillRect(-3, -7, 6, 14);
        this.drawCachedLabel(ctx, '$', 0, 0, '#fef08a', 11);
      } else if (d.kind === 'xp') {
        ctx.fillStyle = '#0284c7';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(7.5, 0);
        ctx.lineTo(0, 8);
        ctx.lineTo(-7.5, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (d.kind === 'powerup' && d.powerUp) {
        const meta = POWERUP_META[d.powerUp];
        ctx.beginPath();
        ctx.arc(0, 0, 15, 0, Math.PI * 2);
        ctx.fillStyle = meta.color;
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        this.drawCachedLabel(ctx, meta.name, 0, -21, '#fef08a', 11);
      }
      ctx.restore();
    }

    for (const c of state.chests) {
      if (!this.inView(c.x, c.y, 65)) continue;
      const bounce = Math.abs(Math.sin(now * 1.25 + c.bobPhase)) * 4;
      ctx.save();
      ctx.beginPath();
      ctx.arc(c.x, c.y, 30, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(245, 158, 11, 0.24)';
      ctx.fill();

      this.drawCenteredSprite(ctx, 'prop_chest', c.x, c.y - bounce, 52, 0);

      if (c.progress > 0) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, 33, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * c.progress);
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 5;
        ctx.stroke();
      }
      this.drawCachedLabel(ctx, '特战补给箱', c.x, c.y - 36 - bounce, '#fef08a', 11);
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
      this.drawCachedLabel(ctx, `哨戒炮 ${t.life.toFixed(0)}s`, t.x, t.y - 30, '#7dd3fc', 10);
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
      this.drawCachedLabel(ctx, '机械警犬', d.x, d.y - 26, '#bae6fd', 10);
      ctx.restore();
    }
  }

  // ==================== 写实俯视僵尸群 ====================

  private drawZombies(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    const frozen = state.powerUpTimers.freeze > 0;
    for (const z of state.zombies) {
      if (!this.inView(z.x, z.y, 115)) continue;
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
      if (!this.inView(s.x, s.y, 28)) continue;
      const isBossOrb = s.radius >= 9;
      ctx.save();
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius + 4, 0, Math.PI * 2);
      ctx.fillStyle = isBossOrb ? 'rgba(244, 63, 94, 0.44)' : 'rgba(163, 230, 53, 0.38)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
      ctx.fillStyle = isBossOrb ? '#fb7185' : '#a3e635';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = isBossOrb ? '#4c0519' : '#1a2e05';
      ctx.stroke();
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
    for (const g of state.grenadesThrown) {
      if (!this.inView(g.x, g.y, 40)) continue;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(g.x, g.y + 4, 8, 4, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(2, 6, 23, 0.42)';
      ctx.fill();

      ctx.translate(g.x, g.y - g.z);
      ctx.beginPath();
      ctx.arc(0, 0, 8.5, 0, Math.PI * 2);
      ctx.fillStyle = Math.floor(g.fuse * 10) % 2 === 0 ? '#ef4444' : '#3f6212';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#090d16';
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawBulletsAndFX(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    const now = performance.now();
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

      const trailLen = b.laser ? 56 : b.explosiveRadius > 0 ? 22 : 28;
      ctx.globalAlpha = 0.48;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = b.radius * 1.95;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-trailLen, 0);
      ctx.lineTo(2, 0);
      ctx.stroke();

      ctx.globalAlpha = 1;
      const len = b.laser ? 26 : b.explosiveRadius > 0 ? 14 : 12;
      ctx.fillStyle = b.explosiveRadius > 0 ? '#facc15' : '#ffffff';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 1.8;
      ctx.fillRect(-len / 2, -b.radius * 0.85, len, b.radius * 1.7);
      ctx.strokeRect(-len / 2, -b.radius * 0.85, len, b.radius * 1.7);
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
      if (!this.inView(pt.x, pt.y, 20)) continue;
      ctx.save();
      ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
      ctx.fill();
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
    state: RunSnapshot
  ): void {
    const compact = viewW < 760 || viewH < 500;
    const mapW = compact ? 102 : 144;
    const mapH = compact ? 74 : 104;
    const mx = compact ? 8 : 12;
    const my = compact ? viewH - mapH - 54 : viewH - mapH - 12;
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

  private drawTouchSticks(ctx: CanvasRenderingContext2D, input: InputManager): void {
    for (const stick of [input.moveStick, input.aimStick]) {
      if (!stick.active) continue;
      ctx.save();
      ctx.beginPath();
      ctx.arc(stick.startX, stick.startY, 46, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(9, 14, 23, 0.34)';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(stick.curX, stick.curY, 20, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(250, 204, 21, 0.9)';
      ctx.fill();
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
