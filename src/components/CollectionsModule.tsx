import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Printer, RotateCcw, CheckCircle2, PhoneCall } from 'lucide-react';
import { apiRequest, generateIdempotencyKey, downloadCSV } from '../lib/api';
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

export function CollectionsModule({
  view,
  selectedBranchId,
}: {
  view: 'collect' | 'payments' | 'outstandings';
  selectedBranchId: string;
}) {
  const qc = useQueryClient();
  const branchQuery =
    selectedBranchId && selectedBranchId !== 'all' ? `?branchId=${selectedBranchId}` : '';

  const [selectedMembershipId, setSelectedMembershipId] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState('UPI');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [remarks, setRemarks] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => generateIdempotencyKey());
  const [receiptModal, setReceiptModal] = useState<any | null>(null);
  const [thermalMode, setThermalMode] = useState(false);

  // Follow-up modal state
  const [followTarget, setFollowTarget] = useState<any | null>(null);
  const [followForm, setFollowForm] = useState({
    actionType: 'CALL',
    promiseToPayDate: '',
    notes: '',
  });

  const { data: memberships = [] } = useQuery({
    queryKey: ['memberships', selectedBranchId],
    queryFn: () => apiRequest<any[]>(`/memberships${branchQuery}`),
  });

  const { data: memberInstallments = [] } = useQuery({
    queryKey: ['installments-member', selectedMembershipId],
    queryFn: () => apiRequest<any[]>(`/installments?membershipId=${selectedMembershipId}`),
    enabled: !!selectedMembershipId && view === 'collect',
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['payments', selectedBranchId],
    queryFn: () => apiRequest<any[]>(`/payments${branchQuery}`),
  });

  const { data: outstandingsData } = useQuery({
    queryKey: ['outstandings', selectedBranchId],
    queryFn: () => apiRequest<{ overdueItems: any[]; followUps: any[] }>(`/outstandings${branchQuery}`),
    enabled: view === 'outstandings',
  });

  const collectMutation = useMutation({
    mutationFn: () =>
      apiRequest<any>('/payments', {
        method: 'POST',
        idempotencyKey,
        body: {
          membershipId: Number(selectedMembershipId),
          amount,
          paymentMode,
          referenceNumber,
          remarks,
        },
      }),
    onSuccess: (res) => {
      toast.success(
        `Receipt ${res.payment.receiptNumber} posted & balanced double-entry journal created.`
      );
      setReceiptModal(res);
      setIdempotencyKey(generateIdempotencyKey());
      setAmount('');
      setReferenceNumber('');
      setRemarks('');
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['installments'] });
      qc.invalidateQueries({ queryKey: ['installments-member'] });
      qc.invalidateQueries({ queryKey: ['memberships'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['accounting'] });
      qc.invalidateQueries({ queryKey: ['treasury'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reverseRequestMutation = useMutation({
    mutationFn: (paymentId: number) =>
      apiRequest(`/payments/${paymentId}/reverse-request`, {
        method: 'POST',
        body: { reason: 'Operator reversal request via Payment History' },
      }),
    onSuccess: () => {
      toast.success('Payment reversal submitted to Maker-Checker Approvals queue.');
      qc.invalidateQueries({ queryKey: ['approvals'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const followUpMutation = useMutation({
    mutationFn: () =>
      apiRequest('/follow-ups', {
        method: 'POST',
        body: {
          membershipId: followTarget.membershipId,
          customerId: followTarget.customerId,
          branchId: followTarget.branchId,
          overdueAmount: followTarget.outstandingAmount,
          daysPastDue: followTarget.daysPastDue,
          promiseToPayDate: followForm.promiseToPayDate,
          actionType: followForm.actionType,
          notes: followForm.notes,
        },
      }),
    onSuccess: () => {
      toast.success('Collection follow-up and promise-to-pay logged.');
      qc.invalidateQueries({ queryKey: ['outstandings'] });
      setFollowTarget(null);
      setFollowForm({ actionType: 'CALL', promiseToPayDate: '', notes: '' });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const selectedMembership = memberships.find((m) => String(m.id) === selectedMembershipId);

  if (view === 'collect') {
    const openSchedules = memberInstallments.filter((s) => Number(s.outstandingAmount) > 0);

    return (
      <div className="space-y-6">
        <PageHeader
          title="Payment Collection Desk"
          subtitle="Idempotent ACID collection · Automatically allocates oldest installments and posts balanced double-entry journals"
        />

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <Card className="xl:col-span-6 p-6">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                collectMutation.mutate();
              }}
              className="space-y-4"
            >
              <SelectField
                label="Select Subscriber Membership Ticket"
                value={selectedMembershipId}
                onChange={(e) => setSelectedMembershipId(e.target.value)}
                required
              >
                <option value="">Choose a member ticket...</option>
                {memberships.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.customerName} ({m.customerCode}) · {m.groupCode} Ticket #{m.ticketNumber} ·
                    Due {formatINR(m.totalOutstanding)}
                  </option>
                ))}
              </SelectField>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <InputField
                  label="Collection Amount (INR)"
                  placeholder="e.g. 8000.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
                <SelectField
                  label="Payment Mode"
                  value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value)}
                >
                  <option value="CASH">Cash (Branch Counter / Agent)</option>
                  <option value="UPI">UPI Transfer</option>
                  <option value="NEFT">NEFT</option>
                  <option value="RTGS">RTGS</option>
                  <option value="IMPS">IMPS</option>
                  <option value="BANK_TRANSFER">Direct Bank Transfer</option>
                  <option value="CHEQUE">Cheque (Under Verification)</option>
                  <option value="GATEWAY">Configured Payment Gateway</option>
                </SelectField>
              </div>

              <InputField
                label="UTR / Cheque / Bank Reference"
                placeholder="e.g. UTR432911004561"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
              />
              <InputField
                label="Remarks"
                placeholder="Installment collection note"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />

              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                Idempotency Key: <span className="font-mono">{idempotencyKey}</span>
              </div>

              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={collectMutation.isPending || !selectedMembershipId}
              >
                <CheckCircle2 className="h-4 w-4" />
                {collectMutation.isPending
                  ? 'Posting Atomic Transaction...'
                  : 'Collect Payment & Generate Receipt'}
              </Button>
            </form>
          </Card>

          <Card className="xl:col-span-6 p-6">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Outstanding Installment Breakdown
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {selectedMembership
                ? `${selectedMembership.customerName} · ${selectedMembership.groupCode} Ticket #${selectedMembership.ticketNumber}`
                : 'Select a subscriber ticket to inspect open dues before collecting.'}
            </p>

            {selectedMembership && (
              <div className="mt-4 space-y-3">
                {openSchedules.length === 0 ? (
                  <p className="text-xs text-emerald-700 dark:text-emerald-400">
                    All generated installments are paid. Additional payments will post to Subscriber
                    Advance Liability (Account 2030).
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {openSchedules.map((s) => (
                      <div key={s.id} className="flex items-center justify-between py-2.5 text-xs">
                        <div>
                          <p className="font-medium text-slate-900 dark:text-slate-100">
                            Installment #{s.installmentNumber} · Due {formatDateDDMMYYYY(s.dueDate)}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            Net Due {formatINR(s.amountDue)} · Paid {formatINR(s.amountPaid)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono font-semibold tabular-money text-red-700 dark:text-red-400">
                            {formatINR(s.outstandingAmount)}
                          </p>
                          <button
                            type="button"
                            onClick={() => setAmount(s.outstandingAmount)}
                            className="text-[11px] font-medium text-teal-700 hover:underline dark:text-teal-400 cursor-pointer"
                          >
                            Fill exact amount
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* Printable Receipt Modal (Standard A4 + 80mm Thermal Slip Toggle) */}
        <Modal
          open={!!receiptModal}
          onClose={() => setReceiptModal(null)}
          title="Official Payment Receipt Generated"
          subtitle="Immutable receipt linked to double-entry journal & audit log."
        >
          {receiptModal && (
            <div className="space-y-4">
              <div className="flex items-center justify-between no-print">
                <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                  <button
                    type="button"
                    onClick={() => setThermalMode(false)}
                    className={`rounded-md px-3 py-1 text-xs font-medium cursor-pointer ${
                      !thermalMode
                        ? 'bg-white text-slate-900 dark:bg-slate-900 dark:text-white'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Standard Receipt
                  </button>
                  <button
                    type="button"
                    onClick={() => setThermalMode(true)}
                    className={`rounded-md px-3 py-1 text-xs font-medium cursor-pointer ${
                      thermalMode
                        ? 'bg-white text-slate-900 dark:bg-slate-900 dark:text-white'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    80mm Thermal Slip
                  </button>
                </div>
                <Button size="sm" variant="outline" onClick={() => window.print()}>
                  <Printer className="h-3.5 w-3.5" />
                  Print Receipt
                </Button>
              </div>

              <div
                className={`mx-auto rounded-lg border border-slate-300 bg-white p-5 text-slate-900 ${
                  thermalMode ? 'max-w-[300px] font-mono text-[11px]' : 'text-xs'
                }`}
              >
                <div className="border-b border-dashed border-slate-300 pb-3 text-center">
                  <p className="font-display text-sm font-bold">KAVERI ENTERPRISE CHITS (DEMO)</p>
                  <p className="text-[11px] text-slate-500">Tamil Nadu · Official Collection Receipt</p>
                </div>
                <div className="mt-3 space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Receipt No:</span>
                    <span className="font-mono font-semibold">{receiptModal.payment.receiptNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Date (IST):</span>
                    <span className="font-mono">{formatDateDDMMYYYY(receiptModal.payment.paymentDate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Mode / Ref:</span>
                    <span className="font-mono">
                      {receiptModal.payment.paymentMode} · {receiptModal.payment.referenceNumber}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-semibold">
                    <span>Amount Paid:</span>
                    <span className="font-mono">{formatINR(receiptModal.payment.amount)}</span>
                  </div>
                </div>
                {receiptModal.allocations?.length > 0 && (
                  <div className="mt-3 border-t border-dashed border-slate-300 pt-2">
                    <p className="font-medium mb-1">Installment Allocation:</p>
                    {receiptModal.allocations.map((a: any) => (
                      <div key={a.installmentNumber} className="flex justify-between">
                        <span>Installment #{a.installmentNumber} ({a.status})</span>
                        <span className="font-mono">{formatINR(a.allocated)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </Modal>
      </div>
    );
  }

  if (view === 'payments') {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Payment History & Receipts"
          subtitle="Immutable posted payment ledger · Corrections use Maker-Checker approved reversals"
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCSV(
                  'kaveri-payments.csv',
                  ['Receipt', 'Date', 'Customer', 'Group', 'Mode', 'Reference', 'Amount', 'Status'],
                  payments.map((p) => [
                    p.receiptNumber,
                    formatDateDDMMYYYY(p.paymentDate),
                    p.customerName,
                    p.groupCode,
                    p.paymentMode,
                    p.referenceNumber,
                    p.amount,
                    p.status,
                  ])
                )
              }
            >
              Export CSV
            </Button>
          }
        />

        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
                  <th className="px-4 py-3 font-medium">Receipt No.</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Subscriber / Ticket</th>
                  <th className="px-4 py-3 font-medium">Mode & Ref</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {payments.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-mono font-medium text-slate-900 dark:text-slate-100">
                      {p.receiptNumber}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">
                      {formatDateDDMMYYYY(p.paymentDate)}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900 dark:text-slate-100">{p.customerName}</p>
                      <p className="text-[11px] text-slate-500">
                        {p.groupCode} · Ticket #{p.ticketNumber}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-slate-800 dark:text-slate-200">{p.paymentMode}</p>
                      <p className="font-mono text-[11px] text-slate-500">{p.referenceNumber}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold tabular-money text-slate-900 dark:text-slate-100">
                      {formatINR(p.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusText status={p.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {p.status !== 'REVERSED' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => reverseRequestMutation.mutate(p.id)}
                          disabled={reverseRequestMutation.isPending}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Request Reversal
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

  // Outstandings & Default Management
  const overdueItems = outstandingsData?.overdueItems ?? [];
  const followUps = outstandingsData?.followUps ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Outstandings, Aging & Default Recovery"
        subtitle="Arrears aging buckets (0–30 / 31–60 / 61–90 / 90+ days), field follow-ups, and promise-to-pay tracking"
      />

      <Card>
        <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Overdue & Unpaid Installments ({overdueItems.length})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
                <th className="px-4 py-3 font-medium">Subscriber</th>
                <th className="px-4 py-3 font-medium">Group / Inst</th>
                <th className="px-4 py-3 font-medium">Due Date</th>
                <th className="px-4 py-3 font-medium">Aging Bucket</th>
                <th className="px-4 py-3 text-right font-medium">Outstanding</th>
                <th className="px-4 py-3 text-right font-medium">Recovery Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {overdueItems.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      {item.customerName}
                    </p>
                    <p className="font-mono text-[11px] text-slate-500">{item.customerPhone}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-700 dark:text-slate-300">
                    {item.groupCode} · #{item.ticketNumber} (Inst #{item.installmentNumber})
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">
                    {formatDateDDMMYYYY(item.dueDate)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-red-700 dark:text-red-400">
                      {item.agingBucket} ({item.daysPastDue}d)
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold tabular-money text-red-700 dark:text-red-400">
                    {formatINR(item.outstandingAmount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="outline" size="sm" onClick={() => setFollowTarget(item)}>
                      <PhoneCall className="h-3.5 w-3.5" />
                      Log Follow-up
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
          Recent Follow-Up & Promise-to-Pay Log
        </h2>
        <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
          {followUps.map((f) => (
            <div key={f.id} className="flex flex-col sm:flex-row sm:items-center justify-between py-2.5 gap-2">
              <div>
                <p className="font-medium text-slate-900 dark:text-slate-100">
                  {f.customerName} · {f.actionType.replace('_', ' ')} · Arrears{' '}
                  <span className="font-mono">{formatINR(f.overdueAmount)}</span>
                </p>
                <p className="text-slate-500 mt-0.5">{f.notes}</p>
              </div>
              <div className="text-right shrink-0">
                {f.promiseToPayDate && (
                  <p className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                    PTP: {formatDateDDMMYYYY(f.promiseToPayDate)}
                  </p>
                )}
                <StatusText status={f.status} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Modal
        open={!!followTarget}
        onClose={() => setFollowTarget(null)}
        title="Log Collection Follow-Up"
        subtitle={
          followTarget
            ? `${followTarget.customerName} · Overdue ${formatINR(followTarget.outstandingAmount)}`
            : ''
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            followUpMutation.mutate();
          }}
          className="space-y-4"
        >
          <SelectField
            label="Action Type"
            value={followForm.actionType}
            onChange={(e) => setFollowForm({ ...followForm, actionType: e.target.value })}
          >
            <option value="CALL">Phone Follow-up</option>
            <option value="FIELD_VISIT">Field Agent Visit</option>
            <option value="DEFAULT_NOTICE">Issue Default Notice</option>
            <option value="SETTLEMENT_PROPOSAL">Settlement Proposal</option>
            <option value="DISPUTE">Log Subscriber Dispute</option>
          </SelectField>
          <InputField
            label="Promise-to-Pay Date (Optional)"
            type="date"
            value={followForm.promiseToPayDate}
            onChange={(e) => setFollowForm({ ...followForm, promiseToPayDate: e.target.value })}
          />
          <div>
            <label
              htmlFor="followup-notes"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Remarks / Recovery Notes
            </label>
            <textarea
              id="followup-notes"
              rows={3}
              required
              value={followForm.notes}
              onChange={(e) => setFollowForm({ ...followForm, notes: e.target.value })}
              className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setFollowTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={followUpMutation.isPending}>
              Save Follow-Up
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
