class SoundFXManager {
  private ctx: AudioContext | null = null;
  private noiseBufferShort: AudioBuffer | null = null;
  private noiseBufferLong: AudioBuffer | null = null;
  private muted = false;
  private userMuted = false;
  private lastShootAt = 0;
  private lastPickupAt = 0;
  private lastExplosionAt = 0;
  private lastRepairAt = 0;

  private ensureCtx(): AudioContext | null {
    if (this.muted || this.userMuted) return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.buildNoiseBuffers(this.ctx);
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private buildNoiseBuffers(ctx: AudioContext): void {
    const shortLen = Math.floor(ctx.sampleRate * 0.14);
    this.noiseBufferShort = ctx.createBuffer(1, shortLen, ctx.sampleRate);
    const sData = this.noiseBufferShort.getChannelData(0);
    for (let i = 0; i < shortLen; i++) {
      sData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / shortLen, 1.8);
    }

    const longLen = Math.floor(ctx.sampleRate * 0.42);
    this.noiseBufferLong = ctx.createBuffer(1, longLen, ctx.sampleRate);
    const lData = this.noiseBufferLong.getChannelData(0);
    for (let i = 0; i < longLen; i++) {
      lData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / longLen, 1.4);
    }
  }

  public setAdMuted(adMuted: boolean): void {
    this.muted = adMuted;
  }

  public toggleUserMute(): boolean {
    this.userMuted = !this.userMuted;
    return this.userMuted;
  }

  public isUserMuted(): boolean {
    return this.userMuted;
  }

  public shoot(type: 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'minigun' | 'plasma', evolved = false): void {
    const perfNow = performance.now();
    if (perfNow - this.lastShootAt < 34) return;
    this.lastShootAt = perfNow;

    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;

    if (type === 'plasma') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(evolved ? 980 : 760, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.13);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.14);
      return;
    }

    const dur = type === 'shotgun' ? 0.14 : type === 'rifle' ? 0.09 : 0.065;
    if (this.noiseBufferShort) {
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBufferShort;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = type === 'shotgun' ? 650 : type === 'smg' ? 1400 : 1050;

      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(type === 'shotgun' ? 0.21 : 0.11, now);
      nGain.gain.exponentialRampToValueAtTime(0.005, now + dur);

      noise.connect(filter).connect(nGain).connect(ctx.destination);
      noise.start(now);
      noise.stop(now + dur);
    }

    const osc = ctx.createOscillator();
    const oGain = ctx.createGain();
    osc.type = evolved ? 'triangle' : 'sine';
    const startFreq = type === 'shotgun' ? 190 : type === 'minigun' ? 240 : 280;
    osc.frequency.setValueAtTime(evolved ? startFreq * 1.25 : startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + dur);
    oGain.gain.setValueAtTime(0.14, now);
    oGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(oGain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur);
  }

  public coin(): void {
    const perfNow = performance.now();
    if (perfNow - this.lastPickupAt < 35) return;
    this.lastPickupAt = perfNow;

    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(987.77, now);
    osc.frequency.setValueAtTime(1318.5, now + 0.045);
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  }

  public xp(): void {
    const perfNow = performance.now();
    if (perfNow - this.lastPickupAt < 35) return;
    this.lastPickupAt = perfNow;

    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(620 + Math.random() * 180, now);
    osc.frequency.exponentialRampToValueAtTime(960, now + 0.06);
    gain.gain.setValueAtTime(0.065, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  public repair(): void {
    const perfNow = performance.now();
    if (perfNow - this.lastRepairAt < 55) return;
    this.lastRepairAt = perfNow;

    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.08);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  }

  public reloadDone(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    [520, 780].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.05);
      gain.gain.setValueAtTime(0.1, now + idx * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.05 + 0.07);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + idx * 0.05);
      osc.stop(now + idx * 0.05 + 0.07);
    });
  }

  public explosion(): void {
    const perfNow = performance.now();
    if (perfNow - this.lastExplosionAt < 55) return;
    this.lastExplosionAt = perfNow;

    const ctx = this.ensureCtx();
    if (!ctx || !this.noiseBufferLong) return;
    const now = ctx.currentTime;
    const dur = 0.42;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBufferLong;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(460, now);
    filter.frequency.exponentialRampToValueAtTime(70, now + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + dur);
  }

  public fanfare(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, now + i * 0.07);
      gain.gain.setValueAtTime(0.13, now + i * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.07);
      osc.stop(now + i * 0.07 + 0.22);
    });
  }

  public alarm(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(380, now + i * 0.28);
      osc.frequency.linearRampToValueAtTime(620, now + i * 0.28 + 0.22);
      gain.gain.setValueAtTime(0.11, now + i * 0.28);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.28 + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.28);
      osc.stop(now + i * 0.28 + 0.25);
    }
  }
}

export const SoundFX = new SoundFXManager();
