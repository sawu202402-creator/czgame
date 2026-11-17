declare const __BUILD_PLATFORM__: 'crazygames' | 'poki' | 'web';
const ASSET_VER_SUFFIX = __BUILD_PLATFORM__ === 'web' ? '?v=fx4' : '';

export type SpriteKey =
  | 'player_hero'
  | 'player_torso'
  | 'mech_dog'
  | 'zombie_walker'
  | 'zombie_runner'
  | 'zombie_spitter'
  | 'zombie_boomer'
  | 'zombie_riot'
  | 'zombie_frost'
  | 'zombie_necro'
  | 'zombie_thief'
  | 'zombie_miniboss'
  | 'zombie_boss'
  | 'boss_warden'
  | 'boss_chainsaw'
  | 'boss_venom'
  | 'boss_surgeon'
  | 'boss_kraken'
  | 'boss_tesla'
  | 'boss_cryo'
  | 'prop_chest'
  | 'prop_barrel'
  | 'prop_turret'
  | 'prop_pap'
  | 'prop_desk'
  | 'prop_crates'
  | 'prop_swat_van'
  | 'prop_fountain'
  | 'prop_grenade'
  | 'prop_police_car'
  | 'prop_sofa'
  | 'prop_lockers'
  | 'prop_cryo_pod'
  | 'prop_arcade'
  | 'prop_armory_kiosk'
  | 'prop_ammo_box'
  | 'prop_vending'
  | 'prop_laser_tower'
  | 'prop_blast_door'
  | 'prop_wood_plank'
  | 'prop_helipad'
  | 'player_boot'
  | 'prop_sandbags'
  | 'prop_barrier'
  | 'prop_tree'
  | 'drop_powerup'
  | 'drop_cash'
  | 'drop_xp'
  | 'proj_sawblade'
  | 'fx_claw_slash'
  | 'fx_explosion'
  | 'item_armor'
  | 'item_medkit'
  | 'item_emp_grid'
  | 'prop_helicopter'
  | 'proj_rocket'
  | 'gear_backpack'
  | 'ui_coin'
  | 'decal_scorch'
  | 'decal_blood'
  | 'pool_acid'
  | 'prop_turbine'
  | 'prop_floor_grate'
  | 'prop_traffic_cone'
  | 'prop_hospital_bed'
  | 'prop_ambulance'
  | 'prop_container'
  | 'prop_forklift'
  | 'prop_subway_car'
  | 'prop_military_truck'
  | 'prop_radar_console'
  | 'prop_missile_pod'
  | 'relic_ricochet'
  | 'relic_shock_plank'
  | 'relic_war_bonds'
  | 'relic_tesla_boots'
  | 'relic_vamp_core'
  | 'relic_napalm'
  | 'relic_cluster_core'
  | 'td_pistol'
  | 'td_revolver'
  | 'td_smg'
  | 'td_shotgun'
  | 'td_autoshotgun'
  | 'td_rifle'
  | 'td_crossbow'
  | 'td_sniper'
  | 'td_flamethrower'
  | 'td_cryogun'
  | 'td_launcher'
  | 'td_sawlauncher'
  | 'td_minigun'
  | 'td_tesla'
  | 'td_plasma'
  | 'gun_pistol'
  | 'gun_revolver'
  | 'gun_smg'
  | 'gun_shotgun'
  | 'gun_rifle'
  | 'gun_autoshotgun'
  | 'gun_flamethrower'
  | 'gun_crossbow'
  | 'gun_sniper'
  | 'gun_cryogun'
  | 'gun_launcher'
  | 'gun_sawlauncher'
  | 'gun_minigun'
  | 'gun_tesla'
  | 'gun_plasma';

export type TileKey =
  | 'tile_grass'
  | 'tile_floor_lobby'
  | 'tile_floor_armory'
  | 'tile_floor_lab'
  | 'tile_floor_mall'
  | 'tile_floor_hospital'
  | 'tile_floor_dock'
  | 'tile_floor_bunker'
  | 'tile_asphalt'
  | 'tile_wall_top';

const SPRITE_FILES: Record<SpriteKey, string> = {
  player_hero: './assets/player_hero.png',
  player_torso: './assets/player_torso.png',
  mech_dog: './assets/mech_dog.png',
  zombie_walker: './assets/zombie_walker.png',
  zombie_runner: './assets/zombie_runner.png',
  zombie_spitter: './assets/zombie_spitter.png',
  zombie_boomer: './assets/zombie_boomer.png',
  zombie_riot: './assets/zombie_riot.png',
  zombie_frost: './assets/zombie_frost.png',
  zombie_necro: './assets/zombie_necro.png',
  zombie_thief: './assets/zombie_thief.png',
  zombie_miniboss: './assets/zombie_miniboss.png',
  zombie_boss: './assets/zombie_boss.png',
  boss_warden: './assets/boss_warden.png',
  boss_chainsaw: './assets/boss_chainsaw.png',
  boss_venom: './assets/boss_venom.png',
  boss_surgeon: './assets/boss_surgeon.png',
  boss_kraken: './assets/boss_kraken.png',
  boss_tesla: './assets/boss_tesla.png',
  boss_cryo: './assets/boss_cryo.png',
  prop_chest: './assets/prop_chest.png',
  prop_barrel: './assets/prop_barrel.png',
  prop_turret: './assets/prop_turret.png',
  prop_pap: './assets/prop_pap.png',
  prop_desk: './assets/prop_desk.png',
  prop_crates: './assets/prop_crates.png',
  prop_swat_van: './assets/prop_swat_van.png',
  prop_fountain: './assets/prop_fountain.png',
  prop_grenade: './assets/prop_grenade.png',
  prop_police_car: './assets/prop_police_car.png',
  prop_sofa: './assets/prop_sofa.png',
  prop_lockers: './assets/prop_lockers.png',
  prop_cryo_pod: './assets/prop_cryo_pod.png',
  prop_arcade: './assets/prop_arcade.png',
  prop_armory_kiosk: './assets/prop_armory_kiosk.png',
  prop_ammo_box: './assets/prop_ammo_box.png',
  prop_vending: './assets/prop_vending.png',
  prop_laser_tower: './assets/prop_laser_tower.png',
  prop_blast_door: './assets/prop_blast_door.png',
  prop_wood_plank: './assets/prop_wood_plank.png',
  prop_helipad: './assets/prop_helipad.png',
  player_boot: './assets/player_boot.png',
  prop_sandbags: './assets/prop_sandbags.png',
  prop_barrier: './assets/prop_barrier.png',
  prop_tree: './assets/prop_tree.png',
  drop_powerup: './assets/drop_powerup.png',
  drop_cash: './assets/drop_cash.png',
  drop_xp: './assets/drop_xp.png',
  proj_sawblade: './assets/proj_sawblade.png',
  fx_claw_slash: './assets/fx_claw_slash.png',
  fx_explosion: './assets/fx_explosion.png',
  item_armor: './assets/item_armor.png',
  item_medkit: './assets/item_medkit.png',
  item_emp_grid: './assets/item_emp_grid.png',
  prop_helicopter: './assets/prop_helicopter.png',
  proj_rocket: './assets/proj_rocket.png',
  gear_backpack: './assets/gear_backpack.png',
  ui_coin: './assets/ui_coin.png',
  decal_scorch: './assets/decal_scorch.png',
  decal_blood: './assets/decal_blood.png',
  pool_acid: './assets/pool_acid.png',
  prop_turbine: './assets/prop_turbine.png',
  prop_floor_grate: './assets/prop_floor_grate.png',
  prop_traffic_cone: './assets/prop_traffic_cone.png',
  prop_hospital_bed: './assets/prop_hospital_bed.png',
  prop_ambulance: './assets/prop_ambulance.png',
  prop_container: './assets/prop_container.png',
  prop_forklift: './assets/prop_forklift.png',
  prop_subway_car: './assets/prop_subway_car.png',
  prop_military_truck: './assets/prop_military_truck.png',
  prop_radar_console: './assets/prop_radar_console.png',
  prop_missile_pod: './assets/prop_missile_pod.png',
  relic_ricochet: './assets/relic_ricochet.png',
  relic_shock_plank: './assets/relic_shock_plank.png',
  relic_war_bonds: './assets/relic_war_bonds.png',
  relic_tesla_boots: './assets/relic_tesla_boots.png',
  relic_vamp_core: './assets/relic_vamp_core.png',
  relic_napalm: './assets/relic_napalm.png',
  relic_cluster_core: './assets/relic_cluster_core.png',
  td_pistol: './assets/td_pistol.png',
  td_revolver: './assets/td_revolver.png',
  td_smg: './assets/td_smg.png',
  td_shotgun: './assets/td_shotgun.png',
  td_autoshotgun: './assets/td_autoshotgun.png',
  td_rifle: './assets/td_rifle.png',
  td_crossbow: './assets/td_crossbow.png',
  td_sniper: './assets/td_sniper.png',
  td_flamethrower: './assets/td_flamethrower.png',
  td_cryogun: './assets/td_cryogun.png',
  td_launcher: './assets/td_launcher.png',
  td_sawlauncher: './assets/td_sawlauncher.png',
  td_minigun: './assets/td_minigun.png',
  td_tesla: './assets/td_tesla.png',
  td_plasma: './assets/td_plasma.png',
  gun_pistol: './assets/gun_pistol.png',
  gun_revolver: './assets/gun_revolver.png',
  gun_smg: './assets/gun_smg.png',
  gun_shotgun: './assets/gun_shotgun.png',
  gun_rifle: './assets/gun_rifle.png',
  gun_autoshotgun: './assets/gun_autoshotgun.png',
  gun_flamethrower: './assets/gun_flamethrower.png',
  gun_crossbow: './assets/gun_crossbow.png',
  gun_sniper: './assets/gun_sniper.png',
  gun_cryogun: './assets/gun_cryogun.png',
  gun_launcher: './assets/gun_launcher.png',
  gun_sawlauncher: './assets/gun_sawlauncher.png',
  gun_minigun: './assets/gun_minigun.png',
  gun_tesla: './assets/gun_tesla.png',
  gun_plasma: './assets/gun_plasma.png',
};

const TILE_FILES: Record<TileKey, string> = {
  tile_grass: './assets/tile_grass.png',
  tile_floor_lobby: './assets/tile_floor_lobby.png',
  tile_floor_armory: './assets/tile_floor_armory.png',
  tile_floor_lab: './assets/tile_floor_lab.png',
  tile_floor_mall: './assets/tile_floor_mall.png',
  tile_floor_hospital: './assets/tile_floor_hospital.png',
  tile_floor_dock: './assets/tile_floor_dock.png',
  tile_floor_bunker: './assets/tile_floor_bunker.png',
  tile_asphalt: './assets/tile_asphalt.png',
  tile_wall_top: './assets/tile_wall_top.png',
};

// 首屏/新手靶场核心最小资产集（仅约 32 个小文件 < 260 KB，隐私模式冷启动 0.6s 极速进游戏！）
const CRITICAL_SPRITES: SpriteKey[] = [
  'player_hero',
  'player_torso',
  'player_boot',
  'gear_backpack',
  'zombie_walker',
  'zombie_runner',
  'boss_warden',
  'td_pistol',
  'td_smg',
  'gun_pistol',
  'gun_smg',
  'prop_blast_door',
  'prop_wood_plank',
  'prop_helipad',
  'prop_helicopter',
  'prop_armory_kiosk',
  'prop_ammo_box',
  'prop_pap',
  'prop_chest',
  'prop_barrel',
  'prop_desk',
  'prop_grenade',
  'prop_sandbags',
  'prop_barrier',
  'prop_tree',
  'prop_traffic_cone',
  'prop_floor_grate',
  'drop_cash',
  'drop_xp',
  'fx_explosion',
  'fx_claw_slash',
  'decal_scorch',
  'decal_blood',
  'ui_coin',
  'item_medkit',
  'item_armor',
];

const CRITICAL_TILES: TileKey[] = [
  'tile_grass',
  'tile_floor_lobby',
  'tile_asphalt',
  'tile_wall_top',
];

class GameAssetManager {
  private sprites = new Map<SpriteKey, HTMLImageElement>();
  private whiteSilhouettes = new Map<SpriteKey, HTMLCanvasElement>();
  private tintedSilhouettes = new Map<string, HTMLCanvasElement>();
  private tiles = new Map<TileKey, HTMLImageElement>();
  private patterns = new Map<string, CanvasPattern>();
  private inflightSprites = new Map<SpriteKey, Promise<void>>();
  private inflightTiles = new Map<TileKey, Promise<void>>();

  private ensureSpriteLoaded(key: SpriteKey): Promise<void> {
    if (this.sprites.has(key)) return Promise.resolve();
    const existing = this.inflightSprites.get(key);
    if (existing) return existing;
    const p = this.loadImage(SPRITE_FILES[key]).then((img) => {
      this.inflightSprites.delete(key);
      if (img) {
        this.sprites.set(key, img);
      }
    });
    this.inflightSprites.set(key, p);
    return p;
  }

  private ensureTileLoaded(key: TileKey): Promise<void> {
    if (this.tiles.has(key)) return Promise.resolve();
    const existing = this.inflightTiles.get(key);
    if (existing) return existing;
    const p = this.loadImage(TILE_FILES[key]).then((img) => {
      this.inflightTiles.delete(key);
      if (img) {
        this.tiles.set(key, img);
      }
    });
    this.inflightTiles.set(key, p);
    return p;
  }

  /**
   * 第一阶段（冷启动极速首屏）：仅阻塞加载约 30 个核心小贴图（< 260 KB），零同步 Canvas 分配
   */
  public async preloadCritical(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    const total = CRITICAL_SPRITES.length + CRITICAL_TILES.length;
    let loaded = 0;
    const bump = () => {
      loaded += 1;
      onProgress?.(loaded, total);
    };

    const tasks: Promise<void>[] = [
      ...CRITICAL_SPRITES.map((k) => this.ensureSpriteLoaded(k).then(bump)),
      ...CRITICAL_TILES.map((k) => this.ensureTileLoaded(k).then(bump)),
    ];
    await Promise.all(tasks);
  }

  /**
   * 第二阶段（进局后静默后台流式预热）：按每批 10 个并发平滑拉取剩余全武器与 8 大关卡贴图，不抢占首屏带宽
   */
  public async preloadRemainingInBackground(onTileUpdated?: () => void): Promise<void> {
    const remTiles = (Object.keys(TILE_FILES) as TileKey[]).filter((k) => !this.tiles.has(k));
    const remSprites = (Object.keys(SPRITE_FILES) as SpriteKey[]).filter((k) => !this.sprites.has(k));

    // 优先预热全 15 把武器（方便玩家在新手靶场随时打开 [B] 试用全部武器！）与地板瓦片
    const priorityGuns = remSprites.filter((k) => k.startsWith('td_') || k.startsWith('gun_'));
    const otherSprites = remSprites.filter((k) => !k.startsWith('td_') && !k.startsWith('gun_'));

    const orderedJobs: (() => Promise<boolean>)[] = [
      ...priorityGuns.map((k) => async () => {
        await this.ensureSpriteLoaded(k);
        return false;
      }),
      ...remTiles.map((k) => async () => {
        const hadBefore = this.tiles.has(k);
        await this.ensureTileLoaded(k);
        return !hadBefore && this.tiles.has(k);
      }),
      ...otherSprites.map((k) => async () => {
        await this.ensureSpriteLoaded(k);
        return false;
      }),
    ];

    const BATCH = 10;
    for (let i = 0; i < orderedJobs.length; i += BATCH) {
      const slice = orderedJobs.slice(i, i + BATCH);
      const results = await Promise.all(slice.map((fn) => fn()));
      if (results.some(Boolean)) {
        onTileUpdated?.();
      }
    }
  }

  public async preloadAll(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    const spriteKeys = Object.keys(SPRITE_FILES) as SpriteKey[];
    const tileKeys = Object.keys(TILE_FILES) as TileKey[];
    const total = spriteKeys.length + tileKeys.length;
    let loaded = 0;
    const bump = () => {
      loaded += 1;
      onProgress?.(loaded, total);
    };
    await Promise.all([
      ...spriteKeys.map((k) => this.ensureSpriteLoaded(k).then(bump)),
      ...tileKeys.map((k) => this.ensureTileLoaded(k).then(bump)),
    ]);
  }

  private loadImage(src: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = `${src}${ASSET_VER_SUFFIX}`;
    });
  }

  private createSilhouette(img: HTMLImageElement, color: string): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const cctx = c.getContext('2d')!;
    cctx.drawImage(img, 0, 0);
    cctx.globalCompositeOperation = 'source-in';
    cctx.fillStyle = color;
    cctx.fillRect(0, 0, c.width, c.height);
    return c;
  }

  public getSprite(key: SpriteKey): HTMLImageElement | undefined {
    return this.sprites.get(key);
  }

  public getWhiteFlash(key: SpriteKey): HTMLCanvasElement | undefined {
    const cached = this.whiteSilhouettes.get(key);
    if (cached) return cached;
    const img = this.sprites.get(key);
    if (!img) return undefined;
    const sil = this.createSilhouette(img, '#ffffff');
    this.whiteSilhouettes.set(key, sil);
    return sil;
  }

  public getTintedSilhouette(key: SpriteKey, color: string): HTMLCanvasElement | undefined {
    const ck = `${key}::${color}`;
    if (this.tintedSilhouettes.has(ck)) return this.tintedSilhouettes.get(ck);
    const img = this.sprites.get(key);
    if (!img) return undefined;
    const sil = this.createSilhouette(img, color);
    this.tintedSilhouettes.set(ck, sil);
    return sil;
  }

  public getPattern(ctx: CanvasRenderingContext2D, key: TileKey, scale = 0.72): CanvasPattern | null {
    const cacheKey = `${key}@${scale}`;
    if (this.patterns.has(cacheKey)) {
      return this.patterns.get(cacheKey)!;
    }
    const img = this.tiles.get(key);
    if (!img) return null;
    const pat = ctx.createPattern(img, 'repeat');
    if (pat) {
      if (scale !== 1 && typeof pat.setTransform === 'function' && typeof DOMMatrix !== 'undefined') {
        pat.setTransform(new DOMMatrix().scale(scale, scale));
      }
      this.patterns.set(cacheKey, pat);
    }
    return pat;
  }
}

export const Assets = new GameAssetManager();
