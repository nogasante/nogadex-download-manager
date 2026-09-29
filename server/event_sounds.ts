/**
 * Event-sounds subsystem (Sounds settings tab).
 *
 * Pure decision layer: maps engine/queue events to sound actions based on
 * persisted settings. Playback lives in Electron (main.cjs) — this module is
 * the single source of truth both the API layer and tests use.
 */

export type SoundEvent = 'downloadComplete' | 'downloadFailed' | 'queueStarted' | 'queueStopped';

export interface SoundEventConfig {
  enabled: boolean;
  /** Absolute path to a .wav/.mp3 file, or '' for the built-in system sound. */
  file: string;
}

export interface SoundSettings {
  downloadComplete: SoundEventConfig;
  downloadFailed: SoundEventConfig;
  queueStarted: SoundEventConfig;
  queueStopped: SoundEventConfig;
}

export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  downloadComplete: { enabled: true, file: '' },
  downloadFailed: { enabled: true, file: '' },
  queueStarted: { enabled: false, file: '' },
  queueStopped: { enabled: false, file: '' },
};

/** Validate/normalize one event config from untrusted settings payloads. */
export function normalizeSoundConfig(input: unknown): SoundEventConfig {
  const cfg = (input && typeof input === 'object' ? input : {}) as Partial<SoundEventConfig>;
  return {
    enabled: Boolean(cfg.enabled),
    file: typeof cfg.file === 'string' ? cfg.file : '',
  };
}

export function normalizeSoundSettings(input: unknown): SoundSettings {
  const s = (input && typeof input === 'object' ? input : {}) as Partial<SoundSettings>;
  return {
    downloadComplete: normalizeSoundConfig(s.downloadComplete),
    downloadFailed: normalizeSoundConfig(s.downloadFailed),
    queueStarted: normalizeSoundConfig(s.queueStarted),
    queueStopped: normalizeSoundConfig(s.queueStopped),
  };
}

export class SoundEventEngine {
  private settings: SoundSettings;

  constructor(settings?: Partial<SoundSettings>) {
    // No settings => pristine defaults (all four events as shipped). Only
    // normalize when actual config was provided — normalizing `undefined`
    // yields an all-muted set that would silently kill the defaults.
    this.settings = settings === undefined
      ? JSON.parse(JSON.stringify(DEFAULT_SOUND_SETTINGS))
      : { ...DEFAULT_SOUND_SETTINGS, ...normalizeSoundSettings(settings) };
  }

  public getSettings(): SoundSettings {
    return JSON.parse(JSON.stringify(this.settings));
  }

  public updateSettings(partial: Partial<SoundSettings>): SoundSettings {
    const normalized = normalizeSoundSettings({ ...this.settings, ...partial });
    this.settings = normalized;
    return this.getSettings();
  }

  /**
   * Resolve an event to a sound action, or null when the event is muted.
   * file === '' means "play the built-in system chime"; a path means
   * "play this file".
   */
  public resolve(event: SoundEvent): { file: string } | null {
    const cfg = this.settings[event];
    if (!cfg || !cfg.enabled) return null;
    return { file: cfg.file };
  }
}
