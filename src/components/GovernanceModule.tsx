import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CheckCircle2,
  XCircle,
  Printer,
  Plus,
  Send,
  ShieldCheck,
  Lock,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { apiRequest, downloadCSV, type SessionUser } from '../lib/api';
import { formatINR, formatDateDDMMYYYY, ROLE_LABELS, type UserRole } from '../domain/finance';
import {
  Button,
  Card,
  PageHeader,
  StatusText,
  InputField,
  SelectField,
  Modal,
} from './ui/Primitives';

export function GovernanceModule({
  view,
  selectedBranchId,
  branches,
  company,
  user,
}: {
  view:
    | 'approvals'
    | 'documents'
    | 'notifications'
    | 'reports'
    | 'audit'
    | 'branches'
    | 'employees'
    | 'settings'
    | 'portal';
  selectedBranchId: string;
  branches: any[];
  company: any;
  user: SessionUser;
}) {
  const qc = useQueryClient();
  const branchQuery =
    selectedBranchId && selectedBranchId !== 'all' ? `?branchId=${selectedBranchId}` : '';

  const [decisionNotesMap, setDecisionNotesMap] = useState<Record<number, string>>({});
  const [previewDoc, setPreviewDoc] = useState<any | null>(null);
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [branchForm, setBranchForm] = useState({
    branchCode: '',
    name: '',
    district: 'Salem',
    address: '',
    managerName: '',
    phone: '',
    openingCashBalance: '50000.00',
  });
  const [showEmpModal, setShowEmpModal] = useState(false);
  const [empForm, setEmpForm] = useState({
    branchId: String(branches[0]?.id ?? 1),
    employeeCode: '',
    fullName: '',
    jobRole: 'COLLECTION_AGENT',
    reportingManager: 'Branch Manager',
    phone: '',
    email: '',
    assignedZone: '',
  });
  const [notifForm, setNotifForm] = useState({
    channel: 'IN_APP',
    recipient: '+91 98402 33101',
    title: 'Installment Due Reminder',
    message: 'Reminder for upcoming chit installment due on 10th of the month.',
  });
  const [pwdForm, setPwdForm] = useState({ currentPassword: '', newPassword: '' });

  const { data: approvals = [] } = useQuery({
    queryKey: ['approvals', selectedBranchId],
    queryFn: () => apiRequest<any[]>(`/approvals${branchQuery}`),
    enabled: view === 'approvals',
  });

  const { data: docs = [] } = useQuery({
    queryKey: ['documents', selectedBranchId],
    queryFn: () => apiRequest<any[]>(`/documents${branchQuery}`),
    enabled: view === 'documents',
  });

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiRequest<any[]>('/notifications'),
    enabled: view === 'notifications',
  });

  const { data: reportSummary } = useQuery({
    queryKey: ['reports', selectedBranchId],
    queryFn: () => apiRequest<any>(`/reports/summary${branchQuery}`),
    enabled: view === 'reports',
  });

  const { data: auditLogs = [] } = useQuery({
    queryKey: ['audit-logs'],
    queryFn: () => apiRequest<any[]>('/audit-logs'),
    enabled: view === 'audit',
  });

  const { data: employees = [] } = useQuery({
    queryKey: ['employees', selectedBranchId],
    queryFn: () => apiRequest<any[]>(`/employees${branchQuery}`),
    enabled: view === 'employees',
  });

  const { data: portalData } = useQuery({
    queryKey: ['portal-me'],
    queryFn: () => apiRequest<any>('/portal/me'),
    enabled: view === 'portal',
  });

  const decideMutation = useMutation({
    mutationFn: ({ id, decision }: { id: number; decision: 'APPROVED' | 'REJECTED' }) =>
      apiRequest(`/approvals/${id}/decide`, {
        method: 'POST',
        body: { decision, decisionNotes: decisionNotesMap[id] ?? '' },
      }),
    onSuccess: (_res, vars) => {
      toast.success(`Request ${vars.decision.toLowerCase()} and domain state updated atomically.`);
      qc.invalidateQueries({ queryKey: ['approvals'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['groups'] });
      qc.invalidateQueries({ queryKey: ['payouts'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createBranchMutation = useMutation({
    mutationFn: () => apiRequest('/branches', { method: 'POST', body: branchForm }),
    onSuccess: () => {
      toast.success('New Tamil Nadu branch created.');
      qc.invalidateQueries({ queryKey: ['company'] });
      setShowBranchModal(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createEmpMutation = useMutation({
    mutationFn: () => apiRequest('/employees', { method: 'POST', body: empForm }),
    onSuccess: () => {
      toast.success('Employee registered and assigned to branch.');
      qc.invalidateQueries({ queryKey: ['employees'] });
      setShowEmpModal(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const sendNotifMutation = useMutation({
    mutationFn: () => apiRequest('/notifications', { method: 'POST', body: notifForm }),
    onSuccess: (res: any) => {
      toast.success(
        res.status === 'ADAPTER_UNCONFIGURED'
          ? 'Queued in outbox (external SMS/WhatsApp/Email provider adapter not configured yet).'
          : 'In-app notification delivered.'
      );
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const changePwdMutation = useMutation({
    mutationFn: () => apiRequest('/auth/change-password', { method: 'POST', body: pwdForm }),
    onSuccess: () => {
      toast.success('Password rotated securely using salted scrypt hashing.');
      setPwdForm({ currentPassword: '', newPassword: '' });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // 1. Maker-Checker Approvals Queue
  if (view === 'approvals') {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Maker-Checker Approval Queue"
          subtitle="Strict segregation of duties enforced on backend — initiators cannot approve their own sensitive requests"
        />
        <div className="space-y-4">
          {approvals.map((a) => (
            <Card key={a.id} className="p-5 space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-mono text-xs text-teal-700 dark:text-teal-400">
                    {a.requestType.replace(/_/g, ' ')} · {a.branchName} · Requested by{' '}
                    {a.requesterName} ({a.requesterUsername})
                  </p>
                  <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {a.title}
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{a.summary}</p>
                </div>
                <div className="text-right shrink-0">
                  {Number(a.amount) > 0 && (
                    <p className="font-mono text-sm font-semibold tabular-money text-slate-900 dark:text-slate-100">
                      {formatINR(a.amount)}
                    </p>
                  )}
                  <StatusText status={a.status} />
                </div>
              </div>

              {a.status === 'PENDING' && (
                <div className="flex flex-col gap-3 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
                  {a.isSelfRequest ? (
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                      <Lock className="h-3.5 w-3.5" />
                      Maker-Checker Lock: You initiated this request; another authorized Checker
                      must decide.
                    </p>
                  ) : (
                    <>
                      <input
                        type="text"
                        placeholder="Checker review notes (optional)..."
                        value={decisionNotesMap[a.id] ?? ''}
                        onChange={(e) =>
                          setDecisionNotesMap({ ...decisionNotesMap, [a.id]: e.target.value })
                        }
                        className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => decideMutation.mutate({ id: a.id, decision: 'REJECTED' })}
                          disabled={decideMutation.isPending}
                        >
                          <XCircle className="h-3.5 w-3.5 text-red-600" />
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => decideMutation.mutate({ id: a.id, decision: 'APPROVED' })}
                          disabled={decideMutation.isPending}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Approve
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // 2. Document Management Center
  if (view === 'documents') {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Document Management Center"
          subtitle="Numbered, versioned, transaction-linked acknowledgements, agreements, receipts, and auction minutes"
        />
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 dark:border-slate-800 dark:bg-slate-900/40">
                  <th className="px-4 py-3 font-medium">Document No.</th>
                  <th className="px-4 py-3 font-medium">Type & Version</th>
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Generated</th>
                  <th className="px-4 py-3 text-right font-medium">Preview / Print</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-3 font-mono font-medium text-slate-900 dark:text-slate-100">
                      {d.documentNumber}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {d.documentType.replace(/_/g, ' ')} · v{d.version}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                      {d.title}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-500">
                      {formatDateDDMMYYYY(d.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="outline" size="sm" onClick={() => setPreviewDoc(d)}>
                        <Printer className="h-3.5 w-3.5" />
                        Open Snapshot
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Modal
          open={!!previewDoc}
          onClose={() => setPreviewDoc(null)}
          title={previewDoc?.title ?? 'Document Snapshot'}
          subtitle={`${previewDoc?.documentNumber ?? ''} · Version ${previewDoc?.version ?? 1}`}
        >
          {previewDoc && (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                <pre className="whitespace-pre-wrap">
                  {JSON.stringify(JSON.parse(previewDoc.contentSnapshotJson || '{}'), null, 2)}
                </pre>
              </div>
              <div className="flex justify-end gap-2 no-print">
                <Button variant="outline" size="sm" onClick={() => window.print()}>
                  <Printer className="h-3.5 w-3.5" />
                  Print Document
                </Button>
              </div>
            </div>
          )}
        </Modal>
      </div>
    );
  }

  // 3. Notifications Outbox
  if (view === 'notifications') {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Notification Architecture & Outbox"
          subtitle="In-App notifications active · External SMS, WhatsApp Business & Email adapters remain explicitly UNCONFIGURED until live credentials are added"
        />

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <Card className="xl:col-span-5 p-5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-4">
              Queue Notification / Reminder
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendNotifMutation.mutate();
              }}
              className="space-y-3"
            >
              <SelectField
                label="Delivery Channel"
                value={notifForm.channel}
                onChange={(e) => setNotifForm({ ...notifForm, channel: e.target.value })}
              >
                <option value="IN_APP">In-App Notification (Active)</option>
                <option value="SMS">SMS Gateway (Adapter Unconfigured)</option>
                <option value="WHATSAPP">WhatsApp Business (Adapter Unconfigured)</option>
                <option value="EMAIL">SMTP Email (Adapter Unconfigured)</option>
              </SelectField>
              <InputField
                label="Recipient"
                value={notifForm.recipient}
                onChange={(e) => setNotifForm({ ...notifForm, recipient: e.target.value })}
                required
              />
              <InputField
                label="Subject / Title"
                value={notifForm.title}
                onChange={(e) => setNotifForm({ ...notifForm, title: e.target.value })}
                required
              />
              <InputField
                label="Message"
                value={notifForm.message}
                onChange={(e) => setNotifForm({ ...notifForm, message: e.target.value })}
                required
              />
              <Button type="submit" size="sm" className="w-full" disabled={sendNotifMutation.isPending}>
                <Send className="h-3.5 w-3.5" />
                Dispatch to Outbox
              </Button>
            </form>
          </Card>

          <Card className="xl:col-span-7 p-5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
              Outbox Delivery Log
            </h2>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {notifications.map((n) => (
                <div key={n.id} className="flex items-start justify-between py-3 gap-3">
                  <div>
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      [{n.channel}] {n.title}
                    </p>
                    <p className="text-slate-500 mt-0.5">{n.message}</p>
                    <p className="font-mono text-[11px] text-slate-400 mt-0.5">
                      To: {n.recipient} · {formatDateDDMMYYYY(n.createdAt)}
                    </p>
                  </div>
                  <StatusText status={n.status} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    );
  }

  // 4. Reports & Analytics Hub
  if (view === 'reports') {
    const modeData = reportSummary?.collectionsByMode ?? [];
    return (
      <div className="space-y-6">
        <PageHeader
          title="Financial Reports & Analytics"
          subtitle="Printable and CSV-exportable operational, collection, overdue, commission, and statutory summaries"
          actions={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadCSV(
                    'kaveri-collection-modes-report.csv',
                    ['Payment Mode', 'Total Collected (INR)'],
                    modeData.map((m: any) => [m.mode, m.amount])
                  )
                }
              >
                Export CSV
              </Button>
              <Button variant="primary" size="sm" onClick={() => window.print()}>
                <Printer className="h-3.5 w-3.5" />
                Print Report
              </Button>
            </>
          }
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Total Posted Collections', reportSummary?.totalCollected ?? '0.00'],
            ['Total Overdue Arrears', reportSummary?.totalOverdue ?? '0.00'],
            ['Approved Foreman Commission', reportSummary?.totalCommission ?? '0.00'],
            ['Total Prize Obligations', reportSummary?.totalPrizes ?? '0.00'],
          ].map(([label, amt]) => (
            <Card key={label} className="p-5">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-2 font-mono text-xl font-semibold tabular-money text-slate-900 dark:text-slate-100">
                {formatINR(amt)}
              </p>
            </Card>
          ))}
        </div>

        <Card className="p-6">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-4">
            Collections Breakdown by Payment Mode (INR)
          </h2>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={modeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="mode" tick={{ fontSize: 12, fill: '#64748B' }} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} />
                <Tooltip formatter={(v: any) => [formatINR(Number(v).toFixed(2)), 'Collected']} />
                <Bar dataKey="amountRupees" fill="#0D9488" radius={[6, 6, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    );
  }

  // 5. Immutable Audit Trail
  if (view === 'audit') {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Immutable Financial Audit Trail"
          subtitle="Append-only record of every authentication, customer registration, payment, auction, approval, and ledger mutation"
        />
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 dark:border-slate-800 dark:bg-slate-900/40">
                  <th className="px-4 py-3 font-medium">Timestamp (IST)</th>
                  <th className="px-4 py-3 font-medium">Actor & Role</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Entity</th>
                  <th className="px-4 py-3 font-medium">Recorded Snapshot</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      {formatDateDDMMYYYY(log.createdAt)}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-mono font-medium text-slate-900 dark:text-slate-100">
                        {log.actorUsername}
                      </p>
                      <p className="text-[11px] text-slate-500">{log.actorRole}</p>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-teal-700 dark:text-teal-400">
                      {log.action}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-700 dark:text-slate-300">
                      {log.entityType} #{log.entityId}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500 max-w-xs truncate">
                      {log.afterJson}
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

  // 6. Branches Management
  if (view === 'branches') {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Branch Network Management"
          subtitle="Multi-branch operational isolation across Tamil Nadu districts"
          actions={
            <Button size="sm" onClick={() => setShowBranchModal(true)}>
              <Plus className="h-3.5 w-3.5" />
              Add Branch
            </Button>
          }
        />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {branches.map((b) => (
            <Card key={b.id} className="p-5 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-mono text-xs text-teal-700 dark:text-teal-400">
                    {b.branchCode} · {b.district}
                  </p>
                  <h3 className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {b.name}
                  </h3>
                </div>
                <StatusText status={b.isActive ? 'ACTIVE' : 'SUSPENDED'} />
              </div>
              <p className="text-xs text-slate-500">{b.address}</p>
              <div className="border-t border-slate-100 pt-2 text-xs flex justify-between dark:border-slate-800">
                <span className="text-slate-500">Manager: {b.managerName}</span>
                <span className="font-mono">{b.phone}</span>
              </div>
            </Card>
          ))}
        </div>

        <Modal
          open={showBranchModal}
          onClose={() => setShowBranchModal(false)}
          title="Add New Branch"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createBranchMutation.mutate();
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <InputField
                label="Branch Code"
                placeholder="TN-SLM-04"
                value={branchForm.branchCode}
                onChange={(e) => setBranchForm({ ...branchForm, branchCode: e.target.value })}
                required
              />
              <InputField
                label="District"
                value={branchForm.district}
                onChange={(e) => setBranchForm({ ...branchForm, district: e.target.value })}
                required
              />
            </div>
            <InputField
              label="Branch Name"
              placeholder="Salem — Fairlands"
              value={branchForm.name}
              onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })}
              required
            />
            <InputField
              label="Branch Address"
              value={branchForm.address}
              onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })}
              required
            />
            <div className="grid grid-cols-2 gap-4">
              <InputField
                label="Branch Manager"
                value={branchForm.managerName}
                onChange={(e) => setBranchForm({ ...branchForm, managerName: e.target.value })}
                required
              />
              <InputField
                label="Phone"
                value={branchForm.phone}
                onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })}
                required
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowBranchModal(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createBranchMutation.isPending}>
                Create Branch
              </Button>
            </div>
          </form>
        </Modal>
      </div>
    );
  }

  // 7. Employees Management
  if (view === 'employees') {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Employee & Collection Agent Directory"
          subtitle="Role assignments, branch territories, and reporting hierarchy"
          actions={
            <Button size="sm" onClick={() => setShowEmpModal(true)}>
              <Plus className="h-3.5 w-3.5" />
              Register Employee
            </Button>
          }
        />
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 dark:border-slate-800 dark:bg-slate-900/40">
                  <th className="px-4 py-3 font-medium">Employee ID</th>
                  <th className="px-4 py-3 font-medium">Name & Contact</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Zone & Manager</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {employees.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-3 font-mono font-medium">{e.employeeCode}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900 dark:text-slate-100">{e.fullName}</p>
                      <p className="text-[11px] text-slate-500">
                        {e.phone} · {e.email}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                      {ROLE_LABELS[e.jobRole as UserRole] ?? e.jobRole}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                      {e.assignedZone} · Reports to {e.reportingManager}
                    </td>
                    <td className="px-4 py-3">
                      <StatusText status={e.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Modal open={showEmpModal} onClose={() => setShowEmpModal(false)} title="Register Employee">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createEmpMutation.mutate();
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <InputField
                label="Employee Code"
                placeholder="EMP-0010"
                value={empForm.employeeCode}
                onChange={(e) => setEmpForm({ ...empForm, employeeCode: e.target.value })}
                required
              />
              <SelectField
                label="Branch"
                value={empForm.branchId}
                onChange={(e) => setEmpForm({ ...empForm, branchId: e.target.value })}
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.branchCode} — {b.name}
                  </option>
                ))}
              </SelectField>
              <InputField
                label="Full Name"
                value={empForm.fullName}
                onChange={(e) => setEmpForm({ ...empForm, fullName: e.target.value })}
                required
              />
              <SelectField
                label="Role"
                value={empForm.jobRole}
                onChange={(e) => setEmpForm({ ...empForm, jobRole: e.target.value })}
              >
                <option value="COLLECTION_AGENT">Collection Agent</option>
                <option value="BRANCH_MANAGER">Branch Manager</option>
                <option value="ACCOUNTANT">Accountant</option>
                <option value="AUCTION_MANAGER">Auction Manager</option>
                <option value="CUSTOMER_SERVICE">Customer Service Executive</option>
              </SelectField>
              <InputField
                label="Phone"
                value={empForm.phone}
                onChange={(e) => setEmpForm({ ...empForm, phone: e.target.value })}
                required
              />
              <InputField
                label="Email"
                type="email"
                value={empForm.email}
                onChange={(e) => setEmpForm({ ...empForm, email: e.target.value })}
                required
              />
            </div>
            <InputField
              label="Assigned Collection Zone"
              value={empForm.assignedZone}
              onChange={(e) => setEmpForm({ ...empForm, assignedZone: e.target.value })}
              required
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowEmpModal(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createEmpMutation.isPending}>
                Save Employee
              </Button>
            </div>
          </form>
        </Modal>
      </div>
    );
  }

  // 8. Customer Self-Service Portal
  if (view === 'portal') {
    const cust = portalData?.customer;
    return (
      <div className="space-y-6">
        <PageHeader
          title="Customer Self-Service Portal"
          subtitle={
            cust
              ? `Subscriber Passbook · ${cust.fullName} (${cust.customerCode}) · Read-only personal account view`
              : 'Loading subscriber account...'
          }
        />

        {cust && (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Card className="p-5">
                <p className="text-xs text-slate-500">Active Chit Tickets</p>
                <p className="mt-1 font-mono text-2xl font-semibold text-slate-900 dark:text-slate-100">
                  {portalData.memberships?.length ?? 0}
                </p>
              </Card>
              <Card className="p-5">
                <p className="text-xs text-slate-500">Total Receipts Recorded</p>
                <p className="mt-1 font-mono text-2xl font-semibold text-teal-700 dark:text-teal-400">
                  {portalData.payments?.length ?? 0}
                </p>
              </Card>
              <Card className="p-5">
                <p className="text-xs text-slate-500">KYC Verification Status</p>
                <div className="mt-2">
                  <StatusText status={cust.kycStatus} />
                </div>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <Card className="p-5">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
                  My Installment Passbook
                </h2>
                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {(portalData.installments ?? []).map((inst: any) => (
                    <div key={inst.id} className="flex items-center justify-between py-2.5">
                      <div>
                        <p className="font-medium text-slate-900 dark:text-slate-100">
                          {inst.groupCode} · Inst #{inst.installmentNumber}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          Due {formatDateDDMMYYYY(inst.dueDate)} · Dividend -
                          {formatINR(inst.dividendAdjustment)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono font-semibold tabular-money">
                          Due {formatINR(inst.outstandingAmount)}
                        </p>
                        <StatusText status={inst.status} />
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-5">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
                  My Payment Receipts & Dividends
                </h2>
                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {(portalData.payments ?? []).map((p: any) => (
                    <div key={p.id} className="flex items-center justify-between py-2.5">
                      <div>
                        <p className="font-mono font-medium text-slate-900 dark:text-slate-100">
                          {p.receiptNumber}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {formatDateDDMMYYYY(p.paymentDate)} · {p.paymentMode}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono font-semibold tabular-money text-emerald-700 dark:text-emerald-400">
                          {formatINR(p.amount)}
                        </p>
                        <StatusText status={p.status} />
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </>
        )}
      </div>
    );
  }

  // 9. Company Settings, Password Security & Integration Adapters
  return (
    <div className="space-y-6">
      <PageHeader
        title="Company Configuration, Security & Integrations"
        subtitle="Entity profile, password rotation, MFA readiness, and external provider adapter setup"
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card className="p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Company Legal Profile
          </h2>
          {company && (
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Legal Entity</span>
                <span className="font-medium text-slate-900 dark:text-slate-100">
                  {company.legalName}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Registration Status</span>
                <span className="font-mono">{company.registrationNumber}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">State / Currency / Timezone</span>
                <span className="font-mono">Tamil Nadu · INR (₹) · Asia/Kolkata</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-slate-500">Language Architecture</span>
                <span>English Active · Tamil (தமிழ்) i18n Ready</span>
              </div>
            </div>
          )}
        </Card>

        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-teal-700 dark:text-teal-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Account Password Rotation ({user.username})
            </h2>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              changePwdMutation.mutate();
            }}
            className="space-y-3"
          >
            <InputField
              label="Current Password"
              type="password"
              value={pwdForm.currentPassword}
              onChange={(e) => setPwdForm({ ...pwdForm, currentPassword: e.target.value })}
              required
            />
            <InputField
              label="New Strong Password (min 8 chars)"
              type="password"
              value={pwdForm.newPassword}
              onChange={(e) => setPwdForm({ ...pwdForm, newPassword: e.target.value })}
              required
            />
            <Button type="submit" size="sm" disabled={changePwdMutation.isPending}>
              Rotate Password
            </Button>
          </form>
        </Card>
      </div>

      <Card className="p-6">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
          External Integration Adapters (Environment-Configured Only)
        </h2>
        <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
          {[
            ['Cloud SQL for PostgreSQL (Drizzle ORM)', 'Connected via Cloud SQL Auth Proxy', 'ACTIVE'],
            ['Firebase Authentication (Google SSO)', 'Configured with project OAuth client', 'ACTIVE'],
            ['Payment Gateway / UPI / eNACH Webhooks', 'Set PAYMENT_GATEWAY_PROVIDER & PAYMENT_GATEWAY_WEBHOOK_SECRET in server env', 'ADAPTER_UNCONFIGURED'],
            ['SMS (DLT) / WhatsApp Business / SMTP', 'Set SMS_PROVIDER_API_KEY / WHATSAPP_BUSINESS_TOKEN / SMTP_HOST', 'ADAPTER_UNCONFIGURED'],
            ['Encrypted KYC Document Storage (GCS)', 'Set GCS_KYC_BUCKET with KMS signed URLs for production deployment', 'ADAPTER_UNCONFIGURED'],
          ].map(([name, desc, st]) => (
            <div key={name} className="flex flex-col sm:flex-row sm:items-center justify-between py-3 gap-2">
              <div>
                <p className="font-medium text-slate-900 dark:text-slate-100">{name}</p>
                <p className="text-[11px] text-slate-500">{desc}</p>
              </div>
              <StatusText status={st} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
