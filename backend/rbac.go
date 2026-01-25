package main

import (
	"context"
	"fmt"
	"net/http"
)

// Role constants
const (
	RoleRoot    = "root"
	RoleAdmin   = "admin"
	RoleReseller = "reseller"
	RoleUser    = "user"
)

// Permission defines an action a role can perform
type Permission string

const (
	// User permissions
	PermissionManageOwnDomains    Permission = "manage_own_domains"
	PermissionManageOwnEmail      Permission = "manage_own_email"
	PermissionViewOwnMetrics      Permission = "view_own_metrics"

	// Reseller permissions
	PermissionManageResellers     Permission = "manage_resellers"
	PermissionManageResellerUsers Permission = "manage_reseller_users"
	PermissionManageResellerDomains Permission = "manage_reseller_domains"

	// Admin permissions
	PermissionManageAllDomains    Permission = "manage_all_domains"
	PermissionManageAllUsers      Permission = "manage_all_users"
	PermissionManageServers       Permission = "manage_servers"
	PermissionManagePackages      Permission = "manage_packages"
	PermissionManageServices      Permission = "manage_services"

	// Root permissions
	PermissionManageSettings      Permission = "manage_settings"
	PermissionManageAdmins        Permission = "manage_admins"
	PermissionSystemAccess        Permission = "system_access"
)

// RolePermissions maps roles to their permissions
var RolePermissions = map[string][]Permission{
	RoleUser: {
		PermissionManageOwnDomains,
		PermissionManageOwnEmail,
		PermissionViewOwnMetrics,
	},
	RoleReseller: {
		PermissionManageOwnDomains,
		PermissionManageOwnEmail,
		PermissionViewOwnMetrics,
		PermissionManageResellers,
		PermissionManageResellerUsers,
		PermissionManageResellerDomains,
	},
	RoleAdmin: {
		PermissionManageOwnDomains,
		PermissionManageOwnEmail,
		PermissionViewOwnMetrics,
		PermissionManageResellers,
		PermissionManageResellerUsers,
		PermissionManageResellerDomains,
		PermissionManageAllDomains,
		PermissionManageAllUsers,
		PermissionManageServers,
		PermissionManagePackages,
		PermissionManageServices,
	},
	RoleRoot: {
		PermissionManageOwnDomains,
		PermissionManageOwnEmail,
		PermissionViewOwnMetrics,
		PermissionManageResellers,
		PermissionManageResellerUsers,
		PermissionManageResellerDomains,
		PermissionManageAllDomains,
		PermissionManageAllUsers,
		PermissionManageServers,
		PermissionManagePackages,
		PermissionManageServices,
		PermissionManageSettings,
		PermissionManageAdmins,
		PermissionSystemAccess,
	},
}

// UserContext holds user info in request context
type UserContext struct {
	UserID   string
	Email    string
	Role     string
	TokenID  string
}

// contextKey is used for storing values in context
type contextKey string

const (
	userContextKey = contextKey("user")
	requestIDKey   = contextKey("request_id")
)

// WithUserContext adds user context to request context
func WithUserContext(r *http.Request, user *UserContext) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), userContextKey, user))
}

// GetUserContext retrieves user context from request context
func GetUserContext(r *http.Request) (*UserContext, bool) {
	user, ok := r.Context().Value(userContextKey).(*UserContext)
	return user, ok
}

// HasPermission checks if a role has a specific permission
func HasPermission(role string, permission Permission) bool {
	permissions, ok := RolePermissions[role]
	if !ok {
		return false
	}

	for _, p := range permissions {
		if p == permission {
			return true
		}
	}
	return false
}

// RequirePermission middleware checks for required permissions
func (s *APIServer) RequirePermission(permission Permission) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, ok := GetUserContext(r)
			if !ok {
				s.respondError(w, http.StatusUnauthorized, "unauthorized")
				return
			}

			if !HasPermission(user.Role, permission) {
				s.respondError(w, http.StatusForbidden, "permission denied")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// RequireRole middleware checks for required role
func (s *APIServer) RequireRole(roles ...string) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, ok := GetUserContext(r)
			if !ok {
				s.respondError(w, http.StatusUnauthorized, "unauthorized")
				return
			}

			hasRole := false
			for _, role := range roles {
				if user.Role == role {
					hasRole = true
					break
				}
			}

			if !hasRole {
				s.respondError(w, http.StatusForbidden, "insufficient privileges")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// LogAuditAction logs an audit trail entry
func (s *APIServer) LogAuditAction(userID, action, resourceType, resourceID, result, ipAddress, userAgent string, details interface{}) error {
	detailsJSON := ""
	if details != nil {
		// TODO: Convert details to JSON string
	}

	var userIDPtr *string
	if userID != "" {
		userIDPtr = &userID
	}

	_, err := s.db.Exec(`
		INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, details, result, ip_address, user_agent, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, generateID(), userIDPtr, action, resourceType, resourceID, detailsJSON, result, ipAddress, userAgent, now())

	return err
}
