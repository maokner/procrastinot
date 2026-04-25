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

// Short noise burst with a fast exponential decay — a peg "tick".
export function playPegHit() {
  if (muted || readMuted()) return;
  const ac = ensureCtx();
  if (!ac || !masterGain) return;
  const dur = 0.05;
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / data.length;
    data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 18);
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0.35;
  // High-pass to make it sound like a click, not a thud.
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1400;
  src.connect(hp).connect(g).connect(masterGain);
  src.start();
  src.stop(ac.currentTime + dur);
}

// Tier-based bucket landing. Higher multipliers = brighter, fuller chord.
export function playBucketLand(multiplier: number) {
  if (muted || readMuted()) return;
  const ac = ensureCtx();
  if (!ac || !masterGain) return;

  let frequencies: number[];
  let dur = 0.35;
  let vol = 0.18;

  if (multiplier >= 50) {
    // Jackpot — major chord, longer
    frequencies = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    dur = 0.65;
    vol = 0.32;
  } else if (multiplier >= 8) {
    frequencies = [440, 554.37, 659.25]; // A4 C#5 E5
    dur = 0.5;
    vol = 0.26;
  } else if (multiplier >= 2) {
    frequencies = [392, 493.88]; // G4 B4
    dur = 0.4;
    vol = 0.22;
  } else if (multiplier >= 1) {
    frequencies = [349.23]; // F4
    dur = 0.3;
    vol = 0.18;
  } else if (multiplier >= 0.5) {
    frequencies = [261.63]; // C4 — flat
    dur = 0.3;
    vol = 0.16;
  } else {
    // Loss — low descending blip
    frequencies = [196, 174.61]; // G3 → F3
    dur = 0.4;
    vol = 0.18;
  }

  const now = ac.currentTime;
  for (let i = 0; i < frequencies.length; i++) {
    const f = frequencies[i];
    const offset = i * 0.04; // slight strum
    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = f;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, now + offset);
    g.gain.linearRampToValueAtTime(vol, now + offset + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, now + offset + dur);
    osc.connect(g).connect(masterGain);
    osc.start(now + offset);
    osc.stop(now + offset + dur + 0.05);
  }
}
