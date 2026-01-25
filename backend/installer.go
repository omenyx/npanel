package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// OSType represents the operating system
type OSType string

const (
	OSAlmaLinux OSType = "almalinux"
	OSRHEL      OSType = "rhel"
	OSUbuntu    OSType = "ubuntu"
	OSUnknown   OSType = "unknown"
)

// SystemInfo holds system information
type SystemInfo struct {
	OS           OSType
	Version      string
	Architecture string
	HasRoot      bool
}

// Installer handles nPanel installation
type Installer struct {
	System SystemInfo
	Config *InstallerConfig
}

// InstallerConfig holds installation configuration
type InstallerConfig struct {
	AdminEmail    string
	AdminPassword string
	Domain        string
	Port          int
	UseSSL        bool
	DataPath      string
}

// DetectOS detects the operating system
func DetectOS() (SystemInfo, error) {
	info := SystemInfo{
		OS:           OSUnknown,
		Architecture: getArchitecture(),
		HasRoot:      os.Geteuid() == 0,
	}

	// Check /etc/os-release
	osRelease, err := readOSRelease()
	if err != nil {
		return info, fmt.Errorf("failed to detect OS: %w", err)
	}

	// Determine OS type
	lowerID := strings.ToLower(osRelease["ID"])
	switch {
	case strings.Contains(lowerID, "almalinux"):
		info.OS = OSAlmaLinux
		info.Version = osRelease["VERSION_ID"]
	case strings.Contains(lowerID, "rhel") || strings.Contains(lowerID, "red hat"):
		info.OS = OSRHEL
		info.Version = osRelease["VERSION_ID"]
	case strings.Contains(lowerID, "ubuntu"):
		info.OS = OSUbuntu
		info.Version = osRelease["VERSION_ID"]
	default:
		return info, fmt.Errorf("unsupported OS: %s", osRelease["ID"])
	}

	return info, nil
}

// readOSRelease reads /etc/os-release
func readOSRelease() (map[string]string, error) {
	data, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return nil, err
	}

	result := make(map[string]string)
	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			key := strings.TrimSpace(parts[0])
			value := strings.Trim(strings.TrimSpace(parts[1]), "\"")
			result[key] = value
		}
	}

	return result, nil
}

// getArchitecture returns system architecture
func getArchitecture() string {
	output, err := exec.Command("uname", "-m").Output()
	if err != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(output))
}

// InstallDependencies installs required packages
func (installer *Installer) InstallDependencies() error {
	fmt.Println("📦 Installing dependencies...")

	switch installer.System.OS {
	case OSAlmaLinux, OSRHEL:
		return installer.installAlmaLinuxDeps()
	case OSUbuntu:
		return installer.installUbuntuDeps()
	default:
		return fmt.Errorf("unsupported OS: %v", installer.System.OS)
	}
}

// installAlmaLinuxDeps installs dependencies for AlmaLinux/RHEL
func (installer *Installer) installAlmaLinuxDeps() error {
	packages := []string{
		"git",
		"curl",
		"wget",
		"vim",
		"nano",
		"net-tools",
		"bind",
		"bind-utils",
		"postfix",
		"dovecot",
		"mariadb-server",
		"nginx",
		"openssl",
		"python3",
		"python3-pip",
	}

	fmt.Println("📦 Installing packages for AlmaLinux/RHEL...")

	// Update system
	fmt.Println("🔄 Updating system packages...")
	if err := runCommand("dnf", "update", "-y"); err != nil {
		return fmt.Errorf("failed to update system: %w", err)
	}

	// Install packages
	args := append([]string{"install", "-y"}, packages...)
	if err := runCommand("dnf", args...); err != nil {
		return fmt.Errorf("failed to install packages: %w", err)
	}

	fmt.Println("✓ AlmaLinux/RHEL dependencies installed")
	return nil
}

// installUbuntuDeps installs dependencies for Ubuntu
func (installer *Installer) installUbuntuDeps() error {
	packages := []string{
		"git",
		"curl",
		"wget",
		"vim",
		"nano",
		"net-tools",
		"bind9",
		"bind9-dnsutils",
		"postfix",
		"dovecot-core",
		"dovecot-imapd",
		"mysql-server",
		"nginx",
		"openssl",
		"python3",
		"python3-pip",
	}

	fmt.Println("📦 Installing packages for Ubuntu...")

	// Update system
	fmt.Println("🔄 Updating system packages...")
	if err := runCommand("apt-get", "update"); err != nil {
		return fmt.Errorf("failed to update system: %w", err)
	}

	if err := runCommand("apt-get", "upgrade", "-y"); err != nil {
		return fmt.Errorf("failed to upgrade system: %w", err)
	}

	// Install packages
	args := append([]string{"install", "-y"}, packages...)
	if err := runCommand("apt-get", args...); err != nil {
		return fmt.Errorf("failed to install packages: %w", err)
	}

	fmt.Println("✓ Ubuntu dependencies installed")
	return nil
}

// CreateSystemUser creates system user for nPanel
func (installer *Installer) CreateSystemUser() error {
	fmt.Println("👤 Creating system user...")

	// Check if user exists
	_, err := exec.Command("id", "npanel").Output()
	if err == nil {
		fmt.Println("⚠️  User 'npanel' already exists, skipping creation")
		return nil
	}

	// Create user
	if err := runCommand("useradd", "-r", "-s", "/bin/bash", "-d", "/var/lib/npanel", "npanel"); err != nil {
		return fmt.Errorf("failed to create user: %w", err)
	}

	fmt.Println("✓ System user created")
	return nil
}

// CreateDirectories creates required directories
func (installer *Installer) CreateDirectories() error {
	fmt.Println("📁 Creating directories...")

	dirs := []string{
		"/etc/npanel",
		"/var/lib/npanel",
		"/var/log/npanel",
		"/var/www/npanel",
		"/opt/npanel",
	}

	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("failed to create directory %s: %w", dir, err)
		}
		fmt.Printf("  ✓ %s\n", dir)
	}

	// Set ownership
	if err := runCommand("chown", "-R", "npanel:npanel", "/var/lib/npanel", "/var/log/npanel"); err != nil {
		return fmt.Errorf("failed to set ownership: %w", err)
	}

	fmt.Println("✓ Directories created")
	return nil
}

// ConfigureServices configures system services
func (installer *Installer) ConfigureServices() error {
	fmt.Println("⚙️  Configuring services...")

	// Enable and start services
	services := []string{"nginx", "postfix", "dovecot", "bind"}

	for _, service := range services {
		fmt.Printf("  Configuring %s...\n", service)

		if err := runCommand("systemctl", "daemon-reload"); err != nil {
			return fmt.Errorf("failed to reload systemd: %w", err)
		}

		if err := runCommand("systemctl", "enable", service); err != nil {
			return fmt.Errorf("failed to enable %s: %w", service, err)
		}

		if err := runCommand("systemctl", "start", service); err != nil {
			return fmt.Errorf("failed to start %s: %w", service, err)
		}

		fmt.Printf("  ✓ %s configured\n", service)
	}

	fmt.Println("✓ Services configured")
	return nil
}

// ConfigureFirewall configures firewall rules
func (installer *Installer) ConfigureFirewall() error {
	fmt.Println("🔥 Configuring firewall...")

	// Get firewall command based on OS
	var fwCmd string
	switch installer.System.OS {
	case OSAlmaLinux, OSRHEL:
		fwCmd = "firewall-cmd"
	case OSUbuntu:
		fwCmd = "ufw"
	default:
		fmt.Println("⚠️  Unknown firewall system, skipping configuration")
		return nil
	}

	// Allow ports
	ports := []string{"22", "80", "443", "8443"}
	for _, port := range ports {
		fmt.Printf("  Opening port %s...\n", port)

		switch installer.System.OS {
		case OSAlmaLinux, OSRHEL:
			if err := runCommand(fwCmd, "--permanent", "--add-port="+port+"/tcp"); err != nil {
				return fmt.Errorf("failed to open port %s: %w", port, err)
			}
		case OSUbuntu:
			if err := runCommand(fwCmd, "allow", port); err != nil {
				return fmt.Errorf("failed to open port %s: %w", port, err)
			}
		}
	}

	// Reload firewall
	switch installer.System.OS {
	case OSAlmaLinux, OSRHEL:
		if err := runCommand(fwCmd, "--reload"); err != nil {
			return fmt.Errorf("failed to reload firewall: %w", err)
		}
	case OSUbuntu:
		if err := runCommand("ufw", "enable"); err != nil {
			return fmt.Errorf("failed to enable firewall: %w", err)
		}
	}

	fmt.Println("✓ Firewall configured")
	return nil
}

// DeployApplication deploys the nPanel application
func (installer *Installer) DeployApplication() error {
	fmt.Println("🚀 Deploying application...")

	// Copy binary
	if err := runCommand("cp", "npanel-api", "/opt/npanel/npanel-api"); err != nil {
		return fmt.Errorf("failed to copy binary: %w", err)
	}

	if err := runCommand("chmod", "+x", "/opt/npanel/npanel-api"); err != nil {
		return fmt.Errorf("failed to make binary executable: %w", err)
	}

	// Create systemd service
	serviceContent := `[Unit]
Description=nPanel API Server
After=network.target

[Service]
Type=simple
User=npanel
WorkingDirectory=/opt/npanel
EnvironmentFile=/etc/npanel/.env
ExecStart=/opt/npanel/npanel-api
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`

	if err := os.WriteFile("/etc/systemd/system/npanel-api.service", []byte(serviceContent), 0644); err != nil {
		return fmt.Errorf("failed to create systemd service: %w", err)
	}

	if err := runCommand("systemctl", "daemon-reload"); err != nil {
		return fmt.Errorf("failed to reload systemd: %w", err)
	}

	fmt.Println("✓ Application deployed")
	return nil
}

// GenerateTLSCertificate generates TLS certificate
func (installer *Installer) GenerateTLSCertificate() error {
	fmt.Println("🔐 Generating TLS certificate...")

	certDir := "/etc/npanel/ssl"
	if err := os.MkdirAll(certDir, 0700); err != nil {
		return fmt.Errorf("failed to create cert directory: %w", err)
	}

	certFile := certDir + "/cert.pem"
	keyFile := certDir + "/key.pem"

	// Check if cert already exists
	if _, err := os.Stat(certFile); err == nil {
		fmt.Println("⚠️  Certificate already exists, skipping generation")
		return nil
	}

	// Generate self-signed certificate
	cmd := exec.Command("openssl", "req", "-x509", "-newkey", "rsa:4096",
		"-keyout", keyFile, "-out", certFile,
		"-days", "365", "-nodes",
		"-subj", "/C=US/ST=CA/L=San Francisco/O=nPanel/CN="+installer.Config.Domain)

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to generate certificate: %w", err)
	}

	fmt.Println("✓ TLS certificate generated")
	return nil
}

// VerifyInstallation verifies the installation
func (installer *Installer) VerifyInstallation() error {
	fmt.Println("✅ Verifying installation...")

	checks := []struct {
		name string
		fn   func() error
	}{
		{"API binary exists", func() error {
			_, err := os.Stat("/opt/npanel/npanel-api")
			return err
		}},
		{"Config directory exists", func() error {
			_, err := os.Stat("/etc/npanel")
			return err
		}},
		{"Data directory exists", func() error {
			_, err := os.Stat("/var/lib/npanel")
			return err
		}},
		{"Log directory exists", func() error {
			_, err := os.Stat("/var/log/npanel")
			return err
		}},
		{"Systemd service exists", func() error {
			_, err := os.Stat("/etc/systemd/system/npanel-api.service")
			return err
		}},
		{"TLS certificate exists", func() error {
			_, err := os.Stat("/etc/npanel/ssl/cert.pem")
			return err
		}},
	}

	for _, check := range checks {
		if err := check.fn(); err != nil {
			return fmt.Errorf("%s: %w", check.name, err)
		}
		fmt.Printf("  ✓ %s\n", check.name)
	}

	fmt.Println("✓ Installation verified")
	return nil
}

// runCommand executes a shell command
func runCommand(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// InstallAll runs the complete installation
func (installer *Installer) InstallAll() error {
	fmt.Println("\n╔════════════════════════════════════════════════════════╗")
	fmt.Println("║              nPanel Installation Process              ║")
	fmt.Println("╚════════════════════════════════════════════════════════╝\n")

	fmt.Printf("Detected OS: %v %v\n", installer.System.OS, installer.System.Version)
	fmt.Printf("Architecture: %s\n", installer.System.Architecture)
	fmt.Printf("Root access: %v\n\n", installer.System.HasRoot)

	steps := []struct {
		name string
		fn   func() error
	}{
		{"Installing dependencies", installer.InstallDependencies},
		{"Creating system user", installer.CreateSystemUser},
		{"Creating directories", installer.CreateDirectories},
		{"Configuring services", installer.ConfigureServices},
		{"Configuring firewall", installer.ConfigureFirewall},
		{"Generating TLS certificate", installer.GenerateTLSCertificate},
		{"Deploying application", installer.DeployApplication},
		{"Verifying installation", installer.VerifyInstallation},
	}

	for i, step := range steps {
		fmt.Printf("[%d/%d] %s...\n", i+1, len(steps), step.name)
		if err := step.fn(); err != nil {
			return fmt.Errorf("installation failed at '%s': %w", step.name, err)
		}
		fmt.Println()
	}

	fmt.Println("╔════════════════════════════════════════════════════════╗")
	fmt.Println("║         ✅ Installation Complete!                    ║")
	fmt.Println("╚════════════════════════════════════════════════════════╝")

	return nil
}
