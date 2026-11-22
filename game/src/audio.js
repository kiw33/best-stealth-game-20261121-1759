// Emberlight — every sound is synthesized with WebAudio, so the game ships
// no audio files at all. A tiny helper builds short tones and noise bursts;
// the game calls the named sounds, which also keep their own cooldowns so a
// busy frame never stacks the same sound on itself.
export function createAudio() {
  let context = null;
  let master = null;
  let pad = null;
  const lastPlayed = new Map();

  function ensure() {
    if (context) return true;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = 0.5;
      master.connect(context.destination);
    } catch {
      return false;
    }
    return true;
  }

  function ready(kind, minGap) {
    const now = context.currentTime;
    if (now - (lastPlayed.get(kind) ?? -99) < minGap) return false;
    lastPlayed.set(kind, now);
    return true;
  }

  function tone(freq, dur, type, vol, slideTo, when = 0) {
    const t0 = context.currentTime + when;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function thump(vol, lowpass) {
    const t0 = context.currentTime;
    const length = Math.floor(context.sampleRate * 0.09);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpass;
    const gain = context.createGain();
    gain.gain.value = vol;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(t0);
  }

  return {
    /** Call from the first user gesture: browsers only let audio start then. */
    unlock() {
      if (!ensure()) return;
      if (context.state === 'suspended') context.resume().catch(() => {});
      if (pad) return;
      // A quiet night pad: two detuned sines an octave apart, barely there.
      const gain = context.createGain();
      gain.gain.value = 0.035;
      gain.connect(master);
      for (const freq of [110, 164.8]) {
        const osc = context.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(gain);
        osc.start();
      }
      pad = gain;
    },
    footstep(sneak, distance) {
      if (!ensure() || !ready('step', sneak ? 0.34 : 0.26)) return;
      const vol = Math.max(0.02, 0.16 * (1 - distance / 700));
      thump(sneak ? vol * 0.4 : vol, sneak ? 300 : 700);
    },
    guardStep(distance) {
      if (!ensure() || !ready('guard', 0.3)) return;
      const vol = Math.max(0, 0.2 * (1 - distance / 520));
      if (vol <= 0.01) return;
      thump(vol, 420);
    },
    pickup() {
      if (!ensure() || !ready('pickup', 0.1)) return;
      tone(660, 0.16, 'sine', 0.22);
      tone(990, 0.24, 'sine', 0.18, null, 0.07);
    },
    suspicious() {
      if (!ensure() || !ready('susp', 0.8)) return;
      tone(220, 0.3, 'triangle', 0.2, 330);
    },
    alarm() {
      if (!ensure() || !ready('alarm', 0.8)) return;
      tone(392, 0.18, 'square', 0.12, 523);
      tone(523, 0.22, 'square', 0.12, 392, 0.16);
    },
    caught() {
      if (!ensure() || !ready('caught', 0.5)) return;
      tone(196, 0.5, 'sawtooth', 0.16, 98);
      tone(147, 0.6, 'sawtooth', 0.12, 73, 0.1);
    },
    levelClear() {
      if (!ensure() || !ready('clear', 0.5)) return;
      [523, 659, 784, 1047].forEach((freq, i) => tone(freq, 0.3, 'sine', 0.18, null, i * 0.09));
    },
    win() {
      if (!ensure() || !ready('win', 0.5)) return;
      [523, 659, 784, 1047, 1319].forEach((freq, i) => tone(freq, 0.42, 'triangle', 0.16, null, i * 0.11));
    },
    denied() {
      if (!ensure() || !ready('denied', 0.3)) return;
      tone(160, 0.16, 'square', 0.1, 120);
    },
  };
}
