# Installer Files - Which One to Use?

**TL;DR: Use `install-universal.sh` - it's the current recommended installer**

---

## 📋 Current Installer Files

| File | Status | Use Case | Lines | Recommendation |
|---|---|---|---|---|
| **install-universal.sh** | ✅ CURRENT | All deployments | 600+ | 🎯 **USE THIS** |
| install-production.sh | ⚠️ LEGACY | Specific prod setup only | 700+ | Archive |
| install.sh | ⚠️ LEGACY | Initial basic setup | 546+ | Archive |

---

## 🎯 CURRENT INSTALLER (Recommended)

### `install-universal.sh`
- **Status:** ✅ Production-ready (v1.0.0)
- **Purpose:** Universal installer for all scenarios
- **Works on:** AlmaLinux, Rocky, Ubuntu, Debian
- **Features:** 7-phase, fail-fast, idempotent, rollback-capable
- **Use for:** Fresh install, upgrade, repair - ALL deployments
- **Installation:**
  ```bash
  curl -fsSL https://raw.githubusercontent.com/omenyx/npanel/main/install-universal.sh | bash
  ```

---

## 🗃️ LEGACY INSTALLERS (Archive)

### `install-production.sh`
- **Status:** ⚠️ Superseded by install-universal.sh
- **Purpose:** Production-specific installer (verbose, enhanced error handling)
- **Works on:** Ubuntu/Debian primarily
- **Why not use:** install-universal.sh is better (cross-distro, idempotent)
- **Recommendation:** Archive for historical reference

### `install.sh`
- **Status:** ⚠️ Very old (basic initial version)
- **Purpose:** Initial basic installation
- **Works on:** Ubuntu/Debian only
- **Why not use:** install-universal.sh has all features + more
- **Recommendation:** Archive for historical reference

---

## ✅ Cleanup Plan

```bash
# 1. Verify install-universal.sh is working
curl -fsSL https://raw.githubusercontent.com/omenyx/npanel/main/install-universal.sh -o /tmp/test-universal.sh
bash /tmp/test-universal.sh --debug

# 2. Once verified, archive old installers
cd c:\Users\najib\Downloads\Npanel

# Create archive directory
mkdir -p .archive

# Move old installers
mv install-production.sh .archive/
mv install.sh .archive/

# Commit cleanup
git add .archive/
git commit -m "Archive legacy installers - use install-universal.sh"
git push origin main
```

---

## 🚀 What to Use Going Forward

**For ANY new deployment:**
```bash
curl -fsSL https://raw.githubusercontent.com/omenyx/npanel/main/install-universal.sh | bash
```

**Why install-universal.sh is better:**
- ✅ Works on 4 OS families (not just Ubuntu/Debian)
- ✅ 7 phases with comprehensive checks
- ✅ Idempotent (safe to run 100x)
- ✅ Atomic deployment with rollback
- ✅ Better error handling & recovery
- ✅ Complete logging & debug mode
- ✅ Handles fresh/upgrade/repair modes

---

## 📚 Documentation

- **Quick Start:** [INSTALLER_QUICK_START.md](INSTALLER_QUICK_START.md)
- **Architecture:** [INSTALLER_ARCHITECTURE.md](INSTALLER_ARCHITECTURE.md)
- **All Docs:** [INSTALLER_DOCUMENTATION_INDEX.md](INSTALLER_DOCUMENTATION_INDEX.md)

---

## ✨ Summary

**Just remember:**
- 🎯 **USE:** `install-universal.sh`
- ❌ **IGNORE:** `install-production.sh` and `install.sh`
- 📦 **ARCHIVE:** Move old ones to `.archive/` for cleanup

That's it! Everything else is just legacy.
