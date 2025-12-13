// src/pages/Members.jsx
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import useSWR from 'swr';
import { FixedSizeList as List } from 'react-window';
import { useNavigate } from "react-router-dom";
import api from "../api";
import localCache from '../lib/localCache.js';
import LoadingSkeleton from '../components/LoadingSkeleton.jsx';
import React, { Suspense } from 'react';
import { computeStatusForMember } from '../lib/membership';
import RefreshBadge from '../components/RefreshBadge.jsx';
import { getMemberPills } from '../lib/discount.js';
import useLoadMore from "../lib/useLoadMore.js";
const AddMemberModal = React.lazy(() => import('../components/AddMemberModal.jsx'));

// Simple in-memory cache for SWR-style stale-while-revalidate behavior
const MEMBERS_CACHE = {
  members: null,
  payments: null,
  gymEntries: null,
  pricing: null,
  ts: {
    members: 0,
    payments: 0,
    gymEntries: 0,
    pricing: 0,
  }
};

// LocalStorage persistence
const CACHE_KEY = 'kusgan.members.cache.v2';
const CACHE_MAX_AGE = 1000 * 60 * 60; // 1 hour

function loadCacheFromLocalStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.ts) return;
    const age = Date.now() - (parsed.ts.members || 0);
    if (age > CACHE_MAX_AGE) return; // stale
    MEMBERS_CACHE.members = parsed.members || null;
    MEMBERS_CACHE.payments = parsed.payments || null;
    MEMBERS_CACHE.gymEntries = parsed.gymEntries || null;
    MEMBERS_CACHE.pricing = parsed.pricing || null;
    MEMBERS_CACHE.ts = parsed.ts || MEMBERS_CACHE.ts;
  } catch (e) {
    // ignore
    console.debug('Members: failed to load cache from localStorage', e);
  }
}

function saveCacheToLocalStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const toSave = {
      members: MEMBERS_CACHE.members,
      payments: MEMBERS_CACHE.payments,
      gymEntries: MEMBERS_CACHE.gymEntries,
      pricing: MEMBERS_CACHE.pricing,
      ts: MEMBERS_CACHE.ts
    };
    // Persist asynchronously to avoid blocking the main thread during render/update cycles
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => {
        try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(toSave)); } catch (e) { console.debug('Members: failed to save cache to localStorage', e); }
      }, { timeout: 2000 });
    } else {
      setTimeout(() => {
        try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(toSave)); } catch (e) { console.debug('Members: failed to save cache to localStorage', e); }
      }, 0);
    }
  } catch (e) {
    console.debug('Members: failed to save cache to localStorage', e);
  }
}

// Attempt to hydrate MEMBERS_CACHE from localStorage on module load
try { loadCacheFromLocalStorage(); } catch (e) { /* no-op */ }

// helpers
const toKey = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, "_");
const yesy = (v) => ["yes","y","true","1"].includes(String(v||"").trim().toLowerCase());
const firstOf = (obj, keys) => keys.map(k=>obj[k]).find(v => v !== undefined && v !== "");
const getStr = (row, keys) => String(firstOf(row, keys) ?? "");
const asDate = (v) => {
  try {
    if (v instanceof Date) return v;
    if (!v && v !== 0) return null;
    if (typeof v === 'number') {
      const d = new Date(v);
      return isNaN(d) ? null : d;
    }
    // Firestore Timestamp (client or admin) often has toDate() or {seconds}
    if (v && typeof v.toDate === 'function') {
      const d = v.toDate();
      return (d instanceof Date && !isNaN(d)) ? d : null;
    }
    if (v && typeof v.seconds === 'number') {
      const d = new Date(v.seconds * 1000);
      return isNaN(d) ? null : d;
    }
    const d = new Date(v);
    return isNaN(d) ? null : d;
  } catch (e) {
    return null;
  }
};
const isSameDay = (a, b) =>
  a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const normRow = (row) => {
  const out = {};
  Object.entries(row || {}).forEach(([k,v]) => { out[toKey(k)] = v; });
  return out;
};



// Robust member-since resolver: try normalized keys, original/raw keys, and common createdAt fields
const resolveMemberSince = (row) => {
  if (!row) return null;
  // first try normalized keys (row already normalized by normRow)
  const candidates = ["member_since","membersince","member_date","memberdate","createdat","created_at","created","join_date","joined","start_date","memberdateexcel","membersinceexcel"];
  let d = asDate(firstOf(row, candidates));
  if (d) return d;
  // if the raw original document is present, try its original keys (caseful)
  try {
    const raw = row._raw || row;
    const origKeys = ["MemberSince","Member Since","MemberDate","Member Date","createdAt","created_at","Created","Joined","Join Date","start_date"];
    d = firstOf(raw, origKeys);
    if (d) return asDate(d);
  } catch (e) {
    // ignore
  }
  return null;
};

// Basic title-case for names (First Letter Caps), keeps separators intact
const toTitleCase = (s) => {
  const str = String(s || "");
  return str.toLowerCase().replace(/(?:^|[\s\-])([a-z])/g, (m, g1) => m.replace(g1, g1.toUpperCase()));
};

// Pretty date like "Nov-2, 2025"
const fmtDate = (d) => {
  const dt = asDate(d);
  if (!dt) return "";
  const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][dt.getMonth()];
  return `${m}-${dt.getDate()}, ${dt.getFullYear()}`;
};

// NOTE: Manila-date activity checks are centralized in computeStatusForMember.

const ageFromBirthday = (bday) => {
  const d = asDate(bday);
  if (!d) return NaN;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age;
};

function buildStatusIndex({ membersRaw, paymentsRaw, pricingRows }) {
  const paymentsByMember = new Map();
  for (const raw of (paymentsRaw || [])) {
    const p = normRow(raw);
    const memberId = String(firstOf(p, ["memberid","member_id","id","member_id_"]) || '').trim();
    if (!memberId) continue;
    if (!paymentsByMember.has(memberId)) paymentsByMember.set(memberId, []);
    paymentsByMember.get(memberId).push(raw);
  }

  const idx = new Map();
  for (const m of (membersRaw || [])) {
    const memberId = String(firstOf(m, ["memberid","member_id","id","member_id_"]) || '').trim();
    if (!memberId) continue;
    const pays = paymentsByMember.get(memberId) || [];
    const st = computeStatusForMember(pays, m, pricingRows || []);
    idx.set(memberId, {
      membershipEnd: st.membershipEnd || null,
      coachEnd: st.coachEnd || null,
      membershipState: st.membershipState || null,
      coachActive: !!st.coachActive,
    });
  }
  return idx;
}

// Gym entries: latest Date per member
function buildLastVisitIndex(entriesRaw) {
  const idx = new Map(); // MemberID -> Date
  for (const raw of entriesRaw) {
    const r = normRow(raw);
    const memberId = firstOf(r, ["memberid","member_id","id","member_id_"]);
    if (!memberId) continue;
    const d = asDate(firstOf(r, ["date","visit_date","entry_date","log_date","timestamp","checkin"]));
    if (!d) continue;
    const curr = idx.get(memberId);
    if (!curr || d > curr) idx.set(memberId, d);
  }
  return idx;
}

export default function Members() {
  const navigate = useNavigate();
  const useFirestore = String(import.meta.env.VITE_USE_FIRESTORE ?? 'true') === 'true';
  // no client-side "load more" pagination — we fetch a recent set from the server and support server-backed search
  const [membersLimit] = useState(Number.POSITIVE_INFINITY);
  const [rows, setRows] = useState([]);
  const [payIdx, setPayIdx] = useState(new Map());
  const [visitIdx, setVisitIdx] = useState(new Map());
  const [pricingRows, setPricingRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showLoadingToast, setShowLoadingToast] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const qTimer = useRef(null);
  const [openAdd, setOpenAdd] = useState(false);
  const containerRef = useRef(null);
  const [listHeight, setListHeight] = useState(600);
  const paymentsRef = useRef([]);

  // compute a responsive list height so the members list fills the viewport
  useEffect(() => {
    function recompute() {
      try {
        const vh = window.innerHeight || 800;
        // approximate header+toolbar/footer height used by this page
        const reserved = 220; // tweak if your layout has different header sizes
        const avail = Math.max(300, vh - reserved);
        setListHeight(avail);
      } catch (e) { setListHeight(600); }
    }
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, []);

  // SWR fetcher: fetch members + active payments + gymEntries
  const membersFetcher = async () => {
    const paymentsPromise = (typeof api.fetchPaymentsActive === 'function')
      ? api.fetchPaymentsActive({ limit: 4000 }).catch(() => api.fetchPayments())
      : api.fetchPayments();

    const [mRes, pRes, gRes, prRes] = await Promise.all([
      api.fetchMembers(),
      paymentsPromise,
      api.fetchGymEntriesSince({ days: 60, limit: 3000 }),
      api.fetchPricing(),
    ]);

    return {
      members: (mRes?.rows ?? mRes?.data ?? []).map(normRow),
      payments: (pRes?.rows ?? pRes?.data ?? []),
      gymEntries: (gRes?.rows ?? gRes?.data ?? []),
      pricing: (prRes?.rows ?? prRes?.data ?? []),
    };
  };

  const { data, error: swrError, isLoading: swrLoading, isValidating, mutate } = useSWR(
    'members:all',
    membersFetcher,
    {
      revalidateOnFocus: useFirestore ? false : true,
      dedupingInterval: 2000,
      fallbackData: MEMBERS_CACHE.members ? { members: MEMBERS_CACHE.members, payments: MEMBERS_CACHE.payments, gymEntries: MEMBERS_CACHE.gymEntries, pricing: MEMBERS_CACHE.pricing } : undefined
    }
  );

  // Hydrate state from SWR data and keep MEMBERS_CACHE updated
  useEffect(() => {
    if (!data) return;
    try {
      setRows(data.members || []);
      setPricingRows(data.pricing || []);
      if (useFirestore) {
        const pays = data.payments || [];
        paymentsRef.current = pays;
        setPayIdx(buildStatusIndex({ membersRaw: data.members || [], paymentsRaw: pays || [], pricingRows: data.pricing || [] }));
      } else {
        paymentsRef.current = data.payments || [];
        setPayIdx(buildStatusIndex({ membersRaw: data.members || [], paymentsRaw: data.payments || [], pricingRows: data.pricing || [] }));
      }
      setVisitIdx(buildLastVisitIndex(data.gymEntries || []));
      MEMBERS_CACHE.members = data.members || [];
      MEMBERS_CACHE.payments = data.payments || [];
      MEMBERS_CACHE.gymEntries = data.gymEntries || [];
      MEMBERS_CACHE.pricing = data.pricing || [];
      // update timestamps and persist to localStorage
      MEMBERS_CACHE.ts = MEMBERS_CACHE.ts || {};
      MEMBERS_CACHE.ts.members = Date.now();
      MEMBERS_CACHE.ts.payments = Date.now();
      MEMBERS_CACHE.ts.gymEntries = Date.now();
      MEMBERS_CACHE.ts.pricing = Date.now();
      saveCacheToLocalStorage();
    } catch (e) {
      console.error('Members: failed to hydrate from SWR data', e);
    }
  }, [data, useFirestore]);

  // On mount: load local cached members first for instant UI
  useEffect(() => {
    try {
      const cached = localCache.getCached('members') || [];
      if (cached && cached.length) setRows((prev) => {
        // Only set if rows empty yet
        return (prev && prev.length) ? prev : cached.map(normRow);
      });
    } catch (e) { /* ignore */ }
  }, []);

  // If the user searches (debounced), call the server-backed search helper instead of client filtering
  useEffect(() => {
    let cancelled = false;
    async function doSearch() {
      if (!debouncedQ) return;
      setLoading(true);
      try {
        const mRes = await api.searchMembersByName(debouncedQ);
        if (cancelled) return;
        const members = (mRes?.rows ?? []).map(normRow);
        setRows(members);
        if (useFirestore) {
          const ids = new Set(members.map((m) => String(firstOf(m, ["memberid","member_id","id","member_id_"]) || '').trim()).filter(Boolean));
          const basePays = paymentsRef.current || [];
          const relevantPays = (basePays || []).filter((p) => {
            const mid = String(p?.MemberID || p?.member_id || p?.memberId || p?.memberid || p?.id || '').trim();
            return mid && ids.has(mid);
          });
          setPayIdx(buildStatusIndex({ membersRaw: members, paymentsRaw: relevantPays || [], pricingRows }));
        } else {
          setPayIdx(buildStatusIndex({ membersRaw: members, paymentsRaw: [], pricingRows }));
        }
      } catch (e) {
        if (!cancelled) setError(e?.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (debouncedQ) doSearch();
    return () => { cancelled = true; };
  }, [debouncedQ, useFirestore, pricingRows]);

  // mirror SWR loading/error into local state for existing UI
  useEffect(() => {
    setLoading(!!swrLoading);
    setShowLoadingToast(!!swrLoading);
    if (swrError) setError(swrError.message || String(swrError));
  }, [swrLoading, swrError]);

  // Debounce search input so we don't recompute filters on every keystroke
  useEffect(() => {
    if (qTimer.current) clearTimeout(qTimer.current);
    qTimer.current = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => { if (qTimer.current) clearTimeout(qTimer.current); };
  }, [q]);

  const filteredSorted = useMemo(() => {
    const term = debouncedQ.trim().toLowerCase();

    const today = new Date();
    const withVisit = (rows || []).map((r) => {
      const memberId = String(firstOf(r, ["memberid", "member_id", "id", "member_id_"]) || "").trim();
      const lastVisit = memberId ? visitIdx.get(memberId) : null;
      const isToday = lastVisit ? isSameDay(lastVisit, today) : false;

      // Sort key: newest join first, then by last visit (desc)
      const joined = resolveMemberSince(r) || asDate(firstOf(r, [
        "member_since",
        "membersince",
        "member_date",
        "memberdate",
        "createdat",
        "created_at",
        "join_date",
        "joined",
        "start_date",
      ]));
      const joinTs = joined ? joined.getTime() : 0;
      const visitTs = lastVisit ? lastVisit.getTime() : -1;

      const pay = memberId ? payIdx.get(memberId) : undefined;
      const gymUntil = pay?.membershipEnd || null;
      const coachUntil = pay?.coachEnd || null;
      const gymActive = pay?.membershipState === 'active';
      const coachActive = !!pay?.coachActive;
      const isActive = gymActive || coachActive;

      const first = String(firstOf(r, ["first_name", "firstname", "first", "given_name"]) ?? "");
      const last = String(firstOf(r, ["last_name", "lastname", "last", "surname"]) ?? "");
      const fullName = [first, last].filter(Boolean).join(" ");
      const nick = String(firstOf(r, ["nick_name", "nickname", "NickName", "Nickname", "nickName"]) ?? "");
      const matches = !term
        ? true
        : (
            nick.toLowerCase().includes(term) ||
            fullName.toLowerCase().includes(term)
          );

      return {
        r,
        memberId,
        lastVisit,
        isToday,
        joinTs,
        visitTs,
        gymUntil,
        coachUntil,
        isActive,
        matches,
      };
    });

    // Default view: show only active members (active gym OR active coach).
    // Search view: show all matching members (active or not).
    const base = term ? withVisit : withVisit.filter((x) => x.isActive);
    const searched = base.filter((x) => x.matches);

    searched.sort((a, b) => (b.joinTs - a.joinTs) || (b.visitTs - a.visitTs));
    return searched;
  }, [rows, debouncedQ, visitIdx, payIdx]);

  const membersPager = useLoadMore(filteredSorted, {
    initial: 20,
    step: 20,
    resetDeps: [debouncedQ],
  });

  const openDetail = useCallback((memberId, row) => {
    if (!memberId) return;
    navigate(`/members/${encodeURIComponent(memberId)}`, { state: { row } });
  }, [navigate]);

  // avoid logging large state objects here (can freeze the UI)
  const SMALL_TABLE_THRESHOLD = 120; // if result set is small, render a normal table
  return (
    <div className="content" ref={containerRef} style={{ minHeight: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' }}>
      <h2 className="dashboard-title">All Members <RefreshBadge show={isValidating && !swrLoading} /></h2>

      <div className="toolbar" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <input
          className="search-wide"
          style={{ width: '60%', maxWidth: 960, minWidth: 320 }}
          placeholder="Search members by name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="button" onClick={() => setOpenAdd(true)}>+ Add Member</button>
      </div>

      {!debouncedQ && (
        <div style={{ textAlign: 'left', color: 'var(--muted)', marginBottom: 12 }}>
          Showing members with active membership...
        </div>
      )}

      {/* Top loading toast removed — table shows its own inline Loading message */}
  {loading && (<div style={{ color: 'var(--muted)', textAlign: 'center', padding: 16 }}>Loading…</div>)}
      {error && <div>Error: {error}</div>}
      {!loading && !error && (
        <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* Fallback UI if rows are empty */}
          {rows.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: '#b91c1c', fontWeight: 600 }}>
              No member data loaded.<br />
              Please check your API connection or try again later.
            </div>
          )}
          {/* Virtualized list for rows */}
          <div style={{ width: '100%' }}>
            {filteredSorted.length === 0 ? (
              <div style={{ padding: 12 }}>No active members found.</div>
            ) : filteredSorted.length <= SMALL_TABLE_THRESHOLD ? (
              // Render a normal table for small result sets so it matches other pages
              <div className="members-list-wrapper" style={{ display: 'flex', justifyContent: 'center' }}>
                <div style={{ width: '100%' }}>
                  <table className="attendance-table aligned" style={{ width: '100%' }}>
                  <colgroup>
                    <col style={{ width: '15%' }} />
                    <col style={{ width: '25%' }} />
                    <col style={{ width: '15%' }} />
                    <col style={{ width: '15%' }} />
                    <col style={{ width: '15%' }} />
                    <col style={{ width: '15%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'center' }}>Nick Name</th>
                      <th style={{ textAlign: 'center' }}>Full Name</th>
                      <th style={{ textAlign: 'center' }}>Member Since</th>
                      <th style={{ textAlign: 'center' }}>Last Gym Visit</th>
                      <th style={{ textAlign: 'center' }}>Gym Valid Until</th>
                      <th style={{ textAlign: 'center' }}>Coach Valid Until</th>
                    </tr>
                  </thead>
                  <tbody>
                    {membersPager.visible.map(({ r, lastVisit, isToday, memberId, gymUntil, coachUntil }, i) => {
                      const pay = memberId ? payIdx.get(memberId) : undefined;
                      const gymActive = pay?.membershipState === 'active';
                      const coachActive = !!pay?.coachActive;
                      const first = String(firstOf(r, ["first_name","firstname","first","given_name"]) ?? "");
                      const last = String(firstOf(r, ["last_name","lastname","last","surname"]) ?? "");
                      const fullName = [first, last].filter(Boolean).map(toTitleCase).join(" ");
                      const nick = String(r.nick_name ?? r.nickname ?? "").toUpperCase();
                      const pills = getMemberPills(r);
                      // Example image optimization for member photo
                      // const photoUrl = r.photoUrl || '';
                      // const photoSrcSet = r.photoSrcSet || '';
                      const memberSince = resolveMemberSince(r) || asDate(firstOf(r, ["member_since","membersince","member_date","memberdate","member_date","createdat","created_at","join_date","joined","start_date"]));
                      return (
                        <tr key={i} className="row-link" onClick={() => navigate(`/members/${encodeURIComponent(memberId)}`, { state: { row: r } })} style={{ cursor: 'pointer' }}>
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
                           <td style={{ textAlign: 'center' }}>{fullName}</td>
                           {/* Example image optimization for member photo */}
                           {/* <img src={photoUrl} loading="lazy" srcSet={photoSrcSet} alt={fullName} style={{ maxWidth: 40, borderRadius: '50%' }} /> */}
                          <td style={{ textAlign: 'center' }}>{fmtDate(memberSince)}</td>
                          <td style={{ textAlign: 'center' }}>{isToday ? <span className="pill ok">Visited today</span> : (lastVisit ? fmtDate(new Date(lastVisit)) : "")}</td>
                          <td style={{ textAlign: 'center', color: gymUntil ? (gymActive ? 'green' : 'red') : 'inherit' }}>{gymUntil ? fmtDate(gymUntil) : ""}</td>
                          <td style={{ textAlign: 'center', color: coachUntil ? (coachActive ? 'green' : 'red') : 'inherit' }}>{coachUntil ? fmtDate(coachUntil) : ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  </table>

                  {membersPager.canLoadMore && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 10 }}>
                      <button className="load-more-link" type="button" onClick={membersPager.loadMore}>Load 20 more</button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="members-list-wrapper" style={{ width: '100%', display: 'flex', flexDirection: 'column', flex: 1 }}>
                <div style={{ display: 'flex', padding: '8px 12px', fontWeight: 700, borderBottom: '1px solid var(--light-border)', background: 'var(--panel-header-bg)' }}>
                  <div style={{ width: '15%', textAlign: 'center' }}>Nick Name</div>
                  <div style={{ width: '25%', textAlign: 'center' }}>Full Name</div>
                  <div style={{ width: '15%', textAlign: 'center' }}>Member Since</div>
                  <div style={{ width: '15%', textAlign: 'center' }}>Last Gym Visit</div>
                  <div style={{ width: '15%', textAlign: 'center' }}>Gym Valid Until</div>
                  <div style={{ width: '15%', textAlign: 'center' }}>Coach Valid Until</div>
                </div>
                <List
                  height={Math.min(listHeight, Math.max(200, membersPager.visible.length * 56))}
                  itemCount={membersPager.visible.length}
                  itemSize={56}
                  width={'100%'}
                >
                {({ index, style }) => {
                  const { r, lastVisit, isToday, memberId, gymUntil, coachUntil } = membersPager.visible[index];
                  const pay = memberId ? payIdx.get(memberId) : undefined;
                  const gymActive = pay?.membershipState === 'active';
                  const coachActive = !!pay?.coachActive;
                  const first = String(firstOf(r, ["first_name","firstname","first","given_name"]) ?? "");
                  const last = String(firstOf(r, ["last_name","lastname","last","surname"]) ?? "");
                  const fullName = [first, last].filter(Boolean).map(toTitleCase).join(" ");
                  const nick = String(r.nick_name ?? r.nickname ?? "").toUpperCase();
                  const pills = getMemberPills(r);
                  const memberSince = resolveMemberSince(r) || asDate(firstOf(r, ["member_since","membersince","member_date","memberdate","member_date","createdat","created_at","join_date","joined","start_date"]));
                  return (
                    <div
                      key={index}
                      style={{ ...style, display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid rgba(0,0,0,0.04)', cursor: 'pointer' }}
                      className="row-link"
                      onClick={() => navigate(`/members/${encodeURIComponent(memberId)}`, { state: { row: r } })}
                    >
                      <div style={{ width: '15%', textAlign: 'center' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                          <strong>{nick}</strong>
                          {pills.length > 0 && (
                            <span style={{ display: 'inline-flex', gap: 6 }}>
                              {pills.map(p => <span key={p.key} className={`pill ${p.className}`}>{p.label}</span>)}
                            </span>
                          )}
                        </span>
                      </div>
                      <div style={{ width: '25%', textAlign: 'center' }}>{fullName}</div>
                      <div style={{ width: '15%', textAlign: 'center' }}>{fmtDate(memberSince)}</div>
                      <div style={{ width: '15%', textAlign: 'center' }}>{isToday ? <span className="pill ok">Visited today</span> : (lastVisit ? fmtDate(new Date(lastVisit)) : "")}</div>
                      <div style={{ width: '15%', textAlign: 'center', color: gymUntil ? (gymActive ? 'green' : 'red') : 'inherit' }}>{gymUntil ? fmtDate(gymUntil) : ""}</div>
                      <div style={{ width: '15%', textAlign: 'center', color: coachUntil ? (coachActive ? 'green' : 'red') : 'inherit' }}>{coachUntil ? fmtDate(coachUntil) : ""}</div>
                    </div>
                  );
                }}
              </List>

              {membersPager.canLoadMore && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 10 }}>
                  <button className="load-more-link" type="button" onClick={membersPager.loadMore}>Load 20 more</button>
                </div>
              )}
              </div>
            )}
          </div>
        </div>
      )}

      <Suspense fallback={<LoadingSkeleton />}>
        <AddMemberModal
          open={openAdd}
          onClose={() => setOpenAdd(false)}
          onSaved={async () => {
            try { await mutate(); } catch(_) {}
          }}
        />
      </Suspense>
    </div>
  );
}
