/**
 * System Audio Alert & Visual Attention Feedback
 * Plays the authentic Windows system attention sound on invalid interaction or modal background clicks.
 */

let audioCtx: AudioContext | null = null;

export function playSystemBeep(): void {
  // If running in native Electron, trigger the authentic OS Windows sound
  if ((window as any).electronAPI?.beep) {
    (window as any).electronAPI.beep();
    return;
  }

  // Fallback: Web Audio API synthesis of the classic Windows 440Hz alert chime
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    if (!audioCtx || audioCtx.state === 'closed') {
      audioCtx = new AudioContextClass();
    }

    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, audioCtx.currentTime); // Standard Windows alert frequency
    osc.frequency.exponentialRampToValueAtTime(320, audioCtx.currentTime + 0.12);

    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.16);
  } catch {}
}
