import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Gavel, Calculator, CheckCircle2, ShieldAlert, Plus } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { formatINR, formatDateDDMMYYYY } from '../domain/finance';
import {
  Button,
  Card,
  PageHeader,
  StatusText,
  InputField,
  SelectField,
  Modal,
} from './ui/Primitives';

export function AuctionsPayoutsModule({
  view,
  selectedBranchId,
  branches,
}: {
  view: 'auctions' | 'dividends' | 'payouts' | 'guarantors';
  selectedBranchId: string;
  branches: any[];
}) {
  const qc = useQueryClient();
  const branchQuery =
    selectedBranchId && selectedBranchId !== 'all' ? `?branchId=${selectedBranchId}` : '';

  const [bidAuction, setBidAuction] = useState<any | null>(null);
  const [bidForm, setBidForm] = useState({
    membershipId: '',
    bidAmountDiscount: '',
    isProxyBid: false,
  });

  const [calcAuction, setCalcAuction] = useState<any | null>(null);
  const [calcForm, setCalcForm] = useState({
    winningMembershipId: '',
    winningBidDiscount: '',
    minutesText: '',
  });

  const [payoutRefMap, setPayoutRefMap] = useState<Record<number, string>>({});
  const [showGuarantorModal, setShowGuarantorModal] = useState(false);
  const [guarantorForm, setGuarantorForm] = useState({
    customerId: '',
    branchId: String(branches[0]?.id ?? 1),
    fullName: '',
    phone: '',
    panNumber: '',
    relationship: 'Brother',
    address: '',
  });

  const { data: auctions = [] } = useQuery({
    queryKey: ['auctions', selectedBranchId],
    queryFn: () => apiRequest<any[]>(`/auctions${branchQuery}`),
    enabled: view === 'auctions',
  });

  const { data: memberships = [] } = useQuery({
    queryKey: ['memberships', selectedBranchId],
    queryFn: () => apiRequest<any[]>(`/memberships${branchQuery}`),
  });

  const { data: dividends = [] } = useQuery({
    queryKey: ['dividends'],
    queryFn: () => apiRequest<any[]>('/dividends'),
    enabled: view === 'dividends',
  });

  const { data: payouts = [] } = useQuery({
    queryKey: ['payouts', selectedBranchId],
    queryFn: () => apiRequest<any[]>(`/prize-payouts${branchQuery}`),
    enabled: view === 'payouts',
  });

  const { data: gsData } = useQuery({
    queryKey: ['guarantors-securities', selectedBranchId],
    queryFn: () =>
      apiRequest<{ guarantors: any[]; securities: any[]; mandates: any[] }>(
        `/guarantors-securities${branchQuery}`
      ),
    enabled: view === 'guarantors',
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', selectedBranchId],
    queryFn: () => apiRequest<any[]>(`/customers${branchQuery}`),
    enabled: view === 'guarantors',
  });

  const placeBidMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/auctions/${bidAuction.id}/bids`, { method: 'POST', body: bidForm }),
    onSuccess: () => {
      toast.success('Immutable bid recorded with revision tracking and audit log.');
      qc.invalidateQueries({ queryKey: ['auctions'] });
      setBidAuction(null);
      setBidForm({ membershipId: '', bidAmountDiscount: '', isProxyBid: false });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const calculateMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/auctions/${calcAuction.id}/calculate`, { method: 'POST', body: calcForm }),
    onSuccess: () => {
      toast.success(
        'Reproducible auction calculation snapshot saved and submitted to Maker-Checker Approvals.'
      );
      qc.invalidateQueries({ queryKey: ['auctions'] });
      qc.invalidateQueries({ queryKey: ['approvals'] });
      setCalcAuction(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const payoutStatusMutation = useMutation({
    mutationFn: ({ id, status, bankReference }: { id: number; status: string; bankReference?: string }) =>
      apiRequest(`/prize-payouts/${id}/status`, {
        method: 'PATCH',
        body: { status, bankReference },
      }),
    onSuccess: () => {
      toast.success('Prize payout status updated and verified in ledger.');
      qc.invalidateQueries({ queryKey: ['payouts'] });
      qc.invalidateQueries({ queryKey: ['accounting'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createGuarantorMutation = useMutation({
    mutationFn: () => apiRequest('/guarantors', { method: 'POST', body: guarantorForm }),
    onSuccess: () => {
      toast.success('Guarantor registered with consent record.');
      qc.invalidateQueries({ queryKey: ['guarantors-securities'] });
      setShowGuarantorModal(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (view === 'auctions') {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Auction Management & Calculation Engine"
          subtitle="Immutable bid history (including authorized proxy bids), reproducible snapshots, and Maker-Checker approval"
        />

        <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200 flex items-start gap-2.5">
          <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
          <p>
            <strong>Configurable Calculation Governance:</strong> Winner selection is explicitly
            confirmed by the Auction Manager and ratified by a Checker — the system never assumes
            highest or lowest bid automatically wins. All calculation snapshots preserve exact
            scheme version parameters (Pending Legal &amp; Accounting Ratification until signed off).
          </p>
        </div>

        <div className="space-y-4">
          {auctions.map((a) => {
            const groupEligibleMembers = memberships.filter(
              (m) => m.groupId === a.groupId && !m.isPrized && m.status === 'ACTIVE'
            );
            return (
              <Card key={a.id} className="p-6 space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-mono text-xs text-teal-700 dark:text-teal-400">
                      {a.groupCode} · Installment Month #{a.installmentNumber} ·{' '}
                      {a.auctionMethod.replace('_', ' ')}
                    </p>
                    <h2 className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                      {a.groupName} — Chit Value {formatINR(a.chitValue)}
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Scheduled: {a.scheduledAt} · Venue: {a.venue} · Max Cap: {a.maxDiscountPercent}%
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusText status={a.status} />
                    {['OPEN', 'SCHEDULED'].includes(a.status) && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setBidAuction(a);
                            setBidForm({
                              membershipId: String(groupEligibleMembers[0]?.id ?? ''),
                              bidAmountDiscount: '',
                              isProxyBid: false,
                            });
                          }}
                        >
                          <Gavel className="h-3.5 w-3.5" />
                          Record Bid
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => {
                            const topBid = a.bids?.[0];
                            setCalcAuction(a);
                            setCalcForm({
                              winningMembershipId: String(
                                topBid?.membershipId ?? groupEligibleMembers[0]?.id ?? ''
                              ),
                              winningBidDiscount: topBid?.bidAmountDiscount ?? '100000.00',
                              minutesText: a.minutesText || '',
                            });
                          }}
                        >
                          <Calculator className="h-3.5 w-3.5" />
                          Calculate & Submit Result
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Calculation Snapshot Strip if Calculated */}
                {Number(a.winningBidDiscount) > 0 && (
                  <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-4 text-xs sm:grid-cols-6 dark:border-slate-800 dark:bg-slate-900/40">
                    <div>
                      <p className="text-slate-500">Winner</p>
                      <p className="mt-0.5 font-medium text-slate-900 dark:text-slate-100">
                        {a.winnerName} (#{a.winnerTicket})
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">Winning Discount</p>
                      <p className="mt-0.5 font-mono font-semibold tabular-money">
                        {formatINR(a.winningBidDiscount)}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">Foreman Comm.</p>
                      <p className="mt-0.5 font-mono tabular-money">
                        {formatINR(a.foremanCommissionAmount)}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">GST (Config)</p>
                      <p className="mt-0.5 font-mono tabular-money">{formatINR(a.gstAmount)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Net Prize</p>
                      <p className="mt-0.5 font-mono font-semibold tabular-money text-teal-700 dark:text-teal-400">
                        {formatINR(a.netPrizeAmount)}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">Dividend / Member</p>
                      <p className="mt-0.5 font-mono font-semibold tabular-money text-emerald-700 dark:text-emerald-400">
                        {formatINR(a.perMemberDividend)}
                      </p>
                    </div>
                  </div>
                )}

                {/* Immutable Bid History Table */}
                <div>
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Immutable Bid History ({a.bids?.length ?? 0} bids)
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                          <th className="py-2 font-medium">Bidder & Ticket</th>
                          <th className="py-2 font-medium">Rev #</th>
                          <th className="py-2 font-medium">Channel</th>
                          <th className="py-2 text-right font-medium">Bid Discount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                        {(a.bids ?? []).map((b: any) => (
                          <tr key={b.id}>
                            <td className="py-2 font-medium text-slate-800 dark:text-slate-200">
                              {b.customerName} · Ticket #{b.ticketNumber}
                            </td>
                            <td className="py-2 font-mono text-slate-500">v{b.bidRevision}</td>
                            <td className="py-2 text-slate-600 dark:text-slate-300">
                              {b.isProxyBid ? 'Authorized Proxy Bid' : 'In-Hall Live Bid'}
                            </td>
                            <td className="py-2 text-right font-mono font-semibold tabular-money text-slate-900 dark:text-slate-100">
                              {formatINR(b.bidAmountDiscount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Record Bid Modal */}
        <Modal
          open={!!bidAuction}
          onClose={() => setBidAuction(null)}
          title="Record Immutable Auction Bid"
          subtitle={bidAuction ? `${bidAuction.groupCode} — Month #${bidAuction.installmentNumber}` : ''}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              placeBidMutation.mutate();
            }}
            className="space-y-4"
          >
            <SelectField
              label="Eligible Non-Prized Bidder"
              value={bidForm.membershipId}
              onChange={(e) => setBidForm({ ...bidForm, membershipId: e.target.value })}
              required
            >
              {memberships
                .filter((m) => m.groupId === bidAuction?.groupId && !m.isPrized)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    Ticket #{m.ticketNumber} — {m.customerName}
                  </option>
                ))}
            </SelectField>
            <InputField
              label="Bid Discount Amount (INR)"
              placeholder="e.g. 110000.00"
              value={bidForm.bidAmountDiscount}
              onChange={(e) => setBidForm({ ...bidForm, bidAmountDiscount: e.target.value })}
              required
            />
            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={bidForm.isProxyBid}
                onChange={(e) => setBidForm({ ...bidForm, isProxyBid: e.target.checked })}
              />
              Mark as Pre-Authorized Proxy Bid
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setBidAuction(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={placeBidMutation.isPending}>
                Append Immutable Bid
              </Button>
            </div>
          </form>
        </Modal>

        {/* Calculate Auction Snapshot Modal */}
        <Modal
          open={!!calcAuction}
          onClose={() => setCalcAuction(null)}
          title="Compute Reproducible Auction Calculation Snapshot"
          subtitle="Runs paise-exact engine (Net Prize + Foreman Comm + Distributed Dividends + Rounding Residue = Chit Value) and submits to Maker-Checker."
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              calculateMutation.mutate();
            }}
            className="space-y-4"
          >
            <SelectField
              label="Confirmed Winning Ticket"
              value={calcForm.winningMembershipId}
              onChange={(e) => setCalcForm({ ...calcForm, winningMembershipId: e.target.value })}
              required
            >
              {memberships
                .filter((m) => m.groupId === calcAuction?.groupId && !m.isPrized)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    Ticket #{m.ticketNumber} — {m.customerName}
                  </option>
                ))}
            </SelectField>
            <InputField
              label="Confirmed Winning Discount (INR)"
              value={calcForm.winningBidDiscount}
              onChange={(e) => setCalcForm({ ...calcForm, winningBidDiscount: e.target.value })}
              required
            />
            <div>
              <label
                htmlFor="auction-minutes"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Auction Minutes & Tie/Dispute Notes
              </label>
              <textarea
                id="auction-minutes"
                rows={3}
                value={calcForm.minutesText}
                onChange={(e) => setCalcForm({ ...calcForm, minutesText: e.target.value })}
                className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCalcAuction(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={calculateMutation.isPending}>
                Compute Snapshot & Request Approval
              </Button>
            </div>
          </form>
        </Modal>
      </div>
    );
  }

  if (view === 'dividends') {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Dividend Management & Snapshots"
          subtitle="Member-wise dividend allocations linked to reproducible auction calculation references"
        />
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
                  <th className="px-4 py-3 font-medium">Calculation Ref</th>
                  <th className="px-4 py-3 font-medium">Group & Ticket</th>
                  <th className="px-4 py-3 font-medium">Subscriber</th>
                  <th className="px-4 py-3 font-medium">Applied to Inst #</th>
                  <th className="px-4 py-3 text-right font-medium">Dividend Allocated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {dividends.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-3 font-mono text-slate-700 dark:text-slate-300">
                      {d.calculationRef}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-900 dark:text-slate-100">
                      {d.groupCode} · #{d.ticketNumber}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                      {d.customerName}
                    </td>
                    <td className="px-4 py-3 font-mono">Installment #{d.appliedToInstallmentNumber}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold tabular-money text-emerald-700 dark:text-emerald-400">
                      {formatINR(d.dividendAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    );
  }

  if (view === 'payouts') {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Prize Money Disbursement & Verification"
          subtitle="Four-gate compliance check (KYC · Guarantor · Security · Dues) and independent Approved → Payable → Initiated → Completed → Reconciled lifecycle"
        />

        <div className="space-y-4">
          {payouts.map((p) => (
            <Card key={p.id} className="p-6 space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-mono text-xs text-teal-700 dark:text-teal-400">
                    {p.groupCode} · Ticket #{p.ticketNumber} · {p.customerCode}
                  </p>
                  <h3 className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                    {p.customerName} — Net Payable {formatINR(p.netPayableAmount)}
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Gross Prize {formatINR(p.grossPrizeAmount)} · Overdue Deduction{' '}
                    {formatINR(p.overdueDeduction)} · Mode: {p.payoutMode}
                    {p.bankReference ? ` · Ref: ${p.bankReference}` : ''}
                  </p>
                </div>
                <StatusText status={p.status} />
              </div>

              {/* 4 Verification Gates */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs border-y border-slate-100 py-3 dark:border-slate-800">
                {[
                  ['KYC Verified', p.kycVerified],
                  ['Guarantor Verified', p.guarantorVerified],
                  ['Security Verified', p.securityVerified],
                  ['Zero Overdue Dues', p.duesVerified],
                ].map(([label, ok]) => (
                  <div key={String(label)} className="flex items-center gap-1.5">
                    <CheckCircle2
                      className={`h-4 w-4 ${ok ? 'text-emerald-600' : 'text-slate-300 dark:text-slate-700'}`}
                    />
                    <span className={ok ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400'}>
                      {String(label)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Lifecycle Controls */}
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-60">
                  <InputField
                    label="RTGS / NEFT UTR Reference"
                    placeholder="UTR-RTGS-2026..."
                    value={payoutRefMap[p.id] ?? p.bankReference ?? ''}
                    onChange={(e) => setPayoutRefMap({ ...payoutRefMap, [p.id]: e.target.value })}
                  />
                </div>
                {p.status === 'APPROVED' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => payoutStatusMutation.mutate({ id: p.id, status: 'PAYABLE' })}
                  >
                    Mark Payable
                  </Button>
                )}
                {['APPROVED', 'PAYABLE'].includes(p.status) && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() =>
                      payoutStatusMutation.mutate({
                        id: p.id,
                        status: 'COMPLETED',
                        bankReference: payoutRefMap[p.id] || `RTGS-${Date.now().toString().slice(-6)}`,
                      })
                    }
                  >
                    Execute Payout & Post Ledger
                  </Button>
                )}
                {p.status === 'COMPLETED' && (
                  <Button
                    size="sm"
                    variant="accent"
                    onClick={() => payoutStatusMutation.mutate({ id: p.id, status: 'RECONCILED' })}
                  >
                    Mark Bank Reconciled
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Guarantors, Securities & eNACH / UPI AutoPay Mandates
  return (
    <div className="space-y-6">
      <PageHeader
        title="Guarantors, Security Vault & AutoPay Mandates"
        subtitle="Legally permitted collateral tracking, guarantor consent records, and eNACH / UPI AutoPay mandates"
        actions={
          <Button
            size="sm"
            onClick={() => {
              setGuarantorForm((f) => ({ ...f, customerId: f.customerId || String(customers[0]?.id ?? '') }));
              setShowGuarantorModal(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Register Guarantor
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
            Registered Guarantors
          </h2>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {(gsData?.guarantors ?? []).map((g) => (
              <div key={g.id} className="flex items-start justify-between py-3 gap-3">
                <div>
                  <p className="font-medium text-slate-900 dark:text-slate-100">
                    {g.fullName} ({g.relationship} of {g.customerName})
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {g.phone} · PAN {g.panNumber || '—'} · Consent:{' '}
                    {g.consentRecorded ? 'Recorded' : 'Pending'}
                  </p>
                </div>
                <StatusText status={g.verificationStatus} />
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
            Permitted Security & Collateral Vault
          </h2>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {(gsData?.securities ?? []).map((s) => (
              <div key={s.id} className="flex items-start justify-between py-3 gap-3">
                <div>
                  <p className="font-medium text-slate-900 dark:text-slate-100">
                    {s.securityType.replace(/_/g, ' ')} · {s.documentNumber}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {s.customerName} (Ticket #{s.ticketNumber}) · Valued{' '}
                    <span className="font-mono font-medium">{formatINR(s.valuationAmount)}</span> ·
                    Exp {formatDateDDMMYYYY(s.expiryDate)}
                  </p>
                </div>
                <StatusText status={s.status} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* eNACH & UPI AutoPay Mandates */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
          eNACH & UPI AutoPay Mandate Registry (Fintech Extension)
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                <th className="py-2 font-medium">Subscriber & Ticket</th>
                <th className="py-2 font-medium">Mandate Type</th>
                <th className="py-2 font-medium">UMRN Reference</th>
                <th className="py-2 font-medium">Bank / VPA</th>
                <th className="py-2 text-right font-medium">Max Debit Cap</th>
                <th className="py-2 pl-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {(gsData?.mandates ?? []).map((md) => (
                <tr key={md.id}>
                  <td className="py-2.5 font-medium text-slate-900 dark:text-slate-100">
                    {md.customerName} · #{md.ticketNumber}
                  </td>
                  <td className="py-2.5 font-mono text-slate-700 dark:text-slate-300">
                    {md.mandateType}
                  </td>
                  <td className="py-2.5 font-mono text-slate-600 dark:text-slate-400">{md.umrnRef}</td>
                  <td className="py-2.5 text-slate-700 dark:text-slate-300">{md.bankOrVpa}</td>
                  <td className="py-2.5 text-right font-mono tabular-money">
                    {formatINR(md.maxAmount)}
                  </td>
                  <td className="py-2.5 pl-4">
                    <StatusText status={md.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={showGuarantorModal}
        onClose={() => setShowGuarantorModal(false)}
        title="Register Guarantor"
        subtitle="Record guarantor identity, relationship, and signed consent."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createGuarantorMutation.mutate();
          }}
          className="space-y-4"
        >
          <SelectField
            label="Subscriber"
            value={guarantorForm.customerId}
            onChange={(e) => setGuarantorForm({ ...guarantorForm, customerId: e.target.value })}
          >
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.customerCode} — {c.fullName}
              </option>
            ))}
          </SelectField>
          <div className="grid grid-cols-2 gap-4">
            <InputField
              label="Guarantor Full Name"
              value={guarantorForm.fullName}
              onChange={(e) => setGuarantorForm({ ...guarantorForm, fullName: e.target.value })}
              required
            />
            <InputField
              label="Phone Number"
              value={guarantorForm.phone}
              onChange={(e) => setGuarantorForm({ ...guarantorForm, phone: e.target.value })}
              required
            />
            <InputField
              label="PAN"
              value={guarantorForm.panNumber}
              onChange={(e) => setGuarantorForm({ ...guarantorForm, panNumber: e.target.value })}
            />
            <InputField
              label="Relationship"
              value={guarantorForm.relationship}
              onChange={(e) => setGuarantorForm({ ...guarantorForm, relationship: e.target.value })}
              required
            />
          </div>
          <InputField
            label="Residential Address"
            value={guarantorForm.address}
            onChange={(e) => setGuarantorForm({ ...guarantorForm, address: e.target.value })}
            required
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setShowGuarantorModal(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createGuarantorMutation.isPending}>
              Save Guarantor
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
