# Npanel Self-Diagnosis Complete - Implementation Summary

## 🎯 What Was Implemented

You now have a complete self-diagnostic system for your WSL AlmaLinux deployment.

### 1. **Automated Full-System Diagnostic** ✅
Added `--full-diagnose` command to the installer that performs comprehensive checks:

```bash
sudo ./install_npanel.sh --full-diagnose
```

**This checks:**
- System information (OS, kernel, uptime)
- Service status (backend, frontend, nginx)
- Port listening verification (3000, 3001, 8080, 2082-2087)
- Database file status and permissions
- Environment configuration
- Network connectivity to all components
- Recent error logs
- Automated recommendations

---

### 2. **Documentation Suite** ✅

#### Quick Reference ([QUICK_REFERENCE.md](QUICK_REFERENCE.md))
- One-page reference for all common commands
- Quick diagnostic checks
- Common fixes with one-liners
- Service ports and paths
- Emergency commands
- Decision tree for troubleshooting

#### Self-Diagnostic Guide ([SELF_DIAGNOSTIC_GUIDE.md](SELF_DIAGNOSTIC_GUIDE.md))
- Step-by-step diagnostic procedures
- Manual check instructions
- Common issues and solutions
- WSL-specific considerations
- Emergency reset procedures
- How to collect diagnostic data

#### Backend Connectivity Troubleshooting ([BACKEND_CONNECTIVITY_TROUBLESHOOTING.md](BACKEND_CONNECTIVITY_TROUBLESHOOTING.md))
- Focused on "Unable to reach backend API" issue
- 8-step troubleshooting process
- Common backend errors and solutions
- Decision tree for diagnosis
- Collection of diagnostic data
- Success indicators

---

## 🚀 How to Use

### For Your Current Issue (Unable to reach backend API)

**Step 1: Run the diagnostic**
```bash
sudo ./install_npanel.sh --full-diagnose
```

**Step 2: Check the output**
Look for:
- ✓ `npanel-backend: ACTIVE` (service status)
- ✓ `Port 3000: LISTENING` (port status)
- ✓ `Backend API responding` (connectivity test)

**Step 3: Follow recommendations**
If any show ✗, the diagnostic will suggest next steps.

---

### For Quick Checks

```bash
# Check service status
sudo ./install_npanel.sh --status

# View all logs
sudo ./install_npanel.sh logs

# Restart services
sudo ./install_npanel.sh --restart

# Restart just backend
sudo ./install_npanel.sh backend-restart

# View backend logs only
sudo ./install_npanel.sh backend-logs
```

---

## 📊 Expected Diagnostic Output (When Healthy)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔧 NPANEL FULL SYSTEM DIAGNOSTIC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 SYSTEM INFORMATION
   OS: AlmaLinux 9.1
   Kernel: 5.15.90.1-microsoft-standard-WSL2
   Uptime: up 2 hours, 15 minutes

🔧 SERVICE STATUS
   ✓ npanel-backend: ACTIVE
   ✓ npanel-frontend: ACTIVE
   ✓ nginx: ACTIVE

🔌 PORT LISTENING STATUS
   ✓ Port 3000: LISTENING
   ✓ Port 3001: LISTENING
   ✓ Port 8080: LISTENING
   ✓ Port 2082: LISTENING
   ✓ Port 2083: LISTENING
   ✓ Port 2086: LISTENING
   ✓ Port 2087: LISTENING

💾 DATABASE STATUS
   ✓ Database file exists: /opt/npanel/data/npanel.sqlite (512K)
   ✓ Database is readable
   ✓ Database is writable

⚙️  ENVIRONMENT CONFIGURATION
   ✓ Backend .env exists
     - JWT_SECRET set: yes
     - DATABASE_PATH set: yes

🌐 NETWORK CONNECTIVITY TEST
   ✓ Backend API responding: http://127.0.0.1:3000/v1/health
   ✓ Frontend responding: http://127.0.0.1:3001
   ✓ Nginx proxy responding: http://127.0.0.1:8080

⚠️  RECENT SERVICE ERRORS (last 5 from each)
   Backend errors:
     (no errors found in logs)

   Frontend errors:
     (no errors found in logs)

💡 DIAGNOSTIC RECOMMENDATIONS
   ✓ No obvious issues detected - system appears healthy
   • If issues persist, check backend logs for details
   • Run: sudo journalctl -u npanel-backend --no-pager | tail -50

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 🔍 Interpreting Results

### All ✓ (Green Checks)
Everything appears healthy.
- Frontend is accessible
- Backend is responding
- Database is OK
- All ports are listening

**Next step:** If issue persists despite all green, check application logs:
```bash
sudo journalctl -u npanel-backend --no-pager | tail -100
```

### Mix of ✓ and ✗
The diagnostic identifies specific problems.

Example:
```
✗ npanel-backend: INACTIVE
```

**Action:** Review the "DIAGNOSTIC RECOMMENDATIONS" section which will suggest:
```bash
• Check logs: sudo journalctl -u npanel-backend -n 50 --no-pager
• Try restart: sudo systemctl restart npanel-backend
• Check database: ls -la /opt/npanel/data/
```

### Specific Error Patterns

**Pattern: Backend inactive + Port not listening + Database accessible**
```
✗ npanel-backend: INACTIVE
✗ Port 3000: NOT LISTENING
✓ Database is readable
```
→ Backend crashed. Check logs for startup error.

**Pattern: Backend active + Port not listening + Database accessible**
```
✓ npanel-backend: ACTIVE
✗ Port 3000: NOT LISTENING
✓ Database is readable
```
→ Backend hung or misconfigured. Check logs for details.

**Pattern: Database file NOT FOUND**
```
✗ Database file NOT FOUND: /opt/npanel/data/npanel.sqlite
```
→ Directory doesn't exist or backend hasn't created DB yet. Restart backend:
```bash
sudo systemctl restart npanel-backend
sleep 5
sudo ./install_npanel.sh --full-diagnose
```

---

## 🆘 Immediate Actions for Common Issues

### Issue: "Unable to reach backend API"
```bash
# 1. Quick diagnostic
sudo ./install_npanel.sh --full-diagnose

# 2. If backend is INACTIVE
sudo systemctl restart npanel-backend

# 3. If port 3000 not listening after restart
sudo journalctl -u npanel-backend -n 50 --no-pager

# 4. If database error in logs
sudo rm /opt/npanel/data/npanel.sqlite
sudo systemctl restart npanel-backend
sleep 5

# 5. Verify fix
curl http://127.0.0.1:3000/v1/health
```

### Issue: "Can't connect to Npanel"
```bash
# 1. Check nginx
sudo systemctl status nginx

# 2. Test nginx config
sudo nginx -t

# 3. Restart nginx
sudo systemctl restart nginx

# 4. Verify
curl http://127.0.0.1:8080
```

### Issue: "Database handle is closed"
```bash
# 1. Delete corrupted database
sudo rm /opt/npanel/data/npanel.sqlite

# 2. Restart backend
sudo systemctl restart npanel-backend

# 3. Wait for initialization
sleep 5

# 4. Verify
sudo ./install_npanel.sh --full-diagnose
```

---

## 📈 System Health Checklist

After running diagnostic, you should have:

- [ ] Service status shows all ACTIVE
- [ ] All ports show LISTENING
- [ ] Database file exists and is readable/writable
- [ ] Backend .env has JWT_SECRET and DATABASE_PATH
- [ ] Backend API responds to health check
- [ ] Frontend responds to requests
- [ ] Nginx proxy responds to requests
- [ ] No errors in backend/frontend logs
- [ ] Can access login page at http://localhost:8080/login
- [ ] Can login successfully

If ALL checkboxes are checked ✅, your system is healthy!

---

## 🔧 Helper Commands Reference

```bash
# Status & Diagnostics
sudo ./install_npanel.sh --full-diagnose    # Full system check
sudo ./install_npanel.sh --status           # Quick status check
sudo ./install_npanel.sh --diagnose         # Nginx diagnostics

# Logs
sudo ./install_npanel.sh logs               # Combined logs
sudo ./install_npanel.sh backend-logs       # Backend logs only
sudo ./install_npanel.sh frontend-logs      # Frontend logs only

# Service Management
sudo ./install_npanel.sh --restart          # Restart all services
sudo ./install_npanel.sh backend-restart    # Restart backend only
sudo ./install_npanel.sh frontend-restart   # Restart frontend only
sudo ./install_npanel.sh --rebuild-nginx    # Rebuild nginx config

# Installation & Updates
sudo ./install_npanel.sh --install          # Initial installation
sudo ./install_npanel.sh --update           # Update deployment
```

---

## 📚 Documentation Files

| File | Purpose |
|------|---------|
| [QUICK_REFERENCE.md](QUICK_REFERENCE.md) | One-page reference for all common tasks |
| [SELF_DIAGNOSTIC_GUIDE.md](SELF_DIAGNOSTIC_GUIDE.md) | Comprehensive self-diagnosis procedures |
| [BACKEND_CONNECTIVITY_TROUBLESHOOTING.md](BACKEND_CONNECTIVITY_TROUBLESHOOTING.md) | Focused guide for backend API issues |
| [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) | Full operational procedures |
| [DEPLOYMENT_PLAYBOOK.md](DEPLOYMENT_PLAYBOOK.md) | Deployment procedures and best practices |

---

## 🎓 Learning Path

**If you're new to this system:**
1. Start: [QUICK_REFERENCE.md](QUICK_REFERENCE.md) - Get oriented
2. Read: [SELF_DIAGNOSTIC_GUIDE.md](SELF_DIAGNOSTIC_GUIDE.md) - Understand diagnostics
3. Reference: [BACKEND_CONNECTIVITY_TROUBLESHOOTING.md](BACKEND_CONNECTIVITY_TROUBLESHOOTING.md) - Specific issue help
4. Master: [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) - Comprehensive operations

**If you're troubleshooting:**
1. Run: `sudo ./install_npanel.sh --full-diagnose`
2. Interpret: Check the output against examples above
3. Follow: Recommendations in the diagnostic output
4. Reference: [BACKEND_CONNECTIVITY_TROUBLESHOOTING.md](BACKEND_CONNECTIVITY_TROUBLESHOOTING.md) if needed

---

## ✨ Summary

You now have:

✅ **Automated Diagnostic Tool**
- One command runs complete system check
- Identifies specific problems
- Provides actionable recommendations

✅ **Comprehensive Documentation**
- Quick reference card
- Step-by-step guides
- Troubleshooting trees
- Emergency procedures

✅ **Helper Commands**
- 8 new commands for common operations
- Real-time status checking
- Easy log viewing
- Quick restarts

✅ **Clear Path Forward**
When you encounter issues:
1. Run `sudo ./install_npanel.sh --full-diagnose`
2. Read the recommendations
3. Follow suggested steps
4. Reference documentation if needed

---

## 🎯 Next Steps

### To Diagnose Your Current Issue:
```bash
sudo ./install_npanel.sh --full-diagnose
```

Share the output, and we can identify exactly what needs fixing!

### To Keep System Healthy:
```bash
# Run diagnostic weekly or after changes
sudo ./install_npanel.sh --full-diagnose

# Monitor logs for issues
sudo journalctl -u npanel-backend -f
```

---

**All documentation is available in the root directory of your Npanel installation.**

**Questions?** Check the relevant documentation file first - it likely has the answer!
