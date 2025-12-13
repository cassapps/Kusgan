// Simple client-side admin gating.
// NOTE: This is UI-only. For real enforcement, use Firestore rules + custom claims.

export const ADMIN_UIDS = [
  // johanna.cass@gmail.com
  '7vvGOMnGIyZ9UocVYz0CtGPyKLi1',
];

export function isAdminUid(uid) {
  const u = String(uid || '').trim();
  if (!u) return false;
  return ADMIN_UIDS.includes(u);
}
