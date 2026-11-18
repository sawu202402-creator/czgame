import { AdPlacement } from '../types';
import { SoundFX } from '../audio/SoundFX';
import { I18n } from '../i18n/I18n';

declare const __BUILD_PLATFORM__: 'crazygames' | 'poki' | 'gamedistribution' | 'itch' | 'web';

interface GdSdkEvent {
  name?: string;
}

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
          updateRoom?: (params: {
            roomId?: string;
            isJoinable: boolean;
            inviteParams?: Record<string, string>;
          }) => void;
          leftRoom?: () => void;
          inviteParams?: Record<string, string>;
          addJoinRoomListener?: (cb: (params: Record<string, string>) => void) => void;
          getInviteParam?: (key: string) => string | null;
          isInstantMultiplayer?: boolean;
          settings?: { muteAudio?: boolean; disableChat?: boolean };
          addSettingsChangeListener?: (
            cb: (settings: { muteAudio?: boolean; disableChat?: boolean }) => void
          ) => void;
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
        system?: {
          info?: {
            countryCode?: string;
            device?: {
              type?: 'desktop' | 'tablet' | 'mobile';
            };
            os?: {
              name?: string;
            };
          };
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
    gdsdk?: {
      showAd?: (adType?: string) => Promise<void>;
      preloadAd?: (adType: string) => Promise<void>;
      Rewarded?: string;
    };
    __gdEventQueue?: GdSdkEvent[];
    __onGdSdkEvent?: (ev: GdSdkEvent) => void;
  }
}

class PlatformAdapter {
  private initialized = false;
  private sdkActive = false;
  private isGameplayActive = false;
  private hasPlayedAnyRun = false;
  private lastAdFinishedAt = 0;
  private pauseHook: ((paused: boolean) => void) | null = null;
  private gdRewardEarned = false;
  private gdAdResumeResolver: (() => void) | null = null;

  public async init(onPauseChange: (paused: boolean) => void): Promise<void> {
    this.pauseHook = onPauseChange;
    if (this.initialized) return;
    this.initialized = true;

    if (__BUILD_PLATFORM__ === 'gamedistribution') {
      const handleGdEvent = (ev: GdSdkEvent) => {
        const name = ev?.name || '';
        if (name === 'SDK_READY') {
          this.sdkActive = true;
          try {
            window.gdsdk?.preloadAd?.('rewarded')?.catch?.(() => {});
          } catch {
            // ignore
          }
        } else if (name === 'SDK_GAME_PAUSE') {
          SoundFX.setAdMuted(true);
          this.pauseHook?.(true);
        } else if (name === 'SDK_GAME_START') {
          SoundFX.setAdMuted(false);
          this.pauseHook?.(false);
          if (this.gdAdResumeResolver) {
            const done = this.gdAdResumeResolver;
            this.gdAdResumeResolver = null;
            done();
          }
        } else if (name === 'SDK_REWARDED_WATCH_COMPLETE') {
          this.gdRewardEarned = true;
        }
      };

      window.__onGdSdkEvent = handleGdEvent;
      if (Array.isArray(window.__gdEventQueue)) {
        while (window.__gdEventQueue.length > 0) {
          const queued = window.__gdEventQueue.shift();
          if (queued) handleGdEvent(queued);
        }
      }
      if (!this.sdkActive) {
        await new Promise<void>((resolve) => {
          let checks = 0;
          const timer = setInterval(() => {
            checks++;
            if (this.sdkActive || window.gdsdk || checks >= 10) {
              if (window.gdsdk) this.sdkActive = true;
              clearInterval(timer);
              resolve();
            }
          }, 50);
        });
      }
      return;
    }

    if (__BUILD_PLATFORM__ === 'poki' || __BUILD_PLATFORM__ === 'web') {
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

    if (__BUILD_PLATFORM__ === 'crazygames' || __BUILD_PLATFORM__ === 'web') {
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
          this.sdkActive = env !== 'disabled';
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
    if (__BUILD_PLATFORM__ === 'crazygames' || __BUILD_PLATFORM__ === 'web') {
      try {
        window.CrazyGames?.SDK?.game?.loadingStart?.();
      } catch {
        // ignore
      }
    }
  }

  public loadingStop(): void {
    if (__BUILD_PLATFORM__ === 'poki' || __BUILD_PLATFORM__ === 'web') {
      try {
        window.PokiSDK?.gameLoadingFinished?.();
      } catch {
        // ignore
      }
    }
    if (__BUILD_PLATFORM__ === 'crazygames' || __BUILD_PLATFORM__ === 'web') {
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

    if (__BUILD_PLATFORM__ === 'poki' || __BUILD_PLATFORM__ === 'web') {
      try {
        window.PokiSDK?.gameplayStart?.();
      } catch {
        // ignore
      }
    }
    if (__BUILD_PLATFORM__ === 'crazygames' || __BUILD_PLATFORM__ === 'web') {
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

    if (__BUILD_PLATFORM__ === 'poki' || __BUILD_PLATFORM__ === 'web') {
      try {
        window.PokiSDK?.gameplayStop?.();
      } catch {
        // ignore
      }
    }
    if (__BUILD_PLATFORM__ === 'crazygames' || __BUILD_PLATFORM__ === 'web') {
      try {
        window.CrazyGames?.SDK?.game?.gameplayStop?.();
      } catch {
        // ignore
      }
    }
  }

  public happyTime(): void {
    if (__BUILD_PLATFORM__ === 'crazygames' || __BUILD_PLATFORM__ === 'web') {
      try {
        window.CrazyGames?.SDK?.game?.happytime?.();
      } catch {
        // ignore
      }
    }
  }

  /**
   * 平台中场商业广告（Poki commercialBreak / CrazyGames midgame / GameDistribution showAd）
   * 严格遵循全平台体验铁律：
   * 1) 玩家首次进局绝不弹广告（First gameplay free of ads）
   * 2) 两次广告之间至少间隔 60 秒（刚看完激励广告绝不连弹插屏）
   */
  public async showCommercialBreak(): Promise<void> {
    if (!this.hasPlayedAnyRun) return;
    if (this.lastAdFinishedAt > 0 && performance.now() - this.lastAdFinishedAt < 60_000) {
      return;
    }

    this.gameplayStop();

    if (__BUILD_PLATFORM__ === 'gamedistribution' && this.sdkActive && window.gdsdk?.showAd) {
      SoundFX.setAdMuted(true);
      this.pauseHook?.(true);
      try {
        await Promise.race([
          new Promise<void>((resolve) => {
            this.gdAdResumeResolver = resolve;
            Promise.resolve(window.gdsdk!.showAd!()).catch(() => resolve());
          }),
          new Promise<void>((resolve) => setTimeout(resolve, 12_000)),
        ]);
      } catch {
        // ignore
      }
      this.gdAdResumeResolver = null;
      this.lastAdFinishedAt = performance.now();
      SoundFX.setAdMuted(false);
      this.pauseHook?.(false);
      return;
    }

    if (
      (__BUILD_PLATFORM__ === 'poki' || __BUILD_PLATFORM__ === 'web') &&
      this.sdkActive &&
      window.PokiSDK?.commercialBreak
    ) {
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
      (__BUILD_PLATFORM__ === 'crazygames' || __BUILD_PLATFORM__ === 'web') &&
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
    if (__BUILD_PLATFORM__ === 'poki' || __BUILD_PLATFORM__ === 'web') {
      try {
        if (this.sdkActive && window.PokiSDK?.shareableURL) {
          const pokiLink = await window.PokiSDK.shareableURL({ room: roomCode });
          if (pokiLink) return pokiLink;
        }
      } catch {
        // fallback to URL param
      }
    }

    if (__BUILD_PLATFORM__ === 'crazygames' || __BUILD_PLATFORM__ === 'web') {
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

  public showInviteButton(roomCode: string, isJoinable = true): void {
    if (__BUILD_PLATFORM__ === 'crazygames' || __BUILD_PLATFORM__ === 'web') {
      try {
        if (this.sdkActive && window.CrazyGames?.SDK?.game?.updateRoom) {
          window.CrazyGames.SDK.game.updateRoom({
            roomId: roomCode,
            isJoinable,
            inviteParams: { roomId: roomCode },
          });
        }
      } catch {
        // ignore
      }
    }
  }

  public hideInviteButton(keepRoomCode?: string): void {
    if (__BUILD_PLATFORM__ === 'crazygames' || __BUILD_PLATFORM__ === 'web') {
      try {
        if (!this.sdkActive) return;
        if (keepRoomCode && window.CrazyGames?.SDK?.game?.updateRoom) {
          window.CrazyGames.SDK.game.updateRoom({
            roomId: keepRoomCode,
            isJoinable: false,
            inviteParams: { roomId: keepRoomCode },
          });
        } else {
          window.CrazyGames?.SDK?.game?.leftRoom?.();
        }
      } catch {
        // ignore
      }
    }
  }

  public registerJoinRoomListener(onJoinRoom: (roomCode: string) => void): void {
    if (__BUILD_PLATFORM__ === 'crazygames' || __BUILD_PLATFORM__ === 'web') {
      try {
        window.CrazyGames?.SDK?.game?.addJoinRoomListener?.((params) => {
          const code = params?.roomId || params?.room;
          if (code && code.trim().length >= 4) {
            onJoinRoom(code.trim().toUpperCase());
          }
        });
      } catch {
        // ignore
      }
    }
  }

  public isInstantMultiplayerRequested(): boolean {
    if (__BUILD_PLATFORM__ === 'crazygames' || __BUILD_PLATFORM__ === 'web') {
      try {
        return Boolean(window.CrazyGames?.SDK?.game?.isInstantMultiplayer);
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * CrazyGames 官方质量规范明确禁止游戏内自带全屏按钮（由平台外层统一提供全屏控制）
   */
  public isFullscreenAllowed(): boolean {
    if (__BUILD_PLATFORM__ === 'crazygames') {
      return false;
    }
    if (typeof document === 'undefined') return false;
    const doc = document as Document & { webkitFullscreenEnabled?: boolean };
    return Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
  }

  /**
   * 遵循 CrazyGames 官方设备识别规范：
   * 优先读取 CrazyGames.SDK.system.info.device.type，避免触控屏 Windows 笔记本被 maxTouchPoints 误判为手机！
   */
  public getDeviceType(): 'desktop' | 'tablet' | 'mobile' {
    if (__BUILD_PLATFORM__ === 'crazygames' || __BUILD_PLATFORM__ === 'web') {
      try {
        const cgType = window.CrazyGames?.SDK?.system?.info?.device?.type;
        if (cgType === 'desktop' || cgType === 'tablet' || cgType === 'mobile') {
          return cgType;
        }
      } catch {
        // fallback below
      }
    }

    if (typeof navigator !== 'undefined') {
      const ua = navigator.userAgent || '';
      if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet';
      if (/Android|iPhone|iPod|Mobile|Windows Phone/i.test(ua)) return 'mobile';
    }

    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const hasCoarse = window.matchMedia('(pointer: coarse)').matches;
      const hasFine = window.matchMedia('(pointer: fine)').matches;
      if (hasCoarse && !hasFine) {
        return 'mobile';
      }
    }

    return 'desktop';
  }

  public isMobileOrTablet(): boolean {
    return this.getDeviceType() !== 'desktop';
  }

  public hasPendingInviteUrl(): boolean {
    if (__BUILD_PLATFORM__ === 'poki' || __BUILD_PLATFORM__ === 'web') {
      try {
        const pokiRoom = window.PokiSDK?.getURLParam?.('room');
        if (pokiRoom && pokiRoom.trim().length >= 4) return true;
      } catch {
        // ignore
      }
    }
    if (__BUILD_PLATFORM__ === 'crazygames' || __BUILD_PLATFORM__ === 'web') {
      try {
        const cgInvite =
          window.CrazyGames?.SDK?.game?.inviteParams?.roomId ||
          window.CrazyGames?.SDK?.game?.inviteParams?.room ||
          window.CrazyGames?.SDK?.game?.getInviteParam?.('roomId');
        if (cgInvite && cgInvite.trim().length >= 4) return true;
      } catch {
        // ignore
      }
    }
    try {
      const url = new URL(window.location.href);
      const code = url.searchParams.get('room') || url.searchParams.get('roomId');
      return Boolean(code && code.trim().length >= 4);
    } catch {
      return false;
    }
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
    if (__BUILD_PLATFORM__ === 'poki' || __BUILD_PLATFORM__ === 'web') {
      try {
        const pokiRoom = window.PokiSDK?.getURLParam?.('room');
        if (pokiRoom && pokiRoom.trim().length >= 4) {
          return pokiRoom.trim().toUpperCase();
        }
      } catch {
        // ignore
      }
    }

    if (__BUILD_PLATFORM__ === 'crazygames' || __BUILD_PLATFORM__ === 'web') {
      try {
        const initInvite =
          window.CrazyGames?.SDK?.game?.inviteParams?.roomId ||
          window.CrazyGames?.SDK?.game?.inviteParams?.room ||
          window.CrazyGames?.SDK?.game?.getInviteParam?.('roomId');
        if (initInvite && initInvite.trim().length >= 4) {
          return initInvite.trim().toUpperCase();
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

    if (__BUILD_PLATFORM__ === 'gamedistribution' && this.sdkActive && window.gdsdk?.showAd) {
      this.gdRewardEarned = false;
      try {
        const adType = window.gdsdk.Rewarded || 'rewarded';
        await Promise.race([
          new Promise<void>((resolve) => {
            this.gdAdResumeResolver = resolve;
            Promise.resolve(window.gdsdk!.showAd!(adType))
              .then(() => {
                setTimeout(resolve, 250);
              })
              .catch(() => resolve());
          }),
          new Promise<void>((resolve) => setTimeout(resolve, 45_000)),
        ]);
      } catch {
        // ignore
      }
      this.gdAdResumeResolver = null;
      try {
        window.gdsdk?.preloadAd?.('rewarded')?.catch?.(() => {});
      } catch {
        // ignore
      }
      if (this.gdRewardEarned) {
        return finish(true);
      }
      const isLocal =
        typeof location !== 'undefined' &&
        (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
      if (isLocal) {
        const ok = await this.runMockAdModal(placement, rewardTitle);
        return finish(ok);
      }
      this.showAdUnavailableNotice();
      return finish(false);
    }

    if (
      (__BUILD_PLATFORM__ === 'poki' || __BUILD_PLATFORM__ === 'web') &&
      this.sdkActive &&
      window.PokiSDK?.rewardedBreak
    ) {
      try {
        const withReward = await window.PokiSDK.rewardedBreak(() => {
          SoundFX.setAdMuted(true);
        });
        return finish(Boolean(withReward));
      } catch {
        return finish(false);
      }
    }

    if (
      (__BUILD_PLATFORM__ === 'crazygames' || __BUILD_PLATFORM__ === 'web') &&
      this.sdkActive &&
      window.CrazyGames?.SDK?.ad
    ) {
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

  private runMockAdModal(_placement: AdPlacement, rewardTitle: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'mock-ad-overlay';
      overlay.innerHTML = `
        <div class="mock-ad-card">
          <div class="mock-ad-badge">${I18n.t('mockAdBadge')}</div>
          <h3>${I18n.t('mockAdTitle')}</h3>
          <p class="mock-ad-reward">${I18n.t('mockAdReward', { title: rewardTitle })}</p>
          <div class="mock-ad-bar-wrap">
            <div class="mock-ad-bar-fill" id="mock-ad-bar"></div>
          </div>
          <p class="mock-ad-sub" id="mock-ad-timer">${I18n.t('mockAdTimer', { s: '1.8' })}</p>
          <div class="mock-ad-actions">
            <button class="btn-cartoon btn-gray" id="mock-ad-cancel">${I18n.t('mockAdCancel')}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const bar = overlay.querySelector('#mock-ad-bar') as HTMLElement;
      const timerText = overlay.querySelector('#mock-ad-timer') as HTMLElement;
      const cancelBtn = overlay.querySelector('#mock-ad-cancel') as HTMLButtonElement;

      const totalMs = 1600;
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
    if (__BUILD_PLATFORM__ === 'crazygames' || __BUILD_PLATFORM__ === 'web') {
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
    if (__BUILD_PLATFORM__ === 'crazygames' || __BUILD_PLATFORM__ === 'web') {
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
