import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ArrowRight, Sun, Moon, Building2, CornerDownLeft } from 'lucide-react';

export interface CommandItem {
  id: string;
  label: string;
  group: string;
  keywords?: string;
  icon: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
}

export function CommandPalette({
  open,
  onClose,
  items,
  branches,
  selectedBranchId,
  onSelectBranch,
  darkMode,
  onToggleTheme,
}: {
  open: boolean;
  onClose: () => void;
  items: CommandItem[];
  branches: { id: number; branchCode: string; name: string; district: string }[];
  selectedBranchId: string;
  onSelectBranch: (branchId: string) => void;
  darkMode: boolean;
  onToggleTheme: () => void;
}) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const allCommands = useMemo<CommandItem[]>(() => {
    const quickActions: CommandItem[] = [
      {
        id: 'action-theme',
        label: darkMode ? 'Switch to Light Workspace' : 'Switch to Dark Obsidian Workspace',
        group: 'Workspace Actions',
        keywords: 'theme dark light appearance mode',
        icon: darkMode ? Sun : Moon,
        onSelect: () => {
          onToggleTheme();
          onClose();
        },
      },
      {
        id: 'branch-all',
        label: `Scope: All Tamil Nadu Branches${selectedBranchId === 'all' ? ' (Active)' : ''}`,
        group: 'Branch Scope',
        keywords: 'branch scope all tamil nadu',
        icon: Building2,
        onSelect: () => {
          onSelectBranch('all');
          onClose();
        },
      },
      ...branches.map((b) => ({
        id: `branch-${b.id}`,
        label: `Scope: ${b.name} (${b.branchCode})${selectedBranchId === String(b.id) ? ' (Active)' : ''}`,
        group: 'Branch Scope',
        keywords: `branch ${b.district} ${b.branchCode} ${b.name}`,
        icon: Building2,
        onSelect: () => {
          onSelectBranch(String(b.id));
          onClose();
        },
      })),
    ];
    return [...items, ...quickActions];
  }, [items, branches, selectedBranchId, darkMode, onSelectBranch, onToggleTheme, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allCommands.slice(0, 12);
    return allCommands
      .filter((c) => `${c.label} ${c.group} ${c.keywords ?? ''}`.toLowerCase().includes(q))
      .slice(0, 12);
  }, [allCommands, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => (filtered.length ? (prev + 1) % filtered.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => (filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0));
      } else if (e.key === 'Enter' && filtered[activeIndex]) {
        e.preventDefault();
        filtered[activeIndex].onSelect();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, filtered, activeIndex, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[#04070E]/65 px-4 pt-[12vh] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-2xl dark:border-white/[0.12] dark:bg-[#0F1624]">
        <div className="flex items-center gap-3 border-b border-slate-200/80 px-4 py-3.5 dark:border-white/[0.08]">
          <Search className="h-4 w-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            placeholder="Jump to module, ledger, auction, or branch..."
            className="w-full bg-transparent text-sm text-slate-950 placeholder:text-slate-400 focus:outline-none dark:text-white"
          />
          <kbd className="hidden sm:inline-block rounded border border-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 dark:border-white/[0.12]">
            ESC
          </kbd>
        </div>

        <div className="max-h-[360px] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500">
              No matching module or command found.
            </p>
          ) : (
            <div className="space-y-0.5">
              {filtered.map((item, idx) => {
                const Icon = item.icon;
                const isActive = idx === activeIndex;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={item.onSelect}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-xs transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-[#0B1220] text-white dark:bg-emerald-500/15 dark:text-emerald-300'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Icon
                        className={`h-4 w-4 shrink-0 ${
                          isActive ? 'text-emerald-400' : 'text-slate-400'
                        }`}
                      />
                      <span className="font-medium truncate">{item.label}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      <span
                        className={`text-[11px] ${
                          isActive ? 'text-slate-300 dark:text-emerald-400/80' : 'text-slate-400'
                        }`}
                      >
                        {item.group}
                      </span>
                      {isActive && <ArrowRight className="h-3.5 w-3.5 opacity-80" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200/80 px-4 py-2 text-[11px] text-slate-400 dark:border-white/[0.08]">
          <span>Use ↑ ↓ to navigate</span>
          <span className="inline-flex items-center gap-1">
            <CornerDownLeft className="h-3 w-3" /> Select
          </span>
        </div>
      </div>
    </div>
  );
}
