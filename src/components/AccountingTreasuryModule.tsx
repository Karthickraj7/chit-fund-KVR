import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, RotateCcw, CheckCircle2, Scale } from 'lucide-react';
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

export function AccountingTreasuryModule({
  view,
  selectedBranchId,
  branches,
}: {
  view: 'accounting' | 'cash' | 'bank';
  selectedBranchId: string;
  branches: any[];
}) {
  const qc = useQueryClient();
  const branchQuery =
    selectedBranchId && selectedBranchId !== 'all' ? `?branchId=${selectedBranchId}` : '';

  const [subTab, setSubTab] = useState<'trial' | 'journals' | 'coa'>('trial');
  const [showJournalModal, setShowJournalModal] = useState(false);
  const [jvForm, setJvForm] = useState({
    branchId: String(branches[0]?.id ?? 1),
    entryDate: new Date().toISOString().slice(0, 10),
    description: '',
    debitAccountId: '2',
    creditAccountId: '1',
    amount: '10000.00',
    narration: 'Branch cash deposit to bank current account',
  });

  const { data: accData } = useQuery({
    queryKey: ['accounting'],
    queryFn: () => apiRequest<any>('/accounting/overview'),
    enabled: view === 'accounting',
  });

  const { data: treasuryData } = useQuery({
    queryKey: ['treasury', selectedBranchId],
    queryFn: () => apiRequest<any>(`/treasury${branchQuery}`),
    enabled: view === 'cash' || view === 'bank',
  });

  const postJournalMutation = useMutation({
    mutationFn: () =>
      apiRequest('/accounting/journals', {
        method: 'POST',
        body: {
          branchId: Number(jvForm.branchId),
          entryDate: jvForm.entryDate,
          description: jvForm.description,
          lines: [
            {
              accountId: Number(jvForm.debitAccountId),
              debit: jvForm.amount,
              credit: '0.00',
              narration: jvForm.narration,
            },
            {
              accountId: Number(jvForm.creditAccountId),
              debit: '0.00',
              credit: jvForm.amount,
              narration: jvForm.narration,
            },
          ],
        },
      }),
    onSuccess: () => {
      toast.success('Balanced double-entry journal posted immutably to General Ledger.');
      qc.invalidateQueries({ queryKey: ['accounting'] });
      setShowJournalModal(false);
      setJvForm({ ...jvForm, description: '' });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reverseJournalMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest(`/accounting/journals/${id}/reverse`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Immutable contra reversal entry posted to General Ledger.');
      qc.invalidateQueries({ queryKey: ['accounting'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const matchReconMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest(`/bank-reconciliation/${id}/match`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Bank statement line matched and payment marked RECONCILED.');
      qc.invalidateQueries({ queryKey: ['treasury'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (view === 'accounting') {
    const totals = accData?.totals ?? { grandDebit: '0.00', grandCredit: '0.00', isBalanced: true };
    const coa = accData?.chartOfAccounts ?? [];
    const trialBalance = accData?.trialBalance ?? [];
    const journals = accData?.journals ?? [];

    return (
      <div className="space-y-6">
        <PageHeader
          title="Double-Entry Accounting & General Ledger"
          subtitle="Immutable posted journals · Strict invariant Total Debits = Total Credits · Open Period FY 2026-27"
          actions={
            <Button size="sm" onClick={() => setShowJournalModal(true)}>
              <Plus className="h-3.5 w-3.5" />
              Post Journal Entry
            </Button>
          }
        />

        {/* Live Trial Balance Invariant Banner */}
        <Card className="p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Scale className="h-5 w-5 text-teal-700 dark:text-teal-400" />
            <div>
              <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Live Double-Entry Trial Balance Verification
              </p>
              <p className="text-xs text-slate-500">
                Total Debits{' '}
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {formatINR(totals.grandDebit)}
                </span>{' '}
                = Total Credits{' '}
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {formatINR(totals.grandCredit)}
                </span>
              </p>
            </div>
          </div>
          <StatusText status={totals.isBalanced ? 'VERIFIED' : 'FAILED'} />
        </Card>

        {/* Sub-Navigation */}
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 w-fit dark:bg-slate-800/80">
          {[
            ['trial', 'Trial Balance'],
            ['journals', 'Posted Journals'],
            ['coa', 'Chart of Accounts'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSubTab(key as any)}
              className={`rounded-md px-3.5 py-1.5 text-xs font-medium cursor-pointer ${
                subTab === key
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {subTab === 'trial' && (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
                    <th className="px-4 py-3 font-medium">Code</th>
                    <th className="px-4 py-3 font-medium">Account Name</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 text-right font-medium">Total Debits</th>
                    <th className="px-4 py-3 text-right font-medium">Total Credits</th>
                    <th className="px-4 py-3 text-right font-medium">Net Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {trialBalance.map((row: any) => (
                    <tr key={row.accountId}>
                      <td className="px-4 py-2.5 font-mono text-slate-700 dark:text-slate-300">
                        {row.accountCode}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                        {row.accountName}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{row.accountType}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-money">
                        {formatINR(row.totalDebit)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-money">
                        {formatINR(row.totalCredit)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-money text-slate-900 dark:text-slate-100">
                        {formatINR(row.netBalance)} {row.balanceSide}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold dark:border-slate-700 dark:bg-slate-900/60">
                    <td colSpan={3} className="px-4 py-3 text-slate-900 dark:text-slate-100">
                      Grand Total (Debits Must Equal Credits)
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-money">
                      {formatINR(totals.grandDebit)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-money">
                      {formatINR(totals.grandCredit)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-700 dark:text-emerald-400">
                      BALANCED
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        )}

        {subTab === 'journals' && (
          <div className="space-y-4">
            {journals.map((j: any) => (
              <Card key={j.id} className="p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-xs text-teal-700 dark:text-teal-400">
                      {j.entryNumber} · {formatDateDDMMYYYY(j.entryDate)} · Ref: {j.referenceType}
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {j.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusText status={j.status} />
                    {j.status === 'POSTED' && j.referenceType !== 'REVERSAL' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => reverseJournalMutation.mutate(j.id)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Post Contra Reversal
                      </Button>
                    )}
                  </div>
                </div>
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                      <th className="py-1.5 font-medium">Account</th>
                      <th className="py-1.5 font-medium">Narration</th>
                      <th className="py-1.5 text-right font-medium">Debit</th>
                      <th className="py-1.5 text-right font-medium">Credit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {(j.lines ?? []).map((l: any) => (
                      <tr key={l.id}>
                        <td className="py-1.5 font-mono text-slate-800 dark:text-slate-200">
                          {l.accountCode} — {l.accountName}
                        </td>
                        <td className="py-1.5 text-slate-500">{l.narration}</td>
                        <td className="py-1.5 text-right font-mono tabular-money">
                          {Number(l.debit) > 0 ? formatINR(l.debit) : '—'}
                        </td>
                        <td className="py-1.5 text-right font-mono tabular-money">
                          {Number(l.credit) > 0 ? formatINR(l.credit) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ))}
          </div>
        )}

        {subTab === 'coa' && (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 dark:border-slate-800 dark:bg-slate-900/40">
                    <th className="px-4 py-3 font-medium">Account Code</th>
                    <th className="px-4 py-3 font-medium">Account Name</th>
                    <th className="px-4 py-3 font-medium">Classification</th>
                    <th className="px-4 py-3 font-medium">System Protected</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {coa.map((a: any) => (
                    <tr key={a.id}>
                      <td className="px-4 py-2.5 font-mono font-medium">{a.accountCode}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                        {a.accountName}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                        {a.accountType}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">
                        {a.isSystem ? 'Core GL' : 'Custom'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Modal
          open={showJournalModal}
          onClose={() => setShowJournalModal(false)}
          title="Post Balanced Double-Entry Journal"
          subtitle="Posted journals are immutable. Corrections require a contra reversal entry."
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              postJournalMutation.mutate();
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <SelectField
                label="Branch"
                value={jvForm.branchId}
                onChange={(e) => setJvForm({ ...jvForm, branchId: e.target.value })}
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.branchCode} — {b.name}
                  </option>
                ))}
              </SelectField>
              <InputField
                label="Posting Date"
                type="date"
                value={jvForm.entryDate}
                onChange={(e) => setJvForm({ ...jvForm, entryDate: e.target.value })}
                required
              />
            </div>
            <InputField
              label="Journal Description"
              placeholder="e.g. Branch cash deposit to Indian Bank"
              value={jvForm.description}
              onChange={(e) => setJvForm({ ...jvForm, description: e.target.value })}
              required
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SelectField
                label="Debit Account (Dr)"
                value={jvForm.debitAccountId}
                onChange={(e) => setJvForm({ ...jvForm, debitAccountId: e.target.value })}
              >
                {coa.map((a: any) => (
                  <option key={a.id} value={a.id}>
                    {a.accountCode} — {a.accountName}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Credit Account (Cr)"
                value={jvForm.creditAccountId}
                onChange={(e) => setJvForm({ ...jvForm, creditAccountId: e.target.value })}
              >
                {coa.map((a: any) => (
                  <option key={a.id} value={a.id}>
                    {a.accountCode} — {a.accountName}
                  </option>
                ))}
              </SelectField>
            </div>
            <InputField
              label="Balanced Amount (INR)"
              value={jvForm.amount}
              onChange={(e) => setJvForm({ ...jvForm, amount: e.target.value })}
              required
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowJournalModal(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={postJournalMutation.isPending}>
                Post Balanced Journal
              </Button>
            </div>
          </form>
        </Modal>
      </div>
    );
  }

  if (view === 'cash') {
    const registers = treasuryData?.cashRegisters ?? [];
    return (
      <div className="space-y-6">
        <PageHeader
          title="Branch Cash Management & Registers"
          subtitle="Live branch opening balance, cash receipts, disbursements, closing balance, and variance monitoring"
        />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {registers.map((r: any) => (
            <Card key={r.id} className="p-5 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {r.branchName}
                  </p>
                  <p className="font-mono text-xs text-slate-500">
                    Register Date: {formatDateDDMMYYYY(r.registerDate)}
                  </p>
                </div>
                <StatusText status={r.status} />
              </div>
              <div className="space-y-1.5 border-y border-slate-100 py-3 text-xs dark:border-slate-800">
                <div className="flex justify-between">
                  <span className="text-slate-500">Opening Cash</span>
                  <span className="font-mono tabular-money">{formatINR(r.openingBalance)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Cash Collections (+)</span>
                  <span className="font-mono tabular-money text-emerald-700 dark:text-emerald-400">
                    {formatINR(r.cashCollections)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Disbursements / Transfers (-)</span>
                  <span className="font-mono tabular-money">{formatINR(r.cashDisbursements)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-slate-100 font-semibold dark:border-slate-800">
                  <span>Current Closing Balance</span>
                  <span className="font-mono tabular-money text-slate-900 dark:text-slate-100">
                    {formatINR(r.closingBalance)}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-slate-500">{r.notes}</p>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Bank Accounts & Statement Reconciliation
  const bankAccounts = treasuryData?.bankAccounts ?? [];
  const reconciliations = treasuryData?.reconciliations ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bank Accounts & Statement Reconciliation"
        subtitle="Match bank statement credits/debits against payment receipts and verify book vs. statement balances"
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {bankAccounts.map((b: any) => (
          <Card key={b.id} className="p-5 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {b.bankName}
                </p>
                <p className="font-mono text-xs text-slate-500">
                  {b.accountNumberMasked} · IFSC {b.ifscCode} · {b.branchName}
                </p>
              </div>
              <StatusText status="ACTIVE" />
            </div>
            <div className="grid grid-cols-2 gap-4 pt-2 text-xs">
              <div>
                <p className="text-slate-500">Ledger Book Balance</p>
                <p className="font-mono text-base font-semibold tabular-money text-slate-900 dark:text-slate-100">
                  {formatINR(b.bookBalance)}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Bank Statement Balance</p>
                <p className="font-mono text-base font-semibold tabular-money text-teal-700 dark:text-teal-400">
                  {formatINR(b.statementBalance)}
                </p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Bank Statement Matching Queue
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 dark:border-slate-800 dark:bg-slate-900/40">
                <th className="px-4 py-3 font-medium">Date & Bank</th>
                <th className="px-4 py-3 font-medium">Reference / Narration</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Reconcile</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {reconciliations.map((r: any) => (
                <tr key={r.id}>
                  <td className="px-4 py-3">
                    <p className="font-mono">{formatDateDDMMYYYY(r.statementDate)}</p>
                    <p className="text-[11px] text-slate-500">{r.bankName}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-mono font-medium text-slate-900 dark:text-slate-100">
                      {r.bankReference}
                    </p>
                    <p className="text-[11px] text-slate-500">{r.description}</p>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold tabular-money">
                    {formatINR(r.amount)} {r.direction}
                  </td>
                  <td className="px-4 py-3">
                    <StatusText status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.status !== 'MATCHED' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => matchReconMutation.mutate(r.id)}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Confirm Match
                      </Button>
                    )}
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
