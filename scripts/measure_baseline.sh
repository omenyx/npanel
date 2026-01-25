#!/bin/bash
# Phase 5, Task 1.4: Performance Baseline Measurement
# Captures baseline metrics before Phase 5 features implemented
# Used for regression detection throughout Phase 5
# Run: ./measure_baseline.sh

set -euo pipefail

echo "[baseline] Starting performance measurement at $(date)"

# Database setup
DB_PATH="/opt/npanel/data/npanel.db"
BASELINE_FILE="/opt/npanel/config/baseline-metrics.json"

# Function to insert baseline metric
insert_baseline() {
    local metric=$1
    local value=$2
    local tolerance=${3:-5.0}
    
    sqlite3 "$DB_PATH" <<EOF
INSERT OR REPLACE INTO performance_baseline (metric_name, baseline_value, tolerance_percent)
VALUES ('$metric', $value, $tolerance);
EOF
    echo "[baseline] Recorded: $metric = $value (±${tolerance}%)"
}

# ==================== CPU METRICS ====================
echo "[baseline] Measuring CPU idle..."

# Sample 30 seconds of idle CPU
cpu_idle_samples=()
for i in {1..6}; do
    # Get idle percentage from top
    idle=$(top -b -n 1 | grep "Cpu(s)" | awk '{print $8}' | sed 's/%id//')
    cpu_idle_samples+=($idle)
    sleep 5
done

# Average the samples
cpu_idle_avg=$(printf '%s\n' "${cpu_idle_samples[@]}" | awk '{sum+=$1} END {print sum/NR}')
cpu_percent_used=$(echo "100 - $cpu_idle_avg" | bc)

insert_baseline "cpu_idle_percent" "$cpu_idle_avg" 2.0  # Tight tolerance for idle
insert_baseline "cpu_used_percent" "$cpu_percent_used" 5.0

# ==================== MEMORY METRICS ====================
echo "[baseline] Measuring memory usage..."

# Get RSS memory of npanel process
npanel_pid=$(pgrep -f "npanel.*api" | head -1 || echo "0")

if [ "$npanel_pid" != "0" ]; then
    mem_rss=$(ps -p "$npanel_pid" -o rss= | awk '{print $1}')
    mem_rss_mb=$((mem_rss / 1024))
    insert_baseline "npanel_memory_rss_mb" "$mem_rss_mb" 3.0
else
    echo "[baseline] WARNING: npanel process not found, using estimate"
    insert_baseline "npanel_memory_rss_mb" "128" 10.0
fi

# System total memory usage
total_mem=$(free -b | awk 'NR==2 {print $2}')
used_mem=$(free -b | awk 'NR==2 {print $3}')
system_mem_percent=$(echo "scale=2; ($used_mem / $total_mem) * 100" | bc)

insert_baseline "system_memory_percent" "$system_mem_percent" 3.0

# ==================== API LATENCY ====================
echo "[baseline] Measuring API latency..."

# Test 10 API calls, measure response time
latency_samples=()

for i in {1..10}; do
    # Call API health check (should be fast)
    start=$(date +%s%N)
    
    curl -s -w "%{http_code}" \
        --unix-socket /run/npanel/api.sock \
        http://localhost/api/v1/health \
        -o /dev/null > /dev/null 2>&1 || true
    
    end=$(date +%s%N)
    latency_ms=$(( (end - start) / 1000000 ))
    latency_samples+=($latency_ms)
    
    sleep 0.5
done

# Average latency
avg_latency=$(printf '%s\n' "${latency_samples[@]}" | awk '{sum+=$1} END {print sum/NR}')
insert_baseline "api_latency_ms" "$avg_latency" 10.0  # Allow 10% variance

# ==================== EMAIL THROUGHPUT ====================
echo "[baseline] Measuring email throughput baseline..."

# Count emails processed in 60 seconds
email_start=$(exim -bpc 2>/dev/null || echo "0")
sleep 60
email_end=$(exim -bpc 2>/dev/null || echo "0")

email_processed=$((email_end - email_start))
if [ $email_processed -lt 0 ]; then
    email_processed=0
fi

insert_baseline "email_queue_baseline" "$email_processed" 15.0  # Variable baseline

# ==================== DISK I/O ====================
echo "[baseline] Measuring disk I/O..."

# Get iowait percentage
io_wait=$(iostat -x 1 2 | tail -1 | awk '{print $NF}')
insert_baseline "disk_iowait_percent" "$io_wait" 5.0

# ==================== LOAD AVERAGE ====================
echo "[baseline] Measuring system load..."

# Get 1-minute load average
load_avg=$(cat /proc/loadavg | awk '{print $1}')
cpu_count=$(nproc)
load_normalized=$(echo "scale=2; $load_avg / $cpu_count" | bc)

insert_baseline "system_load_average" "$load_avg" 5.0
insert_baseline "system_load_normalized" "$load_normalized" 5.0

# ==================== DATABASE ====================
echo "[baseline] Measuring database metrics..."

# SQLite database size
db_size=$(stat -f%z "$DB_PATH" 2>/dev/null || stat -c%s "$DB_PATH")
db_size_mb=$((db_size / (1024 * 1024)))

insert_baseline "database_size_mb" "$db_size_mb" 2.0

# Account count (for later load calculations)
account_count=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM accounts;" 2>/dev/null || echo "0")
insert_baseline "account_count_baseline" "$account_count" 0.0  # Exact count

# ==================== SUMMARY ====================
echo ""
echo "[baseline] ✅ Baseline measurement complete"
echo ""
echo "========== PERFORMANCE BASELINE =========="
echo "CPU Idle:           $cpu_idle_avg%"
echo "CPU Used:           $cpu_percent_used%"
echo "nPanel Memory RSS:  ${mem_rss_mb}MB"
echo "System Memory:      ${system_mem_percent}%"
echo "API Latency:        ${avg_latency}ms"
echo "Email Queue:        $email_processed"
echo "Disk I/O Wait:      ${io_wait}%"
echo "Load Average:       $load_avg"
echo "Database Size:      ${db_size_mb}MB"
echo "Accounts:           $account_count"
echo "=========================================="
echo ""
echo "[baseline] Metrics saved to database and $BASELINE_FILE"
echo "[baseline] Use these baseline values to detect regressions:"
echo "[baseline] - CPU ≤ ${cpu_idle_avg} ± 2% (target ≥98% idle)"
echo "[baseline] - Memory ≤ ${mem_rss_mb}MB ± 3%"
echo "[baseline] - API Latency ≤ ${avg_latency}ms ± 10%"
echo "[baseline] - Phase 5 constraint: CPU increase max +1%, memory +5MB"
echo ""

# Export to JSON for monitoring system
cat > "$BASELINE_FILE" <<EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "cpu_idle_percent": $cpu_idle_avg,
  "cpu_used_percent": $cpu_percent_used,
  "npanel_memory_rss_mb": $mem_rss_mb,
  "system_memory_percent": $system_mem_percent,
  "api_latency_ms": $avg_latency,
  "email_queue_baseline": $email_processed,
  "disk_iowait_percent": $io_wait,
  "load_average": $load_avg,
  "database_size_mb": $db_size_mb,
  "account_count": $account_count,
  "regression_thresholds": {
    "cpu_idle_min": $((cpu_idle_avg - 2)),
    "memory_rss_max_mb": $((mem_rss_mb + 5)),
    "api_latency_max_ms": $((avg_latency + avg_latency / 10)),
    "note": "Phase 5 performance contract: CPU ≤1% increase, latency unchanged, all async"
  }
}
EOF

echo "[baseline] Baseline exported to $BASELINE_FILE"
