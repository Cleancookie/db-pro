import { describe, expect, it } from 'vitest'
import { matchCandidate, rankCandidates, schemaBias, type Candidate } from './fuzzy'

/** A stand-in for the object list on a Supabase-shaped Postgres database. */
const SUPABASE_OBJECTS: { schema: string; name: string; type: string }[] = [
  { schema: 'extensions', name: 'uuid_generate_v4', type: 'function' },
  { schema: 'extensions', name: 'pgp_pub_encrypt', type: 'function' },
  { schema: 'extensions', name: 'set_graphql_placeholder', type: 'function' },
  { schema: 'extensions', name: 'grant_pg_cron_access', type: 'function' },
  // These three are the real adversaries: each contains u-s-e-r as a scattered
  // subsequence, so a naive matcher ranks them alongside the actual `user`
  // table. They are what made the palette unusable.
  { schema: 'extensions', name: 'update_series_reference', type: 'function' },
  { schema: 'extensions', name: 'unaccent_series_lookup', type: 'function' },
  { schema: 'graphql', name: 'unwrap_selection_error', type: 'function' },
  { schema: 'storage', name: 'update_updated_at_column', type: 'function' },
  { schema: 'realtime', name: 'subscription', type: 'table' },
  { schema: 'auth', name: 'user', type: 'table' },
  { schema: 'auth', name: 'users', type: 'table' },
  { schema: 'auth', name: 'sessions', type: 'table' },
  { schema: 'public', name: 'user_profiles', type: 'table' },
  { schema: 'public', name: 'purchase_orders', type: 'table' },
]

const candidate = (o: (typeof SUPABASE_OBJECTS)[number]): Candidate => ({
  name: o.name,
  qualifier: o.schema,
  keywords: o.type,
  bias: schemaBias(o.schema) + (o.type === 'table' ? 0 : -0.08),
})

function rankNames(query: string): string[] {
  return rankCandidates(query, SUPABASE_OBJECTS, candidate).map(
    (r) => `${r.item.schema}.${r.item.name}`,
  )
}

describe('command palette ranking', () => {
  // The reported bug: typing "user" surfaced extension functions ahead of the
  // table actually called "user".
  it('puts the exactly-named table first', () => {
    expect(rankNames('user')[0]).toBe('auth.user')
  })

  it('puts the three real tables in the first three positions', () => {
    expect(rankNames('user').slice(0, 3)).toEqual([
      'auth.user',
      'auth.users',
      'public.user_profiles',
    ])
  })

  it('prefers a prefix match over a mid-word one', () => {
    const ranked = rankNames('purchase')
    expect(ranked[0]).toBe('public.purchase_orders')
  })

  it('supports schema-qualified queries', () => {
    expect(rankNames('auth.us')[0]).toBe('auth.user')
  })

  it('still finds extension functions when nothing else matches', () => {
    expect(rankNames('uuid')[0]).toBe('extensions.uuid_generate_v4')
  })

  it('matches on a word boundary inside a name', () => {
    // "generate" sits after an underscore in uuid_generate_v4.
    expect(rankNames('generate')[0]).toBe('extensions.uuid_generate_v4')
  })

  it('drops candidates that do not match at all', () => {
    expect(rankNames('zzzznotathing')).toHaveLength(0)
  })

  it('prefers the shorter name when both match equally', () => {
    const ranked = rankNames('sub')
    expect(ranked[0]).toBe('realtime.subscription')
  })
})

describe('relevance ordering', () => {
  it('beats a scattered subsequence with a substring match', () => {
    const substring = matchCandidate('user', { name: 'app_user' })
    const scattered = matchCandidate('user', { name: 'update_series_reference' })
    expect(substring).not.toBeNull()
    expect(scattered).not.toBeNull()
    expect(substring!.score).toBeGreaterThan(scattered!.score)
  })

  it('beats a prefix match with an exact match', () => {
    const exact = matchCandidate('user', { name: 'user' })!
    const prefix = matchCandidate('user', { name: 'users' })!
    expect(exact.score).toBeGreaterThan(prefix.score)
  })

  // A name match must win even when the loser's schema also contains the
  // query — otherwise `extensions.foo` outranks `public.extension_log`.
  it('beats a schema match with a name match', () => {
    const onName = matchCandidate('storage', { name: 'storage_log', qualifier: 'public' })!
    const onSchema = matchCandidate('storage', { name: 'migrations', qualifier: 'storage' })!
    expect(onName.score).toBeGreaterThan(onSchema.score)
  })

  it('never lets a keyword match outrank a name match', () => {
    const onName = matchCandidate('table', { name: 'tables' })!
    const onKeyword = matchCandidate('table', { name: 'orders', keywords: 'table' })!
    expect(onName.score).toBeGreaterThan(onKeyword.score)
  })
})

describe('the cutoff', () => {
  // The reported complaint: the palette "should filter the results down".
  // Fuzzy matching legitimately matches c-U-S-t-om-E-R-s for "user", so
  // relevance ordering alone is not enough — weak hits must be dropped once
  // a strong one exists.
  it('drops weak matches when a strong one is present', () => {
    const ranked = rankCandidates(
      'user',
      ['user', 'customers', 'update_series_reference'],
      (name) => ({ name }),
    ).map((r) => r.item)
    expect(ranked).toContain('user')
    expect(ranked).not.toContain('customers')
  })

  it('keeps weak matches when they are the only ones', () => {
    const ranked = rankCandidates('user', ['customers'], (name) => ({ name }))
    expect(ranked.map((r) => r.item)).toEqual(['customers'])
  })

  it('still supports terse acronym-style queries', () => {
    const ranked = rankCandidates('evt', ['events', 'order_lines'], (name) => ({ name }))
    expect(ranked.map((r) => r.item)).toEqual(['events'])
  })

  it('cuts the Supabase noise once a real table matches', () => {
    const ranked = rankNames('user')
    expect(ranked).toContain('auth.user')
    for (const n of ranked) {
      expect(n.startsWith('extensions.')).toBe(false)
    }
  })
})

describe('highlight positions', () => {
  it('indexes the name, so the palette bolds the right characters', () => {
    const m = matchCandidate('user', { name: 'app_user' })!
    expect(m.positions).toEqual([4, 5, 6, 7])
  })

  it('returns no positions when the match came from the schema', () => {
    const m = matchCandidate('auth', { name: 'sessions', qualifier: 'auth' })!
    expect(m.positions).toEqual([])
  })

  it('keeps positions within the name for a qualified query', () => {
    const m = matchCandidate('auth.ses', { name: 'sessions', qualifier: 'auth' })!
    expect(Math.min(...m.positions)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...m.positions)).toBeLessThan('sessions'.length)
  })
})

describe('empty query', () => {
  it('keeps every candidate in registry order', () => {
    const ranked = rankCandidates('', SUPABASE_OBJECTS, (o) => ({ name: o.name }))
    expect(ranked).toHaveLength(SUPABASE_OBJECTS.length)
    expect(ranked[0].item.name).toBe('uuid_generate_v4')
  })
})
