export interface SessionUser {
  id: number;
  username: string;
  email: string;
  fullName: string;
  role: string;
  branchId: number | null;
  customerId: number | null;
  mustChangePassword: boolean;
  mfaEnabled: boolean;
}

let inMemoryBearerToken: string | null = null;

export function setAuthToken(token: string | null) {
  inMemoryBearerToken = token;
}

export function getAuthToken(): string | null {
  return inMemoryBearerToken;
}

export function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function apiRequest<T = any>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    idempotencyKey?: string;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (inMemoryBearerToken) {
    headers['Authorization'] = `Bearer ${inMemoryBearerToken}`;
  }
  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  const res = await fetch(`/api/v1${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = payload?.error?.message || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return payload.data as T;
}

export function downloadCSV(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const escape = (val: string | number | null | undefined) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
