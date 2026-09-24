<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronRight, Clock, Droplet, Droplets, Info, StickyNote, TriangleAlert, X } from 'lucide-vue-next'
import { formatClock, formatDayLabel, formatShortDate, formatSpan } from '@/core/time'
import { useDiaperStore } from '../store'
import { useDiaperActions } from '../useDiaperActions'
import DiaperEditSheet from '../components/DiaperEditSheet.vue'
import DiaperWeekStrip from '../components/DiaperWeekStrip.vue'
import StoolPicker from '../components/StoolPicker.vue'
import { isDirty, isWarnStool, KIND_LABEL, STOOL_COLORS, stoolLabel, type DiaperEntry, type DiaperKind, type StoolColor } from '../logic/types'

const store = useDiaperStore()
const { logDiaper, saveDiaper, removeDiaper } = useDiaperActions()
void store.ensureLoaded()

const stats = computed(() => store.stats)
const recent = computed(() => [...store.diapers].reverse().slice(0, 5))
const ago = (at: number) => `${formatSpan(store.now - at)} ago`

/** Right after a dirty diaper, offer the colour inline instead of opening the sheet. */
const justLogged = ref<DiaperEntry | null>(null)
const justStool = ref<StoolColor | undefined>()

async function quickLog(kind: DiaperKind) {
  const entry = await logDiaper({ at: Date.now(), kind })
  justLogged.value = isDirty(entry) ? entry : null
  justStool.value = undefined
}

async function pickStool(stool: StoolColor | undefined) {
  justStool.value = stool
  const entry = justLogged.value && store.diapers.find((e) => e.id === justLogged.value!.id)
  if (!entry || !stool) return
  justLogged.value = await saveDiaper({ ...entry, stool })
}

const sheetOpen = ref(false)
const editing = ref<DiaperEntry | null>(null)
function openAdd() {
  editing.value = null
  sheetOpen.value = true
}
function edit(e: DiaperEntry) {
  editing.value = e
  sheetOpen.value = true
}

const swatch = (stool: StoolColor) => STOOL_COLORS.find((c) => c.value === stool)?.swatch
</script>

<template>
  <div class="page stack">
    <div class="facts">
      <div class="fact">
        <span class="k">Wet today</span>
        <strong class="num">{{ stats.today.wet }}</strong>
        <span class="h">{{ store.expected ? `typical ${store.expected.wet}+` : `${stats.last24h.wet} in 24h` }}</span>
      </div>
      <div class="fact">
        <span class="k">Dirty today</span>
        <strong class="num">{{ stats.today.dirty }}</strong>
        <span class="h">{{ store.expected?.dirty ? `typical ${store.expected.dirty}+` : `${stats.last24h.dirty} in 24h` }}</span>
      </div>
      <div class="fact">
        <span class="k">Last change</span>
        <strong class="num">{{ stats.latest ? formatSpan(store.now - stats.latest.at) : '—' }}</strong>
        <span class="h">{{ stats.latest ? `ago · ${stats.latest.kind}` : 'none yet' }}</span>
      </div>
    </div>

    <div v-if="stats.warnStool" class="callout warn">
      <TriangleAlert :size="20" />
      <div>
        <strong>{{ stoolLabel(stats.warnStool.stool!) }} stool</strong> logged {{ formatDayLabel(stats.warnStool.at).toLowerCase() }}.
        Pale, white or bloody stools should be checked by your paediatrician soon — keep the diaper or a photo.
      </div>
    </div>

    <div class="log">
      <button class="btn primary lg" @click="quickLog('wet')"><Droplet :size="20" /> Wet</button>
      <button class="btn primary lg" @click="quickLog('dirty')"><span class="poo" aria-hidden="true" /> Dirty</button>
      <button class="btn primary lg" @click="quickLog('both')"><Droplets :size="20" /> Both</button>
    </div>

    <section v-if="justLogged" class="card stack colour">
      <div class="row">
        <strong class="small">Colour of this stool?</strong>
        <span class="spacer" />
        <button class="btn sm ghost icon-only" aria-label="Skip" @click="justLogged = null"><X :size="16" /></button>
      </div>
      <StoolPicker :model-value="justStool" @update:model-value="pickStool" />
      <p v-if="isWarnStool(justStool)" class="small warn-text">
        Please show this to your paediatrician soon — take a photo of the diaper.
      </p>
    </section>

    <button class="btn ghost block" @click="openAdd"><Clock :size="18" /> Earlier or with details…</button>

    <section class="card">
      <h2 class="card-title">Last 7 days</h2>
      <DiaperWeekStrip :days="stats.days" :expected="store.expected" />
    </section>

    <div v-if="store.expected" class="callout info">
      <Info :size="20" />
      <div>
        A common guide for breastfed newborns: about <strong>{{ store.expected.wet }}+ wet</strong>{{ ' ' }}
        <template v-if="store.expected.dirty">and <strong>{{ store.expected.dirty }}+ dirty</strong></template> diapers a
        day at this age<template v-if="!store.expected.dirty">; from about six weeks, days without a stool can be normal</template>.
        Your midwife or paediatrician knows what is right for your baby.
      </div>
    </div>

    <template v-if="recent.length">
      <div class="row" style="margin-top: 8px">
        <h2 class="section-title" style="margin: 0 6px">Recent</h2>
        <span class="spacer" />
        <RouterLink to="/app/diaper/history" class="btn sm ghost">History <ChevronRight :size="16" /></RouterLink>
      </div>
      <div class="list">
        <button v-for="e in recent" :key="e.id" class="list-item" title="Edit diaper" @click="edit(e)">
          <div class="grow">
            <strong>{{ KIND_LABEL[e.kind] }}</strong>
            <span class="muted small num"> · {{ formatClock(e.at) }} · {{ ago(e.at) }}</span>
            <p v-if="e.note" class="tiny faint note"><StickyNote :size="11" /> {{ e.note }}</p>
          </div>
          <span v-if="e.stool" class="chip" :class="{ warn: isWarnStool(e.stool) }">
            <i class="swatch" :style="{ background: swatch(e.stool) }" /> {{ stoolLabel(e.stool) }}
          </span>
        </button>
      </div>
      <p v-if="stats.lastDirty && stats.latest?.id !== stats.lastDirty.id" class="tiny faint hint">
        Last dirty diaper {{ formatDayLabel(stats.lastDirty.at).toLowerCase() }}, {{ formatShortDate(stats.lastDirty.at) }}
        {{ formatClock(stats.lastDirty.at) }}
      </p>
    </template>
  </div>

  <DiaperEditSheet v-model="sheetOpen" :entry="editing" @add="logDiaper" @save="saveDiaper" @delete="removeDiaper" />
</template>

<style scoped>
.facts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.fact {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 14px 12px;
  border-radius: 18px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.fact .k,
.fact .h {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-2);
}

.fact .h {
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fact strong {
  font-size: 18px;
  font-weight: 900;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.log {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.log .btn {
  flex-direction: column;
  gap: 4px;
  min-height: 76px;
  padding: 10px 6px;
}

/* A plain dot reads as "dirty" without a cartoon icon. */
.poo {
  width: 18px;
  height: 18px;
  border-radius: 50% 50% 45% 45%;
  background: currentColor;
  opacity: 0.85;
}

.colour {
  gap: 10px;
}

.card-title {
  font-size: 15px;
  font-weight: 850;
  margin-bottom: 14px;
}

.swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--text) 18%, transparent);
}

.note {
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hint {
  text-align: center;
}

.warn-text {
  color: var(--warn);
  font-weight: 700;
}
</style>
