import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  ShieldCheck,
  UserPlus,
  Users,
  Briefcase,
  UserCircle2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { apiRequest, setAuthToken, type SessionUser } from '../lib/api';
import { ROLE_LABELS, type UserRole } from '../domain/finance';
import { Button, InputField, SelectField } from './ui/Primitives';

interface LoginViewProps {
  onAuthenticated: (user: SessionUser) => void;
}

interface PrototypeRole {
  id: number;
  username: string;
  fullName: string;
  role: UserRole;
  branchId: number | null;
  branchName: string;
  customerId: number | null;
}

interface BranchOption {
  id: number;
  branchCode: string;
  name: string;
  district: string;
}

type AuthTab = 'roles' | 'admin' | 'register';

export function LoginView({ onAuthenticated }: LoginViewProps) {
  const [activeTab, setActiveTab] = useState<AuthTab>('admin');
  const [username, setUsername] = useState('karthick raj');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [roleLoading, setRoleLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  const [roles, setRoles] = useState<PrototypeRole[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);

  const [regForm, setRegForm] = useState({
    fullName: '',
    username: '',
    phone: '',
    email: '',
    city: 'Chennai',
    branchId: '1',
    password: '',
  });

  useEffect(() => {
    let active = true;
    apiRequest<{ roles: PrototypeRole[]; branches: BranchOption[] }>('/auth/prototype-roles')
      .then((res) => {
        if (!active) return;
        setRoles(res.roles ?? []);
        setBranches(res.branches ?? []);
      })
      .catch(() => {
        // fail quietly if backend is booting
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleCredentialLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError('Enter both username and password.');
      return;
    }
    setLoading(true);
    try {
      const res = await apiRequest<{ token: string; user: SessionUser }>('/auth/login', {
        method: 'POST',
        body: { username: username.trim(), password },
      });
      setAuthToken(res.token);
      onAuthenticated(res.user);
    } catch (err: any) {
      setError(err.message || 'Sign-in failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRoleInstantAccess(roleUsername: string) {
    setError(null);
    setRoleLoading(roleUsername);
    try {
      const res = await apiRequest<{ token: string; user: SessionUser }>('/auth/role-preview', {
        method: 'POST',
        body: { username: roleUsername },
      });
      setAuthToken(res.token);
      onAuthenticated(res.user);
    } catch (err: any) {
      setError(err.message || 'Unable to enter role workspace.');
    } finally {
      setRoleLoading(null);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<{ token: string; user: SessionUser }>('/auth/register', {
        method: 'POST',
        body: {
          fullName: regForm.fullName.trim(),
          username: regForm.username.trim(),
          phone: regForm.phone.trim(),
          email: regForm.email.trim(),
          city: regForm.city.trim(),
          branchId: Number(regForm.branchId) || 1,
          password: regForm.password,
        },
      });
      setAuthToken(res.token);
      onAuthenticated(res.user);
    } catch (err: any) {
      setError(err.message || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  }

  const staffRoles = roles.filter((r) => r.role !== 'CUSTOMER');
  const customerRoles = roles.filter((r) => r.role === 'CUSTOMER');

  const tabs: { id: AuthTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'admin', label: 'Admin Login', icon: Lock },
    { id: 'roles', label: 'Instant Roles', icon: Users },
    { id: 'register', label: 'Create Account', icon: UserPlus },
  ];

  return (
    <div className="min-h-screen bg-[#F6F7F9] dark:bg-[#070B14] grid grid-cols-1 lg:grid-cols-12">
      {/* Left Architectural Editorial Panel */}
      <div className="relative lg:col-span-6 xl:col-span-7 bg-[#070B14] text-white overflow-hidden flex flex-col justify-between p-8 sm:p-12 lg:p-16 min-h-[300px] lg:min-h-screen">
        {!imgFailed ? (
          <img
            src="/src/assets/images/login_architectural_vault_1795600482526.jpg"
            alt="Kaveri ChitLedger architectural headquarters interior"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="absolute inset-0 h-full w-full object-cover object-center opacity-75"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#0B1220] via-[#0F1E33] to-[#070B14]" />
        )}

        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-[#070B14]/95 via-[#070B14]/55 to-[#070B14]/40"
        />

        {/* Brand Wordmark */}
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 border border-white/15 font-display text-sm font-semibold text-emerald-300 backdrop-blur-xs">
              K
            </span>
            <span className="font-display text-lg font-semibold tracking-tight text-white">
              Kaveri ChitLedger
            </span>
          </div>
          <span className="hidden sm:inline text-xs text-slate-300/80 font-mono">
            Tamil Nadu · INR (₹) · IST
          </span>
        </div>

        {/* Editorial Headline & Ledger Architecture Pillars */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="relative z-10 max-w-xl mt-12 lg:mt-0"
        >
          <p className="text-xs font-medium tracking-wide text-emerald-300">
            Institutional Chit Fund Operating System
          </p>
          <h1 className="mt-3 font-display text-3xl sm:text-4xl lg:text-[42px] font-semibold leading-[1.12] tracking-tight text-white">
            Precision treasury, auctions, and double-entry accounting in one ledger.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-slate-300 max-w-lg">
            Sign in with credentials as Super Admin, jump straight into any staff or subscriber
            role without credentials in prototype mode, or register a new subscriber account.
          </p>

          <div className="mt-10 grid grid-cols-3 gap-6 border-t border-white/15 pt-6">
            <div>
              <p className="font-mono text-xl font-semibold text-white">22</p>
              <p className="mt-1 text-xs text-slate-300/80">Integrated Modules</p>
            </div>
            <div>
              <p className="font-mono text-xl font-semibold text-white">
                {roles.length + 1}
              </p>
              <p className="mt-1 text-xs text-slate-300/80">Seeded Accounts</p>
            </div>
            <div>
              <p className="font-mono text-xl font-semibold text-white">3</p>
              <p className="mt-1 text-xs text-slate-300/80">TN Regional Hubs</p>
            </div>
          </div>
        </motion.div>

        <div className="relative z-10 mt-10 flex items-center justify-between text-xs text-slate-400">
          <span>Kaveri Enterprise Chits Pvt. Ltd. · Multi-Role Prototype</span>
          <span className="font-mono">FY 2026–27</span>
        </div>
      </div>

      {/* Right Dynamic Auth Studio */}
      <div className="lg:col-span-6 xl:col-span-5 flex items-center justify-center p-6 sm:p-10 lg:p-14">
        <div className="w-full max-w-[440px]">
          <div className="mb-6">
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              Workspace Access Gateway
            </p>
            <h2 className="mt-1 font-display text-2xl sm:text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
              {activeTab === 'admin'
                ? 'Administrator Sign In'
                : activeTab === 'roles'
                  ? 'Multi-Role Instant Access'
                  : 'Create Subscriber Account'}
            </h2>
            <p className="mt-1.5 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              {activeTab === 'admin'
                ? 'Super Admin and registered accounts require password verification.'
                : activeTab === 'roles'
                  ? 'Enter any operational role or subscriber passbook with one click — no password required.'
                  : 'Register your profile in PostgreSQL and launch your live Chit Passbook immediately.'}
            </p>
          </div>

          {/* Animated Dynamic Segmented Switcher */}
          <div
            role="tablist"
            aria-label="Authentication mode"
            className="relative grid grid-cols-3 rounded-xl bg-slate-200/70 p-1 dark:bg-white/[0.06] mb-6"
          >
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isSelected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setError(null);
                  }}
                  className={`relative z-10 flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    isSelected
                      ? 'text-slate-950 dark:text-white'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {isSelected && (
                    <motion.span
                      layoutId="loginModeIndicator"
                      transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                      className="absolute inset-0 -z-10 rounded-lg bg-white shadow-xs dark:bg-[#0F1624] border border-slate-200/70 dark:border-white/[0.1]"
                    />
                  )}
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
            >
              {error}
            </div>
          )}

          <AnimatePresence mode="wait">
            {activeTab === 'admin' && (
              <motion.div
                key="tab-admin"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16 }}
              >
                <form onSubmit={handleCredentialLogin} className="space-y-4">
                  <InputField
                    label="Username"
                    name="username"
                    autoComplete="username"
                    placeholder="karthick raj"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />

                  <div className="space-y-1.5">
                    <label
                      htmlFor="login-password"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                    >
                      Password
                    </label>
                    <div className="relative">
                      <input
                        id="login-password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        placeholder="Enter password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 pr-10 text-sm text-slate-950 placeholder:text-slate-400 transition-colors focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/15 dark:border-white/[0.1] dark:bg-[#0F1624] dark:text-slate-100"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <Button type="submit" disabled={loading} className="w-full" size="lg">
                    {loading ? 'Authenticating...' : 'Enter Super Admin Console'}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </form>

                <div className="mt-6 border-t border-slate-200/80 pt-4 dark:border-white/[0.08] flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    Admin credentials protected
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('roles')}
                    className="font-medium text-slate-900 hover:text-emerald-700 dark:text-slate-200 dark:hover:text-emerald-400 cursor-pointer"
                  >
                    Switch role without password →
                  </button>
                </div>
              </motion.div>
            )}

            {activeTab === 'roles' && (
              <motion.div
                key="tab-roles"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16 }}
                className="space-y-5 max-h-[430px] overflow-y-auto pr-1"
              >
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    <Briefcase className="h-3.5 w-3.5" />
                    Staff & Operations Roles (1-Click Prototype Entry)
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {staffRoles.map((acct) => (
                      <button
                        key={acct.username}
                        type="button"
                        disabled={roleLoading !== null}
                        onClick={() => handleRoleInstantAccess(acct.username)}
                        className="group flex flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-3 text-left transition-all duration-150 hover:border-emerald-600/60 hover:bg-emerald-50/30 dark:border-white/[0.08] dark:bg-[#0F1624] dark:hover:border-emerald-500/50 dark:hover:bg-emerald-500/[0.06] cursor-pointer disabled:opacity-60"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-950 dark:text-white truncate">
                            {ROLE_LABELS[acct.role] ?? acct.role}
                          </span>
                          <ArrowRight className="h-3.5 w-3.5 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 shrink-0" />
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {acct.fullName} · {acct.branchName}
                        </p>
                        {roleLoading === acct.username && (
                          <p className="mt-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                            Opening workspace...
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    <UserCircle2 className="h-3.5 w-3.5" />
                    Seeded Subscribers (Instant Passbook Portal)
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {customerRoles.map((acct) => (
                      <button
                        key={acct.username}
                        type="button"
                        disabled={roleLoading !== null}
                        onClick={() => handleRoleInstantAccess(acct.username)}
                        className="group flex flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-3 text-left transition-all duration-150 hover:border-emerald-600/60 hover:bg-emerald-50/30 dark:border-white/[0.08] dark:bg-[#0F1624] dark:hover:border-emerald-500/50 dark:hover:bg-emerald-500/[0.06] cursor-pointer disabled:opacity-60"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-950 dark:text-white truncate">
                            {acct.fullName}
                          </span>
                          <ArrowRight className="h-3.5 w-3.5 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 shrink-0" />
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          @{acct.username} · {acct.branchName}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'register' && (
              <motion.div
                key="tab-register"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16 }}
              >
                <form onSubmit={handleRegister} className="space-y-3.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <InputField
                      label="Full Name"
                      placeholder="e.g. Deepa Sundar"
                      value={regForm.fullName}
                      onChange={(e) => setRegForm({ ...regForm, fullName: e.target.value })}
                      required
                    />
                    <InputField
                      label="Username"
                      placeholder="e.g. deepa_s"
                      value={regForm.username}
                      onChange={(e) => setRegForm({ ...regForm, username: e.target.value })}
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <InputField
                      label="Mobile Phone"
                      placeholder="+91 98401 11223"
                      value={regForm.phone}
                      onChange={(e) => setRegForm({ ...regForm, phone: e.target.value })}
                      required
                    />
                    <InputField
                      label="City"
                      placeholder="Chennai"
                      value={regForm.city}
                      onChange={(e) => setRegForm({ ...regForm, city: e.target.value })}
                      required
                    />
                  </div>

                  <SelectField
                    label="Home Tamil Nadu Branch"
                    value={regForm.branchId}
                    onChange={(e) => setRegForm({ ...regForm, branchId: e.target.value })}
                  >
                    {branches.length > 0 ? (
                      branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.branchCode} · {b.name}
                        </option>
                      ))
                    ) : (
                      <option value="1">TN-CHN-01 · Chennai — T. Nagar HQ</option>
                    )}
                  </SelectField>

                  <InputField
                    label="Create Password"
                    type="password"
                    placeholder="Minimum 6 characters"
                    value={regForm.password}
                    onChange={(e) => setRegForm({ ...regForm, password: e.target.value })}
                    required
                  />

                  <Button type="submit" disabled={loading} className="w-full" size="lg">
                    {loading ? 'Creating subscriber profile...' : 'Create Account & Enter Portal'}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
