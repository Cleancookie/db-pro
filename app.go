package main

import (
	"context"
	"io"
	"log"
	"path/filepath"

	"github.com/alexlaw/db-pro/internal/activity"
	"github.com/alexlaw/db-pro/internal/api"
	"github.com/alexlaw/db-pro/internal/config"
	"github.com/alexlaw/db-pro/internal/driver"
	"github.com/alexlaw/db-pro/internal/engine"
)

// App is the struct Wails binds to the frontend. Every method is a
// pass-through to api.Service — any logic that appears here is a bug, because
// cmd/devserver would not have it. See docs/adr/0001-go-core-with-two-transports.md.
type App struct {
	ctx context.Context
	svc *api.Service
	// logFile is held only so it can be closed on shutdown.
	logFile io.Closer
}

func NewApp() (*App, error) {
	dir, err := config.DefaultDir()
	if err != nil {
		return nil, err
	}
	// Before anything else that might log. A Windows GUI binary has no stdout,
	// so without this every log line is discarded and a slow launch cannot be
	// diagnosed after the fact.
	logFile, err := config.OpenLog(dir)
	if err != nil {
		// Not fatal: the app works fine, it just cannot be investigated later.
		log.Printf("db-pro: continuing without a log file: %v", err)
	}
	store, err := config.Open(dir)
	if err != nil {
		return nil, err
	}
	settings, err := config.OpenSettings(filepath.Join(dir, "settings.json"))
	if err != nil {
		return nil, err
	}
	return &App{
		svc:     api.New(store, settings, engine.New(), activity.New()),
		logFile: logFile,
	}, nil
}

// LogClient records a line measured in the webview.
//
// Startup timing is only knowable from the frontend — the webview boot and the
// bundle parse both happen before any Go code runs again — so the numbers have
// to come back across the binding to reach the log file.
func (a *App) LogClient(line string) { log.Printf("client: %s", line) }

func (a *App) startup(ctx context.Context) { a.ctx = ctx }

func (a *App) shutdown(context.Context) {
	a.svc.Shutdown()
	if a.logFile != nil {
		_ = a.logFile.Close()
	}
}

func (a *App) Drivers() map[driver.Kind]driver.Capabilities { return a.svc.Drivers() }

func (a *App) ListConnections() []config.Connection { return a.svc.ListConnections() }

func (a *App) SaveConnection(req api.SaveConnectionRequest) (config.Connection, error) {
	return a.svc.SaveConnection(req)
}

func (a *App) DeleteConnection(id string) error { return a.svc.DeleteConnection(id) }

func (a *App) TestConnection(req api.SaveConnectionRequest) error {
	return a.svc.TestConnection(req)
}

func (a *App) Connect(id string) (*api.ConnectResult, error) { return a.svc.Connect(a.ctx, id) }

func (a *App) Disconnect(id string) { a.svc.Disconnect(id) }

func (a *App) ConnectedIDs() []string { return a.svc.ConnectedIDs() }

func (a *App) ListDatabases(id string) ([]driver.Database, error) {
	return a.svc.ListDatabases(a.ctx, id)
}

func (a *App) ListObjects(id, database string) ([]driver.SchemaObject, error) {
	return a.svc.ListObjects(a.ctx, id, database)
}

func (a *App) ListColumns(id string, ref driver.ObjectRef) ([]driver.Column, error) {
	return a.svc.ListColumns(a.ctx, id, ref)
}

func (a *App) ReadRows(req api.ReadRowsRequest) (*api.ReadRowsResult, error) {
	return a.svc.ReadRows(a.ctx, req)
}

func (a *App) ReadCell(req api.ReadCellRequest) (*driver.Cell, error) {
	return a.svc.ReadCell(a.ctx, req)
}

func (a *App) CountRows(req api.CountRowsRequest) (int64, error) {
	return a.svc.CountRows(a.ctx, req)
}

func (a *App) RunSQL(req api.RunSQLRequest) (*driver.ResultSet, error) {
	return a.svc.RunSQL(a.ctx, req)
}

func (a *App) GetSettings() config.Settings { return a.svc.GetSettings() }

func (a *App) SaveSettings(v config.Settings) (config.Settings, error) {
	return a.svc.SaveSettings(v)
}

func (a *App) Activity() api.ActivityResult { return a.svc.Activity() }

func (a *App) CancelQuery(id string) { a.svc.CancelQuery(id) }

func (a *App) ClearQueryHistory() { a.svc.ClearQueryHistory() }
