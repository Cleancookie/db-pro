/**
 * Matching and ranking for the command palette.
 *
 * Scoring is delegated to `fuzzysort`, which is the same class of matcher
 * behind VS Code's file finder: it understands prefixes, word boundaries,
 * camelCase and consecutive runs, and it is far better tuned than anything
 * worth hand-maintaining here.
 *
 * What this module still owns, because it is specific to a database browser:
 *
 * 1. **Where to match.** A bare query is matched against the object *name*.
 *    The schema is only consulted at a discount, so typing "user" finds
 *    `auth.user` rather than everything living in a schema whose name happens
 *    to contain those letters.
 *
 * 2. **Bias.** Framework schemas (Supabase's `extensions`, `graphql`, …) and
 *    routines are demoted, so a real table always wins a close contest.
 *
 * 3. **A cutoff.** This is the part that makes the palette feel filtered.
 *    Fuzzy matching is inherently permissive — "user" legitimately matches
 *    `customers` via c-U-S-t-om-E-R-s — so results are cut relative to the
 *    best hit. With a strong match on screen, weak ones disappear entirely;
 *    with only weak matches, they are all still offered.
 */

import fuzzysort from 'fuzzysort'

export interface Match {
  score: number
  /** Indices into the matched label, for highlighting. */
  positions: number[]
}

/**
 * Results scoring below `best * RELATIVE_CUTOFF` are dropped. At 0.5, an exact
 * hit (1.0) hides anything under 0.5 — which is where the scattered junk sits.
 */
const RELATIVE_CUTOFF = 0.5

/** Nothing below this is ever worth showing, even if it is the best there is. */
const ABSOLUTE_FLOOR = 0.15

/** Matching the schema instead of the name costs this much. */
const QUALIFIER_PENALTY = 0.3

/** Matching a hidden keyword rather than anything visible costs this much. */
const KEYWORD_PENALTY = 0.45

/**
 * A palette candidate. `name` is what the user is most likely typing — a bare
 * table name. `qualifier` is the schema it lives in.
 */
export interface Candidate {
  name: string
  qualifier?: string
  /** Hidden synonyms, matched at a steep discount. */
  keywords?: string
  /** Added to the final score. Negative demotes; see `schemaBias`. */
  bias?: number
}

export interface Scored<T> {
  item: T
  match: Match
}

function single(query: string, target: string): Match | null {
  const r = fuzzysort.single(query, target)
  if (!r) return null
  // fuzzysort's `indexes` is a readonly typed-array-like; copy it so callers
  // can treat it as a plain array.
  return { score: r.score, positions: Array.from(r.indexes) }
}

/**
 * Scores a candidate. Returned positions always index `name`, so highlighting
 * lines up with what the palette renders.
 */
export function matchCandidate(query: string, c: Candidate): Match | null {
  const bias = c.bias ?? 0
  if (!query) return { score: bias, positions: [] }

  const qualified = c.qualifier ? `${c.qualifier}.${c.name}` : c.name

  // A dotted query is an explicit "schema.table", so match it that way.
  if (query.includes('.')) {
    const m = single(query, qualified)
    if (!m) return null
    // Shift positions onto the name and drop any landing in the schema part.
    const offset = qualified.length - c.name.length
    return {
      score: m.score + bias,
      positions: m.positions.map((p) => p - offset).filter((p) => p >= 0),
    }
  }

  const onName = single(query, c.name)
  if (onName) return { score: onName.score + bias, positions: onName.positions }

  // Fall back to the schema, then hidden keywords — both discounted so they
  // can never displace a genuine name match.
  if (c.qualifier) {
    const onQualifier = single(query, c.qualifier)
    if (onQualifier) {
      return { score: onQualifier.score - QUALIFIER_PENALTY + bias, positions: [] }
    }
  }

  if (c.keywords) {
    const onKeywords = single(query, c.keywords)
    if (onKeywords) {
      return { score: onKeywords.score - KEYWORD_PENALTY + bias, positions: [] }
    }
  }

  return null
}

/**
 * Filters and ranks candidates, then applies the relative cutoff that keeps
 * the list short.
 */
export function rankCandidates<T>(
  query: string,
  items: T[],
  toCandidate: (item: T) => Candidate,
): Scored<T>[] {
  const scored: Scored<T>[] = []
  for (const item of items) {
    const match = matchCandidate(query, toCandidate(item))
    if (match) scored.push({ item, match })
  }
  // Array.prototype.sort is stable, so equal scores keep registry order.
  scored.sort((a, b) => b.match.score - a.match.score)

  if (!query || scored.length === 0) return scored

  const best = scored[0].match.score
  const cutoff = Math.max(ABSOLUTE_FLOOR, best * RELATIVE_CUTOFF)
  return scored.filter((s) => s.match.score >= cutoff)
}

/**
 * Schemas that are technically the user's but are almost always framework
 * plumbing. Objects in them still appear — they are demoted, so a real table
 * with a similar name always wins, and weak matches fall under the cutoff.
 *
 * This is a heuristic about noise, not correctness: getting it wrong costs a
 * few rank positions, never a missing result for a strong match.
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
  return NOISY_SCHEMAS.has(schema.toLowerCase()) ? -0.25 : 0
}
