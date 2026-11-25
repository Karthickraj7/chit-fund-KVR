import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

// 1. Companies
export const companies = pgTable('companies', {
  id: serial('id').primaryKey(),
  legalName: text('legal_name').notNull(),
  tradeName: text('trade_name').notNull(),
  registrationNumber: text('registration_number').notNull().default('PENDING_VERIFICATION'),
  gstin: text('gstin').notNull().default(''),
  address: text('address').notNull(),
  city: text('city').notNull().default('Chennai'),
  state: text('state').notNull().default('Tamil Nadu'),
  pincode: text('pincode').notNull().default('600001'),
  phone: text('phone').notNull(),
  email: text('email').notNull(),
  financialYearStartMonth: integer('financial_year_start_month').notNull().default(4),
  authorizedSignatoriesJson: text('authorized_signatories_json').notNull().default('[]'),
  accountingConfigJson: text('accounting_config_json').notNull().default('{}'),
  notificationConfigJson: text('notification_config_json').notNull().default('{}'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 2. Branches
export const branches = pgTable(
  'branches',
  {
    id: serial('id').primaryKey(),
    companyId: integer('company_id')
      .references(() => companies.id)
      .notNull(),
    branchCode: text('branch_code').notNull(),
    name: text('name').notNull(),
    district: text('district').notNull(),
    address: text('address').notNull(),
    managerName: text('manager_name').notNull(),
    phone: text('phone').notNull(),
    openingCashBalance: numeric('opening_cash_balance', { precision: 14, scale: 2 })
      .notNull()
      .default('0.00'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('branches_code_idx').on(table.branchCode)]
);

// 3. Users (supports both Firebase Auth UID and enterprise local credentials)
export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    uid: text('uid').notNull().unique(),
    username: text('username').notNull().unique(),
    email: text('email').notNull(),
    fullName: text('full_name').notNull(),
    passwordHash: text('password_hash'),
    role: text('role').notNull().default('CUSTOMER_SERVICE'),
    branchId: integer('branch_id').references(() => branches.id),
    employeeCode: text('employee_code'),
    customerId: integer('customer_id'),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('users_branch_idx').on(table.branchId)]
);

// 4. Server-side sessions (revokable Bearer tokens)
export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 5. Employees
export const employees = pgTable(
  'employees',
  {
    id: serial('id').primaryKey(),
    companyId: integer('company_id')
      .references(() => companies.id)
      .notNull(),
    branchId: integer('branch_id')
      .references(() => branches.id)
      .notNull(),
    userId: integer('user_id').references(() => users.id),
    employeeCode: text('employee_code').notNull(),
    fullName: text('full_name').notNull(),
    jobRole: text('job_role').notNull(),
    reportingManager: text('reporting_manager').notNull().default('Branch Manager'),
    phone: text('phone').notNull(),
    email: text('email').notNull(),
    assignedZone: text('assigned_zone').notNull().default('Central'),
    status: text('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('employees_code_idx').on(table.employeeCode)]
);

// 6. Customers (zero Aadhaar OTP/biometrics)
export const customers = pgTable(
  'customers',
  {
    id: serial('id').primaryKey(),
    companyId: integer('company_id')
      .references(() => companies.id)
      .notNull(),
    branchId: integer('branch_id')
      .references(() => branches.id)
      .notNull(),
    customerCode: text('customer_code').notNull(),
    fullName: text('full_name').notNull(),
    phone: text('phone').notNull(),
    email: text('email').notNull().default(''),
    dob: text('dob').notNull().default(''),
    panNumber: text('pan_number').notNull().default(''),
    address: text('address').notNull(),
    city: text('city').notNull(),
    state: text('state').notNull().default('Tamil Nadu'),
    pincode: text('pincode').notNull().default(''),
    kycStatus: text('kyc_status').notNull().default('PENDING'),
    assignedAgentId: integer('assigned_agent_id').references(() => employees.id),
    nomineeName: text('nominee_name').notNull().default(''),
    nomineeRelation: text('nominee_relation').notNull().default(''),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('customers_code_idx').on(table.customerCode),
    index('customers_branch_idx').on(table.branchId),
    index('customers_phone_idx').on(table.phone),
  ]
);

// 7. KYC Documents
export const kycDocuments = pgTable('kyc_documents', {
  id: serial('id').primaryKey(),
  customerId: integer('customer_id')
    .references(() => customers.id)
    .notNull(),
  branchId: integer('branch_id')
    .references(() => branches.id)
    .notNull(),
  documentType: text('document_type').notNull(), // PAN, VOTER_ID, DRIVING_LICENSE, PASSPORT, ADDRESS_PROOF, PHOTOGRAPH
  documentNumberMasked: text('document_number_masked').notNull(),
  verificationStatus: text('verification_status').notNull().default('PENDING'), // PENDING, VERIFIED, REJECTED
  verifiedByUserId: integer('verified_by_user_id').references(() => users.id),
  verifiedAt: timestamp('verified_at'),
  notes: text('notes').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 8. Chit Schemes & Versioned Terms
export const chitSchemes = pgTable(
  'chit_schemes',
  {
    id: serial('id').primaryKey(),
    companyId: integer('company_id')
      .references(() => companies.id)
      .notNull(),
    schemeCode: text('scheme_code').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').notNull().default('DRAFT'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('schemes_code_idx').on(table.schemeCode)]
);

export const schemeVersions = pgTable('scheme_versions', {
  id: serial('id').primaryKey(),
  schemeId: integer('scheme_id')
    .references(() => chitSchemes.id)
    .notNull(),
  versionNumber: integer('version_number').notNull().default(1),
  chitValue: numeric('chit_value', { precision: 14, scale: 2 }).notNull(),
  subscriberCount: integer('subscriber_count').notNull(),
  durationMonths: integer('duration_months').notNull(),
  monthlyInstallment: numeric('monthly_installment', { precision: 14, scale: 2 }).notNull(),
  maxDiscountPercent: numeric('max_discount_percent', { precision: 5, scale: 2 }).notNull(),
  foremanCommissionMethod: text('foreman_commission_method').notNull().default('PERCENTAGE'),
  foremanCommissionValue: numeric('foreman_commission_value', { precision: 14, scale: 2 }).notNull(),
  gstRatePercent: numeric('gst_rate_percent', { precision: 5, scale: 2 }).notNull().default('0.00'),
  dueDayOfMonth: integer('due_day_of_month').notNull().default(10),
  lateFeePolicy: text('late_fee_policy').notNull().default('TBD_BUSINESS — Disabled until approved'),
  auctionMethod: text('auction_method').notNull().default('OPEN_AUCTION'),
  dividendRoundingPolicy: text('dividend_rounding_policy').notNull().default('FLOOR_RUPEE'),
  eligibilityNotes: text('eligibility_notes').notNull().default('Verified KYC required'),
  securityRequirements: text('security_requirements').notNull().default('Guarantor + approved security'),
  formulaApprovalStatus: text('formula_approval_status').notNull().default('PENDING_LEGAL_ACCOUNTING'),
  statutoryReferenceNote: text('statutory_reference_note').notNull().default('TBD_LEGAL — Verify with counsel'),
  effectiveFrom: text('effective_from').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 9. Chit Groups
export const chitGroups = pgTable(
  'chit_groups',
  {
    id: serial('id').primaryKey(),
    companyId: integer('company_id')
      .references(() => companies.id)
      .notNull(),
    branchId: integer('branch_id')
      .references(() => branches.id)
      .notNull(),
    schemeVersionId: integer('scheme_version_id')
      .references(() => schemeVersions.id)
      .notNull(),
    groupCode: text('group_code').notNull(),
    name: text('name').notNull(),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
    subscriberCapacity: integer('subscriber_capacity').notNull(),
    currentInstallmentMonth: integer('current_installment_month').notNull().default(1),
    status: text('status').notNull().default('DRAFT'),
    psoNumber: text('pso_number').notNull().default(''),
    registrationRef: text('registration_ref').notNull().default(''),
    commencementCertRef: text('commencement_cert_ref').notNull().default(''),
    foremanFdBank: text('foreman_fd_bank').notNull().default(''),
    foremanFdAmount: numeric('foreman_fd_amount', { precision: 14, scale: 2 }).notNull().default('0.00'),
    foremanFdMaturityDate: text('foreman_fd_maturity_date').notNull().default(''),
    approvedByUserId: integer('approved_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('groups_code_idx').on(table.groupCode),
    index('groups_branch_idx').on(table.branchId),
  ]
);

// 10. Memberships (Enrollments)
export const memberships = pgTable(
  'memberships',
  {
    id: serial('id').primaryKey(),
    groupId: integer('group_id')
      .references(() => chitGroups.id)
      .notNull(),
    customerId: integer('customer_id')
      .references(() => customers.id)
      .notNull(),
    branchId: integer('branch_id')
      .references(() => branches.id)
      .notNull(),
    ticketNumber: integer('ticket_number').notNull(),
    enrollmentDate: text('enrollment_date').notNull(),
    status: text('status').notNull().default('PENDING_APPROVAL'),
    isPrized: boolean('is_prized').notNull().default(false),
    prizedInstallmentMonth: integer('prized_installment_month'),
    nomineeName: text('nominee_name').notNull().default(''),
    agreementAccepted: boolean('agreement_accepted').notNull().default(false),
    substitutedFromId: integer('substituted_from_id'),
    approvedByUserId: integer('approved_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('memberships_group_idx').on(table.groupId),
    index('memberships_customer_idx').on(table.customerId),
  ]
);

// 11. Installment Schedules
export const installmentSchedules = pgTable(
  'installment_schedules',
  {
    id: serial('id').primaryKey(),
    membershipId: integer('membership_id')
      .references(() => memberships.id)
      .notNull(),
    groupId: integer('group_id')
      .references(() => chitGroups.id)
      .notNull(),
    customerId: integer('customer_id')
      .references(() => customers.id)
      .notNull(),
    branchId: integer('branch_id')
      .references(() => branches.id)
      .notNull(),
    installmentNumber: integer('installment_number').notNull(),
    dueDate: text('due_date').notNull(),
    baseInstallment: numeric('base_installment', { precision: 14, scale: 2 }).notNull(),
    dividendAdjustment: numeric('dividend_adjustment', { precision: 14, scale: 2 }).notNull().default('0.00'),
    lateFee: numeric('late_fee', { precision: 14, scale: 2 }).notNull().default('0.00'),
    amountDue: numeric('amount_due', { precision: 14, scale: 2 }).notNull(),
    amountPaid: numeric('amount_paid', { precision: 14, scale: 2 }).notNull().default('0.00'),
    outstandingAmount: numeric('outstanding_amount', { precision: 14, scale: 2 }).notNull(),
    status: text('status').notNull().default('UPCOMING'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('installment_member_num_idx').on(table.membershipId, table.installmentNumber),
    index('installment_branch_status_idx').on(table.branchId, table.status),
  ]
);

// 12. Payments (Immutable posted records + idempotency key)
export const payments = pgTable(
  'payments',
  {
    id: serial('id').primaryKey(),
    companyId: integer('company_id')
      .references(() => companies.id)
      .notNull(),
    branchId: integer('branch_id')
      .references(() => branches.id)
      .notNull(),
    customerId: integer('customer_id')
      .references(() => customers.id)
      .notNull(),
    membershipId: integer('membership_id')
      .references(() => memberships.id)
      .notNull(),
    receiptNumber: text('receipt_number').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    paymentDate: text('payment_date').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    paymentMode: text('payment_mode').notNull(),
    referenceNumber: text('reference_number').notNull().default(''),
    status: text('status').notNull().default('SUCCESSFUL'),
    collectedByUserId: integer('collected_by_user_id').references(() => users.id),
    verifiedByUserId: integer('verified_by_user_id').references(() => users.id),
    reversedPaymentId: integer('reversed_payment_id'),
    remarks: text('remarks').notNull().default(''),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('payments_receipt_idx').on(table.receiptNumber),
    uniqueIndex('payments_idempotency_idx').on(table.idempotencyKey),
    index('payments_branch_date_idx').on(table.branchId, table.paymentDate),
  ]
);

// 13. Payment Allocations
export const paymentAllocations = pgTable('payment_allocations', {
  id: serial('id').primaryKey(),
  paymentId: integer('payment_id')
    .references(() => payments.id)
    .notNull(),
  installmentScheduleId: integer('installment_schedule_id')
    .references(() => installmentSchedules.id)
    .notNull(),
  allocatedAmount: numeric('allocated_amount', { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 14. Auctions
export const auctions = pgTable('auctions', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id')
    .references(() => chitGroups.id)
    .notNull(),
  branchId: integer('branch_id')
    .references(() => branches.id)
    .notNull(),
  installmentNumber: integer('installment_number').notNull(),
  scheduledAt: text('scheduled_at').notNull(),
  venue: text('venue').notNull().default('Branch Auction Hall'),
  auctionMethod: text('auction_method').notNull().default('OPEN_AUCTION'),
  status: text('status').notNull().default('SCHEDULED'),
  winningMembershipId: integer('winning_membership_id').references(() => memberships.id),
  winningBidDiscount: numeric('winning_bid_discount', { precision: 14, scale: 2 }).notNull().default('0.00'),
  foremanCommissionAmount: numeric('foreman_commission_amount', { precision: 14, scale: 2 }).notNull().default('0.00'),
  gstAmount: numeric('gst_amount', { precision: 14, scale: 2 }).notNull().default('0.00'),
  netPrizeAmount: numeric('net_prize_amount', { precision: 14, scale: 2 }).notNull().default('0.00'),
  distributableDividend: numeric('distributable_dividend', { precision: 14, scale: 2 }).notNull().default('0.00'),
  perMemberDividend: numeric('per_member_dividend', { precision: 14, scale: 2 }).notNull().default('0.00'),
  roundingResidue: numeric('rounding_residue', { precision: 14, scale: 2 }).notNull().default('0.00'),
  calculationSnapshotJson: text('calculation_snapshot_json').notNull().default('{}'),
  minutesText: text('minutes_text').notNull().default(''),
  disputeNotes: text('dispute_notes').notNull().default(''),
  conductedByUserId: integer('conducted_by_user_id').references(() => users.id),
  approvedByUserId: integer('approved_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 15. Immutable Bids
export const bids = pgTable('bids', {
  id: serial('id').primaryKey(),
  auctionId: integer('auction_id')
    .references(() => auctions.id)
    .notNull(),
  membershipId: integer('membership_id')
    .references(() => memberships.id)
    .notNull(),
  customerId: integer('customer_id')
    .references(() => customers.id)
    .notNull(),
  bidAmountDiscount: numeric('bid_amount_discount', { precision: 14, scale: 2 }).notNull(),
  isProxyBid: boolean('is_proxy_bid').notNull().default(false),
  bidRevision: integer('bid_revision').notNull().default(1),
  placedByUserId: integer('placed_by_user_id').references(() => users.id),
  placedAt: timestamp('placed_at').defaultNow().notNull(),
});

// 16. Dividend Allocations
export const dividendAllocations = pgTable('dividend_allocations', {
  id: serial('id').primaryKey(),
  auctionId: integer('auction_id')
    .references(() => auctions.id)
    .notNull(),
  membershipId: integer('membership_id')
    .references(() => memberships.id)
    .notNull(),
  customerId: integer('customer_id')
    .references(() => customers.id)
    .notNull(),
  dividendAmount: numeric('dividend_amount', { precision: 14, scale: 2 }).notNull(),
  appliedToInstallmentNumber: integer('applied_to_installment_number').notNull(),
  calculationRef: text('calculation_ref').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 17. Prize Payouts
export const prizePayouts = pgTable('prize_payouts', {
  id: serial('id').primaryKey(),
  auctionId: integer('auction_id')
    .references(() => auctions.id)
    .notNull(),
  membershipId: integer('membership_id')
    .references(() => memberships.id)
    .notNull(),
  customerId: integer('customer_id')
    .references(() => customers.id)
    .notNull(),
  branchId: integer('branch_id')
    .references(() => branches.id)
    .notNull(),
  grossPrizeAmount: numeric('gross_prize_amount', { precision: 14, scale: 2 }).notNull(),
  overdueDeduction: numeric('overdue_deduction', { precision: 14, scale: 2 }).notNull().default('0.00'),
  otherDeductions: numeric('other_deductions', { precision: 14, scale: 2 }).notNull().default('0.00'),
  netPayableAmount: numeric('net_payable_amount', { precision: 14, scale: 2 }).notNull(),
  kycVerified: boolean('kyc_verified').notNull().default(false),
  guarantorVerified: boolean('guarantor_verified').notNull().default(false),
  securityVerified: boolean('security_verified').notNull().default(false),
  duesVerified: boolean('dues_verified').notNull().default(false),
  status: text('status').notNull().default('PENDING_VERIFICATION'),
  payoutMode: text('payout_mode').notNull().default('NEFT'),
  bankReference: text('bank_reference').notNull().default(''),
  requestedByUserId: integer('requested_by_user_id').references(() => users.id),
  approvedByUserId: integer('approved_by_user_id').references(() => users.id),
  paidAt: timestamp('paid_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 18. Guarantors
export const guarantors = pgTable('guarantors', {
  id: serial('id').primaryKey(),
  customerId: integer('customer_id')
    .references(() => customers.id)
    .notNull(),
  membershipId: integer('membership_id').references(() => memberships.id),
  branchId: integer('branch_id')
    .references(() => branches.id)
    .notNull(),
  fullName: text('full_name').notNull(),
  phone: text('phone').notNull(),
  panNumber: text('pan_number').notNull().default(''),
  relationship: text('relationship').notNull(),
  address: text('address').notNull(),
  consentRecorded: boolean('consent_recorded').notNull().default(false),
  verificationStatus: text('verification_status').notNull().default('PENDING'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 19. Securities
export const securities = pgTable('securities', {
  id: serial('id').primaryKey(),
  membershipId: integer('membership_id')
    .references(() => memberships.id)
    .notNull(),
  customerId: integer('customer_id')
    .references(() => customers.id)
    .notNull(),
  branchId: integer('branch_id')
    .references(() => branches.id)
    .notNull(),
  securityType: text('security_type').notNull(), // PERSONAL_GUARANTEE, BANK_GUARANTEE, FIXED_DEPOSIT, APPROVED_COLLATERAL
  documentNumber: text('document_number').notNull(),
  valuationAmount: numeric('valuation_amount', { precision: 14, scale: 2 }).notNull(),
  expiryDate: text('expiry_date').notNull().default(''),
  status: text('status').notNull().default('SUBMITTED'), // SUBMITTED, VERIFIED, RELEASE_REQUESTED, RELEASED
  verifiedByUserId: integer('verified_by_user_id').references(() => users.id),
  releasedByUserId: integer('released_by_user_id').references(() => users.id),
  notes: text('notes').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 20. Chart of Accounts
export const chartOfAccounts = pgTable(
  'chart_of_accounts',
  {
    id: serial('id').primaryKey(),
    companyId: integer('company_id')
      .references(() => companies.id)
      .notNull(),
    accountCode: text('account_code').notNull(),
    accountName: text('account_name').notNull(),
    accountType: text('account_type').notNull(), // ASSET, LIABILITY, EQUITY, INCOME, EXPENSE
    parentCode: text('parent_code').notNull().default(''),
    isSystem: boolean('is_system').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
  },
  (table) => [uniqueIndex('coa_code_idx').on(table.accountCode)]
);

// 21. Accounting Periods
export const accountingPeriods = pgTable('accounting_periods', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id')
    .references(() => companies.id)
    .notNull(),
  periodName: text('period_name').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  status: text('status').notNull().default('OPEN'),
});

// 22. Journal Entries (Immutable once POSTED)
export const journalEntries = pgTable(
  'journal_entries',
  {
    id: serial('id').primaryKey(),
    companyId: integer('company_id')
      .references(() => companies.id)
      .notNull(),
    branchId: integer('branch_id')
      .references(() => branches.id)
      .notNull(),
    periodId: integer('period_id').references(() => accountingPeriods.id),
    entryNumber: text('entry_number').notNull(),
    entryDate: text('entry_date').notNull(),
    description: text('description').notNull(),
    referenceType: text('reference_type').notNull().default('MANUAL'),
    referenceId: integer('reference_id'),
    totalDebit: numeric('total_debit', { precision: 14, scale: 2 }).notNull(),
    totalCredit: numeric('total_credit', { precision: 14, scale: 2 }).notNull(),
    status: text('status').notNull().default('POSTED'),
    reversedEntryId: integer('reversed_entry_id'),
    createdByUserId: integer('created_by_user_id').references(() => users.id),
    approvedByUserId: integer('approved_by_user_id').references(() => users.id),
    postedAt: timestamp('posted_at').defaultNow(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('journal_entry_num_idx').on(table.entryNumber)]
);

// 23. Journal Lines
export const journalLines = pgTable('journal_lines', {
  id: serial('id').primaryKey(),
  journalEntryId: integer('journal_entry_id')
    .references(() => journalEntries.id)
    .notNull(),
  accountId: integer('account_id')
    .references(() => chartOfAccounts.id)
    .notNull(),
  debit: numeric('debit', { precision: 14, scale: 2 }).notNull().default('0.00'),
  credit: numeric('credit', { precision: 14, scale: 2 }).notNull().default('0.00'),
  narration: text('narration').notNull().default(''),
});

// 24. Branch Cash Registers
export const branchCashRegisters = pgTable('branch_cash_registers', {
  id: serial('id').primaryKey(),
  branchId: integer('branch_id')
    .references(() => branches.id)
    .notNull(),
  registerDate: text('register_date').notNull(),
  openingBalance: numeric('opening_balance', { precision: 14, scale: 2 }).notNull().default('0.00'),
  cashCollections: numeric('cash_collections', { precision: 14, scale: 2 }).notNull().default('0.00'),
  cashDisbursements: numeric('cash_disbursements', { precision: 14, scale: 2 }).notNull().default('0.00'),
  cashTransfers: numeric('cash_transfers', { precision: 14, scale: 2 }).notNull().default('0.00'),
  closingBalance: numeric('closing_balance', { precision: 14, scale: 2 }).notNull().default('0.00'),
  varianceAmount: numeric('variance_amount', { precision: 14, scale: 2 }).notNull().default('0.00'),
  status: text('status').notNull().default('OPEN'),
  closedByUserId: integer('closed_by_user_id').references(() => users.id),
  notes: text('notes').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 25. Bank Accounts & Reconciliation
export const bankAccounts = pgTable('bank_accounts', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id')
    .references(() => companies.id)
    .notNull(),
  branchId: integer('branch_id')
    .references(() => branches.id)
    .notNull(),
  bankName: text('bank_name').notNull(),
  accountNumberMasked: text('account_number_masked').notNull(),
  ifscCode: text('ifsc_code').notNull(),
  accountType: text('account_type').notNull().default('CURRENT'),
  bookBalance: numeric('book_balance', { precision: 14, scale: 2 }).notNull().default('0.00'),
  statementBalance: numeric('statement_balance', { precision: 14, scale: 2 }).notNull().default('0.00'),
  lastReconciledAt: timestamp('last_reconciled_at'),
  isActive: boolean('is_active').notNull().default(true),
});

export const bankReconciliations = pgTable('bank_reconciliations', {
  id: serial('id').primaryKey(),
  bankAccountId: integer('bank_account_id')
    .references(() => bankAccounts.id)
    .notNull(),
  statementDate: text('statement_date').notNull(),
  bankReference: text('bank_reference').notNull(),
  description: text('description').notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  direction: text('direction').notNull().default('CREDIT'),
  matchedPaymentId: integer('matched_payment_id').references(() => payments.id),
  status: text('status').notNull().default('UNMATCHED'),
  reconciledByUserId: integer('reconciled_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 26. Maker-Checker Approval Requests
export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: serial('id').primaryKey(),
    companyId: integer('company_id')
      .references(() => companies.id)
      .notNull(),
    branchId: integer('branch_id')
      .references(() => branches.id)
      .notNull(),
    requestType: text('request_type').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: integer('entity_id').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull().default('0.00'),
    payloadJson: text('payload_json').notNull().default('{}'),
    status: text('status').notNull().default('PENDING'), // PENDING, APPROVED, REJECTED
    requestedByUserId: integer('requested_by_user_id')
      .references(() => users.id)
      .notNull(),
    decidedByUserId: integer('decided_by_user_id').references(() => users.id),
    decisionNotes: text('decision_notes').notNull().default(''),
    decidedAt: timestamp('decided_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('approvals_status_idx').on(table.status)]
);

// 27. Outstandings & Collection Follow-ups
export const collectionFollowUps = pgTable('collection_follow_ups', {
  id: serial('id').primaryKey(),
  membershipId: integer('membership_id')
    .references(() => memberships.id)
    .notNull(),
  customerId: integer('customer_id')
    .references(() => customers.id)
    .notNull(),
  branchId: integer('branch_id')
    .references(() => branches.id)
    .notNull(),
  assignedAgentId: integer('assigned_agent_id').references(() => employees.id),
  overdueAmount: numeric('overdue_amount', { precision: 14, scale: 2 }).notNull(),
  daysPastDue: integer('days_past_due').notNull().default(0),
  promiseToPayDate: text('promise_to_pay_date').notNull().default(''),
  actionType: text('action_type').notNull().default('CALL'),
  notes: text('notes').notNull().default(''),
  status: text('status').notNull().default('OPEN'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 28. Documents Registry
export const documents = pgTable(
  'documents',
  {
    id: serial('id').primaryKey(),
    companyId: integer('company_id')
      .references(() => companies.id)
      .notNull(),
    branchId: integer('branch_id')
      .references(() => branches.id)
      .notNull(),
    documentNumber: text('document_number').notNull(),
    documentType: text('document_type').notNull(),
    version: integer('version').notNull().default(1),
    title: text('title').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: integer('entity_id').notNull(),
    customerId: integer('customer_id').references(() => customers.id),
    contentSnapshotJson: text('content_snapshot_json').notNull().default('{}'),
    generatedByUserId: integer('generated_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('documents_num_idx').on(table.documentNumber)]
);

// 29. Notifications Outbox
export const notificationsOutbox = pgTable('notifications_outbox', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id')
    .references(() => companies.id)
    .notNull(),
  branchId: integer('branch_id')
    .references(() => branches.id)
    .notNull(),
  channel: text('channel').notNull().default('IN_APP'), // IN_APP, SMS, WHATSAPP, EMAIL
  recipient: text('recipient').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  status: text('status').notNull().default('DELIVERED_IN_APP'),
  entityType: text('entity_type').notNull().default('SYSTEM'),
  entityId: integer('entity_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 30. eNACH / UPI AutoPay Mandates
export const mandates = pgTable('mandates', {
  id: serial('id').primaryKey(),
  customerId: integer('customer_id')
    .references(() => customers.id)
    .notNull(),
  membershipId: integer('membership_id')
    .references(() => memberships.id)
    .notNull(),
  branchId: integer('branch_id')
    .references(() => branches.id)
    .notNull(),
  mandateType: text('mandate_type').notNull(), // ENACH, UPI_AUTOPAY
  umrnRef: text('umrn_ref').notNull(),
  bankOrVpa: text('bank_or_vpa').notNull(),
  maxAmount: numeric('max_amount', { precision: 14, scale: 2 }).notNull(),
  status: text('status').notNull().default('REGISTERED'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 31. Immutable Audit Logs
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    companyId: integer('company_id')
      .references(() => companies.id)
      .notNull(),
    branchId: integer('branch_id').references(() => branches.id),
    actorUserId: integer('actor_user_id').references(() => users.id),
    actorUsername: text('actor_username').notNull(),
    actorRole: text('actor_role').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    beforeJson: text('before_json').notNull().default('{}'),
    afterJson: text('after_json').notNull().default('{}'),
    ipAddress: text('ip_address').notNull().default(''),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('audit_created_idx').on(table.createdAt)]
);
