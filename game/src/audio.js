// Neon Harbor — every sound is built live with WebAudio. There are no
// audio files: the engine hum is two detuned oscillators through a low-pass
// filter, the siren is a triangle wave wobbled by a square LFO, gunshots
// and crashes are filtered noise bursts, and the music is a slow bass line
// under soft pad chords on a timer.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.master = null;
    this.noiseBuf = null;
    this.engineNodes = null;
    this.sirenNodes = null;
    this.sirenOn = false;
    this.musicTimer = null;
    this.musicStep = 0;
  }

  // Browsers only let audio start from a gesture, so the first click on
  // the title screen calls this; afterwards it just wakes a suspended
  // context back up.
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(this.ctx.destination);
    const len = Math.floor(this.ctx.sampleRate * 0.5);
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.buildEngineLoop();
    this.buildMusicLoop();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.55;
  }

  buildEngineLoop() {
    const c = this.ctx;
    const out = c.createGain();
    out.gain.value = 0;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const saw = c.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = 55;
    const sub = c.createOscillator();
    sub.type = 'square';
    sub.frequency.value = 28;
    const subGain = c.createGain();
    subGain.gain.value = 0.4;
    saw.connect(filter);
    sub.connect(subGain);
    subGain.connect(filter);
    filter.connect(out);
    out.connect(this.master);
    saw.start();
    sub.start();
    this.engineNodes = { saw, sub, out };
  }

  // speed01 is 0..1, driving says whether the player is in a car at all.
  setEngine(speed01, driving) {
    if (!this.ctx || !this.engineNodes) return;
    const t = this.ctx.currentTime;
    const rpm = 50 + speed01 * 160;
    this.engineNodes.saw.frequency.setTargetAtTime(rpm, t, 0.08);
    this.engineNodes.sub.frequency.setTargetAtTime(rpm * 0.5, t, 0.08);
    this.engineNodes.out.gain.setTargetAtTime(driving ? 0.05 + speed01 * 0.06 : 0.0, t, 0.1);
  }

  setSiren(on) {
    if (!this.ctx || on === this.sirenOn) return;
    this.sirenOn = on;
    if (on) {
      const c = this.ctx;
      const gain = c.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(0.045, c.currentTime, 0.3);
      const osc = c.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 780;
      const lfo = c.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 0.55;
      const lfoGain = c.createGain();
      lfoGain.gain.value = 190;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start();
      lfo.start();
      this.sirenNodes = { osc, lfo, gain };
    } else if (this.sirenNodes) {
      const nodes = this.sirenNodes;
      this.sirenNodes = null;
      nodes.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      setTimeout(() => {
        try {
          nodes.osc.stop();
          nodes.lfo.stop();
          nodes.gain.disconnect();
        } catch (e) {
          // Already stopped — nothing to clean up.
        }
      }, 400);
    }
  }

  // One short oscillator note, optionally delayed. Everything melodic
  // goes through here.
  blip(freq, dur, type, vol, when = 0) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime + when;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol || 0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // One burst of the shared noise buffer through a low-pass filter.
  noiseBurst(cutoff, peak, decay) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = c.createGain();
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + decay);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(t);
    src.stop(t + decay + 0.05);
  }

  click() {
    this.blip(660, 0.07, 'square', 0.08);
  }

  punch() {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  gunshot() {
    this.noiseBurst(2400, 0.5, 0.18);
    this.blip(90, 0.1, 'sine', 0.3);
  }

  crash() {
    this.noiseBurst(500, 0.6, 0.4);
  }

  chime() {
    this.blip(880, 0.18, 'sine', 0.18);
    this.blip(1318, 0.3, 'sine', 0.15, 0.09);
  }

  missionComplete() {
    const notes = [523, 659, 784, 1046, 1318];
    notes.forEach((n, i) => this.blip(n, 0.35, 'triangle', 0.18, i * 0.11));
  }

  fail() {
    this.blip(220, 0.4, 'sawtooth', 0.12);
    this.blip(165, 0.5, 'sawtooth', 0.12, 0.15);
  }

  cash() {
    this.blip(1046, 0.12, 'triangle', 0.2);
    this.blip(1568, 0.22, 'triangle', 0.16, 0.08);
  }

  // Slow loop: a bass note on half the steps, a soft pad chord every
  // fourth step. Silent while muted, but the step counter keeps moving.
  buildMusicLoop() {
    if (this.musicTimer) return;
    const bass = [55, 0, 65.4, 0, 49, 0, 58.3, 0, 55, 0, 65.4, 0, 73.4, 0, 65.4, 0];
    const chords = [
      [220, 277, 330],
      [174, 220, 261],
      [196, 247, 294],
      [146, 220, 293],
    ];
    this.musicTimer = setInterval(() => {
      if (!this.ctx || this.muted) {
        this.musicStep++;
        return;
      }
      const i = this.musicStep % 16;
      const note = bass[i];
      if (note) this.blip(note, 0.5, 'triangle', 0.05);
      if (i % 4 === 0) {
        const chord = chords[Math.floor(this.musicStep / 4) % 4];
        chord.forEach((n) => this.blip(n, 1.8, 'sine', 0.022));
      }
      this.musicStep++;
    }, 320);
  }
}
