<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, Pill } from 'lucide-vue-next'
import { formatClock, MINUTE } from '@/core/time'
import { dueWithFeed } from '../logic/schedule'
import { MEDS_ACCENT } from '../logic/types'
import { useMedsStore } from '../store'
import { useMedsActions } from '../useMedsActions'

/**
 * Shown in the Feed timer: medication marked "with a feed" that is due with the coming
 * feed, with a one-tap "Given". Hidden when nothing is due.
 */
const props = defineProps<{
  /** Next feed's due time; null when no feed is planned yet. */
  feedDueAt: number | null
  intervalMin: number
  /** Dim amber styling for night mode. */
  night?: boolean
}>()

const store = useMedsStore()
const { logDose } = useMedsActions()
void store.ensureLoaded()

const items = computed(() =>
  dueWithFeed(
    store.plans,
    store.doses,
    store.now,
    props.feedDueAt === null ? null : { dueAt: props.feedDueAt, intervalMs: props.intervalMin * MINUTE },
  ).map(({ plan, today }) => {
    const n = today.next!
    const slot = today.slots.findIndex((s) => !s.dose && !s.missed) + 1
    const count = today.expected > 1 && slot > 0 ? `dose ${slot} of ${today.expected}` : ''
    const when = n.approx ? '' : n.overdue ? `overdue since ${formatClock(n.at)}` : `due ${formatClock(n.at)}`
    return { plan, hint: [when, count].filter(Boolean).join(' · ') }
  }),
)

const busy = ref<string | null>(null)
async function give(planId: string) {
  if (busy.value) return
  busy.value = planId
  try {
    await logDose({ planId, at: Date.now() })
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <section v-if="items.length" class="with-feed" :class="{ night }" :style="{ '--med': MEDS_ACCENT }" aria-label="Medication with this feed">
    <p class="title"><Pill :size="16" aria-hidden="true" /> Give with this feed</p>
    <div v-for="{ plan, hint } in items" :key="plan.id" class="item">
      <div class="grow">
        <strong>{{ plan.name }}</strong><span v-if="plan.dose" class="dose"> · {{ plan.dose }}</span>
        <span v-if="hint" class="hint">{{ hint }}</span>
      </div>
      <button type="button" class="give" :disabled="busy === plan.id" @click="give(plan.id)">
        <Check :size="16" /> Given
      </button>
    </div>
  </section>
</template>

<style scoped>
.with-feed {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 18px;
  background: color-mix(in oklab, var(--med) 12%, var(--surface));
  box-shadow: inset 0 0 0 1.5px color-mix(in oklab, var(--med) 45%, transparent), var(--shadow-sm);
}

.title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--med);
}

.item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.grow {
  flex: 1;
  min-width: 0;
}

.item strong {
  font-weight: 900;
}

.dose {
  font-weight: 700;
  color: var(--text-2);
}

.hint {
  display: block;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-3);
}

.give {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 38px;
  padding: 0 14px;
  border-radius: 999px;
  font-weight: 800;
  color: #fff;
  background: var(--med);
}

.give:disabled {
  opacity: 0.6;
}

/* Night mode: black background, amber text, nothing bright. */
.with-feed.night {
  background: transparent;
  box-shadow: inset 0 0 0 1.5px var(--amber-dim, rgba(217, 119, 63, 0.55));
  color: var(--amber, #d9773f);
}

.night .title,
.night .dose,
.night .hint {
  color: var(--amber-dim, rgba(217, 119, 63, 0.55));
}

.night .give {
  color: #000;
  background: var(--amber-dim, rgba(217, 119, 63, 0.55));
}
</style>
