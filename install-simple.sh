#!/bin/bash
# nPanel Simplified Installer
# Minimal version to get working quickly

set -euo pipefail

echo "[INFO] nPanel Simplified Installer"
echo "[INFO] Starting Phase 1: Pre-flight checks"

# Phase 1: Pre-flight
if [ ! -f /etc/os-release ]; then
  echo "[ERROR] /etc/os-release not found"
  exit 1
fi

. /etc/os-release
DISTRO="$ID"
VERSION="$VERSION_ID"

echo "[INFO] Detected: $DISTRO $VERSION"

# Check if supported
case "$DISTRO" in
  ubuntu)
    if ! [[ "$VERSION" =~ ^(20.04|22.04|24.04)$ ]]; then
      echo "[ERROR] Ubuntu $VERSION not supported"
      exit 2
    fi
    PKG_MANAGER="apt-get"
    ;;
  debian)
    if ! [[ "$VERSION" =~ ^(11|12)$ ]]; then
      echo "[ERROR] Debian $VERSION not supported"
      exit 2
    fi
    PKG_MANAGER="apt-get"
    ;;
  rocky|almalinux)
    if ! [[ "$VERSION" =~ ^(8|9)$ ]]; then
      echo "[ERROR] $DISTRO $VERSION not supported"
      exit 2
    fi
    PKG_MANAGER="dnf"
    ;;
  *)
    echo "[ERROR] Unsupported OS: $DISTRO"
    exit 2
    ;;
esac

echo "[SUCCESS] OS check passed: $DISTRO $VERSION"

# Check root
if [ $EUID -ne 0 ]; then
  echo "[ERROR] Must run as root"
  exit 4
fi
echo "[SUCCESS] Running as root"

# Check resources
CPU=$(nproc)
MEM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
MEM_GB=$((MEM_KB / 1024 / 1024))
DISK_KB=$(df /opt 2>/dev/null | tail -1 | awk '{print $4}' || echo 0)
DISK_GB=$((DISK_KB / 1024 / 1024))

echo "[INFO] Resources: CPU=$CPU MEM=${MEM_GB}GB DISK=${DISK_GB}GB"

if [ "$CPU" -lt 2 ] || [ "$MEM_GB" -lt 2 ] || [ "$DISK_GB" -lt 10 ]; then
  echo "[ERROR] Insufficient resources"
  exit 3
fi

echo "[SUCCESS] Resource check passed"

# Check GitHub
if ! curl --connect-timeout 5 -fsSL "https://api.github.com" > /dev/null 2>&1; then
  echo "[ERROR] Cannot reach GitHub API"
  exit 6
fi
echo "[SUCCESS] GitHub connectivity OK"

echo ""
echo "[SUCCESS] =========================================="
echo "[SUCCESS] ALL PRE-FLIGHT CHECKS PASSED"
echo "[SUCCESS] System ready for nPanel installation"
echo "[SUCCESS] =========================================="
