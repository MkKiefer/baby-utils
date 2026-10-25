import { toast } from '@/composables/useToast'
import { notificationPermission, requestNotificationPermission } from '@/core/notify/permission'
import type { NewDose, NewPlan } from './logic/repo'
import type { MedDose, MedPlan } from './logic/types'
import { useMedsStore } from './store'

/** Plan and dose edits with Undo toasts, shared by the overview and history. */
export function useMedsActions() {
  const store = useMedsStore()

  /** Reminders need permission; ask right when they are switched on. */
  async function askForReminders(plan: Pick<MedPlan, 'remind'>) {
    if (!plan.remind) return
    if (notificationPermission.value === 'default') await requestNotificationPermission()
    if (notificationPermission.value === 'denied') {
      toast('Notifications are blocked — allow them in the browser settings to get reminders', { tone: 'warn' })
    }
  }

  async function createPlan(input: NewPlan) {
    const plan = await store.createPlan(input)
    toast(`${plan.name} plan added`, { tone: 'ok' })
    await askForReminders(plan)
    return plan
  }

  async function savePlan(plan: MedPlan) {
    const previous = store.planById(plan.id)
    const saved = await store.updatePlan(plan)
    toast('Plan updated', {
      tone: 'ok',
      ...(previous ? { action: { label: 'Undo', run: () => void store.updatePlan(previous) } } : {}),
    })
    if (!previous?.remind) await askForReminders(saved)
    return saved
  }

  async function stopPlan(plan: MedPlan) {
    await store.updatePlan({ ...plan, stoppedAt: Date.now() })
    toast(`${plan.name} stopped`, {
      action: {
        label: 'Undo',
        run: () => {
          const { stoppedAt: _s, ...rest } = plan
          void store.updatePlan(rest)
        },
      },
    })
  }

  async function resumePlan(plan: MedPlan) {
    const { stoppedAt: _s, ...rest } = plan
    await store.updatePlan(rest)
    toast(`${plan.name} resumed`, { tone: 'ok' })
  }

  async function removePlan(id: string) {
    const { plan, doses } = await store.removePlan(id)
    if (plan) {
      toast(`${plan.name} deleted`, { action: { label: 'Undo', run: () => void store.restorePlanWithDoses(plan, doses) } })
    }
  }

  async function logDose(input: NewDose) {
    const dose = await store.logDose(input)
    navigator.vibrate?.(30)
    toast(`${dose.name} ${dose.skipped ? 'skipped' : 'given'}`, {
      tone: 'ok',
      action: { label: 'Undo', run: () => void store.removeDose(dose.id) },
    })
    return dose
  }

  async function saveDose(dose: MedDose) {
    const previous = store.doses.find((d) => d.id === dose.id)
    const saved = await store.updateDose(dose)
    toast('Dose updated', {
      tone: 'ok',
      ...(previous ? { action: { label: 'Undo', run: () => void store.updateDose(previous) } } : {}),
    })
    return saved
  }

  async function removeDose(id: string) {
    const removed = await store.removeDose(id)
    if (removed) toast('Dose deleted', { action: { label: 'Undo', run: () => void store.restoreDoseEntry(removed) } })
  }

  return { createPlan, savePlan, stopPlan, resumePlan, removePlan, logDose, saveDose, removeDose }
}
