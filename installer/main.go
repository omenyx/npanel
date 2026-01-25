package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"runtime"
)

func main() {
	// Parse command-line flags
	uninstallFlag := flag.Bool("uninstall", false, "Uninstall nPanel")
	reinstallFlag := flag.Bool("reinstall", false, "Reinstall nPanel (preserves data)")
	debugFlag := flag.Bool("debug", false, "Enable debug logging")
	flag.Parse()

	// Verify we're running as root
	if os.Geteuid() != 0 {
		fmt.Fprintf(os.Stderr, "ERROR: nPanel installer must run as root\n")
		os.Exit(1)
	}

	// Print header
	fmt.Println("╔════════════════════════════════════════════════════════╗")
	fmt.Println("║            nPanel Production Installer v1.0.0          ║")
	fmt.Println("║  Production-Grade Hosting Control Panel for Linux      ║")
	fmt.Println("╚════════════════════════════════════════════════════════╝")
	fmt.Println()

	// Determine OS
	if runtime.GOOS != "linux" {
		fmt.Fprintf(os.Stderr, "ERROR: nPanel only supports Linux (detected: %s)\n", runtime.GOOS)
		os.Exit(1)
	}

	// Initialize installer context
	installer := NewInstaller(&InstallerConfig{
		Debug: *debugFlag,
	})

	// Handle flags
	switch {
	case *uninstallFlag:
		fmt.Println("Starting uninstall process...")
		if err := installer.Uninstall(); err != nil {
			log.Fatalf("Uninstall failed: %v", err)
		}
		fmt.Println("\n✓ nPanel uninstalled successfully")
		os.Exit(0)

	case *reinstallFlag:
		fmt.Println("Starting reinstall process (data preserved)...")
		if err := installer.Reinstall(); err != nil {
			log.Fatalf("Reinstall failed: %v", err)
		}
		fmt.Println("\n✓ nPanel reinstalled successfully")
		os.Exit(0)

	default:
		fmt.Println("Starting installation process...")
		if err := installer.Install(); err != nil {
			log.Fatalf("Installation failed: %v", err)
		}
		fmt.Println("\n✓ nPanel installed successfully")
		os.Exit(0)
	}
}
