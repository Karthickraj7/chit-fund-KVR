import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, ShieldAlert } from 'lucide-react';
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

export function ChitOperationsModule({
  view,
  selectedBranchId,
  branches,
}: {
  view: 'schemes' | 'groups' | 'enrollments' | 'installments';
  selectedBranchId: string;
  branches: any[];
}) {
  const qc = useQueryClient();
  const [showSchemeModal, setShowSchemeModal] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showEnrollModal, setShowEnrollModal] = useState(false);

  const [schemeForm, setSchemeForm] = useState({
    schemeCode: '',
    name: '',
    description: '',
    chitValue: '200000.00',
    subscriberCount: '20',
    durationMonths: '20',
    maxDiscountPercent: '35.00',
    foremanCommissionMethod: 'PERCENTAGE',
    foremanCommissionValue: '5.00',
    gstRatePercent: '12.00',
    dueDayOfMonth: '10',
    auctionMethod: 'OPEN_AUCTION',
    dividendRoundingPolicy: 'FLOOR_RUPEE',
    statutoryReferenceNote: 'TBD_LEGAL — Verify with Tamil Nadu legal counsel',
  });

  const [groupForm, setGroupForm] = useState({
    branchId: String(branches[0]?.id ?? 1),
    schemeVersionId: '',
    groupCode: '',
    name: '',
    startDate: '2026-12-01',
    psoNumber: '',
    registrationRef: '',
    commencementCertRef: '',
    foremanFdBank: '',
    foremanFdAmount: '0.00',
    foremanFdMaturityDate: '',
  });

  const [enrollForm, setEnrollForm] = useState({
    groupId: '',
    customerId: '',
    ticketNumber: '6',
    nomineeName: '',
    agreementAccepted: true,
  });

  const branchQuery =
    selectedBranchId && selectedBranchId !== 'all' ? `?branchId=${selectedBranchId}` : '';

  const { data: schemes = [] } = useQuery({
    queryKey: ['schemes'],
    queryFn: () => apiRequest<any[]>('/schemes'),
  });

  const { data: groups = [] } = useQuery({
    queryKey: ['groups', selectedBranchId],
    queryFn: () => apiRequest<any[]>(`/groups${branchQuery}`),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', selectedBranchId],
    queryFn: () => apiRequest<any[]>(`/customers${branchQuery}`),
  });

  const { data: memberships = [] } = useQuery({
    queryKey: ['memberships', selectedBranchId],
    queryFn: () => apiRequest<any[]>(`/memberships${branchQuery}`),
  });

  const { data: installments = [] } = useQuery({
    queryKey: ['installments', selectedBranchId],
    queryFn: () => apiRequest<any[]>(`/installments${branchQuery}`),
    enabled: view === 'installments',
  });

  const createScheme = useMutation({
    mutationFn: () => apiRequest('/schemes', { method: 'POST', body: schemeForm }),
    onSuccess: () => {
      toast.success('Versioned chit scheme created (flagged PENDING_LEGAL_ACCOUNTING until verified).');
      qc.invalidateQueries({ queryKey: ['schemes'] });
      setShowSchemeModal(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createGroup = useMutation({
    mutationFn: () => apiRequest('/groups', { method: 'POST', body: groupForm }),
    onSuccess: () => {
      toast.success('Chit group created and submitted for Maker-Checker activation approval.');
      qc.invalidateQueries({ queryKey: ['groups'] });
      qc.invalidateQueries({ queryKey: ['approvals'] });
      setShowGroupModal(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const enrollMember = useMutation({
    mutationFn: () => apiRequest('/memberships', { method: 'POST', body: enrollForm }),
    onSuccess: () => {
      toast.success('Member enrolled and installment schedules auto-generated in PostgreSQL.');
      qc.invalidateQueries({ queryKey: ['memberships'] });
      qc.invalidateQueries({ queryKey: ['installments'] });
      qc.invalidateQueries({ queryKey: ['groups'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setShowEnrollModal(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (view === 'schemes') {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Chit Scheme Management"
          subtitle="Version-controlled financial terms · Unverified statutory parameters remain explicitly labeled"
          actions={
            <Button size="sm" onClick={() => setShowSchemeModal(true)}>
              <Plus className="h-3.5 w-3.5" />
              New Versioned Scheme
            </Button>
          }
        />

        <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200 flex items-start gap-2.5">
          <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
          <p>
            <strong>Legal & Accounting Verification Notice (TBD_LEGAL / TBD_ACCOUNTING):</strong>{' '}
            Maximum discount caps, foreman commission percentages, GST applicability, and penalty
            rules are stored as configurable versioned fields and must be ratified by qualified
            legal counsel and your Chartered Accountant prior to live production use.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {schemes.map((s) => {
            const v = s.versions?.[0];
            return (
              <Card key={s.id} className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-xs text-teal-700 dark:text-teal-400">
                      {s.schemeCode} · v{v?.versionNumber ?? 1}
                    </p>
                    <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {s.name}
                    </h3>
                  </div>
                  <StatusText status={s.status} />
                </div>

                {v && (
                  <div className="grid grid-cols-2 gap-3 border-y border-slate-100 py-3 text-xs dark:border-slate-800">
                    <div>
                      <p className="text-slate-500">Chit Value</p>
                      <p className="font-mono font-semibold tabular-money text-slate-900 dark:text-slate-100">
                        {formatINR(v.chitValue)}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">Monthly Installment</p>
                      <p className="font-mono font-semibold tabular-money text-slate-900 dark:text-slate-100">
                        {formatINR(v.monthlyInstallment)}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">Tenure / Tickets</p>
                      <p className="font-mono text-slate-800 dark:text-slate-200">
                        {v.durationMonths} mos · {v.subscriberCount} members
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">Max Discount / Comm.</p>
                      <p className="font-mono text-slate-800 dark:text-slate-200">
                        {v.maxDiscountPercent}% · {v.foremanCommissionValue}
                        {v.foremanCommissionMethod === 'PERCENTAGE' ? '%' : ' INR'}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">Auction / Rounding</p>
                      <p className="text-slate-800 dark:text-slate-200">
                        {v.auctionMethod.replace('_', ' ')} · {v.dividendRoundingPolicy}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">GST Config</p>
                      <p className="font-mono text-slate-800 dark:text-slate-200">
                        {v.gstRatePercent}% (Configurable)
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>Due Day: {v?.dueDayOfMonth ?? 10}th</span>
                  <StatusText status={v?.formulaApprovalStatus ?? 'PENDING_LEGAL_ACCOUNTING'} />
                </div>
              </Card>
            );
          })}
        </div>

        <Modal
          open={showSchemeModal}
          onClose={() => setShowSchemeModal(false)}
          title="Create Versioned Chit Scheme"
          subtitle="All financial parameters are versioned and reproducible in calculation snapshots."
          wide
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createScheme.mutate();
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <InputField
                label="Scheme Code"
                placeholder="SCH-2L-20M"
                value={schemeForm.schemeCode}
                onChange={(e) => setSchemeForm({ ...schemeForm, schemeCode: e.target.value })}
                required
              />
              <InputField
                label="Scheme Name"
                placeholder="Kaveri Growth ₹2 Lakh (20M)"
                value={schemeForm.name}
                onChange={(e) => setSchemeForm({ ...schemeForm, name: e.target.value })}
                required
              />
              <InputField
                label="Total Chit Value (INR)"
                value={schemeForm.chitValue}
                onChange={(e) => setSchemeForm({ ...schemeForm, chitValue: e.target.value })}
                required
              />
              <InputField
                label="Subscriber Count / Duration (Months)"
                type="number"
                value={schemeForm.durationMonths}
                onChange={(e) =>
                  setSchemeForm({
                    ...schemeForm,
                    durationMonths: e.target.value,
                    subscriberCount: e.target.value,
                  })
                }
                required
              />
              <InputField
                label="Max Discount Cap (%)"
                value={schemeForm.maxDiscountPercent}
                onChange={(e) => setSchemeForm({ ...schemeForm, maxDiscountPercent: e.target.value })}
              />
              <InputField
                label="Foreman Commission (% or Fixed)"
                value={schemeForm.foremanCommissionValue}
                onChange={(e) =>
                  setSchemeForm({ ...schemeForm, foremanCommissionValue: e.target.value })
                }
              />
              <SelectField
                label="Auction Method"
                value={schemeForm.auctionMethod}
                onChange={(e) => setSchemeForm({ ...schemeForm, auctionMethod: e.target.value })}
              >
                <option value="OPEN_AUCTION">Open Auction</option>
                <option value="SEALED_BID">Sealed Bid</option>
                <option value="REVERSE_AUCTION">Reverse Auction</option>
              </SelectField>
              <SelectField
                label="Dividend Rounding Policy"
                value={schemeForm.dividendRoundingPolicy}
                onChange={(e) =>
                  setSchemeForm({ ...schemeForm, dividendRoundingPolicy: e.target.value })
                }
              >
                <option value="FLOOR_RUPEE">Floor to ₹1 (Residue to Reserve)</option>
                <option value="NEAREST_RUPEE">Nearest ₹1 (Safe Pool Cap)</option>
                <option value="EXACT_PAISE">Exact Paise</option>
              </SelectField>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <Button type="button" variant="outline" onClick={() => setShowSchemeModal(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createScheme.isPending}>
                {createScheme.isPending ? 'Saving...' : 'Save Scheme Version'}
              </Button>
            </div>
          </form>
        </Modal>
      </div>
    );
  }

  if (view === 'groups') {
    const allVersions = schemes.flatMap((s) =>
      (s.versions ?? []).map((v: any) => ({ ...v, schemeName: s.name, schemeCode: s.schemeCode }))
    );

    return (
      <div className="space-y-6">
        <PageHeader
          title="Chit Group Management"
          subtitle="Lifecycle tracking with Tamil Nadu PSO, Registration, Section 9 Commencement Cert & Foreman Security FD"
          actions={
            <Button
              size="sm"
              onClick={() => {
                if (!groupForm.schemeVersionId && allVersions[0]) {
                  setGroupForm((f) => ({ ...f, schemeVersionId: String(allVersions[0].id) }));
                }
                setShowGroupModal(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              Create Chit Group
            </Button>
          }
        />

        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
                  <th className="px-4 py-3 font-medium">Group Code & Series</th>
                  <th className="px-4 py-3 font-medium">Branch</th>
                  <th className="px-4 py-3 text-right font-medium">Chit Value</th>
                  <th className="px-4 py-3 font-medium">Statutory Refs (PSO / CC / FD)</th>
                  <th className="px-4 py-3 font-medium">Progress</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {groups.map((g) => (
                  <tr key={g.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <p className="font-mono font-medium text-slate-900 dark:text-slate-100">
                        {g.groupCode}
                      </p>
                      <p className="text-[11px] text-slate-500">{g.name}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{g.branchName}</td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-mono font-semibold tabular-money text-slate-900 dark:text-slate-100">
                        {formatINR(g.chitValue)}
                      </p>
                      <p className="text-[11px] font-mono text-slate-500">
                        {formatINR(g.monthlyInstallment)}/mo
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-mono text-[11px] text-slate-700 dark:text-slate-300">
                        PSO: {g.psoNumber || 'Pending'} · CC: {g.commencementCertRef || 'Pending'}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Foreman FD: {formatINR(g.foremanFdAmount)} ({g.foremanFdBank || 'Not logged'})
                      </p>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700 dark:text-slate-300">
                      Month {g.currentInstallmentMonth}/{g.durationMonths} · {g.enrolledCount}/
                      {g.subscriberCapacity} tickets
                    </td>
                    <td className="px-4 py-3">
                      <StatusText status={g.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Modal
          open={showGroupModal}
          onClose={() => setShowGroupModal(false)}
          title="Create New Chit Group"
          subtitle="Group enters PENDING_APPROVAL until ratified through Maker-Checker workflow."
          wide
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createGroup.mutate();
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SelectField
                label="Branch"
                value={groupForm.branchId}
                onChange={(e) => setGroupForm({ ...groupForm, branchId: e.target.value })}
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.branchCode} — {b.name}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Approved Scheme Version"
                value={groupForm.schemeVersionId}
                onChange={(e) => setGroupForm({ ...groupForm, schemeVersionId: e.target.value })}
              >
                {allVersions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.schemeCode} v{v.versionNumber} — {formatINR(v.chitValue)} ({v.durationMonths}M)
                  </option>
                ))}
              </SelectField>
              <InputField
                label="Group Reference Code"
                placeholder="KVR-CHN-5L-2603"
                value={groupForm.groupCode}
                onChange={(e) => setGroupForm({ ...groupForm, groupCode: e.target.value })}
                required
              />
              <InputField
                label="Group Name"
                placeholder="Chennai 5L Series C (2026)"
                value={groupForm.name}
                onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                required
              />
              <InputField
                label="Start Date"
                type="date"
                value={groupForm.startDate}
                onChange={(e) => setGroupForm({ ...groupForm, startDate: e.target.value })}
                required
              />
              <InputField
                label="Prior Sanction Order (PSO) Ref"
                placeholder="PSO/CHN/2026/..."
                value={groupForm.psoNumber}
                onChange={(e) => setGroupForm({ ...groupForm, psoNumber: e.target.value })}
              />
              <InputField
                label="Commencement Certificate Ref (Sec. 9)"
                placeholder="CC/CHN/2026/..."
                value={groupForm.commencementCertRef}
                onChange={(e) => setGroupForm({ ...groupForm, commencementCertRef: e.target.value })}
              />
              <InputField
                label="Foreman Security FD Amount (INR)"
                value={groupForm.foremanFdAmount}
                onChange={(e) => setGroupForm({ ...groupForm, foremanFdAmount: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <Button type="button" variant="outline" onClick={() => setShowGroupModal(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createGroup.isPending}>
                {createGroup.isPending ? 'Creating...' : 'Submit Group for Approval'}
              </Button>
            </div>
          </form>
        </Modal>
      </div>
    );
  }

  if (view === 'enrollments') {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Member Enrollment & Tickets"
          subtitle="Assigns unique ticket numbers, enforces anti-duplicate constraints, and auto-generates installment schedules"
          actions={
            <Button
              size="sm"
              onClick={() => {
                setEnrollForm((f) => ({
                  ...f,
                  groupId: f.groupId || String(groups[0]?.id ?? ''),
                  customerId: f.customerId || String(customers[0]?.id ?? ''),
                }));
                setShowEnrollModal(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              Enroll Subscriber
            </Button>
          }
        />

        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
                  <th className="px-4 py-3 font-medium">Ticket</th>
                  <th className="px-4 py-3 font-medium">Chit Group</th>
                  <th className="px-4 py-3 font-medium">Subscriber</th>
                  <th className="px-4 py-3 font-medium">Enrolled On</th>
                  <th className="px-4 py-3 text-right font-medium">Outstanding</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {memberships.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-mono font-semibold text-slate-900 dark:text-slate-100">
                      Ticket #{m.ticketNumber}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-mono text-slate-800 dark:text-slate-200">{m.groupCode}</p>
                      <p className="text-[11px] text-slate-500">{m.groupName}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900 dark:text-slate-100">
                        {m.customerName}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {m.customerCode} · Nominee: {m.nomineeName || '—'}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">
                      {formatDateDDMMYYYY(m.enrollmentDate)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-medium tabular-money text-slate-900 dark:text-slate-100">
                      {formatINR(m.totalOutstanding)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusText status={m.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Modal
          open={showEnrollModal}
          onClose={() => setShowEnrollModal(false)}
          title="Enroll Member into Chit Group"
          subtitle="Automatically checks for duplicate active tickets and generates the installment schedule."
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              enrollMember.mutate();
            }}
            className="space-y-4"
          >
            <SelectField
              label="Chit Group"
              value={enrollForm.groupId}
              onChange={(e) => setEnrollForm({ ...enrollForm, groupId: e.target.value })}
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.groupCode} — {g.name} ({formatINR(g.chitValue)})
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Existing Customer"
              value={enrollForm.customerId}
              onChange={(e) => setEnrollForm({ ...enrollForm, customerId: e.target.value })}
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.customerCode} — {c.fullName} (KYC: {c.kycStatus})
                </option>
              ))}
            </SelectField>
            <div className="grid grid-cols-2 gap-4">
              <InputField
                label="Ticket Number"
                type="number"
                min={1}
                value={enrollForm.ticketNumber}
                onChange={(e) => setEnrollForm({ ...enrollForm, ticketNumber: e.target.value })}
                required
              />
              <InputField
                label="Nominee Name"
                value={enrollForm.nomineeName}
                onChange={(e) => setEnrollForm({ ...enrollForm, nomineeName: e.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={enrollForm.agreementAccepted}
                onChange={(e) =>
                  setEnrollForm({ ...enrollForm, agreementAccepted: e.target.checked })
                }
              />
              Subscriber has executed the Chit Agreement & acknowledged terms
            </label>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <Button type="button" variant="outline" onClick={() => setShowEnrollModal(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={enrollMember.isPending}>
                {enrollMember.isPending ? 'Enrolling...' : 'Confirm Enrollment & Generate Schedule'}
              </Button>
            </div>
          </form>
        </Modal>
      </div>
    );
  }

  // Installments Schedule View
  return (
    <div className="space-y-6">
      <PageHeader
        title="Installment Schedules"
        subtitle="Member-wise base installments, auction dividend adjustments, net amount due, and paid balances"
      />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
                <th className="px-4 py-3 font-medium">Group / Ticket</th>
                <th className="px-4 py-3 font-medium">Subscriber</th>
                <th className="px-4 py-3 font-medium">Inst # / Due Date</th>
                <th className="px-4 py-3 text-right font-medium">Base</th>
                <th className="px-4 py-3 text-right font-medium">Dividend</th>
                <th className="px-4 py-3 text-right font-medium">Net Due</th>
                <th className="px-4 py-3 text-right font-medium">Paid</th>
                <th className="px-4 py-3 text-right font-medium">Outstanding</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {installments.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3 font-mono text-slate-900 dark:text-slate-100">
                    {s.groupCode} · #{s.ticketNumber}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                    {s.customerName}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">
                    #{s.installmentNumber} · {formatDateDDMMYYYY(s.dueDate)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-money">
                    {formatINR(s.baseInstallment)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-money text-emerald-700 dark:text-emerald-400">
                    -{formatINR(s.dividendAdjustment)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-medium tabular-money">
                    {formatINR(s.amountDue)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-money text-teal-700 dark:text-teal-400">
                    {formatINR(s.amountPaid)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold tabular-money text-red-700 dark:text-red-400">
                    {formatINR(s.outstandingAmount)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusText status={s.status} />
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
