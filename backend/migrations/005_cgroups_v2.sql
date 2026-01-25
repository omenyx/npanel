-- Migration: cgroups_v2_support
-- Phase 5, Task 1.1: Resource isolation per account
-- Date: 2026-02-01

-- Cgroup configuration per account
CREATE TABLE IF NOT EXISTS cgroup_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT UNIQUE NOT NULL,
    cpu_percent INTEGER NOT NULL DEFAULT 50,     -- 1-200, default 50% of 1 core
    memory_mb INTEGER NOT NULL DEFAULT 512,       -- Minimum 64, default 512 MB
    io_read_mbps INTEGER NOT NULL DEFAULT 50,     -- MB/s read limit, default 50
    io_write_mbps INTEGER NOT NULL DEFAULT 50,    -- MB/s write limit, default 50
    max_pids INTEGER NOT NULL DEFAULT 256,        -- Maximum processes, default 256
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

-- Audit trail of cgroup operations and events
CREATE TABLE IF NOT EXISTS cgroup_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    event_type TEXT NOT NULL,                     -- created, updated, deleted, limit_exceeded, recovery
    cpu_percent INTEGER,
    memory_mb INTEGER,
    message TEXT,
    severity TEXT DEFAULT 'info',                 -- info, warning, error
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

-- Performance baseline for regression detection
CREATE TABLE IF NOT EXISTS performance_baseline (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_name TEXT UNIQUE NOT NULL,
    baseline_value REAL NOT NULL,
    tolerance_percent REAL DEFAULT 5.0,          -- ±5% threshold
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_cgroup_configs_account_id ON cgroup_configs(account_id);
CREATE INDEX IF NOT EXISTS idx_cgroup_events_account_id ON cgroup_events(account_id);
CREATE INDEX IF NOT EXISTS idx_cgroup_events_created_at ON cgroup_events(created_at);
CREATE INDEX IF NOT EXISTS idx_cgroup_events_event_type ON cgroup_events(event_type);
