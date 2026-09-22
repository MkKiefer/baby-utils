import { describe, expect, it } from 'vitest'
import { DEFAULT_FEED_SETTINGS, FEED_SETTINGS_KEY } from '@/apps/feed/logic/types'
import { docFields, foldDocs, mergeSyncedDocs, pickField, SYNCED_DOCS, type SyncedDocs } from './settingsSync'

const feedSpec = SYNCED_DOCS[FEED_SETTINGS_KEY]!

describe('settings sync', () => {
  it('dates unstamped fields: defaults lose, earlier choices beat them', () => {
    const fields = docFields(feedSpec, { ...DEFAULT_FEED_SETTINGS, intervalMode: 'manual' })
    expect(fields.intervalMode).toEqual({ at: 1, value: 'manual' })
    expect(fields.manualIntervalMin).toEqual({ at: 0, value: 180 })
    // A document from before a field existed still yields it, with its default.
    expect(docFields(feedSpec, { intervalMode: 'auto' }).night).toEqual({ at: 0, value: DEFAULT_FEED_SETTINGS.night })
  })

  it('never lets phone-only fields travel', () => {
    const fields = docFields(feedSpec, { ...DEFAULT_FEED_SETTINGS, maxUnconfirmed: 0 }, { maxUnconfirmed: 99 })
    expect(fields).not.toHaveProperty('maxUnconfirmed')
    expect(fields).not.toHaveProperty('notifyAtBase')
    const folded = foldDocs([{ [FEED_SETTINGS_KEY]: { maxUnconfirmed: { at: 5, value: 0 } } }, { unknown: {} }])
    expect(folded).toEqual({ [FEED_SETTINGS_KEY]: {} })
  })

  it('merges per field and converges on ties', () => {
    const local: SyncedDocs = { profile: { name: { at: 5, value: 'Ada' }, birthDate: { at: 5, value: '2026-09-01' } } }
    const incoming: SyncedDocs = { profile: { name: { at: 9, value: 'Mia' }, birthDate: { at: 2, value: '2026-08-31' } } }
    expect(mergeSyncedDocs(local, incoming)).toEqual({ profile: { name: { at: 9, value: 'Mia' } } })
    // Merging the same thing again changes nothing.
    expect(mergeSyncedDocs({ profile: { ...local.profile, name: { at: 9, value: 'Mia' } } }, incoming)).toEqual({})

    const x = { at: 3, value: 'x' }
    const y = { at: 3, value: 'y' }
    expect(pickField(x, y)).toBe(pickField(y, x))
  })

  it('carries removals', () => {
    const local: SyncedDocs = { profile: { birthTime: { at: 1, value: '04:10' } } }
    expect(mergeSyncedDocs(local, { profile: { birthTime: { at: 7 } } })).toEqual({ profile: { birthTime: { at: 7 } } })
  })

  it('ignores malformed input', () => {
    expect(foldDocs([null, 'x', { profile: { name: { value: 'no stamp' }, birthDate: { at: Infinity } } }])).toEqual({
      profile: {},
    })
  })
})
