import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Search, Upload, FileCheck2, Eye } from 'lucide-react';
import { apiRequest, downloadCSV } from '../lib/api';
import { formatDateDDMMYYYY } from '../domain/finance';
import {
  Button,
  Card,
  PageHeader,
  StatusText,
  InputField,
  SelectField,
  Modal,
  EmptyState,
} from './ui/Primitives';

export function CustomersModule({
  selectedBranchId,
  branches,
  mode = 'customers',
}: {
  selectedBranchId: string;
  branches: any[];
  mode?: 'customers' | 'kyc';
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [kycFilter, setKycFilter] = useState(mode === 'kyc' ? 'PENDING' : 'ALL');
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);

  const [form, setForm] = useState({
    branchId: String(branches[0]?.id ?? 1),
    fullName: '',
    phone: '',
    email: '',
    dob: '',
    panNumber: '',
    address: '',
    city: 'Chennai',
    pincode: '600017',
    nomineeName: '',
    nomineeRelation: 'Spouse',
  });

  const [csvText, setCsvText] = useState(
    'fullName,phone,city,address,panNumber\nSaravanan Muthu,+91 98405 71201,Chennai,22 Anna Salai,BHKPS9011A\nRevathi Sundar,+91 98422 88912,Coimbatore,14 Avinashi Road,CDLPR7741K'
  );
  const [importPreview, setImportPreview] = useState<any | null>(null);

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers', selectedBranchId],
    queryFn: () =>
      apiRequest<any[]>(
        selectedBranchId && selectedBranchId !== 'all'
          ? `/customers?branchId=${selectedBranchId}`
          : '/customers'
      ),
  });

  const createMutation = useMutation({
    mutationFn: (payload: typeof form) =>
      apiRequest('/customers', { method: 'POST', body: payload }),
    onSuccess: () => {
      toast.success('Customer registered and queued for Maker-Checker KYC verification.');
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['approvals'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setShowAdd(false);
      setForm({
        ...form,
        fullName: '',
        phone: '',
        email: '',
        panNumber: '',
        address: '',
        nomineeName: '',
      });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const importMutation = useMutation({
    mutationFn: ({ dryRun }: { dryRun: boolean }) => {
      const lines = csvText.trim().split('\n').slice(1);
      const rows = lines
        .map((line) => line.split(',').map((c) => c.trim()))
        .filter((cols) => cols.length >= 4)
        .map(([fullName, phone, city, address, panNumber = '']) => ({
          fullName,
          phone,
          city,
          address,
          panNumber,
        }));
      return apiRequest('/import/customers', {
        method: 'POST',
        body: { branchId: Number(form.branchId), dryRun, rows },
      });
    },
    onSuccess: (res: any) => {
      setImportPreview(res);
      if (!res.dryRun) {
        toast.success(`Imported ${res.importedCount} customer records cleanly.`);
        qc.invalidateQueries({ queryKey: ['customers'] });
        qc.invalidateQueries({ queryKey: ['dashboard'] });
        setShowImport(false);
        setImportPreview(null);
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const filtered = customers.filter((c) => {
    const matchesText =
      !search.trim() ||
      c.fullName.toLowerCase().includes(search.toLowerCase()) ||
      c.customerCode.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search) ||
      (c.panNumber || '').toLowerCase().includes(search.toLowerCase());
    const matchesKyc = kycFilter === 'ALL' || c.kycStatus === kycFilter;
    return matchesText && matchesKyc;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={mode === 'kyc' ? 'KYC Verification Desk' : 'Customer Management'}
        subtitle={
          mode === 'kyc'
            ? 'Permitted ID/PAN & address proof verification · Zero Aadhaar OTP or biometric storage'
            : 'Centralized subscriber master with duplicate detection, KYC status, and legacy CSV migration'
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCSV(
                  'kaveri-customers.csv',
                  ['Customer ID', 'Full Name', 'Phone', 'City', 'PAN', 'KYC Status'],
                  filtered.map((c) => [c.customerCode, c.fullName, c.phone, c.city, c.panNumber, c.kycStatus])
                )
              }
            >
              Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
              <Upload className="h-3.5 w-3.5" />
              CSV Import Wizard
            </Button>
            <Button variant="primary" size="sm" onClick={() => setShowAdd(true)}>
              <Plus className="h-3.5 w-3.5" />
              Register Customer
            </Button>
          </>
        }
      />

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, CUST ID, phone, or PAN..."
            aria-label="Search customers"
            className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/80">
          {['ALL', 'VERIFIED', 'PENDING', 'REJECTED'].map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setKycFilter(st)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                kycFilter === st
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              {st === 'ALL' ? 'All' : st.charAt(0) + st.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Customer Directory Table */}
      <Card>
        {isLoading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading customer records...</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No customers match your filter"
            description="Adjust your search query or register a new subscriber."
            action={
              <Button size="sm" onClick={() => setShowAdd(true)}>
                Register Customer
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
                  <th className="px-4 py-3 font-medium">Customer ID</th>
                  <th className="px-4 py-3 font-medium">Subscriber Name</th>
                  <th className="px-4 py-3 font-medium">Contact & City</th>
                  <th className="px-4 py-3 font-medium">PAN & Docs</th>
                  <th className="px-4 py-3 font-medium">KYC Status</th>
                  <th className="px-4 py-3 text-right font-medium">Profile</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-mono font-medium text-slate-900 dark:text-slate-100">
                      {c.customerCode}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900 dark:text-slate-100">{c.fullName}</p>
                      <p className="text-[11px] text-slate-500">
                        Nominee: {c.nomineeName || 'Not recorded'}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-mono text-slate-700 dark:text-slate-300">{c.phone}</p>
                      <p className="text-[11px] text-slate-500">
                        {c.city}, {c.state}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-mono text-slate-700 dark:text-slate-300">
                        {c.panNumber || 'Not provided'}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {c.kycDocuments?.length ?? 0} permitted doc(s)
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusText status={c.kycStatus} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedCustomer(c)}
                        aria-label={`View profile for ${c.fullName}`}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Inspect
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Register New Customer Modal */}
      <Modal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="Register New Customer"
        subtitle="Duplicate phone check runs automatically. Permitted KYC docs only (no Aadhaar OTP/biometrics)."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate(form);
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              label="Assigned Branch"
              value={form.branchId}
              onChange={(e) => setForm({ ...form, branchId: e.target.value })}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.branchCode} — {b.name}
                </option>
              ))}
            </SelectField>
            <InputField
              label="Full Legal Name"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              required
            />
            <InputField
              label="Mobile Number"
              placeholder="+91 98400 00000"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              required
            />
            <InputField
              label="Email Address"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <InputField
              label="PAN (Optional where applicable)"
              placeholder="ABCDE1234F"
              value={form.panNumber}
              onChange={(e) => setForm({ ...form, panNumber: e.target.value.toUpperCase() })}
            />
            <InputField
              label="Date of Birth"
              type="date"
              value={form.dob}
              onChange={(e) => setForm({ ...form, dob: e.target.value })}
            />
          </div>
          <InputField
            label="Residential / Business Address"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            required
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <InputField
              label="City"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              required
            />
            <InputField
              label="Pincode"
              value={form.pincode}
              onChange={(e) => setForm({ ...form, pincode: e.target.value })}
            />
            <InputField
              label="Nominee Name"
              value={form.nomineeName}
              onChange={(e) => setForm({ ...form, nomineeName: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <Button type="button" variant="outline" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Registering...' : 'Register & Submit KYC'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Customer 360 Detail Modal */}
      <Modal
        open={!!selectedCustomer}
        onClose={() => setSelectedCustomer(null)}
        title={selectedCustomer?.fullName ?? 'Customer Profile'}
        subtitle={`${selectedCustomer?.customerCode ?? ''} · KYC Status: ${selectedCustomer?.kycStatus ?? ''}`}
        wide
      >
        {selectedCustomer && (
          <div className="space-y-5 text-xs">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div>
                <p className="text-slate-500">Phone</p>
                <p className="mt-0.5 font-mono font-medium text-slate-900 dark:text-slate-100">
                  {selectedCustomer.phone}
                </p>
              </div>
              <div>
                <p className="text-slate-500">PAN Number</p>
                <p className="mt-0.5 font-mono font-medium text-slate-900 dark:text-slate-100">
                  {selectedCustomer.panNumber || 'Not Provided'}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Date of Birth</p>
                <p className="mt-0.5 font-mono font-medium text-slate-900 dark:text-slate-100">
                  {formatDateDDMMYYYY(selectedCustomer.dob)}
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-slate-500">Address</p>
                <p className="mt-0.5 text-slate-900 dark:text-slate-100">
                  {selectedCustomer.address}, {selectedCustomer.city}, {selectedCustomer.state} {selectedCustomer.pincode}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Nominee</p>
                <p className="mt-0.5 text-slate-900 dark:text-slate-100">
                  {selectedCustomer.nomineeName || '—'} ({selectedCustomer.nomineeRelation || '—'})
                </p>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
              <p className="font-semibold text-slate-900 dark:text-slate-100 mb-2 flex items-center gap-1.5">
                <FileCheck2 className="h-4 w-4 text-teal-600" />
                Permitted KYC Documents Vault
              </p>
              {selectedCustomer.kycDocuments?.length ? (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {selectedCustomer.kycDocuments.map((doc: any) => (
                    <div key={doc.id} className="flex items-center justify-between py-2">
                      <div>
                        <p className="font-medium text-slate-800 dark:text-slate-200">
                          {doc.documentType} · <span className="font-mono">{doc.documentNumberMasked}</span>
                        </p>
                        <p className="text-[11px] text-slate-500">{doc.notes}</p>
                      </div>
                      <StatusText status={doc.verificationStatus} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-slate-500">No KYC documents uploaded yet.</p>
              )}
              <p className="mt-3 text-[11px] text-slate-500">
                Compliance Note: KYC verification requires Maker-Checker sign-off in the Approvals
                queue. Aadhaar OTP and biometric data collection are disabled by policy.
              </p>
            </div>
          </div>
        )}
      </Modal>

      {/* Legacy Excel / CSV Migration Wizard */}
      <Modal
        open={showImport}
        onClose={() => {
          setShowImport(false);
          setImportPreview(null);
        }}
        title="Legacy Excel / CSV Customer Migration Wizard"
        subtitle="Validate legacy spreadsheet rosters with dry-run duplicate detection before committing to PostgreSQL."
        wide
      >
        <div className="space-y-4">
          <SelectField
            label="Target Branch"
            value={form.branchId}
            onChange={(e) => setForm({ ...form, branchId: e.target.value })}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.branchCode} — {b.name}
              </option>
            ))}
          </SelectField>
          <div>
            <label
              htmlFor="csv-import-box"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Paste CSV Rows (fullName,phone,city,address,panNumber)
            </label>
            <textarea
              id="csv-import-box"
              rows={6}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white p-3 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>

          {importPreview && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-900/50">
              <p className="font-medium text-slate-900 dark:text-slate-100">
                Dry-Run Validation Result: {importPreview.validCount} ready to import ·{' '}
                {importPreview.duplicates?.length ?? 0} duplicate(s) skipped
              </p>
              {importPreview.duplicates?.length > 0 && (
                <p className="mt-1 text-amber-700 dark:text-amber-400">
                  Duplicates detected:{' '}
                  {importPreview.duplicates.map((d: any) => `${d.fullName} (${d.phone})`).join(', ')}
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => importMutation.mutate({ dryRun: true })}
              disabled={importMutation.isPending}
            >
              Run Dry-Run Validation
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => importMutation.mutate({ dryRun: false })}
              disabled={importMutation.isPending}
            >
              Commit Valid Records
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
