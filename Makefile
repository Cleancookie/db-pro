# db-pro build targets.
#
#   make            list the targets
#   make windows    build build/bin/db-pro.exe   <- the usual one
#   make check      fmt, vet, typecheck, all tests
#
# Recipes use real tabs. Keep it that way.

SHELL := /bin/bash
.DEFAULT_GOAL := help

BIN_DIR   := build/bin
EXE       := $(BIN_DIR)/db-pro.exe
FRONTEND  := frontend
DIST      := $(FRONTEND)/dist
NODE_MODS := $(FRONTEND)/node_modules

# Stamped into the binary so a built exe can be traced back to a commit.
VERSION   ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS   := -X main.version=$(VERSION)

# Sources that should trigger a rebuild.
GO_SRC    := $(shell find . -name '*.go' -not -path './frontend/*' 2>/dev/null)
WEB_SRC   := $(shell find $(FRONTEND)/src -type f 2>/dev/null) \
             $(FRONTEND)/index.html $(FRONTEND)/vite.config.ts $(FRONTEND)/package.json

.PHONY: help
help:
	@echo 'db-pro'
	@echo
	@echo '  make windows      cross-compile $(EXE)'
	@echo '  make frontend     build the web bundle only'
	@echo '  make dev          run the API dev server (pair with: make web)'
	@echo '  make web          run the Vite dev server on :5173'
	@echo
	@echo '  make check        fmt + vet + typecheck + all tests'
	@echo '  make hooks        install the commit-msg hook (once per clone)'
	@echo '  make test         Go and frontend unit tests'
	@echo '  make fmt          gofmt the Go sources'
	@echo
	@echo '  make db-up        start the MySQL/MariaDB/Postgres test containers'
	@echo '  make db-up-all    ...including SQL Server (~2GB RAM)'
	@echo '  make db-down      stop them'
	@echo '  make db-reset     stop them and delete their data volumes'
	@echo
	@echo '  make clean        remove build output'
	@echo '  make version      show the version that would be stamped in'

# --- builds ------------------------------------------------------------------------

.PHONY: windows
windows: $(EXE)
	@echo "built $(EXE) ($(VERSION))"
	@ls -lh $(EXE) | awk '{print "  size: " $$5}'

# -s skips Wails' own frontend step, since $(DIST) is already a prerequisite.
# Cross-compiling to Windows works from Linux because every driver is pure Go
# and the Windows webview binding needs no cgo.
$(EXE): $(GO_SRC) $(DIST) wails.json
	@mkdir -p $(BIN_DIR)
	wails build -platform windows/amd64 -s -ldflags "$(LDFLAGS)" -o db-pro.exe

.PHONY: frontend
frontend: $(DIST)

$(DIST): $(NODE_MODS) $(WEB_SRC)
	cd $(FRONTEND) && npm run build
	@touch $(DIST)

$(NODE_MODS): $(FRONTEND)/package-lock.json
	cd $(FRONTEND) && npm install
	@touch $(NODE_MODS)

# A native build for the host platform. Linux needs webkit2gtk-4.1 and
# libgtk-3-dev; macOS must be built on macOS — Wails v2 cannot cross-compile
# to either, unlike Windows.
.PHONY: native
native: $(DIST)
	wails build -s -ldflags "$(LDFLAGS)"

# --- development -------------------------------------------------------------------

.PHONY: dev
dev:
	go run ./cmd/devserver

.PHONY: web
web: $(NODE_MODS)
	cd $(FRONTEND) && npm run dev

# Native window with hot reload. Needs a working local webview.
.PHONY: wails-dev
wails-dev: $(NODE_MODS)
	wails dev

# --- quality -----------------------------------------------------------------------

.PHONY: check
check: fmt vet typecheck test
	@echo "all checks passed"

.PHONY: fmt
fmt:
	gofmt -w $(GO_SRC)

.PHONY: vet
vet:
	go vet ./...

.PHONY: typecheck
typecheck: $(NODE_MODS)
	cd $(FRONTEND) && npx tsc --noEmit

.PHONY: test
test: test-go test-web

.PHONY: test-go
test-go:
	go test ./...

.PHONY: test-web
test-web: $(NODE_MODS)
	cd $(FRONTEND) && npx vitest run

# --- test databases ----------------------------------------------------------------

.PHONY: db-up
db-up:
	docker compose up -d mysql mariadb postgres

.PHONY: db-up-all
db-up-all:
	docker compose --profile mssql up -d

.PHONY: db-down
db-down:
	docker compose --profile mssql down

# Drops the volumes too, so the seed scripts run again on next start.
.PHONY: db-reset
db-reset:
	docker compose --profile mssql down -v

# --- git ---------------------------------------------------------------------------

# Git does not carry hooks through a clone, so this has to be run once per
# working copy. core.hooksPath points at the tracked directory rather than
# copying, so an edit to the hook takes effect without reinstalling.
.PHONY: hooks
hooks:
	git config core.hooksPath .githooks
	@echo "hooks installed (core.hooksPath=.githooks)"

# --- housekeeping ------------------------------------------------------------------

.PHONY: clean
clean:
	rm -rf $(BIN_DIR)
	rm -rf $(DIST)
	@echo "removed build output (frontend/node_modules kept — use distclean)"

.PHONY: distclean
distclean: clean
	rm -rf $(NODE_MODS)

.PHONY: version
version:
	@echo $(VERSION)
