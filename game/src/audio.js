// Neon Harbor — all sound is synthesised with WebAudio. No audio files.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.master = null;
    this.engineOsc = null; this.engineOsc2 = null; this.engineGain = null;
    this.sirenOsc = null; this.sirenGain = null; this.sirenOn = false;
    this.musicTimer = null; this.musicStep = 0;
    this.noiseBuf = null;
  }

  // Must be called from a user gesture at least once.
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(this.ctx.destination);
    // shared noise buffer for gunshots / crashes
    const len = this.ctx.sampleRate * 0.5;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startEngine();
    this.startMusic();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
  }

  startEngine() {
    const c = this.ctx;
    this.engineGain = c.createGain(); this.engineGain.gain.value = 0;
    const filt = c.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 900;
    this.engineOsc = c.createOscillator(); this.engineOsc.type = 'sawtooth'; this.engineOsc.frequency.value = 55;
    this.engineOsc2 = c.createOscillator(); this.engineOsc2.type = 'square'; this.engineOsc2.frequency.value = 28;
    const g2 = c.createGain(); g2.gain.value = 0.4;
    this.engineOsc.connect(filt); this.engineOsc2.connect(g2); g2.connect(filt);
    filt.connect(this.engineGain); this.engineGain.connect(this.master);
    this.engineOsc.start(); this.engineOsc2.start();
  }

  setEngine(speed01, driving) {
    if (!this.ctx || !this.engineGain) return;
    const t = this.ctx.currentTime;
    const rpm = 50 + speed01 * 160;
    this.engineOsc.frequency.setTargetAtTime(rpm, t, 0.08);
    this.engineOsc2.frequency.setTargetAtTime(rpm * 0.5, t, 0.08);
    this.engineGain.gain.setTargetAtTime(driving ? 0.05 + speed01 * 0.06 : 0.0, t, 0.1);
  }

  setSiren(on) {
    if (!this.ctx) return;
    if (on === this.sirenOn) return;
    this.sirenOn = on;
    if (on) {
      const c = this.ctx;
      this.sirenGain = c.createGain(); this.sirenGain.gain.value = 0.0;
      this.sirenGain.gain.setTargetAtTime(0.045, c.currentTime, 0.3);
      this.sirenOsc = c.createOscillator(); this.sirenOsc.type = 'triangle';
      this.sirenOsc.frequency.value = 780;
      const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 0.55;
      const lg = c.createGain(); lg.gain.value = 190;
      lfo.connect(lg); lg.connect(this.sirenOsc.frequency);
      this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(this.master);
      this.sirenOsc.start(); lfo.start();
      this.sirenLfo = lfo;
    } else if (this.sirenOsc) {
      const o = this.sirenOsc, l = this.sirenLfo, g = this.sirenGain;
      g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      setTimeout(() => { try { o.stop(); l.stop(); g.disconnect(); } catch (e) {} }, 400);
      this.sirenOsc = null;
    }
  }

  blip(freq, dur, type, vol, when = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  click() { this.blip(660, 0.07, 'square', 0.08); }
  punch() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.16);
  }
  gunshot() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2400;
    const g = c.createGain();
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + 0.2);
    this.blip(90, 0.1, 'sine', 0.3);
  }
  crash() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    const g = c.createGain();
    g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + 0.45);
  }
  chime() { this.blip(880, 0.18, 'sine', 0.18); this.blip(1318, 0.3, 'sine', 0.15, 0.09); }
  missionComplete() {
    const notes = [523, 659, 784, 1046, 1318];
    notes.forEach((n, i) => this.blip(n, 0.35, 'triangle', 0.18, i * 0.11));
  }
  fail() { this.blip(220, 0.4, 'sawtooth', 0.12); this.blip(165, 0.5, 'sawtooth', 0.12, 0.15); }

  // Quiet procedural loop: slow bass line under soft pad chords.
  startMusic() {
    if (this.musicTimer) return;
    const bass = [55, 0, 65.4, 0, 49, 0, 58.3, 0, 55, 0, 65.4, 0, 73.4, 0, 65.4, 0];
    const chords = [[220, 277, 330], [174, 220, 261], [196, 247, 294], [146, 220, 293]];
    this.musicTimer = setInterval(() => {
      if (!this.ctx || this.muted) { this.musicStep++; return; }
      const i = this.musicStep % 16;
      const b = bass[i];
      if (b) this.blip(b, 0.5, 'triangle', 0.05);
      if (i % 4 === 0) {
        const ch = chords[(this.musicStep / 4 | 0) % 4];
        ch.forEach(n => this.blip(n, 1.8, 'sine', 0.022));
      }
      this.musicStep++;
    }, 320);
  }
}
