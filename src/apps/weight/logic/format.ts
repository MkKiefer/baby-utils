import type { WeightUnit } from './types'

/** Unit conversion and display. Pure, so it is shared by the tile, views and tests. */

export const GRAMS_PER_LB = 453.59237
export const GRAMS_PER_OZ = GRAMS_PER_LB / 16

/** 3450 → "3.45 kg", 3455 → "3.455 kg"; 3450 in lb → "7 lb 9.7 oz". */
export function formatWeight(grams: number, unit: WeightUnit): string {
  // Scales weigh newborns to 5–10 g, so keep the third decimal only when it carries information.
  if (unit === 'kg') return `${(grams / 1000).toFixed(3).replace(/0$/, '')} kg`
  const { lb, oz } = toLbOz(grams)
  return `${lb} lb ${oz.toFixed(1).replace(/\.0$/, '')} oz`
}

/** Signed change: 120 → "+120 g", -85 → "−85 g"; in lb mode as ounces. */
export function formatChange(grams: number, unit: WeightUnit): string {
  const sign = grams > 0 ? '+' : grams < 0 ? '−' : '±'
  const abs = Math.abs(grams)
  if (unit === 'kg') return abs >= 1000 ? `${sign}${(abs / 1000).toFixed(2)} kg` : `${sign}${Math.round(abs)} g`
  const oz = abs / GRAMS_PER_OZ
  if (oz >= 16) {
    const { lb, oz: rest } = toLbOz(abs)
    return `${sign}${lb} lb ${rest.toFixed(1).replace(/\.0$/, '')} oz`
  }
  return `${sign}${oz.toFixed(1).replace(/\.0$/, '')} oz`
}

export function toLbOz(grams: number): { lb: number; oz: number } {
  let lb = Math.floor(grams / GRAMS_PER_LB)
  let oz = Math.round(((grams - lb * GRAMS_PER_LB) / GRAMS_PER_OZ) * 10) / 10
  if (oz >= 16) {
    lb += 1
    oz -= 16
  }
  return { lb, oz }
}

/** Parses a user-typed number, accepting a comma as decimal separator. */
export function parseNumber(value: string | number): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const text = value.trim().replace(',', '.')
  if (!text) return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

/** kg input → grams; values that look like grams ("3450") are taken as grams. */
export function gramsFromKg(value: string | number): number | null {
  const n = parseNumber(value)
  if (n == null || n <= 0) return null
  return Math.round(n >= 100 ? n : n * 1000)
}

export function gramsFromLbOz(lb: string | number, oz: string | number): number | null {
  const l = parseNumber(lb) ?? 0
  const o = parseNumber(oz) ?? 0
  if (l < 0 || o < 0 || (l === 0 && o === 0)) return null
  return Math.round(l * GRAMS_PER_LB + o * GRAMS_PER_OZ)
}
