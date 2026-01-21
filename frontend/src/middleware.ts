import { NextRequest, NextResponse } from "next/server";

/**
 * Port-based routing and enforcement middleware
 * 
 * Port mapping:
 * - 2082: Customer HTTP
 * - 2083: Customer HTTPS
 * - 2086: Admin HTTP
 * - 2087: Admin HTTPS
 * - 8080: Mixed (development, uses stored role)
 * 
 * This middleware:
 * 1. Extracts the port from the Host header
 * 2. Enforces that users on customer ports can only access /customer
 * 3. Enforces that users on admin ports can only access /admin
 * 4. Allows mixed access on port 8080 (development)
 */

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const host = request.headers.get("host") || "";
  
  // Extract port from host header (format: "localhost:2082" or just "localhost")
  const portMatch = host.split(":")[1];
  const port = portMatch ? parseInt(portMatch, 10) : 80;
  
  // Determine which interface this port provides access to
  let allowedInterface: "admin" | "customer" | "mixed" | null = null;
  
  if (port === 2086 || port === 2087) {
    allowedInterface = "admin";
  } else if (port === 2082 || port === 2083) {
    allowedInterface = "customer";
  } else if (port === 8080 || port === 80 || port === 443 || port === 3001) {
    // Mixed interface for development, allow based on stored role
    allowedInterface = "mixed";
  }

  // Public routes that don't need enforcement
  const publicRoutes = [
    "/",
    "/login",
    "/v1/auth/login",
    "/api/auth/login",
    "/_next",
    "/favicon.ico",
  ];

  const isPublicRoute = publicRoutes.some((route) =>
    pathname.startsWith(route)
  );

  // Don't enforce on public routes
  if (isPublicRoute) {
    return NextResponse.next();
  }

  // Enforce port-based access
  if (allowedInterface === "admin") {
    // Admin port - only allow /admin routes
    if (!pathname.startsWith("/admin")) {
      // Redirect to admin dashboard
      const newUrl = request.nextUrl.clone();
      newUrl.pathname = "/admin";
      return NextResponse.redirect(newUrl);
    }
  } else if (allowedInterface === "customer") {
    // Customer port - only allow /customer routes
    if (!pathname.startsWith("/customer")) {
      // Redirect to customer dashboard
      const newUrl = request.nextUrl.clone();
      newUrl.pathname = "/customer";
      return NextResponse.redirect(newUrl);
    }
  } else if (allowedInterface === "mixed") {
    // Development port - check stored role but allow both paths
    // This is handled by the application logic, not middleware
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
