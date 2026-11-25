import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { eq, and, gt } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { users, sessions, auditLogs } from '../db/schema.ts';
import { adminAuth } from '../lib/firebase-admin.ts';
import {
  hasPermission,
  isBranchScopedRole,
  type PermissionKey,
  type UserRole,
} from '../domain/finance.ts';

export interface AuthenticatedUser {
  id: number;
  uid: string;
  username: string;
  email: string;
  fullName: string;
  role: UserRole;
  branchId: number | null;
  customerId: number | null;
  mustChangePassword: boolean;
  mfaEnabled: boolean;
}

export interface AuthRequest extends Request {
  user?: AuthenticatedUser;
  requestId?: string;
}

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(plain: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !storedHash.startsWith('scrypt$')) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3) return false;
  const [, salt, expectedHex] = parts;
  const actualBuf = crypto.scryptSync(plain, salt, 64);
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSessionForUser(userId: number): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(rawToken);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12); // 12-hour session
  await db.insert(sessions).values({
    tokenHash,
    userId,
    expiresAt,
  });
  return rawToken;
}

export async function revokeSessionToken(rawToken: string): Promise<void> {
  const tokenHash = hashSessionToken(rawToken);
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

export async function writeAuditLog(params: {
  companyId?: number;
  branchId?: number | null;
  actor: AuthenticatedUser | { id: number | null; username: string; role: string };
  action: string;
  entityType: string;
  entityId: string | number;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
}): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      companyId: params.companyId ?? 1,
      branchId: params.branchId ?? null,
      actorUserId: params.actor.id ?? null,
      actorUsername: params.actor.username,
      actorRole: params.actor.role,
      action: params.action,
      entityType: params.entityType,
      entityId: String(params.entityId),
      beforeJson: JSON.stringify(params.before ?? {}),
      afterJson: JSON.stringify(params.after ?? {}),
      ipAddress: params.ipAddress ?? '',
    });
  } catch (err) {
    console.error('Audit log insert failed:', err);
  }
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required. Please sign in.' },
    });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Invalid authorization token.' },
    });
  }

  try {
    // 1. Check revokable PostgreSQL session token first
    const tokenHash = hashSessionToken(token);
    const sessionRows = await db
      .select({
        userId: sessions.userId,
      })
      .from(sessions)
      .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
      .limit(1);

    if (sessionRows.length > 0) {
      const userRows = await db
        .select()
        .from(users)
        .where(and(eq(users.id, sessionRows[0].userId), eq(users.isActive, true)))
        .limit(1);

      if (userRows.length === 0) {
        return res.status(401).json({
          error: { code: 'ACCOUNT_INACTIVE', message: 'User account is suspended or inactive.' },
        });
      }

      const u = userRows[0];
      req.user = {
        id: u.id,
        uid: u.uid,
        username: u.username,
        email: u.email,
        fullName: u.fullName,
        role: u.role as UserRole,
        branchId: u.branchId,
        customerId: u.customerId,
        mustChangePassword: u.mustChangePassword,
        mfaEnabled: u.mfaEnabled,
      };
      return next();
    }

    // 2. Otherwise verify Firebase Auth ID Token (Google Sign-In)
    const decoded = await adminAuth.verifyIdToken(token);
    const email = decoded.email ?? `${decoded.uid}@firebase.local`;
    const displayName = decoded.name ?? email.split('@')[0];

    // Upsert Firebase user into PostgreSQL safely
    const existing = await db.select().from(users).where(eq(users.uid, decoded.uid)).limit(1);
    let u = existing[0];
    if (!u) {
      const safeUsername = email.split('@')[0].replace(/[^a-zA-Z0-9_.-]/g, '').toLowerCase() + '_' + decoded.uid.slice(0, 5);
      const inserted = await db
        .insert(users)
        .values({
          uid: decoded.uid,
          username: safeUsername,
          email,
          fullName: displayName,
          role: 'SUPER_ADMIN',
          branchId: null,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: users.uid,
          set: { email, lastLoginAt: new Date() },
        })
        .returning();
      u = inserted[0];
    }

    if (!u.isActive) {
      return res.status(403).json({
        error: { code: 'ACCOUNT_SUSPENDED', message: 'User access has been suspended.' },
      });
    }

    req.user = {
      id: u.id,
      uid: u.uid,
      username: u.username,
      email: u.email,
      fullName: u.fullName,
      role: u.role as UserRole,
      branchId: u.branchId,
      customerId: u.customerId,
      mustChangePassword: u.mustChangePassword,
      mfaEnabled: u.mfaEnabled,
    };
    return next();
  } catch (err) {
    console.error('Auth verification error:', err);
    return res.status(401).json({
      error: { code: 'INVALID_TOKEN', message: 'Session expired or invalid token. Please sign in again.' },
    });
  }
}

export function requirePermission(permission: PermissionKey) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } });
    }
    if (!hasPermission(req.user.role, permission)) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: `Insufficient permission (${permission}) for role ${req.user.role}.`,
        },
      });
    }
    return next();
  };
}

/**
 * Resolve effective branch filter enforcing server-side branch isolation.
 * Branch-scoped roles CANNOT override their branch via query parameters.
 */
export function resolveScopedBranchId(req: AuthRequest, requestedBranchId?: string | number | null): number | null {
  if (!req.user) return null;
  if (isBranchScopedRole(req.user.role) && req.user.branchId !== null) {
    return req.user.branchId;
  }
  if (requestedBranchId === undefined || requestedBranchId === null || requestedBranchId === '' || requestedBranchId === 'all') {
    return null;
  }
  const parsed = Number(requestedBranchId);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
