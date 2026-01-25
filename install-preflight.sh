#!/bin/bash
# Pre-flight checks for nPanel Universal Installer
# Simplified version with Ubuntu 24.04 support

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}[INFO]${NC} nPanel Installer - Pre-flight Checks"
echo ""

# Test 1: OS Detection
echo -e "${BLUE}[TEST 1]${NC} Checking OS..."
if [ ! -f /etc/os-release ]; then
  echo -e "${RED}✗${NC} /etc/os-release not found"
  exit 1
fi

if ! . /etc/os-release; then
  echo -e "${RED}✗${NC} Failed to source /etc/os-release"
  exit 1
fi

DISTRO="${ID:-unknown}"
VERSION="${VERSION_ID:-unknown}"
echo -e "${GREEN}✓${NC} Detected: $DISTRO $VERSION"

# Validate OS
case "$DISTRO" in
  ubuntu)
    if [[ "$VERSION" =~ ^(20.04|22.04|24.04)$ ]]; then
      echo -e "${GREEN}✓${NC} Ubuntu $VERSION is supported"
    else
      echo -e "${RED}✗${NC} Ubuntu $VERSION is NOT supported"
      echo "   Supported versions: 20.04 LTS, 22.04 LTS, 24.04"
      exit 2
    fi
    ;;
  debian)
    if [[ "$VERSION" =~ ^(11|12)$ ]]; then
      echo -e "${GREEN}✓${NC} Debian $VERSION is supported"
    else
      echo -e "${RED}✗${NC} Debian $VERSION is NOT supported"
      echo "   Supported versions: 11, 12"
      exit 2
    fi
    ;;
  rocky|almalinux)
    if [[ "$VERSION" =~ ^(8|9)$ ]]; then
      echo -e "${GREEN}✓${NC} $DISTRO $VERSION is supported"
    else
      echo -e "${RED}✗${NC} $DISTRO $VERSION is NOT supported"
      echo "   Supported versions: 8, 9"
      exit 2
    fi
    ;;
  *)
    echo -e "${RED}✗${NC} Unsupported OS: $DISTRO"
    echo "   Supported: Ubuntu (20.04/22.04/24.04), Debian (11/12), Rocky (8/9), AlmaLinux (8/9)"
    exit 2
    ;;
esac

echo ""

# Test 2: Root check
echo -e "${BLUE}[TEST 2]${NC} Checking permissions..."
if [ $EUID -ne 0 ]; then
  echo -e "${RED}✗${NC} Must run as root (UID: $EUID)"
  exit 4
fi
echo -e "${GREEN}✓${NC} Running as root"

echo ""

# Test 3: Resources
echo -e "${BLUE}[TEST 3]${NC} Checking system resources..."

CPU=$(nproc)
echo "   CPU cores: $CPU"

MEM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
MEM_GB=$((MEM_KB / 1024 / 1024))
echo "   Memory: ${MEM_GB}GB"

if [ -d /opt ]; then
  DISK_KB=$(df /opt 2>/dev/null | tail -1 | awk '{print $4}' || echo 0)
  DISK_GB=$((DISK_KB / 1024 / 1024))
  echo "   Disk /opt: ${DISK_GB}GB free"
  if [ "$DISK_GB" -lt 10 ]; then
    echo -e "${RED}✗${NC} Need at least 10GB in /opt (have ${DISK_GB}GB)"
    exit 3
  fi
else
  echo -e "${RED}✗${NC} /opt directory doesn't exist"
  exit 3
fi

INODE_PCT=$(df -i /opt 2>/dev/null | tail -1 | awk '{print $5}' | sed 's/%//' || echo 100)
echo "   Inodes /opt: ${INODE_PCT}% used"
if [ "$INODE_PCT" -gt 90 ]; then
  echo -e "${RED}✗${NC} Inodes over 90% used (have ${INODE_PCT}%)"
  exit 3
fi

echo -e "${GREEN}✓${NC} All resource checks passed"

echo ""

# Test 4: GitHub connectivity
echo -e "${BLUE}[TEST 4]${NC} Checking GitHub connectivity..."
if curl --connect-timeout 5 -fsSL "https://api.github.com" > /dev/null 2>&1; then
  echo -e "${GREEN}✓${NC} GitHub API is reachable"
else
  echo -e "${RED}✗${NC} Cannot reach GitHub API"
  echo "   Check your internet connection and firewall"
  exit 6
fi

echo ""
echo -e "${GREEN}✓✓✓ ALL PRE-FLIGHT CHECKS PASSED ✓✓✓${NC}"
echo ""
echo "Your system is ready for nPanel installation!"
echo ""
echo "Next step:"
echo "  curl -fsSL https://raw.githubusercontent.com/omenyx/npanel/main/install-universal.sh | bash"
