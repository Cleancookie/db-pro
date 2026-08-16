# db-pro

A keyboard-first database GUI. Go core, React/webview UI, one binary.

Built as a replacement for TablePlus. Supports **MySQL/MariaDB, PostgreSQL, SQL Server and SQLite**.

## Why command-palette-first

There is no menu bar to hunt through. `Ctrl+K` opens the palette and everything is
reachable from it — connect, switch database, open a table, run a query, change page
size. The palette is context-aware: what it offers depends on what you have open.

## Status

MVP walking skeleton. Working end-to-end:

- Connection management (create / edit / delete / duplicate / test, persisted to disk)
- Browse databases on a server
- Browse tables, views, functions and procedures on a database
- Browse rows of a table or view
- `Ctrl+F` raw-SQL filter — whatever you type is appended after `WHERE`
- Pagination: page size, page number, or switched off entirely
- SQL editor with a results grid (plain textarea for now, Monaco is a follow-up)

## Keybindings

| Key | Action |
| --- | --- |
| `Ctrl+K` | Command palette |
| `Ctrl+F` | Focus the WHERE filter |
| `Ctrl+E` | Toggle SQL editor |
| `Ctrl+Enter` | Run query (in SQL editor) |
| `Ctrl+R` | Refresh current result set |
| `Ctrl+←` / `Ctrl+→` | Previous / next page |
| `Esc` | Close palette / dialog, or blur the filter |

## Running it

### Development (works anywhere, including WSL)

The Go core is transport-agnostic, so there is a dev HTTP server that exposes exactly
the same API the Wails bindings do. This is how you develop on Linux/WSL without a
native webview installed.

```sh
# terminal 1 — Go API on :34567
go run ./cmd/devserver

# terminal 2 — Vite dev server on :5173, proxying /api to the above
cd frontend && npm install && npm run dev
```

Open <http://localhost:5173>.

### Desktop app

```sh
wails dev                                  # native window with hot reload
wails build -platform windows/amd64        # -> build/bin/db-pro.exe
```

`wails dev` on Linux needs `webkit2gtk-4.1` and `libgtk-3-dev`. Windows needs the
WebView2 runtime (present on Windows 11 and any updated Windows 10).

## Where things live

See [ARCHITECTURE.md](ARCHITECTURE.md). The short version:

```
internal/driver/    one file per dialect, behind a single Driver interface
internal/config/    connection store on disk
internal/engine/    live connections + query execution
internal/api/       the whole API surface, called by both transports
app.go              Wails binding — a thin pass-through to internal/api
cmd/devserver/      HTTP binding — the same, over JSON
frontend/           React + TS + Vite + Tailwind
```

## Credential storage

Passwords currently live in `connections.json` (mode `0600`) under your user config
directory. This is not good enough and is the first thing to fix — see
`docs/adr/0003-credential-storage.md`.
