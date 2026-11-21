// Neon Harbor — fully synthesised WebAudio sound.
//
// No audio files: every sound is built from oscillators and filtered
// noise at runtime — the engine hum that follows the car's speed, the
// two-tone police siren, gunshots, punches, cash-register chimes, and a
// quiet bass-and-pluck music loop that schedules itself a bar ahead.
// Everything is guarded so a headless browser or a denied AudioContext
// never throws: calls simply become no-ops until audio is available.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineFilter = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenLfo = null;
    this.sirenGain = null;
    this.musicOn = false;
    this.musicStep = 0;
    this.nextNoteTime = 0;
  }

  // Create (or resume) the context. Browsers require a user gesture
  // first, so this is called from input handlers as well as from
  // every sound: until it succeeds, sounds are silently skipped.
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  setMuted(m) {
    this.muted = !!m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.02);
    }
  }

  makeOsc(type, freq) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    return o;
  }

  makeGain(value) {
    const g = this.ctx.createGain();
    g.gain.value = value;
    return g;
  }

  // One tone at an absolute context time — the primitive everything
  // else is built from.
  toneAt(freq, dur, type, gain, when, slide = 0) {
    if (!this.ensure()) return;
    const o = this.makeOsc(type, freq);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), when + dur);
    const g = this.makeGain(0);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(when);
    o.stop(when + dur + 0.05);
  }

  tone(freq, dur, type = 'sine', gain = 0.2, delay = 0, slide = 0) {
    if (!this.ensure()) return;
    this.toneAt(freq, dur, type, gain, this.ctx.currentTime + delay, slide);
  }

  noise(dur, filterFreq = 1000, gain = 0.2, type = 'lowpass') {
    if (!this.ensure()) return;
    const t0 = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    const g = this.makeGain(gain);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur);
  }

  playSeq(name) {
    if (name === 'cash') this.cash();
    else if (name === 'chime') this.chime();
    else if (name === 'fail') this.fail();
    else if (name === 'mission') this.missionComplete();
    else if (name === 'click') this.click();
  }

  click() {
    this.tone(1200, 0.06, 'square', 0.12);
  }

  cash() {
    this.tone(880, 0.12, 'sine', 0.25);
    this.tone(1318, 0.18, 'sine', 0.25, 0.09);
  }

  chime() {
    [523, 659, 784].forEach((f, i) => this.tone(f, 0.25, 'sine', 0.2, i * 0.08));
  }

  fail() {
    this.tone(220, 0.3, 'sawtooth', 0.18, 0, -110);
  }

  missionComplete() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.22, i * 0.11));
  }

  punch() {
    this.noise(0.12, 900, 0.3);
    this.tone(140, 0.1, 'sine', 0.25, 0, -60);
  }

  gunshot() {
    this.noise(0.18, 2500, 0.5, 'highpass');
    this.tone(90, 0.15, 'square', 0.3, 0, -40);
  }

  crash() {
    this.noise(0.35, 700, 0.45);
    this.tone(70, 0.3, 'sawtooth', 0.3, 0, -30);
  }

  // Engine: a low sawtooth through a low-pass filter. setEngine is
  // called every frame while driving; ratio is speed / top speed.
  buildEngine() {
    if (!this.ensure()) return;
    if (this.engineOsc) return;
    this.engineOsc = this.makeOsc('sawtooth', 60);
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 420;
    this.engineGain = this.makeGain(0);
    this.engineOsc.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();
  }

  setEngine(ratio, on) {
    if (!this.ctx || !this.engineOsc) {
      if (on) this.buildEngine();
      if (!this.engineOsc) return;
    }
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(on ? 0.05 + ratio * 0.09 : 0, t, 0.08);
    this.engineOsc.frequency.setTargetAtTime(55 + ratio * 140, t, 0.1);
  }

  // Siren: a sine wobbling between ~570 and ~930 Hz on a slow LFO.
  buildSiren() {
    if (!this.ensure()) return;
    if (this.sirenOsc) return;
    this.sirenOsc = this.makeOsc('sine', 750);
    this.sirenLfo = this.makeOsc('sine', 0.7);
    const lfoGain = this.makeGain(180);
    this.sirenLfo.connect(lfoGain);
    lfoGain.connect(this.sirenOsc.frequency);
    this.sirenGain = this.makeGain(0);
    this.sirenOsc.connect(this.sirenGain);
    this.sirenGain.connect(this.master);
    this.sirenOsc.start();
    this.sirenLfo.start();
  }

  setSiren(on) {
    if (!this.ctx || !this.sirenOsc) {
      if (on) this.buildSiren();
      if (!this.sirenOsc) return;
    }
    this.sirenGain.gain.setTargetAtTime(on ? 0.045 : 0, this.ctx.currentTime, 0.1);
  }

  startMusic() {
    this.musicOn = true;
    if (this.ctx) this.nextNoteTime = this.ctx.currentTime + 0.1;
  }

  // Called once per frame: schedule the music loop a quarter-second
  // ahead so it never stutters. 64 eighth-note steps at 112 BPM.
  musicTick() {
    if (!this.musicOn || !this.ensure()) return;
    if (!this.nextNoteTime || this.nextNoteTime < this.ctx.currentTime - 0.5) {
      this.nextNoteTime = this.ctx.currentTime + 0.05;
    }
    const stepDur = 60 / 112 / 2;
    while (this.nextNoteTime < this.ctx.currentTime + 0.25) {
      this.scheduleStep(this.musicStep, this.nextNoteTime);
      this.musicStep = (this.musicStep + 1) % 64;
      this.nextNoteTime += stepDur;
    }
  }

  scheduleStep(step, t) {
    // A minor-key groove: root notes on the bass, pentatonic plucks above.
    const bass = [55, 0, 0, 55, 0, 0, 65.41, 0, 55, 0, 0, 55, 0, 49, 0, 41.2];
    const lead = [220, 0, 261.63, 0, 329.63, 0, 261.63, 0, 220, 0, 196, 0, 164.81, 0, 196, 0];
    const b = bass[step % 16];
    if (b) this.toneAt(b, 0.24, 'triangle', 0.07, t);
    if (step % 2 === 0) {
      const l = lead[step % 16];
      if (l) this.toneAt(l, 0.18, 'sine', 0.035, t);
    }
  }
}

// Module-level conveniences for callers that do not hold an instance:
// they share one lazily created engine.
let sharedEngine = null;

function shared() {
  if (!sharedEngine) sharedEngine = new AudioEngine();
  return sharedEngine;
}

export function buildEngine() {
  return shared().buildEngine();
}

export function setEngine(ratio, on) {
  return shared().setEngine(ratio, on);
}

export function buildSiren() {
  return shared().buildSiren();
}

export function setSiren(on) {
  return shared().setSiren(on);
}

export function musicTick() {
  return shared().musicTick();
}

export function startMusic() {
  return shared().startMusic();
}
