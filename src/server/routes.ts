import crypto from 'node:crypto';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { and, desc, eq, asc, inArray } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  companies,
  branches,
  users,
  employees,
  customers,
  kycDocuments,
  chitSchemes,
  schemeVersions,
  chitGroups,
  memberships,
  installmentSchedules,
  payments,
  paymentAllocations,
  auctions,
  bids,
  dividendAllocations,
  prizePayouts,
  guarantors,
  securities,
  chartOfAccounts,
  accountingPeriods,
  journalEntries,
  journalLines,
  branchCashRegisters,
  bankAccounts,
  bankReconciliations,
  approvalRequests,
  collectionFollowUps,
  documents,
  notificationsOutbox,
  mandates,
  auditLogs,
} from '../db/schema.ts';
import {
  requireAuth,
  requirePermission,
  resolveScopedBranchId,
  verifyPassword,
  hashPassword,
  createSessionForUser,
  revokeSessionToken,
  writeAuditLog,
  type AuthRequest,
} from './auth.ts';
import {
  rupeesToPaise,
  paiseToRupees,
  allocatePaymentAcrossInstallments,
  calculateAuctionSnapshot,
  validateJournalBalance,
  canDecideApproval,
  type RoundingPolicy,
  type CommissionMethod,
} from '../domain/finance.ts';

export const apiRouter = Router();

function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function addMonthsISO(dateISO: string, months: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m - 1) + months, Math.min(d, 28)));
  return dt.toISOString().slice(0, 10);
}

function sendError(res: Response, status: number, code: string, message: string, fieldErrors?: unknown) {
  return res.status(status).json({ error: { code, message, fieldErrors } });
}

// ============================================================================
// 1. AUTHENTICATION ROUTES
// ============================================================================

const loginSchema = z.object({
  username: z.string().trim().min(2).max(80),
  password: z.string().min(4).max(128),
});

apiRouter.post('/auth/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Please enter a valid username and password.');
  }

  try {
    const uname = parsed.data.username.toLowerCase().replace(/\s+/g, ' ');
    const rows = await db.select().from(users).where(eq(users.username, uname)).limit(1);
    const user = rows[0];

    if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
      return sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
    }
    if (!user.isActive) {
      return sendError(res, 403, 'ACCOUNT_SUSPENDED', 'Account access has been suspended.');
    }

    const token = await createSessionForUser(user.id);
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    await writeAuditLog({
      branchId: user.branchId,
      actor: { id: user.id, username: user.username, role: user.role },
      action: 'USER_LOGIN',
      entityType: 'user',
      entityId: user.id,
      after: { method: 'LOCAL_PASSWORD' },
      ipAddress: req.ip ?? '',
    });

    return res.json({
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          branchId: user.branchId,
          customerId: user.customerId,
          mustChangePassword: user.mustChangePassword,
          mfaEnabled: user.mfaEnabled,
        },
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return sendError(res, 500, 'SERVER_ERROR', 'Authentication service unavailable.');
  }
});

// Public directory of non-admin prototype roles & branches for quick role access and self-registration
apiRouter.get('/auth/prototype-roles', async (_req, res) => {
  try {
    const [activeUsers, branchRows] = await Promise.all([
      db
        .select({
          id: users.id,
          username: users.username,
          fullName: users.fullName,
          role: users.role,
          branchId: users.branchId,
          customerId: users.customerId,
        })
        .from(users)
        .where(eq(users.isActive, true))
        .orderBy(asc(users.id)),
      db
        .select({
          id: branches.id,
          branchCode: branches.branchCode,
          name: branches.name,
          district: branches.district,
        })
        .from(branches)
        .orderBy(asc(branches.id)),
    ]);

    const branchMap = new Map(branchRows.map((b) => [b.id, b]));
    const roles = activeUsers
      .filter((u) => u.role !== 'SUPER_ADMIN' && u.role !== 'COMPANY_ADMIN')
      .map((u) => ({
        ...u,
        branchName: u.branchId ? branchMap.get(u.branchId)?.name ?? '' : 'All Branches',
      }));

    return res.json({ data: { roles, branches: branchRows } });
  } catch (err) {
    console.error('Prototype roles error:', err);
    return sendError(res, 500, 'SERVER_ERROR', 'Unable to load available roles.');
  }
});

// One-click prototype login strictly for non-admin roles (Admin accounts MUST authenticate with password)
const rolePreviewSchema = z.object({
  username: z.string().trim().min(2).max(80),
});

apiRouter.post('/auth/role-preview', async (req, res) => {
  const parsed = rolePreviewSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Select a valid role account.');
  }

  try {
    const uname = parsed.data.username.toLowerCase().replace(/\s+/g, ' ');
    const rows = await db.select().from(users).where(eq(users.username, uname)).limit(1);
    const user = rows[0];

    if (!user || !user.isActive) {
      return sendError(res, 404, 'USER_NOT_FOUND', 'Selected role account is not available.');
    }

    if (user.role === 'SUPER_ADMIN' || user.role === 'COMPANY_ADMIN') {
      return sendError(
        res,
        403,
        'ADMIN_CREDENTIALS_REQUIRED',
        'Administrator accounts require username and password authentication.'
      );
    }

    const token = await createSessionForUser(user.id);
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    await writeAuditLog({
      branchId: user.branchId,
      actor: { id: user.id, username: user.username, role: user.role },
      action: 'PROTOTYPE_ROLE_LOGIN',
      entityType: 'user',
      entityId: user.id,
      after: { method: 'PROTOTYPE_ROLE_SWITCH', role: user.role },
      ipAddress: req.ip ?? '',
    });

    return res.json({
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          branchId: user.branchId,
          customerId: user.customerId,
          mustChangePassword: false,
          mfaEnabled: user.mfaEnabled,
        },
      },
    });
  } catch (err) {
    console.error('Role preview login error:', err);
    return sendError(res, 500, 'SERVER_ERROR', 'Unable to switch role.');
  }
});

// Self-service subscriber account registration (creates Customer + CUSTOMER User atomically)
const registerUserSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  username: z
    .string()
    .trim()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9._ -]+$/, 'Username may contain letters, numbers, spaces, dots, or underscores.'),
  phone: z.string().trim().min(8).max(20),
  email: z.string().trim().email().or(z.literal('')).default(''),
  city: z.string().trim().min(2).max(80).default('Chennai'),
  branchId: z.coerce.number().int().positive().default(1),
  password: z.string().min(6).max(128),
});

apiRouter.post('/auth/register', async (req, res) => {
  const parsed = registerUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message || 'Please complete all required registration fields.'
    );
  }

  try {
    const uname = parsed.data.username.toLowerCase().replace(/\s+/g, ' ');
    const [existingUser, existingPhone] = await Promise.all([
      db.select({ id: users.id }).from(users).where(eq(users.username, uname)).limit(1),
      db.select({ id: customers.id }).from(customers).where(eq(customers.phone, parsed.data.phone)).limit(1),
    ]);

    if (existingUser.length > 0) {
      return sendError(res, 409, 'USERNAME_TAKEN', `Username "${parsed.data.username}" is already registered.`);
    }
    if (existingPhone.length > 0) {
      return sendError(res, 409, 'PHONE_TAKEN', 'A subscriber account with this phone number already exists.');
    }

    const passwordHash = hashPassword(parsed.data.password);
    const uid = `local-reg-${crypto.randomBytes(6).toString('hex')}`;
    const customerCode = `CUST-WEB-${Date.now().toString().slice(-5)}`;
    const safeEmail = parsed.data.email || `${uname.replace(/\s+/g, '.')}@kaverichits.demo`;

    const created = await db.transaction(async (tx) => {
      const [cust] = await tx
        .insert(customers)
        .values({
          companyId: 1,
          branchId: parsed.data.branchId,
          customerCode,
          fullName: parsed.data.fullName,
          phone: parsed.data.phone,
          email: safeEmail,
          address: `${parsed.data.city}, Tamil Nadu`,
          city: parsed.data.city,
          state: 'Tamil Nadu',
          kycStatus: 'PENDING',
        })
        .returning();

      const [newUser] = await tx
        .insert(users)
        .values({
          uid,
          branchId: parsed.data.branchId,
          username: uname,
          email: safeEmail,
          fullName: parsed.data.fullName,
          passwordHash,
          role: 'CUSTOMER',
          customerId: cust.id,
          isActive: true,
          mustChangePassword: false,
        })
        .returning();

      await tx.insert(documents).values({
        companyId: 1,
        branchId: parsed.data.branchId,
        documentNumber: `DOC-SELF-${Date.now().toString().slice(-6)}`,
        documentType: 'CUSTOMER_REGISTRATION_ACK',
        version: 1,
        title: `Subscriber Self-Registration — ${cust.fullName}`,
        entityType: 'customer',
        entityId: cust.id,
        customerId: cust.id,
        contentSnapshotJson: JSON.stringify({
          customerCode: cust.customerCode,
          fullName: cust.fullName,
          city: cust.city,
          registeredVia: 'SELF_SERVICE_PORTAL',
        }),
        generatedByUserId: newUser.id,
      });

      return { cust, newUser };
    });

    const token = await createSessionForUser(created.newUser.id);

    await writeAuditLog({
      branchId: created.newUser.branchId,
      actor: { id: created.newUser.id, username: created.newUser.username, role: created.newUser.role },
      action: 'USER_SELF_REGISTERED',
      entityType: 'user',
      entityId: created.newUser.id,
      after: { customerCode: created.cust.customerCode, city: created.cust.city },
      ipAddress: req.ip ?? '',
    });

    return res.status(201).json({
      data: {
        token,
        user: {
          id: created.newUser.id,
          username: created.newUser.username,
          email: created.newUser.email,
          fullName: created.newUser.fullName,
          role: created.newUser.role,
          branchId: created.newUser.branchId,
          customerId: created.newUser.customerId,
          mustChangePassword: false,
          mfaEnabled: false,
        },
      },
    });
  } catch (err) {
    console.error('Self registration error:', err);
    return sendError(res, 500, 'SERVER_ERROR', 'Unable to create account right now.');
  }
});

apiRouter.post('/auth/logout', requireAuth, async (req: AuthRequest, res) => {
  try {
    const token = req.headers.authorization?.slice('Bearer '.length).trim() ?? '';
    if (token) await revokeSessionToken(token);
    if (req.user) {
      await writeAuditLog({
        branchId: req.user.branchId,
        actor: req.user,
        action: 'USER_LOGOUT',
        entityType: 'user',
        entityId: req.user.id,
        ipAddress: req.ip ?? '',
      });
    }
    return res.json({ data: { signedOut: true } });
  } catch (err) {
    console.error('Logout error:', err);
    return sendError(res, 500, 'SERVER_ERROR', 'Failed to sign out.');
  }
});

apiRouter.get('/auth/me', requireAuth, async (req: AuthRequest, res) => {
  return res.json({ data: { user: req.user } });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(4),
  newPassword: z.string().min(8).max(128),
});

apiRouter.post('/auth/change-password', requireAuth, async (req: AuthRequest, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'New password must be at least 8 characters.');
  }
  try {
    const rows = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    const u = rows[0];
    if (!u || !verifyPassword(parsed.data.currentPassword, u.passwordHash)) {
      return sendError(res, 400, 'INVALID_PASSWORD', 'Current password is incorrect.');
    }
    const newHash = hashPassword(parsed.data.newPassword);
    await db
      .update(users)
      .set({ passwordHash: newHash, mustChangePassword: false, updatedAt: new Date() })
      .where(eq(users.id, u.id));
    await writeAuditLog({
      branchId: u.branchId,
      actor: req.user!,
      action: 'PASSWORD_ROTATED',
      entityType: 'user',
      entityId: u.id,
      ipAddress: req.ip ?? '',
    });
    return res.json({ data: { updated: true } });
  } catch (err) {
    console.error('Password rotation error:', err);
    return sendError(res, 500, 'SERVER_ERROR', 'Failed to update password.');
  }
});

// ============================================================================
// 2. DASHBOARD (REAL POSTGRESQL AGGREGATIONS)
// ============================================================================

apiRouter.get('/dashboard', requireAuth, requirePermission('dashboard:read'), async (req: AuthRequest, res) => {
  try {
    const branchId = resolveScopedBranchId(req, req.query.branchId as string | undefined);
    const today = todayISO();
    const currentMonthPrefix = today.slice(0, 7); // YYYY-MM

    const [
      allBranches,
      allCustomers,
      allGroups,
      allMemberships,
      allSchedules,
      allPayments,
      allApprovals,
      allAuctions,
    ] = await Promise.all([
      db.select().from(branches).orderBy(asc(branches.id)),
      branchId ? db.select().from(customers).where(eq(customers.branchId, branchId)) : db.select().from(customers),
      branchId ? db.select().from(chitGroups).where(eq(chitGroups.branchId, branchId)) : db.select().from(chitGroups),
      branchId ? db.select().from(memberships).where(eq(memberships.branchId, branchId)) : db.select().from(memberships),
      branchId ? db.select().from(installmentSchedules).where(eq(installmentSchedules.branchId, branchId)) : db.select().from(installmentSchedules),
      branchId
        ? db.select().from(payments).where(eq(payments.branchId, branchId)).orderBy(desc(payments.createdAt))
        : db.select().from(payments).orderBy(desc(payments.createdAt)),
      branchId
        ? db.select().from(approvalRequests).where(and(eq(approvalRequests.branchId, branchId), eq(approvalRequests.status, 'PENDING')))
        : db.select().from(approvalRequests).where(eq(approvalRequests.status, 'PENDING')),
      branchId ? db.select().from(auctions).where(eq(auctions.branchId, branchId)) : db.select().from(auctions),
    ]);

    let todayCollectionsPaise = 0n;
    let monthlyCollectionsPaise = 0n;
    let totalOutstandingPaise = 0n;

    const validPaymentStatuses = new Set(['SUCCESSFUL', 'RECONCILED', 'UNDER_VERIFICATION']);

    for (const p of allPayments) {
      if (!validPaymentStatuses.has(p.status)) continue;
      const amt = rupeesToPaise(p.amount);
      if (p.paymentDate === today) todayCollectionsPaise += amt;
      if (p.paymentDate.startsWith(currentMonthPrefix)) monthlyCollectionsPaise += amt;
    }

    for (const s of allSchedules) {
      if (s.status === 'DUE' || s.status === 'PARTIAL' || s.status === 'OVERDUE') {
        totalOutstandingPaise += rupeesToPaise(s.outstandingAmount);
      }
    }

    // Collection trend by month (from real payments)
    const monthTotals = new Map<string, bigint>();
    for (const p of allPayments) {
      if (!validPaymentStatuses.has(p.status)) continue;
      const key = p.paymentDate.slice(0, 7);
      monthTotals.set(key, (monthTotals.get(key) ?? 0n) + rupeesToPaise(p.amount));
    }
    const collectionTrends = Array.from(monthTotals.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, paise]) => ({
        month,
        amountRupees: Number(paise) / 100,
        amountFormatted: paiseToRupees(paise),
      }));

    // Branch performance summary
    const branchPerformance = allBranches.map((b) => {
      const bPayments = allPayments.filter((p) => p.branchId === b.id && validPaymentStatuses.has(p.status));
      const bCollected = bPayments.reduce((acc, p) => acc + rupeesToPaise(p.amount), 0n);
      const bOutstanding = allSchedules
        .filter((s) => s.branchId === b.id && ['DUE', 'PARTIAL', 'OVERDUE'].includes(s.status))
        .reduce((acc, s) => acc + rupeesToPaise(s.outstandingAmount), 0n);
      const bCustomers = allCustomers.filter((c) => c.branchId === b.id).length;
      const bGroups = allGroups.filter((g) => g.branchId === b.id && g.status === 'ACTIVE').length;
      return {
        branchId: b.id,
        branchCode: b.branchCode,
        branchName: b.name,
        customers: bCustomers,
        activeGroups: bGroups,
        collectedRupees: Number(bCollected) / 100,
        collectedAmount: paiseToRupees(bCollected),
        outstandingRupees: Number(bOutstanding) / 100,
        outstandingAmount: paiseToRupees(bOutstanding),
      };
    });

    const customerMap = new Map(allCustomers.map((c) => [c.id, c]));
    const groupMap = new Map(allGroups.map((g) => [g.id, g]));

    const recentTransactions = allPayments.slice(0, 8).map((p) => ({
      ...p,
      customerName: customerMap.get(p.customerId)?.fullName ?? `Customer #${p.customerId}`,
      customerCode: customerMap.get(p.customerId)?.customerCode ?? '',
    }));

    const upcomingDues = allSchedules
      .filter((s) => ['OVERDUE', 'DUE', 'PARTIAL', 'UPCOMING'].includes(s.status))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 8)
      .map((s) => ({
        ...s,
        customerName: customerMap.get(s.customerId)?.fullName ?? `Customer #${s.customerId}`,
        groupName: groupMap.get(s.groupId)?.name ?? `Group #${s.groupId}`,
      }));

    const upcomingAuctions = allAuctions
      .filter((a) => ['SCHEDULED', 'OPEN', 'PENDING_APPROVAL'].includes(a.status))
      .map((a) => ({
        ...a,
        groupCode: groupMap.get(a.groupId)?.groupCode ?? '',
        groupName: groupMap.get(a.groupId)?.name ?? '',
      }));

    return res.json({
      data: {
        metrics: {
          totalCustomers: allCustomers.length,
          activeChitGroups: allGroups.filter((g) => g.status === 'ACTIVE').length,
          activeMemberships: allMemberships.filter((m) => ['ACTIVE', 'PRIZED'].includes(m.status)).length,
          todayCollections: paiseToRupees(todayCollectionsPaise),
          monthlyCollections: paiseToRupees(monthlyCollectionsPaise),
          totalOutstanding: paiseToRupees(totalOutstandingPaise),
          pendingApprovals: allApprovals.length,
          upcomingAuctionsCount: upcomingAuctions.length,
        },
        collectionTrends,
        branchPerformance,
        recentTransactions,
        upcomingDues,
        upcomingAuctions,
      },
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Unable to load dashboard metrics.');
  }
});

// ============================================================================
// 3. COMPANY, BRANCHES & EMPLOYEES
// ============================================================================

apiRouter.get('/company', requireAuth, async (_req, res) => {
  try {
    const [companyRows, branchRows] = await Promise.all([
      db.select().from(companies).limit(1),
      db.select().from(branches).orderBy(asc(branches.id)),
    ]);
    return res.json({ data: { company: companyRows[0] ?? null, branches: branchRows } });
  } catch (err) {
    console.error('Company fetch error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to load company profile.');
  }
});

const updateCompanySchema = z.object({
  legalName: z.string().min(2).max(160),
  tradeName: z.string().min(2).max(120),
  registrationNumber: z.string().max(80),
  gstin: z.string().max(25),
  address: z.string().min(3).max(240),
  phone: z.string().min(6).max(30),
  email: z.string().email(),
});

apiRouter.patch('/company', requireAuth, requirePermission('company:manage'), async (req: AuthRequest, res) => {
  const parsed = updateCompanySchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid company profile inputs.');
  try {
    const existing = await db.select().from(companies).limit(1);
    const updated = await db
      .update(companies)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(companies.id, existing[0]?.id ?? 1))
      .returning();
    await writeAuditLog({
      actor: req.user!,
      action: 'COMPANY_UPDATED',
      entityType: 'company',
      entityId: updated[0].id,
      before: existing[0],
      after: updated[0],
      ipAddress: req.ip ?? '',
    });
    return res.json({ data: updated[0] });
  } catch (err) {
    console.error('Company update error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to update company profile.');
  }
});

const createBranchSchema = z.object({
  branchCode: z.string().min(3).max(24),
  name: z.string().min(2).max(120),
  district: z.string().min(2).max(80),
  address: z.string().min(5).max(240),
  managerName: z.string().min(2).max(100),
  phone: z.string().min(6).max(30),
  openingCashBalance: z.string().regex(/^\d+(\.\d{1,2})?$/).default('0.00'),
});

apiRouter.post('/branches', requireAuth, requirePermission('branches:manage'), async (req: AuthRequest, res) => {
  const parsed = createBranchSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid branch details.');
  try {
    const [created] = await db
      .insert(branches)
      .values({
        companyId: 1,
        branchCode: parsed.data.branchCode.toUpperCase(),
        name: parsed.data.name,
        district: parsed.data.district,
        address: parsed.data.address,
        managerName: parsed.data.managerName,
        phone: parsed.data.phone,
        openingCashBalance: paiseToRupees(rupeesToPaise(parsed.data.openingCashBalance)),
      })
      .returning();
    await writeAuditLog({
      branchId: created.id,
      actor: req.user!,
      action: 'BRANCH_CREATED',
      entityType: 'branch',
      entityId: created.id,
      after: created,
      ipAddress: req.ip ?? '',
    });
    return res.status(201).json({ data: created });
  } catch (err) {
    console.error('Branch create error:', err);
    return sendError(res, 400, 'BRANCH_CREATE_FAILED', 'Branch code may already exist or inputs are invalid.');
  }
});

apiRouter.get('/employees', requireAuth, requirePermission('dashboard:read'), async (req: AuthRequest, res) => {
  try {
    const branchId = resolveScopedBranchId(req, req.query.branchId as string | undefined);
    const rows = branchId
      ? await db.select().from(employees).where(eq(employees.branchId, branchId)).orderBy(asc(employees.id))
      : await db.select().from(employees).orderBy(asc(employees.id));
    return res.json({ data: rows });
  } catch (err) {
    console.error('Employees fetch error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to fetch employees.');
  }
});

const createEmployeeSchema = z.object({
  branchId: z.coerce.number().int().positive(),
  employeeCode: z.string().min(3).max(30),
  fullName: z.string().min(2).max(120),
  jobRole: z.string().min(2).max(60),
  reportingManager: z.string().min(2).max(120),
  phone: z.string().min(6).max(30),
  email: z.string().email(),
  assignedZone: z.string().min(2).max(120),
});

apiRouter.post('/employees', requireAuth, requirePermission('employees:manage'), async (req: AuthRequest, res) => {
  const parsed = createEmployeeSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid employee data.');
  try {
    const [created] = await db
      .insert(employees)
      .values({ companyId: 1, ...parsed.data, employeeCode: parsed.data.employeeCode.toUpperCase() })
      .returning();
    await writeAuditLog({
      branchId: created.branchId,
      actor: req.user!,
      action: 'EMPLOYEE_CREATED',
      entityType: 'employee',
      entityId: created.id,
      after: created,
      ipAddress: req.ip ?? '',
    });
    return res.status(201).json({ data: created });
  } catch (err) {
    console.error('Employee create error:', err);
    return sendError(res, 400, 'EMPLOYEE_CREATE_FAILED', 'Employee code already exists or branch invalid.');
  }
});

// ============================================================================
// 4. CUSTOMERS & KYC (ZERO AADHAAR OTP/BIOMETRICS)
// ============================================================================

apiRouter.get('/customers', requireAuth, requirePermission('customers:read'), async (req: AuthRequest, res) => {
  try {
    const branchId = resolveScopedBranchId(req, req.query.branchId as string | undefined);
    const [custRows, kycRows] = await Promise.all([
      branchId
        ? db.select().from(customers).where(eq(customers.branchId, branchId)).orderBy(desc(customers.id))
        : db.select().from(customers).orderBy(desc(customers.id)),
      branchId
        ? db.select().from(kycDocuments).where(eq(kycDocuments.branchId, branchId))
        : db.select().from(kycDocuments),
    ]);

    const kycByCustomer = new Map<number, typeof kycRows>();
    for (const doc of kycRows) {
      const list = kycByCustomer.get(doc.customerId) ?? [];
      list.push(doc);
      kycByCustomer.set(doc.customerId, list);
    }

    const data = custRows.map((c) => ({
      ...c,
      kycDocuments: kycByCustomer.get(c.id) ?? [],
    }));
    return res.json({ data });
  } catch (err) {
    console.error('Customers fetch error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to load customers.');
  }
});

const createCustomerSchema = z.object({
  branchId: z.coerce.number().int().positive(),
  fullName: z.string().min(2).max(140),
  phone: z.string().min(8).max(20),
  email: z.string().email().or(z.literal('')).default(''),
  dob: z.string().max(20).default(''),
  panNumber: z.string().max(15).default(''),
  address: z.string().min(4).max(240),
  city: z.string().min(2).max(80),
  pincode: z.string().max(10).default(''),
  nomineeName: z.string().max(120).default(''),
  nomineeRelation: z.string().max(60).default(''),
});

apiRouter.post('/customers', requireAuth, requirePermission('customers:write'), async (req: AuthRequest, res) => {
  const parsed = createCustomerSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, 'VALIDATION_ERROR', 'Please fill all required customer fields.');
  try {
    const effectiveBranchId = resolveScopedBranchId(req, parsed.data.branchId) ?? parsed.data.branchId;

    // Duplicate detection on phone or PAN
    const dupPhone = await db.select().from(customers).where(eq(customers.phone, parsed.data.phone)).limit(1);
    if (dupPhone.length > 0) {
      return sendError(
        res,
        409,
        'DUPLICATE_CUSTOMER',
        `Duplicate customer detected: phone ${parsed.data.phone} already belongs to ${dupPhone[0].fullName} (${dupPhone[0].customerCode}).`
      );
    }

    const code = `CUST-TN-${Math.floor(1000 + Math.random() * 9000)}-${Date.now().toString().slice(-3)}`;

    const result = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(customers)
        .values({
          companyId: 1,
          branchId: effectiveBranchId,
          customerCode: code,
          fullName: parsed.data.fullName,
          phone: parsed.data.phone,
          email: parsed.data.email,
          dob: parsed.data.dob,
          panNumber: parsed.data.panNumber.toUpperCase(),
          address: parsed.data.address,
          city: parsed.data.city,
          state: 'Tamil Nadu',
          pincode: parsed.data.pincode,
          nomineeName: parsed.data.nomineeName,
          nomineeRelation: parsed.data.nomineeRelation,
          kycStatus: 'PENDING',
        })
        .returning();

      if (parsed.data.panNumber) {
        const pan = parsed.data.panNumber.toUpperCase();
        const masked = pan.length >= 6 ? `${pan.slice(0, 3)}****${pan.slice(-3)}` : pan;
        await tx.insert(kycDocuments).values({
          customerId: created.id,
          branchId: effectiveBranchId,
          documentType: 'PAN',
          documentNumberMasked: masked,
          verificationStatus: 'PENDING',
          notes: 'Submitted during registration',
        });
      }

      // Queue Maker-Checker KYC verification request
      await tx.insert(approvalRequests).values({
        companyId: 1,
        branchId: effectiveBranchId,
        requestType: 'KYC_VERIFICATION',
        entityType: 'customer',
        entityId: created.id,
        title: `Verify KYC — ${created.fullName} (${created.customerCode})`,
        summary: `New customer registered at branch #${effectiveBranchId}. KYC awaiting checker verification.`,
        amount: '0.00',
        payloadJson: JSON.stringify({ customerId: created.id }),
        status: 'PENDING',
        requestedByUserId: req.user!.id,
      });

      // Generate Customer Registration Acknowledgement document
      const docNum = `DOC-REG-${Date.now().toString().slice(-6)}`;
      await tx.insert(documents).values({
        companyId: 1,
        branchId: effectiveBranchId,
        documentNumber: docNum,
        documentType: 'CUSTOMER_REGISTRATION_ACK',
        version: 1,
        title: `Registration Acknowledgement — ${created.fullName}`,
        entityType: 'customer',
        entityId: created.id,
        customerId: created.id,
        contentSnapshotJson: JSON.stringify({ customerCode: created.customerCode, fullName: created.fullName, city: created.city }),
        generatedByUserId: req.user!.id,
      });

      return created;
    });

    await writeAuditLog({
      branchId: effectiveBranchId,
      actor: req.user!,
      action: 'CUSTOMER_REGISTERED',
      entityType: 'customer',
      entityId: result.id,
      after: result,
      ipAddress: req.ip ?? '',
    });

    return res.status(201).json({ data: result });
  } catch (err) {
    console.error('Customer create error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to register customer.');
  }
});

// Bulk CSV customer migration wizard endpoint
apiRouter.post('/import/customers', requireAuth, requirePermission('customers:write'), async (req: AuthRequest, res) => {
  const schema = z.object({
    branchId: z.coerce.number().int().positive(),
    dryRun: z.boolean().default(true),
    rows: z.array(
      z.object({
        fullName: z.string().min(2),
        phone: z.string().min(8),
        city: z.string().min(2),
        address: z.string().min(3),
        panNumber: z.string().optional().default(''),
      })
    ).min(1).max(200),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid CSV import payload.');

  try {
    const existingCustomers = await db.select({ phone: customers.phone }).from(customers);
    const phoneSet = new Set(existingCustomers.map((c) => c.phone));

    const validRows: typeof parsed.data.rows = [];
    const duplicates: { phone: string; fullName: string }[] = [];

    for (const r of parsed.data.rows) {
      if (phoneSet.has(r.phone)) {
        duplicates.push({ phone: r.phone, fullName: r.fullName });
      } else {
        phoneSet.add(r.phone);
        validRows.push(r);
      }
    }

    if (parsed.data.dryRun) {
      return res.json({
        data: { dryRun: true, totalRows: parsed.data.rows.length, validCount: validRows.length, duplicates },
      });
    }

    const effectiveBranchId = resolveScopedBranchId(req, parsed.data.branchId) ?? parsed.data.branchId;
    const insertedIds: number[] = [];
    await db.transaction(async (tx) => {
      for (let i = 0; i < validRows.length; i++) {
        const r = validRows[i];
        const [ins] = await tx
          .insert(customers)
          .values({
            companyId: 1,
            branchId: effectiveBranchId,
            customerCode: `CUST-IMP-${Date.now().toString().slice(-4)}-${i + 1}`,
            fullName: r.fullName,
            phone: r.phone,
            city: r.city,
            address: r.address,
            panNumber: r.panNumber.toUpperCase(),
            state: 'Tamil Nadu',
            kycStatus: 'PENDING',
          })
          .returning();
        insertedIds.push(ins.id);
      }
    });

    await writeAuditLog({
      branchId: effectiveBranchId,
      actor: req.user!,
      action: 'LEGACY_CSV_IMPORT',
      entityType: 'customer_batch',
      entityId: String(insertedIds.length),
      after: { importedCount: insertedIds.length, skippedDuplicates: duplicates.length },
      ipAddress: req.ip ?? '',
    });

    return res.status(201).json({
      data: { dryRun: false, importedCount: insertedIds.length, duplicates },
    });
  } catch (err) {
    console.error('CSV import error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Bulk import failed.');
  }
});

// ============================================================================
// 5. CHIT SCHEMES (VERSIONED) & CHIT GROUPS
// ============================================================================

apiRouter.get('/schemes', requireAuth, requirePermission('groups:read'), async (_req, res) => {
  try {
    const [schemeRows, versionRows] = await Promise.all([
      db.select().from(chitSchemes).orderBy(asc(chitSchemes.id)),
      db.select().from(schemeVersions).orderBy(desc(schemeVersions.versionNumber)),
    ]);
    const data = schemeRows.map((s) => ({
      ...s,
      versions: versionRows.filter((v) => v.schemeId === s.id),
    }));
    return res.json({ data });
  } catch (err) {
    console.error('Schemes fetch error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to load chit schemes.');
  }
});

const createSchemeSchema = z.object({
  schemeCode: z.string().min(3).max(32),
  name: z.string().min(3).max(140),
  description: z.string().max(300).default(''),
  chitValue: z.string().regex(/^\d+(\.\d{1,2})?$/),
  subscriberCount: z.coerce.number().int().min(5).max(100),
  durationMonths: z.coerce.number().int().min(5).max(100),
  maxDiscountPercent: z.string().regex(/^\d+(\.\d{1,2})?$/),
  foremanCommissionMethod: z.enum(['PERCENTAGE', 'FIXED']).default('PERCENTAGE'),
  foremanCommissionValue: z.string().regex(/^\d+(\.\d{1,2})?$/),
  gstRatePercent: z.string().regex(/^\d+(\.\d{1,2})?$/).default('0.00'),
  dueDayOfMonth: z.coerce.number().int().min(1).max(28).default(10),
  auctionMethod: z.enum(['OPEN_AUCTION', 'SEALED_BID', 'REVERSE_AUCTION']).default('OPEN_AUCTION'),
  dividendRoundingPolicy: z.enum(['FLOOR_RUPEE', 'NEAREST_RUPEE', 'EXACT_PAISE']).default('FLOOR_RUPEE'),
  statutoryReferenceNote: z.string().max(240).default('TBD_LEGAL — Pending verification'),
});

apiRouter.post('/schemes', requireAuth, requirePermission('schemes:manage'), async (req: AuthRequest, res) => {
  const parsed = createSchemeSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid scheme parameters.');
  try {
    const chitPaise = rupeesToPaise(parsed.data.chitValue);
    const baseInstallmentPaise = chitPaise / BigInt(parsed.data.durationMonths);

    const created = await db.transaction(async (tx) => {
      const [scheme] = await tx
        .insert(chitSchemes)
        .values({
          companyId: 1,
          schemeCode: parsed.data.schemeCode.toUpperCase(),
          name: parsed.data.name,
          description: parsed.data.description,
          status: 'APPROVED',
        })
        .returning();

      const [version] = await tx
        .insert(schemeVersions)
        .values({
          schemeId: scheme.id,
          versionNumber: 1,
          chitValue: paiseToRupees(chitPaise),
          subscriberCount: parsed.data.subscriberCount,
          durationMonths: parsed.data.durationMonths,
          monthlyInstallment: paiseToRupees(baseInstallmentPaise),
          maxDiscountPercent: parsed.data.maxDiscountPercent,
          foremanCommissionMethod: parsed.data.foremanCommissionMethod,
          foremanCommissionValue: parsed.data.foremanCommissionValue,
          gstRatePercent: parsed.data.gstRatePercent,
          dueDayOfMonth: parsed.data.dueDayOfMonth,
          auctionMethod: parsed.data.auctionMethod,
          dividendRoundingPolicy: parsed.data.dividendRoundingPolicy,
          formulaApprovalStatus: 'PENDING_LEGAL_ACCOUNTING',
          statutoryReferenceNote: parsed.data.statutoryReferenceNote,
          effectiveFrom: todayISO(),
        })
        .returning();

      return { ...scheme, versions: [version] };
    });

    await writeAuditLog({
      actor: req.user!,
      action: 'SCHEME_CREATED',
      entityType: 'chit_scheme',
      entityId: created.id,
      after: created,
      ipAddress: req.ip ?? '',
    });

    return res.status(201).json({ data: created });
  } catch (err) {
    console.error('Scheme create error:', err);
    return sendError(res, 400, 'SCHEME_CREATE_FAILED', 'Scheme code already exists or parameters invalid.');
  }
});

apiRouter.get('/groups', requireAuth, requirePermission('groups:read'), async (req: AuthRequest, res) => {
  try {
    const branchId = resolveScopedBranchId(req, req.query.branchId as string | undefined);
    const [groupRows, versionRows, schemeRows, branchRows, memberRows] = await Promise.all([
      branchId
        ? db.select().from(chitGroups).where(eq(chitGroups.branchId, branchId)).orderBy(desc(chitGroups.id))
        : db.select().from(chitGroups).orderBy(desc(chitGroups.id)),
      db.select().from(schemeVersions),
      db.select().from(chitSchemes),
      db.select().from(branches),
      db.select().from(memberships),
    ]);

    const versionMap = new Map(versionRows.map((v) => [v.id, v]));
    const schemeMap = new Map(schemeRows.map((s) => [s.id, s]));
    const branchMap = new Map(branchRows.map((b) => [b.id, b]));

    const data = groupRows.map((g) => {
      const sv = versionMap.get(g.schemeVersionId);
      const sc = sv ? schemeMap.get(sv.schemeId) : null;
      const activeCount = memberRows.filter((m) => m.groupId === g.id && ['ACTIVE', 'PRIZED'].includes(m.status)).length;
      return {
        ...g,
        branchName: branchMap.get(g.branchId)?.name ?? '',
        schemeName: sc?.name ?? '',
        chitValue: sv?.chitValue ?? '0.00',
        monthlyInstallment: sv?.monthlyInstallment ?? '0.00',
        durationMonths: sv?.durationMonths ?? 0,
        enrolledCount: activeCount,
      };
    });
    return res.json({ data });
  } catch (err) {
    console.error('Groups fetch error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to load chit groups.');
  }
});

const createGroupSchema = z.object({
  branchId: z.coerce.number().int().positive(),
  schemeVersionId: z.coerce.number().int().positive(),
  groupCode: z.string().min(3).max(32),
  name: z.string().min(3).max(140),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  psoNumber: z.string().max(60).default(''),
  registrationRef: z.string().max(60).default(''),
  commencementCertRef: z.string().max(60).default(''),
  foremanFdBank: z.string().max(120).default(''),
  foremanFdAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).default('0.00'),
  foremanFdMaturityDate: z.string().max(20).default(''),
});

apiRouter.post('/groups', requireAuth, requirePermission('groups:write'), async (req: AuthRequest, res) => {
  const parsed = createGroupSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid chit group fields.');
  try {
    const [sv] = await db.select().from(schemeVersions).where(eq(schemeVersions.id, parsed.data.schemeVersionId)).limit(1);
    if (!sv) return sendError(res, 404, 'SCHEME_NOT_FOUND', 'Selected scheme version does not exist.');

    const effectiveBranchId = resolveScopedBranchId(req, parsed.data.branchId) ?? parsed.data.branchId;
    const endDate = addMonthsISO(parsed.data.startDate, sv.durationMonths);

    const created = await db.transaction(async (tx) => {
      const [group] = await tx
        .insert(chitGroups)
        .values({
          companyId: 1,
          branchId: effectiveBranchId,
          schemeVersionId: sv.id,
          groupCode: parsed.data.groupCode.toUpperCase(),
          name: parsed.data.name,
          startDate: parsed.data.startDate,
          endDate,
          subscriberCapacity: sv.subscriberCount,
          currentInstallmentMonth: 1,
          status: 'PENDING_APPROVAL',
          psoNumber: parsed.data.psoNumber,
          registrationRef: parsed.data.registrationRef,
          commencementCertRef: parsed.data.commencementCertRef,
          foremanFdBank: parsed.data.foremanFdBank,
          foremanFdAmount: paiseToRupees(rupeesToPaise(parsed.data.foremanFdAmount)),
          foremanFdMaturityDate: parsed.data.foremanFdMaturityDate,
        })
        .returning();

      await tx.insert(approvalRequests).values({
        companyId: 1,
        branchId: effectiveBranchId,
        requestType: 'GROUP_ACTIVATION',
        entityType: 'chit_group',
        entityId: group.id,
        title: `Activate Group — ${group.name} (${group.groupCode})`,
        summary: `Capacity ${sv.subscriberCount} tickets × ₹${sv.monthlyInstallment}/mo. PSO: ${group.psoNumber || 'Pending'}.`,
        amount: sv.chitValue,
        payloadJson: JSON.stringify({ groupId: group.id, newStatus: 'ACTIVE' }),
        status: 'PENDING',
        requestedByUserId: req.user!.id,
      });

      return group;
    });

    await writeAuditLog({
      branchId: effectiveBranchId,
      actor: req.user!,
      action: 'GROUP_CREATED',
      entityType: 'chit_group',
      entityId: created.id,
      after: created,
      ipAddress: req.ip ?? '',
    });
    return res.status(201).json({ data: created });
  } catch (err) {
    console.error('Group create error:', err);
    return sendError(res, 400, 'GROUP_CREATE_FAILED', 'Group code may already exist.');
  }
});

// ============================================================================
// 6. MEMBERSHIPS & AUTO-GENERATED INSTALLMENT SCHEDULES
// ============================================================================

apiRouter.get('/memberships', requireAuth, requirePermission('customers:read'), async (req: AuthRequest, res) => {
  try {
    const branchId = resolveScopedBranchId(req, req.query.branchId as string | undefined);
    const [mRows, cRows, gRows, sRows] = await Promise.all([
      branchId
        ? db.select().from(memberships).where(eq(memberships.branchId, branchId)).orderBy(desc(memberships.id))
        : db.select().from(memberships).orderBy(desc(memberships.id)),
      db.select().from(customers),
      db.select().from(chitGroups),
      db.select().from(installmentSchedules),
    ]);
    const cMap = new Map(cRows.map((c) => [c.id, c]));
    const gMap = new Map(gRows.map((g) => [g.id, g]));

    const data = mRows.map((m) => {
      const mSchedules = sRows.filter((s) => s.membershipId === m.id);
      const totalOutstandingPaise = mSchedules
        .filter((s) => ['DUE', 'PARTIAL', 'OVERDUE'].includes(s.status))
        .reduce((acc, s) => acc + rupeesToPaise(s.outstandingAmount), 0n);
      return {
        ...m,
        customerName: cMap.get(m.customerId)?.fullName ?? '',
        customerCode: cMap.get(m.customerId)?.customerCode ?? '',
        customerKycStatus: cMap.get(m.customerId)?.kycStatus ?? 'PENDING',
        groupCode: gMap.get(m.groupId)?.groupCode ?? '',
        groupName: gMap.get(m.groupId)?.name ?? '',
        totalOutstanding: paiseToRupees(totalOutstandingPaise),
        scheduleCount: mSchedules.length,
      };
    });
    return res.json({ data });
  } catch (err) {
    console.error('Memberships fetch error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to load enrollments.');
  }
});

const enrollMemberSchema = z.object({
  groupId: z.coerce.number().int().positive(),
  customerId: z.coerce.number().int().positive(),
  ticketNumber: z.coerce.number().int().min(1).max(200),
  nomineeName: z.string().max(120).default(''),
  agreementAccepted: z.boolean().refine((v) => v === true, 'Agreement acceptance is required.'),
});

apiRouter.post('/memberships', requireAuth, requirePermission('enrollments:write'), async (req: AuthRequest, res) => {
  const parsed = enrollMemberSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid enrollment details.');
  try {
    const [group] = await db.select().from(chitGroups).where(eq(chitGroups.id, parsed.data.groupId)).limit(1);
    if (!group) return sendError(res, 404, 'GROUP_NOT_FOUND', 'Chit group not found.');
    const [sv] = await db.select().from(schemeVersions).where(eq(schemeVersions.id, group.schemeVersionId)).limit(1);
    const [cust] = await db.select().from(customers).where(eq(customers.id, parsed.data.customerId)).limit(1);
    if (!cust || !sv) return sendError(res, 404, 'NOT_FOUND', 'Customer or scheme not found.');

    if (parsed.data.ticketNumber > group.subscriberCapacity) {
      return sendError(res, 400, 'TICKET_EXCEEDS_CAPACITY', `Ticket number cannot exceed group capacity (${group.subscriberCapacity}).`);
    }

    // Prevent duplicate active ticket enrollment
    const existingTicket = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.groupId, group.id),
          eq(memberships.ticketNumber, parsed.data.ticketNumber),
          inArray(memberships.status, ['ACTIVE', 'PRIZED', 'PENDING_APPROVAL'])
        )
      )
      .limit(1);
    if (existingTicket.length > 0) {
      return sendError(res, 409, 'DUPLICATE_TICKET', `Ticket #${parsed.data.ticketNumber} is already assigned in ${group.groupCode}.`);
    }

    const created = await db.transaction(async (tx) => {
      const [m] = await tx
        .insert(memberships)
        .values({
          groupId: group.id,
          customerId: cust.id,
          branchId: group.branchId,
          ticketNumber: parsed.data.ticketNumber,
          enrollmentDate: todayISO(),
          status: 'ACTIVE',
          nomineeName: parsed.data.nomineeName || cust.nomineeName,
          agreementAccepted: true,
          approvedByUserId: req.user!.id,
        })
        .returning();

      // Auto-generate installment schedule (first 6 upcoming/current installments or full duration up to 24)
      const countToGenerate = Math.min(sv.durationMonths, 12);
      const scheduleValues = [];
      for (let i = 1; i <= countToGenerate; i++) {
        const dueDate = addMonthsISO(group.startDate, i - 1);
        scheduleValues.push({
          membershipId: m.id,
          groupId: group.id,
          customerId: cust.id,
          branchId: group.branchId,
          installmentNumber: i,
          dueDate,
          baseInstallment: sv.monthlyInstallment,
          dividendAdjustment: '0.00',
          lateFee: '0.00',
          amountDue: sv.monthlyInstallment,
          amountPaid: '0.00',
          outstandingAmount: sv.monthlyInstallment,
          status: i <= group.currentInstallmentMonth ? 'DUE' : 'UPCOMING',
        });
      }
      await tx.insert(installmentSchedules).values(scheduleValues);

      // Generate Chit Agreement document
      await tx.insert(documents).values({
        companyId: 1,
        branchId: group.branchId,
        documentNumber: `DOC-AGR-${group.groupCode}-T${m.ticketNumber}-${Date.now().toString().slice(-4)}`,
        documentType: 'CHIT_AGREEMENT',
        version: 1,
        title: `Chit Agreement — ${cust.fullName} (${group.groupCode} #${m.ticketNumber})`,
        entityType: 'membership',
        entityId: m.id,
        customerId: cust.id,
        contentSnapshotJson: JSON.stringify({ groupCode: group.groupCode, ticketNumber: m.ticketNumber, chitValue: sv.chitValue, installment: sv.monthlyInstallment }),
        generatedByUserId: req.user!.id,
      });

      return m;
    });

    await writeAuditLog({
      branchId: group.branchId,
      actor: req.user!,
      action: 'MEMBER_ENROLLED',
      entityType: 'membership',
      entityId: created.id,
      after: created,
      ipAddress: req.ip ?? '',
    });

    return res.status(201).json({ data: created });
  } catch (err) {
    console.error('Enrollment error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to enroll member.');
  }
});

// ============================================================================
// 7. INSTALLMENTS & ATOMIC IDEMPOTENT PAYMENT COLLECTION + DOUBLE-ENTRY GL
// ============================================================================

apiRouter.get('/installments', requireAuth, requirePermission('customers:read'), async (req: AuthRequest, res) => {
  try {
    const branchId = resolveScopedBranchId(req, req.query.branchId as string | undefined);
    const membershipIdFilter = req.query.membershipId ? Number(req.query.membershipId) : null;

    let schedRows = branchId
      ? await db.select().from(installmentSchedules).where(eq(installmentSchedules.branchId, branchId)).orderBy(asc(installmentSchedules.dueDate))
      : await db.select().from(installmentSchedules).orderBy(asc(installmentSchedules.dueDate));

    if (membershipIdFilter) {
      schedRows = schedRows.filter((s) => s.membershipId === membershipIdFilter);
    }

    const [cRows, gRows, mRows] = await Promise.all([
      db.select().from(customers),
      db.select().from(chitGroups),
      db.select().from(memberships),
    ]);
    const cMap = new Map(cRows.map((c) => [c.id, c]));
    const gMap = new Map(gRows.map((g) => [g.id, g]));
    const mMap = new Map(mRows.map((m) => [m.id, m]));

    const data = schedRows.map((s) => ({
      ...s,
      customerName: cMap.get(s.customerId)?.fullName ?? '',
      customerCode: cMap.get(s.customerId)?.customerCode ?? '',
      groupCode: gMap.get(s.groupId)?.groupCode ?? '',
      ticketNumber: mMap.get(s.membershipId)?.ticketNumber ?? 0,
    }));
    return res.json({ data });
  } catch (err) {
    console.error('Installments fetch error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to load installment schedules.');
  }
});

apiRouter.get('/payments', requireAuth, requirePermission('customers:read'), async (req: AuthRequest, res) => {
  try {
    const branchId = resolveScopedBranchId(req, req.query.branchId as string | undefined);
    const [payRows, cRows, mRows, gRows] = await Promise.all([
      branchId
        ? db.select().from(payments).where(eq(payments.branchId, branchId)).orderBy(desc(payments.createdAt))
        : db.select().from(payments).orderBy(desc(payments.createdAt)),
      db.select().from(customers),
      db.select().from(memberships),
      db.select().from(chitGroups),
    ]);
    const cMap = new Map(cRows.map((c) => [c.id, c]));
    const mMap = new Map(mRows.map((m) => [m.id, m]));
    const gMap = new Map(gRows.map((g) => [g.id, g]));

    const data = payRows.map((p) => {
      const m = mMap.get(p.membershipId);
      return {
        ...p,
        customerName: cMap.get(p.customerId)?.fullName ?? '',
        customerCode: cMap.get(p.customerId)?.customerCode ?? '',
        ticketNumber: m?.ticketNumber ?? 0,
        groupCode: m ? gMap.get(m.groupId)?.groupCode ?? '' : '',
      };
    });
    return res.json({ data });
  } catch (err) {
    console.error('Payments fetch error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to load payment history.');
  }
});

const collectPaymentSchema = z.object({
  membershipId: z.coerce.number().int().positive(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  paymentMode: z.enum(['CASH', 'UPI', 'NEFT', 'RTGS', 'IMPS', 'BANK_TRANSFER', 'CHEQUE', 'GATEWAY']),
  referenceNumber: z.string().max(80).default(''),
  remarks: z.string().max(240).default(''),
});

apiRouter.post('/payments', requireAuth, requirePermission('payments:collect'), async (req: AuthRequest, res) => {
  const idempotencyKey = String(req.headers['idempotency-key'] ?? req.body?.idempotencyKey ?? '').trim();
  if (!idempotencyKey || idempotencyKey.length < 8) {
    return sendError(res, 400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is mandatory to prevent duplicate payment processing.');
  }

  const parsed = collectPaymentSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid payment inputs.');

  const paymentPaise = rupeesToPaise(parsed.data.amount);
  if (paymentPaise <= 0n) {
    return sendError(res, 400, 'INVALID_AMOUNT', 'Payment amount must be greater than ₹0.00.');
  }

  // Payment gateway mode cannot be marked successful via frontend redirect
  if (parsed.data.paymentMode === 'GATEWAY' && !process.env.PAYMENT_GATEWAY_PROVIDER) {
    return sendError(
      res,
      503,
      'GATEWAY_UNCONFIGURED',
      'Online Payment Gateway adapter is not configured. Configure PAYMENT_GATEWAY_PROVIDER and webhook secrets in environment settings.'
    );
  }

  try {
    // Idempotency replay check: return original receipt safely without double charging
    const existingByKey = await db
      .select()
      .from(payments)
      .where(eq(payments.idempotencyKey, idempotencyKey))
      .limit(1);
    if (existingByKey.length > 0) {
      return res.json({ data: { payment: existingByKey[0], idempotentReplay: true } });
    }

    const [member] = await db.select().from(memberships).where(eq(memberships.id, parsed.data.membershipId)).limit(1);
    if (!member) return sendError(res, 404, 'MEMBERSHIP_NOT_FOUND', 'Membership ticket not found.');

    const scopedBranch = resolveScopedBranchId(req, null);
    if (scopedBranch !== null && member.branchId !== scopedBranch) {
      return sendError(res, 403, 'BRANCH_ISOLATION_VIOLATION', 'You cannot collect payments for another branch.');
    }

    const [customer] = await db.select().from(customers).where(eq(customers.id, member.customerId)).limit(1);
    const payDate = todayISO();
    const receiptNum = `RCP-${payDate.slice(0, 4)}-${Date.now().toString().slice(-6)}`;
    const status = parsed.data.paymentMode === 'CHEQUE' ? 'UNDER_VERIFICATION' : 'SUCCESSFUL';

    const result = await db.transaction(async (tx) => {
      // Load open installment schedules for this membership
      const schedules = await tx
        .select()
        .from(installmentSchedules)
        .where(eq(installmentSchedules.membershipId, member.id))
        .orderBy(asc(installmentSchedules.installmentNumber));

      const obligations = schedules.map((s) => ({
        id: s.id,
        installmentNumber: s.installmentNumber,
        amountDuePaise: rupeesToPaise(s.amountDue),
        amountPaidPaise: rupeesToPaise(s.amountPaid),
        outstandingPaise: rupeesToPaise(s.outstandingAmount),
      }));

      const allocationPlan = allocatePaymentAcrossInstallments(paymentPaise, obligations);

      const [payment] = await tx
        .insert(payments)
        .values({
          companyId: 1,
          branchId: member.branchId,
          customerId: member.customerId,
          membershipId: member.id,
          receiptNumber: receiptNum,
          idempotencyKey,
          paymentDate: payDate,
          amount: paiseToRupees(paymentPaise),
          paymentMode: parsed.data.paymentMode,
          referenceNumber: parsed.data.referenceNumber || receiptNum,
          status,
          collectedByUserId: req.user!.id,
          remarks: parsed.data.remarks,
        })
        .returning();

      // Persist allocations and update schedule balances atomically
      for (const alloc of allocationPlan.allocations) {
        await tx.insert(paymentAllocations).values({
          paymentId: payment.id,
          installmentScheduleId: alloc.installmentId,
          allocatedAmount: paiseToRupees(alloc.allocatedPaise),
        });
        await tx
          .update(installmentSchedules)
          .set({
            amountPaid: paiseToRupees(alloc.newAmountPaidPaise),
            outstandingAmount: paiseToRupees(alloc.newOutstandingPaise),
            status: alloc.newStatus,
            updatedAt: new Date(),
          })
          .where(eq(installmentSchedules.id, alloc.installmentId));
      }

      // Auto-post immutable Double-Entry Accounting Journal (Debits === Credits)
      const coaRows = await tx.select().from(chartOfAccounts);
      const cashAcc = coaRows.find((a) => a.accountCode === '1010');
      const bankAcc = coaRows.find((a) => a.accountCode === '1020');
      const poolAcc = coaRows.find((a) => a.accountCode === '2010');
      const advAcc = coaRows.find((a) => a.accountCode === '2030');
      const openPeriods = await tx.select().from(accountingPeriods).where(eq(accountingPeriods.status, 'OPEN')).limit(1);

      const debitAccount = parsed.data.paymentMode === 'CASH' ? cashAcc : bankAcc;
      if (debitAccount && poolAcc) {
        const lines: { accountId: number; debitPaise: bigint; creditPaise: bigint; narration: string }[] = [
          {
            accountId: debitAccount.id,
            debitPaise: paymentPaise,
            creditPaise: 0n,
            narration: `${parsed.data.paymentMode} collection — ${receiptNum}`,
          },
        ];
        if (allocationPlan.totalAllocatedPaise > 0n) {
          lines.push({
            accountId: poolAcc.id,
            debitPaise: 0n,
            creditPaise: allocationPlan.totalAllocatedPaise,
            narration: `Installment subscription credit — ${customer?.fullName ?? ''}`,
          });
        }
        if (allocationPlan.excessAdvancePaise > 0n && advAcc) {
          lines.push({
            accountId: advAcc.id,
            debitPaise: 0n,
            creditPaise: allocationPlan.excessAdvancePaise,
            narration: `Excess advance receipt — ${customer?.fullName ?? ''}`,
          });
        }
        const check = validateJournalBalance(lines);
        if (!check.valid) {
          throw new Error(check.error ?? 'Accounting invariant violation');
        }

        const [jv] = await tx
          .insert(journalEntries)
          .values({
            companyId: 1,
            branchId: member.branchId,
            periodId: openPeriods[0]?.id ?? null,
            entryNumber: `JV-${payDate.slice(0, 4)}-${Date.now().toString().slice(-6)}`,
            entryDate: payDate,
            description: `Receipt ${receiptNum} (${parsed.data.paymentMode}) — ${customer?.fullName ?? ''}`,
            referenceType: 'PAYMENT',
            referenceId: payment.id,
            totalDebit: paiseToRupees(check.totalDebitPaise),
            totalCredit: paiseToRupees(check.totalCreditPaise),
            status: 'POSTED',
            createdByUserId: req.user!.id,
            approvedByUserId: req.user!.id,
          })
          .returning();

        await tx.insert(journalLines).values(
          lines.map((l) => ({
            journalEntryId: jv.id,
            accountId: l.accountId,
            debit: paiseToRupees(l.debitPaise),
            credit: paiseToRupees(l.creditPaise),
            narration: l.narration,
          }))
        );
      }

      // Update open Branch Cash Register if Cash payment
      if (parsed.data.paymentMode === 'CASH') {
        const regRows = await tx
          .select()
          .from(branchCashRegisters)
          .where(and(eq(branchCashRegisters.branchId, member.branchId), eq(branchCashRegisters.status, 'OPEN')))
          .limit(1);
        if (regRows.length > 0) {
          const r = regRows[0];
          const newColl = rupeesToPaise(r.cashCollections) + paymentPaise;
          const newClosing = rupeesToPaise(r.closingBalance) + paymentPaise;
          await tx
            .update(branchCashRegisters)
            .set({
              cashCollections: paiseToRupees(newColl),
              closingBalance: paiseToRupees(newClosing),
            })
            .where(eq(branchCashRegisters.id, r.id));
        }
      }

      // Generate Printable Receipt Document
      await tx.insert(documents).values({
        companyId: 1,
        branchId: member.branchId,
        documentNumber: `DOC-${receiptNum}`,
        documentType: 'PAYMENT_RECEIPT',
        version: 1,
        title: `Payment Receipt ${receiptNum} — ${customer?.fullName ?? ''}`,
        entityType: 'payment',
        entityId: payment.id,
        customerId: member.customerId,
        contentSnapshotJson: JSON.stringify({
          receiptNumber: receiptNum,
          customerName: customer?.fullName ?? '',
          customerCode: customer?.customerCode ?? '',
          ticketNumber: member.ticketNumber,
          amount: paiseToRupees(paymentPaise),
          mode: parsed.data.paymentMode,
          date: payDate,
          allocations: allocationPlan.allocations.map((a) => ({
            installmentNumber: a.installmentNumber,
            allocated: paiseToRupees(a.allocatedPaise),
          })),
          excessAdvance: paiseToRupees(allocationPlan.excessAdvancePaise),
        }),
        generatedByUserId: req.user!.id,
      });

      return { payment, allocationPlan };
    });

    await writeAuditLog({
      branchId: member.branchId,
      actor: req.user!,
      action: 'PAYMENT_COLLECTED',
      entityType: 'payment',
      entityId: result.payment.id,
      after: {
        receiptNumber: result.payment.receiptNumber,
        amount: result.payment.amount,
        mode: result.payment.paymentMode,
        excessAdvance: paiseToRupees(result.allocationPlan.excessAdvancePaise),
      },
      ipAddress: req.ip ?? '',
    });

    return res.status(201).json({
      data: {
        payment: result.payment,
        allocations: result.allocationPlan.allocations.map((a) => ({
          installmentNumber: a.installmentNumber,
          allocated: paiseToRupees(a.allocatedPaise),
          status: a.newStatus,
        })),
        excessAdvance: paiseToRupees(result.allocationPlan.excessAdvancePaise),
      },
    });
  } catch (err) {
    console.error('Payment collection error:', err);
    return sendError(res, 500, 'PAYMENT_FAILED', 'Payment could not be processed. Database transaction rolled back safely.');
  }
});

// Request reversal for a posted payment (never deletes; goes through Maker-Checker)
apiRouter.post('/payments/:id/reverse-request', requireAuth, requirePermission('payments:collect'), async (req: AuthRequest, res) => {
  const paymentId = Number(req.params.id);
  const reason = String(req.body?.reason ?? 'Operator correction request').trim();
  try {
    const [p] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
    if (!p) return sendError(res, 404, 'NOT_FOUND', 'Payment not found.');
    const scopedBranch = resolveScopedBranchId(req, null);
    if (scopedBranch !== null && p.branchId !== scopedBranch) {
      return sendError(res, 403, 'BRANCH_ISOLATION_VIOLATION', 'You cannot request reversal for another branch.');
    }
    if (p.status === 'REVERSED') return sendError(res, 400, 'ALREADY_REVERSED', 'Payment is already reversed.');

    const [reqRow] = await db
      .insert(approvalRequests)
      .values({
        companyId: 1,
        branchId: p.branchId,
        requestType: 'PAYMENT_REVERSAL',
        entityType: 'payment',
        entityId: p.id,
        title: `Reverse Receipt ${p.receiptNumber} (₹${p.amount})`,
        summary: `Reversal requested for ${p.paymentMode} payment. Reason: ${reason}`,
        amount: p.amount,
        payloadJson: JSON.stringify({ paymentId: p.id, reason }),
        status: 'PENDING',
        requestedByUserId: req.user!.id,
      })
      .returning();

    await writeAuditLog({
      branchId: p.branchId,
      actor: req.user!,
      action: 'PAYMENT_REVERSAL_REQUESTED',
      entityType: 'payment',
      entityId: p.id,
      after: { approvalRequestId: reqRow.id, reason },
      ipAddress: req.ip ?? '',
    });

    return res.status(201).json({ data: reqRow });
  } catch (err) {
    console.error('Reversal request error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to create payment reversal request.');
  }
});

// Verified payment webhook boundary (never accepts unverified callbacks)
apiRouter.post('/webhooks/payments/:provider', async (req, res) => {
  const secret = process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET;
  if (!secret) {
    return sendError(
      res,
      503,
      'WEBHOOK_UNCONFIGURED',
      'Payment webhook secret is not configured in server environment.'
    );
  }
  const signature = String(req.headers['x-webhook-signature'] ?? '');
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
  if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return sendError(res, 401, 'INVALID_WEBHOOK_SIGNATURE', 'Webhook signature verification failed.');
  }
  return res.json({ data: { verified: true, provider: req.params.provider } });
});

// ============================================================================
// 8. AUCTIONS, IMMUTABLE BIDS, CALCULATION ENGINE, DIVIDENDS & PRIZE PAYOUTS
// ============================================================================

apiRouter.get('/auctions', requireAuth, requirePermission('groups:read'), async (req: AuthRequest, res) => {
  try {
    const branchId = resolveScopedBranchId(req, req.query.branchId as string | undefined);
    const [aucRows, bidRows, groupRows, custRows, membRows, svRows] = await Promise.all([
      branchId
        ? db.select().from(auctions).where(eq(auctions.branchId, branchId)).orderBy(desc(auctions.id))
        : db.select().from(auctions).orderBy(desc(auctions.id)),
      db.select().from(bids).orderBy(desc(bids.placedAt)),
      db.select().from(chitGroups),
      db.select().from(customers),
      db.select().from(memberships),
      db.select().from(schemeVersions),
    ]);

    const groupMap = new Map(groupRows.map((g) => [g.id, g]));
    const custMap = new Map(custRows.map((c) => [c.id, c]));
    const membMap = new Map(membRows.map((m) => [m.id, m]));
    const svMap = new Map(svRows.map((s) => [s.id, s]));

    const data = aucRows.map((a) => {
      const g = groupMap.get(a.groupId);
      const sv = g ? svMap.get(g.schemeVersionId) : null;
      const auctionBids = bidRows
        .filter((b) => b.auctionId === a.id)
        .map((b) => ({
          ...b,
          customerName: custMap.get(b.customerId)?.fullName ?? '',
          ticketNumber: membMap.get(b.membershipId)?.ticketNumber ?? 0,
        }));
      const winnerMemb = a.winningMembershipId ? membMap.get(a.winningMembershipId) : null;
      return {
        ...a,
        groupCode: g?.groupCode ?? '',
        groupName: g?.name ?? '',
        chitValue: sv?.chitValue ?? '0.00',
        maxDiscountPercent: sv?.maxDiscountPercent ?? '40.00',
        subscriberCount: sv?.subscriberCount ?? 20,
        formulaApprovalStatus: sv?.formulaApprovalStatus ?? 'PENDING_LEGAL_ACCOUNTING',
        winnerName: winnerMemb ? custMap.get(winnerMemb.customerId)?.fullName ?? '' : '',
        winnerTicket: winnerMemb?.ticketNumber ?? null,
        bids: auctionBids,
      };
    });

    return res.json({ data });
  } catch (err) {
    console.error('Auctions fetch error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to load auctions.');
  }
});

const placeBidSchema = z.object({
  membershipId: z.coerce.number().int().positive(),
  bidAmountDiscount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  isProxyBid: z.boolean().default(false),
});

apiRouter.post('/auctions/:id/bids', requireAuth, requirePermission('auctions:conduct'), async (req: AuthRequest, res) => {
  const auctionId = Number(req.params.id);
  const parsed = placeBidSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid bid input.');

  try {
    const [auc] = await db.select().from(auctions).where(eq(auctions.id, auctionId)).limit(1);
    if (!auc) return sendError(res, 404, 'NOT_FOUND', 'Auction not found.');
    if (!['OPEN', 'SCHEDULED'].includes(auc.status)) {
      return sendError(res, 400, 'AUCTION_CLOSED', 'Bids cannot be added to a closed or approved auction.');
    }

    const [memb] = await db.select().from(memberships).where(eq(memberships.id, parsed.data.membershipId)).limit(1);
    if (!memb || memb.groupId !== auc.groupId) {
      return sendError(res, 400, 'INVALID_BIDDER', 'Selected ticket does not belong to this chit group.');
    }
    if (memb.isPrized) {
      return sendError(res, 400, 'ALREADY_PRIZED', 'Prized subscribers are not eligible to bid again.');
    }

    const [group] = await db.select().from(chitGroups).where(eq(chitGroups.id, auc.groupId)).limit(1);
    const [sv] = await db.select().from(schemeVersions).where(eq(schemeVersions.id, group.schemeVersionId)).limit(1);

    const discountPaise = rupeesToPaise(parsed.data.bidAmountDiscount);
    const maxAllowedPaise = (rupeesToPaise(sv.chitValue) * BigInt(Math.round(Number(sv.maxDiscountPercent) * 100))) / 10000n;
    if (discountPaise > maxAllowedPaise) {
      return sendError(res, 400, 'EXCEEDS_MAX_DISCOUNT', `Bid discount exceeds scheme cap (${sv.maxDiscountPercent}%).`);
    }

    const prevBids = await db
      .select()
      .from(bids)
      .where(and(eq(bids.auctionId, auctionId), eq(bids.membershipId, memb.id)));

    const [createdBid] = await db
      .insert(bids)
      .values({
        auctionId,
        membershipId: memb.id,
        customerId: memb.customerId,
        bidAmountDiscount: paiseToRupees(discountPaise),
        isProxyBid: parsed.data.isProxyBid,
        bidRevision: prevBids.length + 1,
        placedByUserId: req.user!.id,
      })
      .returning();

    await writeAuditLog({
      branchId: auc.branchId,
      actor: req.user!,
      action: 'AUCTION_BID_RECORDED',
      entityType: 'bid',
      entityId: createdBid.id,
      after: createdBid,
      ipAddress: req.ip ?? '',
    });

    return res.status(201).json({ data: createdBid });
  } catch (err) {
    console.error('Bid placement error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to record bid.');
  }
});

const calculateAuctionSchema = z.object({
  winningMembershipId: z.coerce.number().int().positive(),
  winningBidDiscount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  minutesText: z.string().max(1000).default(''),
});

apiRouter.post('/auctions/:id/calculate', requireAuth, requirePermission('auctions:conduct'), async (req: AuthRequest, res) => {
  const auctionId = Number(req.params.id);
  const parsed = calculateAuctionSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid auction calculation parameters.');

  try {
    const [auc] = await db.select().from(auctions).where(eq(auctions.id, auctionId)).limit(1);
    if (!auc) return sendError(res, 404, 'NOT_FOUND', 'Auction not found.');
    const [group] = await db.select().from(chitGroups).where(eq(chitGroups.id, auc.groupId)).limit(1);
    const [sv] = await db.select().from(schemeVersions).where(eq(schemeVersions.id, group.schemeVersionId)).limit(1);

    const commissionValueBig =
      sv.foremanCommissionMethod === 'PERCENTAGE'
        ? BigInt(Math.round(Number(sv.foremanCommissionValue) * 100))
        : rupeesToPaise(sv.foremanCommissionValue);

    const snapshot = calculateAuctionSnapshot({
      chitValuePaise: rupeesToPaise(sv.chitValue),
      winningBidDiscountPaise: rupeesToPaise(parsed.data.winningBidDiscount),
      subscriberCount: sv.subscriberCount,
      maxDiscountPercentBps: Math.round(Number(sv.maxDiscountPercent) * 100),
      commissionMethod: sv.foremanCommissionMethod as CommissionMethod,
      commissionValue: commissionValueBig,
      gstRateBps: Math.round(Number(sv.gstRatePercent) * 100),
      roundingPolicy: sv.dividendRoundingPolicy as RoundingPolicy,
      schemeVersionId: sv.id,
      formulaApprovalStatus: sv.formulaApprovalStatus,
    });

    const snapshotSerializable = {
      schemeVersionId: snapshot.schemeVersionId,
      formulaApprovalStatus: snapshot.formulaApprovalStatus,
      chitValue: paiseToRupees(snapshot.chitValuePaise),
      winningDiscount: paiseToRupees(snapshot.winningBidDiscountPaise),
      foremanCommission: paiseToRupees(snapshot.foremanCommissionPaise),
      gstOnCommission: paiseToRupees(snapshot.gstOnCommissionPaise),
      netPrize: paiseToRupees(snapshot.netPrizePayableBeforeDeductionsPaise),
      distributablePool: paiseToRupees(snapshot.distributableDividendPoolPaise),
      perMemberDividend: paiseToRupees(snapshot.perMemberDividendPaise),
      totalDistributedDividend: paiseToRupees(snapshot.totalDistributedDividendPaise),
      roundingResidue: paiseToRupees(snapshot.roundingResiduePaise),
      roundingPolicy: snapshot.roundingPolicy,
      balancedInvariantVerified: snapshot.balancedInvariantVerified,
      calculatedAt: new Date().toISOString(),
    };

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(auctions)
        .set({
          status: 'PENDING_APPROVAL',
          winningMembershipId: parsed.data.winningMembershipId,
          winningBidDiscount: snapshotSerializable.winningDiscount,
          foremanCommissionAmount: snapshotSerializable.foremanCommission,
          gstAmount: snapshotSerializable.gstOnCommission,
          netPrizeAmount: snapshotSerializable.netPrize,
          distributableDividend: snapshotSerializable.distributablePool,
          perMemberDividend: snapshotSerializable.perMemberDividend,
          roundingResidue: snapshotSerializable.roundingResidue,
          calculationSnapshotJson: JSON.stringify(snapshotSerializable),
          minutesText: parsed.data.minutesText || auc.minutesText,
          conductedByUserId: req.user!.id,
        })
        .where(eq(auctions.id, auctionId))
        .returning();

      await tx.insert(approvalRequests).values({
        companyId: 1,
        branchId: auc.branchId,
        requestType: 'AUCTION_APPROVAL',
        entityType: 'auction',
        entityId: auc.id,
        title: `Approve Auction #${auc.installmentNumber} — ${group.groupCode}`,
        summary: `Discount ₹${snapshotSerializable.winningDiscount} | Net Prize ₹${snapshotSerializable.netPrize} | Dividend ₹${snapshotSerializable.perMemberDividend}/member`,
        amount: snapshotSerializable.netPrize,
        payloadJson: JSON.stringify({ auctionId: auc.id }),
        status: 'PENDING',
        requestedByUserId: req.user!.id,
      });

      return row;
    });

    await writeAuditLog({
      branchId: auc.branchId,
      actor: req.user!,
      action: 'AUCTION_CALCULATED_SUBMITTED',
      entityType: 'auction',
      entityId: auc.id,
      after: snapshotSerializable,
      ipAddress: req.ip ?? '',
    });

    return res.json({ data: { auction: updated, snapshot: snapshotSerializable } });
  } catch (err: any) {
    console.error('Auction calculate error:', err);
    return sendError(res, 400, 'CALCULATION_ERROR', err.message || 'Auction calculation failed.');
  }
});

apiRouter.get('/dividends', requireAuth, requirePermission('groups:read'), async (req: AuthRequest, res) => {
  try {
    const branchId = resolveScopedBranchId(req, req.query.branchId as string | undefined);
    const [divRows, custRows, membRows, aucRows, groupRows] = await Promise.all([
      db.select().from(dividendAllocations).orderBy(desc(dividendAllocations.id)),
      db.select().from(customers),
      db.select().from(memberships),
      db.select().from(auctions),
      db.select().from(chitGroups),
    ]);
    const cMap = new Map(custRows.map((c) => [c.id, c]));
    const mMap = new Map(membRows.map((m) => [m.id, m]));
    const aMap = new Map(aucRows.map((a) => [a.id, a]));
    const gMap = new Map(groupRows.map((g) => [g.id, g]));

    const data = divRows
      .filter((d) => {
        if (!branchId) return true;
        const a = aMap.get(d.auctionId);
        return a?.branchId === branchId;
      })
      .map((d) => {
        const a = aMap.get(d.auctionId);
        return {
          ...d,
          customerName: cMap.get(d.customerId)?.fullName ?? '',
          ticketNumber: mMap.get(d.membershipId)?.ticketNumber ?? 0,
          groupCode: a ? gMap.get(a.groupId)?.groupCode ?? '' : '',
        };
      });
    return res.json({ data });
  } catch (err) {
    console.error('Dividends fetch error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to load dividends.');
  }
});

apiRouter.get('/prize-payouts', requireAuth, requirePermission('groups:read'), async (req: AuthRequest, res) => {
  try {
    const branchId = resolveScopedBranchId(req, req.query.branchId as string | undefined);
    const [rows, custRows, membRows, aucRows, groupRows] = await Promise.all([
      branchId
        ? db.select().from(prizePayouts).where(eq(prizePayouts.branchId, branchId)).orderBy(desc(prizePayouts.id))
        : db.select().from(prizePayouts).orderBy(desc(prizePayouts.id)),
      db.select().from(customers),
      db.select().from(memberships),
      db.select().from(auctions),
      db.select().from(chitGroups),
    ]);
    const cMap = new Map(custRows.map((c) => [c.id, c]));
    const mMap = new Map(membRows.map((m) => [m.id, m]));
    const aMap = new Map(aucRows.map((a) => [a.id, a]));
    const gMap = new Map(groupRows.map((g) => [g.id, g]));

    const data = rows.map((p) => {
      const a = aMap.get(p.auctionId);
      return {
        ...p,
        customerName: cMap.get(p.customerId)?.fullName ?? '',
        customerCode: cMap.get(p.customerId)?.customerCode ?? '',
        ticketNumber: mMap.get(p.membershipId)?.ticketNumber ?? 0,
        groupCode: a ? gMap.get(a.groupId)?.groupCode ?? '' : '',
      };
    });
    return res.json({ data });
  } catch (err) {
    console.error('Prize payouts error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to load prize payouts.');
  }
});

apiRouter.patch('/prize-payouts/:id/status', requireAuth, requirePermission('payouts:manage'), async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const schema = z.object({
    status: z.enum(['APPROVED', 'PAYABLE', 'INITIATED', 'COMPLETED', 'RECONCILED']),
    bankReference: z.string().max(80).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid payout status update.');

  try {
    const [payout] = await db.select().from(prizePayouts).where(eq(prizePayouts.id, id)).limit(1);
    if (!payout) return sendError(res, 404, 'NOT_FOUND', 'Prize payout not found.');

    if (['INITIATED', 'COMPLETED'].includes(parsed.data.status)) {
      if (!payout.kycVerified || !payout.guarantorVerified || !payout.securityVerified || !payout.duesVerified) {
        return sendError(
          res,
          400,
          'VERIFICATION_GATES_INCOMPLETE',
          'All four verification gates (KYC, Guarantor, Security, and Outstanding Dues) must pass before prize disbursement.'
        );
      }
    }

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(prizePayouts)
        .set({
          status: parsed.data.status,
          bankReference: parsed.data.bankReference ?? payout.bankReference,
          paidAt: parsed.data.status === 'COMPLETED' ? new Date() : payout.paidAt,
          approvedByUserId: req.user!.id,
        })
        .where(eq(prizePayouts.id, id))
        .returning();

      // Post double-entry payout journal when COMPLETED
      if (parsed.data.status === 'COMPLETED' && payout.status !== 'COMPLETED') {
        const coaRows = await tx.select().from(chartOfAccounts);
        const prizePayable = coaRows.find((a) => a.accountCode === '2020');
        const bankAcc = coaRows.find((a) => a.accountCode === '1020');
        const openPeriods = await tx.select().from(accountingPeriods).where(eq(accountingPeriods.status, 'OPEN')).limit(1);

        if (prizePayable && bankAcc) {
          const amtPaise = rupeesToPaise(payout.netPayableAmount);
          const [jv] = await tx
            .insert(journalEntries)
            .values({
              companyId: 1,
              branchId: payout.branchId,
              periodId: openPeriods[0]?.id ?? null,
              entryNumber: `JV-PRZ-${Date.now().toString().slice(-6)}`,
              entryDate: todayISO(),
              description: `Prize Money Disbursement (${parsed.data.bankReference || payout.payoutMode}) — Payout #${payout.id}`,
              referenceType: 'PRIZE_PAYOUT',
              referenceId: payout.id,
              totalDebit: paiseToRupees(amtPaise),
              totalCredit: paiseToRupees(amtPaise),
              status: 'POSTED',
              createdByUserId: req.user!.id,
              approvedByUserId: req.user!.id,
            })
            .returning();

          await tx.insert(journalLines).values([
            {
              journalEntryId: jv.id,
              accountId: prizePayable.id,
              debit: paiseToRupees(amtPaise),
              credit: '0.00',
              narration: 'Settlement of Prize Money Payable',
            },
            {
              journalEntryId: jv.id,
              accountId: bankAcc.id,
              debit: '0.00',
              credit: paiseToRupees(amtPaise),
              narration: `Bank outflow Ref: ${parsed.data.bankReference || 'RTGS'}`,
            },
          ]);
        }
      }
      return row;
    });

    await writeAuditLog({
      branchId: payout.branchId,
      actor: req.user!,
      action: 'PRIZE_PAYOUT_STATUS_CHANGED',
      entityType: 'prize_payout',
      entityId: id,
      before: { status: payout.status },
      after: { status: updated.status, bankReference: updated.bankReference },
      ipAddress: req.ip ?? '',
    });

    return res.json({ data: updated });
  } catch (err) {
    console.error('Prize payout update error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to update prize payout.');
  }
});

// ============================================================================
// 9. OUTSTANDINGS, GUARANTORS, SECURITIES & MANDATES
// ============================================================================

apiRouter.get('/outstandings', requireAuth, requirePermission('customers:read'), async (req: AuthRequest, res) => {
  try {
    const branchId = resolveScopedBranchId(req, req.query.branchId as string | undefined);
    const [schedRows, followRows, custRows, groupRows, membRows] = await Promise.all([
      branchId
        ? db.select().from(installmentSchedules).where(eq(installmentSchedules.branchId, branchId))
        : db.select().from(installmentSchedules),
      branchId
        ? db.select().from(collectionFollowUps).where(eq(collectionFollowUps.branchId, branchId)).orderBy(desc(collectionFollowUps.createdAt))
        : db.select().from(collectionFollowUps).orderBy(desc(collectionFollowUps.createdAt)),
      db.select().from(customers),
      db.select().from(chitGroups),
      db.select().from(memberships),
    ]);

    const cMap = new Map(custRows.map((c) => [c.id, c]));
    const gMap = new Map(groupRows.map((g) => [g.id, g]));
    const mMap = new Map(membRows.map((m) => [m.id, m]));
    const today = new Date();

    const overdueItems = schedRows
      .filter((s) => ['OVERDUE', 'DUE', 'PARTIAL'].includes(s.status) && rupeesToPaise(s.outstandingAmount) > 0n)
      .map((s) => {
        const due = new Date(s.dueDate);
        const daysPastDue = Math.max(0, Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
        return {
          ...s,
          daysPastDue,
          agingBucket: daysPastDue > 90 ? '90+ Days' : daysPastDue > 60 ? '61-90 Days' : daysPastDue > 30 ? '31-60 Days' : '0-30 Days',
          customerName: cMap.get(s.customerId)?.fullName ?? '',
          customerPhone: cMap.get(s.customerId)?.phone ?? '',
          groupCode: gMap.get(s.groupId)?.groupCode ?? '',
          ticketNumber: mMap.get(s.membershipId)?.ticketNumber ?? 0,
        };
      });

    const followUps = followRows.map((f) => ({
      ...f,
      customerName: cMap.get(f.customerId)?.fullName ?? '',
      customerPhone: cMap.get(f.customerId)?.phone ?? '',
    }));

    return res.json({ data: { overdueItems, followUps } });
  } catch (err) {
    console.error('Outstandings error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to load outstandings.');
  }
});

apiRouter.post('/follow-ups', requireAuth, requirePermission('customers:read'), async (req: AuthRequest, res) => {
  const schema = z.object({
    membershipId: z.coerce.number().int().positive(),
    customerId: z.coerce.number().int().positive(),
    branchId: z.coerce.number().int().positive(),
    overdueAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
    daysPastDue: z.coerce.number().int().min(0),
    promiseToPayDate: z.string().max(20).default(''),
    actionType: z.enum(['CALL', 'FIELD_VISIT', 'DEFAULT_NOTICE', 'SETTLEMENT_PROPOSAL', 'DISPUTE']),
    notes: z.string().min(3).max(500),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid follow-up entry.');

  try {
    const effectiveBranchId = resolveScopedBranchId(req, parsed.data.branchId) ?? parsed.data.branchId;
    const [created] = await db
      .insert(collectionFollowUps)
      .values({ ...parsed.data, branchId: effectiveBranchId, status: parsed.data.promiseToPayDate ? 'PROMISED' : 'OPEN' })
      .returning();
    await writeAuditLog({
      branchId: created.branchId,
      actor: req.user!,
      action: 'COLLECTION_FOLLOWUP_LOGGED',
      entityType: 'collection_follow_up',
      entityId: created.id,
      after: created,
      ipAddress: req.ip ?? '',
    });
    return res.status(201).json({ data: created });
  } catch (err) {
    console.error('Follow-up create error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to save follow-up.');
  }
});

apiRouter.get('/guarantors-securities', requireAuth, requirePermission('customers:read'), async (req: AuthRequest, res) => {
  try {
    const branchId = resolveScopedBranchId(req, req.query.branchId as string | undefined);
    const [gRows, sRows, mRows, cRows, mandateRows] = await Promise.all([
      branchId ? db.select().from(guarantors).where(eq(guarantors.branchId, branchId)) : db.select().from(guarantors),
      branchId ? db.select().from(securities).where(eq(securities.branchId, branchId)) : db.select().from(securities),
      db.select().from(memberships),
      db.select().from(customers),
      branchId ? db.select().from(mandates).where(eq(mandates.branchId, branchId)) : db.select().from(mandates),
    ]);
    const cMap = new Map(cRows.map((c) => [c.id, c]));
    const mMap = new Map(mRows.map((m) => [m.id, m]));

    return res.json({
      data: {
        guarantors: gRows.map((g) => ({ ...g, customerName: cMap.get(g.customerId)?.fullName ?? '' })),
        securities: sRows.map((s) => ({
          ...s,
          customerName: cMap.get(s.customerId)?.fullName ?? '',
          ticketNumber: mMap.get(s.membershipId)?.ticketNumber ?? 0,
        })),
        mandates: mandateRows.map((md) => ({
          ...md,
          customerName: cMap.get(md.customerId)?.fullName ?? '',
          ticketNumber: mMap.get(md.membershipId)?.ticketNumber ?? 0,
        })),
      },
    });
  } catch (err) {
    console.error('Guarantors/securities error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to load guarantors and securities.');
  }
});

apiRouter.post('/guarantors', requireAuth, requirePermission('customers:write'), async (req: AuthRequest, res) => {
  const schema = z.object({
    customerId: z.coerce.number().int().positive(),
    branchId: z.coerce.number().int().positive(),
    fullName: z.string().min(2).max(120),
    phone: z.string().min(8).max(20),
    panNumber: z.string().max(15).default(''),
    relationship: z.string().min(2).max(60),
    address: z.string().min(4).max(240),
    consentRecorded: z.boolean().default(true),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid guarantor inputs.');
  try {
    const effectiveBranchId = resolveScopedBranchId(req, parsed.data.branchId) ?? parsed.data.branchId;
    const [created] = await db.insert(guarantors).values({ ...parsed.data, branchId: effectiveBranchId, verificationStatus: 'PENDING' }).returning();
    await writeAuditLog({
      branchId: created.branchId,
      actor: req.user!,
      action: 'GUARANTOR_REGISTERED',
      entityType: 'guarantor',
      entityId: created.id,
      after: created,
      ipAddress: req.ip ?? '',
    });
    return res.status(201).json({ data: created });
  } catch (err) {
    console.error('Guarantor create error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to register guarantor.');
  }
});

// ============================================================================
// 10. DOUBLE-ENTRY ACCOUNTING, CASH REGISTER & BANK RECONCILIATION
// ============================================================================

apiRouter.get('/accounting/overview', requireAuth, requirePermission('accounting:read'), async (req: AuthRequest, res) => {
  try {
    const [coaRows, periodRows, entryRows, lineRows] = await Promise.all([
      db.select().from(chartOfAccounts).orderBy(asc(chartOfAccounts.accountCode)),
      db.select().from(accountingPeriods).orderBy(desc(accountingPeriods.id)),
      db.select().from(journalEntries).orderBy(desc(journalEntries.createdAt)),
      db.select().from(journalLines),
    ]);

    const coaMap = new Map(coaRows.map((a) => [a.id, a]));
    const postedEntryIds = new Set(entryRows.filter((e) => e.status === 'POSTED').map((e) => e.id));

    // Compute live Trial Balance in integer paise from posted journal lines
    const accountTotals = new Map<number, { debit: bigint; credit: bigint }>();
    for (const a of coaRows) {
      accountTotals.set(a.id, { debit: 0n, credit: 0n });
    }
    let grandDebit = 0n;
    let grandCredit = 0n;

    for (const l of lineRows) {
      if (!postedEntryIds.has(l.journalEntryId)) continue;
      const d = rupeesToPaise(l.debit);
      const c = rupeesToPaise(l.credit);
      const current = accountTotals.get(l.accountId) ?? { debit: 0n, credit: 0n };
      current.debit += d;
      current.credit += c;
      accountTotals.set(l.accountId, current);
      grandDebit += d;
      grandCredit += c;
    }

    const trialBalance = coaRows.map((a) => {
      const t = accountTotals.get(a.id) ?? { debit: 0n, credit: 0n };
      const net = t.debit - t.credit;
      return {
        accountId: a.id,
        accountCode: a.accountCode,
        accountName: a.accountName,
        accountType: a.accountType,
        totalDebit: paiseToRupees(t.debit),
        totalCredit: paiseToRupees(t.credit),
        netBalance: paiseToRupees(net >= 0n ? net : -net),
        balanceSide: net >= 0n ? 'DR' : 'CR',
      };
    });

    const journalsWithLines = entryRows.map((e) => ({
      ...e,
      lines: lineRows
        .filter((l) => l.journalEntryId === e.id)
        .map((l) => ({
          ...l,
          accountCode: coaMap.get(l.accountId)?.accountCode ?? '',
          accountName: coaMap.get(l.accountId)?.accountName ?? '',
        })),
    }));

    return res.json({
      data: {
        chartOfAccounts: coaRows,
        periods: periodRows,
        journals: journalsWithLines,
        trialBalance,
        totals: {
          grandDebit: paiseToRupees(grandDebit),
          grandCredit: paiseToRupees(grandCredit),
          isBalanced: grandDebit === grandCredit,
        },
      },
    });
  } catch (err) {
    console.error('Accounting overview error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to load accounting ledger.');
  }
});

const createJournalSchema = z.object({
  branchId: z.coerce.number().int().positive(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(4).max(240),
  lines: z
    .array(
      z.object({
        accountId: z.coerce.number().int().positive(),
        debit: z.string().regex(/^\d+(\.\d{1,2})?$/).default('0.00'),
        credit: z.string().regex(/^\d+(\.\d{1,2})?$/).default('0.00'),
        narration: z.string().max(160).default(''),
      })
    )
    .min(2),
});

apiRouter.post('/accounting/journals', requireAuth, requirePermission('accounting:write'), async (req: AuthRequest, res) => {
  const parsed = createJournalSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid journal entry structure.');

  const check = validateJournalBalance(
    parsed.data.lines.map((l) => ({
      accountId: l.accountId,
      debitPaise: rupeesToPaise(l.debit),
      creditPaise: rupeesToPaise(l.credit),
      narration: l.narration,
    }))
  );

  if (!check.valid) {
    return sendError(res, 400, 'UNBALANCED_JOURNAL', check.error ?? 'Total Debits must equal Total Credits.');
  }

  try {
    const openPeriods = await db.select().from(accountingPeriods).where(eq(accountingPeriods.status, 'OPEN')).limit(1);
    if (openPeriods.length === 0) {
      return sendError(res, 400, 'PERIOD_CLOSED', 'No open accounting period available.');
    }

    const created = await db.transaction(async (tx) => {
      const [jv] = await tx
        .insert(journalEntries)
        .values({
          companyId: 1,
          branchId: resolveScopedBranchId(req, parsed.data.branchId) ?? parsed.data.branchId,
          periodId: openPeriods[0].id,
          entryNumber: `JV-MAN-${Date.now().toString().slice(-6)}`,
          entryDate: parsed.data.entryDate,
          description: parsed.data.description,
          referenceType: 'MANUAL',
          totalDebit: paiseToRupees(check.totalDebitPaise),
          totalCredit: paiseToRupees(check.totalCreditPaise),
          status: 'POSTED',
          createdByUserId: req.user!.id,
          approvedByUserId: req.user!.id,
        })
        .returning();

      await tx.insert(journalLines).values(
        parsed.data.lines.map((l) => ({
          journalEntryId: jv.id,
          accountId: l.accountId,
          debit: paiseToRupees(rupeesToPaise(l.debit)),
          credit: paiseToRupees(rupeesToPaise(l.credit)),
          narration: l.narration,
        }))
      );
      return jv;
    });

    await writeAuditLog({
      branchId: created.branchId,
      actor: req.user!,
      action: 'JOURNAL_POSTED',
      entityType: 'journal_entry',
      entityId: created.id,
      after: created,
      ipAddress: req.ip ?? '',
    });

    return res.status(201).json({ data: created });
  } catch (err) {
    console.error('Journal post error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to post journal entry.');
  }
});

// Immutable reversal entry (never deletes or edits a posted journal)
apiRouter.post('/accounting/journals/:id/reverse', requireAuth, requirePermission('accounting:write'), async (req: AuthRequest, res) => {
  const entryId = Number(req.params.id);
  try {
    const [orig] = await db.select().from(journalEntries).where(eq(journalEntries.id, entryId)).limit(1);
    if (!orig) return sendError(res, 404, 'NOT_FOUND', 'Journal entry not found.');
    if (orig.status === 'REVERSED') return sendError(res, 400, 'ALREADY_REVERSED', 'Journal entry already reversed.');

    const origLines = await db.select().from(journalLines).where(eq(journalLines.journalEntryId, orig.id));

    const reversal = await db.transaction(async (tx) => {
      const [rev] = await tx
        .insert(journalEntries)
        .values({
          companyId: orig.companyId,
          branchId: orig.branchId,
          periodId: orig.periodId,
          entryNumber: `REV-${orig.entryNumber}-${Date.now().toString().slice(-3)}`,
          entryDate: todayISO(),
          description: `Reversal of ${orig.entryNumber}: ${orig.description}`,
          referenceType: 'REVERSAL',
          referenceId: orig.id,
          totalDebit: orig.totalCredit,
          totalCredit: orig.totalDebit,
          status: 'POSTED',
          reversedEntryId: orig.id,
          createdByUserId: req.user!.id,
          approvedByUserId: req.user!.id,
        })
        .returning();

      // Swap debits and credits for exact contra entry
      await tx.insert(journalLines).values(
        origLines.map((l) => ({
          journalEntryId: rev.id,
          accountId: l.accountId,
          debit: l.credit,
          credit: l.debit,
          narration: `Contra reversal: ${l.narration}`,
        }))
      );

      await tx.update(journalEntries).set({ status: 'REVERSED' }).where(eq(journalEntries.id, orig.id));
      return rev;
    });

    await writeAuditLog({
      branchId: orig.branchId,
      actor: req.user!,
      action: 'JOURNAL_REVERSED',
      entityType: 'journal_entry',
      entityId: orig.id,
      after: { reversalEntryNumber: reversal.entryNumber },
      ipAddress: req.ip ?? '',
    });

    return res.status(201).json({ data: reversal });
  } catch (err) {
    console.error('Journal reverse error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to reverse journal entry.');
  }
});

apiRouter.get('/treasury', requireAuth, requirePermission('accounting:read'), async (req: AuthRequest, res) => {
  try {
    const branchId = resolveScopedBranchId(req, req.query.branchId as string | undefined);
    const [cashRows, bankRows, reconRows, branchRows] = await Promise.all([
      branchId
        ? db.select().from(branchCashRegisters).where(eq(branchCashRegisters.branchId, branchId)).orderBy(desc(branchCashRegisters.id))
        : db.select().from(branchCashRegisters).orderBy(desc(branchCashRegisters.id)),
      branchId
        ? db.select().from(bankAccounts).where(eq(bankAccounts.branchId, branchId))
        : db.select().from(bankAccounts),
      db.select().from(bankReconciliations).orderBy(desc(bankReconciliations.id)),
      db.select().from(branches),
    ]);
    const bMap = new Map(branchRows.map((b) => [b.id, b]));
    const bankMap = new Map(bankRows.map((b) => [b.id, b]));

    return res.json({
      data: {
        cashRegisters: cashRows.map((c) => ({ ...c, branchName: bMap.get(c.branchId)?.name ?? '' })),
        bankAccounts: bankRows.map((b) => ({ ...b, branchName: bMap.get(b.branchId)?.name ?? '' })),
        reconciliations: reconRows.map((r) => ({ ...r, bankName: bankMap.get(r.bankAccountId)?.bankName ?? '' })),
      },
    });
  } catch (err) {
    console.error('Treasury fetch error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to load cash & bank data.');
  }
});

apiRouter.post('/bank-reconciliation/:id/match', requireAuth, requirePermission('cash:manage'), async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  try {
    const [updated] = await db
      .update(bankReconciliations)
      .set({ status: 'MATCHED', reconciledByUserId: req.user!.id })
      .where(eq(bankReconciliations.id, id))
      .returning();
    if (!updated) return sendError(res, 404, 'NOT_FOUND', 'Bank statement line not found.');
    if (updated.matchedPaymentId) {
      await db
        .update(payments)
        .set({ status: 'RECONCILED', verifiedByUserId: req.user!.id })
        .where(eq(payments.id, updated.matchedPaymentId));
    }
    await writeAuditLog({
      actor: req.user!,
      action: 'BANK_STATEMENT_RECONCILED',
      entityType: 'bank_reconciliation',
      entityId: id,
      after: updated,
      ipAddress: req.ip ?? '',
    });
    return res.json({ data: updated });
  } catch (err) {
    console.error('Recon match error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to reconcile statement item.');
  }
});

// ============================================================================
// 11. MAKER-CHECKER APPROVAL WORKFLOW ENGINE
// ============================================================================

apiRouter.get('/approvals', requireAuth, requirePermission('dashboard:read'), async (req: AuthRequest, res) => {
  try {
    const branchId = resolveScopedBranchId(req, req.query.branchId as string | undefined);
    const [reqRows, userRows, branchRows] = await Promise.all([
      branchId
        ? db.select().from(approvalRequests).where(eq(approvalRequests.branchId, branchId)).orderBy(desc(approvalRequests.createdAt))
        : db.select().from(approvalRequests).orderBy(desc(approvalRequests.createdAt)),
      db.select({ id: users.id, fullName: users.fullName, username: users.username, role: users.role }).from(users),
      db.select().from(branches),
    ]);
    const uMap = new Map(userRows.map((u) => [u.id, u]));
    const bMap = new Map(branchRows.map((b) => [b.id, b]));

    const data = reqRows.map((r) => ({
      ...r,
      requesterName: uMap.get(r.requestedByUserId)?.fullName ?? 'Unknown',
      requesterUsername: uMap.get(r.requestedByUserId)?.username ?? '',
      deciderName: r.decidedByUserId ? uMap.get(r.decidedByUserId)?.fullName ?? '' : '',
      branchName: bMap.get(r.branchId)?.name ?? '',
      isSelfRequest: r.requestedByUserId === req.user!.id,
    }));
    return res.json({ data });
  } catch (err) {
    console.error('Approvals fetch error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to load approval queue.');
  }
});

apiRouter.post('/approvals/:id/decide', requireAuth, requirePermission('approvals:decide'), async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const schema = z.object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    decisionNotes: z.string().max(400).default(''),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid approval decision.');

  try {
    const [item] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, id)).limit(1);
    if (!item) return sendError(res, 404, 'NOT_FOUND', 'Approval request not found.');
    if (item.status !== 'PENDING') return sendError(res, 400, 'ALREADY_DECIDED', 'This request has already been decided.');

    const guard = canDecideApproval({
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      actorBranchId: req.user!.branchId,
      requestedByUserId: item.requestedByUserId,
      requestBranchId: item.branchId,
    });
    if (!guard.allowed) {
      return sendError(res, 403, 'MAKER_CHECKER_BLOCKED', guard.reason ?? 'Not permitted to approve this request.');
    }

    const updated = await db.transaction(async (tx) => {
      const [decided] = await tx
        .update(approvalRequests)
        .set({
          status: parsed.data.decision,
          decidedByUserId: req.user!.id,
          decisionNotes: parsed.data.decisionNotes,
          decidedAt: new Date(),
        })
        .where(eq(approvalRequests.id, id))
        .returning();

      // Execute downstream domain state transition atomically when APPROVED
      if (parsed.data.decision === 'APPROVED') {
        if (item.requestType === 'KYC_VERIFICATION') {
          await tx
            .update(customers)
            .set({ kycStatus: 'VERIFIED', updatedAt: new Date() })
            .where(eq(customers.id, item.entityId));
          await tx
            .update(kycDocuments)
            .set({ verificationStatus: 'VERIFIED', verifiedByUserId: req.user!.id, verifiedAt: new Date() })
            .where(eq(kycDocuments.customerId, item.entityId));
        } else if (item.requestType === 'GROUP_ACTIVATION') {
          await tx
            .update(chitGroups)
            .set({ status: 'ACTIVE', approvedByUserId: req.user!.id, updatedAt: new Date() })
            .where(eq(chitGroups.id, item.entityId));
        } else if (item.requestType === 'MEMBER_ENROLLMENT') {
          await tx
            .update(memberships)
            .set({ status: 'ACTIVE', approvedByUserId: req.user!.id })
            .where(eq(memberships.id, item.entityId));
        } else if (item.requestType === 'PRIZE_PAYOUT') {
          await tx
            .update(prizePayouts)
            .set({ status: 'PAYABLE', approvedByUserId: req.user!.id })
            .where(eq(prizePayouts.id, item.entityId));
        } else if (item.requestType === 'AUCTION_APPROVAL') {
          const [auc] = await tx.select().from(auctions).where(eq(auctions.id, item.entityId)).limit(1);
          if (auc) {
            await tx
              .update(auctions)
              .set({ status: 'APPROVED', approvedByUserId: req.user!.id })
              .where(eq(auctions.id, auc.id));
            if (auc.winningMembershipId) {
              const [winM] = await tx.select().from(memberships).where(eq(memberships.id, auc.winningMembershipId)).limit(1);
              await tx
                .update(memberships)
                .set({ isPrized: true, prizedInstallmentMonth: auc.installmentNumber, status: 'PRIZED' })
                .where(eq(memberships.id, auc.winningMembershipId));
              if (winM) {
                await tx.insert(prizePayouts).values({
                  auctionId: auc.id,
                  membershipId: winM.id,
                  customerId: winM.customerId,
                  branchId: auc.branchId,
                  grossPrizeAmount: auc.netPrizeAmount,
                  overdueDeduction: '0.00',
                  otherDeductions: '0.00',
                  netPayableAmount: auc.netPrizeAmount,
                  status: 'PENDING_VERIFICATION',
                  requestedByUserId: item.requestedByUserId,
                  approvedByUserId: req.user!.id,
                });
              }
            }
          }
        } else if (item.requestType === 'PAYMENT_REVERSAL') {
          await tx
            .update(payments)
            .set({ status: 'REVERSED' })
            .where(eq(payments.id, item.entityId));
        }
      }
      return decided;
    });

    await writeAuditLog({
      branchId: item.branchId,
      actor: req.user!,
      action: `APPROVAL_${parsed.data.decision}`,
      entityType: 'approval_request',
      entityId: item.id,
      before: { status: 'PENDING' },
      after: { status: parsed.data.decision, requestType: item.requestType, notes: parsed.data.decisionNotes },
      ipAddress: req.ip ?? '',
    });

    return res.json({ data: updated });
  } catch (err) {
    console.error('Approval decision error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to record approval decision.');
  }
});

// ============================================================================
// 12. DOCUMENTS, NOTIFICATIONS, AUDIT LOGS, REPORTS & CUSTOMER PORTAL
// ============================================================================

apiRouter.get('/documents', requireAuth, requirePermission('dashboard:read'), async (req: AuthRequest, res) => {
  try {
    const branchId = resolveScopedBranchId(req, req.query.branchId as string | undefined);
    const rows = branchId
      ? await db.select().from(documents).where(eq(documents.branchId, branchId)).orderBy(desc(documents.createdAt))
      : await db.select().from(documents).orderBy(desc(documents.createdAt));
    return res.json({ data: rows });
  } catch (err) {
    console.error('Documents error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to load documents.');
  }
});

apiRouter.get('/notifications', requireAuth, requirePermission('dashboard:read'), async (_req, res) => {
  try {
    const rows = await db.select().from(notificationsOutbox).orderBy(desc(notificationsOutbox.createdAt)).limit(40);
    return res.json({ data: rows });
  } catch (err) {
    console.error('Notifications error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to load notifications.');
  }
});

apiRouter.post('/notifications', requireAuth, requirePermission('dashboard:read'), async (req: AuthRequest, res) => {
  const schema = z.object({
    branchId: z.coerce.number().int().positive().default(1),
    channel: z.enum(['IN_APP', 'SMS', 'WHATSAPP', 'EMAIL']),
    recipient: z.string().min(3).max(120),
    title: z.string().min(3).max(160),
    message: z.string().min(5).max(500),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid notification payload.');

  // Never pretend external SMS/WhatsApp/Email was delivered if provider isn't configured
  const status =
    parsed.data.channel === 'IN_APP'
      ? 'DELIVERED_IN_APP'
      : 'ADAPTER_UNCONFIGURED';

  try {
    const effectiveBranchId = resolveScopedBranchId(req, parsed.data.branchId) ?? parsed.data.branchId;
    const [created] = await db
      .insert(notificationsOutbox)
      .values({ companyId: 1, ...parsed.data, branchId: effectiveBranchId, status })
      .returning();
    return res.status(201).json({ data: created });
  } catch (err) {
    console.error('Notification create error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to queue notification.');
  }
});

apiRouter.get('/audit-logs', requireAuth, requirePermission('audit:read'), async (_req, res) => {
  try {
    const rows = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100);
    return res.json({ data: rows });
  } catch (err) {
    console.error('Audit logs error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to fetch audit logs.');
  }
});

apiRouter.get('/reports/summary', requireAuth, requirePermission('reports:read'), async (req: AuthRequest, res) => {
  try {
    const branchId = resolveScopedBranchId(req, req.query.branchId as string | undefined);
    const [payRows, schedRows, aucRows, payoutRows] = await Promise.all([
      branchId ? db.select().from(payments).where(eq(payments.branchId, branchId)) : db.select().from(payments),
      branchId ? db.select().from(installmentSchedules).where(eq(installmentSchedules.branchId, branchId)) : db.select().from(installmentSchedules),
      branchId ? db.select().from(auctions).where(eq(auctions.branchId, branchId)) : db.select().from(auctions),
      branchId ? db.select().from(prizePayouts).where(eq(prizePayouts.branchId, branchId)) : db.select().from(prizePayouts),
    ]);

    const byMode = new Map<string, bigint>();
    for (const p of payRows) {
      if (['SUCCESSFUL', 'RECONCILED', 'UNDER_VERIFICATION'].includes(p.status)) {
        byMode.set(p.paymentMode, (byMode.get(p.paymentMode) ?? 0n) + rupeesToPaise(p.amount));
      }
    }

    const totalCollected = Array.from(byMode.values()).reduce((a, b) => a + b, 0n);
    const totalOverdue = schedRows
      .filter((s) => s.status === 'OVERDUE')
      .reduce((acc, s) => acc + rupeesToPaise(s.outstandingAmount), 0n);
    const totalCommission = aucRows
      .filter((a) => a.status === 'APPROVED')
      .reduce((acc, a) => acc + rupeesToPaise(a.foremanCommissionAmount), 0n);
    const totalPrizes = payoutRows.reduce((acc, p) => acc + rupeesToPaise(p.netPayableAmount), 0n);

    return res.json({
      data: {
        totalCollected: paiseToRupees(totalCollected),
        totalOverdue: paiseToRupees(totalOverdue),
        totalCommission: paiseToRupees(totalCommission),
        totalPrizes: paiseToRupees(totalPrizes),
        collectionsByMode: Array.from(byMode.entries()).map(([mode, paise]) => ({
          mode,
          amount: paiseToRupees(paise),
          amountRupees: Number(paise) / 100,
        })),
      },
    });
  } catch (err) {
    console.error('Reports summary error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to generate financial reports.');
  }
});

// Customer Self-Service Portal (strictly scoped to own customerId; only CUSTOMER or SUPER_ADMIN preview)
apiRouter.get('/portal/me', requireAuth, requirePermission('portal:read'), async (req: AuthRequest, res) => {
  try {
    if (req.user!.role === 'CUSTOMER' && !req.user!.customerId) {
      return sendError(res, 403, 'NO_CUSTOMER_PROFILE', 'No customer profile linked to this account.');
    }
    const targetCustomerId = req.user!.role === 'CUSTOMER' ? req.user!.customerId! : (req.user!.customerId ?? 1);

    const [custRows, membRows, schedRows, payRows, divRows, docRows, groupRows] = await Promise.all([
      db.select().from(customers).where(eq(customers.id, targetCustomerId)).limit(1),
      db.select().from(memberships).where(eq(memberships.customerId, targetCustomerId)),
      db.select().from(installmentSchedules).where(eq(installmentSchedules.customerId, targetCustomerId)).orderBy(asc(installmentSchedules.dueDate)),
      db.select().from(payments).where(eq(payments.customerId, targetCustomerId)).orderBy(desc(payments.createdAt)),
      db.select().from(dividendAllocations).where(eq(dividendAllocations.customerId, targetCustomerId)),
      db.select().from(documents).where(eq(documents.customerId, targetCustomerId)).orderBy(desc(documents.createdAt)),
      db.select().from(chitGroups),
    ]);

    const gMap = new Map(groupRows.map((g) => [g.id, g]));

    return res.json({
      data: {
        customer: custRows[0] ?? null,
        memberships: membRows.map((m) => ({
          ...m,
          groupCode: gMap.get(m.groupId)?.groupCode ?? '',
          groupName: gMap.get(m.groupId)?.name ?? '',
        })),
        installments: schedRows.map((s) => ({
          ...s,
          groupCode: gMap.get(s.groupId)?.groupCode ?? '',
        })),
        payments: payRows,
        dividends: divRows,
        documents: docRows,
      },
    });
  } catch (err) {
    console.error('Customer portal error:', err);
    return sendError(res, 500, 'DB_ERROR', 'Failed to load customer portal.');
  }
});
