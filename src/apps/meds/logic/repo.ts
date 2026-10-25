import { newId, plain, type DB } from '@/core/db'
import type { NotificationProvider } from '@/core/notify/types'
import { overdueCount, plannedReminders } from './schedule'
import type { MedDose, MedPlan } from './types'

/** IndexedDB access for medication plans and doses. DOM/Vue free: the SW uses it. */

/** Live plans, oldest first. Tombstones stay in the store for merging. */
export async function readAllPlans(db: DB): Promise<MedPlan[]> {
  return (await db.getAllFromIndex('medPlans', 'byAt')).filter((e) => !e.deletedAt)
}

/** Every plan record, tombstones included: for merging, sync and the Debug app. */
export async function readPlanRecords(db: DB): Promise<MedPlan[]> {
  return db.getAllFromIndex('medPlans', 'byAt')
}

export async function readAllDoses(db: DB): Promise<MedDose[]> {
  return (await db.getAllFromIndex('medDoses', 'byAt')).filter((e) => !e.deletedAt)
}

export async function readDoseRecords(db: DB): Promise<MedDose[]> {
  return db.getAllFromIndex('medDoses', 'byAt')
}

export type NewPlan = Omit<MedPlan, 'id' | 'source' | 'createdAt' | 'updatedAt' | 'deletedAt'>

/** Fixed times only make sense for scheduled plans; reminders only with fixed times. */
function cleanedPlan<T extends Partial<MedPlan>>(plan: T): T {
  const next = { ...plan }
  if (next.asNeeded || !next.times?.length) {
    delete next.times
    delete next.remind
  }
  if (!next.asNeeded) delete next.asNeeded
  if (!next.remind) delete next.remind
  if (!next.days) delete next.days
  if (!next.dose) delete next.dose
  if (!next.note) delete next.note
  return next
}

export async function addPlan(db: DB, input: NewPlan, now = Date.now()): Promise<MedPlan> {
  const plan = plain(cleanedPlan({ ...input, id: newId(), source: 'app', createdAt: now, updatedAt: now } as MedPlan))
  await db.put('medPlans', plan)
  return plan
}

export async function putPlan(db: DB, plan: MedPlan, now = Date.now()): Promise<MedPlan> {
  const next = plain(cleanedPlan({ ...plan, updatedAt: now }))
  await db.put('medPlans', next)
  return next
}

/** Tombstones the plan and its doses, so the deletion survives a merge. */
export async function deletePlan(db: DB, id: string, now = Date.now()): Promise<{ plan?: MedPlan; doses: MedDose[] }> {
  const tx = db.transaction(['medPlans', 'medDoses'], 'readwrite')
  const plan = await tx.objectStore('medPlans').get(id)
  const doses = (await tx.objectStore('medDoses').getAll()).filter((d) => d.planId === id && !d.deletedAt)
  if (plan) await tx.objectStore('medPlans').put(plain({ ...plan, deletedAt: now, updatedAt: now }))
  for (const d of doses) await tx.objectStore('medDoses').put(plain({ ...d, deletedAt: now, updatedAt: now }))
  await tx.done
  return { plan, doses }
}

/** Undo of `deletePlan`. */
export async function restorePlan(db: DB, plan: MedPlan, doses: MedDose[], now = Date.now()): Promise<void> {
  const tx = db.transaction(['medPlans', 'medDoses'], 'readwrite')
  const { deletedAt: _p, ...livePlan } = plan
  await tx.objectStore('medPlans').put(plain({ ...livePlan, updatedAt: now }))
  for (const d of doses) {
    const { deletedAt: _d, ...live } = d
    await tx.objectStore('medDoses').put(plain({ ...live, updatedAt: now }))
  }
  await tx.done
}

export interface NewDose {
  planId: string
  at: number
  skipped?: boolean
  note?: string
  source?: MedDose['source']
}

export async function addDose(db: DB, input: NewDose, now = Date.now()): Promise<MedDose> {
  const plan = await db.get('medPlans', input.planId)
  const dose: MedDose = {
    id: newId(),
    planId: input.planId,
    at: input.at,
    name: plan?.name ?? 'Medication',
    source: input.source ?? 'app',
    createdAt: now,
    updatedAt: now,
    ...(plan?.dose ? { dose: plan.dose } : {}),
    ...(input.skipped ? { skipped: true } : {}),
    ...(input.note ? { note: input.note } : {}),
  }
  await db.put('medDoses', plain(dose))
  return dose
}

export async function putDose(db: DB, dose: MedDose, now = Date.now()): Promise<MedDose> {
  const next = plain({ ...dose, updatedAt: now })
  if (!next.skipped) delete next.skipped
  if (!next.note) delete next.note
  await db.put('medDoses', next)
  return next
}

export async function deleteDose(db: DB, id: string, now = Date.now()): Promise<void> {
  const dose = await db.get('medDoses', id)
  if (!dose) return
  await db.put('medDoses', plain({ ...dose, deletedAt: now, updatedAt: now }))
}

export async function restoreDose(db: DB, dose: MedDose, now = Date.now()): Promise<MedDose> {
  const { deletedAt: _deletedAt, ...rest } = dose
  const next = plain({ ...rest, updatedAt: now })
  await db.put('medDoses', next)
  return next
}

/** Reminders at the fixed times of plans that ask for them. */
export const medsNotificationProvider: NotificationProvider = {
  id: 'meds',
  async plan(db, now) {
    const [plans, doses] = await Promise.all([readAllPlans(db), readAllDoses(db)])
    return { notifications: plannedReminders(plans, doses, now), badge: overdueCount(plans, doses, now) }
  },
}
