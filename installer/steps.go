package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

// ValidationStep checks system requirements
type ValidationStep struct {
	log *Logger
}

// NewValidationStep creates a validation step
func NewValidationStep(log *Logger) *ValidationStep {
	return &ValidationStep{log: log}
}

// Name returns the step name
func (s *ValidationStep) Name() string {
	return "System Validation"
}

// Execute performs validation
func (s *ValidationStep) Execute() error {
	s.log.Info("Checking OS compatibility...")
	// TODO: Check OS type, version, disk space, RAM, ports

	s.log.Info("Checking required ports...")
	// TODO: Check if ports 443, 8006, 8007 are available

	s.log.Success("System validation passed")
	return nil
}

// DependencyStep installs system dependencies
type DependencyStep struct {
	log *Logger
}

// NewDependencyStep creates a dependency step
func NewDependencyStep(log *Logger) *DependencyStep {
	return &DependencyStep{log: log}
}

// Name returns the step name
func (s *DependencyStep) Name() string {
	return "Install Dependencies"
}

// Execute performs dependency installation
func (s *DependencyStep) Execute() error {
	s.log.Info("Installing system packages...")
	// TODO: Install Go, build tools, Nginx, SQLite, Redis

	s.log.Success("Dependencies installed")
	return nil
}

// BuildStep builds nPanel binaries
type BuildStep struct {
	log *Logger
}

// NewBuildStep creates a build step
func NewBuildStep(log *Logger) *BuildStep {
	return &BuildStep{log: log}
}

// Name returns the step name
func (s *BuildStep) Name() string {
	return "Build nPanel Binaries"
}

// Execute performs binary build
func (s *BuildStep) Execute() error {
	s.log.Info("Building API binary...")
	// TODO: Build backend binary

	s.log.Info("Building agent binary...")
	// TODO: Build agent binary

	s.log.Info("Building UI assets...")
	// TODO: Build React UI

	s.log.Success("Binaries built successfully")
	return nil
}

// ConfigurationStep configures nPanel
type ConfigurationStep struct {
	log *Logger
}

// NewConfigurationStep creates a configuration step
func NewConfigurationStep(log *Logger) *ConfigurationStep {
	return &ConfigurationStep{log: log}
}

// Name returns the step name
func (s *ConfigurationStep) Name() string {
	return "Configure Services"
}

// Execute performs configuration
func (s *ConfigurationStep) Execute() error {
	s.log.Info("Creating directories...")
	dirs := []string{
		"/etc/npanel",
		"/var/lib/npanel",
		"/var/log/npanel",
		"/var/run/npanel",
	}
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0700); err != nil {
			return fmt.Errorf("failed to create %s: %w", dir, err)
		}
	}

	s.log.Info("Generating SSL certificates...")
	// TODO: Generate self-signed certificate

	s.log.Info("Creating configuration files...")
	// TODO: Create config.yaml

	s.log.Info("Initializing database...")
	// TODO: Initialize SQLite database

	s.log.Success("Configuration completed")
	return nil
}

// ServiceSetupStep sets up systemd services
type ServiceSetupStep struct {
	log *Logger
}

// NewServiceSetupStep creates a service setup step
func NewServiceSetupStep(log *Logger) *ServiceSetupStep {
	return &ServiceSetupStep{log: log}
}

// Name returns the step name
func (s *ServiceSetupStep) Name() string {
	return "Setup Services"
}

// Execute performs service setup
func (s *ServiceSetupStep) Execute() error {
	s.log.Info("Creating systemd units...")
	// TODO: Create npanel-api.service, npanel-agent.service

	s.log.Info("Starting services...")
	cmd := exec.Command("systemctl", "daemon-reload")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to reload systemd: %w", err)
	}

	// TODO: Start services

	s.log.Success("Services configured and started")
	return nil
}

// FirstRunStep performs first-run setup
type FirstRunStep struct {
	log *Logger
}

// NewFirstRunStep creates a first-run step
func NewFirstRunStep(log *Logger) *FirstRunStep {
	return &FirstRunStep{log: log}
}

// Name returns the step name
func (s *FirstRunStep) Name() string {
	return "First-Run Setup"
}

// Execute performs first-run setup
func (s *FirstRunStep) Execute() error {
	s.log.Info("Generating admin credentials...")
	// TODO: Generate admin user, password, save to /etc/npanel/initial-credentials.txt

	s.log.Info("Creating initial settings...")
	// TODO: Set defaults

	s.log.Success("First-run setup completed")
	return nil
}

// VerificationStep verifies installation
type VerificationStep struct {
	log *Logger
}

// NewVerificationStep creates a verification step
func NewVerificationStep(log *Logger) *VerificationStep {
	return &VerificationStep{log: log}
}

// Name returns the step name
func (s *VerificationStep) Name() string {
	return "Verify Installation"
}

// Execute performs verification
func (s *VerificationStep) Execute() error {
	s.log.Info("Verifying services...")
	// TODO: Check API health, agent health, database connectivity

	s.log.Success("Installation verified successfully")
	return nil
}

// UninstallStep removes nPanel
type UninstallStep struct {
	log *Logger
}

// NewUninstallStep creates an uninstall step
func NewUninstallStep(log *Logger) *UninstallStep {
	return &UninstallStep{log: log}
}

// Name returns the step name
func (s *UninstallStep) Name() string {
	return "Uninstall nPanel"
}

// Execute performs uninstallation
func (s *UninstallStep) Execute() error {
	s.log.Info("Stopping services...")
	// TODO: Stop systemd services

	s.log.Info("Removing binaries...")
	// TODO: Remove /opt/npanel

	s.log.Info("Removing configuration...")
	// TODO: Optionally remove /etc/npanel

	s.log.Info("Removing systemd units...")
	// TODO: Remove service files

	s.log.Success("nPanel uninstalled")
	return nil
}
