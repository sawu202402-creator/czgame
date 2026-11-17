import { AdPlacement } from '../types';
import { SoundFX } from '../audio/SoundFX';
import { I18n } from '../i18n/I18n';

declare const __BUILD_PLATFORM__: 'crazygames' | 'poki' | 'web';

declare global {
  interface Window {
    CrazyGames?: {
      SDK?: {
        init: () => Promise<void>;
        environment?: string;
        game?: {
          loadingStart?: () => void;
          loadingStop?: () => void;
          gameplayStart: () => void;
          gameplayStop: () => void;
          happytime: () => void;
          inviteLink?: (params: Record<string, string>) => string;
          showInviteButton?: (params: Record<string, string>) => string;
          hideInviteButton?: () => void;
          getInviteParam?: (key: string) => string | null;
          isInstantMultiplayer?: boolean;
          settings?: { muteAudio?: boolean };
          addSettingsChangeListener?: (cb: (settings: { muteAudio?: boolean }) => void) => void;
        };
        ad?: {
          requestAd: (
            type: 'rewarded' | 'midgame',
            callbacks: {
              adStarted?: () => void;
              adFinished?: () => void;
              adError?: (err: unknown) => void;
            }
          ) => void;
        };
        data?: {
          getItem: (key: string) => string | null;
          setItem: (key: string, val: string) => void;
        };
      };
    };
    PokiSDK?: {
      init: () => Promise<void>;
      gameLoadingFinished: () => void;
      gameplayStart: () => void;
      gameplayStop: () => void;
      commercialBreak: (onStart?: () => void) => Promise<void>;
      rewardedBreak: (onStart?: () => void) => Promise<boolean>;
      shareableURL?: (params: Record<string, string>) => Promise<string>;
      getURLParam?: (key: string) => string;
      setDebug?: (debug: boolean) => void;
    };
  }
}

class PlatformAdapter {
  private initialized = false;
  private sdkActive = false;
  private isGameplayActive = false;
  private hasPlayedAnyRun = false;
  private lastAdFinishedAt = 0;
  private pauseHook: ((paused: boolean) => void) | null = null;

  public async init(onPauseChange: (paused: boolean) => void): Promise<void> {
    this.pauseHook = onPauseChange;
    if (this.initialized) return;
    this.initialized = true;

    if (__BUILD_PLATFORM__ !== 'crazygames') {
      if (__BUILD_PLATFORM__ === 'poki' && !window.PokiSDK) {
        await new Promise<void>((resolve) => {
          let checks = 0;
          const timer = setInterval(() => {
            checks++;
            if (window.PokiSDK || checks >= 12) {
              clearInterval(timer);
              resolve();
            }
          }, 50);
        });
      }
      if (window.PokiSDK) {
        this.sdkActive = true;
        try {
          await window.PokiSDK.init();
        } catch {
          // AdBlock 开启时 PokiSDK.init() 会 reject，官方规范要求静默放行继续进入游戏
        }
        return;
      }
    }

    if (__BUILD_PLATFORM__ !== 'poki') {
      try {
        if (__BUILD_PLATFORM__ === 'crazygames' && !window.CrazyGames?.SDK) {
          await new Promise<void>((resolve) => {
            let checks = 0;
            const timer = setInterval(() => {
              checks++;
              if (window.CrazyGames?.SDK || checks >= 12) {
                clearInterval(timer);
                resolve();
              }
            }, 50);
          });
        }
        if (window.CrazyGames?.SDK) {
          await window.CrazyGames.SDK.init();
          const env = window.CrazyGames.SDK.environment;
          this.sdkActive = env === 'crazygames' || env === 'local';
          if (window.CrazyGames.SDK.game?.settings?.muteAudio !== undefined) {
            SoundFX.setPlatformMuted(Boolean(window.CrazyGames.SDK.game.settings.muteAudio));
          }
          window.CrazyGames.SDK.game?.addSettingsChangeListener?.((newSettings) => {
            if (newSettings && typeof newSettings.muteAudio === 'boolean') {
              SoundFX.setPlatformMuted(newSettings.muteAudio);
            }
          });
        }
      } catch {
        this.sdkActive = false;
      }
    }
  }

  public loadingStart(): void {
    if (__BUILD_PLATFORM__ !== 'poki') {
      try {
        window.CrazyGames?.SDK?.game?.loadingStart?.();
      } catch {
        // ignore
      }
    }
  }

  public loadingStop(): void {
    if (__BUILD_PLATFORM__ !== 'crazygames') {
      try {
        window.PokiSDK?.gameLoadingFinished?.();
      } catch {
        // ignore
      }
    }
    if (__BUILD_PLATFORM__ !== 'poki') {
      try {
        window.CrazyGames?.SDK?.game?.loadingStop?.();
      } catch {
        // ignore
      }
    }
  }

  public gameplayStart(): void {
    if (this.isGameplayActive) return;
    this.isGameplayActive = true;
    this.hasPlayedAnyRun = true;

    if (__BUILD_PLATFORM__ !== 'crazygames') {
      try {
        window.PokiSDK?.gameplayStart?.();
      } catch {
        // ignore
      }
    }
    if (__BUILD_PLATFORM__ !== 'poki') {
      try {
        window.CrazyGames?.SDK?.game?.gameplayStart?.();
      } catch {
        // ignore
      }
    }
  }

  public gameplayStop(): void {
    if (!this.isGameplayActive) return;
    this.isGameplayActive = false;

    if (__BUILD_PLATFORM__ !== 'crazygames') {
      try {
        window.PokiSDK?.gameplayStop?.();
      } catch {
        // ignore
      }
    }
    if (__BUILD_PLATFORM__ !== 'poki') {
      try {
        window.CrazyGames?.SDK?.game?.gameplayStop?.();
      } catch {
        // ignore
      }
    }
  }

  public happyTime(): void {
    if (__BUILD_PLATFORM__ !== 'poki') {
      try {
        window.CrazyGames?.SDK?.game?.happytime?.();
      } catch {
        // ignore
      }
    }
  }

  /**
   * 平台中场商业广告（Poki commercialBreak / CrazyGames midgame）
   * 严格遵循双平台体验铁律：
   * 1) 玩家首次进局绝不弹广告（First gameplay free of ads）
   * 2) 两次广告之间至少间隔 60 秒（刚看完激励广告绝不连弹插屏）
   */
  public async showCommercialBreak(): Promise<void> {
    if (!this.hasPlayedAnyRun) return;
    if (this.lastAdFinishedAt > 0 && performance.now() - this.lastAdFinishedAt < 60_000) {
      return;
    }

    this.gameplayStop();

    if (__BUILD_PLATFORM__ !== 'crazygames' && this.sdkActive && window.PokiSDK?.commercialBreak) {
      SoundFX.setAdMuted(true);
      this.pauseHook?.(true);
      try {
        await window.PokiSDK.commercialBreak(() => {
          SoundFX.setAdMuted(true);
        });
      } catch {
        // ignore adblocker / network error
      }
      this.lastAdFinishedAt = performance.now();
      SoundFX.setAdMuted(false);
      this.pauseHook?.(false);
      return;
    }

    if (
      __BUILD_PLATFORM__ !== 'poki' &&
      this.sdkActive &&
      window.CrazyGames?.SDK?.ad &&
      window.CrazyGames.SDK.environment === 'crazygames'
    ) {
      SoundFX.setAdMuted(true);
      this.pauseHook?.(true);
      await new Promise<void>((resolve) => {
        window.CrazyGames!.SDK!.ad!.requestAd('midgame', {
          adStarted: () => {
            SoundFX.setAdMuted(true);
          },
          adFinished: () => {
            resolve();
          },
          adError: () => {
            resolve();
          },
        });
      });
      this.lastAdFinishedAt = performance.now();
      SoundFX.setAdMuted(false);
      this.pauseHook?.(false);
    }
  }

  public async buildInviteLink(roomCode: string): Promise<string> {
    if (__BUILD_PLATFORM__ !== 'crazygames') {
      try {
        if (this.sdkActive && window.PokiSDK?.shareableURL) {
          const pokiLink = await window.PokiSDK.shareableURL({ room: roomCode });
          if (pokiLink) return pokiLink;
        }
      } catch {
        // fallback to URL param
      }
    }

    if (__BUILD_PLATFORM__ !== 'poki') {
      try {
        if (this.sdkActive && window.CrazyGames?.SDK?.game?.inviteLink) {
          const cgLink = window.CrazyGames.SDK.game.inviteLink({ roomId: roomCode });
          if (cgLink) return cgLink;
        }
      } catch {
        // fallback to URL param
      }
    }

    const url = new URL(window.location.href);
    url.searchParams.set('room', roomCode);
    return url.toString();
  }

  public showInviteButton(roomCode: string): void {
    if (__BUILD_PLATFORM__ !== 'poki') {
      try {
        if (this.sdkActive && window.CrazyGames?.SDK?.game?.showInviteButton) {
          window.CrazyGames.SDK.game.showInviteButton({ roomId: roomCode });
        }
      } catch {
        // ignore
      }
    }
  }

  public hideInviteButton(): void {
    if (__BUILD_PLATFORM__ !== 'poki') {
      try {
        window.CrazyGames?.SDK?.game?.hideInviteButton?.();
      } catch {
        // ignore
      }
    }
  }

  public isInstantMultiplayerRequested(): boolean {
    if (__BUILD_PLATFORM__ !== 'poki') {
      try {
        return Boolean(window.CrazyGames?.SDK?.game?.isInstantMultiplayer);
      } catch {
        return false;
      }
    }
    return false;
  }

  private showAdUnavailableNotice(): void {
    try {
      const existing = document.getElementById('sdk-ad-notice-toast');
      existing?.remove();
      const toast = document.createElement('div');
      toast.id = 'sdk-ad-notice-toast';
      toast.textContent = I18n.t('adUnavailableNotice');
      Object.assign(toast.style, {
        position: 'fixed',
        top: '18px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: '260',
        background: 'rgba(15, 23, 42, 0.96)',
        color: '#fde047',
        border: '2px solid #f59e0b',
        borderRadius: '999px',
        padding: '8px 18px',
        fontSize: '13px',
        fontWeight: '800',
        boxShadow: '0 6px 20px rgba(0, 0, 0, 0.55)',
        pointerEvents: 'none',
        textAlign: 'center',
        maxWidth: '90vw',
      });
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2600);
    } catch {
      // ignore
    }
  }

  public consumeInviteRoomCode(): string | null {
    if (__BUILD_PLATFORM__ !== 'crazygames') {
      try {
        const pokiRoom = window.PokiSDK?.getURLParam?.('room');
        if (pokiRoom && pokiRoom.trim().length >= 4) {
          return pokiRoom.trim().toUpperCase();
        }
      } catch {
        // ignore
      }
    }

    if (__BUILD_PLATFORM__ !== 'poki') {
      try {
        const cgRoom = window.CrazyGames?.SDK?.game?.getInviteParam?.('roomId');
        if (cgRoom && cgRoom.trim().length >= 4) {
          return cgRoom.trim().toUpperCase();
        }
      } catch {
        // ignore
      }
    }

    try {
      const url = new URL(window.location.href);
      const code = url.searchParams.get('room') || url.searchParams.get('roomId');
      if (code && code.trim().length >= 4) {
        url.searchParams.delete('room');
        url.searchParams.delete('roomId');
        window.history.replaceState({}, '', url.toString());
        return code.trim().toUpperCase();
      }
    } catch {
      // ignore
    }
    return null;
  }

  public async showRewardedAd(placement: AdPlacement, rewardTitle: string): Promise<boolean> {
    this.gameplayStop();
    SoundFX.setAdMuted(true);
    this.pauseHook?.(true);

    const finish = (success: boolean) => {
      if (success) {
        this.lastAdFinishedAt = performance.now();
      }
      SoundFX.setAdMuted(false);
      this.pauseHook?.(false);
      if (success) {
        SoundFX.fanfare();
      }
      return success;
    };

    if (__BUILD_PLATFORM__ !== 'crazygames' && this.sdkActive && window.PokiSDK?.rewardedBreak) {
      try {
        const withReward = await window.PokiSDK.rewardedBreak(() => {
          SoundFX.setAdMuted(true);
        });
        return finish(Boolean(withReward));
      } catch {
        return finish(false);
      }
    }

    if (__BUILD_PLATFORM__ !== 'poki' && this.sdkActive && window.CrazyGames?.SDK?.ad) {
      return new Promise<boolean>((resolve) => {
        window.CrazyGames!.SDK!.ad!.requestAd('rewarded', {
          adStarted: () => {
            SoundFX.setAdMuted(true);
          },
          adFinished: () => {
            resolve(finish(true));
          },
          adError: () => {
            if (window.CrazyGames?.SDK?.environment === 'local') {
              this.runMockAdModal(placement, rewardTitle).then((ok) => resolve(finish(ok)));
            } else {
              this.showAdUnavailableNotice();
              resolve(finish(false));
            }
          },
        });
      });
    }

    const ok = await this.runMockAdModal(placement, rewardTitle);
    return finish(ok);
  }

  private runMockAdModal(placement: AdPlacement, rewardTitle: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'mock-ad-overlay';
      overlay.innerHTML = `
        <div class="mock-ad-card">
          <div class="mock-ad-badge">${I18n.t('mockAdBadge')} (${placement})</div>
          <h3>${I18n.t('mockAdTitle')}</h3>
          <p class="mock-ad-reward">${I18n.t('mockAdReward', { title: rewardTitle })}</p>
          <div class="mock-ad-bar-wrap">
            <div class="mock-ad-bar-fill" id="mock-ad-bar"></div>
          </div>
          <p class="mock-ad-sub" id="mock-ad-timer">${I18n.t('mockAdTimer', { s: '2.0' })}</p>
          <div class="mock-ad-actions">
            <button class="btn-cartoon btn-gray" id="mock-ad-cancel">${I18n.t('mockAdCancel')}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const bar = overlay.querySelector('#mock-ad-bar') as HTMLElement;
      const timerText = overlay.querySelector('#mock-ad-timer') as HTMLElement;
      const cancelBtn = overlay.querySelector('#mock-ad-cancel') as HTMLButtonElement;

      const totalMs = 1800;
      const start = performance.now();
      let cancelled = false;

      const cleanup = () => {
        overlay.remove();
      };

      cancelBtn.onclick = () => {
        cancelled = true;
        cleanup();
        resolve(false);
      };

      const tick = (now: number) => {
        if (cancelled) return;
        const elapsed = now - start;
        const pct = Math.min(1, elapsed / totalMs);
        bar.style.width = `${pct * 100}%`;
        const remain = Math.max(0, (totalMs - elapsed) / 1000).toFixed(1);
        timerText.textContent = I18n.t('mockAdTimer', { s: remain });
        if (pct >= 1) {
          cleanup();
          resolve(true);
        } else {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    });
  }

  public getStorageItem(key: string): string | null {
    if (__BUILD_PLATFORM__ !== 'poki') {
      try {
        if (window.CrazyGames?.SDK?.data) {
          const val = window.CrazyGames.SDK.data.getItem(key);
          if (val !== null && val !== undefined) return val;
        }
      } catch {
        // fallback
      }
    }
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  public setStorageItem(key: string, value: string): void {
    if (__BUILD_PLATFORM__ !== 'poki') {
      try {
        window.CrazyGames?.SDK?.data?.setItem(key, value);
      } catch {
        // ignore
      }
    }
    try {
      localStorage.setItem(key, value);
    } catch {
      // ignore
    }
  }
}

export const PlatformSDK = new PlatformAdapter();
