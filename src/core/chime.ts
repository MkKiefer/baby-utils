import { reactive } from 'vue'

/**
 * Soft synthesized chime (no audio files). Browsers only allow audio after a user gesture,
 * so `unlockAudio()` must be called from a tap handler (e.g. when entering night mode).
 */
export const audioState = reactive({ state: 'none' as AudioContextState | 'none', chimes: 0, lastAt: null as number | null })

let ctx: AudioContext | null = null

export function unlockAudio() {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return
  ctx ??= new Ctor()
  void ctx.resume().then(() => (audioState.state = ctx!.state))
  ctx.onstatechange = () => (audioState.state = ctx!.state)
  audioState.state = ctx.state
}

export function playChime(volume = 0.25) {
  if (!ctx || ctx.state !== 'running') return false
  const notes = [659.25, 880, 1046.5] // E5 A5 C6
  const start = ctx.currentTime + 0.05
  notes.forEach((freq, i) => {
    const osc = ctx!.createOscillator()
    const gain = ctx!.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    const t = start + i * 0.28
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(volume, t + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.4)
    osc.connect(gain).connect(ctx!.destination)
    osc.start(t)
    osc.stop(t + 1.5)
  })
  navigator.vibrate?.([200, 120, 200])
  audioState.chimes++
  audioState.lastAt = Date.now()
  return true
}
