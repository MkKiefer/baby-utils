<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { Copy, Eye, EyeOff, Lock, RefreshCw, Server, Share2, UserPlus, Users } from 'lucide-vue-next'
import AppBar from '@/components/AppBar.vue'
import QrCode from '@/components/QrCode.vue'
import ToggleSwitch from '@/components/ToggleSwitch.vue'
import ConfirmButton from '@/components/ConfirmButton.vue'
import { inviteFor, parseInvite, type Invite } from '@/core/cloud/crypto'
import {
  cloud,
  createGroup,
  defaultDeviceLabel,
  joinGroup,
  leaveGroup,
  ownServerUrl,
  setEnabled,
  setServer,
  setLabel,
  syncNow,
  testServer,
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

// ------------------------------------------------------------------ server
const serverUrl = ref(cloud.server.url || ownServerUrl())
const serverKey = ref(cloud.server.key)
const showKey = ref(false)
const serverOpen = ref(!cloud.server.key)
const serverStatus = ref<{ ok: boolean; text: string } | null>(null)
const serverReady = computed(() => !!cloud.server.key)
const serverDirty = computed(
  () => serverUrl.value.trim() !== (cloud.server.url || ownServerUrl()) || serverKey.value.trim() !== cloud.server.key,
)

async function checkServer() {
  busy.value = true
  try {
    const error = await testServer({ url: serverUrl.value, key: serverKey.value })
    serverStatus.value = error ? { ok: false, text: error } : { ok: true, text: 'Connected — the server accepts this secret.' }
  } finally {
    busy.value = false
  }
}

function saveServer() {
  try {
    setServer({ url: serverUrl.value, key: serverKey.value })
    serverUrl.value = cloud.server.url || ownServerUrl()
    serverStatus.value = null
    serverOpen.value = false
    toast('Sync server saved', { tone: 'ok' })
  } catch (e) {
    serverStatus.value = { ok: false, text: (e as Error).message }
  }
}

function resetServerUrl() {
  serverUrl.value = ownServerUrl()
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
      const invite = parseInvite(text)
      if (invite) void join(invite)
    })
  } catch (e) {
    joinError.value = (e as Error).message
  }
}

function stopScan() {
  stopCamera?.()
  stopCamera = null
}

async function join(invite: Invite) {
  if (busy.value) return
  if (!invite.server && !serverReady.value) {
    joinError.value = 'This code does not include a sync server. Enter the server secret above first.'
    return
  }
  stopScan()
  if ('vibrate' in navigator) navigator.vibrate(30)
  await run(() => joinGroup(invite, label.value), 'Joined — syncing')
  serverUrl.value = cloud.server.url || ownServerUrl()
  serverKey.value = cloud.server.key
  step.value = 'intro'
}

function joinPasted() {
  const invite = parseInvite(pasted.value)
  if (!invite) return void (joinError.value = 'That is not a sync code.')
  void join(invite)
}

function cancelJoin() {
  stopScan()
  step.value = 'intro'
}

onBeforeUnmount(stopScan)

// ------------------------------------------------------------------ joined
const showInvite = ref(false)
/** The invite carries this phone's server, so the other phone needs no setup. */
const invite = computed(() =>
  cloud.config ? inviteFor(cloud.config.secret, { url: cloud.server.url || ownServerUrl(), key: cloud.server.key }) : '',
)

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
      <!-- ---------------------------------------------------------------- server -->
      <div class="card stack server">
        <button class="server-head" :aria-expanded="serverOpen" @click="serverOpen = !serverOpen">
          <Server :size="20" />
          <span class="grow">
            <strong>Sync server</strong><br />
            <span class="small muted">
              {{ cloud.server.url || ownServerUrl() }} ·
              {{ serverReady ? 'secret set' : 'secret missing' }}
            </span>
          </span>
          <span class="small muted">{{ serverOpen ? 'Hide' : 'Edit' }}</span>
        </button>
        <template v-if="serverOpen">
          <label class="field">
            <span>Server address</span>
            <input v-model="serverUrl" class="input" type="url" inputmode="url" autocomplete="off" spellcheck="false" />
          </label>
          <button v-if="serverUrl.trim() !== ownServerUrl()" class="btn ghost sm" @click="resetServerUrl">
            Use this app’s address
          </button>
          <label class="field">
            <span>Server secret</span>
            <span class="secret">
              <input
                v-model="serverKey"
                class="input"
                :type="showKey ? 'text' : 'password'"
                autocomplete="off"
                spellcheck="false"
                placeholder="API_KEY from the server’s .env"
              />
              <button class="btn ghost sm" :aria-label="showKey ? 'Hide secret' : 'Show secret'" @click="showKey = !showKey">
                <EyeOff v-if="showKey" :size="18" /><Eye v-else :size="18" />
              </button>
            </span>
          </label>
          <div v-if="serverStatus" class="callout" :class="serverStatus.ok ? 'info' : 'warn'">
            <p class="small">{{ serverStatus.text }}</p>
          </div>
          <div class="two">
            <button class="btn" :disabled="busy || !serverKey.trim()" @click="checkServer">Test</button>
            <button class="btn primary" :disabled="busy || !serverDirty" @click="saveServer">Save</button>
          </div>
          <p class="tiny faint">
            The server only accepts apps that know its secret (<code>API_KEY</code> in the server’s <code>.env</code>). It
            is kept on this phone and included in invites.
          </p>
        </template>
      </div>

      <!-- ---------------------------------------------------------------- not set up -->
      <template v-if="!cloud.config && step === 'intro'">
        <div class="callout info">
          <Lock :size="20" />
          <p>
            Keep feeds, weighings, the baby's profile and app settings in sync between your phones, automatically.
            Everything is <strong>encrypted on the phone</strong> with a key only your phones share — the sync server just
            passes sealed messages along and cannot read them. Reminder options and the theme stay on each phone; a phone
            that joins takes on the group's settings.
          </p>
        </div>

        <label class="field">
          <span>Name of this phone</span>
          <input v-model="label" class="input" type="text" maxlength="40" />
        </label>

        <button class="btn primary block lg" :disabled="busy || !serverReady" @click="create">
          <Users :size="22" /> Start a sync group
        </button>
        <button class="btn block lg" :disabled="busy" @click="openJoin"><UserPlus :size="22" /> Join the other phone’s group</button>
        <p class="tiny faint hint">
          <template v-if="!serverReady">Enter the server secret above to start a group. </template>
          Start the group on one phone, then join it from the other by scanning its code — the code also sets up the sync
          server there.
        </p>
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
              This code is the key to your data and includes the server secret. Anyone who has it can join and read your data. Scan it in person; if you
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
.server {
  gap: 12px;
}

.server-head {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.grow {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.field > .secret {
  display: flex;
  gap: 8px;
  align-items: center;
  padding-left: 0;
}

.secret .input {
  flex: 1;
  min-width: 0;
}

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
