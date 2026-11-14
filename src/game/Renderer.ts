import { POWERUP_META } from '../data/perksAndRelics';
import { SaveManager } from '../meta/SaveManager';
import { FloorTheme, PropKind } from '../types';
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

const MAP_PAD = 360;

export class CartoonRenderer {
  // 静态世界地图离屏烘焙缓存（消除每帧全图 Pattern / Clip / 墙体重复绘制，帧率提升 10 倍！）
  private mapCanvas: HTMLCanvasElement | null = null;
  private cachedStageId = '';
  private cachedMapRevision = -1;

  // 描边文字微缓存（避免每帧在 Canvas 上反复调用昂贵的 strokeText）
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

    // 1. 单次极速 Blit 预烘焙的静态世界地图（仅拷贝当前视野矩形！）
    this.blitStaticMapViewport(ctx);

    // 2. 地面爆汁贴花
    this.drawDecals(ctx, state);

    // 3. 停机坪标志 & 直升机撤离光圈
    this.drawHelipad(ctx, state);

    // 4. 紧凑精致的房间互动站点
    this.drawStations(ctx, state);

    // 5. 动态窗户木板与可解锁安全门
    this.drawWindowsAndDoors(ctx, state);

    // 6. 掉落物、神秘宝物箱、紧凑爆炸红油桶
    this.drawDropsAndChests(ctx, state);
    this.drawBarrels(ctx, state);

    // 7. 自动机枪塔与机械警犬伙伴
    this.drawTurretsAndDog(ctx, state);

    // 8. 纯正俯视角动态步态僵尸群与酸液弹
    this.drawZombies(ctx, state);
    this.drawSpits(ctx, state);

    // 9. 全身骨骼分体特工主角（独立步态双脚 + 呼吸摆臂 + 9把真实枪械俯视建模 + 射击后坐力 + 换弹动作）
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

  // ==================== 离屏静态地图烘焙（仅在开局和开门瞬间执行 1 次） ====================

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

    const totalW = state.stage.worldWidth + MAP_PAD * 2;
    const totalH = state.stage.worldHeight + MAP_PAD * 2;

    if (!this.mapCanvas) {
      this.mapCanvas = document.createElement('canvas');
    }
    if (this.mapCanvas.width !== totalW || this.mapCanvas.height !== totalH) {
      this.mapCanvas.width = totalW;
      this.mapCanvas.height = totalH;
    }

    const mctx = this.mapCanvas.getContext('2d')!;
    mctx.save();
    mctx.clearRect(0, 0, totalW, totalH);
    mctx.translate(MAP_PAD, MAP_PAD);

    // A. 户外草坪背景
    const grassPat = Assets.getPattern(mctx, 'tile_grass');
    mctx.fillStyle = grassPat || '#4ade80';
    mctx.fillRect(-MAP_PAD, -MAP_PAD, totalW, totalH);

    // B. 建筑外侧石板路裙边
    mctx.fillStyle = 'rgba(15, 23, 42, 0.3)';
    for (const room of state.rooms) {
      for (const r of room.rects) {
        mctx.beginPath();
        mctx.roundRect(r.x - 36, r.y - 34, r.w + 76, r.h + 72, 16);
        mctx.fill();
      }
    }
    const asphaltPat = Assets.getPattern(mctx, 'tile_asphalt');
    mctx.fillStyle = asphaltPat || '#475569';
    for (const room of state.rooms) {
      for (const r of room.rects) {
        mctx.beginPath();
        mctx.roundRect(r.x - 30, r.y - 30, r.w + 60, r.h + 60, 12);
        mctx.fill();
      }
    }

    // C. 各房间无缝地板与锁定迷雾遮罩
    for (const room of state.rooms) {
      const tileKey = FLOOR_THEME_TILE[room.floorTheme];
      const pat = Assets.getPattern(mctx, tileKey);

      mctx.save();
      mctx.beginPath();
      for (const r of room.rects) {
        mctx.rect(r.x, r.y, r.w, r.h);
      }
      mctx.clip();

      for (const r of room.rects) {
        mctx.fillStyle = pat || '#fef3c7';
        mctx.fillRect(r.x, r.y, r.w, r.h);

        const gt = mctx.createLinearGradient(0, r.y, 0, r.y + 24);
        gt.addColorStop(0, 'rgba(15, 23, 42, 0.24)');
        gt.addColorStop(1, 'rgba(15, 23, 42, 0)');
        mctx.fillStyle = gt;
        mctx.fillRect(r.x, r.y, r.w, 24);
      }

      if (room.unlocked) {
        mctx.font = '900 18px system-ui, sans-serif';
        mctx.textAlign = 'center';
        mctx.textBaseline = 'middle';
        mctx.fillStyle =
          room.floorTheme === 'asphalt' || room.floorTheme === 'lab'
            ? 'rgba(255, 255, 255, 0.16)'
            : 'rgba(15, 23, 42, 0.14)';
        mctx.fillText(room.name, room.labelPos.x, room.labelPos.y);
      } else {
        mctx.fillStyle = 'rgba(15, 23, 42, 0.68)';
        for (const r of room.rects) {
          mctx.fillRect(r.x, r.y, r.w, r.h);
        }
        this.drawCachedLabel(mctx, `未开启 · ${room.name}`, room.labelPos.x, room.labelPos.y, '#cbd5e1', 16);
      }
      mctx.restore();
    }

    // D. 室内静态战术掩体家具
    for (const pr of state.props) {
      const room = state.rooms.find((r) => r.id === pr.roomId);
      if (!room?.unlocked) continue;
      const spKey = PROP_SPRITE_MAP[pr.kind];
      const img = Assets.getSprite(spKey);

      mctx.save();
      mctx.translate(pr.x, pr.y);
      if (pr.rotation) mctx.rotate(pr.rotation);

      mctx.fillStyle = 'rgba(15, 23, 42, 0.3)';
      mctx.beginPath();
      if (pr.kind === 'fountain') {
        mctx.arc(3, 5, pr.w * 0.46, 0, Math.PI * 2);
      } else {
        mctx.roundRect(-pr.w / 2 + 4, -pr.h / 2 + 6, pr.w, pr.h, 10);
      }
      mctx.fill();

      const drawDim = Math.max(pr.w, pr.h) * 1.05;
      if (img) {
        mctx.drawImage(img, -drawDim / 2, -drawDim / 2, drawDim, drawDim);
      } else {
        mctx.fillStyle = '#64748b';
        mctx.fillRect(-pr.w / 2, -pr.h / 2, pr.w, pr.h);
      }
      mctx.restore();
    }

    // E. 全部实心立体墙体与投影
    for (const w of state.walls) {
      mctx.fillStyle = 'rgba(15, 23, 42, 0.3)';
      mctx.fillRect(w.x + 4, w.y + 6, w.w, w.h);

      mctx.fillStyle = state.stage.wallColor;
      mctx.fillRect(w.x, w.y, w.w, w.h);

      mctx.fillStyle = state.stage.wallTopColor;
      mctx.fillRect(w.x + 4, w.y + 3, Math.max(0, w.w - 8), Math.max(0, w.h - 9));

      mctx.strokeStyle = '#0f172a';
      mctx.lineWidth = 3;
      mctx.strokeRect(w.x, w.y, w.w, w.h);
    }

    mctx.restore();
  }

  private blitStaticMapViewport(ctx: CanvasRenderingContext2D): void {
    if (!this.mapCanvas) return;
    const sx = Math.max(0, Math.floor(this.vLeft + MAP_PAD - 8));
    const sy = Math.max(0, Math.floor(this.vTop + MAP_PAD - 8));
    const ex = Math.min(this.mapCanvas.width, Math.ceil(this.vRight + MAP_PAD + 8));
    const ey = Math.min(this.mapCanvas.height, Math.ceil(this.vBottom + MAP_PAD + 8));
    const sw = ex - sx;
    const sh = ey - sy;
    if (sw <= 0 || sh <= 0) return;

    ctx.drawImage(this.mapCanvas, sx, sy, sw, sh, sx - MAP_PAD, sy - MAP_PAD, sw, sh);
  }

  // ==================== 地面与房间动态交互物 ====================

  private drawDecals(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    for (const dc of state.decals) {
      if (!this.inView(dc.x, dc.y, 40)) continue;
      ctx.save();
      ctx.globalAlpha = Math.min(1, dc.life / 3.5);
      ctx.fillStyle = dc.color;
      ctx.beginPath();
      ctx.arc(dc.x, dc.y, dc.radius * 0.72, 0, Math.PI * 2);
      ctx.arc(
        dc.x + Math.cos(dc.seed) * dc.radius * 0.42,
        dc.y + Math.sin(dc.seed) * dc.radius * 0.42,
        dc.radius * 0.42,
        0,
        Math.PI * 2
      );
      ctx.fill();
      ctx.restore();
    }
  }

  private drawHelipad(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    const courtyard = state.rooms.find((r) => r.id === 'courtyard');
    if (!courtyard?.unlocked && state.waveState !== 'extraction') return;

    const { x, y } = state.stage.helipadPos;
    if (!this.inView(x, y, 120)) return;
    const isExtracting = state.waveState === 'extraction';
    const pulse = 0.85 + Math.sin(performance.now() * 0.008) * 0.15;

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 72, 0, Math.PI * 2);
    ctx.fillStyle = isExtracting ? `rgba(34, 197, 94, ${0.34 * pulse})` : 'rgba(15, 23, 42, 0.25)';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = isExtracting ? '#4ade80' : '#facc15';
    ctx.setLineDash([14, 9]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = '900 38px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isExtracting ? '#4ade80' : 'rgba(250, 204, 21, 0.7)';
    ctx.fillText('H', x, y);

    if (isExtracting) {
      ctx.beginPath();
      ctx.arc(x, y, 80, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * state.extractionProgress);
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 8;
      ctx.stroke();

      const rotorAngle = performance.now() * 0.018;
      ctx.save();
      ctx.translate(x, y - 10);
      ctx.rotate(rotorAngle);
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.42)';
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-78, 0);
      ctx.lineTo(78, 0);
      ctx.moveTo(0, -78);
      ctx.lineTo(0, 78);
      ctx.stroke();
      ctx.restore();

      this.drawCachedLabel(ctx, '踩入光圈撤离!', x, y - 94, '#fef08a', 15);
    }
    ctx.restore();
  }

  private drawStations(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    const save = SaveManager.get();
    const now = performance.now() * 0.005;

    for (const st of state.stations) {
      if (!this.inView(st.x, st.y, 75)) continue;
      const room = state.rooms.find((r) => r.id === st.roomId);
      if (!room?.unlocked) continue;
      if (st.used && (st.type === 'starter_airdrop' || st.type === 'mech_dog_cage')) continue;

      // 精致小巧的地面战术交互底座（30px 半径，告别硕大遮挡！）
      const padR = 30;
      let ringColor = '#38bdf8';
      let priceTag = st.cost > 0 ? `$${st.cost}` : '';

      if (st.type === 'armory_kiosk') {
        ringColor = '#4ade80';
        const near = Math.hypot(state.player.x - st.x, state.player.y - st.y) < 120;
        priceTag = near ? '踩入或按 B' : '';
      } else if (st.type === 'starter_airdrop') {
        ringColor = '#f59e0b';
        priceTag = save.freeStarterUsedCount < 2 ? '免费试用' : '看广告领';
      } else if (st.type === 'ammo_box') {
        ringColor = '#22c55e';
      } else if (st.type === 'pack_a_punch') {
        ringColor = '#c084fc';
      } else if (st.type === 'mech_dog_cage') {
        ringColor = '#38bdf8';
      } else if (st.type === 'vending_machine') {
        ringColor = '#f472b6';
      } else if (st.type === 'laser_trap') {
        ringColor = '#ef4444';
        if (st.activeTimer > 0) priceTag = `${st.activeTimer.toFixed(0)}s`;
      }

      ctx.save();
      ctx.beginPath();
      ctx.arc(st.x, st.y, padR, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.52)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = ringColor;
      ctx.stroke();

      if (st.progress > 0) {
        ctx.beginPath();
        ctx.arc(st.x, st.y, padR + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * st.progress);
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 5.5;
        ctx.stroke();
      }

      if (st.type === 'armory_kiosk') {
        this.drawCenteredSprite(ctx, 'prop_armory_kiosk', st.x, st.y, 48, 0);
      } else if (st.type === 'pack_a_punch') {
        this.drawCenteredSprite(ctx, 'prop_pap', st.x, st.y, 48, 0);
      } else if (st.type === 'starter_airdrop') {
        this.drawCenteredSprite(ctx, 'prop_chest', st.x, st.y + Math.sin(now * 1.3) * 2, 44, 0);
      } else if (st.type === 'mech_dog_cage') {
        this.drawCenteredSprite(ctx, 'mech_dog', st.x, st.y, 44, -0.4);
      } else if (st.type === 'ammo_box') {
        // 矢量弹药箱小图标，免 Emoji 卡顿且比例精致
        ctx.fillStyle = '#16a34a';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(st.x - 14, st.y - 11, 28, 22, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fde047';
        ctx.fillRect(st.x - 8, st.y - 4, 16, 8);
      } else {
        ctx.fillStyle = st.type === 'vending_machine' ? '#ec4899' : '#ef4444';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(st.x, st.y, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      if (st.type === 'laser_trap' && st.activeTimer > 0) {
        const beamAngle = performance.now() * 0.0045;
        for (let i = 0; i < 2; i++) {
          const a = beamAngle + i * Math.PI;
          ctx.beginPath();
          ctx.moveTo(st.x, st.y);
          ctx.lineTo(st.x + Math.cos(a) * 255, st.y + Math.sin(a) * 255);
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.55)';
          ctx.lineWidth = 14;
          ctx.stroke();
          ctx.strokeStyle = '#fef08a';
          ctx.lineWidth = 3.5;
          ctx.stroke();
        }
      }

      this.drawCachedLabel(ctx, st.label, st.x, st.y - 38, '#ffffff', 11);
      if (priceTag) {
        this.drawCachedLabel(ctx, priceTag, st.x, st.y + 38, '#fde047', 11);
      }
      ctx.restore();
    }
  }

  private drawWindowsAndDoors(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    const electricActive = state.electricFortifyWaves > 0;

    for (const win of state.windows) {
      if (!this.inView(win.x + win.w / 2, win.y + win.h / 2, 80)) continue;
      ctx.save();
      ctx.fillStyle = '#334155';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 3;
      ctx.fillRect(win.x, win.y, win.w, win.h);
      ctx.strokeRect(win.x, win.y, win.w, win.h);

      const count = win.planks;
      for (let i = 0; i < count; i++) {
        const ratio = (i + 0.5) / Math.max(1, win.maxPlanks);
        ctx.fillStyle = electricActive ? '#38bdf8' : i % 2 === 0 ? '#d97706' : '#f59e0b';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        if (win.orientation === 'horizontal') {
          const px = win.x + 6;
          const py = win.y + 2 + ratio * (win.h - 10);
          ctx.fillRect(px, py, win.w - 12, 6.5);
          ctx.strokeRect(px, py, win.w - 12, 6.5);
        } else {
          const px = win.x + 2 + ratio * (win.w - 10);
          const py = win.y + 6;
          ctx.fillRect(px, py, 6.5, win.h - 12);
          ctx.strokeRect(px, py, 6.5, win.h - 12);
        }
      }

      if (win.planks === 0) {
        const cx = win.x + win.w / 2;
        const cy = win.y + win.h / 2;
        this.drawCachedLabel(ctx, '破窗!', cx, cy, '#f87171', 11);
      }
      ctx.restore();
    }

    for (const door of state.doors) {
      if (!this.inView(door.x + door.w / 2, door.y + door.h / 2, 80)) continue;
      if (door.unlocked) {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.14)';
        ctx.fillRect(door.x, door.y, door.w, door.h);
        continue;
      }
      ctx.save();
      ctx.fillStyle = '#f59e0b';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 3.5;
      ctx.fillRect(door.x, door.y, door.w, door.h);
      ctx.strokeRect(door.x, door.y, door.w, door.h);

      ctx.fillStyle = '#1e293b';
      if (door.orientation === 'horizontal') {
        for (let sx = door.x + 12; sx < door.x + door.w - 12; sx += 24) {
          ctx.fillRect(sx, door.y + 4, 9, door.h - 8);
        }
      } else {
        for (let sy = door.y + 12; sy < door.y + door.h - 12; sy += 24) {
          ctx.fillRect(door.x + 4, sy, door.w - 8, 9);
        }
      }

      const cx = door.x + door.w / 2;
      const cy = door.y + door.h / 2;
      if (door.progress > 0) {
        ctx.beginPath();
        ctx.arc(cx, cy, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * door.progress);
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 6;
        ctx.stroke();
      }
      this.drawCachedLabel(ctx, door.label, cx, cy - 9, '#ffffff', 11);
      this.drawCachedLabel(ctx, `$${door.cost}`, cx, cy + 9, '#fef08a', 12);
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
        ctx.fillStyle = '#22c55e';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2.2;
        ctx.fillRect(-10, -7, 20, 14);
        ctx.strokeRect(-10, -7, 20, 14);
        this.drawCachedLabel(ctx, '$', 0, 0, '#fef08a', 11);
      } else if (d.kind === 'xp') {
        ctx.fillStyle = '#38bdf8';
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
      if (!this.inView(c.x, c.y, 60)) continue;
      const bounce = Math.abs(Math.sin(now * 1.25 + c.bobPhase)) * 4.5;
      ctx.save();
      ctx.beginPath();
      ctx.arc(c.x, c.y, 28, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(250, 204, 21, 0.26)';
      ctx.fill();

      this.drawCenteredSprite(ctx, 'prop_chest', c.x, c.y - bounce, 50, 0);

      if (c.progress > 0) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, 31, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * c.progress);
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 5;
        ctx.stroke();
      }
      this.drawCachedLabel(ctx, '神秘宝物箱', c.x, c.y - 34 - bounce, '#fef08a', 11);
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
      ctx.ellipse(b.x, b.y + 11, 15, 7.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.28)';
      ctx.fill();
      this.drawCenteredSprite(ctx, 'prop_barrel', b.x, b.y, 42, 0);
      ctx.restore();
    }
  }

  private drawTurretsAndDog(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    for (const t of state.turrets) {
      if (!this.inView(t.x, t.y, 60)) continue;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(t.x, t.y + 13, 19, 9.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.3)';
      ctx.fill();
      this.drawCenteredSprite(ctx, 'prop_turret', t.x, t.y, 56, t.angle);
      this.drawCachedLabel(ctx, `哨戒炮 ${t.life.toFixed(0)}s`, t.x, t.y - 30, '#7dd3fc', 10);
      ctx.restore();
    }

    if (state.mechDog.active && this.inView(state.mechDog.x, state.mechDog.y, 60)) {
      const d = state.mechDog;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(d.x, d.y + 12, 16, 8, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.28)';
      ctx.fill();
      this.drawCenteredSprite(ctx, 'mech_dog', d.x, d.y, 54, d.angle);
      this.drawCachedLabel(ctx, '机械警犬', d.x, d.y - 26, '#bae6fd', 10);
      ctx.restore();
    }
  }

  // ==================== 生动步态与扑击动画的俯视僵尸群 ====================

  private drawZombies(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    const frozen = state.powerUpTimers.freeze > 0;
    for (const z of state.zombies) {
      if (!this.inView(z.x, z.y, 70)) continue;
      const spKey = ZOMBIE_SPRITE_MAP[z.kind];
      const sway = Math.sin(z.wobblePhase) * 0.12;
      const squash = 1 + Math.sin(z.wobblePhase * 2) * 0.05;
      const lunge = z.attackAnim * 10;
      const angle = z.facingAngle + sway;
      const drawSize = z.radius * 3.15;

      ctx.save();
      ctx.translate(z.x, z.y);

      // 地面椭圆阴影
      ctx.beginPath();
      ctx.ellipse(0, z.radius * 0.65, z.radius * 0.95, z.radius * 0.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.3)';
      ctx.fill();

      if (frozen || z.slowTimer > 0) {
        ctx.beginPath();
        ctx.arc(0, 0, z.radius + 7, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(103, 232, 249, 0.34)';
        ctx.fill();
      } else if (z.burnTimer > 0) {
        ctx.beginPath();
        ctx.arc(0, 0, z.radius + 7, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(249, 115, 22, 0.36)';
        ctx.fill();
      }

      // 僵尸脚底交替迈步的小脚掌（让移动充满鲜活步伐感！）
      ctx.save();
      ctx.rotate(z.facingAngle);
      const stride = Math.sin(z.wobblePhase) * (z.radius * 0.34);
      const footSpread = z.radius * 0.42;
      ctx.fillStyle = '#1e293b';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(stride - 2, -footSpread, 6.5, 4.2, 0, 0, Math.PI * 2);
      ctx.ellipse(-stride - 2, footSpread, 6.5, 4.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // 扑击前冲位移 + 摇摆躯干
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
          z.kind === 'boss' ? '狂暴尸王' : '重装精英',
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
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(bx - 1.5, by - 1.5, bw + 3, 7);
        ctx.fillStyle = z.kind === 'thief' ? '#facc15' : '#ef4444';
        ctx.fillRect(bx, by, bw * Math.max(0, z.hp / z.maxHp), 4);
      }
    }
  }

  private drawSpits(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    for (const s of state.spits) {
      if (!this.inView(s.x, s.y, 25)) continue;
      ctx.save();
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius + 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(163, 230, 53, 0.35)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
      ctx.fillStyle = '#a3e635';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#1a2e05';
      ctx.stroke();
      ctx.restore();
    }
  }

  // ==================== 全身骨骼分体特工主角（彻底告别死板与倒立！） ====================

  private drawPlayer(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    const p = state.player;
    const activeWep = p.weapons[p.activeSlot];
    const isFever = state.feverTimer > 0;
    const now = performance.now();

    // 呼吸律动 + 移动步伐肩部扭转 + 射击后坐力回弹
    const idleBreath = 1 + Math.sin(now * 0.0042) * 0.024;
    const walkTwist = p.isMoving ? Math.sin(p.walkPhase) * 0.095 : 0;
    const walkBob = p.isMoving ? Math.abs(Math.cos(p.walkPhase)) * 1.8 : 0;
    const torsoKick = p.recoilOffset * 0.42;

    ctx.save();
    ctx.translate(p.x, p.y);

    // 1. 柔和角色脚底阴影
    ctx.beginPath();
    ctx.ellipse(0, p.radius * 0.62, p.radius * 1.02, p.radius * 0.54, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.34)';
    ctx.fill();

    // 2. 无敌 / Fever 狂热光环
    if (isFever || state.powerUpTimers.overdrive > 0 || p.invulnTimer > 0) {
      ctx.beginPath();
      ctx.arc(0, 0, p.radius + 14, 0, Math.PI * 2);
      ctx.fillStyle = p.invulnTimer > 0 ? 'rgba(56, 189, 248, 0.2)' : 'rgba(250, 204, 21, 0.24)';
      ctx.fill();
      ctx.strokeStyle = p.invulnTimer > 0 ? '#38bdf8' : '#facc15';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // 3. 下半身独立骨骼：朝向移动方向（legAngle）交替迈步的战术军靴！
    ctx.save();
    ctx.rotate(p.legAngle);
    const stride = p.isMoving ? Math.sin(p.walkPhase) * 10.5 : 0;
    this.drawTacticalBoot(ctx, stride + 2, -10.5);
    this.drawTacticalBoot(ctx, -stride + 2, 10.5);
    ctx.restore();

    // 4. 上半身独立骨骼：朝向鼠标瞄准角（p.angle）+ 肩部步态摆动 + 后坐力震动
    ctx.save();
    ctx.translate(0, -walkBob);
    ctx.rotate(p.angle);

    // 战术红点/激光瞄准虚线
    ctx.beginPath();
    ctx.moveTo(32, 0);
    ctx.lineTo(195, 0);
    ctx.strokeStyle = activeWep.evolved ? 'rgba(244, 63, 94, 0.42)' : 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([6, 6]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 持枪双臂 + 当前装备的真实俯视枪械模型 + 换弹倾斜/枪口火焰/加特林旋转枪管
    this.drawEquippedTopDownWeaponAndArms(ctx, activeWep.defId, activeWep.evolved, p);

    // 90° 纯正俯视特工头盔+护肩+战术背包精灵（叠加呼吸缩放与肩部步态微摆）
    ctx.save();
    ctx.translate(-torsoKick - 3, 0);
    ctx.rotate(walkTwist);
    ctx.scale(idleBreath, 2 - idleBreath);
    const torsoImg = Assets.getSprite('player_torso');
    if (torsoImg) {
      const torsoSz = 64;
      ctx.drawImage(torsoImg, -torsoSz / 2, -torsoSz / 2, torsoSz, torsoSz);
    }
    ctx.restore();

    ctx.restore();

    // 5. 换弹进度条与修窗环形读条
    if (p.reloadTimer > 0 && p.reloadDuration > 0) {
      const pct = 1 - p.reloadTimer / p.reloadDuration;
      const bw = 46;
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-bw / 2 - 1.5, -p.radius - 22, bw + 3, 8);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(-bw / 2, -p.radius - 20.5, bw * pct, 5);
    }

    if (p.repairProgress > 0) {
      ctx.beginPath();
      ctx.arc(0, 0, p.radius + 13, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.repairProgress);
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 5;
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawTacticalBoot(ctx: CanvasRenderingContext2D, fx: number, fy: number): void {
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.roundRect(fx - 7, fy - 4.5, 15, 9, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#475569';
    ctx.fillRect(fx + 2, fy - 2.5, 4, 5);
  }

  private drawEquippedTopDownWeaponAndArms(
    ctx: CanvasRenderingContext2D,
    wepId: string,
    evolved: boolean,
    p: RunSnapshot['player']
  ): void {
    const kick = p.recoilOffset;
    const isReloading = p.reloadTimer > 0 && p.reloadDuration > 0;
    const reloadPhase = isReloading ? 1 - p.reloadTimer / p.reloadDuration : 0;
    const reloadTilt = isReloading ? Math.sin(reloadPhase * Math.PI) * 0.45 : 0;

    ctx.save();
    ctx.translate(-kick, 0);
    ctx.rotate(reloadTilt);

    // 根据枪械类型决定左右手握持点坐标（俯视）
    let rightHandX = 16;
    let rightHandY = 9;
    let leftHandX = 25;
    let leftHandY = -6;
    let muzzleTipX = 44;

    if (wepId === 'pistol') {
      rightHandX = 18;
      rightHandY = 4;
      leftHandX = 20;
      leftHandY = -3;
      muzzleTipX = 35;
    } else if (wepId === 'minigun') {
      rightHandX = 14;
      rightHandY = 13;
      leftHandX = 24;
      leftHandY = -11;
      muzzleTipX = 52;
    } else if (wepId === 'sniper') {
      leftHandX = 29;
      leftHandY = -4;
      muzzleTipX = 58;
    } else if (wepId === 'shotgun') {
      leftHandX = 27 - kick * 0.45; // 霰弹泵动护木拉栓手感！
      leftHandY = -4;
      muzzleTipX = 46;
    }

    if (isReloading) {
      // 换弹时左手向弹匣井往返拍入新弹匣！
      const slap = Math.sin(reloadPhase * Math.PI * 2);
      leftHandX = 18 + slap * 5;
      leftHandY = -10 + Math.abs(slap) * 8;
    }

    // 绘制左右小臂（从护肩正下方伸出）
    this.drawForearmToHand(ctx, 4, 15, rightHandX, rightHandY);
    this.drawForearmToHand(ctx, 4, -15, leftHandX, leftHandY);

    // 绘制 9 把各具辨识度的俯视枪身模型
    const trim = evolved ? '#38bdf8' : '#facc15';
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = '#0f172a';

    if (wepId === 'pistol') {
      ctx.fillStyle = evolved ? '#3b82f6' : '#64748b';
      ctx.beginPath();
      ctx.roundRect(16, -3.5, 18, 7, 2.5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(20, -1.5, 11, 3);
    } else if (wepId === 'smg') {
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.roundRect(12, -4, 26, 8, 3);
      ctx.fill();
      ctx.stroke();
      // 侧插弹匣
      ctx.fillStyle = trim;
      ctx.fillRect(21, -10, 5, 6);
      ctx.strokeRect(21, -10, 5, 6);
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(38, -2, 6, 4);
    } else if (wepId === 'shotgun') {
      ctx.fillStyle = '#475569';
      ctx.fillRect(10, -3.5, 35, 7);
      ctx.strokeRect(10, -3.5, 35, 7);
      // 经典木质/战术泵动护木
      ctx.fillStyle = evolved ? '#ef4444' : '#b45309';
      ctx.beginPath();
      ctx.roundRect(leftHandX - 5, -5, 13, 10, 2.5);
      ctx.fill();
      ctx.stroke();
    } else if (wepId === 'rifle') {
      ctx.fillStyle = evolved ? '#a855f7' : '#334155';
      ctx.beginPath();
      ctx.roundRect(10, -4, 31, 8, 2.5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#eab308';
      ctx.fillRect(19, -3, 11, 6);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(41, -2, 7, 4);
      ctx.strokeRect(41, -2, 7, 4);
    } else if (wepId === 'flamethrower') {
      // 侧挂橙红高压燃料罐 + 黄铜喷火嘴
      ctx.fillStyle = evolved ? '#0284c7' : '#ea580c';
      ctx.beginPath();
      ctx.roundRect(10, 4, 18, 9, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#475569';
      ctx.fillRect(13, -4, 27, 7);
      ctx.strokeRect(13, -4, 27, 7);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(40, -3.5, 6, 6);
      ctx.strokeRect(40, -3.5, 6, 6);
      // 常驻火种小火苗
      ctx.fillStyle = evolved ? '#38bdf8' : '#fb923c';
      ctx.beginPath();
      ctx.arc(49, -0.5, 3.5 + Math.sin(performance.now() * 0.03), 0, Math.PI * 2);
      ctx.fill();
    } else if (wepId === 'sniper') {
      ctx.fillStyle = evolved ? '#0891b2' : '#166534';
      ctx.beginPath();
      ctx.roundRect(10, -4, 26, 8, 2);
      ctx.fill();
      ctx.stroke();
      // 修长重型狙击枪管 + 制退器 + 瞄准镜筒
      ctx.fillStyle = '#334155';
      ctx.fillRect(36, -2, 20, 4);
      ctx.strokeRect(36, -2, 20, 4);
      ctx.fillRect(54, -4, 4, 8);
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.roundRect(17, -2.5, 14, 5, 2);
      ctx.fill();
    } else if (wepId === 'launcher') {
      // 大口径转轮榴弹筒
      ctx.fillStyle = '#475569';
      ctx.beginPath();
      ctx.roundRect(11, -6.5, 18, 13, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = trim;
      ctx.fillRect(16, -5.5, 6, 11);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(29, -4.5, 14, 9);
      ctx.strokeRect(29, -4.5, 14, 9);
    } else if (wepId === 'minigun') {
      // 6管旋转加特林机匣！开火时可见枪管束高速旋转！
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.roundRect(10, -7.5, 18, 15, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = evolved ? '#c084fc' : '#94a3b8';
      const spinOffset = Math.sin(p.barrelSpin) * 2.5;
      ctx.fillRect(28, -6, 22, 3.2);
      ctx.fillRect(28, -1.6 + spinOffset * 0.4, 22, 3.2);
      ctx.fillRect(28, 2.8, 22, 3.2);
      ctx.strokeRect(28, -6.2, 22, 12.4);
      // 箍环
      ctx.fillStyle = trim;
      ctx.fillRect(42, -6.8, 4, 13.6);
    } else {
      // 等离子电浆炮双轨发光核心
      ctx.fillStyle = '#312e81';
      ctx.beginPath();
      ctx.roundRect(11, -6, 32, 12, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = evolved ? '#f43f5e' : '#38bdf8';
      ctx.fillRect(17, -2.5, 24, 5);
    }

    // 绘制握在枪体上的战术黑色手套拳头
    this.drawGlovedHand(ctx, rightHandX, rightHandY);
    this.drawGlovedHand(ctx, leftHandX, leftHandY);

    // 鲜明三叉枪口火焰
    if (p.muzzleFlashTimer > 0 && wepId !== 'flamethrower') {
      ctx.fillStyle = evolved ? '#38bdf8' : '#fde047';
      ctx.beginPath();
      ctx.moveTo(muzzleTipX, 0);
      ctx.lineTo(muzzleTipX + 20, -10);
      ctx.lineTo(muzzleTipX + 13, 0);
      ctx.lineTo(muzzleTipX + 22, 10);
      ctx.closePath();
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
    ctx.strokeStyle = '#0f172a';
    ctx.lineCap = 'round';
    ctx.lineWidth = 9.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(hx, hy);
    ctx.stroke();

    ctx.strokeStyle = '#f4a97b';
    ctx.lineWidth = 5.2;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(hx, hy);
    ctx.stroke();
  }

  private drawGlovedHand(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#0f172a';
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
      ctx.fillStyle = 'rgba(15, 23, 42, 0.3)';
      ctx.fill();

      ctx.translate(g.x, g.y - g.z);
      ctx.beginPath();
      ctx.arc(0, 0, 8.5, 0, Math.PI * 2);
      ctx.fillStyle = Math.floor(g.fuse * 10) % 2 === 0 ? '#ef4444' : '#166534';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#0f172a';
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawBulletsAndFX(ctx: CanvasRenderingContext2D, state: RunSnapshot): void {
    // 零渐变对象分配的极速高颜值曳光弹！
    for (const b of state.bullets) {
      if (!this.inView(b.x, b.y, 65)) continue;
      const ang = Math.atan2(b.vy, b.vx);
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(ang);

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

      const trailLen = b.laser ? 52 : b.explosiveRadius > 0 ? 20 : 26;
      ctx.globalAlpha = 0.42;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = b.radius * 1.9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-trailLen, 0);
      ctx.lineTo(2, 0);
      ctx.stroke();

      ctx.globalAlpha = 1;
      const len = b.laser ? 26 : b.explosiveRadius > 0 ? 14 : 12;
      ctx.fillStyle = b.explosiveRadius > 0 ? '#facc15' : '#ffffff';
      ctx.strokeStyle = '#0f172a';
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

  // ==================== 屏幕层紧凑小地图与指示器 ====================

  private drawTacticalMinimap(
    ctx: CanvasRenderingContext2D,
    _viewW: number,
    viewH: number,
    state: RunSnapshot
  ): void {
    const mapW = 142;
    const mapH = 102;
    const mx = 12;
    const my = viewH - mapH - 12;
    const bb = state.stage.buildingBounds;
    const scale = Math.min((mapW - 14) / bb.w, (mapH - 14) / bb.h);
    const ox = mx + (mapW - bb.w * scale) / 2 - bb.x * scale;
    const oy = my + (mapH - bb.h * scale) / 2 - bb.y * scale;

    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.76)';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(mx, my, mapW, mapH, 10);
    ctx.fill();
    ctx.stroke();

    for (const room of state.rooms) {
      ctx.fillStyle = room.unlocked ? 'rgba(148, 163, 184, 0.45)' : 'rgba(51, 65, 85, 0.42)';
      for (const r of room.rects) {
        ctx.fillRect(ox + r.x * scale, oy + r.y * scale, r.w * scale, r.h * scale);
      }
    }

    for (const d of state.doors) {
      if (d.unlocked) continue;
      ctx.fillStyle = '#facc15';
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
          ctx.fillStyle = '#38bdf8';
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
      targets.push({ x: c.x, y: c.y, tag: '宝', color: '#facc15' });
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
      ctx.strokeStyle = '#0f172a';
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
      ctx.fillStyle = 'rgba(15, 23, 42, 0.26)';
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
      ctx.fillStyle = '#facc15';
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
      if (this.labelCache.size > 320) {
        this.labelCache.clear();
      }
      badge = document.createElement('canvas');
      const bctx = badge.getContext('2d')!;
      const scale = 1.5; // 保证缩放下依然锐利清晰
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
      bctx.strokeStyle = '#0f172a';
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
