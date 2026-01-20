export type ToolStatusItem = {
  name: string;
  available: boolean;
  packageHint?: string;
};

export function normalizeToolStatusList(tools: unknown): ToolStatusItem[] {
  if (Array.isArray(tools)) {
    return tools
      .map((t: any) => ({
        name: String(t?.name ?? ""),
        available: Boolean(t?.available),
        packageHint: typeof t?.packageHint === "string" ? t.packageHint : undefined,
      }))
      .filter((t) => t.name.length > 0);
  }

  if (tools && typeof tools === "object") {
    return Object.entries(tools as Record<string, unknown>).map(([name, value]) => {
      if (typeof value === "boolean") {
        return { name, available: value };
      }
      if (value && typeof value === "object") {
        const v: any = value;
        return {
          name,
          available: Boolean(v.available),
          packageHint: typeof v.packageHint === "string" ? v.packageHint : undefined,
        };
      }
      return { name, available: false };
    });
  }

  return [];
}

