# Multi-Platform Upload & Store Listing Guide — *Zombie Room Defense*

All platform packages and custom-sized promotional assets are pre-built and audited for zero competitor SDK leakage:

| Platform | Upload Bundle | Media & Covers Directory |
| :--- | :--- | :--- |
| **Itch.io** *(0 review wait, instant live)* | `itch-release.zip` (`1.72 MB`) | `platform-media/itch/` |
| **GameDistribution** *(high approval + ad rev-share)* | `gd-release.zip` (`1.72 MB`) | `platform-media/gamedistribution/` |
| **Poki** *(URL scout first, then zip)* | `https://cz.52shuxue.cc/` -> `poki-release.zip` | `crazygames-media/` |
| **CrazyGames** *(revisit after 2–4 weeks cooldown)* | `crazygames-release.zip` / `crazygames-upload/` | `crazygames-media/` (updated clean cover + new 3-scene MP4s) |

---

## 1. Uploading to Itch.io (`https://itch.io/game/new`)

1. Sign in to [itch.io](https://itch.io/) and open **`https://itch.io/game/new`**.
2. Fill in the top fields:
   - **Title**: `Zombie Room Defense: 1-4P Co-op Survival`
   - **Project URL**: `zombie-room-defense`
   - **Short description or tagline**: `1-4 Player Online Co-op Top-Down Zombie Siege! Unlock rooms, evolve 15 super weapons, survive dynamic blackouts & twin bosses.`
   - **Classification**: `Games`
   - **Kind of project**: Select **`HTML`** (*"You have a ZIP or HTML file that will be played in the browser"*).
   - **Release status**: `Released`
   - **Pricing**: `$0 or donate` (recommended for maximum traffic) or `No payments`.
3. **Uploads**:
   - Click **Upload files** -> select **`itch-release.zip`**.
   - Check ✅ **`This file will be played in the browser`**.
4. **Embed options**:
   - **Viewport dimensions**: Width **`1280`** px × Height **`720`** px
   - Check ✅ **`Mobile friendly`**
   - Check ✅ **`Automatically start on page load`**
   - Check ✅ **`Fullscreen button`**
   - Check ✅ **`Enable Scrollbars`** -> leave **UNCHECKED**
5. **Right Sidebar Media**:
   - **Upload Cover Image**: select `platform-media/itch/itch_cover_630x500.png` (`630×500`).
   - **Gameplay video or trailer**: *(Optional if you upload `trailer_1920x1080.mp4` to YouTube, paste link here)*.
   - **Screenshots** (Click *Add screenshots* and select all 4):
     - `platform-media/itch/screenshot_1_neon_horde.png`
     - `platform-media/itch/screenshot_2_blackout_flashlight.png`
     - `platform-media/itch/screenshot_3_coop_twin_boss_evac.png`
     - `platform-media/itch/screenshot_4_tactical_hud_coop.png`
6. **Genre & Tags**:
   - **Genre**: `Shooter` (or `Action`)
   - **Tags** (up to 10): `zombie`, `co-op`, `online-multiplayer`, `top-down-shooter`, `roguelite`, `survival`, `tower-defense`, `twin-stick-shooter`, `arcade`, `action`
7. **Description** (Copy & Paste):
   ```markdown
   **Zombie Room Defense** is a fast-paced **1–4 Player Online Co-op Top-Down Tactical Zombie Shooter** playable instantly in your browser on PC & Mobile!

   Barricade breached windows, pool cash with your squad to blow open locked sectors, deploy automated turrets and cybernetic war-hounds, and hold out until the rescue chopper lands on the helipad!

   ### Key Features
   - **Instant 1–4P Online Co-op**: Create a room and share a 6-digit code or invite link — zero account signup required.
   - **8 Unique Tactical Warzones & Dynamic Hazards**: Fight from SWAT Precincts and Neon Malls to Pitch-Black Subways (tactical flashlight blackout!), Bio-Labs, Airbases, and Doomsday Bunkers.
   - **15 Weapons + Pack-a-Punch Super Evolutions**: Upgrade shotguns, plasma rifles, cryo-cannons, Tesla lightning arcs, flamethrowers, and golden miniguns, plus ★1–★5 Golden Weapon Mastery!
   - **3 Threat Tiers & Twin Boss Sieges**: Conquer Standard, Nightmare, and Hell difficulty tiers featuring mutated Twin Boss encounters.
   - **Deep Endgame Buildcraft**: 4 Agent Classes, 9 Tactical Chips, Roguelite mid-run perks, and infinite Apex Paragon upgrades.

   ### Controls
   - **Move**: `WASD` / `Arrow Keys` (or Left Virtual Stick on Mobile)
   - **Aim & Shoot**: `Mouse` + `Left Click` (or Right Aim Wheel on Mobile)
   - **Switch Weapon**: `1` / `2` / `Q`
   - **Reload**: `R` | **Active Class Skill**: `F` | **Frag Grenade**: `G` / `Space`
   - **Tactical Armory & Upgrades**: `B` / `Tab` | **Pause**: `Esc` / `P`
   ```
8. **Visibility & access** (bottom of page):
   - Switch from *Draft* to **`Public`**, then click **Save & view page** — your game is immediately live worldwide!

---

## 2. Uploading to GameDistribution (`https://developer.gamedistribution.com/`)

1. Register / Sign in at **`https://developer.gamedistribution.com/`** and click **`Add Game`** (or **`Upload Game`**).
2. Enter the game title: **`Zombie Room Defense`** -> GameDistribution will generate a **32-character `Game ID`** (e.g. `4f3d7d9a...`) on your game's dashboard page.
3. **Stamp your `Game ID` into `gd-release.zip` (takes 1 second)**:
   Run this single command in `/home/better/IdeaProjects/czgame`:
   ```bash
   python3 scripts/set_gd_id.py YOUR_32_CHAR_GAME_ID
   ```
   *(Or rebuild from source via `VITE_GD_GAME_ID=YOUR_32_CHAR_GAME_ID npm run pack:gd`.)*
4. **Upload Game Package**:
   - Upload **`gd-release.zip`** (`1.72 MB`, already integrated with `html5.api.gamedistribution.com/main.min.js`, `GD_OPTIONS`, `SDK_GAME_PAUSE` / `SDK_GAME_START` audio muting, interstitial cooldowns, and `SDK_REWARDED_WATCH_COMPLETE` anti-exploit verification).
5. **Upload Thumbnails & Promo Assets** from `platform-media/gamedistribution/`:
   - **512 × 512**: `gd_512x512.png` *(Mandatory)*
   - **512 × 384**: `gd_512x384.png` *(Mandatory)*
   - **200 × 120**: `gd_200x120.png` *(Mandatory)*
   - **1280 × 720**: `gd_1280x720.png`
   - **1280 × 550**: `gd_1280x550.png`
6. **Game Metadata on GameDistribution**:
   - **Category**: `Action` / `Shooting`
   - **Mobile Ready / Responsive**: `Yes` (Landscape & Desktop supported)
   - **HTTPS Ready**: `Yes`
   - **Rewarded Ads Implemented**: `Yes` (Tactical Supply Drop, Free Airdrop Revive, Bonus Mission Claim)
   - **Description**:
     `Hold the line solo or in 1-4 player online co-op!Zombie Room Defense is an action-packed top-down survival shooter across 8 dynamic warzones. Barricade windows, unlock new rooms, deploy auto-turrets and a cybernetic war-hound, evolve 15 devastating weapons, survive subway blackouts, and defeat giant mutant bosses until the rescue chopper arrives!`
   - **Instructions**:
     `Desktop: WASD or Arrow Keys to move, Mouse to aim & Left Click to shoot, 1/2/Q to switch weapons, R to reload, F for class skill, G/Space for grenade, B/Tab to open Armory. Mobile: Touch & drag left stick to move, right aim wheel to fire, tap Armory & skill buttons.`
7. Click **Submit for Review**!
