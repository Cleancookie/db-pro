package main

import (
	"embed"
	"log"

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
	log.Printf("db-pro %s", version)

	app, err := NewApp()
	if err != nil {
		log.Fatalf("db-pro: %v", err)
	}

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
		OnStartup:  app.startup,
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
