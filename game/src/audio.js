// Neon Harbor — fully synthesised WebAudio sound.
//
// No audio files: every sound is built from oscillators and filtered
// noise at run time — engine hum, police siren, gunshots, cash chimes,
// punch thuds and a low-key bass-and-hats music loop. Everything is
// safe to call before the player has interacted with the page (no
// AudioContext exists yet) and safe to call after muting: every method
// no-ops instead of throwing.
//
// The engine starts on first user gesture through ensure(); the music
// loop and siren are driven from the main update via musicTick() and
// setSiren().

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.engineOn = false;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenOn = false;
    this.musicTimer = 0;
    this.musicStep = 0;
    this.musicOn = false;
    this.noiseBuffer = null;
  }

  // Create the context on first user gesture. Browsers block audio
  // before interaction, so this is called from the START button handler.
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(this.ctx.destination);
      // A reusable white-noise buffer for crashes, punches and hats.
      const len = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m) {
    this.muted = !!m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, this.ctx.currentTime, 0.05);
    }
  }

  // --- primitives ---------------------------------------------------------

  makeOsc(type, freq) {
    if (!this.ctx) return null;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    return osc;
  }

  makeGain(value) {
    if (!this.ctx) return null;
    const g = this.ctx.createGain();
    g.gain.value = value;
    return g;
  }

  // A short pitched blip, optionally sliding to a second frequency.
  tone(freq, dur = 0.15, type = 'sine', gain = 0.2, delay = 0, slide = null) {
    if (!this.ctx || this.muted) return;
    try {
      const t0 = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t0 + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    } catch { /* audio must never break the game */ }
  }

  // A burst of filtered noise: crashes, whooshes, hi-hats.
  noise(dur = 0.2, filterFreq = 1200, gain = 0.25, type = 'lowpass') {
    if (!this.ctx || this.muted || !this.noiseBuffer) return;
    try {
      const t0 = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = filterFreq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      src.connect(filter);
      filter.connect(g);
      g.connect(this.master);
      src.start(t0);
      src.stop(t0 + dur + 0.05);
    } catch { /* audio must never break the game */ }
  }

  // --- named sounds ---------------------------------------------------------

  click() {
    this.tone(720, 0.06, 'square', 0.12);
  }

  cash() {
    // Two bright coins: E6 then B6.
    this.tone(1318, 0.12, 'sine', 0.22);
    this.tone(1976, 0.22, 'sine', 0.22, 0.09);
  }

  chime() {
    this.tone(880, 0.18, 'triangle', 0.2);
    this.tone(1108, 0.18, 'triangle', 0.2, 0.12);
    this.tone(1318, 0.3, 'triangle', 0.2, 0.24);
  }

  fail() {
    this.tone(220, 0.25, 'sawtooth', 0.16, 0, 160);
    this.tone(160, 0.3, 'sawtooth', 0.14, 0.12, 110);
  }

  missionComplete() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => this.tone(f, 0.28, 'triangle', 0.22, i * 0.11));
    this.noise(0.4, 6000, 0.06, 'highpass');
  }

  punch() {
    this.noise(0.12, 500, 0.35);
    this.tone(140, 0.12, 'sine', 0.3, 0, 70);
  }

  gunshot() {
    this.noise(0.16, 900, 0.5);
    this.tone(180, 0.1, 'square', 0.25, 0, 60);
  }

  crash() {
    this.noise(0.35, 700, 0.4);
    this.tone(90, 0.25, 'sine', 0.3, 0, 45);
  }

  // --- engine hum -----------------------------------------------------------

  buildEngine() {
    if (!this.ctx || this.engineOsc) return;
    try {
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 55;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      this.engineOsc.connect(filter);
      filter.connect(this.engineGain);
      this.engineGain.connect(this.master);
      this.engineOsc.start();
    } catch {
      this.engineOsc = null;
    }
  }

  // ratio 0..1 follows the car's speed; on=false fades the hum out.
  setEngine(ratio, on) {
    if (!this.ctx) return;
    if (on && !this.engineOsc) this.buildEngine();
    if (!this.engineOsc) return;
    const t = this.ctx.currentTime;
    const target = on ? 0.05 + ratio * 0.12 : 0;
    this.engineGain.gain.setTargetAtTime(target, t, 0.08);
    this.engineOsc.frequency.setTargetAtTime(52 + ratio * 95, t, 0.08);
    this.engineOn = on;
  }

  // --- police siren -----------------------------------------------------------

  buildSiren() {
    if (!this.ctx || this.sirenOsc) return;
    try {
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'triangle';
      this.sirenOsc.frequency.value = 720;
      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain);
      this.sirenGain.connect(this.master);
      this.sirenOsc.start();
    } catch {
      this.sirenOsc = null;
    }
  }

  setSiren(on) {
    if (!this.ctx) return;
    if (on && !this.sirenOsc) this.buildSiren();
    if (!this.sirenOsc) return;
    const t = this.ctx.currentTime;
    this.sirenGain.gain.setTargetAtTime(on ? 0.045 : 0, t, 0.15);
    if (on) {
      // Classic two-tone wail, alternating every 0.4 s.
      const phase = Math.floor(t / 0.4) % 2;
      this.sirenOsc.frequency.setTargetAtTime(phase ? 950 : 720, t, 0.05);
    }
    this.sirenOn = on;
  }

  // --- music loop ---------------------------------------------------------------

  // A laid-back loop: a deep bass line walking C–A–F–G with a soft hat
  // ticking eighth notes. Called every frame from main; steps advance
  // on a 0.22 s grid so the tempo stays steady regardless of frame rate.
  musicTick() {
    if (!this.ctx || this.muted || !this.musicOn) return;
    try {
      const now = this.ctx.currentTime;
      if (now < this.musicTimer) return;
      this.musicTimer = now + 0.22;
      const bassLine = [130.8, 110, 87.3, 98];
      const bar = Math.floor(this.musicStep / 8) % 4;
      const stepInBar = this.musicStep % 8;
      if (stepInBar === 0 || stepInBar === 3 || stepInBar === 6) {
        this.tone(bassLine[bar], 0.24, 'triangle', 0.16);
      }
      if (stepInBar % 2 === 1) {
        this.noise(0.04, 8000, 0.035, 'highpass');
      }
      if (stepInBar === 4) this.tone(bassLine[bar] * 2, 0.18, 'sine', 0.07);
      this.musicStep += 1;
    } catch { /* audio must never break the game */ }
  }

  startMusic() {
    this.ensure();
    this.musicOn = true;
    this.musicTimer = 0;
    this.musicStep = 0;
  }

  // A named sequence of tones, used by the HUD for pickups and alerts.
  // Names: 'cash', 'chime', 'fail', 'complete', 'click'.
  playSeq(name) {
    switch (name) {
      case 'cash': this.cash(); break;
      case 'chime': this.chime(); break;
      case 'fail': this.fail(); break;
      case 'complete': this.missionComplete(); break;
      case 'click': this.click(); break;
      default: this.click(); break;
    }
  }
}
