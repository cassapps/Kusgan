#!/usr/bin/env node
// Fix existing member nicknames to conform to:
// - max 10 characters
// - letters/numbers and '-' only
// - no spaces (drop everything after first space)
// Updates both `members` docs and `nicknames/{nickLower}` mapping in a transaction.
//
// Usage:
//   node scripts/firestore-fix-nicknames.js            # dry run
//   node scripts/firestore-fix-nicknames.js --apply   # apply changes
//
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import fs from 'fs';

const APPLY = process.argv.includes('--apply');

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyPath || !fs.existsSync(keyPath)) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS to a valid service account JSON before running this script.');
  process.exit(2);
}

function sanitizeExistingNickname(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const head = raw.split(/\s+/)[0] || '';
  const cleaned = head.replace(/[^A-Za-z0-9-]/g, '');
  return cleaned.toUpperCase().slice(0, 10);
}

function isValidNickname(input) {
  const s = String(input || '').trim();
  return /^[A-Za-z0-9-]{1,10}$/.test(s);
}

function pickNickname(data) {
  if (!data) return '';
  return (
    data.NickName ||
    data.nickName ||
    data.nickname ||
    data.nick_name ||
    data.Nick ||
    ''
  );
}

function uniqueNick(baseUpper, memberId, takenLowerToMemberId) {
  const base = String(baseUpper || '').trim().toUpperCase();
  if (!isValidNickname(base)) return '';
  const baseLower = base.toLowerCase();
  const owner = takenLowerToMemberId.get(baseLower);
  if (!owner || owner === memberId) return base;

  // Collision: append -2, -3, ... within 10 chars.
  for (let n = 2; n < 1000; n++) {
    const suffix = `-${n}`;
    const maxBase = 10 - suffix.length;
    if (maxBase <= 0) break;
    const cand = `${base.slice(0, maxBase)}${suffix}`;
    const candLower = cand.toLowerCase();
    const candOwner = takenLowerToMemberId.get(candLower);
    if (!candOwner || candOwner === memberId) return cand;
  }
  return '';
}

async function main() {
  const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
  if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();

  const [membersSnap, nickSnap] = await Promise.all([
    db.collection('members').get(),
    db.collection('nicknames').get().catch(() => null),
  ]);

  const takenLowerToMemberId = new Map();
  if (nickSnap) {
    nickSnap.forEach((d) => {
      const data = d.data() || {};
      const owner = String(data.memberId || '').trim();
      takenLowerToMemberId.set(String(d.id || '').trim().toLowerCase(), owner || '');
    });
  }

  // Add current member NickName values as taken too, in case nicknames mapping is incomplete.
  membersSnap.forEach((d) => {
    const data = d.data() || {};
    const cur = String(pickNickname(data) || '').trim().toUpperCase();
    if (cur) takenLowerToMemberId.set(cur.toLowerCase(), String(d.id));
  });

  const proposals = [];
  membersSnap.forEach((doc) => {
    const memberId = doc.id;
    const data = doc.data() || {};
    const currentRaw = pickNickname(data);
    const currentUpper = String(currentRaw || '').trim().toUpperCase();

    const sanitized = sanitizeExistingNickname(currentUpper);
    if (!sanitized) {
      proposals.push({ memberId, current: currentUpper, next: '', reason: 'empty after sanitize' });
      return;
    }

    const next = uniqueNick(sanitized, memberId, takenLowerToMemberId);
    if (!next) {
      proposals.push({ memberId, current: currentUpper, next: '', reason: 'could not find unique nickname' });
      return;
    }

    // Only change if current violates rules OR differs after sanitize/uniqueness.
    const currentValid = isValidNickname(currentUpper) && currentUpper.length <= 10;
    const needsChange = (!currentValid) || (currentUpper !== next);
    if (!needsChange) return;

    proposals.push({ memberId, current: currentUpper, next, reason: currentValid ? 'normalize' : 'invalid current' });
    // Reserve the nickname to avoid collisions between proposals.
    takenLowerToMemberId.set(next.toLowerCase(), memberId);
  });

  const toApply = proposals.filter((p) => p.next);
  const skipped = proposals.filter((p) => !p.next);

  console.log(`Members scanned: ${membersSnap.size}`);
  console.log(`Will update: ${toApply.length}`);
  console.log(`Skipped: ${skipped.length}`);

  if (!APPLY) {
    console.log('\nDry run (no writes). First 50 proposed updates:');
    toApply.slice(0, 50).forEach((p) => {
      console.log(`- ${p.memberId}: ${p.current || '(empty)'} -> ${p.next}`);
    });
    if (skipped.length) {
      console.log('\nFirst 20 skipped (needs manual review):');
      skipped.slice(0, 20).forEach((p) => {
        console.log(`- ${p.memberId}: ${p.current || '(empty)'} (${p.reason})`);
      });
    }
    console.log('\nRun with --apply to perform updates.');
    return;
  }

  console.log('\nApplying updates...');
  let ok = 0;
  let failed = 0;

  for (const p of toApply) {
    const memberRef = db.collection('members').doc(p.memberId);
    const newUpper = p.next;
    const newLower = newUpper.toLowerCase();

    try {
      await db.runTransaction(async (t) => {
        const memberSnap = await t.get(memberRef);
        if (!memberSnap.exists) throw new Error('member_missing');

        const curData = memberSnap.data() || {};
        const oldUpper = String(pickNickname(curData) || '').trim().toUpperCase();
        const oldLower = oldUpper ? oldUpper.toLowerCase() : '';

        const newNickRef = db.collection('nicknames').doc(newLower);
        const newNickSnap = await t.get(newNickRef);
        if (newNickSnap.exists) {
          const owner = String((newNickSnap.data() || {}).memberId || '').trim();
          if (owner && owner !== p.memberId) throw new Error('nickname_exists');
        }

        // Remove old mapping if it belongs to this member.
        if (oldLower) {
          const oldNickRef = db.collection('nicknames').doc(oldLower);
          const oldNickSnap = await t.get(oldNickRef);
          if (oldNickSnap.exists) {
            const owner = String((oldNickSnap.data() || {}).memberId || '').trim();
            if (owner === p.memberId) t.delete(oldNickRef);
          }
        }

        t.set(newNickRef, { memberId: p.memberId, updatedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp() }, { merge: true });
        t.update(memberRef, { NickName: newUpper, updatedAt: FieldValue.serverTimestamp() });
      });
      ok++;
      if (ok % 50 === 0) console.log(`Updated ${ok}/${toApply.length}...`);
    } catch (e) {
      failed++;
      console.warn(`Failed ${p.memberId} (${p.current} -> ${p.next}): ${String(e?.message || e)}`);
    }
  }

  console.log(`\nDone. Updated: ${ok}. Failed: ${failed}.`);
}

main().catch((e) => {
  console.error('Nickname fix script failed', e);
  process.exit(1);
});
