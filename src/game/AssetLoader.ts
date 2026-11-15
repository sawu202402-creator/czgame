export type SpriteKey =
  | 'player_hero'
  | 'player_torso'
  | 'mech_dog'
  | 'zombie_walker'
  | 'zombie_runner'
  | 'zombie_spitter'
  | 'zombie_thief'
  | 'zombie_miniboss'
  | 'zombie_boss'
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
  | 'tile_asphalt';

const SPRITE_FILES: Record<SpriteKey, string> = {
  player_hero: './assets/player_hero.png',
  player_torso: './assets/player_torso.png',
  mech_dog: './assets/mech_dog.png',
  zombie_walker: './assets/zombie_walker.png',
  zombie_runner: './assets/zombie_runner.png',
  zombie_spitter: './assets/zombie_spitter.png',
  zombie_thief: './assets/zombie_thief.png',
  zombie_miniboss: './assets/zombie_miniboss.png',
  zombie_boss: './assets/zombie_boss.png',
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
  tile_asphalt: './assets/tile_asphalt.png',
};

class GameAssetManager {
  private sprites = new Map<SpriteKey, HTMLImageElement>();
  private whiteSilhouettes = new Map<SpriteKey, HTMLCanvasElement>();
  private tiles = new Map<TileKey, HTMLImageElement>();
  private patterns = new Map<string, CanvasPattern>();

  public async preloadAll(): Promise<void> {
    const tasks: Promise<void>[] = [];

    (Object.keys(SPRITE_FILES) as SpriteKey[]).forEach((key) => {
      tasks.push(
        this.loadImage(SPRITE_FILES[key]).then((img) => {
          if (img) {
            this.sprites.set(key, img);
            this.whiteSilhouettes.set(key, this.createSilhouette(img, '#ffffff'));
          }
        })
      );
    });

    (Object.keys(TILE_FILES) as TileKey[]).forEach((key) => {
      tasks.push(
        this.loadImage(TILE_FILES[key]).then((img) => {
          if (img) this.tiles.set(key, img);
        })
      );
    });

    await Promise.all(tasks);
  }

  private loadImage(src: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
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
    return this.whiteSilhouettes.get(key);
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
