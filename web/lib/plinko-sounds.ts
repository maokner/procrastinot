// Web Audio synth for Plinko — no asset files. Browsers require a user
// gesture before AudioContext can play, so we lazy-init on first use.

const MUTE_KEY = 'plinko:muted';

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let muted = false;

function readMuted(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(MUTE_KEY) === '1';
}

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.35;
    masterGain.connect(ctx.destination);
    muted = readMuted();
  }
  // Browsers may suspend the context until a user gesture; resume best-effort.
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function isMuted(): boolean {
  if (typeof window === 'undefined') return false;
  return readMuted();
}

export function setMuted(next: boolean) {
  muted = next;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  }
}

export function toggleMuted(): boolean {
  const next = !isMuted();
  setMuted(next);
  return next;
}

// ── Effects ────────────────────────────────────────────────────────────

// Tonal "plink" — sine blip with random pitch per hit, short attack,
// exponential decay. Gives the marble-on-xylophone feel from pylinko
// without the brashness of a noise click.
const PLINK_NOTES = [523, 587, 659, 698, 784, 880, 988, 1047]; // C5..C6 pentatonic-ish

export function playPegHit() {
  if (muted || readMuted()) return;
  const ac = ensureCtx();
  if (!ac || !masterGain) return;

  const now = ac.currentTime;
  const freq = PLINK_NOTES[Math.floor(Math.random() * PLINK_NOTES.length)];
  const dur = 0.09;

  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, now);
  // Tiny downward pitch bend on each hit — gives it a "bonk" shape.
  osc.frequency.exponentialRampToValueAtTime(freq * 0.88, now + dur);

  const g = ac.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(0.08, now + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0005, now + dur);

  // Low-pass a bit for warmth.
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3000;

  osc.connect(lp).connect(g).connect(masterGain);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

// Tier-based bucket landing. Higher multipliers = brighter, fuller chord.
export function playBucketLand(multiplier: number) {
  if (muted || readMuted()) return;
  const ac = ensureCtx();
  if (!ac || !masterGain) return;

  let frequencies: number[];
  let dur = 0.45;
  let vol = 0.12;

  if (multiplier >= 50) {
    frequencies = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    dur = 0.75;
    vol = 0.22;
  } else if (multiplier >= 8) {
    frequencies = [440, 554.37, 659.25]; // A4 C#5 E5
    dur = 0.6;
    vol = 0.18;
  } else if (multiplier >= 2) {
    frequencies = [392, 493.88]; // G4 B4
    dur = 0.5;
    vol = 0.15;
  } else if (multiplier >= 1) {
    frequencies = [349.23]; // F4
    dur = 0.4;
    vol = 0.13;
  } else if (multiplier >= 0.5) {
    frequencies = [261.63]; // C4
    dur = 0.4;
    vol = 0.12;
  } else {
    frequencies = [196, 174.61]; // G3 → F3
    dur = 0.5;
    vol = 0.12;
  }

  const now = ac.currentTime;
  // Warm low-pass to remove harshness.
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2200;
  lp.connect(masterGain);

  for (let i = 0; i < frequencies.length; i++) {
    const f = frequencies[i];
    const offset = i * 0.05; // gentler strum
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, now + offset);
    g.gain.linearRampToValueAtTime(vol, now + offset + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0005, now + offset + dur);
    osc.connect(g).connect(lp);
    osc.start(now + offset);
    osc.stop(now + offset + dur + 0.05);
  }
}
