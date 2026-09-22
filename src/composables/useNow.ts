import { onScopeDispose, ref, type Ref } from 'vue'

/** One shared clock for the whole UI, ticking on second boundaries while in use. */
const now = ref(Date.now())
let users = 0
let timer: ReturnType<typeof setTimeout> | undefined

function tick() {
  now.value = Date.now()
  timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 5)
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => (now.value = Date.now()))
}

export function useNow(): Ref<number> {
  if (users++ === 0) tick()
  onScopeDispose(() => {
    if (--users === 0) clearTimeout(timer)
  })
  return now
}
