import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowUpRight, RefreshCw, Plus, CheckSquare, X, Printer, FilterX } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { formatINR, formatDateDDMMYYYY, rupeesToPaise } from '../domain/finance';
import { t, type AppLanguage } from '../lib/i18n';
import { Button, Card, PageHeader, StatusText } from './ui/Primitives';

interface DashboardData {
  metrics: {
    totalCustomers: number;
    activeChitGroups: number;
    activeMemberships: number;
    todayCollections: string;
    monthlyCollections: string;
    totalOutstanding: string;
    pendingApprovals: number;
    upcomingAuctionsCount: number;
  };
  collectionTrends: { month: string; amountRupees: number; amountFormatted: string }[];
  branchPerformance: {
    branchId: number;
    branchCode: string;
    branchName: string;
    customers: number;
    activeGroups: number;
    collectedRupees: number;
    collectedAmount: string;
    outstandingRupees: number;
    outstandingAmount: string;
  }[];
  recentTransactions: any[];
  upcomingDues: any[];
  upcomingAuctions: any[];
}

function AnimatedINR({ value }: { value: string | bigint }) {
  const targetPaise = typeof value === 'bigint' ? value : rupeesToPaise(value);
  const [displayPaise, setDisplayPaise] = useState<bigint>(targetPaise);

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      setDisplayPaise(targetPaise);
      return;
    }

    const start = displayPaise;
    const diff = targetPaise - start;
    if (diff === 0n) return;

    const duration = 320;
    const t0 = performance.now();
    let rafId = 0;

    const step = (now: number) => {
      const progress = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = start + BigInt(Math.round(Number(diff) * eased));
      setDisplayPaise(current);
      if (progress < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        setDisplayPaise(targetPaise);
      }
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [targetPaise]);

  return <>{formatINR(displayPaise)}</>;
}

export function DashboardView({
  selectedBranchId,
  onSelectBranch,
  onNavigate,
  lang = 'en',
}: {
  selectedBranchId: string;
  onSelectBranch?: (branchId: string) => void;
  onNavigate: (route: string) => void;
  lang?: AppLanguage;
}) {
  const [chartType, setChartType] = useState<'area' | 'bar'>('area');
  const [inspectedTx, setInspectedTx] = useState<any | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard', selectedBranchId],
    queryFn: () =>
      apiRequest<DashboardData>(
        selectedBranchId && selectedBranchId !== 'all'
          ? `/dashboard?branchId=${selectedBranchId}`
          : '/dashboard'
      ),
  });

  useEffect(() => {
    if (!inspectedTx) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInspectedTx(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inspectedTx]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title={t(lang, 'dashboardTitle')} subtitle="Synchronizing live PostgreSQL balances..." />
        <div className="h-72 animate-pulse rounded-xl border border-slate-200/80 bg-white dark:border-white/[0.08] dark:bg-[#0F1624]" />
        <div className="h-24 animate-pulse rounded-xl border border-slate-200/80 bg-white dark:border-white/[0.08] dark:bg-[#0F1624]" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <PageHeader title={t(lang, 'dashboardTitle')} />
        <Card className="p-6 text-sm text-red-600 dark:text-red-400">
          Unable to load executive telemetry. {(error as Error)?.message}
        </Card>
      </div>
    );
  }

  const m = data.metrics;
  const totalBranchCollected = data.branchPerformance.reduce(
    (acc, b) => acc + rupeesToPaise(b.collectedAmount),
    0n
  );
  const totalOutstandingPaise = rupeesToPaise(m.totalOutstanding);
  const totalPoolDemand = totalBranchCollected + totalOutstandingPaise;
  const recoveryPct =
    totalPoolDemand > 0n
      ? Number((totalBranchCollected * 1000n) / totalPoolDemand) / 10
      : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t(lang, 'dashboardTitle')}
        subtitle={t(lang, 'dashboardSubtitle')}
        actions={
          <>
            {selectedBranchId !== 'all' && onSelectBranch && (
              <Button variant="outline" size="sm" onClick={() => onSelectBranch('all')}>
                <FilterX className="h-3.5 w-3.5" />
                Clear Branch Filter
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5" />
              {t(lang, 'refresh')}
            </Button>
            <Button variant="primary" size="sm" onClick={() => onNavigate('collections')}>
              <Plus className="h-3.5 w-3.5" />
              {t(lang, 'collectPayment')}
            </Button>
          </>
        }
      />

      {/* BAND 1: Unified Asymmetric Treasury Hero Surface */}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12 lg:divide-x divide-slate-200/80 dark:divide-white/[0.08]">
          {/* Dominant Focal Treasury Column */}
          <div className="lg:col-span-5 p-6 sm:p-7 flex flex-col justify-between gap-6">
            <div>
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>{t(lang, 'monthlyCollections')}</span>
                <span className="font-mono text-emerald-700 dark:text-emerald-400">
                  {recoveryPct.toFixed(1)}% recovery
                </span>
              </div>
              <p className="mt-2 font-mono text-3xl sm:text-[38px] font-semibold tracking-tight tabular-money text-slate-950 dark:text-white leading-none">
                <AnimatedINR value={m.monthlyCollections} />
              </p>

              <div className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-200/75 pt-5 dark:border-white/[0.07]">
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t(lang, 'todaysSettlement')}
                  </p>
                  <p className="mt-1 font-mono text-lg font-semibold tabular-money text-slate-900 dark:text-slate-100">
                    <AnimatedINR value={m.todayCollections} />
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t(lang, 'cumulativeCollected')}
                  </p>
                  <p className="mt-1 font-mono text-lg font-semibold tabular-money text-emerald-700 dark:text-emerald-400">
                    <AnimatedINR value={totalBranchCollected} />
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <Button variant="primary" size="sm" onClick={() => onNavigate('collections')}>
                <Plus className="h-3.5 w-3.5" />
                Record Receipt
              </Button>
              <Button variant="outline" size="sm" onClick={() => onNavigate('approvals')}>
                <CheckSquare className="h-3.5 w-3.5" />
                Approvals ({m.pendingApprovals})
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onNavigate('accounting')}>
                Trial Balance
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Interactive Cashflow Velocity Chart with Animated Mode Indicator */}
          <div className="lg:col-span-7 p-6 sm:p-7 border-t lg:border-t-0 border-slate-200/80 dark:border-white/[0.08]">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <div>
                <h2 className="text-sm font-semibold text-slate-950 dark:text-white">
                  {t(lang, 'collectionVelocity')}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t(lang, 'collectionVelocitySub')}
                </p>
              </div>
              <div className="relative inline-flex items-center rounded-lg bg-slate-100 p-0.5 dark:bg-white/[0.06]">
                {(['area', 'bar'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setChartType(mode)}
                    className={`relative z-10 rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors cursor-pointer ${
                      chartType === mode
                        ? 'text-slate-950 dark:text-white'
                        : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                    }`}
                  >
                    {chartType === mode && (
                      <motion.span
                        layoutId="dashboardChartMode"
                        transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                        className="absolute inset-0 -z-10 rounded-md bg-white shadow-xs dark:bg-[#0B1220]"
                      />
                    )}
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                {chartType === 'area' ? (
                  <AreaChart data={data.collectionTrends} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
                    <defs>
                      <linearGradient id="kaveriAreaFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10B981" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="#10B981" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid-stroke)" vertical={false} />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 11, fill: 'var(--chart-axis-tick)' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: 'var(--chart-axis-tick)' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      formatter={(value: any) => [formatINR(Number(value).toFixed(2)), 'Posted Inflow']}
                      contentStyle={{
                        backgroundColor: '#0B1220',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: '10px',
                        color: '#F8FAFC',
                        fontSize: '12px',
                      }}
                      itemStyle={{ color: '#34D399' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="amountRupees"
                      stroke="var(--chart-area-stroke)"
                      strokeWidth={2.5}
                      fill="url(#kaveriAreaFill)"
                      activeDot={{ r: 5, strokeWidth: 0, fill: '#10B981' }}
                    />
                  </AreaChart>
                ) : (
                  <BarChart data={data.collectionTrends} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid-stroke)" vertical={false} />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 11, fill: 'var(--chart-axis-tick)' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: 'var(--chart-axis-tick)' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      formatter={(value: any) => [formatINR(Number(value).toFixed(2)), 'Posted Inflow']}
                      contentStyle={{
                        backgroundColor: '#0B1220',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: '10px',
                        color: '#F8FAFC',
                        fontSize: '12px',
                      }}
                      itemStyle={{ color: '#34D399' }}
                    />
                    <Bar dataKey="amountRupees" fill="var(--chart-bar-fill)" radius={[6, 6, 0, 0]} maxBarSize={42} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </Card>

      {/* BAND 2: Single Unified Hairline-Divided Operational Ribbon */}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200/80 dark:divide-white/[0.08]">
          {[
            {
              label: t(lang, 'totalOutstanding'),
              value: <AnimatedINR value={m.totalOutstanding} />,
              meta: 'Overdue + open installment dues',
              tone: 'text-red-700 dark:text-red-400',
              route: 'outstandings',
            },
            {
              label: t(lang, 'pendingApprovals'),
              value: String(m.pendingApprovals),
              meta: 'Maker-checker queue awaiting sign-off',
              tone: m.pendingApprovals > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-slate-950 dark:text-white',
              route: 'approvals',
            },
            {
              label: t(lang, 'activePortfolio'),
              value: `${m.activeChitGroups} Groups · ${m.activeMemberships} Tickets`,
              meta: `${m.totalCustomers} registered subscribers`,
              tone: 'text-slate-950 dark:text-white',
              route: 'groups',
            },
            {
              label: t(lang, 'upcomingAuctions'),
              value: String(m.upcomingAuctionsCount),
              meta: 'Open bidding & scheduled draws',
              tone: 'text-emerald-700 dark:text-emerald-400',
              route: 'auctions',
            },
          ].map((stat) => (
            <button
              key={stat.label}
              type="button"
              onClick={() => onNavigate(stat.route)}
              className="group p-5 text-left transition-colors hover:bg-slate-50/80 dark:hover:bg-white/[0.025] cursor-pointer"
            >
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>{stat.label}</span>
                <ArrowUpRight className="h-3.5 w-3.5 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-emerald-600 dark:group-hover:text-emerald-400" />
              </div>
              <p className={`mt-2 font-mono text-lg sm:text-xl font-semibold tracking-tight tabular-money ${stat.tone}`}>
                {stat.value}
              </p>
              <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{stat.meta}</p>
            </button>
          ))}
        </div>
      </Card>

      {/* BAND 3: Asymmetric 7 / 5 Operational Split */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Left 7 Cols: Clickable Recent Ledger Stream with Slide-Over Inspector */}
        <Card className="xl:col-span-7 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-950 dark:text-white">
                {t(lang, 'recentActivity')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t(lang, 'recentActivitySub')}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onNavigate('payments')}>
              All receipts
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200/80 text-slate-500 dark:border-white/[0.08] dark:text-slate-400">
                  <th className="py-2.5 font-medium">Receipt</th>
                  <th className="py-2.5 font-medium">Subscriber</th>
                  <th className="py-2.5 font-medium">Channel</th>
                  <th className="py-2.5 text-right font-medium">Amount</th>
                  <th className="py-2.5 pl-4 font-medium">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                {data.recentTransactions.map((tx) => (
                  <tr
                    key={tx.id}
                    onClick={() => setInspectedTx(tx)}
                    className="transition-colors hover:bg-slate-50/90 dark:hover:bg-white/[0.03] cursor-pointer"
                  >
                    <td className="py-3 pr-3">
                      <p className="font-mono font-medium text-slate-950 dark:text-slate-100">
                        {tx.receiptNumber}
                      </p>
                      <p className="text-[11px] text-slate-500">{formatDateDDMMYYYY(tx.paymentDate)}</p>
                    </td>
                    <td className="py-3 pr-3">
                      <p className="font-medium text-slate-800 dark:text-slate-200">{tx.customerName}</p>
                      <p className="text-[11px] text-slate-500">{tx.customerCode}</p>
                    </td>
                    <td className="py-3 pr-3 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                      {tx.paymentMode}
                    </td>
                    <td className="py-3 text-right font-mono font-semibold tabular-money text-slate-950 dark:text-white">
                      {formatINR(tx.amount)}
                    </td>
                    <td className="py-3 pl-4">
                      <StatusText status={tx.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Right 5 Cols: Interactive Branch Liquidity Filter + Priority Dues */}
        <div className="xl:col-span-5 space-y-6">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-950 dark:text-white">
                  {t(lang, 'branchLiquidity')}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t(lang, 'branchLiquiditySub')}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => onNavigate('branches')}>
                Branches
              </Button>
            </div>
            <div className="space-y-3">
              {data.branchPerformance.map((bp) => {
                const col = bp.collectedRupees || 0;
                const out = bp.outstandingRupees || 0;
                const pct = col + out > 0 ? Math.round((col / (col + out)) * 100) : 0;
                const isActiveBranch = selectedBranchId === String(bp.branchId);
                return (
                  <button
                    key={bp.branchId}
                    type="button"
                    onClick={() =>
                      onSelectBranch?.(isActiveBranch ? 'all' : String(bp.branchId))
                    }
                    className={`w-full rounded-lg p-2.5 text-left transition-colors cursor-pointer space-y-1.5 ${
                      isActiveBranch
                        ? 'bg-emerald-50/70 ring-1 ring-emerald-500/40 dark:bg-emerald-500/[0.08]'
                        : 'hover:bg-slate-50 dark:hover:bg-white/[0.03]'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <span className="font-medium text-slate-950 dark:text-white">
                          {bp.branchName}
                        </span>
                        <span className="ml-2 font-mono text-[11px] text-slate-400">
                          {bp.branchCode}
                        </span>
                      </div>
                      <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                        {pct}% collected
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.07]">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                        className="h-full rounded-full bg-emerald-600 dark:bg-emerald-400"
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono tabular-money">
                      <span className="text-emerald-700 dark:text-emerald-400">
                        In: {formatINR(bp.collectedAmount)}
                      </span>
                      <span className="text-red-700 dark:text-red-400">
                        Due: {formatINR(bp.outstandingAmount)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-950 dark:text-white">
                {t(lang, 'priorityDues')}
              </h2>
              <Button variant="ghost" size="sm" onClick={() => onNavigate('outstandings')}>
                Aging desk
              </Button>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
              {data.upcomingDues.slice(0, 5).map((due) => (
                <div key={due.id} className="flex items-center justify-between py-2.5 text-xs">
                  <div className="min-w-0 pr-3">
                    <p className="font-medium text-slate-950 dark:text-slate-100 truncate">
                      {due.customerName}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {due.groupName} · Inst #{due.installmentNumber} · {formatDateDDMMYYYY(due.dueDate)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono font-semibold tabular-money text-slate-950 dark:text-white">
                      {formatINR(due.outstandingAmount)}
                    </p>
                    <StatusText status={due.status} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Dynamic Slide-Over Transaction Inspector Drawer */}
      <AnimatePresence>
        {inspectedTx && (
          <div
            className="fixed inset-0 z-50 flex justify-end bg-[#04070E]/55 backdrop-blur-[1px]"
            role="dialog"
            aria-modal="true"
            aria-label="Transaction Inspector"
            onClick={(e) => {
              if (e.target === e.currentTarget) setInspectedTx(null);
            }}
          >
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
              className="flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-white/[0.1] dark:bg-[#0F1624]"
            >
              <div className="flex items-center justify-between border-b border-slate-200/80 px-6 py-4 dark:border-white/[0.08]">
                <div>
                  <p className="font-mono text-xs text-emerald-700 dark:text-emerald-400">
                    {inspectedTx.receiptNumber}
                  </p>
                  <h3 className="font-display text-lg font-semibold text-slate-950 dark:text-white">
                    Receipt Snapshot
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setInspectedTx(null)}
                  aria-label="Close inspector"
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-white/[0.08] dark:hover:text-white cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className="border-b border-slate-200/80 pb-5 dark:border-white/[0.08]">
                  <p className="text-xs text-slate-500">Settled Amount (INR)</p>
                  <p className="mt-1 font-mono text-3xl font-semibold tabular-money text-slate-950 dark:text-white">
                    {formatINR(inspectedTx.amount)}
                  </p>
                  <div className="mt-2">
                    <StatusText status={inspectedTx.status} />
                  </div>
                </div>

                <dl className="divide-y divide-slate-100 text-xs dark:divide-white/[0.06]">
                  {[
                    ['Subscriber', `${inspectedTx.customerName} (${inspectedTx.customerCode})`],
                    ['Settlement Date', formatDateDDMMYYYY(inspectedTx.paymentDate)],
                    ['Payment Mode', inspectedTx.paymentMode],
                    ['Reference / UTR', inspectedTx.referenceNumber || '—'],
                    ['Remarks', inspectedTx.remarks || 'Standard installment receipt'],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between py-3 gap-4">
                      <dt className="text-slate-500">{k}</dt>
                      <dd className="font-medium text-right text-slate-950 dark:text-slate-100">
                        {v}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="border-t border-slate-200/80 p-5 flex items-center gap-2.5 dark:border-white/[0.08]">
                <Button variant="outline" className="flex-1" onClick={() => window.print()}>
                  <Printer className="h-4 w-4" />
                  Print Slip
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={() => {
                    setInspectedTx(null);
                    onNavigate('payments');
                  }}
                >
                  Open Payment History
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
