/**
 * Matching and ranking for the command palette.
 *
 * The palette lives or dies on this file. The failure it exists to prevent:
 * typing "user" on a Supabase database and getting a wall of
 * `extensions.uuid_generate_v4`-style noise, because a loose subsequence
 * matcher happily finds u-s-e-r scattered across a long unrelated name,
 * while the table actually called `user` sits below the fold.
 *
 * The fix is tiers, not weights. A name that *contains* the query beats any
 * scattered match, no matter how many bonus points the scatter accumulates.
 * Only inside a tier do the finer scores matter.
 */

export interface Match {
  score: number
  /** Indices into the matched label, for highlighting. */
  positions: number[]
}

/** Tier floors. The gaps are wide enough that no in-tier bonus can cross them. */
const TIER_EXACT = 10_000
const TIER_PREFIX = 8_000
const TIER_WORD_START = 6_000
const TIER_SUBSTRING = 4_000
const TIER_QUALIFIED = 2_000
const TIER_SUBSEQUENCE = 500

const WORD_SEPARATORS = /[_\-. /]/

function isWordBoundary(prev: string): boolean {
  return WORD_SEPARATORS.test(prev)
}

function range(start: number, length: number): number[] {
  return Array.from({ length }, (_, i) => start + i)
}

/**
 * Scores `query` against a single label. Returns null when there is no match
 * at all. Shorter labels win ties, so `user` outranks `user_settings`.
 */
export function matchLabel(query: string, label: string): Match | null {
  if (!query) return { score: 0, positions: [] }

  const q = query.toLowerCase()
  const l = label.toLowerCase()
  // Shorter is better, but only as a tie-break within a tier.
  const brevity = Math.max(0, 200 - label.length)

  if (l === q) {
    return { score: TIER_EXACT + brevity, positions: range(0, label.length) }
  }
  if (l.startsWith(q)) {
    return { score: TIER_PREFIX + brevity, positions: range(0, q.length) }
  }

  const at = l.indexOf(q)
  if (at > 0) {
    const tier = isWordBoundary(l[at - 1]) ? TIER_WORD_START : TIER_SUBSTRING
    // Earlier occurrences rank slightly higher.
    return { score: tier + brevity - at, positions: range(at, q.length) }
  }

  const sub = subsequence(q, l)
  if (!sub) return null
  return { score: TIER_SUBSEQUENCE + sub.score + brevity * 0.1, positions: sub.positions }
}

/** Ordered-subsequence match, used only as the last resort tier. */
function subsequence(q: string, l: string): Match | null {
  const positions: number[] = []
  let score = 0
  let li = 0
  let last = -2

  for (const ch of q) {
    let found = -1
    while (li < l.length) {
      if (l[li] === ch) {
        found = li
        break
      }
      li++
    }
    if (found < 0) return null

    if (found === last + 1) score += 8
    if (found === 0 || isWordBoundary(l[found - 1])) score += 6

    positions.push(found)
    last = found
    li++
  }
  return { score, positions }
}

/**
 * A palette candidate. `name` is the thing the user is most likely typing —
 * a bare table name. `qualifier` is the schema it lives in, matched only at a
 * lower tier so `auth.user` still ranks above `extensions.something_user`.
 */
export interface Candidate {
  name: string
  qualifier?: string
  /** Hidden synonyms, matched at the lowest tier. */
  keywords?: string
  /** Added to the final score. Negative demotes; used for noisy schemas. */
  bias?: number
}

export interface Scored<T> {
  item: T
  match: Match
}

/**
 * Scores a candidate. The returned positions always index `name`, so the
 * highlight lines up with what the palette renders in bold.
 */
export function matchCandidate(query: string, c: Candidate): Match | null {
  if (!query) return { score: c.bias ?? 0, positions: [] }

  const bias = c.bias ?? 0
  const qualified = c.qualifier ? `${c.qualifier}.${c.name}` : c.name

  // A dotted query is an explicit "schema.table", so match it that way.
  if (query.includes('.')) {
    const m = matchLabel(query, qualified)
    if (!m) return null
    // Positions index the qualified string; shift them onto the name and drop
    // any that fall in the schema part.
    const offset = qualified.length - c.name.length
    return {
      score: m.score + bias,
      positions: m.positions.map((p) => p - offset).filter((p) => p >= 0),
    }
  }

  const onName = matchLabel(query, c.name)
  if (onName) return { score: onName.score + bias, positions: onName.positions }

  // Fall back to the schema and the hidden keywords, both capped below any
  // real name match so they can never displace one.
  const onQualified = c.qualifier ? matchLabel(query, qualified) : null
  if (onQualified) {
    return { score: Math.min(onQualified.score, TIER_QUALIFIED) + bias, positions: [] }
  }

  if (c.keywords) {
    const onKeywords = matchLabel(query, c.keywords)
    if (onKeywords) {
      return { score: Math.min(onKeywords.score, TIER_QUALIFIED - 500) + bias, positions: [] }
    }
  }

  return null
}

/** Filters and ranks a list of candidates. */
export function rankCandidates<T>(
  query: string,
  items: T[],
  toCandidate: (item: T) => Candidate,
): Scored<T>[] {
  const out: Scored<T>[] = []
  for (const item of items) {
    const match = matchCandidate(query, toCandidate(item))
    if (match) out.push({ item, match })
  }
  // Array.prototype.sort is stable, so equal scores keep registry order.
  return out.sort((a, b) => b.match.score - a.match.score)
}

/**
 * Schemas that are technically the user's but are almost always framework
 * plumbing. Objects in them still appear — they are just demoted, so a real
 * table with the same name always wins.
 *
 * This is a heuristic about noise, not about correctness: getting it wrong
 * costs a few rank positions, never a missing result.
 */
const NOISY_SCHEMAS = new Set([
  'extensions',
  'graphql',
  'graphql_public',
  'pgbouncer',
  'realtime',
  'storage',
  'supabase_functions',
  'supabase_migrations',
  'vault',
  'net',
  'cron',
  'pgsodium',
  'pgsodium_masks',
  '_timescaledb_internal',
  '_timescaledb_catalog',
])

export function schemaBias(schema: string | undefined): number {
  if (!schema) return 0
  return NOISY_SCHEMAS.has(schema.toLowerCase()) ? -3_000 : 0
}
