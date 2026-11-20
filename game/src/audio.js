// Neon Harbor — every sound is synthesised in WebAudio.
//
// No audio files: the engine hum, the siren, gunshots, punches, crashes
// and the music loop are all oscillators and filtered noise, built when
// the player first interacts (browsers want a gesture before sound)
// and silent before that. Everything is a no-op when the context cannot
// start — a headless test browser has no speakers, and the game must
// never crash for it.

// Each named sound is a short list of steps. A tone step is
// ['tone', freq, dur, type, gain, delay, slide] and a noise step is
// ['noise', dur, filterFreq, gain, type]. The table is the sound
// design; the player below just walks it.
const SOUND_SEQUENCES = {
  click: [
    ['tone', 880, 0.06, 'square', 0.06, 0, 0],
  ],
  cash: [
    ['tone', 880, 0.1, 'sine', 0.14, 0, 0],
    ['tone', 1318, 0.16, 'sine', 0.14, 0.09, 0],
  ],
  chime: [
    ['tone', 660, 0.18, 'sine', 0.12, 0, 0],
  ],
  fail: [
    ['tone', 220, 0.4, 'sawtooth', 0.12, 0, 110],
  ],
  missionComplete: [
    ['tone', 523, 0.16, 'triangle', 0.14, 0, 0],
    ['tone', 659, 0.16, 'triangle', 0.14, 0.11, 0],
    ['tone', 784, 0.16, 'triangle', 0.14, 0.22, 0],
    ['tone', 1046, 0.16, 'triangle', 0.14, 0.33, 0],
  ],
  punch: [
    ['noise', 0.09, 900, 0.25, 'lowpass'],
    ['tone', 140, 0.08, 'sine', 0.2, 0, 70],
  ],
  gunshot: [
    ['noise', 0.13, 3200, 0.3, 'highpass'],
    ['noise', 0.1, 500, 0.2, 'lowpass'],
  ],
  crash: [
    ['noise', 0.32, 420, 0.35, 'lowpass'],
    ['tone', 90, 0.25, 'sine', 0.22, 0, 45],
  ],
};

// The music loop: a lazy bassline walk with a pluck on every other
// step, twice a second.
const MELODY = {
  bass: [110, 110, 130.8, 98, 110, 110, 146.8, 164.8],
  pluck: [220, 261.6, 329.6, 261.6, 220, 196, 246.9, 293.7],
  stepMs: 480,
};

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

  // Build (or wake) the context. Called from button clicks and the
  // first key press, so it always runs inside a user gesture. Safe to
  // call repeatedly; a failure marks the engine dead and every method
  // below becomes a silent no-op.
  ensure() {
    if (this.dead) return;
    try {
      if (!this.ctx) this.buildContext();
      if (this.ctx && this.ctx.state === 'suspended') {
        const waking = this.ctx.resume();
        if (waking && waking.catch) waking.catch(function () {});
      }
    } catch (e) {
      this.dead = true;
    }
  }

  buildContext() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      this.dead = true;
      return;
    }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);
    this.startMusic();
  }

  setMuted(m) {
    this.muted = !!m;
    if (this.master && this.ctx) {
      const level = this.muted ? 0 : 0.9;
      this.master.gain.setTargetAtTime(level, this.ctx.currentTime, 0.02);
    }
  }

  // One short tone. `slide` bends the pitch toward a second frequency.
  tone(freq, dur, type, gain, delay, slide) {
    if (!this.ctx || this.dead) return;
    const kind = type === undefined ? 'sine' : type;
    const vol = gain === undefined ? 0.15 : gain;
    const wait = delay === undefined ? 0 : delay;
    const bend = slide === undefined ? 0 : slide;
    try {
      const t0 = this.ctx.currentTime + wait;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = kind;
      osc.frequency.setValueAtTime(freq, t0);
      if (bend) {
        const floor = bend < 20 ? 20 : bend;
        osc.frequency.exponentialRampToValueAtTime(floor, t0 + dur);
      }
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    } catch (e) {
      // A tone that cannot start is not worth crashing over.
    }
  }

  // A burst of filtered noise: the raw material for punches, gunshots
  // and crashes. Lower filter, longer tail, louder gain = a heavier hit.
  noise(dur, filterFreq, gain, type) {
    if (!this.ctx || this.dead) return;
    const vol = gain === undefined ? 0.2 : gain;
    const kind = type === undefined ? 'lowpass' : type;
    try {
      const t0 = this.ctx.currentTime;
      const rawLen = Math.floor(this.ctx.sampleRate * dur);
      const count = rawLen < 1 ? 1 : rawLen;
      const buf = this.ctx.createBuffer(1, count, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      let i = 0;
      while (i < count) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / count);
        i++;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const filt = this.ctx.createBiquadFilter();
      filt.type = kind;
      filt.frequency.value = filterFreq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      src.connect(filt);
      filt.connect(g);
      g.connect(this.master);
      src.start(t0);
    } catch (e) {
      // As above.
    }
  }

  // Walk one named sequence from the table above.
  playSeq(name) {
    const steps = SOUND_SEQUENCES[name];
    if (!steps) return;
    let i = 0;
    while (i < steps.length) {
      const s = steps[i];
      if (s[0] === 'tone') {
        this.tone(s[1], s[2], s[3], s[4], s[5], s[6]);
      } else {
        this.noise(s[1], s[2], s[3], s[4]);
      }
      i++;
    }
  }

  click() { this.playSeq('click'); }

  cash() { this.playSeq('cash'); }

  chime() { this.playSeq('chime'); }

  fail() { this.playSeq('fail'); }

  missionComplete() { this.playSeq('missionComplete'); }

  punch() { this.playSeq('punch'); }

  gunshot() { this.playSeq('gunshot'); }

  crash() { this.playSeq('crash'); }

  makeOsc(type, freq) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    return osc;
  }

  makeGain(value) {
    const g = this.ctx.createGain();
    g.gain.value = value;
    return g;
  }

  // Build the engine hum nodes once: a sawtooth whose pitch follows
  // the speed ratio, plus a low sine for body.
  buildEngine() {
    const osc = this.makeOsc('sawtooth', 60);
    const sub = this.makeOsc('sine', 40);
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 420;
    const g = this.makeGain(0);
    osc.connect(filt);
    sub.connect(filt);
    filt.connect(g);
    g.connect(this.master);
    osc.start();
    sub.start();
    this.engineNodes = { osc, sub, g };
  }

  // The engine hum, kept alive while driving and silenced when the
  // player gets out; `on` false parks the gain at zero.
  setEngine(ratio, on) {
    if (!this.ctx || this.dead) return;
    try {
      if (!this.engineNodes) this.buildEngine();
      const nodes = this.engineNodes;
      const t = this.ctx.currentTime;
      nodes.osc.frequency.setTargetAtTime(55 + ratio * 150, t, 0.05);
      nodes.sub.frequency.setTargetAtTime(38 + ratio * 60, t, 0.05);
      const level = on ? 0.05 + ratio * 0.06 : 0;
      nodes.g.gain.setTargetAtTime(level, t, 0.08);
    } catch (e) {
      // The hum is ambience, not load-bearing.
    }
  }

  // Build the siren nodes once: one oscillator wailing between two
  // tones on a slow LFO.
  buildSiren() {
    const osc = this.makeOsc('triangle', 820);
    const lfo = this.makeOsc('sine', 0.55);
    const depth = this.makeGain(160);
    lfo.connect(depth);
    depth.connect(osc.frequency);
    const g = this.makeGain(0);
    osc.connect(g);
    g.connect(this.master);
    osc.start();
    lfo.start();
    this.sirenNodes = { g };
  }

  // The police siren. `on` false parks it; the nodes stay built so it
  // can come back.
  setSiren(on) {
    if (!this.ctx || this.dead) return;
    try {
      if (!this.sirenNodes) this.buildSiren();
      const t = this.ctx.currentTime;
      const level = on ? 0.045 : 0;
      this.sirenNodes.g.gain.setTargetAtTime(level, t, 0.15);
    } catch (e) {
      // As above.
    }
  }

  // One step of the music loop: a bass note every step, a pluck on
  // every other step.
  musicTick() {
    if (this.dead || !this.ctx || this.ctx.state !== 'running') return;
    const i = this.musicStep % MELODY.bass.length;
    this.tone(MELODY.bass[i], 0.42, 'triangle', 0.05);
    if (this.musicStep % 2 === 0) {
      this.tone(MELODY.pluck[i], 0.3, 'sine', 0.035);
    }
    this.musicStep++;
  }

  // A lazy bassline loop: a minor-key walk that steps twice a second.
  // It starts with the context and runs quietly under everything else.
  startMusic() {
    if (this.musicTimer !== null) return;
    const self = this;
    this.musicTimer = window.setInterval(function () {
      self.musicTick();
    }, MELODY.stepMs);
  }
}
