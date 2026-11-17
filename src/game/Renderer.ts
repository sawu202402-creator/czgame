import { ZOMBIE_SPRITE_BY_KIND, getBossProfile, isBossKind } from '../data/enemies';
import { POWERUP_META } from '../data/perksAndRelics';
import { WEAPONS } from '../data/weapons';
import { I18n } from '../i18n/I18n';
import { SaveManager } from '../meta/SaveManager';
import { FloorTheme, PropKind, Rect } from '../types';
import { Assets, SpriteKey, TileKey } from './AssetLoader';
import { RunSnapshot } from './Entities';
import { InputManager } from './InputManager';

const FLOOR_THEME_TILE: Record<FloorTheme, TileKey> = {
  lobby: 'tile_floor_lobby',
  armory: 'tile_floor_armory',
  lab: 'tile_floor_lab',
  mall: 'tile_floor_mall',
  hospital: 'tile_floor_hospital',
  dock: 'tile_floor_dock',
  bunker: 'tile_floor_bunker',
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
  hospital_bed: 'prop_hospital_bed',
  ambulance: 'prop_ambulance',
  container: 'prop_container',
  forklift: 'prop_forklift',
  subway_car: 'prop_subway_car',
  military_truck: 'prop_military_truck',
  radar_console: 'prop_radar_console',
  missile_pod: 'prop_missile_pod',
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
    ctx.fillStyle = '#1e3124';
    ctx.fillRect(0, 0, viewW, viewH);

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

    // 9. 联机小队队友与特种部队主角（夜视仪头盔躯干 + 战术护肘双臂 + 15把枪械俯视建模 + 倒地救援光圈）
    this.drawRemotePlayers(ctx, state);
    this.drawPlayer(ctx, state);

    // 10. 抛物线手雷、流光曳光弹、闪电链、粒子、跳字与高空悬停救援黑鹰直升机
    this.drawGrenades(ctx, state);
    this.drawBulletsAndFX(ctx, state);
    this.drawExtractionHelicopterOverhead(ctx, state);

    ctx.restore();

    // 11. 屏幕层：雷达小地图（手机端自动避让左拇指摇杆区）、屏幕外目标箭头、触屏双摇杆
    this.drawTacticalMinimap(ctx, viewW, viewH, state, input.usingTouch);
    this.drawOffscreenIndicators(ctx, viewW, viewH, state);
    this.drawTouchSticks(ctx, viewW, viewH, state, input);
  }

  // ==================== 离屏高精度建筑地图烘焙（仅在开局与开门瞬间执行 1 次） ====================

  private ensureStaticMapCache(state: RunSnapshot): void {
    const stageLangKey = `${state.stage.id}:${I18n.lang}`;
    if (
      this.mapCanvas &&
      this.cachedStageId === stageLangKey &&
      this.cachedMapRevision === state.mapRevision
    ) {
      return;
    }

    this.cachedStageId = stageLangKey;
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
        this.drawCachedLabel(
          mctx,
          I18n.t('roomLocked', { name: I18n.roomOrDoorName(room.id, room.name) }),
          room.labelPos.x,
          room.labelPos.y,
          '#94a3b8',
          15
        );
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

      // 车辆警灯/前大灯、雷达台/导弹井环境光晕、喷泉/冷冻舱冷光、街机霓虹环境反光
      if (pr.kind === 'swat_van' || pr.kind === 'police_car' || pr.kind === 'ambulance') {
        const rg = mctx.createRadialGradient(4, -22, 4, 4, -22, 68);
        rg.addColorStop(0, 'rgba(239, 68, 68, 0.26)');
        rg.addColorStop(1, 'rgba(239, 68, 68, 0)');
        mctx.fillStyle = rg;
        mctx.fillRect(-72, -92, 150, 140);

        const bg = mctx.createRadialGradient(4, 22, 4, 4, 22, 68);
        bg.addColorStop(0, 'rgba(59, 130, 246, 0.25)');
        bg.addColorStop(1, 'rgba(59, 130, 246, 0)');
        mctx.fillStyle = bg;
        mctx.fillRect(-72, -45, 150, 140);

        if (pr.kind === 'police_car' || pr.kind === 'ambulance') {
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
      } else if (pr.kind === 'military_truck' || pr.kind === 'forklift') {
        const hg = mctx.createLinearGradient(pr.w * 0.4, 0, pr.w * 0.4 + 105, 0);
        hg.addColorStop(0, 'rgba(254, 240, 138, 0.2)');
        hg.addColorStop(1, 'rgba(254, 240, 138, 0)');
        mctx.fillStyle = hg;
        mctx.beginPath();
        mctx.moveTo(pr.w * 0.4, -20);
        mctx.lineTo(pr.w * 0.4 + 105, -46);
        mctx.lineTo(pr.w * 0.4 + 105, 46);
        mctx.lineTo(pr.w * 0.4, 20);
        mctx.closePath();
        mctx.fill();
      } else if (pr.kind === 'fountain' || pr.kind === 'cryo_pod' || pr.kind === 'radar_console') {
        const glowRgb =
          pr.kind === 'radar_console'
            ? '16, 185, 129'
            : pr.kind === 'cryo_pod'
              ? '34, 211, 238'
              : '56, 189, 248';
        const fg = mctx.createRadialGradient(0, 0, pr.w * 0.18, 0, 0, pr.w * 0.86);
        fg.addColorStop(0, `rgba(${glowRgb}, ${pr.kind === 'fountain' ? 0.16 : 0.28})`);
        fg.addColorStop(1, `rgba(${glowRgb}, 0)`);
        mctx.fillStyle = fg;
        mctx.beginPath();
        mctx.arc(0, 0, pr.w * 0.86, 0, Math.PI * 2);
        mctx.fill();
      } else if (pr.kind === 'missile_pod') {
        const mg = mctx.createRadialGradient(0, 0, pr.w * 0.15, 0, 0, pr.w * 0.82);
        mg.addColorStop(0, 'rgba(239, 68, 68, 0.24)');
        mg.addColorStop(1, 'rgba(239, 68, 68, 0)');
        mctx.fillStyle = mg;
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
      if (
        pr.kind === 'fountain' ||
        pr.kind === 'cryo_pod' ||
        pr.kind === 'radar_console' ||
        pr.kind === 'missile_pod'
      ) {
        mctx.arc(5, 7, pr.w * 0.49, 0, Math.PI * 2);
      } else {
        mctx.roundRect(-pr.w / 2 + 5, -pr.h / 2 + 7, pr.w + 2, pr.h + 2, 10);
      }
      mctx.fill();

      const scaleMult =
        pr.kind === 'desk' || pr.kind === 'hospital_bed'
          ? 1.18
          : pr.kind === 'swat_van' ||
              pr.kind === 'police_car' ||
              pr.kind === 'ambulance' ||
              pr.kind === 'military_truck' ||
              pr.kind === 'subway_car' ||
              pr.kind === 'container'
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

    // 上下两座巨型工业冷却涡轮风机井口（高精度俯视反应堆涡轮贴图）
    const turbImg = Assets.getSprite('prop_turbine');
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

      if (turbImg) {
        const tDim = fr * 2.12;
        mctx.drawImage(turbImg, fx - tDim / 2, fy - tDim / 2, tDim, tDim);
      } else {
        mctx.strokeStyle = '#475569';
        mctx.lineWidth = 5;
        mctx.beginPath();
        mctx.arc(fx, fy, fr, 0, Math.PI * 2);
        mctx.stroke();
      }

      // 井口十字承重钢梁
      mctx.strokeStyle = '#334155';
      mctx.lineWidth = 8;
      mctx.beginPath();
      mctx.moveTo(sx + 20, fy);
      mctx.lineTo(sx + sw - 20, fy);
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
    mctx.fillStyle = 'rgba(2, 6, 23, 0.44)';
    mctx.beginPath();
    mctx.ellipse(2, 4, 15, 24, 0, 0, Math.PI * 2);
    mctx.fill();

    const sbImg = Assets.getSprite('prop_sandbags');
    if (sbImg) {
      mctx.drawImage(sbImg, -27, -27, 54, 54);
    } else {
      mctx.fillStyle = '#6b6650';
      mctx.fillRect(-8, -18, 16, 36);
    }
    mctx.restore();
  }

  private bakeJerseyBarrier(mctx: CanvasRenderingContext2D, x: number, y: number, angle: number): void {
    mctx.save();
    mctx.translate(x, y);
    mctx.rotate(angle);
    mctx.fillStyle = 'rgba(2, 6, 23, 0.45)';
    mctx.fillRect(-26, -6, 56, 18);

    const barImg = Assets.getSprite('prop_barrier');
    if (barImg) {
      mctx.drawImage(barImg, -28, -9, 56, 18);
    } else {
      mctx.fillStyle = '#475569';
      mctx.fillRect(-25, -8, 50, 16);
    }
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
    mctx.fillStyle = 'rgba(2, 6, 23, 0.46)';
    mctx.beginPath();
    mctx.arc(6, 8, radius * 1.02, 0, Math.PI * 2);
    mctx.fill();

    const treeImg = Assets.getSprite('prop_tree');
    if (treeImg) {
      mctx.rotate(hash2D(Math.round(x), Math.round(y), seed) * Math.PI * 2);
      const sz = radius * 2.28;
      mctx.drawImage(treeImg, -sz / 2, -sz / 2, sz, sz);
    } else {
      mctx.fillStyle = '#1c3323';
      mctx.beginPath();
      mctx.arc(0, 0, radius, 0, Math.PI * 2);
      mctx.fill();
    }
    mctx.restore();
  }

  private bakeRoomFloorMarkings(
    mctx: CanvasRenderingContext2D,
    theme: FloorTheme,
    r: Rect,
    seed: number
  ): void {
    // 1. 建筑板块微弱接缝网格线（低对比度柔和质感，避免视觉眩目）
    const step = theme === 'asphalt' ? 168 : theme === 'lobby' || theme === 'mall' ? 112 : 96;
    mctx.strokeStyle =
      theme === 'lab'
        ? 'rgba(56, 189, 248, 0.045)'
        : theme === 'lobby' || theme === 'mall'
          ? 'rgba(15, 23, 42, 0.075)'
          : 'rgba(9, 14, 23, 0.11)';
    mctx.lineWidth = 1;
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
    mctx.strokeStyle = 'rgba(15, 23, 42, 0.22)';
    mctx.lineWidth = 1.8;
    mctx.strokeRect(r.x + 18, r.y + 18, Math.max(0, r.w - 36), Math.max(0, r.h - 36));

    if (theme === 'mall' && r.w >= 320 && r.h >= 260) {
      // 商场中庭柔和同心暗纹（低饱和不抢眼）
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const rad = Math.min(r.w, r.h) * 0.26;
      mctx.strokeStyle = 'rgba(148, 163, 184, 0.11)';
      mctx.lineWidth = 2;
      mctx.beginPath();
      mctx.arc(cx, cy, rad, 0, Math.PI * 2);
      mctx.stroke();
      mctx.strokeStyle = 'rgba(56, 189, 248, 0.09)';
      mctx.beginPath();
      mctx.arc(cx, cy, rad * 0.72, 0, Math.PI * 2);
      mctx.stroke();
    } else if (theme === 'armory' || theme === 'asphalt') {
      // 工业区与停机坪低对比安全收边线与排水地漏
      mctx.save();
      mctx.strokeStyle = 'rgba(234, 179, 8, 0.13)';
      mctx.lineWidth = 2.2;
      mctx.setLineDash([18, 14]);
      mctx.strokeRect(r.x + 28, r.y + 28, Math.max(0, r.w - 56), Math.max(0, r.h - 56));
      mctx.restore();

      if (r.w >= 220 && r.h >= 200) {
        this.bakeFloorGrate(mctx, r.x + r.w * 0.32 - 26, r.y + r.h * 0.78 - 9, 52, 18);
        if (r.w >= 520) {
          this.bakeFloorGrate(mctx, r.x + r.w * 0.72 - 26, r.y + r.h * 0.24 - 9, 52, 18);
        }
      }
    } else if (theme === 'lab') {
      // 实验室导流槽暗线与检修舱盖
      mctx.strokeStyle = 'rgba(56, 189, 248, 0.1)';
      mctx.lineWidth = 1.6;
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

    // 各关卡专属房间叙事暗纹层（克制低对比度，护眼且突出敌人与弹道）
    if (room.id === 'cells') {
      // 拘留羁押室：柔和暗金隔间线与编号水印 (CELL-01 / CELL-02)
      mctx.save();
      mctx.strokeStyle = 'rgba(250, 204, 21, 0.16)';
      mctx.lineWidth = 2;
      mctx.setLineDash([12, 10]);
      const cellY = r0.y + 150;
      mctx.beginPath();
      mctx.moveTo(r0.x + 30, cellY);
      mctx.lineTo(r0.x + r0.w - 30, cellY);
      mctx.moveTo(r0.x + r0.w * 0.5, r0.y + 24);
      mctx.lineTo(r0.x + r0.w * 0.5, cellY);
      mctx.stroke();
      mctx.setLineDash([]);
      mctx.font = '800 13px monospace';
      mctx.fillStyle = 'rgba(250, 204, 21, 0.16)';
      mctx.fillText('CELL-01', r0.x + r0.w * 0.25, r0.y + 62);
      mctx.fillText('CELL-02', r0.x + r0.w * 0.75, r0.y + 62);
      mctx.restore();
    } else if (room.id === 'corridor') {
      // 审讯狭长走廊：中央低饱和暗红疏散导向带
      mctx.fillStyle = 'rgba(185, 28, 28, 0.16)';
      mctx.fillRect(r0.x + 36, r0.y + r0.h / 2 - 4, Math.max(20, r0.w - 72), 8);
      mctx.fillStyle = 'rgba(254, 240, 138, 0.16)';
      for (let ax = r0.x + 65; ax < r0.x + r0.w - 65; ax += 110) {
        mctx.beginPath();
        mctx.moveTo(ax + 11, r0.y + r0.h / 2);
        mctx.lineTo(ax - 4, r0.y + r0.h / 2 - 4.5);
        mctx.lineTo(ax - 4, r0.y + r0.h / 2 + 4.5);
        mctx.closePath();
        mctx.fill();
      }
    } else if (room.id === 'west_wing' || room.id === 'east_wing') {
      // 73号研究所双翼：地面嵌入式冷却金属管道槽
      mctx.strokeStyle = 'rgba(15, 23, 42, 0.55)';
      mctx.lineWidth = 9;
      mctx.lineCap = 'round';
      mctx.beginPath();
      mctx.moveTo(r0.x + r0.w * 0.5, r0.y + 45);
      mctx.lineTo(r0.x + r0.w * 0.5, r0.y + r0.h - 45);
      mctx.stroke();
      mctx.strokeStyle = room.id === 'west_wing' ? 'rgba(34, 211, 238, 0.22)' : 'rgba(248, 113, 113, 0.22)';
      mctx.lineWidth = 2.8;
      mctx.stroke();
    } else if (room.id === 'icu' || room.id === 'surgery') {
      // 隔离医院病房与手术区：柔和医疗十字暗标
      const mcx = r0.x + r0.w * 0.5;
      const mcy = r0.y + r0.h * 0.5;
      mctx.save();
      mctx.strokeStyle = 'rgba(20, 184, 166, 0.13)';
      mctx.lineWidth = 1.6;
      mctx.setLineDash([14, 10]);
      mctx.strokeRect(r0.x + 32, r0.y + 32, Math.max(40, r0.w - 64), Math.max(40, r0.h - 64));
      mctx.setLineDash([]);
      mctx.fillStyle = 'rgba(220, 38, 38, 0.14)';
      mctx.fillRect(mcx - 22, mcy - 7, 44, 14);
      mctx.fillRect(mcx - 7, mcy - 22, 14, 44);
      mctx.restore();
    } else if (room.id === 'platform') {
      // 地铁枢纽双轨列车月台：枕木钢轨与柔和安全候车线
      mctx.save();
      const trackY = r0.y + r0.h * 0.5;
      mctx.fillStyle = 'rgba(9, 13, 22, 0.36)';
      mctx.fillRect(r0.x + 24, trackY - 28, Math.max(40, r0.w - 48), 56);
      mctx.strokeStyle = 'rgba(71, 85, 105, 0.36)';
      mctx.lineWidth = 2.5;
      for (let tx = r0.x + 32; tx < r0.x + r0.w - 32; tx += 22) {
        mctx.beginPath();
        mctx.moveTo(tx, trackY - 22);
        mctx.lineTo(tx, trackY + 22);
        mctx.stroke();
      }
      mctx.strokeStyle = 'rgba(148, 163, 184, 0.42)';
      mctx.lineWidth = 2.8;
      mctx.beginPath();
      mctx.moveTo(r0.x + 24, trackY - 15);
      mctx.lineTo(r0.x + r0.w - 24, trackY - 15);
      mctx.moveTo(r0.x + 24, trackY + 15);
      mctx.lineTo(r0.x + r0.w - 24, trackY + 15);
      mctx.stroke();
      mctx.strokeStyle = 'rgba(250, 204, 21, 0.24)';
      mctx.lineWidth = 2.2;
      mctx.setLineDash([18, 10]);
      mctx.beginPath();
      mctx.moveTo(r0.x + 28, trackY - 46);
      mctx.lineTo(r0.x + r0.w - 28, trackY - 46);
      mctx.moveTo(r0.x + 28, trackY + 46);
      mctx.lineTo(r0.x + r0.w - 28, trackY + 46);
      mctx.stroke();
      mctx.restore();
    } else if (room.id === 'containers' || room.id === 'hangar_w') {
      // 港口集装箱堆场与空军重装机库：低对比机位泊位框
      mctx.save();
      mctx.strokeStyle = 'rgba(234, 179, 8, 0.16)';
      mctx.lineWidth = 2.2;
      mctx.setLineDash([20, 14]);
      mctx.strokeRect(r0.x + 42, r0.y + 42, Math.max(40, r0.w - 84), Math.max(40, r0.h - 84));
      mctx.restore();
    } else if (room.id === 'silo_w' || room.id === 'silo_e') {
      // 核地堡导弹发射井：地面暗金防爆警戒环
      const scx = r0.x + r0.w * 0.5;
      const scy = r0.y + r0.h * 0.5;
      mctx.save();
      mctx.strokeStyle = 'rgba(245, 158, 11, 0.19)';
      mctx.lineWidth = 2.6;
      mctx.setLineDash([16, 12]);
      mctx.beginPath();
      mctx.arc(scx, scy, Math.min(r0.w, r0.h) * 0.32, 0, Math.PI * 2);
      mctx.stroke();
      mctx.restore();
    } else if (room.id === 'courtyard' || room.id === 'cargo') {
      // 停机坪与卸货区：柔和车位标线
      mctx.save();
      mctx.strokeStyle = 'rgba(250, 204, 21, 0.15)';
      mctx.lineWidth = 2;
      mctx.strokeRect(r0.x + 48, r0.y + 44, 145, 78);
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
      } else if (
        pr.kind === 'crates' ||
        pr.kind === 'police_car' ||
        pr.kind === 'swat_van' ||
        pr.kind === 'ambulance' ||
        pr.kind === 'military_truck' ||
        pr.kind === 'container'
      ) {
        // 车辆/货箱边摆放高精度俯视橙白反光战术路锥
        const cx = pr.x + pr.w * 0.52 + 16;
        const cy = pr.y + pr.h * 0.32;
        if (pointInAnyRect(cx, cy, room.rects, -18)) {
          const coneImg = Assets.getSprite('prop_traffic_cone');
          mctx.save();
          mctx.translate(cx, cy);
          mctx.fillStyle = 'rgba(2, 6, 23, 0.42)';
          mctx.fillRect(-7, -6, 16, 16);
          if (coneImg) {
            mctx.drawImage(coneImg, -10, -10, 20, 20);
          } else {
            mctx.fillStyle = '#ea580c';
            mctx.fillRect(-7, -7, 14, 14);
          }
          mctx.restore();
        }
      }
    }
  }

  private bakeFloorGrate(mctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const grateImg = Assets.getSprite('prop_floor_grate');
    if (grateImg) {
      mctx.drawImage(grateImg, x, y, w, h);
    } else {
      mctx.fillStyle = '#0f172a';
      mctx.fillRect(x, y, w, h);
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
    const wallTopPat = Assets.getPattern(mctx, 'tile_wall_top', 0.46);

    // 1. 先绘制所有墙段外部投影
    mctx.fillStyle = 'rgba(2, 6, 23, 0.5)';
    for (const w of state.walls) {
      mctx.fillRect(w.x + 6, w.y + 8, w.w, w.h);
    }

    // 2. 绘制多层 3D 倒角墙体结构与无缝重装钢混墙顶贴图
    const pillarMap = new Map<string, { x: number; y: number }>();

    for (const w of state.walls) {
      const isHoriz = w.w >= w.h;

      mctx.fillStyle = '#090e17';
      mctx.fillRect(w.x, w.y, w.w, w.h);

      mctx.fillStyle = baseDark;
      mctx.fillRect(w.x + 2, w.y + 2, Math.max(0, w.w - 4), Math.max(0, w.h - 4));

      const inset = 4.5;
      const cx = w.x + inset;
      const cy = w.y + inset - 1;
      const cw = Math.max(0, w.w - inset * 2);
      const ch = Math.max(0, w.h - inset * 2 - 1);

      mctx.fillStyle = capShadow;
      mctx.fillRect(cx, cy, cw, ch);

      const innerW = Math.max(0, cw - 2);
      const innerH = Math.max(0, ch - 2);
      if (wallTopPat) {
        mctx.fillStyle = wallTopPat;
        mctx.fillRect(cx, cy, innerW, innerH);
        mctx.save();
        mctx.globalAlpha = 0.34;
        mctx.fillStyle = capMain;
        mctx.fillRect(cx, cy, innerW, innerH);
        mctx.restore();
      } else {
        mctx.fillStyle = capMain;
        mctx.fillRect(cx, cy, innerW, innerH);
      }

      // 受光亮边
      mctx.fillStyle = capHighlight;
      mctx.fillRect(cx, cy, cw, 2);
      mctx.fillRect(cx, cy, 2, ch);

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

      const px0 = p.x - pHalf + 2.5;
      const py0 = p.y - pHalf + 2.5;
      const pw0 = pHalf * 2 - 5;
      const ph0 = pHalf * 2 - 6;
      if (wallTopPat) {
        mctx.fillStyle = wallTopPat;
        mctx.fillRect(px0, py0, pw0, ph0);
        mctx.save();
        mctx.globalAlpha = 0.28;
        mctx.fillStyle = shadeHex(capMain, 14);
        mctx.fillRect(px0, py0, pw0, ph0);
        mctx.restore();
      } else {
        mctx.fillStyle = shadeHex(capMain, 10);
        mctx.fillRect(px0, py0, pw0, ph0);
      }

      mctx.fillStyle = shadeHex(capMain, 38);
      mctx.fillRect(px0, py0, pw0, 2.2);
      mctx.fillRect(px0, py0, 2.2, ph0);

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
    const scorchImg = Assets.getSprite('decal_scorch');
    const bloodImg = Assets.getSprite('decal_blood');
    const acidSpatterSil = Assets.getTintedSilhouette('decal_blood', '#84cc16');
    const poolImg = Assets.getSprite('pool_acid');
    const bossPoolSil = Assets.getTintedSilhouette('pool_acid', '#e11d48');

    for (const dc of state.decals) {
      if (!this.inView(dc.x, dc.y, dc.radius + 36)) continue;
      ctx.save();
      if (dc.isScorch) {
        const alpha = Math.min(0.92, dc.life / 3.2);
        ctx.globalAlpha = alpha;
        ctx.translate(dc.x, dc.y);
        ctx.rotate(dc.seed);
        const sz = dc.radius * 2.24;
        if (scorchImg) {
          ctx.drawImage(scorchImg, -sz / 2, -sz / 2, sz, sz);
        } else {
          ctx.fillStyle = 'rgba(2, 6, 23, 0.78)';
          ctx.beginPath();
          ctx.arc(0, 0, dc.radius, 0, Math.PI * 2);
          ctx.fill();
        }

        const fresh = Math.max(0, 1 - (dc.maxLife - dc.life) / 2.4);
        if (fresh > 0) {
          ctx.fillStyle = `rgba(251, 146, 60, ${0.36 * fresh})`;
          ctx.beginPath();
          ctx.arc(0, 0, dc.radius * 0.3, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.globalAlpha = Math.min(0.88, dc.life / 3.5);
        ctx.translate(dc.x, dc.y);
        ctx.rotate(dc.seed);
        const sz = dc.radius * 2.35;
        if (bloodImg) {
          ctx.drawImage(bloodImg, -sz / 2, -sz / 2, sz, sz);
          if ((dc.color === '#84cc16' || dc.color === '#65a30d') && acidSpatterSil) {
            ctx.globalAlpha *= 0.72;
            ctx.drawImage(acidSpatterSil, -sz / 2, -sz / 2, sz, sz);
          }
        } else {
          ctx.fillStyle = dc.color;
          ctx.beginPath();
          ctx.arc(0, 0, dc.radius * 0.72, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // 地面强酸/尸王熔岩腐蚀毒潭高精度贴图
    const now = performance.now() * 0.007;
    for (const ap of state.acidPools) {
      if (!this.inView(ap.x, ap.y, ap.radius + 26)) continue;
      const alpha = Math.min(0.95, ap.life / 0.8);
      const pulse = 0.95 + Math.sin(now + ap.x * 0.05) * 0.05;
      const sz = ap.radius * 2.34 * pulse;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(ap.x, ap.y);
      ctx.rotate((ap.x + ap.y) * 0.03);
      if (poolImg) {
        ctx.drawImage(poolImg, -sz / 2, -sz / 2, sz, sz);
        if (ap.isBoss && bossPoolSil) {
          ctx.globalAlpha = alpha * 0.74;
          ctx.drawImage(bossPoolSil, -sz / 2, -sz / 2, sz, sz);
        }
      } else {
        ctx.fillStyle = ap.isBoss ? 'rgba(225, 29, 72, 0.45)' : 'rgba(132, 204, 22, 0.45)';
        ctx.beginPath();
        ctx.arc(0, 0, ap.radius * pulse, 0, Math.PI * 2);
        ctx.fill();
      }

      const bx = Math.cos(now * 1.3 + ap.y) * ap.radius * 0.36;
      const by = Math.sin(now * 1.1 + ap.x) * ap.radius * 0.36;
      ctx.globalAlpha = alpha * 0.85;
      ctx.beginPath();
      ctx.arc(bx, by, 4.2, 0, Math.PI * 2);
      ctx.fillStyle = ap.isBoss ? '#fda4af' : '#ecfccb';
      ctx.fill();
      ctx.restore();
    }
  }

  private drawHelipad(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    const courtyard = state.rooms.find((r) => r.id === 'courtyard');
    if (!courtyard?.unlocked && state.waveState !== 'extraction') return;

    const { x, y } = state.stage.helipadPos;
    if (!this.inView(x, y, 150)) return;
    const isExtracting = state.waveState === 'extraction';
    const now = performance.now();
    const pulse = 0.85 + Math.sin(now * 0.008) * 0.15;

    ctx.save();
    ctx.beginPath();
    ctx.arc(x + 3, y + 5, 81, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(2, 6, 23, 0.52)';
    ctx.fill();

    const padImg = Assets.getSprite('prop_helipad');
    if (padImg) {
      ctx.drawImage(padImg, x - 84, y - 84, 168, 168);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 76, 0, Math.PI * 2);
      ctx.fillStyle = '#1e293b';
      ctx.fill();
    }

    if (isExtracting) {
      ctx.beginPath();
      ctx.arc(x, y, 74, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(34, 197, 94, ${0.24 * pulse})`;
      ctx.fill();

      // 旋翼下洗气流地面扩散风圈
      for (let w = 0; w < 2; w++) {
        const wavePhase = ((now * 0.0014 + w * 0.5) % 1);
        const wr = 36 + wavePhase * 76;
        ctx.beginPath();
        ctx.arc(x, y, wr, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(226, 232, 240, ${(1 - wavePhase) * 0.26})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * 76, y + Math.sin(a) * 76, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = isExtracting ? '#4ade80' : i % 2 === 0 ? '#facc15' : '#38bdf8';
      ctx.fill();
    }

    if (isExtracting) {
      ctx.beginPath();
      ctx.arc(x, y, 86, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * state.extractionProgress);
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 8;
      ctx.stroke();

      this.drawCachedLabel(ctx, I18n.t('boardChopper'), x, y - 102, '#fef08a', 15);
    }
    ctx.restore();
  }

  private drawExtractionHelicopterOverhead(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    if (state.waveState !== 'extraction') return;
    const { x: hx, y: hy } = state.stage.helipadPos;
    const rawT = Math.min(1, (state.extractionTimer || 0) / 1.8);
    const ease = 1 - Math.pow(1 - rawT, 3);

    const now = performance.now();
    const swayX = Math.sin(now * 0.0028) * 4.5;
    const swayY = Math.cos(now * 0.0034) * 3.8;

    const cx = hx - 420 * (1 - ease) - 18 + swayX;
    const cy = hy - 190 * (1 - ease) - 14 + swayY;
    if (!this.inView(cx, cy, 220)) return;

    const heliImg = Assets.getSprite('prop_helicopter');
    const heliHeading = -0.18 + Math.sin(now * 0.002) * 0.025;
    const playerDist = Math.hypot(state.player.x - hx, state.player.y - hy);
    const bodyAlpha = playerDist < 96 ? 0.72 : 0.94;

    ctx.save();
    // 1. 机身下方地面斜向投影
    ctx.save();
    ctx.translate(cx + 22, cy + 32);
    ctx.rotate(heliHeading);
    ctx.fillStyle = 'rgba(2, 6, 23, 0.36)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 108, 30, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 2. 高空悬停黑鹰救援直升机机身 + 机头探照灯 + 航行频闪灯 + 四叶高速残影旋翼盘
    ctx.translate(cx, cy);
    ctx.rotate(heliHeading);

    // 机头探照灯暖白光锥
    const sg = ctx.createLinearGradient(95, 0, 235, 0);
    sg.addColorStop(0, 'rgba(254, 249, 195, 0.28)');
    sg.addColorStop(1, 'rgba(254, 249, 195, 0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(95, -14);
    ctx.lineTo(235, -58);
    ctx.lineTo(235, 58);
    ctx.lineTo(95, 14);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = bodyAlpha;
    const drawW = 248;
    const drawH = heliImg ? drawW * (heliImg.height / heliImg.width) : 82;
    if (heliImg) {
      ctx.drawImage(heliImg, -drawW / 2, -drawH / 2, drawW, drawH);
    }

    // 两侧短翼红/绿航空防撞频闪灯
    const blinkOn = Math.floor(now / 220) % 2 === 0;
    if (blinkOn) {
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(24, -drawH * 0.44, 3.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4ade80';
      ctx.beginPath();
      ctx.arc(24, drawH * 0.44, 3.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // 主旋翼轴心（位于机身前中段 x=+34）高速旋转半透明气动扇盘与四叶桨影
    const hubX = 34;
    const rotorR = 104;
    const rotorAng = now * 0.026;
    ctx.save();
    ctx.translate(hubX, 0);
    ctx.globalAlpha = 0.24;
    const rg = ctx.createRadialGradient(0, 0, 12, 0, 0, rotorR);
    rg.addColorStop(0, 'rgba(15, 23, 42, 0.1)');
    rg.addColorStop(0.82, 'rgba(203, 213, 225, 0.26)');
    rg.addColorStop(1, 'rgba(248, 250, 252, 0.45)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(0, 0, rotorR, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(rotorAng);
    ctx.globalAlpha = 0.52;
    for (let b = 0; b < 4; b++) {
      ctx.rotate(Math.PI / 2);
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.moveTo(8, -2.5);
      ctx.lineTo(rotorR, -6.5);
      ctx.lineTo(rotorR, 4.5);
      ctx.lineTo(8, 2.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#facc15';
      ctx.fillRect(rotorR - 10, -5.5, 9, 9.5);
    }
    ctx.restore();

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
        priceTag = near ? I18n.t('stepOrB') : '';
      } else if (st.type === 'starter_airdrop') {
        ringColor = '#f59e0b';
        priceTag = save.freeStarterUsedCount < 2 ? I18n.t('freeTrialTag') : I18n.t('watchAdTag');
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
        this.drawCachedLabel(ctx, I18n.stationLabel(st.type, st.label), st.x, st.y - 40, '#f8fafc', 11);
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
    const plankImg = Assets.getSprite('prop_wood_plank');
    const plankElecSil = electricActive ? Assets.getTintedSilhouette('prop_wood_plank', '#38bdf8') : undefined;
    const doorImg = Assets.getSprite('prop_blast_door');

    // 1. 立体钢框窗户与真实木纹铆钉防线板贴图
    for (const win of state.windows) {
      if (!this.inView(win.x + win.w / 2, win.y + win.h / 2, 85)) continue;
      ctx.save();

      ctx.fillStyle = '#0f172a';
      ctx.fillRect(win.x, win.y, win.w, win.h);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(win.x + 3, win.y + 3, win.w - 6, win.h - 6);
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(win.x + 2, win.y + 2, win.w - 4, win.h - 4);

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
        const tilt = ((i % 3) - 1) * 0.024;
        const flipX = i % 2 === 0 ? 1 : -1;

        if (win.orientation === 'horizontal') {
          const cx = win.x + win.w / 2;
          const cy = win.y + 4 + ratio * (win.h - 8);
          const pw = win.w - 10;
          const ph = 9.5;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(tilt);
          ctx.scale(flipX, 1);
          if (plankImg) {
            ctx.drawImage(plankImg, -pw / 2, -ph / 2, pw, ph);
            if (plankElecSil) {
              ctx.globalAlpha = 0.58;
              ctx.drawImage(plankElecSil, -pw / 2, -ph / 2, pw, ph);
            }
          } else {
            ctx.fillStyle = electricActive ? '#0284c7' : '#92400e';
            ctx.fillRect(-pw / 2, -3.2, pw, 6.4);
          }
          ctx.restore();
        } else {
          const cx = win.x + 4 + ratio * (win.w - 8);
          const cy = win.y + win.h / 2;
          const plen = win.h - 10;
          const pthick = 9.5;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(Math.PI / 2 + tilt);
          ctx.scale(flipX, 1);
          if (plankImg) {
            ctx.drawImage(plankImg, -plen / 2, -pthick / 2, plen, pthick);
            if (plankElecSil) {
              ctx.globalAlpha = 0.58;
              ctx.drawImage(plankElecSil, -plen / 2, -pthick / 2, plen, pthick);
            }
          } else {
            ctx.fillStyle = electricActive ? '#0284c7' : '#92400e';
            ctx.fillRect(-plen / 2, -3.2, plen, 6.4);
          }
          ctx.restore();
        }
      }

      // 外层 $80【⚡合金电击装甲窗】金属电弧护栏与蓝色铆钉视觉表现
      if (win.armorPlanks > 0) {
        const pulse = 0.58 + Math.sin(performance.now() * 0.012) * 0.28;
        ctx.strokeStyle = `rgba(56, 189, 248, ${pulse})`;
        ctx.lineWidth = 2.2;
        ctx.strokeRect(win.x + 1, win.y + 1, win.w - 2, win.h - 2);

        for (let i = 0; i < win.armorPlanks; i++) {
          const ratio = (i + 0.5) / Math.max(1, win.maxPlanks);
          if (win.orientation === 'horizontal') {
            const cx = win.x + win.w / 2;
            const cy = win.y + 4 + ratio * (win.h - 8);
            const pw = win.w - 8;
            ctx.fillStyle = '#0f172a';
            ctx.fillRect(cx - pw / 2, cy - 3.6, pw, 7.2);
            ctx.fillStyle = '#38bdf8';
            ctx.fillRect(cx - pw / 2 + 1, cy - 2.2, pw - 2, 4.4);
            ctx.fillStyle = '#e0f2fe';
            ctx.fillRect(cx - pw / 2 + 3, cy - 1, 4, 2);
            ctx.fillRect(cx + pw / 2 - 7, cy - 1, 4, 2);
          } else {
            const cx = win.x + 4 + ratio * (win.w - 8);
            const cy = win.y + win.h / 2;
            const plen = win.h - 8;
            ctx.fillStyle = '#0f172a';
            ctx.fillRect(cx - 3.6, cy - plen / 2, 7.2, plen);
            ctx.fillStyle = '#38bdf8';
            ctx.fillRect(cx - 2.2, cy - plen / 2 + 1, 4.4, plen - 2);
            ctx.fillStyle = '#e0f2fe';
            ctx.fillRect(cx - 1, cy - plen / 2 + 3, 2, 4);
            ctx.fillRect(cx - 1, cy + plen / 2 - 7, 2, 4);
          }
        }
      }

      if (win.planks === 0 && win.armorPlanks <= 0) {
        const blink = 0.35 + Math.sin(performance.now() * 0.01) * 0.25;
        ctx.fillStyle = `rgba(239, 68, 68, ${blink})`;
        ctx.fillRect(win.x + 3, win.y + 3, win.w - 6, win.h - 6);
      }
      ctx.restore();
    }

    // 2. 重型液压对开防爆装甲钢门高精度贴图（Blast Bulkhead Doors）
    for (const door of state.doors) {
      if (!this.inView(door.x + door.w / 2, door.y + door.h / 2, 95)) continue;
      const cx = door.x + door.w / 2;
      const cy = door.y + door.h / 2;

      if (door.unlocked) {
        // 开启后露出两侧收入墙体门槽的装甲门叶边缘
        ctx.save();
        if (door.orientation === 'horizontal') {
          if (doorImg) {
            ctx.drawImage(doorImg, 0, 0, doorImg.width * 0.22, doorImg.height, door.x, door.y + 1, 13, door.h - 2);
            ctx.drawImage(
              doorImg,
              doorImg.width * 0.78,
              0,
              doorImg.width * 0.22,
              doorImg.height,
              door.x + door.w - 13,
              door.y + 1,
              13,
              door.h - 2
            );
          } else {
            ctx.fillStyle = '#334155';
            ctx.fillRect(door.x, door.y + 2, 10, door.h - 4);
            ctx.fillRect(door.x + door.w - 10, door.y + 2, 10, door.h - 4);
          }
        } else {
          if (doorImg) {
            ctx.save();
            ctx.translate(cx, door.y + 6.5);
            ctx.rotate(Math.PI / 2);
            ctx.drawImage(
              doorImg,
              0,
              0,
              doorImg.width * 0.22,
              doorImg.height,
              -6.5,
              -(door.w - 2) / 2,
              13,
              door.w - 2
            );
            ctx.restore();
            ctx.save();
            ctx.translate(cx, door.y + door.h - 6.5);
            ctx.rotate(Math.PI / 2);
            ctx.drawImage(
              doorImg,
              doorImg.width * 0.78,
              0,
              doorImg.width * 0.22,
              doorImg.height,
              -6.5,
              -(door.w - 2) / 2,
              13,
              door.w - 2
            );
            ctx.restore();
          } else {
            ctx.fillStyle = '#334155';
            ctx.fillRect(door.x + 2, door.y, door.w - 4, 10);
            ctx.fillRect(door.x + 2, door.y + door.h - 10, door.w - 4, 10);
          }
        }
        ctx.restore();
        continue;
      }

      ctx.save();
      ctx.fillStyle = 'rgba(2, 6, 23, 0.48)';
      ctx.fillRect(door.x + 4, door.y + 6, door.w, door.h);

      if (doorImg) {
        if (door.orientation === 'horizontal') {
          ctx.drawImage(doorImg, door.x - 1, door.y - 2, door.w + 2, door.h + 4);
        } else {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(Math.PI / 2);
          ctx.drawImage(doorImg, -(door.h + 2) / 2, -(door.w + 4) / 2, door.h + 2, door.w + 4);
          ctx.restore();
        }
      } else {
        ctx.fillStyle = '#334155';
        ctx.fillRect(door.x, door.y, door.w, door.h);
      }

      // 门禁红/绿状态指示灯与合资开门进度
      const remainingCost = Math.max(0, door.cost - (door.paidAmount || 0));
      const canAffordFull = state.cash >= remainingCost;
      ctx.beginPath();
      ctx.arc(cx, cy, 4.2, 0, Math.PI * 2);
      ctx.fillStyle = canAffordFull ? '#4ade80' : door.paidAmount > 0 ? '#facc15' : '#ef4444';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#090d16';
      ctx.stroke();

      if (door.progress > 0) {
        ctx.beginPath();
        ctx.arc(cx, cy, 31, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * door.progress);
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 6;
        ctx.stroke();
      }
      const nearDoor =
        Math.hypot(state.player.x - cx, state.player.y - cy) < 175 ||
        state.remotePlayers.some((rp) => Math.hypot(rp.x - cx, rp.y - cy) < 175);
      if (nearDoor || door.paidAmount > 0) {
        this.drawCachedLabel(ctx, I18n.roomOrDoorName(door.unlockRoomId, door.label), cx, cy - 15, '#f8fafc', 11);
      }
      const priceText =
        door.paidAmount > 0 ? I18n.t('doorNeedMore', { n: remainingCost }) : `$${door.cost}`;
      this.drawCachedLabel(
        ctx,
        priceText,
        cx,
        nearDoor || door.paidAmount > 0 ? cy + 12 : cy,
        canAffordFull ? '#86efac' : '#fde047',
        11
      );
      if (door.paidAmount > 0 && door.cost > 0) {
        const bw = 54;
        const pct = Math.min(1, door.paidAmount / door.cost);
        ctx.fillStyle = '#090d16';
        ctx.fillRect(cx - bw / 2 - 1, cy + 21, bw + 2, 6);
        ctx.fillStyle = '#4ade80';
        ctx.fillRect(cx - bw / 2, cy + 22, bw * pct, 4);
      }
      ctx.restore();
    }
  }

  private drawDropsAndChests(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    const now = performance.now() * 0.006;
    for (const d of state.drops) {
      if (!this.inView(d.x, d.y, 48)) continue;
      const bob = Math.sin(now + d.bobPhase) * 2.5;
      ctx.save();
      ctx.translate(d.x, d.y + bob);
      if (d.kind === 'cash') {
        ctx.fillStyle = 'rgba(2, 6, 23, 0.44)';
        ctx.beginPath();
        ctx.ellipse(2, 7 - bob * 0.4, 13, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        this.drawCenteredSprite(ctx, 'drop_cash', 0, 0, 34, -0.1);
      } else if (d.kind === 'heal') {
        ctx.fillStyle = 'rgba(34, 197, 94, 0.3)';
        ctx.beginPath();
        ctx.arc(0, 1, 16 + Math.sin(now * 2.2) * 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 1.8;
        ctx.stroke();
        this.drawCenteredSprite(ctx, 'item_medkit', 0, 0, 32, 0);
      } else if (d.kind === 'xp') {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
        ctx.beginPath();
        ctx.arc(0, 1, 13, 0, Math.PI * 2);
        ctx.fill();
        this.drawCenteredSprite(ctx, 'drop_xp', 0, 0, 29, 0);
      } else if (d.kind === 'powerup' && d.powerUp) {
        const meta = POWERUP_META[d.powerUp];
        ctx.beginPath();
        ctx.arc(0, 2, 18, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(2, 6, 23, 0.5)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(0, 0, 21 + Math.sin(now * 2) * 2, 0, Math.PI * 2);
        ctx.strokeStyle = meta.color;
        ctx.lineWidth = 2.6;
        ctx.stroke();

        this.drawCenteredSprite(ctx, 'drop_powerup', 0, 0, 38, now * 0.22);
        this.drawCachedLabel(ctx, I18n.powerupName(d.powerUp, meta.name), 0, -24, meta.color, 10);
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
      const spKey = ZOMBIE_SPRITE_BY_KIND[z.kind] || 'zombie_walker';
      const sway = Math.sin(z.wobblePhase) * 0.12;
      let scaleX = 1 + Math.sin(z.wobblePhase * 2) * 0.05;
      let scaleY = 2 - scaleX;
      let lunge = z.attackAnim * 12;
      let poseTwist = 0;

      // 三段式近战动作姿态（蓄力后仰 -> 扑击挥爪 -> 卸力后撤）
      if (z.attackState === 'windup') {
        lunge = -8.5;
        poseTwist = -0.32;
        scaleX = 0.88;
        scaleY = 1.14;
      } else if (z.attackState === 'slash') {
        lunge = 8 + z.attackAnim * 11;
        poseTwist = Math.sin((1 - z.attackAnim) * Math.PI) * 0.42;
        scaleX = 1.16;
        scaleY = 0.88;
      } else if (z.attackState === 'recover') {
        lunge = -3.5;
        poseTwist = 0.14;
        scaleX = 0.95;
        scaleY = 1.05;
      }

      const angle = (z.attackState !== 'none' ? z.slashAngle : z.facingAngle) + sway + poseTwist;
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
      } else if (z.frenzyTimer && z.frenzyTimer > 0) {
        ctx.beginPath();
        ctx.arc(0, 0, z.radius + 7, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(192, 132, 252, 0.34)';
        ctx.fill();
      } else if (z.kind === 'boomer') {
        const pulse = 0.16 + Math.sin(performance.now() * 0.012 + z.wobblePhase) * 0.08;
        ctx.beginPath();
        ctx.arc(0, 0, z.radius + 6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(249, 115, 22, ${pulse})`;
        ctx.fill();
      }

      // 僵尸蓄力前摇警示红芒
      if (z.attackState === 'windup') {
        ctx.save();
        ctx.rotate(z.slashAngle);
        ctx.beginPath();
        ctx.arc(z.radius * 0.55, 0, z.radius * 0.72, -0.85, 0.85);
        ctx.strokeStyle = 'rgba(248, 113, 113, 0.68)';
        ctx.lineWidth = 2.6;
        ctx.stroke();
        ctx.restore();
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
      this.drawEntitySpriteWithFlash(ctx, spKey, drawSize, 0, scaleX, scaleY, z.hitFlash > 0);
      ctx.restore();

      // 扑击挥爪血色撕裂弧光贴图（fx_claw_slash）
      if (z.attackState === 'slash' || z.attackAnim > 0.38) {
        const slashImg = Assets.getSprite('fx_claw_slash');
        const slashAlpha = Math.min(0.95, Math.max(0, (z.attackAnim - 0.25) * 1.45));
        if (slashImg && slashAlpha > 0.04) {
          const slashDist = z.radius * 1.08 + z.attackAnim * 8;
          const slashSize = z.radius * 2.65;
          ctx.save();
          ctx.rotate(z.slashAngle);
          ctx.translate(slashDist, 0);
          ctx.globalAlpha = slashAlpha;
          ctx.drawImage(slashImg, -slashSize / 2, -slashSize / 2, slashSize, slashSize);
          ctx.restore();
        }
      }

      ctx.restore();

      const zIsBoss = isBossKind(z.kind);
      if (z.kind === 'thief') {
        this.drawCachedLabel(
          ctx,
          I18n.t('thiefLabel', { s: z.fleeTimer.toFixed(0) }),
          z.x,
          z.y - z.radius - 22,
          '#fde047',
          11
        );
      } else if (zIsBoss || z.kind === 'miniboss') {
        const bp = zIsBoss ? getBossProfile(z.kind) : null;
        const bName = bp ? (I18n.isZh() ? bp.zhName : bp.enName) : I18n.t('bossTyrant');
        this.drawCachedLabel(
          ctx,
          bName,
          z.x,
          z.y - z.radius - 24,
          bp ? bp.color : '#fca5a5',
          12
        );
      }

      if (z.hp < z.maxHp || zIsBoss || z.kind === 'miniboss' || z.kind === 'thief') {
        const bw = Math.max(36, z.radius * 1.9);
        const bx = z.x - bw / 2;
        const by = z.y - z.radius - 13;
        ctx.fillStyle = '#090d16';
        ctx.fillRect(bx - 1.5, by - 1.5, bw + 3, 7);
        ctx.fillStyle = z.kind === 'thief' ? '#facc15' : zIsBoss ? z.color : '#ef4444';
        ctx.fillRect(bx, by, bw * Math.max(0, z.hp / z.maxHp), 4);
      }
    }
  }

  private drawSpits(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    const now = performance.now();
    for (const s of state.spits) {
      if (!this.inView(s.x, s.y, 38)) continue;
      const pk = s.projKind || 'acid';
      if (pk === 'saw') {
        this.drawSpinningSawDisc(ctx, s.x, s.y, s.radius * 1.25, now * 0.032, '#fda4af', '#ef4444');
        continue;
      }

      const isBossOrb = s.radius >= 9;
      const ang = Math.atan2(s.vy, s.vx);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(ang);

      const tailCol =
        pk === 'cryo'
          ? 'rgba(56, 189, 248, 0.38)'
          : pk === 'shock'
            ? 'rgba(139, 92, 246, 0.38)'
            : pk === 'fire'
              ? 'rgba(249, 115, 22, 0.44)'
              : isBossOrb
                ? 'rgba(132, 204, 22, 0.36)'
                : 'rgba(163, 230, 53, 0.32)';
      const coreCol =
        pk === 'cryo'
          ? '#67e8f9'
          : pk === 'shock'
            ? '#38bdf8'
            : pk === 'fire'
              ? '#fb923c'
              : '#a3e635';
      const strokeCol =
        pk === 'cryo'
          ? '#0c4a6e'
          : pk === 'shock'
            ? '#1e1b4b'
            : pk === 'fire'
              ? '#7c2d12'
              : '#1a2e05';
      const specCol =
        pk === 'cryo' ? '#f0f9ff' : pk === 'shock' ? '#e0e7ff' : pk === 'fire' ? '#fef08a' : '#ecfccb';

      ctx.fillStyle = tailCol;
      ctx.beginPath();
      ctx.moveTo(s.radius, -s.radius * 0.85);
      ctx.lineTo(-s.radius * 2.8, 0);
      ctx.lineTo(s.radius, s.radius * 0.85);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(0, 0, s.radius * 1.25, s.radius * 0.92, 0, 0, Math.PI * 2);
      ctx.fillStyle = coreCol;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = strokeCol;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(s.radius * 0.25, -s.radius * 0.2, s.radius * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = specCol;
      ctx.fill();
      ctx.restore();
    }
  }

  // ==================== 联机队友渲染与全身骨骼特种兵主角 ====================

  private drawRemotePlayers(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    if (!state.isCoop || state.remotePlayers.length === 0) return;
    const now = performance.now();
    const rigScale = 0.68;

    for (const rp of state.remotePlayers) {
      if (rp.spectating || !this.inView(rp.x, rp.y, 120)) continue;
      ctx.save();
      ctx.translate(rp.x, rp.y);

      if (rp.muzzleFlashTimer > 0 && !rp.downed) {
        const fx = Math.cos(rp.angle) * 32;
        const fy = Math.sin(rp.angle) * 32;
        ctx.fillStyle = 'rgba(251, 191, 36, 0.16)';
        ctx.beginPath();
        ctx.arc(fx, fy, 68, 0, Math.PI * 2);
        ctx.fill();
      }

      // 脚底接地投影 + 小队专属色彩识别战术光圈
      ctx.beginPath();
      ctx.ellipse(2, 9, 17, 10, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(2, 6, 23, 0.46)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(0, 0, 19, 0, Math.PI * 2);
      ctx.strokeStyle = rp.downed ? '#ef4444' : rp.color;
      ctx.lineWidth = 2.4;
      ctx.stroke();

      if (rp.downed) {
        const pulse = 26 + Math.sin(now * 0.01) * 5;
        ctx.beginPath();
        ctx.arc(0, 0, pulse, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(239, 68, 68, 0.22)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(248, 113, 113, 0.85)';
        ctx.lineWidth = 2.2;
        ctx.setLineDash([6, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.save();
      if (rp.downed) {
        ctx.scale(rigScale * 0.88, rigScale * 0.88);
        ctx.globalAlpha = 0.82;
      } else {
        ctx.scale(rigScale, rigScale);
      }

      ctx.save();
      ctx.rotate(rp.legAngle);
      const stride = rp.isMoving ? Math.sin(rp.walkPhase) * 10 : 0;
      this.drawTacticalBoot(ctx, stride + 2, -10.5);
      this.drawTacticalBoot(ctx, -stride + 2, 10.5);
      ctx.restore();

      ctx.save();
      ctx.rotate(rp.angle);
      const torsoKick = rp.recoilOffset * 0.4;
      if (!rp.downed) {
        this.drawWeaponBackpackGear(ctx, rp.activeWepId, rp.evolved, torsoKick);
      }
      const torsoImg = Assets.getSprite('player_torso');
      if (torsoImg) {
        ctx.drawImage(torsoImg, -torsoKick - 39, -30, 60, 60);
      }
      if (!rp.downed) {
        const fakeP = {
          ...state.player,
          recoilOffset: rp.recoilOffset,
          reloadTimer: 0,
          reloadDuration: 0,
          weaponSwapTimer: 0,
          akimboAlt: false,
          muzzleFlashTimer: rp.muzzleFlashTimer,
          barrelSpin: now * 0.018,
        };
        this.drawEquippedTopDownWeaponAndArms(ctx, rp.activeWepId, rp.evolved, fakeP, now);
      }
      ctx.restore();
      ctx.restore();

      if (rp.repairProgress > 0 && !rp.downed) {
        ctx.beginPath();
        ctx.arc(0, 0, 25, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * rp.repairProgress);
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 4;
        ctx.stroke();
      }

      if (rp.downed) {
        if (rp.reviveProgress > 0) {
          ctx.beginPath();
          ctx.arc(0, 0, 29, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * rp.reviveProgress);
          ctx.strokeStyle = '#4ade80';
          ctx.lineWidth = 5.5;
          ctx.stroke();
        }
        this.drawCachedLabel(
          ctx,
          I18n.t('sosAlly', { name: rp.callsign, s: Math.ceil(rp.bleedoutTimer) }),
          0,
          -32,
          '#fca5a5',
          11
        );
      } else {
        this.drawCachedLabel(ctx, rp.callsign, 0, -33, rp.color, 10.5);
        const bw = 36;
        ctx.fillStyle = '#090d16';
        ctx.fillRect(-bw / 2 - 1, -25, bw + 2, 5.5);
        ctx.fillStyle = rp.color;
        ctx.fillRect(-bw / 2, -24, bw * Math.max(0, Math.min(1, rp.hp / Math.max(1, rp.maxHp))), 3.5);
      }

      ctx.restore();
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    const p = state.player;
    if (p.spectating) return;
    const activeWep = p.weapons[p.activeSlot];
    const isFever = state.feverTimer > 0;
    const now = performance.now();
    const rigScale = p.downed ? 0.6 : 0.68;

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
        this.drawCachedLabel(ctx, I18n.t('lowAmmoWarn'), 0, -p.radius - 18, '#fde047', 10);
      }
    }

    if (p.repairProgress > 0 && !p.downed) {
      ctx.beginPath();
      ctx.arc(0, 0, p.radius + 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.repairProgress);
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 4.5;
      ctx.stroke();
    }

    if (p.downed) {
      const pulse = 26 + Math.sin(now * 0.01) * 5;
      ctx.beginPath();
      ctx.arc(0, 0, pulse, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(248, 113, 113, 0.9)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (p.reviveProgress > 0) {
        ctx.beginPath();
        ctx.arc(0, 0, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.reviveProgress);
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 5.5;
        ctx.stroke();
      }
      this.drawCachedLabel(
        ctx,
        I18n.t('sosSelf', { s: Math.ceil(p.bleedoutTimer) }),
        0,
        -p.radius - 22,
        '#fca5a5',
        11
      );
    } else if (state.isCoop) {
      this.drawCachedLabel(ctx, `${state.localCallsign}${I18n.t('meSuffix')}`, 0, -p.radius - 28, '#bae6fd', 10);
    }

    ctx.restore();
  }

  private drawTacticalBoot(ctx: CanvasRenderingContext2D, fx: number, fy: number): void {
    const bootImg = Assets.getSprite('player_boot');
    if (bootImg) {
      ctx.drawImage(bootImg, fx - 9.5, fy - 4.8, 19, 9.6);
    } else {
      ctx.fillStyle = '#1c2430';
      ctx.fillRect(fx - 7, fy - 4.5, 15, 9);
    }
  }

  private drawWeaponBackpackGear(
    ctx: CanvasRenderingContext2D,
    wepId: string,
    evolved: boolean,
    torsoKick: number
  ): void {
    if (wepId !== 'flamethrower' && wepId !== 'cryogun' && wepId !== 'minigun' && wepId !== 'tesla') {
      return;
    }

    ctx.save();
    ctx.translate(-torsoKick, 0);

    const packImg = Assets.getSprite('gear_backpack');
    if (packImg) {
      ctx.drawImage(packImg, -36, -14.5, 25, 29);
      if (evolved) {
        const tintCol =
          wepId === 'minigun' || wepId === 'tesla' ? '#c084fc' : '#38bdf8';
        const packSil = Assets.getTintedSilhouette('gear_backpack', tintCol);
        if (packSil) {
          ctx.globalAlpha = 0.36;
          ctx.drawImage(packSil, -36, -14.5, 25, 29);
          ctx.globalAlpha = 1;
        }
      }
    }

    if (wepId === 'flamethrower') {
      ctx.strokeStyle = evolved ? '#38bdf8' : '#eab308';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(-18, 11);
      ctx.quadraticCurveTo(4, 24, 26, 8);
      ctx.stroke();
    } else if (wepId === 'cryogun') {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(-19, 10);
      ctx.quadraticCurveTo(4, 23, 26, 7);
      ctx.stroke();
    } else if (wepId === 'minigun') {
      ctx.strokeStyle = evolved ? '#e879f9' : '#facc15';
      ctx.lineWidth = 5;
      ctx.setLineDash([3.5, 2.2]);
      ctx.beginPath();
      ctx.moveTo(-19, 11);
      ctx.quadraticCurveTo(4, 25, 25, 8);
      ctx.stroke();
      ctx.setLineDash([]);
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

    const swapRatio = Math.max(0, Math.min(1, p.weaponSwapTimer / 0.32));
    const swapScale = 1 + Math.sin(swapRatio * Math.PI) * 0.22;
    const swapTilt = -swapRatio * 0.34;

    const def = WEAPONS[wepId];
    const isAkimbo = Boolean(def?.akimboOnEvolve && evolved);
    const spKey = `td_${wepId}` as SpriteKey;
    const wepImg = Assets.getSprite(spKey);

    ctx.save();
    ctx.translate(-kick, 0);
    ctx.rotate(reloadTilt + swapTilt);
    ctx.scale(swapScale, swapScale);

    // ===== A. 超武双持模式（双持高精度俯视沙漠之鹰 / 左轮 / 微冲贴图 + 超武流光描边） =====
    if (isAkimbo) {
      const leftKick = p.akimboAlt ? kick * 0.65 : 0;
      const rightKick = !p.akimboAlt ? kick * 0.65 : 0;
      const lhX = 24 - leftKick;
      const lhY = -15;
      const rhX = 24 - rightKick;
      const rhY = 15;

      this.drawForearmToHand(ctx, 2, -16, lhX, lhY);
      this.drawForearmToHand(ctx, 2, 16, rhX, rhY);

      const akLen = wepId === 'pistol' ? 35 : wepId === 'revolver' ? 41 : 45;
      const akH = wepImg ? Math.max(10.5, akLen * (wepImg.height / wepImg.width) * 1.25) : 11;
      const auraCol = wepId === 'pistol' ? '#facc15' : wepId === 'revolver' ? '#fb7185' : '#38bdf8';
      const auraSil = Assets.getTintedSilhouette(spKey, auraCol);

      const drawSingleSidearm = (gx: number, gy: number) => {
        ctx.save();
        ctx.translate(gx, gy);
        if (wepImg) {
          if (auraSil) {
            ctx.globalAlpha = 0.55;
            ctx.drawImage(auraSil, -5.5, -akH / 2 - 1.2, akLen + 2.4, akH + 2.4);
            ctx.globalAlpha = 1;
          }
          ctx.drawImage(wepImg, -4.5, -akH / 2, akLen, akH);
        }
        ctx.restore();
      };

      this.drawGlovedHand(ctx, lhX, lhY);
      this.drawGlovedHand(ctx, rhX, rhY);
      drawSingleSidearm(lhX, lhY);
      drawSingleSidearm(rhX, rhY);

      if (p.muzzleFlashTimer > 0) {
        const flashY = p.akimboAlt ? 15 : -15;
        const flashX = 24 + akLen - 5;
        ctx.fillStyle = auraCol;
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

    // ===== B. 全部 15 把武器高精度 90° 纯正俯视实拍级贴图握持布局 =====
    let x0 = 16;
    let drawLen = 62;
    let minThick = 12;
    let rightHandX = 21;
    let rightHandY = 7.5;
    let leftHandX = 42;
    let leftHandY = -5.5;

    if (wepId === 'pistol') {
      x0 = 20;
      drawLen = 35;
      minThick = 10;
      rightHandX = 23;
      rightHandY = 4.5;
      leftHandX = 26;
      leftHandY = -4;
    } else if (wepId === 'revolver') {
      x0 = 19;
      drawLen = 42;
      minThick = 11.5;
      rightHandX = 22;
      rightHandY = 4.5;
      leftHandX = 26;
      leftHandY = -4;
    } else if (wepId === 'smg') {
      x0 = 17;
      drawLen = 48;
      minThick = 10.5;
      rightHandX = 21;
      rightHandY = 6.5;
      leftHandX = 36;
      leftHandY = -5;
    } else if (wepId === 'shotgun') {
      x0 = 15;
      drawLen = 62;
      minThick = 11.5;
      rightHandX = 20;
      rightHandY = 7;
      leftHandX = 43 - kick * 0.55;
      leftHandY = -4.5;
    } else if (wepId === 'autoshotgun') {
      x0 = 15;
      drawLen = 62;
      minThick = 16.5;
      rightHandX = 20;
      rightHandY = 7.5;
      leftHandX = 46;
      leftHandY = -5.5;
    } else if (wepId === 'rifle') {
      x0 = 14;
      drawLen = 68;
      minThick = 10.5;
      rightHandX = 20;
      rightHandY = 7;
      leftHandX = 44;
      leftHandY = -4.8;
    } else if (wepId === 'crossbow') {
      x0 = 16;
      drawLen = 56;
      minThick = 42;
      rightHandX = 20;
      rightHandY = 7;
      leftHandX = 41;
      leftHandY = -5;
    } else if (wepId === 'flamethrower') {
      x0 = 15;
      drawLen = 66;
      minThick = 14.5;
      rightHandX = 20;
      rightHandY = 8.5;
      leftHandX = 43;
      leftHandY = -6.5;
    } else if (wepId === 'cryogun') {
      x0 = 15;
      drawLen = 64;
      minThick = 17.5;
      rightHandX = 20;
      rightHandY = 8.5;
      leftHandX = 43;
      leftHandY = -6.5;
    } else if (wepId === 'sniper') {
      x0 = 14;
      drawLen = 88;
      minThick = 15;
      rightHandX = 19;
      rightHandY = 7;
      leftHandX = 48;
      leftHandY = -5;
    } else if (wepId === 'launcher') {
      x0 = 15;
      drawLen = 62;
      minThick = 15;
      rightHandX = 20;
      rightHandY = 8.5;
      leftHandX = 46;
      leftHandY = -6;
    } else if (wepId === 'sawlauncher') {
      x0 = 15;
      drawLen = 70;
      minThick = 22.5;
      rightHandX = 20;
      rightHandY = 9;
      leftHandX = 42;
      leftHandY = -8.5;
    } else if (wepId === 'minigun') {
      x0 = 14;
      drawLen = 74;
      minThick = 25;
      rightHandX = 18;
      rightHandY = 13.5;
      leftHandX = 37;
      leftHandY = -11.5;
    } else if (wepId === 'tesla') {
      x0 = 15;
      drawLen = 70;
      minThick = 23;
      rightHandX = 20;
      rightHandY = 8.5;
      leftHandX = 44;
      leftHandY = -6.5;
    } else if (wepId === 'plasma') {
      x0 = 15;
      drawLen = 72;
      minThick = 20.5;
      rightHandX = 20;
      rightHandY = 8.5;
      leftHandX = 45;
      leftHandY = -6.5;
    }

    const muzzleTipX = x0 + drawLen;

    if (isReloading) {
      const slap = Math.sin(reloadPhase * Math.PI * 2);
      leftHandX = 26 + slap * 7;
      leftHandY = -12 + Math.abs(slap) * 9;
    }

    // 1. 双臂战术护袖与护木托举手套（位于枪身下层，贴合自然！）
    this.drawForearmToHand(ctx, 2, 16, rightHandX, rightHandY);
    this.drawForearmToHand(ctx, 2, -16, leftHandX, leftHandY);
    this.drawGlovedHand(ctx, leftHandX, leftHandY);
    this.drawGlovedHand(ctx, rightHandX, rightHandY);

    // 2. 绘制高精度 90° 俯视武器主体贴图 + 超武进化霓虹能量外环
    if (wepImg) {
      const naturalH = drawLen * (wepImg.height / wepImg.width);
      const drawH = Math.max(minThick, naturalH);
      if (evolved) {
        const evoCol =
          wepId === 'plasma' || wepId === 'sawlauncher' || wepId === 'launcher'
            ? '#fb7185'
            : wepId === 'rifle' || wepId === 'minigun' || wepId === 'tesla'
              ? '#c084fc'
              : '#38bdf8';
        const evoSil = Assets.getTintedSilhouette(spKey, evoCol);
        if (evoSil) {
          ctx.globalAlpha = 0.56;
          ctx.drawImage(evoSil, x0 - 1.4, -drawH / 2 - 1.4, drawLen + 2.8, drawH + 2.8);
          ctx.globalAlpha = 1;
        }
      }
      ctx.drawImage(wepImg, x0, -drawH / 2, drawLen, drawH);
    }

    // 3. 特殊能量/火焰枪口实时微动态点缀（叠加于高精度贴图枪口处）
    if (wepId === 'flamethrower') {
      const flicker = 3.8 + Math.sin(now * 0.028) * 1.3;
      ctx.fillStyle = evolved ? 'rgba(56, 189, 248, 0.85)' : 'rgba(249, 115, 22, 0.88)';
      ctx.beginPath();
      ctx.arc(muzzleTipX + 2, 0, flicker * 1.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(muzzleTipX + 1, 0, flicker * 0.62, 0, Math.PI * 2);
      ctx.fill();
    } else if (wepId === 'cryogun') {
      const frostPulse = 3.4 + Math.cos(now * 0.022) * 1.2;
      ctx.fillStyle = 'rgba(186, 230, 253, 0.78)';
      ctx.beginPath();
      ctx.arc(muzzleTipX + 2, 0, frostPulse * 1.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (wepId === 'tesla') {
      ctx.strokeStyle = evolved ? '#e879f9' : '#7dd3fc';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(muzzleTipX - 3, -5);
      ctx.lineTo(muzzleTipX + 2 + Math.sin(now * 0.05) * 2.2, 0);
      ctx.lineTo(muzzleTipX - 3, 5);
      ctx.stroke();
    } else if (wepId === 'plasma') {
      ctx.fillStyle = evolved ? '#fb7185' : '#34d399';
      ctx.beginPath();
      ctx.arc(muzzleTipX - 2, 0, 3.2 + Math.sin(now * 0.025) * 1.0, 0, Math.PI * 2);
      ctx.fill();
    }

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
    _hubColor: string
  ): void {
    const sawImg = Assets.getSprite('proj_sawblade');
    const sz = radius * 2.38;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(spinAngle);
    if (sawImg) {
      ctx.drawImage(sawImg, -sz / 2, -sz / 2, sz, sz);
      if (bladeColor === '#fda4af' || bladeColor === '#fb7185') {
        const redSil = Assets.getTintedSilhouette('proj_sawblade', '#fb7185');
        if (redSil) {
          ctx.globalAlpha = 0.36;
          ctx.drawImage(redSil, -sz / 2, -sz / 2, sz, sz);
        }
      }
    } else {
      ctx.fillStyle = bladeColor;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
    }
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
        // 40mm 尾翼高爆榴弹/爆破火箭弹头高精度贴图 + 推进浓烟尾焰
        const smokeGrad = ctx.createLinearGradient(-44, 0, -8, 0);
        smokeGrad.addColorStop(0, 'rgba(148, 163, 184, 0)');
        smokeGrad.addColorStop(0.65, 'rgba(203, 213, 225, 0.36)');
        smokeGrad.addColorStop(1, 'rgba(251, 146, 60, 0.72)');
        ctx.strokeStyle = smokeGrad;
        ctx.lineWidth = 6.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-42, 0);
        ctx.lineTo(-9, 0);
        ctx.stroke();

        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.moveTo(-9, -3.2);
        ctx.lineTo(-20 - Math.sin(now * 0.06) * 4, 0);
        ctx.lineTo(-9, 3.2);
        ctx.closePath();
        ctx.fill();

        const rktImg = Assets.getSprite('proj_rocket');
        if (rktImg) {
          ctx.drawImage(rktImg, -13, -4.6, 28, 9.2);
        } else {
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(-8, -4, 18, 8);
        }

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
      const sz = isBossKind(z.kind) ? 5.2 : 3.2;
      ctx.fillRect(ox + z.x * scale - sz / 2, oy + z.y * scale - sz / 2, sz, sz);
    }

    // 小地图联机队友点位
    if (state.isCoop) {
      for (const rp of state.remotePlayers) {
        if (rp.spectating) continue;
        ctx.fillStyle = rp.downed ? '#ef4444' : rp.color;
        ctx.strokeStyle = '#090d16';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(ox + rp.x * scale, oy + rp.y * scale, rp.downed ? 4.2 : 3.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    if (!state.player.spectating) {
      ctx.fillStyle = state.player.downed ? '#f87171' : '#4ade80';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ox + state.player.x * scale, oy + state.player.y * scale, 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawOffscreenIndicators(
    ctx: CanvasRenderingContext2D,
    viewW: number,
    viewH: number,
    state: RunSnapshot
  ): void {
    const zoom = state.camera.zoom;
    const targets: { x: number; y: number; sp: SpriteKey; color: string }[] = [];
    if (state.isCoop) {
      for (const rp of state.remotePlayers) {
        if (rp.downed && !rp.spectating) {
          targets.push({ x: rp.x, y: rp.y, sp: 'item_medkit', color: '#ef4444' });
        }
      }
    }
    for (const c of state.chests) {
      targets.push({ x: c.x, y: c.y, sp: 'prop_chest', color: '#f59e0b' });
    }
    for (const z of state.zombies) {
      if (z.kind === 'thief') targets.push({ x: z.x, y: z.y, sp: 'zombie_thief', color: '#fde047' });
      else if (isBossKind(z.kind)) {
        const bp = getBossProfile(z.kind);
        targets.push({ x: z.x, y: z.y, sp: bp.sprite, color: bp.color });
      }
    }
    if (state.waveState === 'extraction') {
      targets.push({
        x: state.stage.helipadPos.x,
        y: state.stage.helipadPos.y,
        sp: 'prop_helipad',
        color: '#4ade80',
      });
    }

    const halfW = viewW / (2 * zoom) - 40;
    const halfH = viewH / (2 * zoom) - 50;
    for (const t of targets) {
      const dx = t.x - state.camera.x;
      const dy = t.y - state.camera.y;
      if (Math.abs(dx) <= halfW && Math.abs(dy) <= halfH) continue;
      const angle = Math.atan2(dy, dx);
      const ix = viewW / 2 + Math.cos(angle) * Math.min(viewW / 2 - 48, 320);
      const iy = viewH / 2 + Math.sin(angle) * Math.min(viewH / 2 - 62, 195);
      ctx.save();
      ctx.translate(ix, iy);

      // 方向三角尖角指针
      ctx.save();
      ctx.rotate(angle);
      ctx.fillStyle = t.color;
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(24, 0);
      ctx.lineTo(13, -7);
      ctx.lineTo(13, 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(9, 14, 23, 0.88)';
      ctx.fill();
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = t.color;
      ctx.stroke();

      const spImg = Assets.getSprite(t.sp);
      if (spImg) {
        ctx.drawImage(spImg, -12, -12, 24, 24);
      }
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
    // 触屏首波起步前左侧移动摇杆轻量化引导圈（一移动即自动消隐，右侧由王者荣耀式扇形轮盘直观呈现）
    if (
      input.usingTouch &&
      state.wave === 1 &&
      state.player.walkPhase < 1.2 &&
      !input.moveStick.active
    ) {
      const pulse = 0.28 + Math.sin(performance.now() * 0.005) * 0.08;
      const leftY = Math.min(viewH - 86, Math.max(viewH * 0.66, 190));
      const leftX = Math.min(110, viewW * 0.2);

      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(leftX, leftY, 38, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.globalAlpha = Math.min(0.75, pulse * 2.1);
      this.drawCachedLabel(ctx, I18n.t('leftMoveHint'), leftX, leftY, '#bae6fd', 11);
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
