package main

import (
	"net"
	"strings"
	"sync"
	"time"
)

// RateLimiter implements token bucket rate limiting per IP
type RateLimiter struct {
	mu          sync.RWMutex
	attempts    map[string][]time.Time // IP → timestamps
	maxAttempts int
	windowSec   int
}

// NewRateLimiter creates a new rate limiter
func NewRateLimiter(maxAttempts, windowSec int) *RateLimiter {
	limiter := &RateLimiter{
		attempts:    make(map[string][]time.Time),
		maxAttempts: maxAttempts,
		windowSec:   windowSec,
	}

	// Cleanup old entries every minute
	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		for range ticker.C {
			limiter.cleanup()
		}
	}()

	return limiter
}

// Allow checks if an attempt is allowed for the given IP
func (rl *RateLimiter) Allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	window := now.Add(-time.Duration(rl.windowSec) * time.Second)

	// Clean old attempts for this IP
	var recentAttempts []time.Time
	for _, t := range rl.attempts[ip] {
		if t.After(window) {
			recentAttempts = append(recentAttempts, t)
		}
	}
	rl.attempts[ip] = recentAttempts

	// Check limit
	if len(rl.attempts[ip]) >= rl.maxAttempts {
		return false
	}

	// Record attempt
	rl.attempts[ip] = append(rl.attempts[ip], now)
	return true
}

// cleanup removes expired entries
func (rl *RateLimiter) cleanup() {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	window := now.Add(-time.Duration(rl.windowSec*2) * time.Second)

	for ip, attempts := range rl.attempts {
		var recent []time.Time
		for _, t := range attempts {
			if t.After(window) {
				recent = append(recent, t)
			}
		}
		if len(recent) == 0 {
			delete(rl.attempts, ip)
		} else {
			rl.attempts[ip] = recent
		}
	}
}

// GetClientIP extracts the real client IP from request
func GetClientIP(r interface{}) string {
	type requestInterface interface {
		Header(string) string
		RemoteAddr() string
	}

	// Handle *http.Request
	httpReq, ok := r.(requestInterface)
	if ok {
		// Check X-Forwarded-For (from proxies)
		if xff := httpReq.Header("X-Forwarded-For"); xff != "" {
			ips := strings.Split(xff, ",")
			if len(ips) > 0 {
				return strings.TrimSpace(ips[0])
			}
		}

		// Check X-Real-IP (from reverse proxy)
		if xri := httpReq.Header("X-Real-IP"); xri != "" {
			return xri
		}

		// Fall back to RemoteAddr
		if ra := httpReq.RemoteAddr(); ra != "" {
			ip, _, err := net.SplitHostPort(ra)
			if err == nil {
				return ip
			}
			return ra
		}
	}

	return "unknown"
}

// AccountLockout tracks failed login attempts and locks accounts
type AccountLockout struct {
	mu       sync.RWMutex
	attempts map[string][]time.Time // email → timestamps
	maxAttempts int
	lockoutDuration time.Duration
}

// NewAccountLockout creates account lockout tracker
func NewAccountLockout(maxAttempts int, lockoutDuration time.Duration) *AccountLockout {
	return &AccountLockout{
		attempts:        make(map[string][]time.Time),
		maxAttempts:     maxAttempts,
		lockoutDuration: lockoutDuration,
	}
}

// RecordFailedAttempt records a failed login attempt
func (al *AccountLockout) RecordFailedAttempt(email string) {
	al.mu.Lock()
	defer al.mu.Unlock()

	now := time.Now()
	al.attempts[email] = append(al.attempts[email], now)

	// Clean old attempts outside lockout window
	var recent []time.Time
	for _, t := range al.attempts[email] {
		if now.Sub(t) < al.lockoutDuration {
			recent = append(recent, t)
		}
	}
	al.attempts[email] = recent
}

// IsLocked checks if account is locked
func (al *AccountLockout) IsLocked(email string) bool {
	al.mu.RLock()
	defer al.mu.RUnlock()

	attempts := al.attempts[email]
	return len(attempts) >= al.maxAttempts
}

// GetRemainingTime returns time until unlock
func (al *AccountLockout) GetRemainingTime(email string) time.Duration {
	al.mu.RLock()
	defer al.mu.RUnlock()

	attempts := al.attempts[email]
	if len(attempts) == 0 || len(attempts) < al.maxAttempts {
		return 0
	}

	// Lock time is based on first recent attempt
	lockedAt := attempts[0]
	unlocksAt := lockedAt.Add(al.lockoutDuration)
	remaining := time.Until(unlocksAt)

	if remaining < 0 {
		return 0
	}
	return remaining
}

// Reset clears lockout for an account
func (al *AccountLockout) Reset(email string) {
	al.mu.Lock()
	defer al.mu.Unlock()
	delete(al.attempts, email)
}
