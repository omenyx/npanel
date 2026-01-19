"use client";

import * as React from "react";
import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="w-8 h-8" />;
  }

  return (
    <div className="flex items-center bg-surface border border-border rounded-full p-1">
        <button
            onClick={() => setTheme("light")}
            className={`p-1.5 rounded-full transition-colors ${theme === 'light' ? 'bg-background shadow-sm text-primary' : 'text-text-muted hover:text-text-main'}`}
            title="Light Mode"
        >
            <Sun className="h-4 w-4" />
        </button>
        <button
            onClick={() => setTheme("system")}
            className={`p-1.5 rounded-full transition-colors ${theme === 'system' ? 'bg-background shadow-sm text-primary' : 'text-text-muted hover:text-text-main'}`}
            title="System"
        >
            <Monitor className="h-4 w-4" />
        </button>
        <button
            onClick={() => setTheme("dark")}
            className={`p-1.5 rounded-full transition-colors ${theme === 'dark' ? 'bg-background shadow-sm text-primary' : 'text-text-muted hover:text-text-main'}`}
            title="Dark Mode"
        >
            <Moon className="h-4 w-4" />
        </button>
    </div>
  );
}
