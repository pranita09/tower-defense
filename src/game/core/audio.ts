// Sound effects synthesized as short oscillator bursts, so no audio files ship.
// The context opens on the first gesture because browsers require one, and sounds
// are rate limited so a hundred simultaneous events cannot spawn a hundred
// oscillators.

type Voice = 'square' | 'sine' | 'triangle' | 'sawtooth';

interface ToneOptions {
  frequency: number;
  // Sweep target; defaults to no sweep.
  endFrequency?: number;
  duration: number;
  voice?: Voice;
  gain?: number;
}

const MIN_INTERVAL_MS = 45;

export class AudioKit {
  muted: boolean;

  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastPlayedAt = 0;

  constructor(muted = false) {
    this.muted = muted;
  }

  // Safe to call repeatedly; only the first gesture actually opens the device.
  unlock(): void {
    if (this.context) {
      if (this.context.state === 'suspended') void this.context.resume();
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    this.context = new Ctor();
    this.master = this.context.createGain();
    this.master.gain.value = 0.22;
    this.master.connect(this.context.destination);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  place(): void {
    this.tone({ frequency: 320, endFrequency: 520, duration: 0.1, voice: 'triangle' });
  }

  upgrade(): void {
    this.tone({ frequency: 480, endFrequency: 880, duration: 0.16, voice: 'triangle' });
  }

  sell(): void {
    this.tone({ frequency: 520, endFrequency: 220, duration: 0.14, voice: 'triangle' });
  }

  denied(): void {
    this.tone({ frequency: 150, duration: 0.09, voice: 'square', gain: 0.5 });
  }

  waveStart(): void {
    this.tone({ frequency: 220, endFrequency: 440, duration: 0.26, voice: 'sawtooth', gain: 0.7 });
  }

  leak(): void {
    this.tone({ frequency: 190, endFrequency: 70, duration: 0.3, voice: 'square', gain: 0.8 });
  }

  victory(): void {
    this.arpeggio([523, 659, 784, 1047], 0.13);
  }

  defeat(): void {
    this.arpeggio([392, 311, 233, 155], 0.2, 'sawtooth');
  }

  private arpeggio(notes: readonly number[], step: number, voice: Voice = 'triangle'): void {
    notes.forEach((frequency, index) => {
      window.setTimeout(
        () => this.tone({ frequency, duration: step * 1.4, voice, gain: 0.6 }, true),
        index * step * 1000
      );
    });
  }

  private tone(options: ToneOptions, ignoreRateLimit = false): void {
    if (this.muted) return;
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;

    const now = performance.now();
    if (!ignoreRateLimit && now - this.lastPlayedAt < MIN_INTERVAL_MS) return;
    this.lastPlayedAt = now;

    const start = context.currentTime;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();

    oscillator.type = options.voice ?? 'sine';
    oscillator.frequency.setValueAtTime(options.frequency, start);
    if (options.endFrequency !== undefined) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(20, options.endFrequency),
        start + options.duration
      );
    }

    // A quick attack and exponential decay, so nothing clicks on release.
    const peak = options.gain ?? 1;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + options.duration);

    oscillator.connect(envelope);
    envelope.connect(master);
    oscillator.start(start);
    oscillator.stop(start + options.duration + 0.02);
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
    this.master = null;
  }
}
