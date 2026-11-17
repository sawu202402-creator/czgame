export type BgmMode = 'off' | 'hub' | 'combat' | 'boss';

const SFX_MUTE_KEY = 'czgame_sfx_muted_v1';
const BGM_MUTE_KEY = 'czgame_bgm_muted_v1';

// MIDI note -> Hz
function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

class SoundFXManager {
  private ctx: AudioContext | null = null;
  private noiseBufferShort: AudioBuffer | null = null;
  private noiseBufferLong: AudioBuffer | null = null;
  private bgmBus: GainNode | null = null;

  private muted = false; // Ad mute
  private userMuted = false; // Master/SFX mute
  private musicMuted = false; // Independent BGM mute
  private platformMuted = false;
  private tabHidden = false;

  private bgmMode: BgmMode = 'off';
  private bgmTimer: number | null = null;
  private bgmStep = 0;
  private nextNoteTime = 0;
  private unlockBound = false;

  private lastShootAt = 0;
  private lastPickupAt = 0;
  private lastExplosionAt = 0;
  private lastRepairAt = 0;

  constructor() {
    try {
      this.userMuted = localStorage.getItem(SFX_MUTE_KEY) === '1';
      this.musicMuted = localStorage.getItem(BGM_MUTE_KEY) === '1';
    } catch {
      // ignore storage errors
    }
    this.installUnlockListeners();
  }

  private installUnlockListeners(): void {
    if (this.unlockBound || typeof window === 'undefined') return;
    this.unlockBound = true;

    const tryResume = () => {
      this.handleAudioUnlockOrResume();
    };

    window.addEventListener('pointerdown', tryResume, { passive: true });
    window.addEventListener('touchstart', tryResume, { passive: true });
    window.addEventListener('keydown', tryResume, { passive: true });
    window.addEventListener('focus', tryResume);

    document.addEventListener('visibilitychange', () => {
      this.tabHidden = document.hidden;
      if (document.hidden) {
        this.syncBgmGain();
      } else {
        this.handleAudioUnlockOrResume();
      }
    });
  }

  public handleAudioUnlockOrResume(): void {
    if (this.isAllBlocked()) return;
    if (!this.ctx && this.bgmMode !== 'off' && !this.musicMuted) {
      this.initContext();
    }
    if (this.ctx) {
      const state = this.ctx.state as AudioContextState | 'interrupted';
      if (state === 'suspended' || state === 'interrupted') {
        this.ctx.resume().catch(() => {});
      }
      this.syncBgmGain();
      this.ensureBgmLoop();
    }
  }

  private isAllBlocked(): boolean {
    return this.muted || this.platformMuted || this.tabHidden;
  }

  private isSfxBlocked(): boolean {
    return this.isAllBlocked() || this.userMuted;
  }

  private isBgmBlocked(): boolean {
    return this.isAllBlocked() || this.userMuted || this.musicMuted || this.bgmMode === 'off';
  }

  private initContext(): AudioContext | null {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        try {
          this.ctx = new AudioCtx();
          this.buildNoiseBuffers(this.ctx);
          this.bgmBus = this.ctx.createGain();
          this.bgmBus.gain.value = this.isBgmBlocked() ? 0 : 0.082;
          this.bgmBus.connect(this.ctx.destination);
        } catch {
          this.ctx = null;
        }
      }
    }
    return this.ctx;
  }

  private ensureCtx(): AudioContext | null {
    if (this.isSfxBlocked()) return null;
    const ctx = this.initContext();
    if (!ctx) return null;
    const state = ctx.state as AudioContextState | 'interrupted';
    if (state === 'suspended' || state === 'interrupted') {
      ctx.resume().catch(() => {});
    }
    return ctx;
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

  private syncBgmGain(): void {
    if (!this.ctx || !this.bgmBus) return;
    const now = this.ctx.currentTime;
    const target = this.isBgmBlocked() ? 0.0001 : this.bgmMode === 'hub' ? 0.068 : 0.086;
    this.bgmBus.gain.cancelScheduledValues(now);
    this.bgmBus.gain.setTargetAtTime(target, now, 0.08);
  }

  public setBgmMode(mode: BgmMode): void {
    if (this.bgmMode === mode) return;
    this.bgmMode = mode;
    this.syncBgmGain();
    this.ensureBgmLoop();
  }

  private ensureBgmLoop(): void {
    if (this.isBgmBlocked()) {
      if (this.bgmTimer !== null) {
        window.clearInterval(this.bgmTimer);
        this.bgmTimer = null;
      }
      return;
    }
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (this.bgmTimer !== null) return;

    this.nextNoteTime = this.ctx.currentTime + 0.05;
    this.bgmTimer = window.setInterval(() => this.scheduleBgmTicks(), 110);
  }

  private scheduleBgmTicks(): void {
    if (this.isBgmBlocked() || !this.ctx || !this.bgmBus || this.ctx.state !== 'running') {
      return;
    }

    const bpm = this.bgmMode === 'boss' ? 136 : this.bgmMode === 'combat' ? 122 : 94;
    const stepDur = 60 / bpm / 4; // 16th note
    const lookahead = 0.24;

    if (this.nextNoteTime < this.ctx.currentTime - 0.1) {
      this.nextNoteTime = this.ctx.currentTime + 0.02;
    }

    while (this.nextNoteTime < this.ctx.currentTime + lookahead) {
      this.playSynthStep(this.bgmStep, this.nextNoteTime, stepDur);
      this.bgmStep = (this.bgmStep + 1) % 64;
      this.nextNoteTime += stepDur;
    }
  }

  private playSynthStep(step: number, t: number, stepDur: number): void {
    const ctx = this.ctx;
    const bus = this.bgmBus;
    if (!ctx || !bus) return;

    const bar = Math.floor(step / 16) % 4;
    const s16 = step % 16;

    if (this.bgmMode === 'hub') {
      // Atmospheric tactical command room synth pulse (D minor: D2, Bb1, C2, A1)
      const roots = [38, 34, 36, 33];
      const root = roots[bar];
      if (s16 === 0 || s16 === 6 || s16 === 10) {
        this.triggerBass(ctx, bus, midiToFreq(root), t, stepDur * 2.6, 0.34, 280);
      }
      if (s16 === 0) {
        this.triggerKick(ctx, bus, t, 0.24);
      }
      const arpOffsets = [12, 15, 19, 24, 19, 15, 14, 15];
      if (s16 % 2 === 0) {
        const note = root + arpOffsets[(s16 / 2) % arpOffsets.length];
        this.triggerPluck(ctx, bus, midiToFreq(note), t, stepDur * 1.7, 0.14);
      }
      return;
    }

    const isBoss = this.bgmMode === 'boss';
    // Driving dark synthwave combat groove (Dm -> Bb -> F/C -> A / Phrygian Eb for Boss)
    const bassRoots = isBoss ? [38, 39, 38, 36] : [38, 34, 36, 33];
    const root = bassRoots[bar];

    // Kick on 4-on-the-floor (plus syncopated ghost kick in boss mode)
    if (s16 % 4 === 0 || (isBoss && s16 === 14)) {
      this.triggerKick(ctx, bus, t, isBoss ? 0.5 : 0.42);
    }

    // Punchy synth snare on beats 2 & 4
    if (s16 === 4 || s16 === 12) {
      this.triggerSnare(ctx, bus, t, isBoss ? 0.28 : 0.22);
    }

    // Crisp offbeat hi-hat
    if (s16 % 2 === 1) {
      this.triggerHat(ctx, bus, t, s16 % 4 === 2 ? 0.1 : 0.06);
    }

    // Rolling 8th/16th low-pass sawtooth bassline
    if (isBoss || s16 % 2 === 0 || s16 === 15) {
      const oct = isBoss && s16 % 2 === 1 ? 12 : 0;
      const fifth = s16 === 14 ? 7 : 0;
      this.triggerBass(
        ctx,
        bus,
        midiToFreq(root + oct + fifth),
        t,
        stepDur * (isBoss ? 0.92 : 1.65),
        isBoss ? 0.36 : 0.32,
        isBoss ? 680 : 520
      );
    }

    // Tactical minor synth motif
    const combatLead: (number | null)[] = isBoss
      ? [62, null, 65, 63, 62, null, 69, null, 68, null, 65, null, 63, 62, 60, null]
      : [62, null, null, 65, null, null, 69, null, 67, null, 65, null, 64, null, 60, null];
    const leadMidi = combatLead[s16];
    if (leadMidi !== null && (bar % 2 === 0 || s16 < 8)) {
      this.triggerPluck(ctx, bus, midiToFreq(leadMidi), t, stepDur * 2.1, isBoss ? 0.2 : 0.16);
    }
  }

  private triggerKick(ctx: AudioContext, dest: AudioNode, t: number, amp: number): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(132, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.11);
    gain.gain.setValueAtTime(amp, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    osc.connect(gain).connect(dest);
    osc.start(t);
    osc.stop(t + 0.14);
  }

  private triggerSnare(ctx: AudioContext, dest: AudioNode, t: number, amp: number): void {
    if (!this.noiseBufferShort) return;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBufferShort;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1550, t);
    filter.Q.value = 0.9;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(amp, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    noise.connect(filter).connect(gain).connect(dest);
    noise.start(t);
    noise.stop(t + 0.125);
  }

  private triggerHat(ctx: AudioContext, dest: AudioNode, t: number, amp: number): void {
    if (!this.noiseBufferShort) return;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBufferShort;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(6500, t);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(amp, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.042);
    noise.connect(filter).connect(gain).connect(dest);
    noise.start(t);
    noise.stop(t + 0.045);
  }

  private triggerBass(
    ctx: AudioContext,
    dest: AudioNode,
    freq: number,
    t: number,
    dur: number,
    amp: number,
    cutoff: number
  ): void {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, t);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, t);
    filter.frequency.exponentialRampToValueAtTime(120, t + dur);
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(amp, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(filter).connect(gain).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.01);
  }

  private triggerPluck(
    ctx: AudioContext,
    dest: AudioNode,
    freq: number,
    t: number,
    dur: number,
    amp: number
  ): void {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1900, t);
    filter.frequency.exponentialRampToValueAtTime(420, t + dur);
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(amp, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(filter).connect(gain).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.01);
  }

  public setAdMuted(adMuted: boolean): void {
    this.muted = adMuted;
    this.syncBgmGain();
    if (!adMuted) {
      this.handleAudioUnlockOrResume();
    }
  }

  public setPlatformMuted(pm: boolean): void {
    this.platformMuted = pm;
    this.syncBgmGain();
    if (pm && this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {});
    } else if (!pm) {
      this.handleAudioUnlockOrResume();
    }
  }

  public toggleUserMute(): boolean {
    this.userMuted = !this.userMuted;
    try {
      localStorage.setItem(SFX_MUTE_KEY, this.userMuted ? '1' : '0');
    } catch {
      // ignore
    }
    this.syncBgmGain();
    if (!this.userMuted) {
      this.handleAudioUnlockOrResume();
    }
    return this.userMuted;
  }

  public isUserMuted(): boolean {
    return this.userMuted;
  }

  public toggleMusicMute(): boolean {
    this.musicMuted = !this.musicMuted;
    try {
      localStorage.setItem(BGM_MUTE_KEY, this.musicMuted ? '1' : '0');
    } catch {
      // ignore
    }
    if (!this.musicMuted && this.userMuted) {
      this.userMuted = false;
      try {
        localStorage.setItem(SFX_MUTE_KEY, '0');
      } catch {
        // ignore
      }
    }
    this.syncBgmGain();
    if (!this.musicMuted) {
      this.handleAudioUnlockOrResume();
    } else {
      this.ensureBgmLoop();
    }
    return this.musicMuted;
  }

  public isMusicMuted(): boolean {
    return this.musicMuted || this.userMuted;
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
      gain.gain.setValueAtTime(0.13, now);
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
      nGain.gain.setValueAtTime(type === 'shotgun' ? 0.2 : 0.105, now);
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
    oGain.gain.setValueAtTime(0.13, now);
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
    gain.gain.setValueAtTime(0.09, now);
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

  public emptyClip(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    [720, 310].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, now + idx * 0.065);
      gain.gain.setValueAtTime(0.11, now + idx * 0.065);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.065 + 0.06);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + idx * 0.065);
      osc.stop(now + idx * 0.065 + 0.06);
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
