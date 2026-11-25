import React, { useState, useEffect, useMemo, useRef } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Toaster, toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import {
  LayoutDashboard,
  Users,
  FileCheck2,
  Layers,
  FolderKanban,
  UserPlus,
  CalendarClock,
  IndianRupee,
  Receipt,
  AlertCircle,
  Gavel,
  Percent,
  Award,
  Shield,
  BookOpen,
  Wallet,
  Landmark,
  CheckSquare,
  FileText,
  Bell,
  BarChart3,
  History,
  Building2,
  Briefcase,
  Settings,
  UserCircle2,
  LogOut,
  Menu,
  X,
  Sun,
  Moon,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Globe,
} from 'lucide-react';
import { apiRequest, setAuthToken, type SessionUser } from './lib/api';
import { ROLE_LABELS, type UserRole } from './domain/finance';
import { t, type AppLanguage } from './lib/i18n';
import { LoginView } from './components/LoginView';
import { DashboardView } from './components/DashboardView';
import { CustomersModule } from './components/CustomersModule';
import { ChitOperationsModule } from './components/ChitOperationsModule';
import { CollectionsModule } from './components/CollectionsModule';
import { AuctionsPayoutsModule } from './components/AuctionsPayoutsModule';
import { AccountingTreasuryModule } from './components/AccountingTreasuryModule';
import { GovernanceModule } from './components/GovernanceModule';
import { CommandPalette, type CommandItem } from './components/CommandPalette';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 15000,
    },
  },
});

interface NavGroup {
  labelKey: string;
  items: { id: string; labelKey: string; icon: React.ComponentType<{ className?: string }> }[];
}

const STAFF_NAV: NavGroup[] = [
  {
    labelKey: 'navGroupCommand',
    items: [
      { id: 'dashboard', labelKey: 'navDashboard', icon: LayoutDashboard },
      { id: 'approvals', labelKey: 'navApprovals', icon: CheckSquare },
      { id: 'notifications', labelKey: 'navNotifications', icon: Bell },
    ],
  },
  {
    labelKey: 'navGroupSubscribers',
    items: [
      { id: 'customers', labelKey: 'navCustomers', icon: Users },
      { id: 'kyc', labelKey: 'navKyc', icon: FileCheck2 },
      { id: 'guarantors', labelKey: 'navGuarantors', icon: Shield },
    ],
  },
  {
    labelKey: 'navGroupOperations',
    items: [
      { id: 'schemes', labelKey: 'navSchemes', icon: Layers },
      { id: 'groups', labelKey: 'navGroups', icon: FolderKanban },
      { id: 'enrollments', labelKey: 'navEnrollments', icon: UserPlus },
      { id: 'installments', labelKey: 'navInstallments', icon: CalendarClock },
    ],
  },
  {
    labelKey: 'navGroupCollections',
    items: [
      { id: 'collections', labelKey: 'navCollections', icon: IndianRupee },
      { id: 'payments', labelKey: 'navPayments', icon: Receipt },
      { id: 'outstandings', labelKey: 'navOutstandings', icon: AlertCircle },
    ],
  },
  {
    labelKey: 'navGroupAuctions',
    items: [
      { id: 'auctions', labelKey: 'navAuctions', icon: Gavel },
      { id: 'dividends', labelKey: 'navDividends', icon: Percent },
      { id: 'payouts', labelKey: 'navPayouts', icon: Award },
    ],
  },
  {
    labelKey: 'navGroupFinance',
    items: [
      { id: 'accounting', labelKey: 'navAccounting', icon: BookOpen },
      { id: 'cash', labelKey: 'navCash', icon: Wallet },
      { id: 'bank', labelKey: 'navBank', icon: Landmark },
    ],
  },
  {
    labelKey: 'navGroupGovernance',
    items: [
      { id: 'reports', labelKey: 'navReports', icon: BarChart3 },
      { id: 'documents', labelKey: 'navDocuments', icon: FileText },
      { id: 'audit', labelKey: 'navAudit', icon: History },
      { id: 'branches', labelKey: 'navBranches', icon: Building2 },
      { id: 'employees', labelKey: 'navEmployees', icon: Briefcase },
      { id: 'portal', labelKey: 'navPortal', icon: UserCircle2 },
      { id: 'settings', labelKey: 'navSettings', icon: Settings },
    ],
  },
];

function WorkspaceShell({
  user,
  onSignOut,
}: {
  user: SessionUser;
  onSignOut: () => void;
}) {
  const isCustomerRole = user.role === 'CUSTOMER';
  const [activeRoute, setActiveRoute] = useState<string>(isCustomerRole ? 'portal' : 'dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedBranchId, setSelectedBranchId] = useState<string>(
    user.branchId && ['BRANCH_MANAGER', 'COLLECTION_AGENT', 'CUSTOMER_SERVICE'].includes(user.role)
      ? String(user.branchId)
      : 'all'
  );
  const [commandOpen, setCommandOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [lang, setLang] = useState<AppLanguage>('en');
  const profileRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  // Global Cmd+K / Ctrl+K listener
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setProfileOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Click-outside close for profile popover
  useEffect(() => {
    if (!profileOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [profileOpen]);

  const { data: orgData } = useQuery({
    queryKey: ['company'],
    queryFn: () => apiRequest<{ company: any; branches: any[] }>('/company'),
  });

  const branches = orgData?.branches ?? [];
  const company = orgData?.company ?? null;

  const navGroups: NavGroup[] = isCustomerRole
    ? [
        {
          labelKey: 'navGroupPortal',
          items: [
            { id: 'portal', labelKey: 'navMyPassbook', icon: UserCircle2 },
            { id: 'settings', labelKey: 'navSettings', icon: Settings },
          ],
        },
      ]
    : STAFF_NAV;

  const activeBreadcrumb = useMemo(() => {
    for (const group of navGroups) {
      const found = group.items.find((i) => i.id === activeRoute);
      if (found) return { group: t(lang, group.labelKey), label: t(lang, found.labelKey) };
    }
    return { group: t(lang, 'navGroupCommand'), label: t(lang, 'navDashboard') };
  }, [activeRoute, navGroups, lang]);

  const commandItems = useMemo<CommandItem[]>(
    () =>
      navGroups.flatMap((group) =>
        group.items.map((item) => ({
          id: item.id,
          label: t(lang, item.labelKey),
          group: t(lang, group.labelKey),
          icon: item.icon,
          onSelect: () => {
            setActiveRoute(item.id);
            setCommandOpen(false);
          },
        }))
      ),
    [navGroups, lang]
  );

  async function handleLogout() {
    setProfileOpen(false);
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch {
      // ignore network error on sign-out
    }
    setAuthToken(null);
    queryClient.clear();
    toast.success('Signed out securely.');
    onSignOut();
  }

  function renderMainView() {
    switch (activeRoute) {
      case 'dashboard':
        return (
          <DashboardView
            selectedBranchId={selectedBranchId}
            onSelectBranch={(id) => {
              if (!user.branchId || !['BRANCH_MANAGER', 'COLLECTION_AGENT', 'CUSTOMER_SERVICE'].includes(user.role)) {
                setSelectedBranchId(id);
              }
            }}
            onNavigate={(r) => setActiveRoute(r)}
            lang={lang}
          />
        );
      case 'customers':
        return (
          <CustomersModule
            selectedBranchId={selectedBranchId}
            branches={branches}
            mode="customers"
          />
        );
      case 'kyc':
        return (
          <CustomersModule
            selectedBranchId={selectedBranchId}
            branches={branches}
            mode="kyc"
          />
        );
      case 'schemes':
      case 'groups':
      case 'enrollments':
      case 'installments':
        return (
          <ChitOperationsModule
            view={activeRoute}
            selectedBranchId={selectedBranchId}
            branches={branches}
          />
        );
      case 'collections':
        return <CollectionsModule view="collect" selectedBranchId={selectedBranchId} />;
      case 'payments':
        return <CollectionsModule view="payments" selectedBranchId={selectedBranchId} />;
      case 'outstandings':
        return <CollectionsModule view="outstandings" selectedBranchId={selectedBranchId} />;
      case 'auctions':
      case 'dividends':
      case 'payouts':
      case 'guarantors':
        return (
          <AuctionsPayoutsModule
            view={activeRoute}
            selectedBranchId={selectedBranchId}
            branches={branches}
          />
        );
      case 'accounting':
      case 'cash':
      case 'bank':
        return (
          <AccountingTreasuryModule
            view={activeRoute}
            selectedBranchId={selectedBranchId}
            branches={branches}
          />
        );
      default:
        return (
          <GovernanceModule
            view={activeRoute as any}
            selectedBranchId={selectedBranchId}
            branches={branches}
            company={company}
            user={user}
          />
        );
    }
  }

  const initials = user.fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join('');

  return (
    <div className="flex min-h-screen bg-[#F6F7F9] text-slate-950 dark:bg-[#070B14] dark:text-slate-100">
      {/* Desktop Obsidian Architectural Command Rail */}
      <aside
        className={`hidden lg:flex flex-col border-r border-white/[0.08] bg-[#0B1220] text-slate-300 transition-all duration-200 ${
          collapsed ? 'w-[72px]' : 'w-[252px]'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-white/[0.08] px-4">
          {!collapsed && (
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-500/15 border border-emerald-400/25 font-display text-xs font-semibold text-emerald-300">
                K
              </span>
              <span className="font-display text-[15px] font-semibold tracking-tight text-white truncate">
                {t(lang, 'brandName')}
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-white cursor-pointer"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5" aria-label="Primary navigation">
          {navGroups.map((group) => (
            <div key={group.labelKey}>
              {!collapsed && (
                <p className="px-2.5 pb-1.5 text-[11px] font-medium text-slate-500">
                  {t(lang, group.labelKey)}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeRoute === item.id;
                  const label = t(lang, item.labelKey);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveRoute(item.id)}
                      title={collapsed ? label : undefined}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors cursor-pointer ${
                        active
                          ? 'bg-white/[0.11] text-white'
                          : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-100'
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 shrink-0 ${
                          active ? 'text-emerald-400' : 'text-slate-500'
                        }`}
                      />
                      {!collapsed && <span className="truncate">{label}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/[0.08] p-3">
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-400 hover:bg-red-500/10 hover:text-red-300 cursor-pointer"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!collapsed && <span>{t(lang, 'signOut')}</span>}
          </button>
        </div>
      </aside>

      {/* Mobile Drawer Navigation */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-[#04070E]/65 backdrop-blur-[1px]"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 flex w-72 flex-col bg-[#0B1220] text-slate-200 h-full shadow-2xl">
            <div className="flex h-16 items-center justify-between border-b border-white/[0.08] px-4">
              <span className="font-display text-base font-semibold text-white">
                {t(lang, 'brandName')}
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation menu"
                className="p-1.5 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3 space-y-4">
              {navGroups.map((group) => (
                <div key={group.labelKey}>
                  <p className="px-2 pb-1 text-[11px] font-medium text-slate-500">
                    {t(lang, group.labelKey)}
                  </p>
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = activeRoute === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setActiveRoute(item.id);
                          setMobileMenuOpen(false);
                        }}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium cursor-pointer ${
                          active ? 'bg-white/[0.11] text-white' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <Icon className={`h-4 w-4 ${active ? 'text-emerald-400' : 'text-slate-500'}`} />
                        <span>{t(lang, item.labelKey)}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Workspace Column */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Clean Contextual Top Bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-200/80 bg-[#F6F7F9]/90 px-4 lg:px-8 backdrop-blur-md dark:border-white/[0.07] dark:bg-[#070B14]/90">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-200/60 lg:hidden dark:text-slate-300 dark:hover:bg-white/[0.06] cursor-pointer"
            >
              <Menu className="h-5 w-5" />
            </button>

            <nav aria-label="Breadcrumb" className="hidden md:flex items-center gap-2 text-xs whitespace-nowrap">
              <span className="text-slate-400 dark:text-slate-500">{activeBreadcrumb.group}</span>
              <span className="text-slate-300 dark:text-slate-600">/</span>
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {activeBreadcrumb.label}
              </span>
            </nav>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {/* Command Palette Trigger */}
            {!isCustomerRole && (
              <button
                type="button"
                onClick={() => setCommandOpen(true)}
                aria-label="Open command palette"
                className="hidden sm:inline-flex items-center gap-2.5 rounded-lg border border-slate-200/90 bg-white px-3 py-1.5 text-xs text-slate-500 hover:border-slate-300 hover:text-slate-900 transition-colors dark:border-white/[0.1] dark:bg-[#0F1624] dark:text-slate-400 dark:hover:text-white cursor-pointer"
              >
                <Search className="h-3.5 w-3.5" />
                <span>{t(lang, 'quickJump')}</span>
                <kbd className="rounded border border-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 dark:border-white/[0.12]">
                  ⌘K
                </kbd>
              </button>
            )}

            {/* Branch Scope Selector */}
            {!isCustomerRole && (
              <select
                aria-label="Select branch scope"
                value={selectedBranchId}
                disabled={
                  user.branchId !== null &&
                  ['BRANCH_MANAGER', 'COLLECTION_AGENT', 'CUSTOMER_SERVICE'].includes(user.role)
                }
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="rounded-lg border border-slate-200/90 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-emerald-600 focus:outline-none dark:border-white/[0.1] dark:bg-[#0F1624] dark:text-slate-200"
              >
                <option value="all">{t(lang, 'allBranches')}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.branchCode} · {b.district}
                  </option>
                ))}
              </select>
            )}

            {/* Interactive User Profile Dropdown (Dark/Light Theme + Language + Logout) */}
            <div ref={profileRef} className="relative">
              <button
                type="button"
                onClick={() => setProfileOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={profileOpen}
                aria-label="Open user profile menu"
                className="flex items-center gap-2.5 rounded-lg border border-slate-200/80 bg-white px-2.5 py-1.5 text-left transition-colors hover:border-slate-300 dark:border-white/[0.1] dark:bg-[#0F1624] dark:hover:border-white/[0.18] cursor-pointer"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0B1220] text-[11px] font-semibold text-white dark:bg-emerald-500/20 dark:text-emerald-300">
                  {initials || 'KR'}
                </span>
                <div className="hidden sm:block leading-tight">
                  <p className="text-xs font-semibold text-slate-950 dark:text-white">
                    {user.fullName}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {ROLE_LABELS[user.role as UserRole] ?? user.role}
                  </p>
                </div>
                <ChevronDown
                  className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-150 ${
                    profileOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              <AnimatePresence>
                {profileOpen && (
                  <motion.div
                    role="menu"
                    initial={{ opacity: 0, y: 6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.98 }}
                    transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute right-0 mt-2 w-72 max-h-[75vh] overflow-y-auto rounded-xl border border-slate-200/90 bg-white p-2 shadow-2xl dark:border-white/[0.12] dark:bg-[#0F1624] z-50"
                  >
                    {/* Profile Identity Summary */}
                    <div className="border-b border-slate-100 px-3 py-2.5 dark:border-white/[0.08]">
                      <p className="text-xs font-semibold text-slate-950 dark:text-white">
                        {user.fullName}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        @{user.username} · {ROLE_LABELS[user.role as UserRole] ?? user.role}
                      </p>
                    </div>

                    {/* Appearance: Light / Dark Theme Toggle */}
                    <div className="px-3 py-3 border-b border-slate-100 dark:border-white/[0.08]">
                      <p className="mb-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        {t(lang, 'profileTheme')}
                      </p>
                      <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-white/[0.06]">
                        <button
                          type="button"
                          onClick={() => setDarkMode(false)}
                          className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                            !darkMode
                              ? 'bg-white text-slate-950 shadow-xs'
                              : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                          }`}
                        >
                          <Sun className="h-3.5 w-3.5" />
                          {t(lang, 'themeLight')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDarkMode(true)}
                          className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                            darkMode
                              ? 'bg-[#0B1220] text-white shadow-xs'
                              : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                          }`}
                        >
                          <Moon className="h-3.5 w-3.5" />
                          {t(lang, 'themeDark')}
                        </button>
                      </div>
                    </div>

                    {/* Language: English / Tamil Switch */}
                    <div className="px-3 py-3 border-b border-slate-100 dark:border-white/[0.08]">
                      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        <Globe className="h-3 w-3" />
                        {t(lang, 'profileLanguage')}
                      </p>
                      <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-white/[0.06]">
                        <button
                          type="button"
                          onClick={() => setLang('en')}
                          className={`rounded-md py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                            lang === 'en'
                              ? 'bg-white text-slate-950 shadow-xs dark:bg-[#0B1220] dark:text-white'
                              : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                          }`}
                        >
                          English
                        </button>
                        <button
                          type="button"
                          onClick={() => setLang('ta')}
                          className={`rounded-md py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                            lang === 'ta'
                              ? 'bg-white text-slate-950 shadow-xs dark:bg-[#0B1220] dark:text-white'
                              : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                          }`}
                        >
                          தமிழ் (Tamil)
                        </button>
                      </div>
                    </div>

                    {/* Settings & Logout Actions */}
                    <div className="pt-1.5 space-y-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveRoute('settings');
                          setProfileOpen(false);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/[0.06] cursor-pointer"
                      >
                        <Settings className="h-3.5 w-3.5 text-slate-400" />
                        {t(lang, 'navSettings')}
                      </button>
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40 cursor-pointer"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        {t(lang, 'signOut')}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        <main className="flex-1 p-5 lg:p-8 max-w-[1440px] w-full mx-auto">
          <motion.div
            key={`${activeRoute}-${lang}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          >
            {renderMainView()}
          </motion.div>
        </main>
      </div>

      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        items={commandItems}
        branches={branches}
        selectedBranchId={selectedBranchId}
        onSelectBranch={(id) => setSelectedBranchId(id)}
        darkMode={darkMode}
        onToggleTheme={() => setDarkMode((d) => !d)}
      />
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null);

  return (
    <QueryClientProvider client={queryClient}>
      <Toaster position="top-right" richColors />
      {user ? (
        <WorkspaceShell user={user} onSignOut={() => setUser(null)} />
      ) : (
        <LoginView onAuthenticated={(u) => setUser(u)} />
      )}
    </QueryClientProvider>
  );
}
