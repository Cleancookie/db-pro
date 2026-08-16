/**
 * Subsequence fuzzy matching for the command palette.
 *
 * Scoring rewards matches that a person would consider "obvious": characters
 * at the start of a word, runs of consecutive characters, and matches near the
 * front of the string. Without those bonuses, "usr" would rank a table called
 * `customer_status_records` above `users`, which makes the palette feel broken.
 */

export interface Match {
  score: number
  /** Indices in the haystack that matched, for highlighting. */
  positions: number[]
}

const CONSECUTIVE_BONUS = 12
const WORD_START_BONUS = 10
const CAMEL_BONUS = 8
const LEADING_PENALTY = -1
const MAX_LEADING_PENALTY = -12
const UNMATCHED_PENALTY = -1

function isWordBoundary(prev: string): boolean {
  return prev === '_' || prev === '-' || prev === '.' || prev === ' ' || prev === '/'
}

export function fuzzyMatch(query: string, haystack: string): Match | null {
  if (!query) return { score: 0, positions: [] }

  const q = query.toLowerCase()
  const h = haystack.toLowerCase()

  // Cheap exact-substring path, scored high so "users" beats a scattered match.
  const direct = h.indexOf(q)
  if (direct >= 0) {
    const positions = Array.from({ length: q.length }, (_, i) => direct + i)
    let score = 100 + q.length * CONSECUTIVE_BONUS
    if (direct === 0) score += 40
    else if (isWordBoundary(h[direct - 1])) score += WORD_START_BONUS * 2
    score += Math.max(MAX_LEADING_PENALTY, direct * LEADING_PENALTY)
    return { score, positions }
  }

  const positions: number[] = []
  let score = 0
  let hi = 0
  let lastMatch = -2

  for (let qi = 0; qi < q.length; qi++) {
    const target = q[qi]
    let found = -1
    while (hi < h.length) {
      if (h[hi] === target) {
        found = hi
        break
      }
      hi++
    }
    if (found < 0) return null

    if (found === lastMatch + 1) score += CONSECUTIVE_BONUS
    if (found === 0) score += WORD_START_BONUS
    else {
      if (isWordBoundary(h[found - 1])) score += WORD_START_BONUS
      // A capital following a lower-case letter starts a word in camelCase.
      else if (
        haystack[found] >= 'A' &&
        haystack[found] <= 'Z' &&
        haystack[found - 1] >= 'a' &&
        haystack[found - 1] <= 'z'
      ) {
        score += CAMEL_BONUS
      }
    }
    if (qi === 0) score += Math.max(MAX_LEADING_PENALTY, found * LEADING_PENALTY)

    positions.push(found)
    lastMatch = found
    hi++
  }

  // Prefer the shorter of two otherwise-equal candidates.
  score += (h.length - q.length) * UNMATCHED_PENALTY * 0.1
  return { score, positions }
}

export interface Scored<T> {
  item: T
  match: Match
}

/** Filters and ranks, matching against each item's searchable text. */
export function rank<T>(query: string, items: T[], text: (item: T) => string): Scored<T>[] {
  const out: Scored<T>[] = []
  for (const item of items) {
    const match = fuzzyMatch(query, text(item))
    if (match) out.push({ item, match })
  }
  // Sort is stable in every engine we target, so equal scores keep the order
  // the command registry defined — which is grouped meaningfully.
  return out.sort((a, b) => b.match.score - a.match.score)
}
