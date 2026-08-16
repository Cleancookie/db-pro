# 2. The Ctrl+F filter is raw, uninterpreted SQL

Date: 2026-08-16
Status: Accepted

## Context

TablePlus's filter bar is the feature that makes it fast: you type a SQL fragment and
it goes straight after `WHERE`. Any attempt to build a structured filter UI
(column dropdown, operator dropdown, value box) is slower to use and cannot express
`created_at > now() - interval '7 days' and status in ('a','b')`.

## Decision

The filter input's contents are interpolated verbatim into the generated query after
`WHERE`. No parsing, no escaping, no validation. Syntax errors come back from the
database and are shown as-is.

Everything else in the generated query — identifiers, sort columns, limit, offset — is
quoted per-dialect or parameterised.

## Consequences

- The filter is as expressive as the database, which is the whole point.
- This is a SQL injection sink by construction. It is acceptable because the input
  comes from the keyboard of someone who already holds the connection's credentials
  and could open a SQL editor tab instead. It stops being acceptable the moment
  anything programmatic can write to that box — no URL parameter, saved-workspace
  field, or clipboard automation may ever populate it without an explicit,
  user-visible confirmation step.
- Read-only intent is not enforced by parsing. A user could type
  `1=1; drop table x` and, on dialects permitting multi-statement queries, mean it.
  A future "read-only connection" toggle should enforce this at the session level
  (a read-only transaction or a restricted DB user), not by inspecting the string.
