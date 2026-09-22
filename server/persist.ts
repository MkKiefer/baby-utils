import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { State, SyncStore } from './store.ts'

/**
 * Keeps the relay's buffer across restarts in one JSON file. Writes are debounced and
 * atomic (temp file + rename), so a crash leaves either the old or the new state.
 * Everything in it is ciphertext or random ids.
 */
export function loadState(dir: string): State | undefined {
  try {
    const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as State
    return state?.v === 1 && typeof state.groups === 'object' ? state : undefined
  } catch {
    return undefined
  }
}

export function persist(store: SyncStore, dir: string, delayMs = 1000): { flush: () => void } {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'state.json')
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    writeFileSync(`${file}.tmp`, JSON.stringify(store.state))
    renameSync(`${file}.tmp`, file)
  }

  store.onChange = () => {
    timer ??= setTimeout(flush, delayMs)
  }
  return { flush }
}
