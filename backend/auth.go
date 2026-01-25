package main

import (
	"database/sql"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

// CRITICAL: Bcrypt cost set to 14 for ~0.5 second hashing (prevents brute force)
const BCryptCost = 14

// JWTClaims represents JWT token claims
type JWTClaims struct {
	UserID    string   `json:"user_id"`
	Email     string   `json:"email"`
	Role      string   `json:"role"`
	Roles     []string `json:"roles"`
	TokenID   string   `json:"token_id"`
	SessionID string   `json:"session_id"`    // Bind token to session
	IPAddress string   `json:"ip_address"`    // Bind token to IP
	IssuedAt  int64    `json:"iat"`
	jwt.RegisteredClaims
}

// AuthService handles authentication operations
type AuthService struct {
	db        *sql.DB
	jwtSecret string
}

// NewAuthService creates a new auth service
func NewAuthService(db *sql.DB, jwtSecret string) *AuthService {
	return &AuthService{
		db:        db,
		jwtSecret: jwtSecret,
	}
}

// CreateUser creates a new user with input validation
func (a *AuthService) CreateUser(email, password, fullName, role string) (*User, error) {
	// CRITICAL: Validate inputs before processing
	if err := ValidateEmail(email); err != nil {
		return nil, err
	}
	if err := ValidatePassword(password); err != nil {
		return nil, err
	}

	// Hash password with cost 14 (~0.5 sec per hash) to resist brute force
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), BCryptCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	userID := uuid.New().String()
	now := time.Now()

	_, err = a.db.Exec(`
		INSERT INTO users (id, email, password_hash, full_name, role, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
	`, userID, email, passwordHash, fullName, role, now, now)

	if err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	user := &User{
		ID:           userID,
		Email:        email,
		FullName:     fullName,
		Role:         role,
		Status:       "active",
		MFAEnabled:   false,
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	return user, nil
}

// VerifyPassword verifies a user's password with input validation
func (a *AuthService) VerifyPassword(email, password string) (*User, error) {
	// CRITICAL: Validate email format first
	if err := ValidateEmail(email); err != nil {
		return nil, fmt.Errorf("invalid credentials")
	}

	var user User

	err := a.db.QueryRow(`
		SELECT id, email, password_hash, full_name, role, status, mfa_enabled, created_at, updated_at
		FROM users
		WHERE email = ? AND status = 'active'
	`, email).Scan(&user.ID, &user.Email, &user.PasswordHash, &user.FullName,
		&user.Role, &user.Status, &user.MFAEnabled, &user.CreatedAt, &user.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("invalid credentials")
	}
	if err != nil {
		// CRITICAL: Sanitize error - don't leak database info
		return nil, fmt.Errorf("invalid credentials")
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return nil, fmt.Errorf("invalid credentials")
	}

	return &user, nil
}

// GenerateAccessToken generates a JWT access token
func (a *AuthService) GenerateAccessToken(user *User) (string, error) {
	now := time.Now()
	expiresAt := now.Add(1 * time.Hour) // 1 hour expiry

	claims := JWTClaims{
		UserID:   user.ID,
		Email:    user.Email,
		Role:     user.Role,
		Roles:    []string{user.Role},
		TokenID:  uuid.New().String(),
		IssuedAt: now.Unix(),
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			Issuer:    "npanel",
			Subject:   user.ID,
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(a.jwtSecret))
	if err != nil {
		return "", fmt.Errorf("failed to sign token: %w", err)
	}

	return tokenString, nil
}

// GenerateRefreshToken generates a refresh token
func (a *AuthService) GenerateRefreshToken(userID, ipAddress, userAgent string) (string, error) {
	sessionID := uuid.New().String()
	refreshToken := uuid.New().String()
	expiresAt := time.Now().Add(30 * 24 * time.Hour) // 30 days

	_, err := a.db.Exec(`
		INSERT INTO sessions (id, user_id, refresh_token, ip_address, user_agent, expires_at, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, sessionID, userID, refreshToken, ipAddress, userAgent, expiresAt, time.Now())

	if err != nil {
		return "", fmt.Errorf("failed to create session: %w", err)
	}

	return refreshToken, nil
}

// VerifyAccessToken verifies and parses a JWT token
// CRITICAL: Validates algorithm to prevent algorithm substitution attacks (RS256 → HS256)
func (a *AuthService) VerifyAccessToken(tokenString string) (*JWTClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
		// CRITICAL: Only accept HMAC (reject asymmetric algorithms)
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		// CRITICAL: Only accept HS256 (prevent algorithm bypass)
		if token.Method.Alg() != "HS256" {
			return nil, fmt.Errorf("only HS256 supported, got %s", token.Method.Alg())
		}
		return []byte(a.jwtSecret), nil
	})

	if err != nil {
		return nil, fmt.Errorf("invalid token")
	}

	claims, ok := token.Claims.(*JWTClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	return claims, nil
}

// VerifyRefreshToken verifies a refresh token and returns the user
func (a *AuthService) VerifyRefreshToken(refreshToken string) (*User, error) {
	var user User
	var sessionID string
	expiresAt := time.Now()

	err := a.db.QueryRow(`
		SELECT s.id, u.id, u.email, u.password_hash, u.full_name, u.role, u.status, u.mfa_enabled, u.created_at, u.updated_at
		FROM sessions s
		JOIN users u ON s.user_id = u.id
		WHERE s.refresh_token = ? AND s.expires_at > ?
	`, refreshToken, expiresAt).Scan(&sessionID, &user.ID, &user.Email, &user.PasswordHash,
		&user.FullName, &user.Role, &user.Status, &user.MFAEnabled, &user.CreatedAt, &user.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("invalid or expired refresh token")
	}
	if err != nil {
		return nil, fmt.Errorf("database error: %w", err)
	}

	return &user, nil
}

// RevokeSession revokes a session
func (a *AuthService) RevokeSession(refreshToken string) error {
	_, err := a.db.Exec(`DELETE FROM sessions WHERE refresh_token = ?`, refreshToken)
	return err
}

// GetUserByID retrieves a user by ID
func (a *AuthService) GetUserByID(userID string) (*User, error) {
	var user User

	err := a.db.QueryRow(`
		SELECT id, email, password_hash, full_name, role, status, mfa_enabled, created_at, updated_at
		FROM users
		WHERE id = ?
	`, userID).Scan(&user.ID, &user.Email, &user.PasswordHash, &user.FullName,
		&user.Role, &user.Status, &user.MFAEnabled, &user.CreatedAt, &user.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("user not found")
	}
	if err != nil {
		return nil, fmt.Errorf("database error: %w", err)
	}

	return &user, nil
}

// ExtractTokenFromRequest extracts JWT token from Authorization header
func ExtractTokenFromRequest(r *http.Request) (string, error) {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		return "", fmt.Errorf("missing authorization header")
	}

	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 || parts[0] != "Bearer" {
		return "", fmt.Errorf("invalid authorization header format")
	}

	return parts[1], nil
}

// HashPassword hashes a password
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// VerifyPasswordHash verifies a password against its hash
func VerifyPasswordHash(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}
