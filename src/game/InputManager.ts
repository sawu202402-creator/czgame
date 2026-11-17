export interface StickState {
  active: boolean;
  id: number;
  startX: number;
  startY: number;
  curX: number;
  curY: number;
  dx: number;
  dy: number;
}

export class InputManager {
  private keys = new Set<string>();
  public mouseScreenX = 0;
  public mouseScreenY = 0;
  public mouseDown = false;
  public usingTouch = false;
  public autoFireEnabled = false;
  private touchAutoFireInitialized = false;

  public moveStick: StickState = { active: false, id: -1, startX: 0, startY: 0, curX: 0, curY: 0, dx: 0, dy: 0 };
  public aimStick: StickState = { active: false, id: -1, startX: 0, startY: 0, curX: 0, curY: 0, dx: 0, dy: 0 };
  public attackBtnStick: StickState = { active: false, id: -1, startX: 0, startY: 0, curX: 0, curY: 0, dx: 0, dy: 0 };

  private onSwitchWeaponCb: ((slotIndex?: number) => void) | null = null;
  private onReloadCb: (() => void) | null = null;
  private onToggleArmoryCb: (() => void) | null = null;
  private onThrowGrenadeCb: (() => void) | null = null;
  private onEscapeCb: (() => void) | null = null;
  private onQuickBuyAmmoCb: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
      this.usingTouch = true;
      this.autoFireEnabled = true;
      this.touchAutoFireInitialized = true;
    }

    window.addEventListener(
      'touchstart',
      () => {
        this.usingTouch = true;
        if (!this.touchAutoFireInitialized) {
          this.autoFireEnabled = true;
          this.touchAutoFireInitialized = true;
        }
      },
      { passive: true }
    );

    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      ) {
        return;
      }

      const code = e.code;
      // 阻止方向键与空格键触发外部网页滚动（符合 CrazyGames 审核强制要求）
      if (code.startsWith('Arrow') || code === 'Space') {
        e.preventDefault();
      }
      if (e.repeat) return;

      this.keys.add(code);
      if (code === 'Escape') {
        e.preventDefault();
        this.onEscapeCb?.();
      } else if (code === 'KeyQ') {
        this.onSwitchWeaponCb?.();
      } else if (/^Digit[1-9]$/.test(code)) {
        const slot = parseInt(code.slice(5), 10) - 1;
        this.onSwitchWeaponCb?.(slot);
      } else if (code === 'KeyR') {
        this.onReloadCb?.();
      } else if (code === 'KeyB' || code === 'Tab') {
        e.preventDefault();
        this.onToggleArmoryCb?.();
      } else if (code === 'KeyG' || code === 'Space') {
        this.onThrowGrenadeCb?.();
      } else if (code === 'KeyV') {
        this.onQuickBuyAmmoCb?.();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.resetStates();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.resetStates();
      }
    });

    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.onThrowGrenadeCb?.();
    });

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (Math.abs(e.deltaY) > 4) {
          this.onSwitchWeaponCb?.();
        }
      },
      { passive: false }
    );

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouseScreenX = e.clientX - rect.left;
      this.mouseScreenY = e.clientY - rect.top;
      this.usingTouch = false;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        const rect = this.canvas.getBoundingClientRect();
        this.mouseScreenX = e.clientX - rect.left;
        this.mouseScreenY = e.clientY - rect.top;
        this.mouseDown = true;
        this.usingTouch = false;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.mouseDown = false;
      }
    });

    this.canvas.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        this.usingTouch = true;
        if (!this.touchAutoFireInitialized) {
          this.autoFireEnabled = true;
          this.touchAutoFireInitialized = true;
        }
        const rect = this.canvas.getBoundingClientRect();
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          const x = t.clientX - rect.left;
          const y = t.clientY - rect.top;
          if (x < rect.width * 0.5) {
            if (!this.moveStick.active) {
              this.moveStick = { active: true, id: t.identifier, startX: x, startY: y, curX: x, curY: y, dx: 0, dy: 0 };
            }
          } else if (!this.aimStick.active) {
            this.aimStick = { active: true, id: t.identifier, startX: x, startY: y, curX: x, curY: y, dx: 0, dy: 0 };
          }
        }
      },
      { passive: false }
    );

    this.canvas.addEventListener(
      'touchmove',
      (e) => {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const maxR = Math.min(rect.width, rect.height) < 420 ? 44 : 52;
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          const x = t.clientX - rect.left;
          const y = t.clientY - rect.top;
          if (this.moveStick.active && t.identifier === this.moveStick.id) {
            let vx = x - this.moveStick.startX;
            let vy = y - this.moveStick.startY;
            let dist = Math.hypot(vx, vy) || 1;
            // 动态跟随圆心：大拇指大幅滑动后折返零延迟
            if (dist > maxR + 18) {
              const pull = dist - (maxR + 18);
              this.moveStick.startX += (vx / dist) * pull;
              this.moveStick.startY += (vy / dist) * pull;
              vx = x - this.moveStick.startX;
              vy = y - this.moveStick.startY;
              dist = Math.hypot(vx, vy) || 1;
            }
            const clamped = Math.min(dist, maxR);
            this.moveStick.curX = this.moveStick.startX + (vx / dist) * clamped;
            this.moveStick.curY = this.moveStick.startY + (vy / dist) * clamped;
            this.moveStick.dx = dist > 5 ? (vx / dist) * (clamped / maxR) : 0;
            this.moveStick.dy = dist > 5 ? (vy / dist) * (clamped / maxR) : 0;
          } else if (this.aimStick.active && t.identifier === this.aimStick.id) {
            const vx = x - this.aimStick.startX;
            const vy = y - this.aimStick.startY;
            const dist = Math.hypot(vx, vy) || 1;
            const clamped = Math.min(dist, maxR);
            this.aimStick.curX = this.aimStick.startX + (vx / dist) * clamped;
            this.aimStick.curY = this.aimStick.startY + (vy / dist) * clamped;
            this.aimStick.dx = dist > 7 ? vx / dist : 0;
            this.aimStick.dy = dist > 7 ? vy / dist : 0;
          }
        }
      },
      { passive: false }
    );

    const endTouch = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (this.moveStick.active && t.identifier === this.moveStick.id) {
          this.moveStick.active = false;
          this.moveStick.dx = 0;
          this.moveStick.dy = 0;
        }
        if (this.aimStick.active && t.identifier === this.aimStick.id) {
          this.aimStick.active = false;
          this.aimStick.dx = 0;
          this.aimStick.dy = 0;
        }
      }
    };

    this.canvas.addEventListener('touchend', endTouch);
    this.canvas.addEventListener('touchcancel', endTouch);
  }

  public bindActions(
    onSwitchWeapon: (slotIndex?: number) => void,
    onReload: () => void,
    onToggleArmory: () => void,
    onThrowGrenade: () => void,
    onEscape?: () => void,
    onQuickBuyAmmo?: () => void
  ): void {
    this.onSwitchWeaponCb = onSwitchWeapon;
    this.onReloadCb = onReload;
    this.onToggleArmoryCb = onToggleArmory;
    this.onThrowGrenadeCb = onThrowGrenade;
    this.onEscapeCb = onEscape || null;
    this.onQuickBuyAmmoCb = onQuickBuyAmmo || null;
  }

  public getMoveVector(): { x: number; y: number } {
    if (this.moveStick.active && (this.moveStick.dx !== 0 || this.moveStick.dy !== 0)) {
      return { x: this.moveStick.dx, y: this.moveStick.dy };
    }
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (x !== 0 && y !== 0) {
      const inv = 1 / Math.SQRT2;
      x *= inv;
      y *= inv;
    }
    return { x, y };
  }

  public resetStates(): void {
    this.keys.clear();
    this.mouseDown = false;
    this.moveStick.active = false;
    this.moveStick.dx = 0;
    this.moveStick.dy = 0;
    this.aimStick.active = false;
    this.aimStick.dx = 0;
    this.aimStick.dy = 0;
    this.attackBtnStick.active = false;
    this.attackBtnStick.dx = 0;
    this.attackBtnStick.dy = 0;
  }
}
