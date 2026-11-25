import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rupeesToPaise,
  paiseToRupees,
  formatINR,
  formatDateDDMMYYYY,
  allocatePaymentAcrossInstallments,
  calculateAuctionSnapshot,
  validateJournalBalance,
  canDecideApproval,
  hasPermission,
} from './finance';

test('paise conversion avoids floating-point drift', () => {
  const a = rupeesToPaise('0.10');
  const b = rupeesToPaise('0.20');
  assert.equal(paiseToRupees(a + b), '0.30');
  assert.equal(formatINR(rupeesToPaise('1234567.50')), '₹12,34,567.50');
  assert.equal(formatINR(rupeesToPaise('50000')), '₹50,000.00');
  assert.equal(formatDateDDMMYYYY('2026-11-25'), '25-11-2026');
});

test('payment allocation handles exact, partial, and excess advance payments', () => {
  const obligations = [
    { id: 1, installmentNumber: 1, amountDuePaise: 500000n, amountPaidPaise: 0n, outstandingPaise: 500000n },
    { id: 2, installmentNumber: 2, amountDuePaise: 500000n, amountPaidPaise: 200000n, outstandingPaise: 300000n },
  ];

  // Partial payment of ₹2,500
  const partial = allocatePaymentAcrossInstallments(250000n, obligations);
  assert.equal(partial.allocations.length, 1);
  assert.equal(partial.allocations[0].newStatus, 'PARTIAL');
  assert.equal(partial.allocations[0].newOutstandingPaise, 250000n);
  assert.equal(partial.excessAdvancePaise, 0n);

  // Excess payment of ₹10,000 covers ₹5,000 + ₹3,000 with ₹2,000 advance
  const excess = allocatePaymentAcrossInstallments(1000000n, obligations);
  assert.equal(excess.allocations.length, 2);
  assert.equal(excess.allocations[0].newStatus, 'PAID');
  assert.equal(excess.allocations[1].newStatus, 'PAID');
  assert.equal(excess.totalAllocatedPaise, 800000n);
  assert.equal(excess.excessAdvancePaise, 200000n);

  assert.throws(() => allocatePaymentAcrossInstallments(0n, obligations));
});

test('auction calculation snapshot preserves exact rupee invariant and rounding residue', () => {
  const snap = calculateAuctionSnapshot({
    chitValuePaise: rupeesToPaise('500000.00'), // ₹5,00,000
    winningBidDiscountPaise: rupeesToPaise('125000.00'), // ₹1,25,000 (25%)
    subscriberCount: 30,
    maxDiscountPercentBps: 4000, // 40%
    commissionMethod: 'PERCENTAGE',
    commissionValue: 500n, // 5% = ₹25,000
    gstRateBps: 1200, // 12% GST on ₹25,000 = ₹3,000
    roundingPolicy: 'FLOOR_RUPEE',
    schemeVersionId: 1,
    formulaApprovalStatus: 'PENDING_LEGAL_ACCOUNTING',
  });

  assert.equal(snap.balancedInvariantVerified, true);
  assert.equal(paiseToRupees(snap.foremanCommissionPaise), '25000.00');
  assert.equal(paiseToRupees(snap.gstOnCommissionPaise), '3000.00');
  assert.equal(paiseToRupees(snap.netPrizePayableBeforeDeductionsPaise), '375000.00');
  // Pool = ₹1,00,000 / 30 = ₹3,333.33 -> floored to ₹3,333.00 * 30 = ₹99,990.00, residue = ₹10.00
  assert.equal(paiseToRupees(snap.perMemberDividendPaise), '3333.00');
  assert.equal(paiseToRupees(snap.totalDistributedDividendPaise), '99990.00');
  assert.equal(paiseToRupees(snap.roundingResiduePaise), '10.00');

  // Exceeding scheme max discount cap throws
  assert.throws(() =>
    calculateAuctionSnapshot({
      chitValuePaise: rupeesToPaise('500000.00'),
      winningBidDiscountPaise: rupeesToPaise('250000.00'), // 50% > 40%
      subscriberCount: 30,
      maxDiscountPercentBps: 4000,
      commissionMethod: 'PERCENTAGE',
      commissionValue: 500n,
      gstRateBps: 0,
      roundingPolicy: 'FLOOR_RUPEE',
      schemeVersionId: 1,
      formulaApprovalStatus: 'PENDING_LEGAL_ACCOUNTING',
    })
  );
});

test('double-entry journal validation strictly enforces Debits === Credits', () => {
  const valid = validateJournalBalance([
    { accountId: 1, debitPaise: 500000n, creditPaise: 0n },
    { accountId: 2, debitPaise: 0n, creditPaise: 500000n },
  ]);
  assert.equal(valid.valid, true);

  const unbalanced = validateJournalBalance([
    { accountId: 1, debitPaise: 500000n, creditPaise: 0n },
    { accountId: 2, debitPaise: 0n, creditPaise: 499999n },
  ]);
  assert.equal(unbalanced.valid, false);
});

test('maker-checker blocks self-approval and cross-branch approvals', () => {
  const selfApprove = canDecideApproval({
    actorUserId: 10,
    actorRole: 'SUPER_ADMIN',
    actorBranchId: null,
    requestedByUserId: 10,
    requestBranchId: 1,
  });
  assert.equal(selfApprove.allowed, false);

  const crossBranch = canDecideApproval({
    actorUserId: 12,
    actorRole: 'BRANCH_MANAGER',
    actorBranchId: 2,
    requestedByUserId: 10,
    requestBranchId: 1,
  });
  assert.equal(crossBranch.allowed, false);

  const legitimate = canDecideApproval({
    actorUserId: 1,
    actorRole: 'SUPER_ADMIN',
    actorBranchId: null,
    requestedByUserId: 10,
    requestBranchId: 1,
  });
  assert.equal(legitimate.allowed, true);

  // Auditor is strictly read-only
  assert.equal(hasPermission('AUDITOR', 'audit:read'), true);
  assert.equal(hasPermission('AUDITOR', 'payments:collect'), false);
  assert.equal(hasPermission('AUDITOR', 'approvals:decide'), false);
});
