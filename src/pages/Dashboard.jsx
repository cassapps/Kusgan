
import { useEffect, useState, useMemo, useRef } from "react";
import api from "../api";
const {
  fetchMembers,
  fetchPayments,
  fetchGymEntries,
  fetchGymEntriesFresh,
  fetchGymEntriesSince,
  fetchPricing,
  fetchDashboard,
  gymQuickAppend,
  listenMembers,
  listenGymEntriesForDate,
  listenPaymentsForDate,
  listenPaymentsActive,
  listenLatestPayment,
} = api;
import { useNavigate } from "react-router-dom";
import { fmtTime, fmtDate, display } from "./MemberDetail.jsx";
import { isTimeOutMissingRow, firstOf as firstOfVisit } from '../lib/visitUtils';
import { computeStatusForMember } from '../lib/membership';
import VisitViewModal from "../components/VisitViewModal";
import CheckInConfirmModal from "../components/CheckInConfirmModal";
import events from "../lib/events";
import RefreshBadge from '../components/RefreshBadge.jsx';
import displayName from '../lib/displayName';
import ModalWrapper from '../components/ModalWrapper.jsx';
import { getMemberPills } from '../lib/discount.js';
import useLoadMore from "../lib/useLoadMore.js";
import useManilaDayKey from '../lib/useManilaDayKey.js';

function todayYMD() {
  const now = new Date();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function shiftManilaYMD(ymd, deltaDays) {
  try {
    const base = (typeof ymd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ymd)) ? ymd : todayYMD();
    const d = new Date(`${base}T00:00:00+08:00`);
    d.setUTCDate(d.getUTCDate() + (Number(deltaDays) || 0));
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch (e) {
    return ymd;
  }
}

function formatManilaYmdLong(ymd) {
  try {
    const s = String(ymd || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(`${s}T00:00:00+08:00`);
    if (!(d instanceof Date) || isNaN(d)) return s;
    const dateParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      month: 'short',
      day: '2-digit',
      year: 'numeric',
    }).formatToParts(d);
    const dow = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', weekday: 'long' }).format(d);
    const mon = dateParts.find(p => p.type === 'month')?.value || '';
    const day = dateParts.find(p => p.type === 'day')?.value || '';
    const year = dateParts.find(p => p.type === 'year')?.value || '';
    if (!mon || !day || !year) return s;
    return `${mon}-${day}, ${year} (${String(dow || '').toUpperCase()})`;
  } catch (e) {
    return String(ymd || '');
  }
}

// Keep local name firstOf for earlier usage but delegate to shared visit util
const firstOf = (o, ks) => firstOfVisit(o, ks);

export default function Dashboard() {
  const navigate = useNavigate();
  const useFirestore = String(import.meta.env.VITE_USE_FIRESTORE ?? 'true') === 'true';
  const manilaDayKey = useManilaDayKey();
  const lastTodayRef = useRef(todayYMD());
  const [selectedYmd, setSelectedYmd] = useState(() => todayYMD());
  const selectedYmdLabel = useMemo(() => formatManilaYmdLong(selectedYmd), [selectedYmd]);
  // state/hooks
  const [stats, setStats] = useState({
    totalMembers: 0,
    activeGym: 0,
    activeCoach: 0,
    visitedToday: 0,
    coachToday: 0,
    checkedIn: 0,
    cashToday: 0,
    gcashToday: 0,
  });
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [members, setMembers] = useState([]);
  const [payments, setPayments] = useState([]);
  const [paymentsToday, setPaymentsToday] = useState([]);
  const [paymentsActive, setPaymentsActive] = useState([]);
  const [gymEntries, setGymEntries] = useState([]);
  const [gymEntriesForLastVisit, setGymEntriesForLastVisit] = useState([]);
  const [pricing, setPricing] = useState([]);
  const [showAllGym, setShowAllGym] = useState(false);
  const [showAllPayments, setShowAllPayments] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [checkoutMemberId, setCheckoutMemberId] = useState(null);
  const [checkoutInitialEntry, setCheckoutInitialEntry] = useState(null);

  const [openPaymentsModal, setOpenPaymentsModal] = useState(false);
  const [paymentsModalKind, setPaymentsModalKind] = useState('all'); // 'all' | 'cash' | 'gcash'

  const [openActiveModal, setOpenActiveModal] = useState(false);
  const [activeModalKind, setActiveModalKind] = useState('gym'); // 'gym' | 'coach'

  

  const parseMaybeDate = (v) => {
    try {
      if (!v && v !== 0) return null;
      if (v instanceof Date) return isNaN(v) ? null : v;
      if (typeof v === 'number') {
        const d = new Date(v);
        return isNaN(d) ? null : d;
      }
      // Firestore Timestamp (client/admin) commonly has toDate()/toMillis() or seconds/_seconds
      if (v && typeof v.toDate === 'function') {
        const d = v.toDate();
        return (d instanceof Date && !isNaN(d)) ? d : null;
      }
      if (v && typeof v.toMillis === 'function') {
        const d = new Date(v.toMillis());
        return isNaN(d) ? null : d;
      }
      if (v && typeof v.seconds === 'number') {
        const d = new Date(v.seconds * 1000);
        return isNaN(d) ? null : d;
      }
      if (v && typeof v._seconds === 'number') {
        const d = new Date(v._seconds * 1000);
        return isNaN(d) ? null : d;
      }
      const d = new Date(v);
      return isNaN(d) ? null : d;
    } catch (e) {
      return null;
    }
  };

  const manilaYMD = (v) => {
    try {
      if (!v && v !== 0) return null;
      if (typeof v === 'string') {
        const s = v.trim();
        // If it's already a YYYY-MM-DD (or starts with it), treat it as date-only.
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
      }
      const d = parseMaybeDate(v);
      if (!d) return null;
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
    } catch (e) {
      return null;
    }
  };

  const isDateActive = (v, asOfYmd) => {
    const endYMD = manilaYMD(v);
    if (!endYMD) return false;
    const ref = (typeof asOfYmd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(asOfYmd)) ? asOfYmd : todayYMD();
    return endYMD >= ref;
  };

  const dateOptions = useMemo(() => {
    const today = todayYMD();
    const out = [];
    for (let i = 0; i < 7; i++) {
      const ymd = shiftManilaYMD(today, -i);
      out.push({ ymd, label: formatManilaYmdLong(ymd) });
    }
    return out;
  }, [manilaDayKey]);

  // If the user had "today" selected, keep it on the new day after Manila midnight.
  useEffect(() => {
    const curToday = todayYMD();
    const prevToday = lastTodayRef.current;
    if (prevToday && selectedYmd === prevToday && curToday !== prevToday) {
      setSelectedYmd(curToday);
    }
    lastTodayRef.current = curToday;
  }, [manilaDayKey, selectedYmd]);

  // Trigger a lightweight refresh bump when any payment is added (Firestore realtime).
  const [paymentsBump, setPaymentsBump] = useState(0);
  useEffect(() => {
    if (!useFirestore) return;
    let unsub = null;
    let lastId = null;
    try {
      unsub = listenLatestPayment((row) => {
        const id = String(row?.id || row?._id || '').trim();
        if (!id) return;
        if (lastId && id === lastId) return;
        lastId = id;
        setPaymentsBump((x) => x + 1);
      }, () => {});
    } catch (e) {
      unsub = null;
    }
    return () => {
      try { unsub && unsub(); } catch (e) {}
    };
  }, [useFirestore, listenLatestPayment]);

  const resolveMemberId = (m) => String(m?.MemberID || m?.member_id || m?.memberid || m?.memberId || m?.id || '').trim();
  const resolveNick = (m) => String(m?.NickName || m?.nick_name || m?.nickname || m?.nickName || '').trim();
  const resolveFullName = (m) => {
    const full = String(m?.full_name || m?.FullName || m?.fullname || '').trim();
    if (full) return full;
    const first = String(m?.FirstName || m?.first_name || m?.firstname || m?.firstName || '').trim();
    const last = String(m?.LastName || m?.last_name || m?.lastname || m?.lastName || '').trim();
    return [first, last].filter(Boolean).join(' ');
  };
  const resolveMemberSince = (m) => (
    m?.MemberSince || m?.member_since || m?.membersince || m?.member_date || m?.memberdate ||
    m?.createdAt || m?.created_at || m?.Created || m?.created || m?.join_date || m?.joined || m?.start_date ||
    m?._raw?.MemberSince || m?._raw?.createdAt || null
  );

  const paymentsByMember = useMemo(() => {
    const map = new Map();
    for (const p of (payments || [])) {
      const id = String(p.MemberID || p.member_id || p.id || p.member || '').trim();
      if (!id) continue;
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(p);
    }
    return map;
  }, [payments]);

  const activePaymentsByMember = useMemo(() => {
    const map = new Map();
    for (const p of (paymentsActive || [])) {
      const id = String(p.MemberID || p.member_id || p.id || p.member || '').trim();
      if (!id) continue;
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(p);
    }
    return map;
  }, [paymentsActive]);

  const lastVisitByMember = useMemo(() => {
    const map = new Map();
    const source = useFirestore ? (gymEntriesForLastVisit || []) : (gymEntries || []);
    for (const e of source) {
      const id = String(e?.MemberID || e?.member_id || e?.id || e?.member || '').trim();
      if (!id) continue;
      const d = parseMaybeDate(e?.Date || e?.date || e?.Timestamp || e?.timestamp || e?.created || e?.TimeIn || null);
      if (!d) continue;
      const prev = map.get(id);
      if (!prev || d > prev) map.set(id, d);
    }
    return map;
  }, [useFirestore, gymEntries, gymEntriesForLastVisit]);

  useEffect(() => {
    if (!useFirestore) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetchGymEntriesSince({ days: 365, limit: 5000 });
        if (!alive) return;
        setGymEntriesForLastVisit(res?.rows || res?.data || []);
      } catch (e) {
        if (!alive) return;
        setGymEntriesForLastVisit([]);
      }
    })();
    return () => { alive = false; };
  }, [useFirestore]);

  const activeMembers = useMemo(() => {
    try {
      // Active lists are always as-of today (not the selected historical date).
      const asOf = todayYMD();
      const pick = (o, keys) => {
        for (const k of keys) {
          if (o && Object.prototype.hasOwnProperty.call(o, k)) return o[k];
          const alt = Object.keys(o || {}).find((kk) => kk.toLowerCase().replace(/\s+/g, "") === k.toLowerCase().replace(/\s+/g, ""));
          if (alt) return o[alt];
        }
        return undefined;
      };

      const outGym = [];
      const outCoach = [];
      for (const m of (members || [])) {
        const memberId = resolveMemberId(m);
        if (!memberId) continue;

        const pays = useFirestore
          ? (activePaymentsByMember.get(memberId) || [])
          : (paymentsByMember.get(memberId) || []);

        const st0 = computeStatusForMember(pays, m, pricing || [], asOf);
        const gymUntil = st0?.membershipEnd ?? pick(m, [
          'membershipEnd','membership_end','gymvaliduntil','gym_valid_until','gym_until','enddate','end_date','valid_until','expiry','expires','until','end','gym_valid','gym_validity','gymvalid'
        ]);
        const coachUntil = st0?.coachEnd ?? pick(m, [
          'coachEnd','coach_end','coach_subscription_end','coach_subscription_end_date','coachvaliduntil','coach_valid_until','coach_until','coach_expiry','coach_expires'
        ]);

        const membershipState = String(m?.membershipState || m?.membership_state || m?.status || '').trim().toLowerCase();
        const coachState = String(m?.coachState || m?.coach_state || '').trim().toLowerCase();

        // Only trust member-level "active" flags when an end-date is missing.
        // If an end-date exists, the date comparison wins.
        const gymActive = (st0?.membershipState === 'active') || isDateActive(gymUntil, asOf) || (!gymUntil && membershipState === 'active');
        const coachActive = (st0?.coachActive === true) || isDateActive(coachUntil, asOf) || (!coachUntil && coachState === 'active');

        const st = {
          ...(st0 || {}),
          membershipEnd: gymUntil,
          coachEnd: coachUntil,
          membershipState: gymActive ? 'active' : (st0?.membershipState || membershipState || ''),
          coachActive,
        };

        if (gymActive) outGym.push({ member: m, memberId, st });
        if (coachActive) outCoach.push({ member: m, memberId, st });
      }
      return { gym: outGym, coach: outCoach };
    } catch (e) {
      return { gym: [], coach: [] };
    }
  }, [useFirestore, members, paymentsByMember, activePaymentsByMember, pricing, selectedYmd, manilaDayKey, paymentsBump]);

  const openActiveList = (kind) => {
    setActiveModalKind(kind);
    setOpenActiveModal(true);
  };

  // Generate gym entry rows (computed after state is declared to avoid TDZ)
  const gymEntryRows = useMemo(() => {
    const asOf = (typeof selectedYmd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(selectedYmd)) ? selectedYmd : todayYMD();
    const todays = (gymEntries || []).filter(e => {
      const d = e.Date || e.date;
      const ymd = manilaYMD(d) || '';
      return ymd === asOf;
    });
    // Sort: open entries (missing TimeOut) first, then by TimeIn descending
    todays.sort((a, b) => {
      const aOut = String(firstOf(a, ["TimeOut","timeout","time_out"]) || '').trim();
      const bOut = String(firstOf(b, ["TimeOut","timeout","time_out"]) || '').trim();
      const aOpen = aOut === '' || aOut === '-' || aOut === '—';
      const bOpen = bOut === '' || bOut === '-' || bOut === '—';
      if (aOpen && !bOpen) return -1;
      if (!aOpen && bOpen) return 1;
      // both same open/closed state: sort by TimeIn descending (most recent first)
      const aTin = String(firstOf(a, ["TimeIn","timein","time_in"]) || '').trim();
      const bTin = String(firstOf(b, ["TimeIn","timein","time_in"]) || '').trim();
      return String(bTin).localeCompare(String(aTin));
    });

    return todays.map((e, idx) => {
    const pid = String(firstOf(e, ["MemberID","memberid","member_id","member","id"]) || "").trim();
    const member = (members || []).find(m => String(firstOf(m, ["MemberID","memberid","member_id","id"]) || "").trim() === pid);
    const pills = member ? getMemberPills(member) : [];
    const timeIn = firstOf(e, ["TimeIn","timein","time_in"]) || "";
    const timeOut = firstOf(e, ["TimeOut","timeout","time_out"]) || "";
      const isOpen = (String(timeOut).trim() === '' || String(timeOut).trim() === '-' || String(timeOut).trim() === '—');
    // Prefer server/sheet-calculated hours fields (the sheet has formulas). Do not compute here.
    const totalHours = firstOf(e, ["TotalHours","totalhours","NoOfHours","noofhours","hours"]) || "";
    return (
      <tr key={idx} style={{ cursor: "pointer" }} onClick={() => setSelectedEntry(e)}>
        <td className="td-fullname" style={{ textAlign: 'left' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span>{displayName(member)}</span>
            {pills.length > 0 && (
              <span style={{ display: 'inline-flex', gap: 6 }}>
                {pills.map(p => <span key={p.key} className={`pill ${p.className}`}>{p.label}</span>)}
              </span>
            )}
          </span>
        </td>
        <td>{fmtTime(timeIn)}</td>
        <td>{fmtTime(timeOut)}</td>
          <td>{display(totalHours)}</td>
        <td>{display(e.Coach || e.coach)}</td>
        <td>{display(e.Focus || e.focus)}</td>
      </tr>
    );
    });
  }, [gymEntries, members, selectedYmd]);

  // Helper: compute stats from fetched arrays (returns stats object)
  const computeStatsFromData = (membersArr, paymentsArr, gymArr, pricingArr, asOfYmd) => {
    const asOf = (typeof asOfYmd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(asOfYmd)) ? asOfYmd : todayYMD();
    // Active membership/subscription counts are always as-of today.
    const asOfMembership = todayYMD();
    const pricingFlags = new Map();
    const truthy = (v) => { const s = String(v ?? "").trim().toLowerCase(); return s === "yes" || s === "y" || s === "true" || s === "1"; };
    const pick = (o, keys) => { for (const k of keys) { if (o && Object.prototype.hasOwnProperty.call(o, k)) return o[k]; const alt = Object.keys(o || {}).find((kk) => kk.toLowerCase().replace(/\s+/g, "") === k.toLowerCase().replace(/\s+/g, "")); if (alt) return o[alt]; } return undefined; };
    (pricingArr || []).forEach(r => {
      const name = String(pick(r, ["Particulars"]) || "").trim();
      if (!name) return;
      const gymFlag = truthy(pick(r, ["Gym membership","Gym Membership","GymMembership","Membership"]));
      const coachFlag = truthy(pick(r, ["Coach subscription","Coach Subscription","CoachSubscription","Coach"]));
      pricingFlags.set(name.toLowerCase(), { gym: gymFlag, coach: coachFlag });
    });

    // Group payments by member id
    const paymentsByMember = new Map();
    (paymentsArr || []).forEach(p => {
      const id = String(p.MemberID || p.member_id || p.id || p.member || "").trim();
      if (!id) return;
      if (!paymentsByMember.has(id)) paymentsByMember.set(id, []);
      paymentsByMember.get(id).push(p);
    });

    // use shared helper computeStatusForMember

    let activeGym = 0, activeCoach = 0;
    for (const m of (membersArr || [])) {
      const id = String(m.MemberID || m.member_id || m.id || "").trim();
      const pays = paymentsByMember.get(id) || [];
      const st = computeStatusForMember(pays, m, pricingArr, asOfMembership);
      // Fallback: if payments don't indicate an active membership, check member-level fields
      if (st.membershipState !== 'active') {
        const memberState = (m.membershipState || m.membership_state || m.status || "").toLowerCase();
        if (memberState === 'active') {
          st.membershipState = 'active';
        } else {
          const memberGymUntil = pick(m, ["membershipEnd","membership_end","gymvaliduntil","gym_valid_until","gym_until","enddate","end_date","valid_until","expiry","expires","until","end","gym_valid","gym_validity","gymvalid"]);
          if (memberGymUntil) {
            const gy = manilaYMD(memberGymUntil);
            if (gy && gy >= asOfMembership) st.membershipState = 'active';
          }
        }
      }
      if (st.membershipState === 'active') activeGym++;
      if (st.coachActive) activeCoach++;
    }

    const visitsToday = (gymArr || []).filter(e => {
      const d = e.Date || e.date;
      if (!d) return false;
      const s = manilaYMD(d);
      return s === asOf;
    });
    const uniqueVisited = new Set(visitsToday.map(e => String(e.MemberID || e.member_id || e.id || "").trim()).filter(Boolean));
    const visitedToday = uniqueVisited.size;
    // Coaching Sessions: unique members with a coach selected today
    const coachedMembers = new Set();
    for (const e of visitsToday) {
      const coachValRaw = String(e.Coach || e.coach || '').trim();
      const coachVal = coachValRaw.toLowerCase();
      const memberId = String(e.MemberID || e.member_id || e.id || '').trim();
      const coachSelected = !!coachValRaw && coachVal !== '-' && coachVal !== '—' && coachVal !== 'n/a' && coachVal !== 'na' && coachVal !== 'none';
      if (coachSelected && memberId) coachedMembers.add(memberId);
    }
    const coachToday = coachedMembers.size;
    // Currently checked-in: unique members who have at least one today's entry with TimeIn and missing TimeOut
    const checkedInSet = new Set();
    for (const e of visitsToday) {
      const tin = String(firstOf(e, ["TimeIn","timein","time_in"]) || '').trim();
      const memberId = String(firstOf(e, ["MemberID","memberid","member_id","id"]) || '').trim();
      const toutPresent = !isTimeOutMissingRow(e);
      if (tin && !toutPresent && memberId) checkedInSet.add(memberId);
    }
    const checkedIn = checkedInSet.size;

    let cashToday = 0, gcashToday = 0, totalPaymentsToday = 0;
    for (const p of (paymentsArr || [])) {
      const d = p.Date || p.date || p.pay_date;
      if (!d) continue;
      const ymd = manilaYMD(d);
      if (ymd !== asOf) continue;
      const amt = parseFloat(p.Cost || p.amount || 0) || 0;
      totalPaymentsToday += amt;
      const mode = String(p.Mode || p.mode || p.method || "").toLowerCase();
      if (mode === 'cash') cashToday += amt;
      if (mode === 'gcash') gcashToday += amt;
    }

    return { totalMembers: (membersArr || []).length, activeGym, activeCoach, visitedToday, coachToday, checkedIn, cashToday, gcashToday, totalPaymentsToday };
  };
  const paymentRowsForModal = useMemo(() => {
    const base = useFirestore ? (paymentsToday || []) : (payments || []);
    const asOf = (typeof selectedYmd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(selectedYmd)) ? selectedYmd : todayYMD();
    const candidates = (p) => p.timestamp || p.created || p.paid_on || p.createdAt || p.date || p.Date || p.pay_date || null;
    const parseTs = (v) => {
      if (!v && v !== 0) return 0;
      if (typeof v === 'number') return v;
      try { if (v && typeof v.toMillis === 'function') return v.toMillis(); } catch (e) {}
      try { if (v && typeof v.seconds === 'number') return v.seconds * 1000; } catch (e) {}
      const parsed = Date.parse(String(v));
      return isNaN(parsed) ? 0 : parsed;
    };
    const ymdOf = (v) => {
      try {
        if (!v && v !== 0) return '';
        if (typeof v === 'string') {
          const s = v.trim();
          if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        }
        if (v && typeof v.toDate === 'function') {
          const d = v.toDate();
          return isNaN(d) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
        }
        const d = new Date(v);
        return isNaN(d) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
      } catch (e) { return ''; }
    };
    const filterByKind = (p) => {
      const mode = String(p.Mode || p.mode || p.method || '').toLowerCase();
      if (paymentsModalKind === 'cash') return mode === 'cash';
      if (paymentsModalKind === 'gcash') return mode === 'gcash';
      return true;
    };

    const todays = (base || [])
      .filter(p => ymdOf(candidates(p)) === asOf)
      .filter(filterByKind)
      .sort((a, b) => (parseTs(candidates(b)) || 0) - (parseTs(candidates(a)) || 0));

    return todays.map((p, idx) => {
      const paymentMemberId = String(p.MemberID || p.member_id || p.id || p.member || '').trim();
      const member = (members || []).find(m => {
        if (!paymentMemberId) return false;
        return String(m.MemberID || m.member_id || m.id || '').trim() === paymentMemberId;
      });
      const pills = member ? getMemberPills(member) : [];
      const gymValidRaw = p.gymvaliduntil || p.GymValidUntil || p.gym_valid_until || p.gym_until || p.EndDate || p.Enddate || p.enddate || p.end_date || p.end || p.valid_until || p.expiry || p.expires || p.until || '';
      const coachValidRaw = p.coachvaliduntil || p.CoachValidUntil || p.coach_valid_until || p.coach_until || '';
      const gymValid = fmtDate(gymValidRaw);
      const coachValid = fmtDate(coachValidRaw);

      return (
        <tr
          key={idx}
          className={paymentMemberId ? 'row-link' : undefined}
          style={{ cursor: paymentMemberId ? 'pointer' : 'default' }}
          onClick={() => {
            if (!paymentMemberId) return;
            try { setOpenPaymentsModal(false); } catch (e) {}
            navigate(`/members/${encodeURIComponent(paymentMemberId)}`, { state: { row: member || { MemberID: paymentMemberId } } });
          }}
        >
          <td>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span>{displayName(member)}</span>
              {pills.length > 0 && (
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  {pills.map(p => <span key={p.key} className={`pill ${p.className}`}>{p.label}</span>)}
                </span>
              )}
            </span>
          </td>
          <td>{display(p.Particulars || p.particulars || p.type || p.item || p.category || p.product || p.paymentfor || p.plan || p.description)}</td>
          <td>{display(gymValid)}</td>
          <td>{display(coachValid)}</td>
          <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>{display(p.Mode || p.mode || p.method)}</td>
          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{display((parseFloat(p.Cost || p.amount || 0) || 0).toLocaleString())}</td>
        </tr>
      );
    });
  }, [useFirestore, paymentsToday, payments, members, paymentsModalKind, selectedYmd, navigate]);

  const paymentsModalPager = useLoadMore(paymentRowsForModal, { initial: 20, step: 20, resetDeps: [openPaymentsModal, paymentsModalKind] });
  const gymEntriesPager = useLoadMore(gymEntryRows, { initial: 20, step: 20, resetDeps: [gymEntryRows?.length] });

  const activeList = useMemo(() => {
    if (!openActiveModal) return [];
    const list = activeModalKind === 'coach' ? activeMembers.coach : activeMembers.gym;
    return Array.isArray(list) ? list : [];
  }, [openActiveModal, activeModalKind, activeMembers]);

  const activePager = useLoadMore(activeList, { initial: 20, step: 20, resetDeps: [openActiveModal, activeModalKind] });


  useEffect(() => {
    if (!useFirestore) return;
    let alive = true;
    let unsubMembers = null;
    let unsubGym = null;
    let unsubPayToday = null;
    let unsubPayActive = null;

    setLoading(true);
    setIsRefreshing(true);

    // Pricing is small; just fetch once.
    (async () => {
      try {
        const pr = await fetchPricing();
        if (!alive) return;
        setPricing(pr?.rows || pr?.data || []);
      } catch (e) { /* ignore */ }
    })();

    const asOf = (typeof selectedYmd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(selectedYmd)) ? selectedYmd : todayYMD();

    try {
      unsubMembers = listenMembers((rows) => {
        if (!alive) return;
        setMembers(rows || []);
      }, () => {});
    } catch (e) { /* ignore */ }

    try {
      unsubGym = listenGymEntriesForDate(asOf, (rows) => {
        if (!alive) return;
        setGymEntries(rows || []);
      }, () => {});
    } catch (e) { /* ignore */ }

    try {
      unsubPayToday = listenPaymentsForDate(asOf, (rows) => {
        if (!alive) return;
        setPaymentsToday(rows || []);
      }, () => {});
    } catch (e) { /* ignore */ }

    try {
      unsubPayActive = listenPaymentsActive((rows) => {
        if (!alive) return;
        setPaymentsActive(rows || []);
      }, () => {});
    } catch (e) { /* ignore */ }

    setLoading(false);
    setIsRefreshing(false);

    return () => {
      alive = false;
      try { unsubMembers && unsubMembers(); } catch (e) {}
      try { unsubGym && unsubGym(); } catch (e) {}
      try { unsubPayToday && unsubPayToday(); } catch (e) {}
      try { unsubPayActive && unsubPayActive(); } catch (e) {}
    };
  }, [useFirestore, selectedYmd]);

  useEffect(() => {
    if (useFirestore) return;

    async function loadStats() {
  setLoading(true);
  // Try server-side aggregate first for fastest dashboard render
      try {
        const asOf = (typeof selectedYmd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(selectedYmd)) ? selectedYmd : todayYMD();
        const today = todayYMD();
        if (asOf !== today) throw new Error('skip server dashboard for non-today date');
        const dashRes = await fetchDashboard();
        if (dashRes && dashRes.ok) {
          const { totalMembers=0, activeGym=0, activeCoach=0, visitedToday=0, coachToday=0, checkedIn=0, cashToday=0, gcashToday=0, totalPaymentsToday=0 } = dashRes;
          setStats({ totalMembers, activeGym, activeCoach, visitedToday, coachToday, checkedIn, cashToday, gcashToday, totalPaymentsToday });
          setLoading(false);
          // Still fetch full data for tables in background (non-blocking)
          (async () => {
            setIsRefreshing(true);
            try {
              const [membersRes, paymentsRes, gymRes, pricingRes] = await Promise.all([
                fetchMembers(), fetchPayments(), fetchGymEntries(), fetchPricing()
              ]);
              setMembers(membersRes?.rows || membersRes?.data || []);
              setPayments(paymentsRes?.rows || paymentsRes?.data || []);
              setGymEntries(gymRes?.rows || gymRes?.data || []);
              setPricing(pricingRes?.rows || pricingRes?.data || []);
              // Recompute authoritative stats from the freshly fetched rows so UI reflects actual data
              try {
                const computed = computeStatsFromData(
                  membersRes?.rows || membersRes?.data || [],
                  paymentsRes?.rows || paymentsRes?.data || [],
                  gymRes?.rows || gymRes?.data || [],
                  pricingRes?.rows || pricingRes?.data || [],
                  asOf
                );
                setStats(computed);
              } catch (e) {
                console.warn('Failed to recompute stats after background fetch', e);
              }
            } catch (_){ }
            finally { setIsRefreshing(false); }
          })();
          return;
        }
      } catch (e) {
        // ignore and fallback to client-side compute
      }

      // Fallback: fetch full data and compute client-side (already optimized)
      // Fetch in parallel (cached GETs will help)
      setIsRefreshing(true);
      const [membersRes, paymentsRes, gymRes, pricingRes] = await Promise.all([
        fetchMembers(),
        fetchPayments(),
        fetchGymEntries(),
        fetchPricing(),
      ]);
      const membersData = membersRes?.rows || membersRes?.data || [];
      const paymentsData = paymentsRes?.rows || paymentsRes?.data || [];
      const gymEntriesData = gymRes?.rows || gymRes?.data || [];
      const pricingData = pricingRes?.rows || pricingRes?.data || [];
      setMembers(membersData);
      setPayments(paymentsData);
      setGymEntries(gymEntriesData);
      setPricing(pricingData);
  setIsRefreshing(false);
  // Small optimization: do the heavy computations off the main paint path so the UI can render quickly.
      const membersArr = membersData;
      const paymentsArr = paymentsData;
      const gymArr = gymEntriesData;
      const pricingArr = pricingData;

      // Quick immediate stats to show something while we compute rest
      setStats((s) => ({ ...s, totalMembers: membersArr.length }));
      // allow browser to render before heavy compute
      setTimeout(() => {
        try {
          const computed = computeStatsFromData(membersArr, paymentsArr, gymArr, pricingArr, selectedYmd);
          setStats(computed);
        } catch (e) {
          console.warn('Failed to compute stats', e);
        } finally {
          setLoading(false);
          setShowLoadingToast(false);
        }
      }, 20);
    };
    loadStats();
    // subscribe to gym entry adds so the Dashboard can refresh quickly
    const unsub = events.on('gymEntry:added', async (entry) => {
      try {
        // fetch fresh authoritative gym entries when an entry is reported added
        setIsRefreshing(true);
        const gymRes = await fetchGymEntriesFresh();
        setGymEntries(gymRes?.rows || gymRes?.data || []);
        setIsRefreshing(false);
      } catch (e) {}
    });
    const unsub2 = events.on('member:updated', async () => {
      try { const membersRes = await fetchMembers(); setMembers(membersRes?.rows || membersRes?.data || []); } catch (e) {}
    });
    const unsub3 = events.on('payment:added', async () => {
      try {
        const [paymentsRes, pricingRes] = await Promise.all([
          fetchPayments(),
          fetchPricing(),
        ]);
        setPayments(paymentsRes?.rows || paymentsRes?.data || []);
        setPricing(pricingRes?.rows || pricingRes?.data || []);
      } catch (e) {
        // ignore
      }
    });
    // Periodic refresh: poll gym entries every 15s so dashboard reflects recent checkins/outs
    const pollInterval = setInterval(async () => {
      try {
        // periodic poll should fetch fresh rows so other clients' changes appear quickly
        const gymRes = await fetchGymEntriesFresh();
        setGymEntries(gymRes?.rows || gymRes?.data || []);
      } catch (e) { /* ignore */ }
    }, 15000);
    return () => { unsub(); unsub2(); unsub3(); clearInterval(pollInterval); };
  }, [useFirestore]);

  // Recompute stats whenever key data changes so UI (checked-in count etc.) updates immediately
  useEffect(() => {
    try {
      if (!useFirestore) {
        const computed = computeStatsFromData(members || [], payments || [], gymEntries || [], pricing || [], selectedYmd);
        setStats(computed);
        return;
      }

      // Active membership/subscription counts are always as-of today.
      const asOfMembership = todayYMD();

      const pick = (o, keys) => {
        for (const k of keys) {
          if (o && Object.prototype.hasOwnProperty.call(o, k)) return o[k];
          const alt = Object.keys(o || {}).find((kk) => kk.toLowerCase().replace(/\s+/g, "") === k.toLowerCase().replace(/\s+/g, ""));
          if (alt) return o[alt];
        }
        return undefined;
      };

      // Active counts from member-level fields (avoid loading all payments)
      let activeGym = 0;
      let activeCoach = 0;
      for (const m of (members || [])) {
        const memberId = resolveMemberId(m);
        if (!memberId) continue;

        // Prefer payment-derived status when available
        const pays = activePaymentsByMember.get(memberId) || [];
        const stFromPays = pays.length ? computeStatusForMember(pays, m, pricing || [], asOfMembership) : null;

        const membershipState = String(m?.membershipState || m?.membership_state || m?.status || '').trim().toLowerCase();
        const coachState = String(m?.coachState || m?.coach_state || '').trim().toLowerCase();
        const gymUntil = pick(m, ["membershipEnd","membership_end","gymvaliduntil","gym_valid_until","gym_until","enddate","end_date","valid_until","expiry","expires","until","end","gym_valid","gym_validity","gymvalid"]);
        const coachUntil = pick(m, ["coachEnd","coach_end","coach_subscription_end","coach_subscription_end_date","coachvaliduntil","coach_valid_until","coach_until","coach_expiry","coach_expires"]);

        const gymActive = (stFromPays?.membershipState === 'active') || isDateActive(gymUntil, asOfMembership) || (!gymUntil && membershipState === 'active');
        const coachActive = (stFromPays?.coachActive === true) || isDateActive(coachUntil, asOfMembership) || (!coachUntil && coachState === 'active');
        if (gymActive) activeGym++;
        if (coachActive) activeCoach++;
      }

      const visitedSet = new Set();
      for (const e of (gymEntries || [])) {
        const tin = String(firstOf(e, ["TimeIn","timein","time_in"]) || '').trim();
        const memberId = String(firstOf(e, ["MemberID","memberid","member_id","id"]) || '').trim();
        if (tin && memberId) visitedSet.add(memberId);
      }
      const visitedToday = visitedSet.size;

      // Coaching Sessions: unique members with a coach selected today
      const coachedMembers = new Set();
      for (const e of (gymEntries || [])) {
        const coachValRaw = String(e.Coach || e.coach || '').trim();
        const coachVal = coachValRaw.toLowerCase();
        const memberId = String(e.MemberID || e.member_id || e.id || '').trim();
        const coachSelected = !!coachValRaw && coachVal !== '-' && coachVal !== '—' && coachVal !== 'n/a' && coachVal !== 'na' && coachVal !== 'none';
        if (coachSelected && memberId) coachedMembers.add(memberId);
      }
      const coachToday = coachedMembers.size;

      // Currently checked-in: unique members with missing TimeOut
      const checkedInSet = new Set();
      for (const e of (gymEntries || [])) {
        const tin = String(firstOf(e, ["TimeIn","timein","time_in"]) || '').trim();
        const memberId = String(firstOf(e, ["MemberID","memberid","member_id","id"]) || '').trim();
        const toutPresent = !isTimeOutMissingRow(e);
        if (tin && !toutPresent && memberId) checkedInSet.add(memberId);
      }
      const checkedIn = checkedInSet.size;

      // Revenue today: use today-scoped payments listener
      let cashToday = 0, gcashToday = 0, totalPaymentsToday = 0;
      for (const p of (paymentsToday || [])) {
        const amt = parseFloat(p.Cost || p.amount || 0) || 0;
        totalPaymentsToday += amt;
        const mode = String(p.Mode || p.mode || p.method || "").toLowerCase();
        if (mode === 'cash') cashToday += amt;
        if (mode === 'gcash') gcashToday += amt;
      }

      setStats({
        totalMembers: (members || []).length,
        activeGym,
        activeCoach,
        visitedToday,
        coachToday,
        checkedIn,
        cashToday,
        gcashToday,
        totalPaymentsToday,
      });
    } catch (e) {
      console.warn('Failed to recompute stats on data change', e);
    }
  }, [useFirestore, members, payments, paymentsToday, paymentsActive, gymEntries, pricing, activePaymentsByMember, selectedYmd, manilaDayKey, paymentsBump]);

  // Checkout handler: attempt to close an open gym entry for the given member id.
  const handleCheckout = async (entry, payload = {}) => {
    if (!entry) return;
    const memberId = String(entry.MemberID || entry.member_id || entry.id || entry.member || "").trim();
    if (!memberId) return;
    try {
      setIsRefreshing(true);
      const today = todayYMD();
      // request backend to set TimeOut for today's open row for this member
      const res = await gymQuickAppend(memberId, { wantsOut: true, ...(payload || {}) });
      if (useFirestore) {
        // Firestore mode uses realtime listeners for today's entries; no need to poll/fetch.
        return;
      }
      // poll until authoritative TimeOut appears (or timeout)
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const checkFn = (rowsArr) => {
        try {
          return (rowsArr || []).some(r => {
            const pid = String(r?.MemberID || r?.member_id || r?.id || r?.member || "").trim();
            if (!pid || pid !== memberId) return false;
            const dateRaw = r.Date || r.date || r.Timestamp || r.timestamp || '';
            const ymd = dateRaw ? new Date(dateRaw).toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '';
            if (ymd !== today) return false;
            const tout = String(r?.TimeOut || r?.timeout || r?.time_out || '').trim();
            return !!tout && tout !== '-' && tout !== '—';
          });
        } catch (e) { return false; }
      };
      let confirmed = false;
      for (let i = 0; i < 8; i++) {
        try {
          const gymRes = await fetchGymEntriesFresh();
          const arr = gymRes?.rows || gymRes?.data || [];
          setGymEntries(arr);
          if (checkFn(arr)) { confirmed = true; break; }
        } catch (e) {}
        await wait(300);
      }
      if (!confirmed) {
        // final authoritative reload (no-cache)
        const gymRes = await fetchGymEntriesFresh();
        setGymEntries(gymRes?.rows || gymRes?.data || []);
      }
    } catch (e) {
      console.error('checkout failed', e);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Parent-level request from VisitViewModal to open the Confirm Checkout popup.
  const requestCheckoutPopup = (entry) => {
    if (!entry) return;
    const memberId = String(entry.MemberID || entry.member_id || entry.id || entry.member || "").trim();
    if (!memberId) return;
    setCheckoutMemberId(memberId);
    setCheckoutInitialEntry(entry || null);
    setShowCheckoutModal(true);
    // close the visit modal (selected entry) since the popup will handle the confirm
    setSelectedEntry(null);
  };

  return (
    <div className="dashboard-content">
      <h2 className="dashboard-title">Daily Dashboard <RefreshBadge show={isRefreshing && !loading} /></h2>

      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "0 0 24px", flexWrap: "wrap" }}>
          <select
            value={selectedYmd}
            onChange={(e) => setSelectedYmd(e.target.value)}
            style={{ width: 320, height: 52, padding: "10px 14px", border: "1px solid #e7e8ef", borderRadius: 10, fontSize: 18 }}
          >
            {dateOptions.map((opt) => (
              <option key={opt.ymd} value={opt.ymd}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

        <div className="dashboard-grid-3x3">
          {/* First row */}
          <div className="dashboard-card"><div className="dashboard-label">Total Members</div><div className="dashboard-value magenta">{stats.totalMembers}</div></div>
          <div className="dashboard-card">
            <div className="dashboard-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span>Active Gym Memberships</span>
              <button className="pill white" onClick={() => openActiveList('gym')} style={{ cursor: 'pointer' }}>View</button>
            </div>
            <div className="dashboard-value magenta">{stats.activeGym}</div>
          </div>
          <div className="dashboard-card">
            <div className="dashboard-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span>Active Coach Subscriptions</span>
              <button className="pill white" onClick={() => openActiveList('coach')} style={{ cursor: 'pointer' }}>View</button>
            </div>
            <div className="dashboard-value magenta">{stats.activeCoach}</div>
          </div>
          {/* Second row */}
          <div className="dashboard-card"><div className="dashboard-label">Member Visits</div><div className="dashboard-value magenta">{stats.visitedToday}</div></div>
          <div className="dashboard-card"><div className="dashboard-label">Coaching Sessions</div><div className="dashboard-value magenta">{stats.coachToday}</div></div>
          <div className="dashboard-card"><div className="dashboard-label">Currently Checked-In</div><div className="dashboard-value magenta">{stats.checkedIn}</div></div>
          {/* Third row */}
          <div
            className="dashboard-card"
            role="button"
            tabIndex={0}
            onClick={() => { setPaymentsModalKind('cash'); setOpenPaymentsModal(true); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setPaymentsModalKind('cash'); setOpenPaymentsModal(true); } }}
            style={{ cursor: 'pointer' }}
          >
            <div className="dashboard-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span>Cash Revenue</span>
              <span className="pill white">View</span>
            </div>
            <div className="dashboard-value magenta">₱ {stats.cashToday.toLocaleString()}</div>
          </div>
          <div
            className="dashboard-card"
            role="button"
            tabIndex={0}
            onClick={() => { setPaymentsModalKind('gcash'); setOpenPaymentsModal(true); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setPaymentsModalKind('gcash'); setOpenPaymentsModal(true); } }}
            style={{ cursor: 'pointer' }}
          >
            <div className="dashboard-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span>GCash Revenue</span>
              <span className="pill white">View</span>
            </div>
            <div className="dashboard-value magenta">₱ {stats.gcashToday.toLocaleString()}</div>
          </div>
          <div
            className="dashboard-card"
            role="button"
            tabIndex={0}
            onClick={() => { setPaymentsModalKind('all'); setOpenPaymentsModal(true); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setPaymentsModalKind('all'); setOpenPaymentsModal(true); } }}
            style={{ cursor: 'pointer' }}
          >
            <div className="dashboard-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span>Total Revenue</span>
              <span className="pill white">View</span>
            </div>
            <div className="dashboard-value magenta">₱ { (stats.totalPaymentsToday || 0).toLocaleString() }</div>
          </div>
        </div>

        <ModalWrapper
          open={openPaymentsModal}
          onClose={() => setOpenPaymentsModal(false)}
          title={paymentsModalKind === 'cash'
            ? `Cash Payments for ${selectedYmdLabel}`
            : (paymentsModalKind === 'gcash'
              ? `GCash Payments for ${selectedYmdLabel}`
              : `Payments for ${selectedYmdLabel}`
            )
          }
        >
          <div style={{ overflowX: 'auto' }}>
            <table className="aligned payments-table" style={{ width: '100%' }}>
              <colgroup>
                <col style={{ width: '22%' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '10%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Nickname</th>
                  <th>Particulars</th>
                  <th>Gym Membership<br/>Valid Until</th>
                  <th>Coach Subscription<br/>Valid Until</th>
                  <th style={{ textAlign: 'center' }}>Mode</th>
                  <th style={{ textAlign: 'right' }}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {(!paymentRowsForModal || (Array.isArray(paymentRowsForModal) && paymentRowsForModal.length === 0)) ? (
                  <tr><td colSpan={6}>-</td></tr>
                ) : (
                  paymentsModalPager.visible
                )}
              </tbody>
            </table>
          </div>
          {paymentsModalPager.canLoadMore && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="load-more-link" type="button" onClick={paymentsModalPager.loadMore}>
                Load 20 more
              </button>
            </div>
          )}
        </ModalWrapper>
        {/* Gym Entries Table */}
        <div style={{marginTop:24}} className="panel">
          <div className="panel-header">Gym Entries for {selectedYmdLabel}</div>
          <table className="aligned">
            <thead>
              <tr>
                <th>Nickname</th>
                <th>Time In</th>
                <th>Time Out</th>
                <th>Total Hours</th>
                <th>Coach</th>
                <th>Focus</th>
              </tr>
            </thead>
            <tbody>
              {(!gymEntryRows || (Array.isArray(gymEntryRows) && gymEntryRows.length === 0)) ? (
                <tr><td colSpan={6}>-</td></tr>
              ) : (
                gymEntriesPager.visible
              )}
            </tbody>
          </table>
          {gymEntriesPager.canLoadMore && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="load-more-link" type="button" onClick={gymEntriesPager.loadMore}>
                Load 20 more
              </button>
            </div>
          )}
        </div>
        {/* Visit detail modal */}
        <VisitViewModal
          open={!!selectedEntry}
          onClose={() => setSelectedEntry(null)}
          row={selectedEntry}
          onCheckout={(entry) => requestCheckoutPopup(entry)}
        />

        <CheckInConfirmModal
          open={showCheckoutModal}
          memberId={checkoutMemberId}
          initialEntry={checkoutInitialEntry}
          onClose={() => { setShowCheckoutModal(false); setCheckoutMemberId(null); setCheckoutInitialEntry(null); }}
          onSuccess={async () => {
            // The modal already performed the server update (upsert/quick append).
            // Avoid calling the checkout endpoint again to prevent duplicate appends.
            // Just fetch authoritative rows and refresh the dashboard view.
            try {
              const gymRes = await fetchGymEntriesFresh();
              setGymEntries(gymRes?.rows || gymRes?.data || []);
            } catch (e) { console.error(e); }
            setShowCheckoutModal(false);
            setCheckoutMemberId(null);
            setCheckoutInitialEntry(null);
          }}
        />
        <ModalWrapper
          open={openActiveModal}
          onClose={() => setOpenActiveModal(false)}
          title={activeModalKind === 'coach' ? 'Active Coach Subscriptions' : 'Active Gym Memberships'}
        >
          <div style={{ overflowX: 'auto' }}>
            <table className="attendance-table aligned" style={{ width: '100%' }}>
              <colgroup>
                <col style={{ width: '20%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '20%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ textAlign: 'center' }}>Nick Name</th>
                  <th style={{ textAlign: 'center' }}>Member Since</th>
                  <th style={{ textAlign: 'center' }}>Last Gym Visit</th>
                  <th style={{ textAlign: 'center' }}>Gym Valid Until</th>
                  <th style={{ textAlign: 'center' }}>Coach Valid Until</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  if (!activeList || activeList.length === 0) return <tr><td colSpan={5}>-</td></tr>;
                  return activePager.visible.map(({ member: m, memberId, st }, idx) => {
                    const nick = resolveNick(m).toUpperCase();
                    const memberSince = resolveMemberSince(m);
                    const lastVisit = lastVisitByMember.get(memberId) || parseMaybeDate(
                      m?.LastGymVisit || m?.lastGymVisit || m?.last_gym_visit || m?.lastVisit || m?.last_visit || m?.LastVisit || null
                    ) || null;
                    const gymUntil = st?.membershipEnd || null;
                    const coachUntil = st?.coachEnd || null;
                    const pills = m ? getMemberPills(m) : [];
                    return (
                      <tr
                        key={idx}
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          if (!memberId) return;
                          navigate(`/members/${encodeURIComponent(memberId)}`, { state: { row: m } });
                        }}
                      >
                        <td style={{ textAlign: 'center' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                            <strong>{nick}</strong>
                            {pills.length > 0 && (
                              <span style={{ display: 'inline-flex', gap: 6 }}>
                                {pills.map(p => <span key={p.key} className={`pill ${p.className}`}>{p.label}</span>)}
                              </span>
                            )}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>{fmtDate(memberSince)}</td>
                        <td style={{ textAlign: 'center' }}>{lastVisit ? fmtDate(lastVisit) : ''}</td>
                        <td style={{ textAlign: 'center', color: gymUntil ? (isDateActive(gymUntil, todayYMD()) ? 'green' : 'red') : 'inherit' }}>{gymUntil ? fmtDate(gymUntil) : ''}</td>
                        <td style={{ textAlign: 'center', color: coachUntil ? (isDateActive(coachUntil, todayYMD()) ? 'green' : 'red') : 'inherit' }}>{coachUntil ? fmtDate(coachUntil) : '-'}</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
          {activePager.canLoadMore && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="load-more-link" type="button" onClick={activePager.loadMore}>
                Load 20 more
              </button>
            </div>
          )}
        </ModalWrapper>

        {loading && <div style={{marginTop:24}}>Loading…</div>}
      </div>
  );
}
