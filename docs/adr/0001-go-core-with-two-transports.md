# 1. Go core with two transports

Date: 2026-08-16
Status: Accepted

## Context

The app ships as a Wails desktop binary targeting Windows first, macOS and Linux
later. But development happens on WSL2, where no native webview stack is installed,
so `wails dev` cannot run. If all application logic lived in the Wails-bound struct,
none of it could be executed or tested from the development machine.

## Decision

All behaviour lives in `internal/api.Service`, which imports nothing from Wails.
Two thin bindings call it:

- `app.go` — the Wails-bound struct, one method per API method, pass-through only.
- `cmd/devserver` — an HTTP server exposing `POST /api/:method` with a JSON body.

The frontend detects which is available at runtime and uses the matching transport
behind one identical TypeScript interface.

## Consequences

- Development and smoke-testing work on WSL2 today.
- The API surface must be JSON-serialisable, which it would be under Wails anyway.
- Two bindings to keep in sync. Mitigated by keeping them pure pass-through — any
  logic in a binding is a bug.
- The dev server binds to loopback only and is not built into the shipped app.
