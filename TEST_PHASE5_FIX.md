# Quick Test Script - Phase 5 Fix Verification

The installer now properly handles the case where source code is not available locally by:

1. **Detecting source availability**
   - Checks if `backend/main.go` and `frontend/package.json` exist locally
   - If found: builds directly from local source
   - If not found: clones repository from GitHub

2. **Cloning repository** (if needed)
   - Uses `git clone --depth 1` for fast shallow clone
   - Clones into temporary staging directory
   - Extracts to proper location for building

3. **Building binaries**
   - Backend: `go mod download && go build`
   - Frontend: `npm install && npm run build`
   - Both fully fail-fast if build fails

4. **Critical fix for Phase 7**
   - API binary is now **REQUIRED** (not optional)
   - If binary missing: **FATAL ERROR** (exit code 100)
   - Prevents services from starting without proper build
   - Clear error message with log location for debugging

**To test:**

```bash
# On Troll server
root@Troll:~# curl -fsSL https://raw.githubusercontent.com/omenyx/npanel/main/install-universal.sh | bash
```

**Expected behavior:**

1. Phase 1-4: System checks and dependencies (unchanged)
2. Phase 5: **CLONE and BUILD** binaries
   - Downloads repo (1-2 min)
   - Builds Go binary (1-2 min)
   - Builds npm assets (1-2 min)
3. Phase 6: Config generation (unchanged)
4. Phase 7: Services start with healthy binaries
5. Result: **System LIVE**, user can login immediately

**Total time:** 10-15 minutes (includes build time)

