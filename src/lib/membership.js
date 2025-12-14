// Shared membership detection helpers
const toKey = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, "_");
const firstOf = (o, ks) => ks.map((k) => (o || {})[k]).find((v) => v !== undefined && v !== "");

// Parse various date-like values, preferring Firestore Timestamp -> Date, numeric seconds, Date, or string.
const asDate = (v) => {
  if (!v && v !== 0) return null;
  try { if (v && typeof v.toDate === 'function') return v.toDate(); } catch (e) {}
  if (v && typeof v.seconds === 'number') return new Date(v.seconds * 1000);
  if (v instanceof Date) return v;
  // If value is a YYYY-MM-DD string, parse it as Manila local midnight by appending +08:00
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    try { return new Date(`${v}T00:00:00+08:00`); } catch (e) { /* fallback */ }
  }
  const d = new Date(v);
  return isNaN(d) ? null : d;
};

const normRow = (row) => {
  const out = {};
  Object.entries(row || {}).forEach(([k, v]) => { out[toKey(k)] = v; });
  return out;
};

// Compute membership/coach status for a given member using payments and optional pricing rows.
// paymentsArray: array of payment rows (can be full set or already filtered)
// memberOrId: either a member object (will attempt to extract id fields) or a member id string
// pricingRows: optional pricing rows to infer product flags
export function computeStatusForMember(paymentsArray, memberOrId, pricingRows = [], asOfYMD = null) {
  // Use Manila-only date comparisons: compute YYYY-MM-DD in Asia/Manila
  const manilaYMD = (d) => {
    if (!d) return null;
    const date = d instanceof Date ? d : asDate(d);
    if (!date) return null;
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  };
  const today = (typeof asOfYMD === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(asOfYMD)) ? asOfYMD : manilaYMD(new Date());
  let membershipEnd = null, coachEnd = null; // will store Date objects at Manila midnight
  let membershipEndYMD = null, coachEndYMD = null; // store YMD strings for comparisons

  // build pricing map
  const map = new Map();
  const rows = Array.isArray(pricingRows) ? pricingRows : [];
  const truthy = (v) => { const s = String(v ?? "").trim().toLowerCase(); return s === 'yes' || s === 'y' || s === 'true' || s === '1'; };
  const pick = (o, keys) => { for (const k of keys) { if (o && Object.prototype.hasOwnProperty.call(o, k)) return o[k]; const alt = Object.keys(o || {}).find((kk) => kk.toLowerCase().replace(/\s+/g, "") === k.toLowerCase().replace(/\s+/g, "")); if (alt) return o[alt]; } return undefined; };
  rows.forEach((r) => {
    const name = String(pick(r, ['Particulars']) || '').trim();
    if (!name) return;
    const gymFlag = truthy(pick(r, ['Gym membership','Gym Membership','GymMembership','Membership']));
    const coachFlag = truthy(pick(r, ['Coach subscription','Coach Subscription','CoachSubscription','Coach']));
    map.set(String(name).toLowerCase(), { gym: gymFlag, coach: coachFlag });
  });

  // derive memberId if memberOrId is an object
  let memberId = null;
  if (typeof memberOrId === 'string') memberId = String(memberOrId || '').trim().toLowerCase();
  else if (memberOrId && typeof memberOrId === 'object') {
    const n = normRow(memberOrId);
    memberId = String(firstOf(n, ['memberid','member_id','id','member_id_']) || '').trim().toLowerCase();
  }

  const pays = Array.isArray(paymentsArray) ? paymentsArray : [];
  for (const raw of pays) {
    // normalize row keys for easy lookup
    const p = normRow(raw);
    // if memberId provided, skip other members
    if (memberId) {
      const pid = String(firstOf(p, ['memberid','member_id','id','member_id_']) || '').trim().toLowerCase();
      if (!pid || pid !== memberId) continue;
    }
    const tag = String(firstOf(p, ['particulars','type','item','category','product','paymentfor','plan','description']) || '').trim();
    const gymUntilRaw = firstOf(p, ['gymvaliduntil','gym_valid_until','gym_until','enddate','end_date','valid_until','expiry','expires','until','end']);
    // Only treat explicit coach-specific fields as coach-until. Do NOT treat generic enddate
    // as a coach-until (that made coach end mirror gym end incorrectly).
    const coachUntilRaw = firstOf(p, ['coachvaliduntil','coach_valid_until','coach_until','coach_end','coachend']);
    const endRaw = firstOf(p, ['enddate','end_date','valid_until','expiry','expires','until','end']);
    const gymUntil = asDate(gymUntilRaw);
    const coachUntil = asDate(coachUntilRaw);
    const end = asDate(endRaw);
    const gymY = manilaYMD(gymUntil);
    const coachY = manilaYMD(coachUntil);
    const endY = manilaYMD(end);

    const flags = map.get(String(tag).toLowerCase()) || { gym: null, coach: null };
    const impliesCoach = flags.coach === true || (flags.coach === null && /coach|trainer|pt/i.test(tag));
    const impliesGym = flags.gym === true || (flags.gym === null && /member|gym/i.test(tag));

    if (gymY) {
      if (!membershipEndYMD || gymY > membershipEndYMD) {
        membershipEndYMD = gymY; membershipEnd = gymUntil;
      }
    } else if (impliesGym && endY) {
      if (!membershipEndYMD || endY > membershipEndYMD) {
        membershipEndYMD = endY; membershipEnd = end;
      }
    }
    if (coachY) {
      if (!coachEndYMD || coachY > coachEndYMD) {
        coachEndYMD = coachY; coachEnd = coachUntil;
      }
    } else if (impliesCoach && endY) {
      if (!coachEndYMD || endY > coachEndYMD) {
        coachEndYMD = endY; coachEnd = end;
      }
    }
  }

  // If payments don't provide membershipEnd, attempt to read member-level fields from memberOrId when it's an object.
  // Important: do NOT early-return just because the member state says "active"; explicit end-date fields should win.
  let memberStateRaw = null;
  if ((!membershipEnd || membershipEnd == null) && memberOrId && typeof memberOrId === 'object') {
    const m = normRow(memberOrId);
    memberStateRaw = String(firstOf(m, ['membershipstate','membership_state','membership','status']) || '').trim().toLowerCase() || null;
    const memberGymUntil = firstOf(m, ['membershipend','membership_end','membershipEnd','membership_end','gymvaliduntil','gym_valid_until','gym_until','enddate','end_date','valid_until','expiry','expires','until','end','gym_valid','gym_validity','gymvalid']);
    if (memberGymUntil) {
      const g = asDate(memberGymUntil);
      const gy = manilaYMD(g);
      if (g && !isNaN(g)) {
        if (!membershipEndYMD || gy > membershipEndYMD) { membershipEndYMD = gy; membershipEnd = g; }
      }
    }
  }

  let membershipState = null;
  if (membershipEndYMD) {
    membershipState = membershipEndYMD >= today ? 'active' : 'expired';
  } else if (memberStateRaw === 'active') {
    membershipState = 'active';
  }
  let coachActive = false;
  if (coachEndYMD) {
    coachActive = coachEndYMD >= today;
  }
  return { membershipEnd, membershipState, coachEnd, coachActive };
}

// Compute an extension end-date (YYYY-MM-DD, Manila) given an existing end-date, a start YMD, and validity in days.
// Rules:
// - If existingEnd is active (>= today in Manila), base = existingEnd + 1 day
// - Otherwise base = startYmd (if provided) or today (Manila)
// - End date is inclusive: end = base + (validity - 1) days
export function computeExtension({ existingEnd, startYmd, validityDays }) {
  const manilaYMD = (d) => {
    if (!d) return null;
    const date = d instanceof Date ? d : asDate(d);
    if (!date) return null;
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  };
  const today = manilaYMD(new Date());
  const existingY = manilaYMD(existingEnd);
  // determine base YMD
  let base = startYmd || today;
  if (existingY && existingY >= today) {
    // add one day to existingY
    const dt = new Date(`${existingY}T00:00:00+08:00`);
    dt.setUTCDate(dt.getUTCDate() + 1);
    base = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(dt);
  }
  if (!validityDays || Number(validityDays) <= 0) return '';
  // compute inclusive end: start + (validityDays - 1)
  const startDt = new Date(`${base}T00:00:00+08:00`);
  startDt.setUTCDate(startDt.getUTCDate() + (Number(validityDays) - 1));
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(startDt);
}

export default { computeStatusForMember };
