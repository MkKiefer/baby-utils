export type DiaperKind = 'wet' | 'dirty' | 'both'

/**
 * Stool colour, loosely following a stool colour card. Pale stools (and blood) are worth
 * a call to the paediatrician, so they are flagged in the UI.
 */
export type StoolColor = 'meconium' | 'green' | 'yellow' | 'brown' | 'pale' | 'red'

export interface DiaperEntry {
  id: string
  /** When the diaper was changed (epoch ms). */
  at: number
  kind: DiaperKind
  /** Only meaningful for `dirty` and `both`. */
  stool?: StoolColor
  note?: string
  source: 'app' | 'import'
  createdAt: number
  /** Last local change (epoch ms); decides which copy wins a merge. See `core/merge.ts`. */
  updatedAt: number
  /** Soft delete (epoch ms), kept so the deletion survives a merge. */
  deletedAt?: number
}

export const DIAPER_KINDS: DiaperKind[] = ['wet', 'dirty', 'both']

export const KIND_LABEL: Record<DiaperKind, string> = { wet: 'Wet', dirty: 'Dirty', both: 'Wet + dirty' }

export const STOOL_COLORS: { value: StoolColor; label: string; swatch: string; warn?: boolean }[] = [
  { value: 'meconium', label: 'Meconium', swatch: '#2E3A2A' },
  { value: 'green', label: 'Green', swatch: '#6F8F3A' },
  { value: 'yellow', label: 'Yellow', swatch: '#E2B53B' },
  { value: 'brown', label: 'Brown', swatch: '#8A5A32' },
  { value: 'pale', label: 'Pale / white', swatch: '#EDE6C8', warn: true },
  { value: 'red', label: 'Red / blood', swatch: '#B8322A', warn: true },
]

export const isWet = (e: Pick<DiaperEntry, 'kind'>) => e.kind === 'wet' || e.kind === 'both'
export const isDirty = (e: Pick<DiaperEntry, 'kind'>) => e.kind === 'dirty' || e.kind === 'both'

export function isWarnStool(stool: StoolColor | undefined): boolean {
  return !!stool && !!STOOL_COLORS.find((c) => c.value === stool)?.warn
}

export function stoolLabel(stool: StoolColor): string {
  return STOOL_COLORS.find((c) => c.value === stool)?.label ?? stool
}

/** Accent of the sub-app; also set on sheets, which are teleported out of the sub-app frame. */
export const DIAPER_ACCENT = '#9B7BD4'
