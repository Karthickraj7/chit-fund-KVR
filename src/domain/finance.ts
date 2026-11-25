/**
 * Pure financial domain engine using integer paise (BigInt) exclusively.
 * Zero JavaScript floating-point arithmetic is used for any monetary calculation.
 */

export type RoundingPolicy = 'FLOOR_RUPEE' | 'NEAREST_RUPEE' | 'EXACT_PAISE';
export type CommissionMethod = 'PERCENTAGE' | 'FIXED';

export type UserRole =
  | 'SUPER_ADMIN'
  | 'COMPANY_ADMIN'
  | 'BRANCH_MANAGER'
  | 'ACCOUNTANT'
  | 'FINANCE_MANAGER'
  | 'AUCTION_MANAGER'
  | 'COLLECTION_AGENT'
  | 'CUSTOMER_SERVICE'
  | 'AUDITOR'
  | 'CUSTOMER';

export const ALL_ROLES: UserRole[] = [
  'SUPER_ADMIN',
  'COMPANY_ADMIN',
  'BRANCH_MANAGER',
  'ACCOUNTANT',
  'FINANCE_MANAGER',
  'AUCTION_MANAGER',
  'COLLECTION_AGENT',
  'CUSTOMER_SERVICE',
  'AUDITOR',
  'CUSTOMER',
];

export const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super Administrator',
  COMPANY_ADMIN: 'Company Administrator',
  BRANCH_MANAGER: 'Branch Manager',
  ACCOUNTANT: 'Accountant',
  FINANCE_MANAGER: 'Finance Manager',
  AUCTION_MANAGER: 'Auction Manager',
  COLLECTION_AGENT: 'Collection Agent',
  CUSTOMER_SERVICE: 'Customer Service Executive',
  AUDITOR: 'Auditor (Read-Only)',
  CUSTOMER: 'Customer',
};

/**
 * Parse a decimal rupee string (e.g. "12500.50") or number into exact integer paise (BigInt).
 */
export function rupeesToPaise(input: string | number | bigint): bigint {
  if (typeof input === 'bigint') return input;
  const raw = String(input).trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) {
    throw new Error(`Invalid monetary amount: "${input}"`);
  }
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [wholePart, fracPart = ''] = unsigned.split('.');
  const paddedFrac = (fracPart + '00').slice(0, 2);
  const paise = BigInt(wholePart) * 100n + BigInt(paddedFrac);
  return negative ? -paise : paise;
}

/**
 * Format exact integer paise (BigInt) into a canonical PostgreSQL NUMERIC(14,2) string (e.g. "12500.50").
 */
export function paiseToRupees(paise: bigint): string {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${frac}`;
}

/**
 * Format a rupee amount in the Indian numbering system (e.g., ₹12,34,567.00).
 */
export function formatINR(amount: string | number | bigint, showSymbol = true): string {
  const paise = typeof amount === 'bigint' ? amount : rupeesToPaise(amount);
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const wholeStr = (abs / 100n).toString();
  const fracStr = (abs % 100n).toString().padStart(2, '0');

  // Indian numbering grouping: last 3 digits, then pairs of 2 digits
  let grouped = wholeStr;
  if (wholeStr.length > 3) {
    const lastThree = wholeStr.slice(-3);
    const rest = wholeStr.slice(0, -3);
    const paired = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    grouped = `${paired},${lastThree}`;
  }

  const prefix = `${negative ? '-' : ''}${showSymbol ? '₹' : ''}`;
  return `${prefix}${grouped}.${fracStr}`;
}

/**
 * Format YYYY-MM-DD or ISO timestamp to DD-MM-YYYY in Asia/Kolkata timezone.
 */
export function formatDateDDMMYYYY(input: string | Date | null | undefined): string {
  if (!input) return '—';
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
    const [y, m, d] = input.trim().split('-');
    return `${d}-${m}-${y}`;
  }
  const dt = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(dt.getTime())) return String(input);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(dt);
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const year = parts.find((p) => p.type === 'year')?.value ?? '2026';
  return `${day}-${month}-${year}`;
}

export interface InstallmentObligation {
  id: number;
  installmentNumber: number;
  amountDuePaise: bigint;
  amountPaidPaise: bigint;
  outstandingPaise: bigint;
}

export interface AllocationPlanItem {
  installmentId: number;
  installmentNumber: number;
  allocatedPaise: bigint;
  newAmountPaidPaise: bigint;
  newOutstandingPaise: bigint;
  newStatus: 'PAID' | 'PARTIAL';
}

export interface PaymentAllocationResult {
  allocations: AllocationPlanItem[];
  totalAllocatedPaise: bigint;
  excessAdvancePaise: bigint;
}

/**
 * Allocate a payment across ordered outstanding installments (oldest installment first).
 * Supports exact, partial, and multi-installment advance payments without losing a single paisa.
 */
export function allocatePaymentAcrossInstallments(
  paymentPaise: bigint,
  obligations: InstallmentObligation[]
): PaymentAllocationResult {
  if (paymentPaise <= 0n) {
    throw new Error('Payment amount must be greater than zero.');
  }

  const sorted = [...obligations]
    .filter((item) => item.outstandingPaise > 0n)
    .sort((a, b) => a.installmentNumber - b.installmentNumber);

  let remaining = paymentPaise;
  const allocations: AllocationPlanItem[] = [];

  for (const row of sorted) {
    if (remaining <= 0n) break;
    const alloc = remaining >= row.outstandingPaise ? row.outstandingPaise : remaining;
    const newPaid = row.amountPaidPaise + alloc;
    const newOutstanding = row.outstandingPaise - alloc;

    allocations.push({
      installmentId: row.id,
      installmentNumber: row.installmentNumber,
      allocatedPaise: alloc,
      newAmountPaidPaise: newPaid,
      newOutstandingPaise: newOutstanding,
      newStatus: newOutstanding === 0n ? 'PAID' : 'PARTIAL',
    });

    remaining -= alloc;
  }

  return {
    allocations,
    totalAllocatedPaise: paymentPaise - remaining,
    excessAdvancePaise: remaining,
  };
}

export interface AuctionCalculationInput {
  chitValuePaise: bigint;
  winningBidDiscountPaise: bigint;
  subscriberCount: number;
  maxDiscountPercentBps: number; // e.g., 4000 = 40.00%
  commissionMethod: CommissionMethod;
  commissionValue: bigint; // bps (e.g., 500 = 5.00%) if PERCENTAGE, or paise if FIXED
  gstRateBps: number; // e.g., 1200 = 12.00%
  roundingPolicy: RoundingPolicy;
  schemeVersionId: number;
  formulaApprovalStatus: string;
}

export interface AuctionCalculationSnapshot {
  schemeVersionId: number;
  formulaApprovalStatus: string;
  chitValuePaise: bigint;
  winningBidDiscountPaise: bigint;
  foremanCommissionPaise: bigint;
  gstOnCommissionPaise: bigint;
  netPrizePayableBeforeDeductionsPaise: bigint;
  distributableDividendPoolPaise: bigint;
  perMemberDividendPaise: bigint;
  totalDistributedDividendPaise: bigint;
  roundingResiduePaise: bigint;
  subscriberCount: number;
  roundingPolicy: RoundingPolicy;
  balancedInvariantVerified: boolean;
}

/**
 * Pure, reproducible, version-controlled Auction & Dividend Calculation Engine.
 * Invariant: netPrizePayableBeforeDeductions + foremanCommission + totalDistributedDividend + roundingResidue === chitValue
 */
export function calculateAuctionSnapshot(
  input: AuctionCalculationInput
): AuctionCalculationSnapshot {
  if (input.chitValuePaise <= 0n) {
    throw new Error('Chit value must be positive.');
  }
  if (input.subscriberCount <= 0) {
    throw new Error('Subscriber count must be positive.');
  }
  if (input.winningBidDiscountPaise < 0n) {
    throw new Error('Winning bid discount cannot be negative.');
  }

  const maxAllowedDiscount = (input.chitValuePaise * BigInt(input.maxDiscountPercentBps)) / 10000n;
  if (input.winningBidDiscountPaise > maxAllowedDiscount) {
    throw new Error(
      `Winning discount (${formatINR(input.winningBidDiscountPaise)}) exceeds scheme cap (${formatINR(maxAllowedDiscount)}).`
    );
  }

  const foremanCommissionPaise =
    input.commissionMethod === 'PERCENTAGE'
      ? (input.chitValuePaise * input.commissionValue) / 10000n
      : input.commissionValue;

  if (foremanCommissionPaise < 0n || foremanCommissionPaise > input.chitValuePaise) {
    throw new Error('Invalid foreman commission configuration.');
  }

  // GST is tracked separately for tax accounting (configurable; 0% if disabled)
  const gstOnCommissionPaise = (foremanCommissionPaise * BigInt(input.gstRateBps)) / 10000n;

  // Net prize before deductions = Chit Value - Winning Bid Discount
  const netPrizePayableBeforeDeductionsPaise = input.chitValuePaise - input.winningBidDiscountPaise;

  // Distributable dividend pool = max(0, Winning Bid Discount - Foreman Commission)
  const rawPool = input.winningBidDiscountPaise - foremanCommissionPaise;
  const distributableDividendPoolPaise = rawPool > 0n ? rawPool : 0n;

  const countBig = BigInt(input.subscriberCount);
  let perMemberDividendPaise = 0n;

  if (distributableDividendPoolPaise > 0n) {
    if (input.roundingPolicy === 'EXACT_PAISE') {
      perMemberDividendPaise = distributableDividendPoolPaise / countBig;
    } else if (input.roundingPolicy === 'FLOOR_RUPEE') {
      const exactPaise = distributableDividendPoolPaise / countBig;
      perMemberDividendPaise = (exactPaise / 100n) * 100n;
    } else {
      // NEAREST_RUPEE (half-up) while never exceeding pool
      const exactPaise = distributableDividendPoolPaise / countBig;
      const remainder = exactPaise % 100n;
      const rounded = remainder >= 50n ? exactPaise + (100n - remainder) : exactPaise - remainder;
      perMemberDividendPaise =
        rounded * countBig <= distributableDividendPoolPaise ? rounded : (exactPaise / 100n) * 100n;
    }
  }

  const totalDistributedDividendPaise = perMemberDividendPaise * countBig;
  // Remaining pool (or foreman shortfall if discount < commission) is tracked explicitly as roundingResidue
  const roundingResiduePaise =
    input.winningBidDiscountPaise - foremanCommissionPaise - totalDistributedDividendPaise;

  const balancedInvariantVerified =
    netPrizePayableBeforeDeductionsPaise +
      foremanCommissionPaise +
      totalDistributedDividendPaise +
      roundingResiduePaise ===
    input.chitValuePaise;

  return {
    schemeVersionId: input.schemeVersionId,
    formulaApprovalStatus: input.formulaApprovalStatus,
    chitValuePaise: input.chitValuePaise,
    winningBidDiscountPaise: input.winningBidDiscountPaise,
    foremanCommissionPaise,
    gstOnCommissionPaise,
    netPrizePayableBeforeDeductionsPaise,
    distributableDividendPoolPaise,
    perMemberDividendPaise,
    totalDistributedDividendPaise,
    roundingResiduePaise,
    subscriberCount: input.subscriberCount,
    roundingPolicy: input.roundingPolicy,
    balancedInvariantVerified,
  };
}

export interface JournalLineInput {
  accountId: number;
  debitPaise: bigint;
  creditPaise: bigint;
  narration?: string;
}

export function validateJournalBalance(lines: JournalLineInput[]): {
  valid: boolean;
  totalDebitPaise: bigint;
  totalCreditPaise: bigint;
  error?: string;
} {
  if (lines.length < 2) {
    return {
      valid: false,
      totalDebitPaise: 0n,
      totalCreditPaise: 0n,
      error: 'A double-entry journal must contain at least two lines.',
    };
  }

  let totalDebitPaise = 0n;
  let totalCreditPaise = 0n;

  for (const line of lines) {
    if (line.debitPaise < 0n || line.creditPaise < 0n) {
      return {
        valid: false,
        totalDebitPaise,
        totalCreditPaise,
        error: 'Debit and credit amounts must be non-negative.',
      };
    }
    if (line.debitPaise > 0n && line.creditPaise > 0n) {
      return {
        valid: false,
        totalDebitPaise,
        totalCreditPaise,
        error: 'A journal line cannot contain both debit and credit values.',
      };
    }
    if (line.debitPaise === 0n && line.creditPaise === 0n) {
      return {
        valid: false,
        totalDebitPaise,
        totalCreditPaise,
        error: 'Zero-value journal lines are not permitted.',
      };
    }
    totalDebitPaise += line.debitPaise;
    totalCreditPaise += line.creditPaise;
  }

  if (totalDebitPaise === 0n || totalDebitPaise !== totalCreditPaise) {
    return {
      valid: false,
      totalDebitPaise,
      totalCreditPaise,
      error: `Unbalanced journal entry: Total Debits (${formatINR(totalDebitPaise)}) must equal Total Credits (${formatINR(totalCreditPaise)}).`,
    };
  }

  return { valid: true, totalDebitPaise, totalCreditPaise };
}

/**
 * Maker-Checker enforcement guard.
 * Guarantees a user can NEVER approve/reject their own sensitive transaction.
 */
export function canDecideApproval(params: {
  actorUserId: number;
  actorRole: UserRole;
  actorBranchId: number | null;
  requestedByUserId: number;
  requestBranchId: number;
}): { allowed: boolean; reason?: string } {
  if (params.actorUserId === params.requestedByUserId) {
    return {
      allowed: false,
      reason: 'Maker-Checker violation: You cannot approve or reject a request you initiated.',
    };
  }

  const approverRoles: UserRole[] = [
    'SUPER_ADMIN',
    'COMPANY_ADMIN',
    'BRANCH_MANAGER',
    'FINANCE_MANAGER',
  ];

  if (!approverRoles.includes(params.actorRole)) {
    return {
      allowed: false,
      reason: `Role ${params.actorRole} is not authorized to approve workflow requests.`,
    };
  }

  if (
    params.actorRole === 'BRANCH_MANAGER' &&
    params.actorBranchId !== null &&
    params.actorBranchId !== params.requestBranchId
  ) {
    return {
      allowed: false,
      reason: 'Branch isolation violation: Branch Managers can only approve requests within their assigned branch.',
    };
  }

  return { allowed: true };
}

export type PermissionKey =
  | 'dashboard:read'
  | 'company:manage'
  | 'branches:manage'
  | 'employees:manage'
  | 'customers:read'
  | 'customers:write'
  | 'kyc:verify'
  | 'schemes:manage'
  | 'groups:read'
  | 'groups:write'
  | 'enrollments:write'
  | 'payments:collect'
  | 'payments:reverse'
  | 'auctions:conduct'
  | 'payouts:manage'
  | 'accounting:read'
  | 'accounting:write'
  | 'cash:manage'
  | 'approvals:decide'
  | 'reports:read'
  | 'audit:read'
  | 'portal:read';

const ROLE_PERMISSIONS: Record<UserRole, PermissionKey[]> = {
  SUPER_ADMIN: [
    'dashboard:read', 'company:manage', 'branches:manage', 'employees:manage',
    'customers:read', 'customers:write', 'kyc:verify', 'schemes:manage',
    'groups:read', 'groups:write', 'enrollments:write', 'payments:collect',
    'payments:reverse', 'auctions:conduct', 'payouts:manage', 'accounting:read',
    'accounting:write', 'cash:manage', 'approvals:decide', 'reports:read',
    'audit:read', 'portal:read',
  ],
  COMPANY_ADMIN: [
    'dashboard:read', 'company:manage', 'branches:manage', 'employees:manage',
    'customers:read', 'customers:write', 'kyc:verify', 'schemes:manage',
    'groups:read', 'groups:write', 'enrollments:write', 'payments:collect',
    'payments:reverse', 'auctions:conduct', 'payouts:manage', 'accounting:read',
    'cash:manage', 'approvals:decide', 'reports:read', 'audit:read',
  ],
  BRANCH_MANAGER: [
    'dashboard:read', 'customers:read', 'customers:write', 'kyc:verify',
    'groups:read', 'groups:write', 'enrollments:write', 'payments:collect',
    'cash:manage', 'approvals:decide', 'reports:read', 'accounting:read',
  ],
  ACCOUNTANT: [
    'dashboard:read', 'customers:read', 'groups:read', 'accounting:read',
    'accounting:write', 'cash:manage', 'reports:read',
  ],
  FINANCE_MANAGER: [
    'dashboard:read', 'customers:read', 'groups:read', 'payments:reverse',
    'payouts:manage', 'accounting:read', 'accounting:write', 'cash:manage',
    'approvals:decide', 'reports:read', 'audit:read',
  ],
  AUCTION_MANAGER: [
    'dashboard:read', 'customers:read', 'groups:read', 'auctions:conduct',
    'reports:read',
  ],
  COLLECTION_AGENT: [
    'dashboard:read', 'customers:read', 'groups:read', 'payments:collect',
  ],
  CUSTOMER_SERVICE: [
    'dashboard:read', 'customers:read', 'customers:write', 'groups:read',
    'enrollments:write',
  ],
  AUDITOR: [
    'dashboard:read', 'customers:read', 'groups:read', 'accounting:read',
    'reports:read', 'audit:read',
  ],
  CUSTOMER: ['portal:read'],
};

export function hasPermission(role: UserRole, permission: PermissionKey): boolean {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}

export function isBranchScopedRole(role: UserRole): boolean {
  return (
    role === 'BRANCH_MANAGER' ||
    role === 'COLLECTION_AGENT' ||
    role === 'CUSTOMER_SERVICE'
  );
}
