package main

import (
	"bufio"
	"exec"
	"fmt"
	"os"
	"path/filepath"
)

// InstallerConfig holds installer configuration
type InstallerConfig struct {
	Debug bool
}

// Installer manages the installation process
type Installer struct {
	config *InstallerConfig
	log    *Logger
}

// NewInstaller creates a new installer instance
func NewInstaller(config *InstallerConfig) *Installer {
	return &Installer{
		config: config,
		log:    NewLogger(config.Debug),
	}
}

// Install performs a full nPanel installation
func (i *Installer) Install() error {
	steps := []Step{
		NewValidationStep(i.log),
		NewDependencyStep(i.log),
		NewBuildStep(i.log),
		NewConfigurationStep(i.log),
		NewServiceSetupStep(i.log),
		NewFirstRunStep(i.log),
		NewVerificationStep(i.log),
	}

	for idx, step := range steps {
		fmt.Printf("\n[Phase %d/%d] %s...\n", idx+1, len(steps), step.Name())
		if err := step.Execute(); err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: %s failed: %v\n", step.Name(), err)
			return err
		}
	}

	return i.printSuccess()
}

// Uninstall removes nPanel from the system
func (i *Installer) Uninstall() error {
	i.log.Info("Uninstalling nPanel...")

	steps := []Step{
		NewUninstallStep(i.log),
	}

	for _, step := range steps {
		if err := step.Execute(); err != nil {
			return err
		}
	}

	return nil
}

// Reinstall reinstalls nPanel while preserving data
func (i *Installer) Reinstall() error {
	i.log.Info("Reinstalling nPanel...")

	// Backup data
	if err := backupData(); err != nil {
		return fmt.Errorf("backup failed: %w", err)
	}

	// Uninstall
	if err := i.Uninstall(); err != nil {
		return err
	}

	// Install
	if err := i.Install(); err != nil {
		return err
	}

	// Restore data
	if err := restoreData(); err != nil {
		return fmt.Errorf("restore failed: %w", err)
	}

	return nil
}

// printSuccess displays success information
func (i *Installer) printSuccess() error {
	fmt.Println("\n╔════════════════════════════════════════════════════════╗")
	fmt.Println("║              Installation Successful! ✓               ║")
	fmt.Println("╚════════════════════════════════════════════════════════╝")
	fmt.Println()

	// Read credentials
	credPath := "/etc/npanel/initial-credentials.txt"
	if file, err := os.Open(credPath); err == nil {
		defer file.Close()
		fmt.Println("Initial Login Credentials:")
		fmt.Println("──────────────────────────")
		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			fmt.Printf("  %s\n", scanner.Text())
		}
	}

	fmt.Println()
	fmt.Println("Next Steps:")
	fmt.Println("──────────")
	fmt.Println("  1. Open https://your-server-ip in your browser")
	fmt.Println("  2. Login with credentials above")
	fmt.Println("  3. Change your password (required on first login)")
	fmt.Println("  4. Configure SSL certificate (Let's Encrypt recommended)")
	fmt.Println("  5. Create hosting packages and user accounts")
	fmt.Println()
	fmt.Println("Documentation:")
	fmt.Println("──────────────")
	fmt.Println("  Architecture: cat /opt/npanel/docs/ARCHITECTURE.md")
	fmt.Println("  Deployment: cat /opt/npanel/docs/DEPLOYMENT.md")
	fmt.Println("  CLI Reference: npanel-cli --help")
	fmt.Println()

	return nil
}

// Helper functions

func backupData() error {
	// TODO: Implement data backup
	return nil
}

func restoreData() error {
	// TODO: Implement data restore
	return nil
}

// Step interface for installer steps
type Step interface {
	Name() string
	Execute() error
}

// Logger provides installation logging
type Logger struct {
	debug bool
}

// NewLogger creates a new logger
func NewLogger(debug bool) *Logger {
	return &Logger{debug: debug}
}

// Info logs an info message
func (l *Logger) Info(msg string, args ...interface{}) {
	if l.debug {
		fmt.Printf("[INFO] "+msg+"\n", args...)
	}
}

// Error logs an error message
func (l *Logger) Error(msg string, args ...interface{}) {
	fmt.Fprintf(os.Stderr, "[ERROR] "+msg+"\n", args...)
}

// Success logs a success message
func (l *Logger) Success(msg string) {
	fmt.Printf("✓ %s\n", msg)
}
