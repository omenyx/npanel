// Phase 3: Frontend Development - Next.js Implementation
// This file contains the main frontend structure and components

// frontend/package.json
{
  "name": "npanel-frontend",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "jest",
    "test:security": "npm audit && npm audit --audit-level=moderate"
  },
  "dependencies": {
    "next": "14.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "axios": "^1.6.0",
    "jsonwebtoken": "^9.1.0",
    "next-auth": "^4.24.0",
    "react-hook-form": "^7.48.0",
    "zod": "^3.22.0",
    "@headlessui/react": "^1.7.0",
    "tailwindcss": "^3.3.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0",
    "@types/react": "^18.2.0",
    "jest": "^29.0.0",
    "@testing-library/react": "^14.0.0"
  }
}

// frontend/lib/api.ts - API client with security controls
import axios, { AxiosInstance } from 'axios';
import { getSession } from 'next-auth/react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://localhost:8443';
const REQUEST_TIMEOUT = 30000;
const MAX_REQUEST_SIZE = 10 * 1024 * 1024; // 10MB

class APIClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: REQUEST_TIMEOUT,
      maxBodyLength: MAX_REQUEST_SIZE,
      maxContentLength: MAX_REQUEST_SIZE,
      validateStatus: (status) => status < 500,
    });

    // Add request interceptor for auth token
    this.client.interceptors.request.use(async (config) => {
      const session = await getSession();
      if (session?.accessToken) {
        config.headers.Authorization = `Bearer ${session.accessToken}`;
      }

      // CSRF token from meta tag
      const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
      if (csrfToken) {
        config.headers['X-CSRF-Token'] = csrfToken;
      }

      return config;
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        // Sanitize error messages
        if (error.response?.status === 401) {
          // Handle unauthorized
          return Promise.reject(new Error('Authentication failed'));
        }
        if (error.response?.status === 403) {
          return Promise.reject(new Error('Permission denied'));
        }
        if (error.response?.status === 429) {
          return Promise.reject(new Error('Too many requests. Please try again later.'));
        }
        // Generic error for sensitive info
        return Promise.reject(new Error('An error occurred. Please try again.'));
      }
    );
  }

  async get(url: string, config?: any) {
    return this.client.get(url, config);
  }

  async post(url: string, data: any, config?: any) {
    return this.client.post(url, data, config);
  }

  async put(url: string, data: any, config?: any) {
    return this.client.put(url, data, config);
  }

  async delete(url: string, config?: any) {
    return this.client.delete(url, config);
  }
}

export const apiClient = new APIClient();

// frontend/lib/validation.ts - Input validation
import { z } from 'zod';

export const emailSchema = z.string().email('Invalid email format').max(255);

export const passwordSchema = z.string()
  .min(12, 'Password must be at least 12 characters')
  .regex(/[A-Z]/, 'Must contain uppercase letter')
  .regex(/[a-z]/, 'Must contain lowercase letter')
  .regex(/[0-9]/, 'Must contain number')
  .regex(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>?/]/, 'Must contain special character');

export const domainSchema = z.string()
  .min(3, 'Domain too short')
  .max(255, 'Domain too long')
  .regex(/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/, 'Invalid domain format');

export const ipv4Schema = z.string()
  .regex(/^(\d{1,3}\.){3}\d{1,3}$/, 'Invalid IPv4 format')
  .refine((ip) => {
    const parts = ip.split('.').map(Number);
    return parts.every(part => part >= 0 && part <= 255);
  }, 'Invalid IPv4 octets');

export const createDomainSchema = z.object({
  name: domainSchema,
  webRoot: z.string().optional(),
});

export const createEmailSchema = z.object({
  username: z.string().min(3).max(64),
  password: passwordSchema,
  quotaMB: z.number().min(1).max(10000),
});

export const createDNSRecordSchema = z.object({
  type: z.enum(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV']),
  name: z.string().min(1),
  value: z.string().min(1),
  ttl: z.number().min(300).max(86400),
});

// frontend/pages/auth/login.tsx - Login page with security controls
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { emailSchema, passwordSchema } from '@/lib/validation';

const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export default function LoginPage() {
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(loginSchema),
  });

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (data: any) => {
    setLoading(true);
    try {
      const result = await signIn('credentials', {
        email: data.email,
        password: data.password,
        redirect: false,
      });

      if (!result?.ok) {
        setError('Invalid credentials or account locked');
      }
    } catch (err) {
      setError('Authentication failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8">
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">nPanel Login</h2>
        
        <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-6">
          {error && (
            <div className="rounded-md bg-red-50 p-4">
              <p className="text-sm font-medium text-red-800">{error}</p>
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">Email</label>
            <input
              {...register('email')}
              type="email"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
              placeholder="user@example.com"
            />
            {errors.email && <p className="mt-1 text-sm text-red-600">{errors.email.message as string}</p>}
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">Password</label>
            <input
              {...register('password')}
              type="password"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
              placeholder="••••••••"
            />
            {errors.password && <p className="mt-1 text-sm text-red-600">{errors.password.message as string}</p>}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

// frontend/pages/api/auth/[...nextauth].ts - Authentication configuration
import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { apiClient } from '@/lib/api';
import { emailSchema, passwordSchema } from '@/lib/validation';

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        // Validate input
        try {
          emailSchema.parse(credentials?.email);
          passwordSchema.parse(credentials?.password);
        } catch (err) {
          throw new Error('Invalid email or password format');
        }

        try {
          // Call backend API
          const response = await apiClient.post('/api/auth/login', {
            email: credentials?.email,
            password: credentials?.password,
          });

          if (response.status === 200 && response.data.access_token) {
            return {
              id: response.data.user_id,
              email: response.data.email,
              accessToken: response.data.access_token,
              refreshToken: response.data.refresh_token,
            };
          }

          throw new Error('Authentication failed');
        } catch (err) {
          // Generic error message (don't leak backend errors)
          throw new Error('Invalid credentials');
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.accessToken = user.accessToken;
        token.refreshToken = user.refreshToken;
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      return session;
    },
  },
  pages: {
    signIn: '/auth/login',
    error: '/auth/error',
  },
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60, // 24 hours
    updateAge: 24 * 60 * 60,
  },
};

export default NextAuth(authOptions);

// frontend/middleware.ts - Security middleware
import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export const middleware = withAuth(
  function onSuccess(req) {
    // Add security headers
    const headers = new Headers(req.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('X-XSS-Protection', '1; mode=block');
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    return NextResponse.next({ request: { headers } });
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: '/auth/login',
    },
  }
);

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*'],
};

// frontend/components/DomainForm.tsx - Domain creation with validation
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createDomainSchema } from '@/lib/validation';
import { apiClient } from '@/lib/api';
import { useState } from 'react';

export default function DomainForm({ onSuccess }: { onSuccess: () => void }) {
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(createDomainSchema),
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const onSubmit = async (data: any) => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await apiClient.post('/api/domains', data);

      if (response.status === 201) {
        setSuccess('Domain created successfully');
        onSuccess();
      } else {
        setError(response.data?.message || 'Failed to create domain');
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {error && <div className="bg-red-50 p-4 text-red-800">{error}</div>}
      {success && <div className="bg-green-50 p-4 text-green-800">{success}</div>}

      <div>
        <label className="block text-sm font-medium">Domain Name</label>
        <input
          {...register('name')}
          type="text"
          placeholder="example.com"
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
        />
        {errors.name && <p className="text-red-600 text-sm">{errors.name.message as string}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium">Web Root (optional)</label>
        <input
          {...register('webRoot')}
          type="text"
          placeholder="/var/www/example.com"
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 disabled:opacity-50"
      >
        {loading ? 'Creating...' : 'Create Domain'}
      </button>
    </form>
  );
}

// frontend/components/DNSForm.tsx - DNS record creation with validation
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createDNSRecordSchema } from '@/lib/validation';
import { apiClient } from '@/lib/api';
import { useState } from 'react';

export default function DNSForm({ domainId, onSuccess }: any) {
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(createDNSRecordSchema),
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async (data: any) => {
    setLoading(true);
    setError('');

    try {
      const response = await apiClient.post(`/api/domains/${domainId}/dns`, data);

      if (response.status === 201) {
        onSuccess();
      } else {
        setError(response.data?.message || 'Failed to create DNS record');
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {error && <div className="bg-red-50 p-4 text-red-800">{error}</div>}

      <div>
        <label className="block text-sm font-medium">Record Type</label>
        <select
          {...register('type')}
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
        >
          <option value="">Select type</option>
          <option value="A">A (IPv4)</option>
          <option value="AAAA">AAAA (IPv6)</option>
          <option value="CNAME">CNAME</option>
          <option value="MX">MX (Mail)</option>
          <option value="TXT">TXT</option>
          <option value="NS">NS (Nameserver)</option>
          <option value="SRV">SRV</option>
        </select>
        {errors.type && <p className="text-red-600 text-sm">{errors.type.message as string}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium">Name</label>
        <input
          {...register('name')}
          type="text"
          placeholder="www or mail"
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
        />
        {errors.name && <p className="text-red-600 text-sm">{errors.name.message as string}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium">Value</label>
        <input
          {...register('value')}
          type="text"
          placeholder="192.168.1.1 or example.com"
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
        />
        {errors.value && <p className="text-red-600 text-sm">{errors.value.message as string}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium">TTL</label>
        <input
          {...register('ttl', { valueAsNumber: true })}
          type="number"
          placeholder="3600"
          min="300"
          max="86400"
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
        />
        {errors.ttl && <p className="text-red-600 text-sm">{errors.ttl.message as string}</p>}
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 disabled:opacity-50"
      >
        {loading ? 'Creating...' : 'Create Record'}
      </button>
    </form>
  );
}

// frontend/pages/dashboard.tsx - Main dashboard
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

export default function Dashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/login');
    }
  }, [status, router]);

  if (status === 'loading') {
    return <div>Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold">nPanel</h1>
            </div>
            <div className="flex items-center gap-4">
              <span>{session?.user?.email}</span>
              <button className="text-gray-600 hover:text-gray-900">Logout</button>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <h2 className="text-3xl font-bold text-gray-900">Welcome to nPanel</h2>
        <p className="mt-4 text-gray-600">Manage your domains, emails, and DNS records</p>
      </div>
    </div>
  );
}

// frontend/.env.local - Environment configuration
NEXT_PUBLIC_API_URL=https://localhost:8443
NEXTAUTH_SECRET=your-secret-key-change-this-in-production
NEXTAUTH_URL=http://localhost:3000
