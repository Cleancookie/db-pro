import { describe, expect, it } from 'vitest'
import { matchCandidate, rankCandidates } from './fuzzy'
import { objectBias, orderByRecency, RECENT_LIMIT, recencyBias, refKey } from './recency'
import type { SchemaObject } from './types'

const obj = (name: string, schema = '', type: SchemaObject['type'] = 'table'): SchemaObject => ({
  schema,
  name,
  type,
})

/**
 * The same candidate shape buildNavigationCommands builds. Rebuilt here rather
 * than imported, because commands.ts pulls in the store, which touches `window`
 * at module scope and cannot load under vitest's node environment. The bias —
 * the part that is easy to get subtly wrong — is the shipped function.
 */
const candidate = (o: SchemaObject, recentIndex: number) => ({
  name: o.name,
  qualifier: o.schema || undefined,
  keywords: o.type,
  bias: objectBias(o.schema, o.type, recentIndex),
})

describe('recency in object ranking', () => {
  it('orders by recency when nothing has been typed', () => {
    // With an empty query, a candidate's score is exactly its bias.
    const first = matchCandidate('', candidate(obj('orders'), 0))!
    const second = matchCandidate('', candidate(obj('users'), 1))!
    const never = matchCandidate('', candidate(obj('audit_log'), -1))!

    expect(first.score).toBeGreaterThan(second.score)
    expect(second.score).toBeGreaterThan(never.score)
  })

  it('lifts a just-opened table above the noisy-schema penalty', () => {
    // Having looked at it seconds ago is better evidence than the schema's
    // reputation, so this must come out ahead despite the -0.25.
    const recentNoisy = matchCandidate('', candidate(obj('kv', 'extensions'), 0))!
    const plainTable = matchCandidate('', candidate(obj('orders'), -1))!
    expect(recentNoisy.score).toBeGreaterThan(plainTable.score)
  })

  it('does not let recency beat a clearly better name match', () => {
    const items = [
      { o: obj('audit_log_archive_2019'), i: 0 },
      { o: obj('users'), i: -1 },
    ]
    const ranked = rankCandidates('users', items, (x) => candidate(x.o, x.i))
    expect(ranked[0].item.o.name).toBe('users')
  })

  it('still favours the recent one when the match quality is comparable', () => {
    const items = [
      { o: obj('orders_archive'), i: -1 },
      { o: obj('orders_active'), i: 0 },
    ]
    const ranked = rankCandidates('orders', items, (x) => candidate(x.o, x.i))
    expect(ranked[0].item.o.name).toBe('orders_active')
  })

  it('decays, so the oldest tracked entry is barely favoured', () => {
    expect(recencyBias(RECENT_LIMIT - 1)).toBeGreaterThan(0)
    expect(recencyBias(RECENT_LIMIT - 1)).toBeLessThan(recencyBias(0) / 4)
  })

  it('gives nothing to an object that is not in the list', () => {
    expect(recencyBias(-1)).toBe(0)
  })
})

describe('orderByRecency', () => {
  it('puts recent items first in recency order, keeping the rest as given', () => {
    const items = ['a', 'b', 'c', 'd']
    const recent = new Map([
      ['c', 0],
      ['a', 1],
    ])
    const out = orderByRecency(items, (x) => recent.get(x) ?? -1)
    expect(out).toEqual(['c', 'a', 'b', 'd'])
  })

  it('does not mutate its input', () => {
    const items = ['a', 'b']
    orderByRecency(items, (x) => (x === 'b' ? 0 : -1))
    expect(items).toEqual(['a', 'b'])
  })
})

describe('refKey', () => {
  it('separates the same table name in different databases', () => {
    expect(refKey('shop', 'public', 'users')).not.toBe(refKey('admin', 'public', 'users'))
  })

  it('separates the same table name in different schemas', () => {
    expect(refKey('shop', 'auth', 'users')).not.toBe(refKey('shop', 'public', 'users'))
  })

  it('cannot be confused by a name containing the separator characters', () => {
    // A dot-joined key would make ('a','b.c') and ('a.b','c') collide.
    expect(refKey('db', 'a', 'b.c')).not.toBe(refKey('db', 'a.b', 'c'))
  })
})
