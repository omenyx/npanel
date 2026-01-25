# Debug the Universal Installer Failure

You're getting exit code 1 (generic error). Here's how to debug:

## Quick Debug (Run on your server)

```bash
# Download installer and run with debug
curl -fsSL https://raw.githubusercontent.com/omenyx/npanel/main/install-universal.sh -o /tmp/npanel-install.sh
chmod +x /tmp/npanel-install.sh

# Run with verbose/debug output
bash -x /tmp/npanel-install.sh 2>&1 | tee /tmp/install-debug.log

# Check the last part of log for errors
tail -100 /tmp/install-debug.log | grep -A 10 -B 10 "error\|failed\|Error\|FAILED"
```

## Common Causes of Exit Code 1

### 1. Pre-flight Checks Failed
```bash
# Check these manually:
nproc                    # Should be ≥2 cores
free -h                  # Should be ≥2GB RAM
df -h /opt              # Should be ≥10GB free
df -i /opt              # Should be <90% inode usage
cat /etc/os-release     # Check OS is supported
```

### 2. Network/GitHub Issue
```bash
# Test GitHub connectivity
curl -I https://api.github.com
curl -I https://github.com

# If behind proxy, check connectivity
ping 8.8.8.8
```

### 3. Permission Issues
```bash
# Make sure running as root
id              # Should show uid=0
whoami          # Should show 'root'
```

### 4. Port Conflicts
```bash
# Check if ports are available
netstat -tlnp | grep -E ":80|:443|:8080|:9090"
```

### 5. Existing Installation Conflict
```bash
# Check if already installed
systemctl status npanel-api
ls -la /opt/npanel/
```

## Get More Details

**Share this when asking for help:**
```bash
# Collect system info
echo "=== System Info ===" 
cat /etc/os-release
nproc
free -h
df -h /opt
df -i /opt

# Check connectivity
echo "=== Network ===" 
curl -I https://api.github.com

# Check for existing installation
echo "=== Existing Install ===" 
systemctl status npanel-api 2>&1 || echo "Not installed"
ls -la /opt/npanel/ 2>&1 || echo "Dir doesn't exist"

# Run installer in debug
echo "=== Installer Debug ===" 
curl -fsSL https://raw.githubusercontent.com/omenyx/npanel/main/install-universal.sh | bash -x 2>&1 | tail -50
```

## Solutions by Error Message

### "OS not supported"
- Update your OS (need Ubuntu 20.04+, Debian 11+, Rocky/AlmaLinux 8+)

### "Insufficient resources"
- Need 2+ CPU, 2+ GB RAM, 10+ GB in /opt

### "Root/sudo required"
- Run with: `sudo bash npanel-install.sh`

### "Port already in use"
- Free up ports 80, 443, 8080, 9090, 3000
- Or change config after install

### "GitHub unreachable"
- Check internet: `curl -I https://api.github.com`
- If behind proxy, configure environment variables

### "Failed to download checksums"
- GitHub API might be down (check status)
- Or network/firewall blocking

## Next Steps

1. **Run the debug command above** and capture the output
2. **Check system requirements** manually
3. **Share the error message** - most common causes covered above
4. **If stuck:** Share the last 50 lines of debug output

---

**Your Server:** root@Troll  
**Error:** Exit code 1 (generic error)  
**Needed:** Full debug output to see what actually failed
