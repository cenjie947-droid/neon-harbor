// Neon Harbor — synthesised audio (round 6 fresh rewrite).
// Every sound is built with the WebAudio API: no audio files, no network.
// The context is created lazily by ensure() (browsers require a user
// gesture), and every method is a safe no-op until then, so headless test
// runs and muted play never throw. Mute routes through one master gain.

const MUSIC_BASS = [55, 0, 55, 0, 65.4, 0, 49, 0, 55, 0, 55, 0, 73.4, 65.4, 49, 0];
const MUSIC_LEAD = [220, 0, 261.6, 329.6, 0, 293.7, 261.6, 0, 220, 0, 246.9, 293.7, 329.6, 0, 261.6, 0];

export function createAudio() {
  const audio = {
    muted: false,
    ctx: null,
    master: null,
    engineOsc: null,
    engineGain: null,
    engineFilter: null,
    sirenOsc: null,
    sirenGain: null,
    sirenLfo: null,
    musicTimer: null,
    musicStep: 0,

    // Create (or resume) the context. Safe to call on every user gesture.
    ensure() {
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return false;
          this.ctx = new AC();
          this.master = this.ctx.createGain();
          this.master.gain.value = this.muted ? 0 : 0.5;
          this.master.connect(this.ctx.destination);
        }
        if (this.ctx.state === 'suspended') void this.ctx.resume();
        return true;
      } catch {
        return false;
      }
    },

    setMuted(m) {
      this.muted = !!m;
      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.02);
      }
      return this.muted;
    },

    // One enveloped oscillator note. slideTo glides the pitch (engine
    // revs, sirens, falling gunshot thump).
    tone(freq, dur, type = 'sine', vol = 0.2, slideTo = null, when = 0) {
      if (!this.ctx || !this.master) return;
      try {
        const t0 = this.ctx.currentTime + when;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(Math.max(20, freq), t0);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(vol, t0 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        osc.connect(gain);
        gain.connect(this.master);
        osc.start(t0);
        osc.stop(t0 + dur + 0.05);
      } catch { /* never break the game for a blip */ }
    },

    // Filtered white-noise burst: impacts, gunfire, wind, static.
    noise(dur, filterFreq = 1000, vol = 0.3, type = 'lowpass', when = 0) {
      if (!this.ctx || !this.master) return;
      try {
        const t0 = this.ctx.currentTime + when;
        const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        const filter = this.ctx.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = filterFreq;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(vol, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(this.master);
        src.start(t0);
        src.stop(t0 + dur);
      } catch { /* never break the game for a blip */ }
    },

    click() {
      this.tone(820, 0.06, 'square', 0.08);
    },

    cash() {
      this.tone(880, 0.1, 'sine', 0.18);
      this.tone(1318, 0.16, 'sine', 0.18, null, 0.09);
    },

    chime() {
      this.tone(523, 0.12, 'triangle', 0.16);
      this.tone(659, 0.12, 'triangle', 0.16, null, 0.11);
      this.tone(784, 0.22, 'triangle', 0.18, null, 0.22);
    },

    fail() {
      this.tone(220, 0.35, 'sawtooth', 0.14, 110);
    },

    missionComplete() {
      this.playSeq([523, 659, 784, 1046, 784, 1046], 0.13, 'triangle', 0.18);
      this.cash();
    },

    punch() {
      this.noise(0.12, 500, 0.35, 'lowpass');
      this.tone(130, 0.12, 'sine', 0.3, 70);
    },

    gunshot() {
      this.noise(0.16, 2400, 0.5, 'highpass');
      this.tone(320, 0.14, 'square', 0.2, 60);
    },

    crash() {
      this.noise(0.32, 320, 0.5, 'lowpass');
      this.tone(72, 0.3, 'sine', 0.32, 40);
    },

    // Continuous engine hum. level 0..1 is |speed| / topSpeed; a disabled
    // car sputters at a low idle instead of going silent.
    setEngine(level, disabled = false) {
      if (!this.ctx || !this.master) return;
      try {
        if (!this.engineOsc) {
          this.engineOsc = this.ctx.createOscillator();
          this.engineOsc.type = 'sawtooth';
          this.engineFilter = this.ctx.createBiquadFilter();
          this.engineFilter.type = 'lowpass';
          this.engineFilter.frequency.value = 420;
          this.engineGain = this.ctx.createGain();
          this.engineGain.gain.value = 0;
          this.engineOsc.connect(this.engineFilter);
          this.engineFilter.connect(this.engineGain);
          this.engineGain.connect(this.master);
          this.engineOsc.start();
        }
        const t = this.ctx.currentTime;
        if (disabled) {
          this.engineOsc.frequency.setTargetAtTime(34 + Math.random() * 8, t, 0.1);
          this.engineGain.gain.setTargetAtTime(0.025, t, 0.1);
        } else if (level <= 0.01) {
          this.engineGain.gain.setTargetAtTime(0, t, 0.15);
        } else {
          this.engineOsc.frequency.setTargetAtTime(52 + level * 95, t, 0.08);
          this.engineGain.gain.setTargetAtTime(0.02 + level * 0.075, t, 0.08);
        }
      } catch { /* ignore */ }
    },

    // Two-tone police siren (triangle wave wobbled by a slow LFO).
    setSiren(on) {
      if (!this.ctx || !this.master) return;
      try {
        if (!this.sirenOsc) {
          this.sirenOsc = this.ctx.createOscillator();
          this.sirenOsc.type = 'triangle';
          this.sirenOsc.frequency.value = 740;
          this.sirenLfo = this.ctx.createOscillator();
          this.sirenLfo.type = 'sine';
          this.sirenLfo.frequency.value = 0.7;
          const lfoGain = this.ctx.createGain();
          lfoGain.gain.value = 170;
          this.sirenLfo.connect(lfoGain);
          lfoGain.connect(this.sirenOsc.frequency);
          this.sirenGain = this.ctx.createGain();
          this.sirenGain.gain.value = 0;
          this.sirenOsc.connect(this.sirenGain);
          this.sirenGain.connect(this.master);
          this.sirenOsc.start();
          this.sirenLfo.start();
        }
        this.sirenGain.gain.setTargetAtTime(on ? 0.05 : 0, this.ctx.currentTime, 0.15);
      } catch { /* ignore */ }
    },

    // One step of the background loop: a bass note plus a sparse lead.
    musicTick() {
      if (!this.ctx) return;
      const i = this.musicStep % MUSIC_BASS.length;
      const bass = MUSIC_BASS[i];
      const lead = MUSIC_LEAD[i];
      if (bass) this.tone(bass, 0.22, 'triangle', 0.1);
      if (lead) this.tone(lead, 0.2, 'sine', 0.05);
      this.musicStep++;
    },

    startMusic() {
      if (this.musicTimer || !this.ctx) return;
      this.musicTimer = setInterval(() => this.musicTick(), 240);
    },

    // Schedule a short melody: notes are frequencies (0 = rest).
    playSeq(notes, stepDur = 0.22, type = 'triangle', vol = 0.15) {
      if (!this.ctx) return;
      notes.forEach((freq, i) => {
        if (freq) this.tone(freq, stepDur * 0.95, type, vol, null, i * stepDur);
      });
    },
  };

  return audio;
}

export default createAudio;
