#!/bin/bash
# Minimal test installer - just Phase 1 pre-flight checks
# This helps debug which check is failing

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}[INFO]${NC} nPanel Installer - Phase 1 Test"
echo ""

# Test 1: OS Detection
echo -e "${BLUE}[TEST 1]${NC} Checking OS..."
if [ ! -f /etc/os-release ]; then
  echo -e "${RED}✗${NC} /etc/os-release not found"
  exit 1
fi
echo -e "${GREEN}✓${NC} /etc/os-release found"

# Source it
if ! . /etc/os-release; then
  echo -e "${RED}✗${NC} Failed to source /etc/os-release"
  exit 1
fi
echo -e "${GREEN}✓${NC} Sourced /etc/os-release"

# Get values
DISTRO="${ID:-unknown}"
VERSION="${VERSION_ID:-unknown}"
echo -e "${GREEN}✓${NC} Detected: $DISTRO $VERSION"

# Check if supported
case "$DISTRO" in
  ubuntu)
    if [[ "$VERSION" =~ ^(20.04|22.04|24.04)$ ]]; then
      echo -e "${GREEN}✓${NC} Ubuntu $VERSION supported"
    else
      echo -e "${RED}✗${NC} Ubuntu version $VERSION not supported (need 20.04, 22.04, or 24.04)"
      exit 2
    fi
    ;;
  debian)
    if [[ "$VERSION" =~ ^(11|12)$ ]]; then
      echo -e "${GREEN}✓${NC} Debian $VERSION supported"
    else
      echo -e "${RED}✗${NC} Debian version $VERSION not supported (need 11 or 12)"
      exit 2
    fi
    ;;
  rocky|almalinux)
    if [[ "$VERSION" =~ ^(8|9)$ ]]; then
      echo -e "${GREEN}✓${NC} $DISTRO $VERSION supported"
    else
      echo -e "${RED}✗${NC} $DISTRO version $VERSION not supported (need 8 or 9)"
      exit 2
    fi
    ;;
  *)
    echo -e "${RED}✗${NC} Unsupported OS: $DISTRO"
    exit 2
    ;;
esac

echo ""

# Test 2: Root check
echo -e "${BLUE}[TEST 2]${NC} Checking root permissions..."
if [ $EUID -ne 0 ]; then
  echo -e "${RED}✗${NC} Not running as root (UID: $EUID)"
  exit 4
fi
echo -e "${GREEN}✓${NC} Running as root (UID: 0)"

echo ""

# Test 3: Resources
echo -e "${BLUE}[TEST 3]${NC} Checking system resources..."

# CPU
CPU=$(nproc)
echo "  CPU cores: $CPU"
if [ "$CPU" -lt 2 ]; then
  echo -e "  ${YELLOW}⚠${NC} Recommended: ≥2 cores"
fi

# RAM
MEM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
MEM_GB=$((MEM_KB / 1024 / 1024))
echo "  Memory: ${MEM_GB}GB"
if [ "$MEM_GB" -lt 2 ]; then
  echo -e "  ${YELLOW}⚠${NC} Recommended: ≥2GB"
fi

# Disk
if [ -d /opt ]; then
  DISK_KB=$(df /opt 2>/dev/null | tail -1 | awk '{print $4}' || echo 0)
  DISK_GB=$((DISK_KB / 1024 / 1024))
  echo "  Disk /opt: ${DISK_GB}GB free"
  if [ "$DISK_GB" -lt 10 ]; then
    echo -e "${RED}✗${NC} Need ≥10GB in /opt"
    exit 3
  fi
else
  echo -e "${RED}✗${NC} /opt directory doesn't exist"
  exit 3
fi

# Inodes
INODE_PCT=$(df -i /opt 2>/dev/null | tail -1 | awk '{print $5}' | sed 's/%//' || echo 100)
echo "  Inodes /opt: ${INODE_PCT}% used"
if [ "$INODE_PCT" -gt 90 ]; then
  echo -e "${RED}✗${NC} Inodes >90% used"
  exit 3
fi

echo -e "${GREEN}✓${NC} All resource checks passed"

echo ""

# Test 4: GitHub connectivity
echo -e "${BLUE}[TEST 4]${NC} Checking GitHub connectivity..."
if curl --connect-timeout 5 -fsSL "https://api.github.com" > /dev/null 2>&1; then
  echo -e "${GREEN}✓${NC} GitHub API accessible"
else
  echo -e "${RED}✗${NC} Cannot reach GitHub API"
  echo "  Check your internet connection and firewall"
  exit 6
fi

echo ""
echo -e "${GREEN}✓${NC} All Phase 1 checks PASSED!"
echo ""
echo "System ready for nPanel installation"
