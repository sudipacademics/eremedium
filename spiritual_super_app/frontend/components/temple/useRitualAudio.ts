'use client';

import { useCallback, useRef } from 'react';

import type { RitualSound } from './templeCatalog';

/**
 * Procedural ritual sounds via Web Audio — no binary assets required.
 * Browsers require a user gesture before audio starts; first call resumes the context.
 */
export function useRitualAudio() {
  const ctxRef = useRef<AudioContext | null>(null);

  const ensureCtx = useCallback(() => {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!ctxRef.current) {
      ctxRef.current = new AudioCtx();
    }
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    return ctx;
  }, []);

  const tone = useCallback(
    (freq: number, duration: number, type: OscillatorType = 'sine', gain = 0.12) => {
      const ctx = ensureCtx();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.value = gain;
      const now = ctx.currentTime;
      g.gain.setValueAtTime(gain, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + duration);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + duration);
    },
    [ensureCtx],
  );

  const play = useCallback(
    (sound: RitualSound) => {
      switch (sound) {
        case 'ghanta':
          tone(880, 0.15, 'triangle', 0.14);
          setTimeout(() => tone(660, 0.35, 'triangle', 0.1), 80);
          setTimeout(() => tone(990, 0.5, 'sine', 0.06), 160);
          break;
        case 'conch':
          tone(220, 0.8, 'sawtooth', 0.05);
          setTimeout(() => tone(247, 0.6, 'sawtooth', 0.04), 100);
          break;
        case 'water':
          tone(400, 0.08, 'sine', 0.04);
          setTimeout(() => tone(320, 0.1, 'sine', 0.035), 60);
          setTimeout(() => tone(280, 0.12, 'sine', 0.03), 120);
          break;
        case 'chime':
          tone(523.25, 0.25, 'sine', 0.1);
          setTimeout(() => tone(659.25, 0.35, 'sine', 0.08), 90);
          break;
        case 'soft':
        default:
          tone(392, 0.3, 'sine', 0.06);
          break;
      }
    },
    [tone],
  );

  return { play };
}
