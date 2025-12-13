#!/usr/bin/env node
// Backfill member-level validity fields (membershipEnd/coachEnd) from payments.
//
// Why: The UI (Dashboard/Members) uses member docs for active counts and Valid Until columns
// to avoid scanning payments. This script populates those fields for existing data.
//
// Usage:
//   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json
//   node scripts/firestore-backfill-member-validity.js
//
// Optional:
//   DRY_RUN=1 node scripts/firestore-backfill-member-validity.js
//   LIMIT=500 node scripts/firestore-backfill-member-validity.js

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyPath || !fs.existsSync(keyPath)) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS to a valid service account JSON before running this script.');
  process.exit(2);
}

const DRY_RUN = String(process.env.DRY_RUN || '') === '1';
const LIMIT = Number(process.env.LIMIT || 0) || 0;

const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

function str(v) {
  return String(v ?? '').trim();
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  }
  return undefined;
}

function maxYmd(a, b) {
  const aa = str(a);
  const bb = str(b);
  if (!aa) return bb;
  if (!bb) return aa;
  return aa >= bb ? aa : bb;
}

async function main() {
  console.log('Backfilling member validity from payments...');
  console.log('DRY_RUN=', DRY_RUN, 'LIMIT=', LIMIT || 'none');

  // Read payments in pages.
  let q = db.collection('payments').orderBy('__name__');
  let last = null;

  const byMember = new Map(); // memberId -> { gymUntil, coachUntil }
  let scanned = 0;

  while (true) {
    let page = q.limit(1000);
    if (last) page = page.startAfter(last);
    const snap = await page.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned++;
      const p = doc.data() || {};
      const mid = str(p.MemberID || p.memberId || p.memberid || p.member || '');
      if (!mid) continue;

      const gymUntil = str(
        pick(p, ['GymValidUntil', 'gymvaliduntil', 'gym_valid_until', 'gym_until', 'membershipEnd', 'membership_end', 'EndDate', 'enddate', 'end_date', 'valid_until', 'expiry', 'expires', 'until'])
      );
      const coachUntil = str(
        pick(p, ['CoachValidUntil', 'coachvaliduntil', 'coach_valid_until', 'coach_until', 'coachEnd', 'coach_end'])
      );

      if (!gymUntil && !coachUntil) continue;

      const cur = byMember.get(mid) || { gymUntil: '', coachUntil: '' };
      byMember.set(mid, {
        gymUntil: maxYmd(cur.gymUntil, gymUntil),
        coachUntil: maxYmd(cur.coachUntil, coachUntil),
      });

      if (LIMIT && byMember.size >= LIMIT) break;
    }

    last = snap.docs[snap.docs.length - 1];
    if (LIMIT && byMember.size >= LIMIT) break;
  }

  console.log('Payments scanned:', scanned);
  console.log('Members to update:', byMember.size);

  let updated = 0;
  const nowIso = new Date().toISOString();

  for (const [mid, v] of byMember.entries()) {
    const patch = {};
    if (v.gymUntil) {
      patch.membershipEnd = v.gymUntil;
      patch.membership_end = v.gymUntil;
      patch.membershipState = 'active';
      patch.membership_state = 'active';
    }
    if (v.coachUntil) {
      patch.coachEnd = v.coachUntil;
      patch.coach_end = v.coachUntil;
      patch.coachState = 'active';
      patch.coach_state = 'active';
    }
    patch.updatedAt = nowIso;
    patch.updated_at = nowIso;

    if (DRY_RUN) {
      updated++;
      continue;
    }

    // Try doc id = member id, else query by MemberID field.
    const directRef = db.collection('members').doc(mid);
    const directSnap = await directRef.get();
    if (directSnap.exists) {
      await directRef.set(patch, { merge: true });
      updated++;
      continue;
    }

    const hit = await db.collection('members').where('MemberID', '==', mid).limit(1).get();
    if (!hit.empty) {
      await hit.docs[0].ref.set(patch, { merge: true });
      updated++;
    }
  }

  console.log('Done. Updated:', updated, DRY_RUN ? '(dry-run)' : '');
}

main().catch((e) => {
  console.error('Backfill failed', e);
  process.exit(1);
});
