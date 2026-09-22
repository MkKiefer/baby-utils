export type WeightUnit = 'kg' | 'lb'

export interface WeightEntry {
  id: string
  /** When the baby was weighed (epoch ms). */
  at: number
  /** Always stored in grams; the unit is only a display preference. */
  grams: number
  note?: string
  source: 'app' | 'import'
  createdAt: number
  /** Last local change (epoch ms); decides which copy wins a merge. See `core/merge.ts`. */
  updatedAt: number
  /** Soft delete (epoch ms), kept so the deletion survives a merge. */
  deletedAt?: number
}

export interface WeightSettings {
  unit: WeightUnit
}

export const DEFAULT_WEIGHT_SETTINGS: WeightSettings = { unit: 'kg' }

export const WEIGHT_SETTINGS_KEY = 'weight.settings'

/** Accent of the sub-app; also set on sheets, which are teleported out of the sub-app frame. */
export const WEIGHT_ACCENT = '#3A8FB7'

/** Plausible range for a baby/toddler; anything outside is almost certainly a typo. */
export const MIN_GRAMS = 300
export const MAX_GRAMS = 30_000
