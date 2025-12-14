// Firestore-backed replacement for `src/api/sheets.js` surface.
// This module implements a minimal set of functions with the same names as
// the existing Sheets API to make switching imports easier.

import fb from '../lib/firebase';
import { serverTimestamp } from 'firebase/firestore';

// Collections mapping
const COLS = {
  members: 'members',
  gymEntries: 'gymEntries',
  payments: 'payments',
  expenses: 'expenses',
  revenues: 'revenues',
  progress: 'progress',
  attendance: 'attendance',
  pricing: 'pricing',
};

function manilaYMD(d) {
  try {
    const date = d instanceof Date ? d : new Date(d);
    if (!date || isNaN(date)) return '';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch (e) {
    return '';
  }
}

function manilaHM(d) {
  try {
    const date = d instanceof Date ? d : new Date(d);
    if (!date || isNaN(date)) return '';
    // 24-hour HH:mm in Asia/Manila
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Manila',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const hh = parts.find(p => p.type === 'hour')?.value || '';
    const mm = parts.find(p => p.type === 'minute')?.value || '';
    return (hh && mm) ? `${hh}:${mm}` : '';
  } catch (e) {
    return '';
  }
}

function manilaStartOfDay(ymd) {
  try {
    const s = String(ymd || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    // Force +08:00 regardless of user's local timezone.
    const d = new Date(`${s}T00:00:00+08:00`);
    return isNaN(d) ? null : d;
  } catch (e) {
    return null;
  }
}

function ymdNext(ymd) {
  try {
    const [yy, mm, dd] = String(ymd || '').split('-').map((n) => Number(n));
    if (!yy || !mm || !dd) return '';
    const d = new Date(yy, (mm - 1), dd);
    d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch (e) {
    return '';
  }
}

function ymdMonthNext(monthKey) {
  try {
    const [yy, mm] = String(monthKey || '').split('-').map((n) => Number(n));
    if (!yy || !mm) return '';
    const d = new Date(yy, (mm - 1), 1);
    d.setMonth(d.getMonth() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  } catch (e) {
    return '';
  }
}

function ymdToLocalDayRange(ymd) {
  try {
    const [yy, mm, dd] = String(ymd || '').split('-').map((n) => Number(n));
    if (!yy || !mm || !dd) return { start: null, end: null };
    const start = new Date(yy, (mm - 1), dd, 0, 0, 0, 0);
    const end = new Date(yy, (mm - 1), dd + 1, 0, 0, 0, 0);
    return { start, end };
  } catch (e) {
    return { start: null, end: null };
  }
}

function monthKeyToLocalRange(monthKey) {
  try {
    const [yy, mm] = String(monthKey || '').split('-').map((n) => Number(n));
    if (!yy || !mm) return { start: null, end: null };
    const start = new Date(yy, (mm - 1), 1, 0, 0, 0, 0);
    const end = new Date(yy, (mm - 1) + 1, 1, 0, 0, 0, 0);
    return { start, end };
  } catch (e) {
    return { start: null, end: null };
  }
}

function mergeById(...lists) {
  const map = new Map();
  const extras = [];
  for (const list of lists) {
    for (const r of (list || [])) {
      const id = r && (r.id || r._id);
      if (!id) { extras.push(r); continue; }
      map.set(id, r);
    }
  }
  return Array.from(map.values()).concat(extras);
}

// Map common sheet names (legacy) to collections
function sheetToCol(sheetName) {
  if (!sheetName) return null;
  const s = String(sheetName).trim().toLowerCase();
  if (s === 'members') return COLS.members;
  if (s === 'gymentries' || s === 'gymentries' || s === 'gymentries') return COLS.gymEntries;
  if (s === 'payments') return COLS.payments;
  if (s === 'progresstracker' || s === 'progress') return COLS.progress;
  if (s === 'attendance') return COLS.attendance;
  if (s === 'pricing') return COLS.pricing;
  // fallback: use the literal lowercased sheet name
  return s;
}

// Normalize member row into the legacy canonical shape expected by UI
function canonicalizeMember(raw) {
  if (!raw) return null;
  const out = { ...raw };
  out.memberid = String(raw.memberId || raw.MemberID || raw.id || raw.memberid || '').trim();
  out.firstname = raw.firstName || raw.firstname || raw.FirstName || '';
  out.lastname = raw.lastName || raw.lastname || raw.LastName || '';
  out._raw = raw;
  return out;
}

export async function fetchMembers() {
  const rows = await fb.getCollection(COLS.members);
  // return in the same shape as sheets.fetchMembers (rows/data)
  return { rows: rows.map(r => ({ ...r })) };
}

export async function fetchMembersFresh() { return fetchMembers(); }

export async function addMember(row) {
  // First, try to use the server-side endpoint which provides strict, race-free uniqueness
  try {
    if (typeof fetch === 'function') {
      const resp = await fetch('/api/members/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row) });
      if (resp && resp.status === 201) {
        try {
          const body = await resp.json();
          return body;
        } catch (e) {
          // if parsing fails, continue to fallback
        }
      }
      if (resp && resp.status === 409) {
        try { const body = await resp.json(); return body; } catch(e) { return { ok: false, error: 'Nickname already taken' }; }
      }
      // if server not configured (501) or other error, we'll fall back to client-side best-effort insert
    }
  } catch (e) {
    // ignore fetch errors and fall back to client-side path
  }

  // Fallback: best-effort uniqueness check then insert (may have race conditions)
  try {
    const nick = String(row.NickName || row.nickName || row.nickname || '').trim();
    if (nick) {
      const candidates = [];
      try {
        const q1 = await fb.queryCollection(COLS.members, { wheres: [{ field: 'NickName', op: '==', value: nick }] });
        candidates.push(...(q1 || []));
      } catch (e) { /* ignore */ }
      try {
        const q2 = await fb.queryCollection(COLS.members, { wheres: [{ field: 'nickname', op: '==', value: nick }] });
        candidates.push(...(q2 || []));
      } catch (e) { /* ignore */ }

      if (candidates.length > 0) {
        const exists = candidates.some(r => String(r.NickName || r.nickname || r.nick_name || r.nickName || '').trim().toLowerCase() === nick.toLowerCase());
        if (exists) {
          return { ok: false, error: 'Nickname already taken' };
        }
      }
    }
  } catch (e) {
    // continue
  }

  const created = await fb.addDocument(COLS.members, row);
  return { ok: true, id: created.id, row: created };
}

export async function saveMember(row) { return addMember(row); }

export async function updateMember(row) {
  const id = String(row.MemberID || row.memberId || row.id || row.memberid || '').trim();
  if (!id) throw new Error('MemberID required for update');
  try {
    await fb.setDocument(COLS.members, id, row);
    return { ok: true };
  } catch (e) {
    // If Firebase client isn't configured or fails, fall back to server-side PUT
    try {
      const resp = await fetch(`/api/members/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row) });
      if (resp && resp.ok) {
        try { const body = await resp.json(); return body; } catch (er) { return { ok: true }; }
      }
      throw e;
    } catch (e2) {
      throw e2 || e;
    }
  }
}

export async function fetchMemberById(memberId) {
  if (!memberId) return null;
  const r = await fb.getDocById(COLS.members, String(memberId));
  return r ? canonicalizeMember(r) : null;
}

export async function fetchMemberByIdFresh(memberId) { return fetchMemberById(memberId); }

export async function fetchMemberBundle(memberId) {
  if (!memberId) throw new Error('memberId required');

  const id = String(memberId).trim();

  // Member doc: prefer doc id = MemberID (cheapest). Fallback to query on common fields.
  let memberRow = null;
  try {
    memberRow = await fb.getDocById(COLS.members, id);
  } catch (e) { /* ignore */ }
  if (!memberRow) {
    const fields = ['MemberID', 'memberId', 'memberid', 'id'];
    for (const f of fields) {
      try {
        const hit = await fb.queryCollection(COLS.members, { wheres: [{ field: f, op: '==', value: id }], limit: 1 });
        if (hit && hit.length) { memberRow = hit[0]; break; }
      } catch (e) { /* ignore */ }
    }
  }

  const queryByMember = async (colName) => {
    const fields = ['MemberID', 'memberId', 'memberid', 'member', 'id'];
    const seen = new Map();
    for (const f of fields) {
      try {
        const rows = await fb.queryCollection(colName, { wheres: [{ field: f, op: '==', value: id }], limit: 5000 });
        for (const r of (rows || [])) seen.set(r.id, r);
      } catch (e) { /* ignore */ }
    }
    return Array.from(seen.values());
  };

  const [paymentsFor, gymFor, progFor] = await Promise.all([
    queryByMember(COLS.payments),
    queryByMember(COLS.gymEntries),
    queryByMember(COLS.progress),
  ]);

  return { member: memberRow ? ({ ...memberRow }) : null, payments: paymentsFor, gymEntries: gymFor, progress: progFor };
}

export async function fetchGymEntries() { return { rows: await fb.getCollection(COLS.gymEntries) }; }
export async function fetchGymEntriesFresh() { return fetchGymEntries(); }
export async function addGymEntry(row) { const r = await fb.addDocument(COLS.gymEntries, row); return { ok: true, id: r.id }; }

// Date-scoped helpers to avoid reading entire collections.
export async function fetchGymEntriesSince({ days = 30, limit = 2000 } = {}) {
  const cutoff = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
  const cutoffYMD = cutoff.toISOString().slice(0, 10);
  try {
    // String Date range works for both YYYY-MM-DD and ISO strings that start with YYYY-MM-DD.
    const rows = await fb.queryCollection(COLS.gymEntries, {
      wheres: [{ field: 'Date', op: '>=', value: cutoffYMD }],
      limit,
    });
    if (rows && rows.length) return { rows };
    // Fallback: if Date is stored as a Firestore Timestamp.
    const rowsTs = await fb.queryCollection(COLS.gymEntries, {
      wheres: [{ field: 'Date', op: '>=', value: cutoff }],
      limit,
    });
    return { rows: rowsTs || [] };
  } catch (e) {
    return { rows: [] };
  }
}

export async function fetchGymEntriesForDate(dateYMD) {
  const ymd = String(dateYMD || '').trim();
  if (!ymd) return { rows: [] };
  const next = ymdNext(ymd);
  const { start, end } = ymdToLocalDayRange(ymd);
  try {
    // Range query covers YYYY-MM-DD and ISO strings.
    if (next) {
      const rows = await fb.queryCollection(COLS.gymEntries, {
        wheres: [
          { field: 'Date', op: '>=', value: ymd },
          { field: 'Date', op: '<', value: next },
        ],
        limit: 2000,
      });
      if (rows && rows.length) return { rows };
    }
    // Fallback: Timestamp range.
    if (start && end) {
      const rowsTs = await fb.queryCollection(COLS.gymEntries, {
        wheres: [
          { field: 'Date', op: '>=', value: start },
          { field: 'Date', op: '<', value: end },
        ],
        limit: 2000,
      });
      return { rows: rowsTs || [] };
    }
    return { rows: [] };
  } catch (e) {
    return { rows: [] };
  }
}

// Smart append helper for quick check-ins/check-outs.
// - If called without extra.wantsOut, creates a check-in row with Date and TimeIn (ISO) if missing.
// - If called with extra.wantsOut === true, attempts to find today's open entry for the member
//   and set its TimeOut; if none found, appends a checkout-only row.
// It also accepts optional TimeIn/Date for disambiguation and writes Coach/Focus/Workouts/Comments.
export async function gymQuickAppend(memberId, extra = {}){
  if(!memberId) throw new Error('memberId required');
  const nowIso = new Date().toISOString();
  const todayYMD = nowIso.slice(0,10);

  // Normalize keys
  const wantsOut = !!extra.wantsOut;
  const payload = { ...extra };

  // If this is a check-in (not wantsOut), ensure TimeIn and Date exist
  if (!wantsOut) {
    if (!payload.TimeIn && !payload.timeIn) payload.TimeIn = nowIso;
    if (!payload.Date && !payload.date) payload.Date = todayYMD;
    // ensure MemberID present
    payload.MemberID = memberId;
    const r = await addGymEntry(payload);
    return r;
  }

  // wantsOut true -> try to update an existing open entry for today
  // Fetch entries and try to find the most recent open entry matching memberId and optional Date/TimeIn
  const rows = await fb.getCollection(COLS.gymEntries);
  // Prefer matching by explicit TimeIn+Date if provided
  const matchByProvided = (row) => {
    try {
      const mid = String(row.MemberID || row.memberId || row.memberid || '').trim();
      if (mid !== String(memberId).trim()) return false;
      // if payload has Date+TimeIn, match exact
      if (payload.TimeIn && payload.Date) {
        const tIn = String(row.TimeIn || row.timeIn || '');
        const d = String(row.Date || row.date || '');
        if (tIn && d && String(payload.TimeIn) === String(tIn) && String(payload.Date) === String(d)) return true;
      }
      return false;
    } catch (e) { return false; }
  };

  let open = null;
  if (payload.TimeIn && payload.Date) {
    open = rows.find(matchByProvided) || null;
  }

  if (!open) {
    // fallback: find today's open entries for member (no TimeOut)
    const today = new Date(); today.setHours(0,0,0,0);
    const todays = rows.filter(r => {
      try {
        const mid = String(r.MemberID || r.memberId || r.memberid || '').trim();
        if (mid !== String(memberId).trim()) return false;
        const d = new Date(r.Date || r.date || r.DateTime || r.timestamp || r.TimeIn || '');
        if (isNaN(d)) return false;
        d.setHours(0,0,0,0);
        const isToday = d.getTime() === today.getTime();
        const hasOut = r.TimeOut || r.timeOut || r.Timeout || r.TimeOUT;
        return isToday && (!hasOut || String(hasOut).trim() === '');
      } catch (e) { return false; }
    }).sort((a,b) => {
      const ta = a.TimeIn || a.timeIn || '';
      const tb = b.TimeIn || b.timeIn || '';
      return String(tb).localeCompare(String(ta));
    });
    open = todays.length ? todays[0] : null;
  }

  const now = new Date().toISOString();
  if (!open) {
    // no open entry -> append a checkout-only row
    const row = { MemberID: memberId, TimeOut: now, Date: payload.Date || todayYMD };
    if (payload.Workouts) row.Workouts = payload.Workouts;
    if (payload.Comments) row.Comments = payload.Comments;
    if (payload.Coach) row.Coach = payload.Coach;
    if (payload.Focus) row.Focus = payload.Focus;
    const res = await addGymEntry(row);
    return res;
  }

  // Update the found open entry: set TimeOut and optional fields, compute TotalHours
  const update = { TimeOut: now };
  if (payload.Workouts) update.Workouts = payload.Workouts;
  if (payload.Comments) update.Comments = payload.Comments;
  if (payload.Coach) update.Coach = payload.Coach;
  if (payload.Focus) update.Focus = payload.Focus;

  // Attempt to compute total hours from TimeIn -> TimeOut
  try {
    const timeInVal = open.TimeIn || open.timeIn || '';
    if (timeInVal) {
      const tin = new Date(timeInVal);
      const tout = new Date(now);
      if (!isNaN(tin) && !isNaN(tout) && tout > tin) {
        const hours = (tout - tin) / (1000 * 60 * 60);
        // round to 2 decimal places
        update.TotalHours = Math.round(hours * 100) / 100;
      }
    }
  } catch (e) { /* ignore compute errors */ }

  await fb.updateDocument(COLS.gymEntries, open.id, update);
  return { ok: true, id: open.id };
}

// Backwards compatible: gymClockIn / gymClockOut / upsertGymEntry
export async function gymClockIn(memberId, extra = {}){
  if(!memberId) throw new Error('memberId is required');
  // Try to find an existing open entry (no TimeOut) for this member for today
  const rows = await fb.getCollection(COLS.gymEntries);
  const today = new Date();
  today.setHours(0,0,0,0);
  const open = rows.find(r => {
    try {
      const id = String(r.MemberID || r.memberId || r.memberid || r.id || '');
      if (!id || id.trim() !== String(memberId).trim()) return false;
      const d = new Date(r.Date || r.date || r.DateTime || r.timestamp || '');
      if (isNaN(d)) return false;
      d.setHours(0,0,0,0);
      const isToday = d.getTime() === today.getTime();
      const hasOut = r.TimeOut || r.timeOut || r.Timeout || r.TimeOUT;
      return isToday && (!hasOut || String(hasOut).trim() === '');
    } catch (e) { return false; }
  });
  if (open) return { ok: true, id: open.id, existed: true };
  const now = new Date().toISOString();
  const date = now.slice(0,10);
  const res = await addGymEntry({ MemberID: memberId, TimeIn: now, Date: date, ...extra });
  return res;
}

export async function gymClockOut(memberId, extra = {}){
  if(!memberId) throw new Error('memberId is required');
  // Find most recent open entry (no TimeOut) for this member and set TimeOut
  const rows = await fb.getCollection(COLS.gymEntries);
  const open = rows.filter(r => String(r.MemberID || r.memberId || r.memberid || '').trim() === String(memberId).trim() && !(r.TimeOut || r.timeOut || '').toString().trim()).sort((a,b) => {
    const ta = a.TimeIn || a.timeIn || '';
    const tb = b.TimeIn || b.timeIn || '';
    return String(ta).localeCompare(String(tb));
  });
  if (!open.length) {
    // no open entry — append a checkout-only row
    const now = new Date().toISOString();
    const date = now.slice(0,10);
    return addGymEntry({ MemberID: memberId, TimeOut: now, Date: date, ...extra });
  }
  const target = open[open.length - 1];
  const now = new Date().toISOString();
  // Compute TotalHours if TimeIn exists and TimeOut will be set
  const update = { TimeOut: now };
  if (extra) Object.assign(update, extra);
  try {
    const timeInVal = target.TimeIn || target.timeIn || '';
    if (timeInVal) {
      const tin = new Date(timeInVal);
      const tout = new Date(now);
      if (!isNaN(tin) && !isNaN(tout) && tout > tin) {
        const hours = (tout - tin) / (1000 * 60 * 60);
        update.TotalHours = Math.round(hours * 100) / 100; // round to 2 decimals
      }
    }
  } catch (e) { /* ignore compute errors */ }

  await fb.updateDocument(COLS.gymEntries, target.id, update);
  return { ok: true, id: target.id };
}

export async function upsertGymEntry(payload){
  if (!payload) throw new Error('payload required');
  const memberId = payload.MemberID || payload.memberId || payload.memberid || '';
  // Prefer matching by explicit id
  if (payload.id) {
    await fb.updateDocument(COLS.gymEntries, String(payload.id), payload);
    return { ok: true };
  }
  // Try to find a row that matches MemberID + TimeIn + Date
  const rows = await fb.getCollection(COLS.gymEntries);
  const match = rows.find(r => {
    try {
      const mid = String(r.MemberID || r.memberId || r.memberid || '').trim();
      if (!mid || String(mid) !== String(memberId).trim()) return false;
      const tIn = String(r.TimeIn || r.timeIn || '');
      const pIn = String(payload.TimeIn || payload.timeIn || '');
      const d = String(r.Date || r.date || '');
      const pd = String(payload.Date || payload.date || '');
      if (pIn && tIn && pIn === tIn && pd && d && pd === d) return true;
      // fallback: if payload has rowNumber try to match it against an 'rowNumber' field
      if (payload.rowNumber && (String(r.rowNumber || '') === String(payload.rowNumber))) return true;
      return false;
    } catch (e) { return false; }
  });
  if (match) {
    // If payload includes both TimeIn and TimeOut but no TotalHours, compute it here
    try {
      const pTin = payload.TimeIn || payload.timeIn || '';
      const pTout = payload.TimeOut || payload.timeOut || '';
      if (pTin && pTout && (payload.TotalHours === undefined || payload.TotalHours === null || payload.TotalHours === "")) {
        const tin = new Date(pTin);
        const tout = new Date(pTout);
        if (!isNaN(tin) && !isNaN(tout) && tout > tin) {
          const hours = (tout - tin) / (1000 * 60 * 60);
          payload.TotalHours = Math.round(hours * 100) / 100;
        }
      }
    } catch (e) { /* ignore */ }
    await fb.updateDocument(COLS.gymEntries, match.id, payload);
    return { ok: true, id: match.id };
  }
  // otherwise append
  const r = await addGymEntry(payload);
  return r;
}

export async function fetchProgressTracker() { return { rows: await fb.getCollection(COLS.progress) }; }
export async function addProgressRow(row) {
  if (!row) throw new Error('row required');
  try {
    const created = await fb.addDocument(COLS.progress, row);
    return { ok: true, id: created.id };
  } catch (e) {
    // Fallback: if server-side endpoint exists, try POST to legacy API
    try {
      if (typeof fetch === 'function') {
        const resp = await fetch('/api/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row) });
        if (resp && resp.ok) {
          try { const body = await resp.json(); return body; } catch (ee) { return { ok: true }; }
        }
      }
    } catch (ee) {
      // ignore
    }
    throw e;
  }
}

// Fetch a prioritized list of members with recent activity.
// Strategy: look for members with recent memberDate/member_since, recent gym entries, or recent payments.
// This is a best-effort server-side helper — Firestore doesn't support complex OR queries easily from the client
// without composite indexes, so we fetch relevant collections and combine client-side. For typical dataset sizes
// this is efficient; for very large datasets consider adding dedicated indexes or a search index.
export async function fetchMembersRecent({ limit = 200, days = 90 } = {}) {
  const cutoffMs = Date.now() - (days * 24 * 60 * 60 * 1000);
  const cutoff = new Date(cutoffMs);
  const cutoffYMD = cutoff.toISOString().slice(0, 10);

  // Avoid full-collection scans: only look at recent gymEntries/payments, derive member IDs, then fetch only those members.
  // Also include currently-active payments (by valid-until) so status columns are correct even if the payment isn't recent.
  let paymentsRaw = [];
  let entriesRaw = [];
  try {
    const querySince = async (col) => {
      // Prefer string Date (YYYY-MM-DD or ISO), fallback to Timestamp Date.
      const fromDate = new Date(cutoffMs);
      try {
        const rows = await fb.queryCollection(col, {
          wheres: [{ field: 'Date', op: '>=', value: cutoffYMD }],
          limit: 4000,
        });
        if (rows && rows.length) return rows;
      } catch (e) { /* ignore */ }
      try {
        const rowsTs = await fb.queryCollection(col, {
          wheres: [{ field: 'Date', op: '>=', value: fromDate }],
          limit: 4000,
        });
        if (rowsTs && rowsTs.length) return rowsTs;
      } catch (e) { /* ignore */ }
      // Final fallback: common created/timestamp fields if present.
      const fallbacks = ['createdAt', 'created_at', 'timestamp', 'Timestamp', 'TimeIn', 'timeIn'];
      for (const f of fallbacks) {
        try {
          const rows = await fb.queryCollection(col, {
            wheres: [{ field: f, op: '>=', value: fromDate }],
            limit: 4000,
          });
          if (rows && rows.length) return rows;
        } catch (e) { /* ignore */ }
      }
      return [];
    };

    const [recentPays, recentEntries, activePays] = await Promise.all([
      querySince(COLS.payments),
      querySince(COLS.gymEntries),
      fetchPaymentsActive({ limit: 4000 }).then((r) => (r?.rows || r?.data || [])).catch(() => []),
    ]);
    paymentsRaw = mergeById(recentPays || [], activePays || []);
    entriesRaw = recentEntries || [];
  } catch (e) {
    paymentsRaw = entriesRaw = [];
  }

  // If Firestore isn't available, fallback to server-side endpoints.
  if ((paymentsRaw.length === 0 && entriesRaw.length === 0) && typeof fetch === 'function') {
    try {
      const [mResp, pResp, gResp] = await Promise.all([
        fetch('/api/members'),
        fetch('/api/payments'),
        fetch('/api/gymEntries')
      ]);
      const membersRaw = (mResp && mResp.ok) ? await mResp.json() : [];
      paymentsRaw = (pResp && pResp.ok) ? await pResp.json() : [];
      entriesRaw = (gResp && gResp.ok) ? await gResp.json() : [];

      // Old behavior (server): filter members client-side.
      const parseDate = (v) => {
        if (!v) return null;
        const d = (v instanceof Date) ? v : new Date(v);
        return isNaN(d) ? null : d;
      };
      const members = (membersRaw || []).map(m => ({ ...m }));
      const recentIds = new Set();
      for (const m of members) {
        const d = parseDate(
          m.memberDate || m.member_date || m.member_since || m.membersince || m.MemberSince || m.MemberDate || m.memberSince || m.createdAt || m.created_at || m.joined || m.start_date
        );
        if (d && d.getTime() >= cutoffMs) recentIds.add(String(m.memberId || m.MemberID || m.id || m.memberid || m.member || '').trim());
      }
      for (const p of (paymentsRaw || [])) {
        const d = parseDate(p.date || p.Date || p.createdAt || p.created_at || p.timestamp);
        if (d && d.getTime() >= cutoffMs) {
          const mid = String(p.MemberID || p.memberId || p.memberid || p.id || '').trim();
          if (mid) recentIds.add(mid);
        }
      }
      for (const e of (entriesRaw || [])) {
        const d = parseDate(e.Date || e.date || e.DateTime || e.timestamp || e.timeIn || e.TimeIn);
        if (d && d.getTime() >= cutoffMs) {
          const mid = String(e.MemberID || e.memberId || e.memberid || e.id || '').trim();
          if (mid) recentIds.add(mid);
        }
      }
      const out = (recentIds.size > 0)
        ? members.filter(m => recentIds.has(String(m.memberId || m.MemberID || m.id || m.memberid || '').trim()))
        : members;
      return { rows: out.slice(0, Math.max(0, Number(limit) || 200)) };
    } catch (e) {
      // ignore fallback errors
    }
  }

  const recentIds = new Set();
  const parseDate = (v) => {
    if (!v) return null;
    const d = (v instanceof Date) ? v : new Date(v);
    return isNaN(d) ? null : d;
  };

  for (const p of (paymentsRaw || [])) {
    const d = parseDate(p.date || p.Date || p.createdAt || p.created_at || p.timestamp);
    if (d && d.getTime() >= cutoffMs) {
      const mid = String(p.MemberID || p.memberId || p.memberid || p.id || '').trim();
      if (mid) recentIds.add(mid);
    }
  }
  for (const e of (entriesRaw || [])) {
    const d = parseDate(e.Date || e.date || e.DateTime || e.timestamp || e.timeIn || e.TimeIn);
    if (d && d.getTime() >= cutoffMs) {
      const mid = String(e.MemberID || e.memberId || e.memberid || e.id || '').trim();
      if (mid) recentIds.add(mid);
    }
  }

  // If we couldn't derive any IDs, fall back to a bounded members query.
  if (recentIds.size === 0) {
    try {
      const ms = await fb.queryCollection(COLS.members, { orderBy: { field: 'createdAt', dir: 'desc' }, limit: Math.max(limit, 200) });
      return { rows: (ms || []).slice(0, Math.max(0, Number(limit) || 200)).map(r => ({ ...r })) };
    } catch (e) {
      try {
        const ms = await fb.queryCollection(COLS.members, { limit: Math.max(limit, 200) });
        return { rows: (ms || []).slice(0, Math.max(0, Number(limit) || 200)).map(r => ({ ...r })) };
      } catch (e2) {
        return { rows: [] };
      }
    }
  }

  // Fetch only those members in batches (Firestore 'in' supports max 10 values).
  const ids = Array.from(recentIds);
  const out = [];
  const seen = new Set();
  const max = Math.max(0, Number(limit) || 200);
  for (let i = 0; i < ids.length && out.length < max; i += 10) {
    const batch = ids.slice(i, i + 10);

    // Prefer doc id match.
    try {
      const rows = await fb.queryCollection(COLS.members, { wheres: [{ field: '__name__', op: 'in', value: batch }], limit: 10 });
      for (const r of (rows || [])) {
        if (!seen.has(r.id)) { seen.add(r.id); out.push({ ...r }); }
      }
    } catch (e) { /* ignore */ }

    // Fallback: match on MemberID field.
    if (out.length < max) {
      try {
        const rows = await fb.queryCollection(COLS.members, { wheres: [{ field: 'MemberID', op: 'in', value: batch }], limit: 10 });
        for (const r of (rows || [])) {
          if (!seen.has(r.id)) { seen.add(r.id); out.push({ ...r }); }
        }
      } catch (e) { /* ignore */ }
    }
  }

  return { rows: out.slice(0, max), payments: paymentsRaw || [], gymEntries: entriesRaw || [] };
}

// Fetch only currently-active payments by querying valid-until fields.
// This is used to compute membership/coach status without scanning all payments.
export async function fetchPaymentsActive({ limit = 4000 } = {}) {
  const today = manilaYMD(new Date());
  const startTs = manilaStartOfDay(today);
  if (!today) return { rows: [] };

  const fields = {
    gym: ['GymValidUntil', 'gym_valid_until', 'gymvaliduntil', 'gym_until', 'membershipEnd', 'membership_end'],
    coach: ['CoachValidUntil', 'coach_valid_until', 'coachvaliduntil', 'coach_until', 'coachEnd', 'coach_end', 'coach_subscription_end', 'coach_subscription_end_date'],
    end: ['EndDate', 'enddate', 'end_date', 'valid_until', 'expiry', 'expires', 'until', 'end'],
  };

  const out = [];
  const seen = new Set();
  const addRows = (rows) => {
    for (const r of (rows || [])) {
      const id = r && (r.id || r._id);
      // In tests/mocks some rows may not have Firestore doc ids; fall back to a stable fingerprint.
      const fp = id || (() => {
        const mid = String(r?.MemberID || r?.member_id || r?.memberId || r?.memberid || r?.id || '').trim();
        const dt = String(r?.Date || r?.date || r?.createdAt || r?.created_at || r?.timestamp || '').trim();
        const amt = String(r?.Cost || r?.amount || '').trim();
        const part = String(r?.Particulars || r?.particulars || r?.type || r?.item || '').trim();
        return ['p', mid, dt, amt, part].join('|');
      })();
      if (!fp || seen.has(fp)) continue;
      seen.add(fp);
      out.push(r);
      if (out.length >= limit) break;
    }
  };

  const queryField = async (field, value) => {
    try {
      const rows = await fb.queryCollection(COLS.payments, {
        wheres: [{ field, op: '>=', value }],
        limit,
      });
      addRows(rows);
    } catch (e) {
      // ignore
    }
  };

  // Prefer string YYYY-MM-DD comparisons; then Timestamp comparisons.
  for (const group of Object.values(fields)) {
    for (const f of group) {
      if (out.length >= limit) break;
      await queryField(f, today);
    }
    if (out.length >= limit) break;
  }

  if (out.length === 0 && startTs) {
    for (const group of Object.values(fields)) {
      for (const f of group) {
        if (out.length >= limit) break;
        await queryField(f, startTs);
      }
      if (out.length >= limit) break;
    }
  }

  return { rows: out.slice(0, limit) };
}

// Simple search across member name fields. Firestore lacks rich text search in the client SDK,
// so this helper fetches members and performs a case-insensitive substring match on common name fields.
// Note: for very large collections, replace this with a dedicated search index (Algolia/Elastic/Firebase Extensions).
// In-memory cache for search results to reduce repeated full-collection scans in the browser
const SEARCH_CACHE = new Map();
const SEARCH_TTL_MS = 1000 * 30; // 30 seconds

export async function searchMembersByName(queryStr, { limit = 200 } = {}) {
  if (!queryStr || !String(queryStr).trim()) return { rows: [] };
  const qRaw = String(queryStr).trim();
  const q = qRaw.toLowerCase();

  // return cached result when fresh
  const key = `search:${q}`;
  const cached = SEARCH_CACHE.get(key);
  if (cached && (Date.now() - cached.ts) < SEARCH_TTL_MS) {
    return { rows: cached.rows.slice(0, limit) };
  }

  // Try Firestore-prefixed queries on common name fields. Best-effort: combine results from multiple fields.
  const end = q + '\uF8FF';
  const fields = ['firstName','firstname','lastName','lastname','nickname','nick_name','nickName'];
  const collected = new Map();

  try {
    for (const f of fields) {
      try {
        // Use queryCollection which constructs the proper constraints
        const rows = await fb.queryCollection(COLS.members, { orderBy: { field: f }, startAt: q, endAt: end, limit });
        for (const r of rows) {
          collected.set(r.id || String(r.MemberID || r.memberId || r.id || ''), r);
        }
      } catch (e) {
        // ignore field if query fails (likely missing index or field)
        continue;
      }
    }

    // If no results from indexed queries, fallback to full scan (older behavior)
    if (collected.size === 0) {
      const rows = await fb.getCollection(COLS.members);
      for (const r of rows) {
        const lower = JSON.stringify(r).toLowerCase();
        if (lower.indexOf(q) !== -1) collected.set(r.id || String(r.MemberID || r.memberId || r.id || ''), r);
      }
    }

    const out = Array.from(collected.values()).slice(0, limit).map(r => ({ ...r }));
    SEARCH_CACHE.set(key, { rows: out, ts: Date.now() });
    return { rows: out };
  } catch (e) {
    // on any unexpected error, fallback to conservative full-scan
    try {
      const rows = await fb.getCollection(COLS.members);
      const matched = (rows || []).filter(r => JSON.stringify(r).toLowerCase().indexOf(q) !== -1).slice(0, limit);
      SEARCH_CACHE.set(key, { rows: matched, ts: Date.now() });
      return { rows: matched };
    } catch (e2) {
      return { rows: [] };
    }
  }
}

// Simple adapter to match fetchSheet/insertRow used by legacy code
export async function fetchSheet(sheetName) {
  const col = sheetToCol(sheetName);
  if (!col) return { rows: [] };
  const rows = await fb.getCollection(col);
  return { rows };
}
export async function insertRow(sheetName, row) {
  const col = sheetToCol(sheetName);
  if (!col) throw new Error('Unknown sheet: ' + sheetName);
  const r = await fb.addDocument(col, row);
  return { ok: true, id: r.id };
}

export async function fetchPayments() { return { rows: await fb.getCollection(COLS.payments) }; }

// Fetch the latest payment row for a given member.
// Used by Members table to display Gym/Coach Valid Until from the latest payment document
// even when we only loaded active payments.
export async function fetchLatestPaymentForMember(memberId) {
  const mid = String(memberId || '').trim();
  if (!mid) return { row: null };

  const tryQuery = async (field) => {
    try {
      // Prefer timestamp ordering.
      const rows = await fb.queryCollection(COLS.payments, {
        wheres: [{ field, op: '==', value: mid }],
        orderBy: { field: 'timestamp', dir: 'desc' },
        limit: 1,
      });
      if (rows && rows.length) return rows[0];
    } catch (e) {
      // Likely missing composite index or field type mismatch; fall back below.
    }

    try {
      const rows = await fb.queryCollection(COLS.payments, {
        wheres: [{ field, op: '==', value: mid }],
        orderBy: { field: 'Date', dir: 'desc' },
        limit: 10,
      });
      if (rows && rows.length) {
        // If multiple payments share the same Date, pick the one with the latest Time.
        const score = (r) => {
          const d = String(r?.Date || r?.date || '').trim();
          const t = String(r?.Time || r?.time || '').trim();
          return `${d} ${t}`.trim();
        };
        return [...rows].sort((a, b) => score(b).localeCompare(score(a)))[0];
      }
    } catch (e) {
      // ignore
    }

    // Last resort: no orderBy.
    try {
      const rows = await fb.queryCollection(COLS.payments, {
        wheres: [{ field, op: '==', value: mid }],
        limit: 50,
      });
      if (rows && rows.length) {
        const parseTs = (v) => {
          try {
            if (!v && v !== 0) return 0;
            if (typeof v === 'number') return v;
            if (v && typeof v.toMillis === 'function') return v.toMillis();
            if (v && typeof v.toDate === 'function') return v.toDate().getTime();
            if (v && typeof v.seconds === 'number') return v.seconds * 1000;
            const parsed = Date.parse(String(v));
            return isNaN(parsed) ? 0 : parsed;
          } catch {
            return 0;
          }
        };
        const score = (r) => {
          // Prefer timestamp-like fields; fall back to Date+Time string.
          const ts = parseTs(r?.timestamp || r?.created || r?.createdAt || r?.paid_on || r?.date);
          if (ts) return ts;
          const d = String(r?.Date || r?.date || '').trim();
          const t = String(r?.Time || r?.time || '').trim();
          return Date.parse(`${d}T${t || '00:00'}`) || 0;
        };
        return [...rows].sort((a, b) => (score(b) || 0) - (score(a) || 0))[0];
      }
    } catch (e) {
      // ignore
    }

    return null;
  };

  const row = (await tryQuery('MemberID')) || (await tryQuery('memberId')) || (await tryQuery('member_id'));
  return { row };
}

export async function updatePayment(paymentId, patch) {
  const id = String(paymentId || '').trim();
  if (!id) throw new Error('paymentId required');
  const updated = await fb.updateDocument(COLS.payments, id, patch || {});
  return { ok: true, id: updated?.id || id, row: updated };
}

export async function deletePayment(paymentId) {
  const id = String(paymentId || '').trim();
  if (!id) throw new Error('paymentId required');

  // Capture the payment first so we can recompute member validity after deletion.
  let payment = null;
  try {
    payment = await fb.getDocById(COLS.payments, id);
  } catch (e) {
    payment = null;
  }

  await fb.deleteDocument(COLS.payments, id);

  try {
    const mid = String(payment?.MemberID || payment?.memberId || payment?.memberid || payment?.member || '').trim();
    if (mid) {
      const parseToDate = (v) => {
        try {
          if (!v && v !== 0) return null;
          if (v instanceof Date) return isNaN(v) ? null : v;
          if (typeof v === 'number') {
            const d = new Date(v);
            return isNaN(d) ? null : d;
          }
          if (v && typeof v.toDate === 'function') {
            const d = v.toDate();
            return d instanceof Date && !isNaN(d) ? d : null;
          }
          if (v && typeof v.seconds === 'number') {
            const d = new Date(v.seconds * 1000);
            return isNaN(d) ? null : d;
          }
          const d = new Date(v);
          return isNaN(d) ? null : d;
        } catch {
          return null;
        }
      };

      const gymKeys = ['membershipEnd', 'MembershipEnd', 'GymValidUntil', 'gymvaliduntil', 'gym_valid_until', 'gym_until', 'EndDate', 'enddate', 'end_date', 'valid_until', 'expiry', 'expires', 'until'];
      const coachKeys = ['coachEnd', 'CoachEnd', 'CoachValidUntil', 'coachvaliduntil', 'coach_valid_until', 'coach_until', 'coach_end', 'coach_subscription_end', 'coach_subscription_end_date'];

      const pick = (o, keys) => {
        if (!o) return undefined;
        for (const k of keys) {
          if (Object.prototype.hasOwnProperty.call(o, k)) return o[k];
          const alt = Object.keys(o).find((kk) => kk.toLowerCase().replace(/\s+/g, '') === String(k).toLowerCase().replace(/\s+/g, ''));
          if (alt) return o[alt];
        }
        return undefined;
      };

      const rows1 = await fb.queryCollection(COLS.payments, { wheres: [{ field: 'MemberID', op: '==', value: mid }], limit: 4000 }).catch(() => []);
      const rows2 = await fb.queryCollection(COLS.payments, { wheres: [{ field: 'memberId', op: '==', value: mid }], limit: 4000 }).catch(() => []);
      const rows = mergeById(rows1 || [], rows2 || []);

      let maxGym = null;
      let maxCoach = null;

      for (const r of (rows || [])) {
        const gymRaw = pick(r, gymKeys);
        const coachRaw = pick(r, coachKeys);
        const gymD = parseToDate(gymRaw);
        const coachD = parseToDate(coachRaw);
        if (gymD && (!maxGym || gymD.getTime() > maxGym.getTime())) maxGym = gymD;
        if (coachD && (!maxCoach || coachD.getTime() > maxCoach.getTime())) maxCoach = coachD;
      }

      const patch = {
        updatedAt: new Date().toISOString(),
      };
      patch.updated_at = patch.updatedAt;

      if (maxGym) {
        const ymd = manilaYMD(maxGym);
        patch.membershipEnd = ymd;
        patch.membership_end = ymd;
        patch.membershipState = 'active';
        patch.membership_state = 'active';
      } else {
        patch.membershipEnd = '';
        patch.membership_end = '';
        patch.membershipState = 'inactive';
        patch.membership_state = 'inactive';
      }

      if (maxCoach) {
        const ymd = manilaYMD(maxCoach);
        patch.coachEnd = ymd;
        patch.coach_end = ymd;
        patch.coachState = 'active';
        patch.coach_state = 'active';
      } else {
        patch.coachEnd = '';
        patch.coach_end = '';
        patch.coachState = 'inactive';
        patch.coach_state = 'inactive';
      }

      try {
        await fb.updateDocument(COLS.members, mid, patch);
      } catch (e) {
        // Fallback: some datasets store MemberID as a field, not the doc id.
        try {
          const hit = await fb.queryCollection(COLS.members, { wheres: [{ field: 'MemberID', op: '==', value: mid }], limit: 1 });
          if (hit && hit.length && hit[0]?.id) {
            await fb.updateDocument(COLS.members, hit[0].id, patch);
          }
        } catch (e2) { /* ignore */ }
      }
    }
  } catch (e) {
    // ignore denormalization errors
  }

  return { ok: true, id };
}
export async function addPayment(payload) {
  const now = new Date();
  const safe = { ...(payload || {}) };

  // Always capture an actual time for new payments going forward.
  // - `timestamp` is used by UI as preferred source for date+time.
  // - Keep legacy `Date`/`Time` fields (used by some range queries and displays).
  const hasTimestampLike = Boolean(
    safe.timestamp || safe.created || safe.createdAt || safe.paid_on || safe.date
  );
  if (!hasTimestampLike) {
    safe.timestamp = serverTimestamp();
    safe.created = safe.timestamp;
  }
  if (!safe.Date) safe.Date = manilaYMD(now);
  if (!safe.Time) safe.Time = manilaHM(now);

  const r = await fb.addDocument(COLS.payments, safe);

  // Denormalize validity onto member doc so Dashboard/Members can render without scanning payments.
  try {
    const mid = String(safe?.MemberID || safe?.memberId || safe?.memberid || safe?.member || '').trim();
    if (mid) {
      const gymUntil = String(safe?.membershipEnd || safe?.MembershipEnd || safe?.GymValidUntil || safe?.gymvaliduntil || safe?.gym_valid_until || safe?.gym_until || safe?.EndDate || safe?.enddate || safe?.end_date || safe?.valid_until || safe?.expiry || safe?.expires || safe?.until || '').trim();
      const coachUntil = String(safe?.coachEnd || safe?.CoachEnd || safe?.CoachValidUntil || safe?.coachvaliduntil || safe?.coach_valid_until || safe?.coach_until || '').trim();

      const patch = {};
      if (gymUntil) {
        patch.membershipEnd = gymUntil;
        patch.membership_end = gymUntil;
        patch.membershipState = 'active';
        patch.membership_state = 'active';
      }
      if (coachUntil) {
        patch.coachEnd = coachUntil;
        patch.coach_end = coachUntil;
        patch.coachState = 'active';
        patch.coach_state = 'active';
      }
      if (Object.keys(patch).length > 0) {
        patch.updatedAt = new Date().toISOString();
        patch.updated_at = patch.updatedAt;
        try {
          await fb.updateDocument(COLS.members, mid, patch);
        } catch (e) {
          // Fallback: some datasets store MemberID as a field, not the doc id.
          try {
            const hit = await fb.queryCollection(COLS.members, { wheres: [{ field: 'MemberID', op: '==', value: mid }], limit: 1 });
            if (hit && hit.length && hit[0]?.id) {
              await fb.updateDocument(COLS.members, hit[0].id, patch);
            }
          } catch (e2) { /* ignore */ }
        }
      }
    }
  } catch (e) { /* ignore */ }

  return { ok: true, id: r.id };
}

// Realtime helper: listen to the latest payment doc (by timestamp).
// Useful for triggering lightweight refreshes (e.g., recomputing tiles) when any payment is added.
export function listenLatestPayment(callback, onError) {
  try {
    return fb.listenQueryCollection(
      COLS.payments,
      { orderBy: { field: 'timestamp', dir: 'desc' }, limit: 1 },
      (rows) => {
        try {
          callback && callback((rows && rows[0]) ? rows[0] : null);
        } catch (e) {
          onError && onError(e);
        }
      },
      onError
    );
  } catch (e) {
    onError && onError(e);
    return () => {};
  }
}

export async function addExpense(payload) {
  const safe = { ...(payload || {}) };
  if (!safe.Date) safe.Date = manilaYMD(new Date());
  // Normalize amount field so reporting sums are consistent.
  if (safe.Amount === undefined && safe.amount === undefined) {
    if (safe.Cost !== undefined) safe.Amount = safe.Cost;
    if (safe.cost !== undefined) safe.Amount = safe.cost;
  }
  safe.timestamp = safe.timestamp || serverTimestamp();
  const r = await fb.addDocument(COLS.expenses, safe);
  return { ok: true, id: r.id };
}

export async function addRevenue(payload) {
  const safe = { ...(payload || {}) };
  if (!safe.Date) safe.Date = manilaYMD(new Date());
  safe.timestamp = safe.timestamp || serverTimestamp();
  const r = await fb.addDocument(COLS.revenues, safe);
  return { ok: true, id: r.id };
}

export async function fetchPaymentsSince({ days = 30, limit = 2000 } = {}) {
  const cutoff = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
  const cutoffYMD = cutoff.toISOString().slice(0, 10);
  try {
    const rows = await fb.queryCollection(COLS.payments, {
      wheres: [{ field: 'Date', op: '>=', value: cutoffYMD }],
      limit,
    });
    if (rows && rows.length) return { rows };
    const rowsTs = await fb.queryCollection(COLS.payments, {
      wheres: [{ field: 'Date', op: '>=', value: cutoff }],
      limit,
    });
    return { rows: rowsTs || [] };
  } catch (e) {
    return { rows: [] };
  }
}

export async function fetchPaymentsForDate(dateYMD) {
  const ymd = String(dateYMD || '').trim();
  if (!ymd) return { rows: [] };
  const next = ymdNext(ymd);
  const { start, end } = ymdToLocalDayRange(ymd);
  try {
    if (next) {
      const rows = await fb.queryCollection(COLS.payments, {
        wheres: [
          { field: 'Date', op: '>=', value: ymd },
          { field: 'Date', op: '<', value: next },
        ],
        limit: 2000,
      });
      if (rows && rows.length) return { rows };
    }
    if (start && end) {
      const rowsTs = await fb.queryCollection(COLS.payments, {
        wheres: [
          { field: 'Date', op: '>=', value: start },
          { field: 'Date', op: '<', value: end },
        ],
        limit: 2000,
      });
      return { rows: rowsTs || [] };
    }
    return { rows: [] };
  } catch (e) {
    return { rows: [] };
  }
}

export async function fetchPaymentsForMonth(monthKey, { limit = 8000 } = {}) {
  const mk = String(monthKey || '').trim();
  if (!mk || !/^\d{4}-\d{2}$/.test(mk)) return { rows: [] };
  const start = `${mk}-01`;
  const nextMonth = ymdMonthNext(mk);
  const endExclusive = nextMonth ? `${nextMonth}-01` : `${mk}-32`;
  const { start: startTs, end: endTs } = monthKeyToLocalRange(mk);
  try {
    const rows = await fb.queryCollection(COLS.payments, {
      wheres: [
        { field: 'Date', op: '>=', value: start },
        { field: 'Date', op: '<', value: endExclusive },
      ],
      limit,
    });
    if (rows && rows.length) return { rows };
    if (startTs && endTs) {
      const rowsTs = await fb.queryCollection(COLS.payments, {
        wheres: [
          { field: 'Date', op: '>=', value: startTs },
          { field: 'Date', op: '<', value: endTs },
        ],
        limit,
      });
      return { rows: rowsTs || [] };
    }
    return { rows: [] };
  } catch (e) {
    return { rows: [] };
  }
}

export async function fetchExpensesForMonth(monthKey, { limit = 8000 } = {}) {
  const mk = String(monthKey || '').trim();
  if (!mk || !/^\d{4}-\d{2}$/.test(mk)) return { rows: [] };
  const start = `${mk}-01`;
  const nextMonth = ymdMonthNext(mk);
  const endExclusive = nextMonth ? `${nextMonth}-01` : `${mk}-32`;
  const { start: startTs, end: endTs } = monthKeyToLocalRange(mk);
  try {
    const rows = await fb.queryCollection(COLS.expenses, {
      wheres: [
        { field: 'Date', op: '>=', value: start },
        { field: 'Date', op: '<', value: endExclusive },
      ],
      limit,
    });
    if (rows && rows.length) return { rows };
    if (startTs && endTs) {
      const rowsTs = await fb.queryCollection(COLS.expenses, {
        wheres: [
          { field: 'Date', op: '>=', value: startTs },
          { field: 'Date', op: '<', value: endTs },
        ],
        limit,
      });
      return { rows: rowsTs || [] };
    }
    return { rows: [] };
  } catch (e) {
    return { rows: [] };
  }
}

export async function fetchRevenuesForMonth(monthKey, { limit = 8000 } = {}) {
  const mk = String(monthKey || '').trim();
  if (!mk || !/^\d{4}-\d{2}$/.test(mk)) return { rows: [] };
  const start = `${mk}-01`;
  const nextMonth = ymdMonthNext(mk);
  const endExclusive = nextMonth ? `${nextMonth}-01` : `${mk}-32`;
  const { start: startTs, end: endTs } = monthKeyToLocalRange(mk);
  try {
    const rows = await fb.queryCollection(COLS.revenues, {
      wheres: [
        { field: 'Date', op: '>=', value: start },
        { field: 'Date', op: '<', value: endExclusive },
      ],
      limit,
    });
    if (rows && rows.length) return { rows };
    if (startTs && endTs) {
      const rowsTs = await fb.queryCollection(COLS.revenues, {
        wheres: [
          { field: 'Date', op: '>=', value: startTs },
          { field: 'Date', op: '<', value: endTs },
        ],
        limit,
      });
      return { rows: rowsTs || [] };
    }
    return { rows: [] };
  } catch (e) {
    return { rows: [] };
  }
}

// Realtime listeners so UI only updates when docs change.
export function listenMembers(onRows, onError) {
  return fb.listenCollection(COLS.members, onRows, onError);
}

// Listen to currently-active payments (by valid-until fields). Merges multiple queries.
export function listenPaymentsActive(onRows, onError, { limit = 4000 } = {}) {
  const today = manilaYMD(new Date());
  const startTs = manilaStartOfDay(today);
  let rowsA = [];
  let rowsB = [];
  let rowsC = [];
  let rowsD = [];
  let rowsE = [];
  let rowsF = [];
  const emit = () => {
    try { onRows && onRows(mergeById(rowsA, rowsB, rowsC, rowsD, rowsE, rowsF)); } catch (e) { /* ignore */ }
  };
  const unsubs = [];

  const listenField = (field, idx, value) => {
    try {
      unsubs.push(
        fb.listenQueryCollection(
          COLS.payments,
          { wheres: [{ field, op: '>=', value }], limit },
          (r) => {
            const rows = r || [];
            if (idx === 0) rowsA = rows;
            else if (idx === 1) rowsB = rows;
            else if (idx === 2) rowsC = rows;
            else if (idx === 3) rowsD = rows;
            else if (idx === 4) rowsE = rows;
            else if (idx === 5) rowsF = rows;
            emit();
          },
          onError
        )
      );
    } catch (e) { /* ignore */ }
  };

  // Keep listener count low: listen to the most common 3 keys as strings,
  // and their Timestamp variants as fallbacks.
  const keys = ['GymValidUntil', 'CoachValidUntil', 'EndDate'];
  keys.forEach((k, i) => listenField(k, i, today));
  if (startTs) {
    keys.forEach((k, i) => listenField(k, i + 3, startTs));
  }

  return () => {
    for (const u of unsubs) {
      try { typeof u === 'function' && u(); } catch (e) { /* ignore */ }
    }
  };
}

export function listenGymEntriesForDate(dateYMD, onRows, onError) {
  const ymd = String(dateYMD || '').trim();
  if (!ymd) return () => {};
  const next = ymdNext(ymd);
  const { start, end } = ymdToLocalDayRange(ymd);
  let rowsA = [];
  let rowsB = [];
  const emit = () => {
    try { onRows && onRows(mergeById(rowsA, rowsB)); } catch (e) { /* ignore */ }
  };
  const unsubs = [];

  // String range listener: covers YYYY-MM-DD and ISO strings.
  if (next) {
    try {
      unsubs.push(
        fb.listenQueryCollection(
          COLS.gymEntries,
          { wheres: [{ field: 'Date', op: '>=', value: ymd }, { field: 'Date', op: '<', value: next }], limit: 2000 },
          (r) => { rowsA = r || []; emit(); },
          onError
        )
      );
    } catch (e) { /* ignore */ }
  }

  // Timestamp range listener.
  if (start && end) {
    try {
      unsubs.push(
        fb.listenQueryCollection(
          COLS.gymEntries,
          { wheres: [{ field: 'Date', op: '>=', value: start }, { field: 'Date', op: '<', value: end }], limit: 2000 },
          (r) => { rowsB = r || []; emit(); },
          onError
        )
      );
    } catch (e) { /* ignore */ }
  }

  return () => { for (const u of unsubs) { try { u && u(); } catch (e) {} } };
}

export function listenPaymentsForDate(dateYMD, onRows, onError) {
  const ymd = String(dateYMD || '').trim();
  if (!ymd) return () => {};
  const next = ymdNext(ymd);
  const { start, end } = ymdToLocalDayRange(ymd);
  let rowsA = [];
  let rowsB = [];
  const emit = () => {
    try { onRows && onRows(mergeById(rowsA, rowsB)); } catch (e) { /* ignore */ }
  };
  const unsubs = [];

  if (next) {
    try {
      unsubs.push(
        fb.listenQueryCollection(
          COLS.payments,
          { wheres: [{ field: 'Date', op: '>=', value: ymd }, { field: 'Date', op: '<', value: next }], limit: 2000 },
          (r) => { rowsA = r || []; emit(); },
          onError
        )
      );
    } catch (e) { /* ignore */ }
  }

  if (start && end) {
    try {
      unsubs.push(
        fb.listenQueryCollection(
          COLS.payments,
          { wheres: [{ field: 'Date', op: '>=', value: start }, { field: 'Date', op: '<', value: end }], limit: 2000 },
          (r) => { rowsB = r || []; emit(); },
          onError
        )
      );
    } catch (e) { /* ignore */ }
  }

  return () => { for (const u of unsubs) { try { u && u(); } catch (e) {} } };
}

export function listenPaymentsForMonth(monthKey, onRows, onError) {
  const mk = String(monthKey || '').trim();
  if (!mk || !/^\d{4}-\d{2}$/.test(mk)) return () => {};
  const start = `${mk}-01`;
  const nextMonth = ymdMonthNext(mk);
  const endExclusive = nextMonth ? `${nextMonth}-01` : `${mk}-32`;
  const { start: startTs, end: endTs } = monthKeyToLocalRange(mk);
  let rowsA = [];
  let rowsB = [];
  const emit = () => {
    try { onRows && onRows(mergeById(rowsA, rowsB)); } catch (e) { /* ignore */ }
  };
  const unsubs = [];

  // String range listener (YYYY-MM-DD or ISO strings).
  try {
    unsubs.push(
      fb.listenQueryCollection(
        COLS.payments,
        {
          wheres: [
            { field: 'Date', op: '>=', value: start },
            { field: 'Date', op: '<', value: endExclusive },
          ],
          limit: 8000,
        },
        (r) => { rowsA = r || []; emit(); },
        onError
      )
    );
  } catch (e) { /* ignore */ }

  // Timestamp range listener.
  if (startTs && endTs) {
    try {
      unsubs.push(
        fb.listenQueryCollection(
          COLS.payments,
          {
            wheres: [
              { field: 'Date', op: '>=', value: startTs },
              { field: 'Date', op: '<', value: endTs },
            ],
            limit: 8000,
          },
          (r) => { rowsB = r || []; emit(); },
          onError
        )
      );
    } catch (e) { /* ignore */ }
  }

  return () => { for (const u of unsubs) { try { u && u(); } catch (e) {} } };
}

export function listenExpensesForMonth(monthKey, onRows, onError) {
  const mk = String(monthKey || '').trim();
  if (!mk || !/^\d{4}-\d{2}$/.test(mk)) return () => {};
  const start = `${mk}-01`;
  const nextMonth = ymdMonthNext(mk);
  const endExclusive = nextMonth ? `${nextMonth}-01` : `${mk}-32`;
  const { start: startTs, end: endTs } = monthKeyToLocalRange(mk);
  let rowsA = [];
  let rowsB = [];
  const emit = () => {
    try { onRows && onRows(mergeById(rowsA, rowsB)); } catch (e) { /* ignore */ }
  };
  const unsubs = [];

  try {
    unsubs.push(
      fb.listenQueryCollection(
        COLS.expenses,
        {
          wheres: [
            { field: 'Date', op: '>=', value: start },
            { field: 'Date', op: '<', value: endExclusive },
          ],
          limit: 8000,
        },
        (r) => { rowsA = r || []; emit(); },
        onError
      )
    );
  } catch (e) { /* ignore */ }

  if (startTs && endTs) {
    try {
      unsubs.push(
        fb.listenQueryCollection(
          COLS.expenses,
          {
            wheres: [
              { field: 'Date', op: '>=', value: startTs },
              { field: 'Date', op: '<', value: endTs },
            ],
            limit: 8000,
          },
          (r) => { rowsB = r || []; emit(); },
          onError
        )
      );
    } catch (e) { /* ignore */ }
  }

  return () => { for (const u of unsubs) { try { u && u(); } catch (e) {} } };
}

export function listenRevenuesForMonth(monthKey, onRows, onError) {
  const mk = String(monthKey || '').trim();
  if (!mk || !/^\d{4}-\d{2}$/.test(mk)) return () => {};
  const start = `${mk}-01`;
  const nextMonth = ymdMonthNext(mk);
  const endExclusive = nextMonth ? `${nextMonth}-01` : `${mk}-32`;
  const { start: startTs, end: endTs } = monthKeyToLocalRange(mk);
  let rowsA = [];
  let rowsB = [];
  const emit = () => {
    try { onRows && onRows(mergeById(rowsA, rowsB)); } catch (e) { /* ignore */ }
  };
  const unsubs = [];

  try {
    unsubs.push(
      fb.listenQueryCollection(
        COLS.revenues,
        {
          wheres: [
            { field: 'Date', op: '>=', value: start },
            { field: 'Date', op: '<', value: endExclusive },
          ],
          limit: 8000,
        },
        (r) => { rowsA = r || []; emit(); },
        onError
      )
    );
  } catch (e) { /* ignore */ }

  if (startTs && endTs) {
    try {
      unsubs.push(
        fb.listenQueryCollection(
          COLS.revenues,
          {
            wheres: [
              { field: 'Date', op: '>=', value: startTs },
              { field: 'Date', op: '<', value: endTs },
            ],
            limit: 8000,
          },
          (r) => { rowsB = r || []; emit(); },
          onError
        )
      );
    } catch (e) { /* ignore */ }
  }

  return () => { for (const u of unsubs) { try { u && u(); } catch (e) {} } };
}

// Upload photo helpers (client). Uses Firebase Storage via fb.uploadFile
export async function uploadMemberPhoto(fileOrArgs, baseId) {
  // Accept file Blob/File or object { memberId, filename, mime, data }
  // helper: convert Blob/File to dataURL
  const blobToDataURL = (blob) => new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(blob);
    } catch (err) { reject(err); }
  });

  // Attempt native Firebase Storage upload first; if it fails (CORS or config), fall back to server proxy
  try {
    if (fileOrArgs instanceof Blob || (typeof File !== 'undefined' && fileOrArgs instanceof File)) {
      const file = fileOrArgs;
      const filename = (file && file.name) || `photo-${Date.now()}.jpg`;
      const path = `members/${String(baseId||'unknown')}/${filename}`;
      const url = await fb.uploadFile(path, file);
      return url;
    }

    // object signature
    const obj = fileOrArgs || {};
    const memberId = obj.memberId || obj.MemberID || baseId || 'unknown';
    const filename = obj.filename || `photo-${Date.now()}.jpg`;
    const data = obj.data || obj.base64 || '';
    const path = `members/${String(memberId)}/${filename}`;
    const url = await fb.uploadFile(path, data);
    return url;
  } catch (e) {
    // fallback: try server-side upload proxy (local dev). Convert file/blob to dataURL if needed.
    try {
      let dataUrl = '';
      let filename = `photo-${Date.now()}.jpg`;
      if (fileOrArgs instanceof Blob || (typeof File !== 'undefined' && fileOrArgs instanceof File)) {
        const file = fileOrArgs;
        dataUrl = await blobToDataURL(file);
        filename = (file && file.name) || filename;
      } else {
        const obj = fileOrArgs || {};
        dataUrl = obj.data || obj.base64 || '';
        filename = obj.filename || filename;
      }

      if (!dataUrl) throw new Error('no data for fallback upload');

      const resp = await fetch('/api/upload-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, data: dataUrl }),
      });
      if (!resp.ok) throw new Error('proxy upload failed');
      const body = await resp.json();
      if (body && body.url) return (body.url.indexOf('http') === 0) ? body.url : `${location.origin}${body.url}`;
      throw new Error('invalid proxy response');
    } catch (e2) {
      throw new Error('uploadMemberPhoto failed: ' + String(e2?.message || e));
    }
  }
}
export async function uploadPhoto(args) { return uploadMemberPhoto(args); }

export async function fetchPricing() { const p = await fb.getCollection(COLS.pricing); return { rows: p }; }

export async function addPricing(row) {
  const r = await fb.addDocument(COLS.pricing, row);
  return { ok: true, id: r.id, row: r };
}

export async function updatePricing(id, patch) {
  const r = await fb.updateDocument(COLS.pricing, String(id), patch);
  return { ok: true, id: r.id, row: r };
}

// Attendance: store as docs in attendance collection. Provide basic clockIn/clockOut helpers.
export async function fetchAttendance(dateYMD) {
  if (dateYMD) {
    const ymd = String(dateYMD || '').trim();
    try {
      const rows = await fb.queryCollection(COLS.attendance, { wheres: [{ field: 'Date', op: '==', value: ymd }], limit: 2000 });
      return { rows };
    } catch (e) {
      // fallback to full scan
    }
  }
  const rows = await fb.getCollection(COLS.attendance);
  if (!dateYMD) return { rows };
  return { rows: rows.filter(r => String(r.Date || '').startsWith(String(dateYMD))) };
}

export async function fetchAttendanceSince({ days = 30, limit = 2000 } = {}) {
  const cutoff = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
  const cutoffYMD = cutoff.toISOString().slice(0, 10);
  try {
    const rows = await fb.queryCollection(COLS.attendance, {
      wheres: [{ field: 'Date', op: '>=', value: cutoffYMD }],
      orderBy: { field: 'Date', dir: 'desc' },
      limit,
    });
    return { rows };
  } catch (e) {
    // fallback to full scan and client filter
    try {
      const rows = await fb.getCollection(COLS.attendance);
      const filtered = (rows || []).filter(r => String(r.Date || '').slice(0,10) >= cutoffYMD);
      return { rows: filtered.slice(0, limit) };
    } catch (e2) {
      return { rows: [] };
    }
  }
}

export async function clockIn(staff) {
  if (!staff) throw new Error('staff required');
  const t = new Date().toISOString();
  const doc = await fb.addDocument(COLS.attendance, { Staff: staff, TimeIn: t, Date: t.slice(0,10) });
  return { ok: true, id: doc.id };
}

export async function clockOut(staff) {
  // find the most recent open entry for staff and set TimeOut
  const rows = await fb.getCollection(COLS.attendance);
  const open = rows.filter(r => String(r.Staff) === String(staff) && (!r.TimeOut || r.TimeOut === '') ).sort((a,b) => (a.TimeIn||'').localeCompare(b.TimeIn||''));
  if (!open.length) return { ok: false, error: 'no open entry' };
  const target = open[open.length - 1];
  await fb.updateDocument(COLS.attendance, target.id, { TimeOut: new Date().toISOString() });
  return { ok: true };
}

export async function attendanceQuickAppend(staff, extra = {}){
  if (!staff) throw new Error('staff required');
  const now = new Date().toISOString();
  const date = now.slice(0,10);
  const doc = await fb.addDocument(COLS.attendance, { Staff: staff, TimeIn: now, Date: date, ...extra });
  return { ok: true, id: doc.id };
}

export async function fetchDashboard() { return { rows: [] }; }

const api = {
  fetchMembers, fetchMembersFresh, addMember, saveMember, updateMember, fetchMemberById, fetchMemberByIdFresh, fetchMemberBundle,
  fetchAttendance, fetchAttendanceSince, clockIn, clockOut,
  fetchGymEntries, fetchGymEntriesFresh, addGymEntry, gymQuickAppend,
  fetchProgressTracker, addProgressRow,
  fetchPricing, fetchPayments, fetchLatestPaymentForMember, addPayment, updatePayment, deletePayment, fetchDashboard,
  // new helpers
  fetchMembersRecent, searchMembersByName,
  fetchGymEntriesSince, fetchGymEntriesForDate,
  fetchPaymentsSince, fetchPaymentsForDate, fetchPaymentsForMonth,
  fetchExpensesForMonth, fetchRevenuesForMonth,
  listenMembers, listenGymEntriesForDate, listenPaymentsForDate, listenPaymentsForMonth,
  listenExpensesForMonth, listenRevenuesForMonth,
  listenPaymentsActive,
  addExpense, addRevenue,
  addPricing, updatePricing, uploadPhoto,
};

export default api;
