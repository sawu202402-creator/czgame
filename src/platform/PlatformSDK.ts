import { AdPlacement } from '../types';
import { SoundFX } from '../audio/SoundFX';

declare global {
  interface Window {
    CrazyGames?: {
      SDK?: {
        init: () => Promise<void>;
        environment?: string;
        game?: {
          gameplayStart: () => void;
          gameplayStop: () => void;
          happytime: () => void;
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
      if (window.CrazyGames?.SDK) {
        await window.CrazyGames.SDK.init();
        const env = window.CrazyGames.SDK.environment;
        this.isCrazyGames = env === 'crazygames' || env === 'local';
      }
    } catch {
      this.isCrazyGames = false;
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

  /**
   * 统一纯激励视频接口（不接入任何开屏或强弹插屏）
   * 播放期间严格暂停游戏主循环并静音音频，完全符合 CrazyGames 审核规范；
   * 本地开发或未挂载 SDK 时自动走 2 秒可视化模拟激励广告弹窗，方便直接测试全流程。
   */
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
            // 若在本地环境报错则回退模拟框，正式环境返回失败提示
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
          <div class="mock-ad-badge">开发调试 · 模拟激励视频 (${placement})</div>
          <h3>📡 正在呼叫总部空投支援...</h3>
          <p class="mock-ad-reward">即将解锁：<strong>${rewardTitle}</strong></p>
          <div class="mock-ad-bar-wrap">
            <div class="mock-ad-bar-fill" id="mock-ad-bar"></div>
          </div>
          <p class="mock-ad-sub" id="mock-ad-timer">游戏已自动静音并暂停 · 剩余 2.0 秒</p>
          <div class="mock-ad-actions">
            <button class="btn-cartoon btn-gray" id="mock-ad-cancel">放弃奖励</button>
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
        timerText.textContent = `游戏已自动静音并暂停 · 剩余 ${remain} 秒`;
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
