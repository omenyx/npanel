"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { NavSection } from "@/app-shell/types";
import { Dialog, DialogContent } from "@/shared/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/ui/command";

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: NavSection[];
};

export function CommandPalette({ open, onOpenChange, sections }: CommandPaletteProps) {
  const router = useRouter();

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isK = e.key.toLowerCase() === "k";
      if ((e.metaKey || e.ctrlKey) && isK) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 max-w-xl">
        <Command>
          <CommandInput placeholder="Search navigation…" />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            {sections.map((section) => (
              <CommandGroup key={section.key} heading={section.label}>
                {section.items.map((item) => (
                  <CommandItem
                    key={item.key}
                    value={item.label}
                    onSelect={() => {
                      onOpenChange(false);
                      router.push(item.href);
                    }}
                  >
                    {item.icon ? <item.icon className="h-4 w-4 text-text-muted" /> : null}
                    <span>{item.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

