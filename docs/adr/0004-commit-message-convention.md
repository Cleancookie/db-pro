# 4. Commits are prefixed with an emoji that names the kind of change

Date: 2026-08-17
Status: Accepted

## Context

The history had no convention, so the only way to tell a bug fix from a feature
from a refactor was to read the diff. That is fine while one person holds the
whole project in their head and stops being fine immediately afterwards —
including for release notes, and for anything that wants to derive a version
number from the log.

This repo does not use the `AB#<ticket>` prefix that the G4C portal projects
do. There are no tickets; the subject line is the whole record.

## Decision

Every commit subject starts with one of four emoji, then a space, then the
description:

```
✨ Add SQL autocomplete to the filter box and the editor
🐛 Stop Enter in the filter box opening the cell viewer
```

| Emoji | Means | Semver |
| --- | --- | --- |
| 🔥 | Breaking change | major |
| ✨ | Major change — a new capability | major |
| 🛠️ | Minor change — refactors, docs, tooling, polish | minor |
| 🐛 | Bug fix | patch |

Only these four. A wider palette (📝 docs, ♻️ refactor, 🔧 config …) describes
the *area* rather than the *size* of a change, which is what a version number
needs; those all land on 🛠️ here.

The description keeps the existing style: imperative mood, capitalised, no
trailing full stop.

Enforced by `.githooks/commit-msg`, installed with `make hooks`. Git does not
share hooks through a clone, so the install step is deliberate and the hook
lives in a tracked directory rather than in `.git/hooks`.

## Consequences

- The kind and rough size of every change is readable from `git log --oneline`.
- Automated semver tagging becomes a script over the log: 🔥 or ✨ anywhere
  since the last tag means a major bump, otherwise 🛠️ means minor, otherwise
  patch. That script does not exist yet; this is the groundwork for it.
- **✨ bumping major is a deliberate departure from convention**, where a new
  backwards-compatible feature is normally a minor bump. It was chosen on the
  grounds that "I added something significant" and "I broke something" are both
  worth announcing loudly. The cost is that major numbers will move quickly —
  a feature-heavy month could reach v9. If that becomes annoying, the fix is to
  move ✨ to minor and leave 🔥 as the only major, which changes this table and
  nothing else.
- Emoji in subject lines are one more thing that can render badly in a terminal
  or mail client. 🛠️ in particular carries a variation selector, so it is two
  code points and can occupy one or two columns depending on the font. The hook
  accepts it with or without the selector for that reason.
- History before this ADR is unconverted. Rewriting it was considered and
  rejected: the subjects are already descriptive, and rewriting shared history
  to add decoration is a bad trade.
