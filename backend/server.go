package main

import (
	"context"
	"crypto/tls"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	_ "github.com/mattn/go-sqlite3"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// APIServerConfig holds API server configuration
type APIServerConfig struct {
	Debug      bool
	Port       int
	ConfigPath string
}

// APIServer represents the nPanel API server
type APIServer struct {
	config        *APIServerConfig
	db            *sql.DB
	redis         *redis.Client
	httpServer    *http.Server
	logger        *Logger
	authService   *AuthService
	mu            sync.RWMutex
	shutdown      chan struct{}
	jwtSecret     string
	loginLimiter  *RateLimiter        // CRITICAL: Rate limiting for login
	accountLock   *AccountLockout     // CRITICAL: Account lockout after failed attempts
}

// NewAPIServer creates a new API server instance
func NewAPIServer(config *APIServerConfig) (*APIServer, error) {
	// CRITICAL: Validate JWT secret before creating server
	jwtSecret := os.Getenv("JWT_SECRET")
	if err := ValidateJWTSecret(jwtSecret); err != nil {
		return nil, fmt.Errorf("JWT configuration error: %w", err)
	}

	server := &APIServer{
		config:       config,
		logger:       NewLogger(config.Debug),
		shutdown:     make(chan struct{}),
		jwtSecret:    jwtSecret,
		loginLimiter: NewRateLimiter(5, 300),  // CRITICAL: 5 attempts per 5 minutes
		accountLock:  NewAccountLockout(5, 15*time.Minute), // CRITICAL: Lock after 5 failed attempts
	}

	// Initialize database
	if err := server.initDatabase(); err != nil {
		return nil, fmt.Errorf("failed to initialize database: %w", err)
	}

	// Initialize auth service
	server.authService = NewAuthService(server.db, server.jwtSecret)

	// Initialize Redis
	if err := server.initRedis(); err != nil {
		return nil, fmt.Errorf("failed to initialize Redis: %w", err)
	}

	return server, nil
}

// initDatabase initializes the database connection
func (s *APIServer) initDatabase() error {
	s.logger.Info("Connecting to database...")

	dbPath := "/var/lib/npanel/npanel.db"
	// For development, use local path if /var/lib/npanel doesn't exist
	if _, err := os.Stat("/var/lib/npanel"); os.IsNotExist(err) {
		dbPath = "npanel.db"
	}

	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}

	// Test connection
	if err := db.Ping(); err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}

	s.db = db
	s.logger.Info("Database connected successfully")
	return nil
}

// initRedis initializes the Redis connection
func (s *APIServer) initRedis() error {
	s.logger.Info("Connecting to Redis...")

	client := redis.NewClient(&redis.Options{
		Addr: "localhost:6379",
	})

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		// Redis is optional for now
		s.logger.Info("Redis not available (optional): %v", err)
		return nil
	}

	s.redis = client
	s.logger.Info("Redis connected successfully")
	return nil
}

// Start starts the API server
func (s *APIServer) Start() error {
	s.logger.Info("Starting API server on port %d", s.config.Port)

	// Create router
	r := chi.NewRouter()

	// Middleware
	r.Use(middleware.RequestID)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	
	// CRITICAL: Configure CORS securely
	allowedOrigins := os.Getenv("CORS_ALLOWED_ORIGINS")
	if allowedOrigins == "" {
		if os.Getenv("ENVIRONMENT") == "production" {
			return fmt.Errorf("CORS_ALLOWED_ORIGINS required in production")
		}
		allowedOrigins = "http://localhost:3000"  // Development only
	}
	
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{allowedOrigins}, // CRITICAL: Don't use wildcard with credentials
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		ExposedHeaders:   []string{"Content-Length"},
		MaxAge:           3600,
		AllowCredentials: false,  // CRITICAL: False when AllowedOrigins != "*"
	}))
	
	// CRITICAL: Add security headers middleware
	r.Use(s.securityHeadersMiddleware)

	// Health endpoint (public)
	r.Get("/health", s.healthHandler)
	r.Get("/metrics", s.metricsHandler)

	// Auth routes (public)
	r.Post("/api/auth/login", s.loginHandler)
	r.Post("/api/auth/refresh", s.refreshHandler)

	// Protected routes (require JWT)
	r.Route("/api", func(r chi.Router) {
		r.Use(s.jwtMiddleware)

		// Auth
		r.Post("/auth/logout", s.logoutHandler)
		r.Get("/auth/me", s.getMeHandler)
		r.Post("/auth/change-password", s.changePasswordHandler)

		// Domain routes
		r.Get("/domains", s.listDomainsHandler)
		r.Post("/domains", s.createDomainHandler)
		r.Get("/domains/{id}", s.getDomainHandler)
		r.Put("/domains/{id}", s.updateDomainHandler)
		r.Delete("/domains/{id}", s.deleteDomainHandler)

		// Email routes
		r.Get("/domains/{domainId}/emails", s.listEmailsHandler)
		r.Post("/domains/{domainId}/emails", s.createEmailHandler)
		r.Delete("/domains/{domainId}/emails/{id}", s.deleteEmailHandler)

		// DNS routes
		r.Get("/domains/{domainId}/dns", s.listDNSRecordsHandler)
		r.Post("/domains/{domainId}/dns", s.createDNSRecordHandler)
		r.Delete("/domains/{domainId}/dns/{id}", s.deleteDNSRecordHandler)

		// Database routes
		r.Get("/domains/{domainId}/databases", s.listDatabasesHandler)
		r.Post("/domains/{domainId}/databases", s.createDatabaseHandler)
		r.Delete("/domains/{domainId}/databases/{id}", s.deleteDatabaseHandler)

		// Service routes
		r.Get("/services", s.listServicesHandler)
		r.Post("/services/{name}/restart", s.restartServiceHandler)
		r.Get("/services/{name}/status", s.serviceStatusHandler)

		// Job routes
		r.Get("/jobs/{id}", s.getJobStatusHandler)

		// Admin routes
		r.Route("/admin", func(r chi.Router) {
			r.Use(s.RequireRole(RoleAdmin, RoleRoot))

			r.Get("/users", s.listUsersHandler)
			r.Post("/users", s.createUserHandler)
			r.Get("/users/{id}", s.getUserHandler)
			r.Delete("/users/{id}", s.deleteUserHandler)

			r.Get("/audit", s.getAuditLogsHandler)
		})
	})

	// Create HTTPS server
	cert, err := tls.LoadX509KeyPair(
		"/etc/npanel/ssl/cert.pem",
		"/etc/npanel/ssl/key.pem",
	)
	if err != nil {
		// For development, try local path
		cert, err = tls.LoadX509KeyPair(
			"cert.pem",
			"key.pem",
		)
		if err != nil {
			return fmt.Errorf("failed to load SSL certificate: %w", err)
		}
	}

	s.httpServer = &http.Server{
		Addr:      fmt.Sprintf(":%d", s.config.Port),
		Handler:   r,
		TLSConfig: &tls.Config{Certificates: []tls.Certificate{cert}},
	}

	fmt.Printf("✓ API server listening on :%d\n", s.config.Port)

	// Start server
	if err := s.httpServer.ListenAndServeTLS("", ""); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("server error: %w", err)
	}

	return nil
}

// Shutdown gracefully shuts down the server
func (s *APIServer) Shutdown() error {
	s.logger.Info("Shutting down API server")
	close(s.shutdown)

	if s.httpServer != nil {
		s.httpServer.Close()
	}

	if s.db != nil {
		s.db.Close()
	}

	if s.redis != nil {
		s.redis.Close()
	}

	return nil
}

// InitializeDatabase initializes the database schema
func (s *APIServer) InitializeDatabase() error {
	s.logger.Info("Initializing database schema...")
	return InitDB(s.db)
}

// HTTP Response Helpers

func (s *APIServer) respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func (s *APIServer) respondError(w http.ResponseWriter, status int, message string) {
	s.respondJSON(w, status, map[string]interface{}{
		"error": message,
	})
}

func (s *APIServer) respondSuccess(w http.ResponseWriter, data interface{}) {
	s.respondJSON(w, http.StatusOK, data)
}

// Middleware

// jwtMiddleware validates JWT tokens
func (s *APIServer) jwtMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Extract token
		tokenString, err := ExtractTokenFromRequest(r)
		if err != nil {
			s.respondError(w, http.StatusUnauthorized, "missing or invalid authorization header")
			return
		}

		// Verify token
		claims, err := s.authService.VerifyAccessToken(tokenString)
		if err != nil {
			s.respondError(w, http.StatusUnauthorized, "invalid or expired token")
			return
		}

		// Add user context to request
		userCtx := &UserContext{
			UserID:  claims.UserID,
			Email:   claims.Email,
			Role:    claims.Role,
			TokenID: claims.TokenID,
		}

		r = WithUserContext(r, userCtx)

		next.ServeHTTP(w, r)
	})
}

// HTTP Handlers

// healthHandler handles health check requests
func (s *APIServer) healthHandler(w http.ResponseWriter, r *http.Request) {
	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "healthy",
		"time":   time.Now().Unix(),
	})
}

// metricsHandler handles metrics requests
func (s *APIServer) metricsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain")
	fmt.Fprintf(w, "# nPanel Metrics\n# TYPE npanel_up gauge\nnpanel_up 1\n")
}

// loginHandler handles user login with rate limiting and account lockout
func (s *APIServer) loginHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.respondError(w, http.StatusBadRequest, "invalid request")
		return
	}

	// CRITICAL: Validate inputs
	if err := ValidateEmail(req.Email); err != nil {
		s.respondError(w, http.StatusBadRequest, "invalid email format")
		return
	}

	if len(req.Password) == 0 {
		s.respondError(w, http.StatusBadRequest, "password required")
		return
	}

	clientIP := getClientIPFromRequest(r)

	// CRITICAL: Check rate limit per IP
	if !s.loginLimiter.Allow(clientIP) {
		s.LogAuditAction("", "login_attempt", "auth", "", "rate_limit_exceeded", clientIP, r.UserAgent(), nil)
		s.respondError(w, http.StatusTooManyRequests, "too many login attempts, try again later")
		return
	}

	// CRITICAL: Check account lockout
	if s.accountLock.IsLocked(req.Email) {
		remaining := s.accountLock.GetRemainingTime(req.Email)
		s.LogAuditAction("", "login_attempt", "auth", "", "account_locked", clientIP, r.UserAgent(), nil)
		s.respondError(w, http.StatusUnauthorized, fmt.Sprintf("account locked, try again in %d minutes", int(remaining.Minutes())+1))
		return
	}

	// Verify credentials
	user, err := s.authService.VerifyPassword(req.Email, req.Password)
	if err != nil {
		// CRITICAL: Record failed attempt for account lockout
		s.accountLock.RecordFailedAttempt(req.Email)
		s.LogAuditAction("", "login_attempt", "auth", "", "failed", clientIP, r.UserAgent(), nil)
		s.respondError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	// Success - reset lockout
	s.accountLock.Reset(req.Email)

	// Generate tokens
	accessToken, err := s.authService.GenerateAccessToken(user)
	if err != nil {
		s.respondError(w, http.StatusInternalServerError, "authentication service error")
		return
	}

	refreshToken, err := s.authService.GenerateRefreshToken(user.ID, clientIP, r.UserAgent())
	if err != nil {
		s.respondError(w, http.StatusInternalServerError, "authentication service error")
		return
	}

	// CRITICAL: Store refresh token in httpOnly cookie instead of response body
	http.SetCookie(w, &http.Cookie{
		Name:     "refresh_token",
		Value:    refreshToken,
		HttpOnly: true,           // ✓ Not accessible by JavaScript
		Secure:   true,           // ✓ Only over HTTPS
		SameSite: http.SameSiteLax, // ✓ CSRF protection
		MaxAge:   30 * 24 * 60 * 60,
		Path:     "/api",
	})

	// Log successful login
	s.LogAuditAction(user.ID, "login", "auth", user.ID, "success", clientIP, r.UserAgent(), nil)

	// Return only access token in response
	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"access_token": accessToken,
		"user": map[string]interface{}{
			"id":    user.ID,
			"email": user.Email,
			"role":  user.Role,
		},
	})
}

// refreshHandler refreshes access token
func (s *APIServer) refreshHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.respondError(w, http.StatusBadRequest, "invalid request")
		return
	}

	// Verify refresh token
	user, err := s.authService.VerifyRefreshToken(req.RefreshToken)
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "invalid refresh token")
		return
	}

	// Generate new access token
	accessToken, err := s.authService.GenerateAccessToken(user)
	if err != nil {
		s.respondError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}

	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"access_token": accessToken,
	})
}

// logoutHandler handles user logout
func (s *APIServer) logoutHandler(w http.ResponseWriter, r *http.Request) {
	user, _ := GetUserContext(r)

	var req struct {
		RefreshToken string `json:"refresh_token"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.respondError(w, http.StatusBadRequest, "invalid request")
		return
	}

	// Revoke session
	s.authService.RevokeSession(req.RefreshToken)

	// Log audit
	s.LogAuditAction(user.UserID, "logout", "session", user.TokenID, "success", r.RemoteAddr, r.UserAgent(), nil)

	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "logged_out",
	})
}

// getMeHandler gets current user info
func (s *APIServer) getMeHandler(w http.ResponseWriter, r *http.Request) {
	user, _ := GetUserContext(r)

	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"id":    user.UserID,
		"email": user.Email,
		"role":  user.Role,
	})
}

// changePasswordHandler changes user password
func (s *APIServer) changePasswordHandler(w http.ResponseWriter, r *http.Request) {
	user, _ := GetUserContext(r)

	var req struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.respondError(w, http.StatusBadRequest, "invalid request")
		return
	}

	// TODO: Implement password change logic

	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "password_changed",
	})
}

// Domain handlers

func (s *APIServer) listDomainsHandler(w http.ResponseWriter, r *http.Request) {
	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"domains": []interface{}{},
	})
}

func (s *APIServer) createDomainHandler(w http.ResponseWriter, r *http.Request) {
	s.respondJSON(w, http.StatusCreated, map[string]interface{}{
		"status": "created",
	})
}

func (s *APIServer) getDomainHandler(w http.ResponseWriter, r *http.Request) {
	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"domain": map[string]interface{}{},
	})
}

func (s *APIServer) updateDomainHandler(w http.ResponseWriter, r *http.Request) {
	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "updated",
	})
}

func (s *APIServer) deleteDomainHandler(w http.ResponseWriter, r *http.Request) {
	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "deleted",
	})
}

// Email handlers

func (s *APIServer) listEmailsHandler(w http.ResponseWriter, r *http.Request) {
	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"emails": []interface{}{},
	})
}

func (s *APIServer) createEmailHandler(w http.ResponseWriter, r *http.Request) {
	s.respondJSON(w, http.StatusCreated, map[string]interface{}{
		"status": "created",
	})
}

func (s *APIServer) deleteEmailHandler(w http.ResponseWriter, r *http.Request) {
	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "deleted",
	})
}

// DNS handlers

func (s *APIServer) listDNSRecordsHandler(w http.ResponseWriter, r *http.Request) {
	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"records": []interface{}{},
	})
}

func (s *APIServer) createDNSRecordHandler(w http.ResponseWriter, r *http.Request) {
	s.respondJSON(w, http.StatusCreated, map[string]interface{}{
		"status": "created",
	})
}

func (s *APIServer) deleteDNSRecordHandler(w http.ResponseWriter, r *http.Request) {
	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "deleted",
	})
}

// Database handlers

func (s *APIServer) listDatabasesHandler(w http.ResponseWriter, r *http.Request) {
	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"databases": []interface{}{},
	})
}

func (s *APIServer) createDatabaseHandler(w http.ResponseWriter, r *http.Request) {
	s.respondJSON(w, http.StatusCreated, map[string]interface{}{
		"status": "created",
	})
}

func (s *APIServer) deleteDatabaseHandler(w http.ResponseWriter, r *http.Request) {
	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "deleted",
	})
}

// Service handlers

func (s *APIServer) listServicesHandler(w http.ResponseWriter, r *http.Request) {
	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"services": []interface{}{},
	})
}

func (s *APIServer) restartServiceHandler(w http.ResponseWriter, r *http.Request) {
	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "restarted",
	})
}

func (s *APIServer) serviceStatusHandler(w http.ResponseWriter, r *http.Request) {
	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "running",
	})
}

// Job handlers

func (s *APIServer) getJobStatusHandler(w http.ResponseWriter, r *http.Request) {
	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "completed",
	})
}

// Admin handlers

func (s *APIServer) listUsersHandler(w http.ResponseWriter, r *http.Request) {
	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"users": []interface{}{},
	})
}

func (s *APIServer) createUserHandler(w http.ResponseWriter, r *http.Request) {
	s.respondJSON(w, http.StatusCreated, map[string]interface{}{
		"status": "created",
	})
}

func (s *APIServer) getUserHandler(w http.ResponseWriter, r *http.Request) {
	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"user": map[string]interface{}{},
	})
}

func (s *APIServer) deleteUserHandler(w http.ResponseWriter, r *http.Request) {
	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "deleted",
	})
}

func (s *APIServer) getAuditLogsHandler(w http.ResponseWriter, r *http.Request) {
	s.respondJSON(w, http.StatusOK, map[string]interface{}{
		"logs": []interface{}{},
	})
}

// Logger provides API logging
type Logger struct {
	debug bool
}

// NewLogger creates a new logger
func NewLogger(debug bool) *Logger {
	return &Logger{debug: debug}
}

// Info logs an info message
func (l *Logger) Info(format string, args ...interface{}) {
	if l.debug {
		log.Printf("[INFO] "+format, args...)
	}
}

// Error logs an error message
func (l *Logger) Error(format string, args ...interface{}) {
	log.Printf("[ERROR] "+format, args...)
}

// Helper functions

// CRITICAL: Security headers middleware prevents common web vulnerabilities
func (s *APIServer) securityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Prevent clickjacking
		w.Header().Set("X-Frame-Options", "DENY")

		// Prevent MIME type sniffing
		w.Header().Set("X-Content-Type-Options", "nosniff")

		// XSS protection (legacy browser support)
		w.Header().Set("X-XSS-Protection", "1; mode=block")

		// Content Security Policy - restrict to API responses only
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")

		// Strict Transport Security - 1 year, include subdomains
		w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")

		// Referrer Policy - don't leak referrer
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")

		// Permissions Policy - restrict sensitive APIs
		w.Header().Set("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=(), usb=()")

		next.ServeHTTP(w, r)
	})
}

// getClientIPFromRequest extracts real client IP from request
func getClientIPFromRequest(r *http.Request) string {
	// Check X-Forwarded-For (from proxies)
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.Split(xff, ",")[0]
	}

	// Check X-Real-IP (from reverse proxy)
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return xri
	}

	// Fall back to RemoteAddr
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return ip
}

func generateID() string {
	return uuid.New().String()
}

func now() time.Time {
	return time.Now()
}
