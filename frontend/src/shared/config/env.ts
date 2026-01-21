export const env = {
  apiBaseUrl: normalizeBaseUrl(
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api",
  ),
} as const;

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}
