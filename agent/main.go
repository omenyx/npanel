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
	socketFlag := flag.String("socket", "/var/run/npanel/agent.sock", "Unix socket path")
	configFlag := flag.String("config", "/etc/npanel/config.yaml", "Config file path")
	flag.Parse()

	// Verify we're running as root
	if os.Geteuid() != 0 {
		fmt.Fprintf(os.Stderr, "ERROR: nPanel agent must run as root\n")
		os.Exit(1)
	}

	// Print header
	fmt.Println("╔════════════════════════════════════════════════════════╗")
	fmt.Println("║              nPanel Local Agent v1.0.0                ║")
	fmt.Println("║      Privileged System Operations Daemon              ║")
	fmt.Println("╚════════════════════════════════════════════════════════╝")
	fmt.Println()

	// Initialize agent
	agent, err := NewAgent(&AgentConfig{
		Debug:      *debugFlag,
		SocketPath: *socketFlag,
		ConfigPath: *configFlag,
	})
	if err != nil {
		log.Fatalf("Failed to initialize agent: %v", err)
	}

	// Setup signal handling
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGTERM, syscall.SIGINT)

	// Start agent
	fmt.Println("Starting nPanel Agent...")
	go func() {
		if err := agent.Start(); err != nil {
			log.Fatalf("Agent failed: %v", err)
		}
	}()

	// Wait for signal
	sig := <-sigChan
	fmt.Printf("\nReceived signal: %v\n", sig)
	fmt.Println("Shutting down gracefully...")

	if err := agent.Shutdown(); err != nil {
		log.Fatalf("Shutdown error: %v", err)
	}

	fmt.Println("✓ Agent stopped")
}
