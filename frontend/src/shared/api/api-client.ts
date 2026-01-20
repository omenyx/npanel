import { env } from "@/shared/config/env";
import { ApiError } from "@/shared/api/api-error";

type RequestOptions = RequestInit & {
  auth?: boolean;
};

export async function requestJson<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const url = toAbsoluteUrl(path);
  const auth = options.auth ?? true;

  const headers = new Headers(options.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  if (auth) {
    const token = getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(url, { ...options, headers });
  const contentType = res.headers.get("content-type") ?? "";

  if (res.ok) {
    if (contentType.includes("application/json")) {
      return (await res.json()) as T;
    }
    return (await res.text()) as unknown as T;
  }

  const errorBody = await safeParseErrorBody(res, contentType);
  const message =
    typeof (errorBody as any)?.message === "string"
      ? (errorBody as any).message
      : `Request failed (${res.status})`;

  throw new ApiError({
    status: res.status,
    message,
    code: typeof (errorBody as any)?.error === "string" ? (errorBody as any).error : undefined,
    details: errorBody,
  });
}

export function toAbsoluteUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${env.apiBaseUrl}${normalizedPath}`;
}

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("npanel_access_token");
  } catch {
    return null;
  }
}

async function safeParseErrorBody(
  res: Response,
  contentType: string,
): Promise<unknown> {
  try {
    if (contentType.includes("application/json")) return await res.json();
    return await res.text();
  } catch {
    return null;
  }
}

