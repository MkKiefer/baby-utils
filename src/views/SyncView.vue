<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { Copy, Lock, RefreshCw, Share2, UserPlus, Users } from 'lucide-vue-next'
import AppBar from '@/components/AppBar.vue'
import QrCode from '@/components/QrCode.vue'
import ToggleSwitch from '@/components/ToggleSwitch.vue'
import ConfirmButton from '@/components/ConfirmButton.vue'
import { inviteFor, parseInvite } from '@/core/cloud/crypto'
import {
  cloud,
  createGroup,
  defaultDeviceLabel,
  joinGroup,
  leaveGroup,
  setEnabled,
  setLabel,
  syncNow,
} from '@/core/cloud/service'
import { cameraSupported, startScanner } from '@/core/scanner'
import { formatDateTime } from '@/core/time'
import { toast } from '@/composables/useToast'

/**
 * Optional sync through the relay. The phones share a secret group code in person (QR) —
 * the relay only ever sees a derived group id and ciphertext.
 */

type Step = 'intro' | 'join'
const step = ref<Step>('intro')
const label = ref(cloud.config?.label ?? defaultDeviceLabel())
const busy = ref(false)

const enabled = computed({
  get: () => cloud.config?.enabled ?? false,
  set: (v: boolean) => setEnabled(v),
})

async function run(fn: () => Promise<void>, ok: string) {
  busy.value = true
  try {
    await fn()
    if (cloud.state.lastError) toast(cloud.state.lastError, { tone: 'warn' })
    else toast(ok, { tone: 'ok' })
  } finally {
    busy.value = false
  }
}

function create() {
  void run(() => createGroup(label.value), 'Sync group created')
}

// ------------------------------------------------------------------ join
const pasted = ref('')
const joinError = ref('')
const video = ref<HTMLVideoElement>()
let stopCamera: (() => void) | null = null

async function openJoin() {
  step.value = 'join'
  joinError.value = ''
  pasted.value = ''
  if (!cameraSupported) return
  await nextTick()
  if (!video.value) return
  try {
    stopCamera = await startScanner(video.value, (text) => {
      const secret = parseInvite(text)
      if (secret) void join(secret)
    })
  } catch (e) {
    joinError.value = (e as Error).message
  }
}

function stopScan() {
  stopCamera?.()
  stopCamera = null
}

async function join(secret: string) {
  if (busy.value) return
  stopScan()
  if ('vibrate' in navigator) navigator.vibrate(30)
  await run(() => joinGroup(secret, label.value), 'Joined — syncing')
  step.value = 'intro'
}

function joinPasted() {
  const secret = parseInvite(pasted.value)
  if (!secret) return void (joinError.value = 'That is not a sync code.')
  void join(secret)
}

function cancelJoin() {
  stopScan()
  step.value = 'intro'
}

onBeforeUnmount(stopScan)

// ------------------------------------------------------------------ joined
const showInvite = ref(false)
const invite = computed(() => (cloud.config ? inviteFor(cloud.config.secret) : ''))

async function copyInvite() {
  try {
    await navigator.clipboard.writeText(invite.value)
    toast('Code copied', { tone: 'ok' })
  } catch {
    toast('Copying is not allowed here', { tone: 'warn' })
  }
}

async function shareInvite() {
  try {
    await navigator.share({ text: invite.value })
  } catch {
    // Cancelled.
  }
}

const members = computed(() =>
  cloud.state.members.map((id) => ({ id, label: cloud.state.labels[id] ?? 'Waiting for its first sync…' })),
)

function saveLabel() {
  setLabel(label.value)
}

async function leave() {
  await leaveGroup()
  showInvite.value = false
  toast('Left the sync group', { tone: 'ok' })
}
</script>

<template>
  <div>
    <!-- Single root required: App.vue's <Transition mode="out-in"> can't leave a multi-root view (blank screen). -->
    <AppBar title="Sync" back="/settings" />
    <div class="page stack">
      <!-- ---------------------------------------------------------------- not set up -->
      <template v-if="!cloud.config && step === 'intro'">
        <div class="callout info">
          <Lock :size="20" />
          <p>
            Keep feeds and weighings in sync between your phones, automatically. Everything is <strong>encrypted on the phone</strong>
            with a key only your phones share — the sync server just passes sealed messages along and cannot read them.
            Settings stay on each phone.
          </p>
        </div>

        <label class="field">
          <span>Name of this phone</span>
          <input v-model="label" class="input" type="text" maxlength="40" />
        </label>

        <button class="btn primary block lg" :disabled="busy" @click="create"><Users :size="22" /> Start a sync group</button>
        <button class="btn block lg" :disabled="busy" @click="openJoin"><UserPlus :size="22" /> Join the other phone’s group</button>
        <p class="tiny faint hint">Start the group on one phone, then join it from the other by scanning its code.</p>
      </template>

      <!-- ---------------------------------------------------------------- join -->
      <template v-else-if="!cloud.config && step === 'join'">
        <template v-if="cameraSupported">
          <p class="small muted center">On the other phone open Sync → <b>Invite a phone</b>, then scan its code.</p>
          <div class="viewfinder">
            <video ref="video" playsinline muted />
            <div class="frame" />
          </div>
        </template>
        <label class="field">
          <span>…or paste the code</span>
          <textarea v-model="pasted" class="input" rows="2" autocomplete="off" spellcheck="false" />
        </label>
        <div v-if="joinError" class="callout warn">
          <p>{{ joinError }}</p>
        </div>
        <button class="btn primary block" :disabled="busy || !pasted.trim()" @click="joinPasted">Join</button>
        <button class="btn ghost block" @click="cancelJoin">Cancel</button>
      </template>

      <!-- ---------------------------------------------------------------- joined -->
      <template v-else-if="cloud.config">
        <div class="list">
          <div class="list-item">
            <div class="grow">
              <strong>Sync</strong>
              <p class="small muted">
                <template v-if="!cloud.config.enabled">Paused — nothing is sent or received.</template>
                <template v-else-if="cloud.syncing">Syncing…</template>
                <template v-else-if="cloud.state.lastError">{{ cloud.state.lastError }}</template>
                <template v-else-if="cloud.state.lastSyncAt">Last synced {{ formatDateTime(cloud.state.lastSyncAt) }}</template>
                <template v-else>Not synced yet</template>
              </p>
            </div>
            <ToggleSwitch v-model="enabled" label="Sync enabled" />
          </div>
          <button class="list-item" :disabled="!cloud.config.enabled || cloud.syncing" @click="run(syncNow, 'Synced')">
            <RefreshCw :size="20" :class="{ spin: cloud.syncing }" />
            <span class="grow"><strong>Sync now</strong></span>
          </button>
        </div>

        <h2 class="section-title">Phones in this group</h2>
        <div class="list">
          <div class="list-item">
            <span class="grow"><strong>{{ cloud.config.label }}</strong> <span class="small muted">(this phone)</span></span>
          </div>
          <div v-for="m in members" :key="m.id" class="list-item">
            <span class="grow">{{ m.label }}</span>
          </div>
          <p v-if="!members.length" class="list-item small muted">No other phone yet — invite one below.</p>
        </div>

        <button class="btn block lg" @click="showInvite = !showInvite"><UserPlus :size="22" /> Invite a phone</button>
        <template v-if="showInvite">
          <p class="small muted center">On the other phone open Settings → Sync → <b>Join</b> and scan this code.</p>
          <div class="card qr-card"><QrCode :value="invite" /></div>
          <div class="callout warn">
            <p>
              This code is the key to your data. Anyone who has it can join and read your data. Scan it in person; if you
              have to send it, use a private chat and delete the message afterwards.
            </p>
          </div>
          <div class="two">
            <button class="btn" @click="copyInvite"><Copy :size="18" /> Copy</button>
            <button class="btn" @click="shareInvite"><Share2 :size="18" /> Share</button>
          </div>
        </template>

        <h2 class="section-title">This phone</h2>
        <label class="field">
          <span>Name shown to the other phones</span>
          <input v-model="label" class="input" type="text" maxlength="40" @change="saveLabel" />
        </label>

        <div class="callout info">
          <Lock :size="20" />
          <p class="small">
            End-to-end encrypted (AES-256-GCM). The server only sees a random group id and sealed messages, and deletes
            each message once every phone has it. To remove a phone, leave the group on all phones and start a new one.
          </p>
        </div>
        <ConfirmButton label="Leave sync group" confirm-label="Tap again to leave" class="block" @confirm="leave" />
        <p class="tiny faint hint">Your data stays on this phone when you leave.</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.center {
  text-align: center;
}

.hint {
  padding: 0 6px;
}

.two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.qr-card {
  padding: 12px;
  background: #fff;
  max-width: 320px;
  width: 100%;
  margin: 0 auto;
}

.viewfinder {
  position: relative;
  width: 100%;
  max-width: 420px;
  margin: 0 auto;
  aspect-ratio: 1;
  border-radius: var(--radius);
  overflow: hidden;
  background: #000;
}

.viewfinder video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.viewfinder .frame {
  position: absolute;
  inset: 12%;
  border: 3px solid rgba(255, 255, 255, 0.85);
  border-radius: 18px;
  pointer-events: none;
}

textarea.input {
  resize: none;
  font-family: ui-monospace, monospace;
  font-size: 13px;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
