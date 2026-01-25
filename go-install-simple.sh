#!/bin/bash
# Simple Go 1.23 installation preferring distro repos with binary fallback

# First, try distro package manager
if command -v apt-get &> /dev/null; then
  echo "Installing Go from Ubuntu repos..."
  apt-get update -qq
  if apt-get install -y golang-go 2>&1; then
    echo "SUCCESS: Go installed from repo"
    go version
    exit 0
  fi
elif command -v dnf &> /dev/null; then
  echo "Installing Go from Rocky/AlmaLinux repos..."
  if dnf install -y golang 2>&1; then
    echo "SUCCESS: Go installed from repo"
    go version
    exit 0
  fi
fi

# Fallback: download official binary
echo "Distro repos failed, downloading official Go 1.23 binary..."
mkdir -p /tmp/go-install
cd /tmp/go-install

url="https://go.dev/dl/go1.23.linux-amd64.tar.gz"
echo "URL: $url"

if ! wget "$url" 2>&1 && ! curl -L "$url" -o go1.23.linux-amd64.tar.gz 2>&1; then
  echo "ERROR: Download failed"
  exit 1
fi

tar -xzf go1.23.linux-amd64.tar.gz || exit 1
rm -rf /usr/local/go
mv go /usr/local/ || exit 1
rm -rf /tmp/go-install

echo "export PATH=/usr/local/go/bin:\$PATH" >> /etc/profile.d/go-path.sh
chmod +x /etc/profile.d/go-path.sh
source /etc/profile.d/go-path.sh

echo "SUCCESS: Go 1.23 installed"
/usr/local/go/bin/go version
