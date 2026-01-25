package main

import (
	"fmt"
	"strings"
	"unicode"
)

// ValidateEmail checks email format and length
func ValidateEmail(email string) error {
	if len(email) == 0 || len(email) > 255 {
		return fmt.Errorf("email must be 1-255 characters")
	}

	if !strings.Contains(email, "@") {
		return fmt.Errorf("invalid email format")
	}

	// Split on @
	parts := strings.Split(email, "@")
	if len(parts) != 2 {
		return fmt.Errorf("invalid email format")
	}

	local, domain := parts[0], parts[1]

	if len(local) == 0 || len(local) > 64 {
		return fmt.Errorf("email local part must be 1-64 characters")
	}

	if len(domain) == 0 || len(domain) > 255 {
		return fmt.Errorf("email domain must be 1-255 characters")
	}

	// Validate domain has at least one dot
	if !strings.Contains(domain, ".") {
		return fmt.Errorf("domain must contain at least one dot")
	}

	// Validate domain TLD
	domainParts := strings.Split(domain, ".")
	for _, part := range domainParts {
		if len(part) == 0 {
			return fmt.Errorf("invalid domain format")
		}
	}

	return nil
}

// ValidatePassword checks password strength requirements
func ValidatePassword(password string) error {
	if len(password) < 12 {
		return fmt.Errorf("password must be at least 12 characters")
	}

	if len(password) > 128 {
		return fmt.Errorf("password must be less than 128 characters")
	}

	// Require mix of: uppercase, lowercase, digit, special char
	hasUpper := false
	hasLower := false
	hasDigit := false
	hasSpecial := false

	for _, ch := range password {
		switch {
		case ch >= 'A' && ch <= 'Z':
			hasUpper = true
		case ch >= 'a' && ch <= 'z':
			hasLower = true
		case ch >= '0' && ch <= '9':
			hasDigit = true
		case unicode.IsPunct(ch) || unicode.IsSymbol(ch) || ch == ' ':
			hasSpecial = true
		}
	}

	if !hasUpper {
		return fmt.Errorf("password must contain at least one uppercase letter")
	}
	if !hasLower {
		return fmt.Errorf("password must contain at least one lowercase letter")
	}
	if !hasDigit {
		return fmt.Errorf("password must contain at least one digit")
	}
	if !hasSpecial {
		return fmt.Errorf("password must contain at least one special character")
	}

	return nil
}

// SanitizeError removes sensitive data from error messages
func SanitizeError(err string) string {
	// Don't leak internal details
	if strings.Contains(strings.ToLower(err), "database") {
		return "service error"
	}
	if strings.Contains(strings.ToLower(err), "sql") {
		return "service error"
	}
	if strings.Contains(strings.ToLower(err), "connection") {
		return "service error"
	}
	return err
}

// ValidateJWTSecret checks if JWT secret meets minimum requirements
func ValidateJWTSecret(secret string) error {
	if len(secret) == 0 {
		return fmt.Errorf("JWT_SECRET environment variable not set")
	}
	if len(secret) < 32 {
		return fmt.Errorf("JWT_SECRET must be at least 32 characters (256 bits)")
	}
	return nil
}
