// Neon Harbor — every sound is synthesised in WebAudio.
//
// No audio files: the engine hum, the siren, gunshots, punches, crashes
// and the music loop are all oscillators and filtered noise, built when
// the player first interacts (browsers want a gesture before sound) and
// silent before that. Everything is a no-op when the context cannot
// start — a headless test browser has no speakers, and the game must
// never crash for it.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.dead = false;
    this.engineNodes = null;
    this.sirenNodes = null;
    this.musicTimer = null;
    this.musicStep = 0;
  }

  // Build (or wake) the context. Called from button clicks and the first
  // key press, so it always runs inside a user gesture. Safe to call
  // repeatedly; a failure marks the engine dead and every method below
  // becomes a silent no-op.
  ensure() {
    if (this.dead) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { this.dead = true; return; }
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.9;
        this.master.connect(this.ctx.destination);
        this.startMusic();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.dead = true;
    }
  }

  setMuted(m) {
    this.muted = !!m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.02);
    }
  }

  // One short tone. `slide` bends the pitch toward a second frequency.
  tone(freq, dur, type = 'sine', gain = 0.15, delay = 0, slide = 0) {
    if (!this.ctx || this.dead) return;
    try {
      const t0 = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t0 + dur);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    } catch {
      // A tone that cannot start is not worth crashing over.
    }
  }

  // A burst of filtered noise: the raw material for punches, gunshots
  // and crashes. Lower filter, longer tail, louder gain = a heavier hit.
  noise(dur, filterFreq, gain = 0.2, type = 'lowpass') {
    if (!this.ctx || this.dead) return;
    try {
      const t0 = this.ctx.currentTime;
      const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const filt = this.ctx.createBiquadFilter();
      filt.type = type;
      filt.frequency.value = filterFreq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      src.connect(filt);
      filt.connect(g);
      g.connect(this.master);
      src.start(t0);
    } catch {
      // As above.
    }
  }

  click() {
    this.tone(880, 0.06, 'square', 0.06);
  }

  cash() {
    this.tone(880, 0.1, 'sine', 0.14);
    this.tone(1318, 0.16, 'sine', 0.14, 0.09);
  }

  chime() {
    this.tone(660, 0.18, 'sine', 0.12);
  }

  fail() {
    this.tone(220, 0.4, 'sawtooth', 0.12, 0, 110);
  }

  missionComplete() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((n, i) => this.tone(n, 0.16, 'triangle', 0.14, i * 0.11));
  }

  punch() {
    this.noise(0.09, 900, 0.25);
    this.tone(140, 0.08, 'sine', 0.2, 0, 70);
  }

  gunshot() {
    this.noise(0.13, 3200, 0.3, 'highpass');
    this.noise(0.1, 500, 0.2);
  }

  crash() {
    this.noise(0.32, 420, 0.35);
    this.tone(90, 0.25, 'sine', 0.22, 0, 45);
  }

  // The engine hum: a sawtooth whose pitch follows the speed ratio, plus
  // a low sine for body. Kept alive while driving and silenced when the
  // player gets out; `on` false parks the gain at zero.
  setEngine(ratio, on) {
    if (!this.ctx || this.dead) return;
    try {
      if (!this.engineNodes) {
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 60;
        const sub = this.ctx.createOscillator();
        sub.type = 'sine';
        sub.frequency.value = 40;
        const filt = this.ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.value = 420;
        const g = this.ctx.createGain();
        g.gain.value = 0;
        osc.connect(filt);
        sub.connect(filt);
        filt.connect(g);
        g.connect(this.master);
        osc.start();
        sub.start();
        this.engineNodes = { osc, sub, g };
      }
      const n = this.engineNodes;
      const t = this.ctx.currentTime;
      n.osc.frequency.setTargetAtTime(55 + ratio * 150, t, 0.05);
      n.sub.frequency.setTargetAtTime(38 + ratio * 60, t, 0.05);
      n.g.gain.setTargetAtTime(on ? 0.05 + ratio * 0.06 : 0, t, 0.08);
    } catch {
      // The hum is ambience, not load-bearing.
    }
  }

  // The police siren: one oscillator wailing between two tones on a slow
  // LFO. `on` false parks it; the nodes stay built so it can come back.
  setSiren(on) {
    if (!this.ctx || this.dead) return;
    try {
      if (!this.sirenNodes) {
        const osc = this.ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = 820;
        const lfo = this.ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.55;
        const depth = this.ctx.createGain();
        depth.gain.value = 160;
        lfo.connect(depth);
        depth.connect(osc.frequency);
        const g = this.ctx.createGain();
        g.gain.value = 0;
        osc.connect(g);
        g.connect(this.master);
        osc.start();
        lfo.start();
        this.sirenNodes = { g };
      }
      const t = this.ctx.currentTime;
      this.sirenNodes.g.gain.setTargetAtTime(on ? 0.045 : 0, t, 0.15);
    } catch {
      // As above.
    }
  }

  // A lazy bassline loop: a minor-key walk that steps twice a second.
  // It starts with the context and runs quietly under everything else.
  startMusic() {
    if (this.musicTimer !== null) return;
    const bass = [110, 110, 130.8, 98, 110, 110, 146.8, 164.8];
    const pluck = [220, 261.6, 329.6, 261.6, 220, 196, 246.9, 293.7];
    this.musicTimer = window.setInterval(() => {
      if (this.dead || !this.ctx || this.ctx.state !== 'running') return;
      const i = this.musicStep % bass.length;
      this.tone(bass[i], 0.42, 'triangle', 0.05);
      if (this.musicStep % 2 === 0) {
        this.tone(pluck[i], 0.3, 'sine', 0.035);
      }
      this.musicStep++;
    }, 480);
  }
}
