import fs from 'node:fs';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

let projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
try {
  const configUrl = new URL('../../firebase-applet-config.json', import.meta.url);
  const parsed = JSON.parse(fs.readFileSync(configUrl, 'utf8')) as { projectId?: string };
  if (parsed.projectId) {
    projectId = parsed.projectId;
  }
} catch {
  // Fallback to environment project ID if config file is unavailable
}

if (!getApps().length) {
  initializeApp(projectId ? { projectId } : undefined);
}

export const adminAuth = getAuth();
