package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	// Parse command-line flags
	debugFlag := flag.Bool("debug", false, "Enable debug logging")
	portFlag := flag.Int("port", 443, "HTTPS port")
	configFlag := flag.String("config", "/etc/npanel/config.yaml", "Config file path")
	initDBFlag := flag.Bool("init-db", false, "Initialize database and exit")
	flag.Parse()

	// Print header
	fmt.Println("╔════════════════════════════════════════════════════════╗")
	fmt.Println("║              nPanel API Server v1.0.0                 ║")
	fmt.Println("║           REST API & Orchestration Engine            ║")
	fmt.Println("╚════════════════════════════════════════════════════════╝")
	fmt.Println()

	// Initialize API server
	server, err := NewAPIServer(&APIServerConfig{
		Debug:      *debugFlag,
		Port:       *portFlag,
		ConfigPath: *configFlag,
	})
	if err != nil {
		log.Fatalf("Failed to initialize API server: %v", err)
	}

	// Handle init-db flag
	if *initDBFlag {
		fmt.Println("Initializing database...")
		if err := server.InitializeDatabase(); err != nil {
			log.Fatalf("Database initialization failed: %v", err)
		}
		fmt.Println("✓ Database initialized")
		os.Exit(0)
	}

	// Setup signal handling
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGTERM, syscall.SIGINT)

	// Start server
	fmt.Printf("Starting nPanel API on port %d...\n", *portFlag)
	go func() {
		if err := server.Start(); err != nil {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	// Wait for signal
	sig := <-sigChan
	fmt.Printf("\nReceived signal: %v\n", sig)
	fmt.Println("Shutting down gracefully...")

	if err := server.Shutdown(); err != nil {
		log.Fatalf("Shutdown error: %v", err)
	}

	fmt.Println("✓ API server stopped")
}
