package main

import (
	"context"
	"embed"
	"log"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

// version is stamped at link time by the Makefile
// (-ldflags "-X main.version=..."). It is the git describe of the build.
var version = "dev"

func main() {
	start := time.Now()
	log.Printf("db-pro %s", version)

	app, err := NewApp()
	if err != nil {
		log.Fatalf("db-pro: %v", err)
	}
	// Config and settings are two small file reads, so this should be single
	// -digit milliseconds. It is logged because "the app is slow to launch" is
	// otherwise impossible to attribute: the webview boot dominates, and
	// without a number here there is no way to rule this side out.
	log.Printf("db-pro: config loaded in %s", time.Since(start).Round(time.Millisecond))

	err = wails.Run(&options.App{
		Title:  "db-pro",
		Width:  1440,
		Height: 900,
		// Below this the sidebar and grid stop being usable together.
		MinWidth:  900,
		MinHeight: 560,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		OnStartup: func(ctx context.Context) {
			// The gap between this and the config line above is the webview
			// starting; the gap to the frontend's own first mark is the bundle
			// parsing. Between the three, a slow launch can be attributed.
			log.Printf("db-pro: webview ready in %s", time.Since(start).Round(time.Millisecond))
			app.startup(ctx)
		},
		OnShutdown: app.shutdown,
		Bind: []any{
			app,
		},
		Windows: &windows.Options{
			// The UI is dark and draws its own chrome background; without this
			// the window flashes white while the webview boots.
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
		},
	})
	if err != nil {
		log.Fatalf("db-pro: %v", err)
	}
}
