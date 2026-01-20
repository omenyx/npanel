import type { NavSection, PanelRole } from "@/app-shell/types";

export function filterNavSectionsForRole(
  sections: NavSection[],
  role: PanelRole | null,
): NavSection[] {
  if (!role) return [];
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (!item.roles || item.roles.length === 0) return true;
        return item.roles.includes(role);
      }),
    }))
    .filter((section) => section.items.length > 0);
}

