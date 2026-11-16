import { AdPlacement } from '../types';
import { SoundFX } from '../audio/SoundFX';
import { I18n } from '../i18n/I18n';

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
  }
}

class PlatformAdapter {
  private initialized = false;
  private isCrazyGames = false;
  private pauseHook: ((paused: boolean) => void) | null = null;

  public async init(onPauseChange: (paused: boolean) => void): Promise<void> {
    this.pauseHook = onPauseChange;
    if (this.initialized) return;
    this.initialized = true;

    try {
      // 若 SDK 脚本尚在异步加载中，短暂等待最多 600ms 以确保识别 CrazyGames 环境
      if (!window.CrazyGames?.SDK) {
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
        this.isCrazyGames = env === 'crazygames' || env === 'local';
      }
    } catch {
      this.isCrazyGames = false;
    }
  }

  public loadingStart(): void {
    try {
      window.CrazyGames?.SDK?.game?.loadingStart?.();
    } catch {
      // ignore
    }
  }

  public loadingStop(): void {
    try {
      window.CrazyGames?.SDK?.game?.loadingStop?.();
    } catch {
      // ignore
    }
  }

  public gameplayStart(): void {
    try {
      window.CrazyGames?.SDK?.game?.gameplayStart();
    } catch {
      // ignore
    }
  }

  public gameplayStop(): void {
    try {
      window.CrazyGames?.SDK?.game?.gameplayStop();
    } catch {
      // ignore
    }
  }

  public happyTime(): void {
    try {
      window.CrazyGames?.SDK?.game?.happytime();
    } catch {
      // ignore
    }
  }

  public buildInviteLink(roomCode: string): string {
    try {
      if (this.isCrazyGames && window.CrazyGames?.SDK?.game?.inviteLink) {
        const cgLink = window.CrazyGames.SDK.game.inviteLink({ roomId: roomCode });
        if (cgLink) return cgLink;
      }
    } catch {
      // fallback to URL param
    }
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomCode);
    return url.toString();
  }

  public showInviteButton(roomCode: string): void {
    try {
      if (this.isCrazyGames && window.CrazyGames?.SDK?.game?.showInviteButton) {
        window.CrazyGames.SDK.game.showInviteButton({ roomId: roomCode });
      }
    } catch {
      // ignore
    }
  }

  public hideInviteButton(): void {
    try {
      window.CrazyGames?.SDK?.game?.hideInviteButton?.();
    } catch {
      // ignore
    }
  }

  public consumeInviteRoomCode(): string | null {
    try {
      const cgRoom = window.CrazyGames?.SDK?.game?.getInviteParam?.('roomId');
      if (cgRoom && cgRoom.trim().length >= 4) {
        return cgRoom.trim().toUpperCase();
      }
    } catch {
      // ignore
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

  public showRewardedAd(placement: AdPlacement, rewardTitle: string): Promise<boolean> {
    this.gameplayStop();
    SoundFX.setAdMuted(true);
    this.pauseHook?.(true);

    const finish = (success: boolean) => {
      SoundFX.setAdMuted(false);
      this.pauseHook?.(false);
      if (success) {
        SoundFX.fanfare();
      }
      return success;
    };

    if (this.isCrazyGames && window.CrazyGames?.SDK?.ad) {
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
              resolve(finish(false));
            }
          },
        });
      });
    }

    return this.runMockAdModal(placement, rewardTitle).then((ok) => finish(ok));
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
    try {
      if (window.CrazyGames?.SDK?.data) {
        const val = window.CrazyGames.SDK.data.getItem(key);
        if (val !== null && val !== undefined) return val;
      }
    } catch {
      // fallback
    }
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  public setStorageItem(key: string, value: string): void {
    try {
      window.CrazyGames?.SDK?.data?.setItem(key, value);
    } catch {
      // ignore
    }
    try {
      localStorage.setItem(key, value);
    } catch {
      // ignore
    }
  }
}

export const PlatformSDK = new PlatformAdapter();
