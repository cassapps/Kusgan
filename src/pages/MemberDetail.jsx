import React, { useEffect, useState } from "react";
import PaymentModal from "../components/PaymentModal";
import PaymentActionModal from "../components/PaymentActionModal";
import EditMemberModal from "../components/EditMemberModal";
import QrCodeModal from "../components/QrCodeModal";
import ProgressModal from "../components/ProgressModal";
import ProgressViewModal from "../components/ProgressViewModal";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import api from "../api";
const { fetchMembers, fetchPayments, fetchGymEntries, fetchProgressTracker, fetchMemberBundle, fetchPricing, fetchMemberById, fetchMemberByIdFresh, addPayment } = api;
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { ensureFirebase } from '../lib/firebase';
import { isAdminUid } from '../lib/admin';
import LoadingSkeleton from "../components/LoadingSkeleton";
import RefreshBadge from '../components/RefreshBadge.jsx';
import MemberProfileCard from "../components/MemberProfileCard";
import VisitViewModal from "../components/VisitViewModal";
import CheckInConfirmModal from "../components/CheckInConfirmModal";
import events from "../lib/events";
import { computeStatusForMember } from '../lib/membership';
import displayName from '../lib/displayName';
import { getMemberPills } from '../lib/discount.js';

const toKey = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, "_");
const norm = (row) => Object.fromEntries(Object.entries(row || {}).map(([k, v]) => [toKey(k), v]));
const firstOf = (o, ks) => ks.map((k) => o[k]).find((v) => v !== undefined && v !== "");
const asDate = (v) => {
  if (!v && v !== 0) return null;
  // Firestore Timestamp objects have a toDate() helper
  try {
    if (v && typeof v.toDate === "function") return v.toDate();
  } catch (e) {}
  // If object has seconds (Unix timestamp-like), convert
  if (v && typeof v.seconds === "number") return new Date(v.seconds * 1000);
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d) ? null : d;
};
// Manila timezone display helper: Mon-D, YYYY
const MANILA_TZ = "Asia/Manila";
// Format time as HH:MM AM/PM in Manila timezone
const fmtTime = (t) => {
  if (!t) return "-";
  // If already in HH:MM AM/PM, return as-is
  if (/^\d{1,2}:\d{2}\s?(AM|PM)$/i.test(t)) return t;
  // If ISO string, parse and format
  const d = new Date(t);
  if (!isNaN(d)) {
    return new Intl.DateTimeFormat("en-US", { timeZone: MANILA_TZ, hour: "2-digit", minute: "2-digit", hour12: true }).format(d);
  }
  // If string like "07:53:00.000Z", try to extract HH:mm and infer AM/PM
  const m = String(t).match(/(\d{2}):(\d{2})/);
  if (m) {
    let hour = parseInt(m[1], 10);
    let min = m[2];
    let ampm = hour >= 12 ? "PM" : "AM";
    hour = hour % 12 || 12;
    return `${hour}:${min} ${ampm}`;
  }
  return "-";
};
const fmtDate = (d) => {
  if (!d) return "-";
  const date = asDate(d);
  if (!date) return "-";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: MANILA_TZ, month: "short", day: "numeric", year: "numeric" }).formatToParts(date);
  const m = parts.find((p) => p.type === "month")?.value || "";
  const day = parts.find((p) => p.type === "day")?.value || "";
  const y = parts.find((p) => p.type === "year")?.value || "";
  return `${m}-${day}, ${y}`;
};

const fmtDateTime = (d) => {
  if (!d) return "-";
  const date = asDate(d);
  if (!date) return "-";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MANILA_TZ,
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const m = parts.find((p) => p.type === "month")?.value || "";
  const day = parts.find((p) => p.type === "day")?.value || "";
  const y = parts.find((p) => p.type === "year")?.value || "";
  const hr = parts.find((p) => p.type === "hour")?.value || "";
  const min = parts.find((p) => p.type === "minute")?.value || "";
  const ap = parts.find((p) => p.type === "dayPeriod")?.value || "";
  return `${m}-${day}, ${y} ${hr}:${min} ${ap}`.trim();
};
const display = (v) => (v === undefined || v === null || String(v).trim() === "" ? "-" : String(v));

// normalize Drive viewer links to direct-view URLs; leave googleusercontent links as-is
const driveImg = (u) => {
  const s = String(u || "");
  if (!s) return "";
  // If it's a wrapped string like "{ok=true, url=https://...}", extract the first URL
  const anyUrl = s.match(/https?:\/\/[^\s}]+/);
  if (anyUrl) {
    const direct = anyUrl[0];
    if (/googleusercontent\.com\//.test(direct)) return direct;
    const mid = direct.match(/(?:\/file\/d\/|[?&]id=|\/uc\?[^#]*id=)([^/&?#]+)/);
    if (mid && mid[1]) return `https://drive.google.com/uc?export=view&id=${mid[1]}`;
    return direct;
  }
  // If already a direct googleusercontent CDN link, use it as-is
  if (/googleusercontent\.com\//.test(s)) return s;
  // /file/d/<id>/, open?id=<id>, uc?export=download&id=<id>
  const m =
    s.match(/\/file\/d\/([^/]+)/) ||
    s.match(/[?&]id=([^&]+)/) ||
    s.match(/\/uc\?[^#]*id=([^&]+)/);
  const id = m ? m[1] : "";
  if (id) return `https://drive.google.com/uc?export=view&id=${id}`;
  return s;
};

// Extract Drive file ID when possible
const driveId = (u) => {
  const s = String(u || "");
  const m = s.match(/(?:\/file\/d\/|[?&]id=|\/uc\?[^#]*id=)([^/&?#]+)/);
  return m && m[1] ? m[1] : "";
};

// Prefer thumbnail endpoint for inline <img> to avoid 404/content-disposition issues
const driveThumb = (u) => {
  const s = String(u || "");
  if (/googleusercontent\.com\//.test(s)) return s; // already a served image
  const id = driveId(s);
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w1000` : s;
};

// computeStatus replaced by shared helper in src/lib/membership

export default function MemberDetail() {
  const [selectedVisit, setSelectedVisit] = useState(null);
  const [selectedPayment, setSelectedPayment] = useState(null);
  const { id: idParam, memberId: memberIdParam } = useParams();
  const navigate = useNavigate();
  const loc = useLocation();
  const passed = React.useMemo(() => (loc.state?.row ? norm(loc.state.row) : null), [loc.state?.row]);

  const useFirestore = (import.meta.env.VITE_USE_FIRESTORE === 'true' || import.meta.env.VITE_USE_FIRESTORE === undefined);
  const [isAdmin, setIsAdmin] = useState(false);

  const [member, setMember] = useState(passed || null);
  const [loading, setLoading] = useState(!passed); // render immediately if we have a passed row
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState({ membershipState: null, coachActive: false, membershipEnd: null, coachEnd: null });
  const [visits, setVisits] = useState([]);
  const [rawGyms, setRawGyms] = useState([]);
  const [payments, setPayments] = useState([]);
  const [progress, setProgress] = useState([]);

  // Derived member fields and UI state/hooks (declare hooks unconditionally)
  const { membershipState, coachActive } = status;
  const studentRaw = firstOf(member, ["student"]);
  const isStudent = typeof studentRaw === "string" ? studentRaw.trim().toLowerCase().startsWith("y") : !!studentRaw;

  const lastName = firstOf(member, ["lastname","last_name"]);
  const firstName = firstOf(member, ["firstname","first_name"]);
  const middle = firstOf(member, ["middlename","middle_name"]);
  const gender = firstOf(member, ["gender"]);
  const bdayRaw = firstOf(member, ["birthday","birth_date","dob"]);
  const bday = asDate(bdayRaw);
  const nick = firstOf(member, ["nick_name","nickname"]);
  const street = firstOf(member, ["street"]);
  const brgy = firstOf(member, ["brgy","barangay"]);
  const muni = firstOf(member, ["municipality","city"]);
  const email = firstOf(member, ["email"]);
  const mobile = firstOf(member, ["mobile","phone"]);
  const memberSince = asDate(firstOf(member, ["member_since","membersince","join_date"]));
  const id = String(firstOf(member, ["memberid","member_id","member_id_","id"]) || "").trim();
  const photoRaw = firstOf(member, ["photourl","photo_url","photo"]);
  const photoUrl = driveImg(photoRaw);
  const photoSrc = driveThumb(photoUrl);

  const pills = getMemberPills(member || {});

  const [openPayment, setOpenPayment] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);
  const [openQr, setOpenQr] = useState(false);
  const [openProgress, setOpenProgress] = useState(false);
  const [openProgView, setOpenProgView] = useState(false);
  const [checkoutInitialEntry, setCheckoutInitialEntry] = useState(null);
  const [showAllVisits, setShowAllVisits] = useState(false);
  const [showCheckInConfirm, setShowCheckInConfirm] = useState(false);
  const [checkModalMode, setCheckModalMode] = useState(null); // 'in' | 'out' | null
  const [viewProgressIndex, setViewProgressIndex] = useState(-1);
  const [imgFailed, setImgFailed] = useState(false);
  const [visitsLimit, setVisitsLimit] = useState(20);
  const [progressLimit, setProgressLimit] = useState(20);
  const [paymentsLimit, setPaymentsLimit] = useState(20);

  // Reset image-failed flag whenever the computed photo URL changes
  useEffect(() => { setImgFailed(false); }, [photoUrl]);

  // UI-only admin gating (UID allowlist)
  useEffect(() => {
    if (!useFirestore) {
      setIsAdmin(false);
      return;
    }
    let unsub = null;
    try {
      ensureFirebase();
      const auth = getAuth();
      // Ensure reactively updated if auth session changes
      unsub = onAuthStateChanged(auth, (u) => {
        setIsAdmin(!!u && isAdminUid(u.uid));
      });
    } catch (e) {
      setIsAdmin(false);
    }
    return () => { try { unsub && unsub(); } catch (e) {} };
  }, [useFirestore]);

  // Helper: treat empty / dash-like TimeOut markers as missing; reuseable across this component
  const isTimeOutMissingRow = (row) => {
    try {
      const n = norm(row || {});
      const candidates = [n.timeout, n.time_out, n.timeOut, n.timeout, n.time_out_];
      for (const c of candidates) {
        if (c && String(c).trim() !== '') {
          const parsed = asDate(c);
          if (parsed) return false;
          if (/\d/.test(String(c))) return false;
        }
      }
      // also check common raw keys
      const raw = String(row?.TimeOut || row?.Time_Out || row?.TimeOUT || row?.Timeout || '').trim();
      if (raw) {
        try { if (asDate(raw)) return false; } catch(e){}
        if (/\d/.test(raw)) return false;
      }
      return true;
    } catch (e) { return true; }
  };

  // Debounced refresh to avoid duplicate network calls when multiple events fire
  const refreshTimer = React.useRef(null);
  const debouncedRefreshBundle = () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshBundle();
      refreshTimer.current = null;
    }, 200);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      // Prefer route param; if absent use the ID from the passed row
      const routeId = decodeURIComponent(memberIdParam || idParam || "").trim();
      const passedId = String(firstOf(passed || {}, ["memberid","member_id","id"]) || "").trim();
      const id = routeId || passedId;
      if (!id) { setLoading(false); return; }

      // If we already received a passed row via navigation state, use it for immediate render
      // and defer the heavier bundle fetch so the UI is responsive.
      if (passed) {
        setMember(passed);
        setLoading(false);
        // Trigger a near-immediate background refresh (debounced) so payment/status tiles update quickly
        try {
          debouncedRefreshBundle();
          // fallback extra attempt after a short delay
          if (typeof window !== 'undefined') setTimeout(() => { try { debouncedRefreshBundle(); } catch(e) {} }, 600);
        } catch (e) {
          // ignore
        }
        return;
      }

  async function loadViaBundleFresh() {
        // Our API returns a plain object { member, payments, gymEntries, progress }
        // without an { ok } flag, so treat absence of errors as success.
        const [bundle, pricingRes] = await Promise.all([
          fetchMemberBundle(id, { ttlMs: 0 }),
          fetchPricing(),
        ]);
  const m = bundle.member ? norm(bundle.member) : null;
  const pays = (bundle.payments || []).map(norm);
  const gymsRaw = (bundle.gymEntries || []).map((r) => r);
  const gyms = gymsRaw.map(norm);
  const progs = (bundle.progress || []).map(norm);
  // store raw gym rows so VisitViewModal can receive the full sheet row when opening
  setRawGyms(gymsRaw);
        const pricingRows = (pricingRes?.rows || pricingRes?.data || []).map((r) => r);
        return { m, pays, gyms, progs, pricingRows };
      }

      async function loadViaLegacy() {
        const [mRes, pRes, gRes, prRes] = await Promise.all([
          fetchMembers(), fetchPayments(), fetchGymEntries(), fetchProgressTracker(),
        ]);
        const rows = (mRes?.rows ?? mRes?.data ?? []).map(norm);
        const m = rows.find((r) => String(firstOf(r, ["memberid","member_id","member_id_","id"]) || "").trim().toLowerCase() === id.toLowerCase()) || null;
        const pays = (pRes?.rows ?? pRes?.data ?? []).filter((r) =>
          String(firstOf(norm(r), ["memberid","member_id","member_id_","id"]) || "").trim().toLowerCase() === id.toLowerCase()
        );
        const gymsRaw = (gRes?.rows ?? gRes?.data ?? []).filter((r) =>
          String(firstOf(norm(r), ["memberid","member_id","member_id_","id"]) || "").trim().toLowerCase() === id.toLowerCase()
        );
        const gyms = gymsRaw.map(norm);
        // store raw gym rows for modal use
        setRawGyms(gymsRaw);
        const progs = (prRes?.rows ?? prRes?.data ?? []).filter((r) =>
          String(firstOf(norm(r), ["memberid","member_id","member_id_","id"]) || "").trim().toLowerCase() === id.toLowerCase()
        );
        return { m, pays, gyms, progs };
      }

      try {
  let data;
  try { data = await loadViaBundleFresh(); }
        catch { data = await loadViaLegacy(); }

        if (!alive) return;

        if (data.m) {
          setMember(data.m);
          const mid = String(firstOf(data.m, ["memberid","member_id","id"]) || "").trim();
            // Normalize payments so downstream logic (computeStatus, UI) reads consistent field names
            setPayments((data.pays || []).map(norm).sort((a, b) => {
              const da = asDate(firstOf(a, ["date","paid_on","created","timestamp"])) || new Date(0);
              const db = asDate(firstOf(b, ["date","paid_on","created","timestamp"])) || new Date(0);
              return db - da;
            }));
          setVisits(
            data.gyms.map((r) => {
              const n = norm(r);
              return {
                // keep same lightweight visit objects for list rendering
                date: asDate(firstOf(n, ["date"])),
                timeIn: firstOf(n, ["timein","time_in"]),
                timeOut: firstOf(n, ["timeout","time_out"]),
                totalHours: firstOf(n, ["totalhours","total_hours","hours"]),
                coach: firstOf(n, ["coach"]),
                focus: firstOf(n, ["focus"]),
                // keep original raw row and member id for downstream modals
                raw: r,
                memberId: String(firstOf(n, ["memberid","member_id","MemberID","id"]) || "").trim(),
              };
            }).filter((x) => !!x.date).sort((a, b) => b.date - a.date)
          );
          setProgress(
            data.progs.map(norm).sort((a, b) => {
              const da = asDate(firstOf(a, ["date","recorded","log_date","timestamp"])) || new Date(0);
              const db = asDate(firstOf(b, ["date","recorded","log_date","timestamp"])) || new Date(0);
              return db - da;
            })
          );
          // compute status using shared helper; pass raw payments and member object
          setStatus(computeStatusForMember((data.pays || []).map(norm), data.m, data.pricingRows || []));
        } else {
          // Only show error if we didn’t have a passed row to display
          if (!passed) {
            setMember(null);
            setError("Member not found");
          }
        }
      } catch (e) {
        if (alive && !passed) setError(e.message || "Failed to load member");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    // subscribe to events to refresh bundle if member updated or gym entry added
    // When a member is updated elsewhere, the event payload may include the
    // updated row. Use the payload's MemberID (if present) to decide whether
    // to refresh this page. Avoid relying on the `member` variable from the
    // outer closure which can be stale.
    const unsub1 = events.on('member:updated', (payload) => {
      try {
        // Payload may be the updated row or an object like { request, response }
        const candidate = payload && payload.request ? payload.request : payload;
        const pMid = String(firstOf(candidate || {}, ["MemberID","memberid","member_id","id"]) || "").trim();
        // Determine the route/member id we care about from the params or passed row
        const routeId = decodeURIComponent(memberIdParam || idParam || "").trim();
        const passedId = String(firstOf(passed || {}, ["memberid","member_id","id"]) || "").trim();
        const targetId = routeId || passedId;
        if (pMid && targetId && pMid.toLowerCase() === targetId.toLowerCase()) {
          // small delay to let cache invalidation settle
          setTimeout(() => debouncedRefreshBundle(), 120);
        }
      } catch (e) { /* ignore */ }
    });
    const unsub2 = events.on('gymEntry:added', (entry) => {
      try { const mid = String(firstOf(member||{}, ["memberid","member_id","id"])||"").trim(); if (!mid) return; const entryMid = String(entry?.MemberID||entry?.memberid||entry?.Member||'').trim(); if (entryMid && entryMid === mid) debouncedRefreshBundle(); } catch(e) {}
    });
    const unsub3 = events.on('payment:added', (p) => {
      try {
        const mid = String(firstOf(member||{}, ["memberid","member_id","id"])||"").trim();
        if (!mid) return;
        // support shapes: { request: {...}, response: {...} } or legacy obj
        const req = p && p.request ? p.request : p;
        const resp = p && p.response ? p.response : null;
        const pMid = String(req?.MemberID || req?.memberid || resp?.MemberID || resp?.memberid || req?.Member || resp?.Member || '').trim();
        if (pMid && pMid === mid) {
          // immediate small delay to let cache invalidation settle
          setTimeout(() => debouncedRefreshBundle(), 120);
        }
      } catch(e) { console.debug('payment event handler error', e); }
    });
    return () => {
      alive = false;
      try { unsub1(); } catch(e) {}
      try { unsub2(); } catch(e) {}
      try { unsub3(); } catch(e) {}
      try { if (refreshTimer.current) { clearTimeout(refreshTimer.current); refreshTimer.current = null; } } catch(e) {}
    };
  }, [memberIdParam, idParam, passed]);


  if (loading) return <div className="content"><LoadingSkeleton /></div>;
  if (!member) {
    return (
      <div className="content">
        <button className="back-btn" onClick={() => navigate(-1)}>← Back</button>
        <div>{error || "Member not found"}</div>
      </div>
    );
  }



  async function refreshBundle() {
    setIsRefreshing(true);
    try {
      const idClean = String(id || "").trim();
      if (!idClean) return;
      console.debug("refreshBundle: fetching bundle for", idClean);
      const [bundle, pricingRes] = await Promise.all([
        // Force a fresh bundle fetch here to avoid stale cached responses so MemberDetail
        // stays in sync with the Members list after writes (e.g. addPayment).
        fetchMemberBundle(idClean, { ttlMs: 0 }),
        fetchPricing(),
      ]);
      console.debug("refreshBundle: fetched bundle", bundle, pricingRes);
      const m = bundle.member ? norm(bundle.member) : null;
      const pays = (bundle.payments || []).map(norm);
      const gymsRaw = (bundle.gymEntries || []).map((r) => r);
      const gyms = gymsRaw.map(norm);
      const progs = (bundle.progress || []).map(norm);
      if (m) setMember(m);
      // store raw gym rows so VisitViewModal can receive the full sheet row when opening
      setRawGyms(gymsRaw);
      setPayments(pays.sort((a,b)=>{
        const da = asDate(firstOf(a,["date","paid_on","created","timestamp"])) || new Date(0);
        const db = asDate(firstOf(b,["date","paid_on","created","timestamp"])) || new Date(0);
        return db - da;
      }));
      setVisits(
        gyms.map((r)=>{
          const n = norm(r);
          return {
            date: asDate(firstOf(n,["date"])),
            timeIn:firstOf(n,["timein","time_in"]),
            timeOut:firstOf(n,["timeout","time_out"]),
            totalHours:firstOf(n,["totalhours","total_hours","hours"]),
            coach:firstOf(n,["coach"]),
            focus:firstOf(n,["focus"]),
            raw: r,
            memberId: String(firstOf(n, ["memberid","member_id","MemberID","id"]) || "").trim(),
          };
        }).filter((x)=>!!x.date).sort((a,b)=>b.date-a.date)
      );
      setProgress(
        progs.sort((a,b)=>{
          const da = asDate(firstOf(a,["date","recorded","log_date","timestamp"])) || new Date(0);
          const db = asDate(firstOf(b,["date","recorded","log_date","timestamp"])) || new Date(0);
          return db - da;
        })
      );
      const pricingRows = (pricingRes?.rows || pricingRes?.data || []).map((r) => r);
  setStatus(computeStatusForMember(pays, idClean, pricingRows));
    } catch(e) {
      console.error('refreshBundle failed', e);
      // Surface a UI-visible error so users know the refresh failed
      try { setError(String(e?.message || e || 'Failed to refresh member data')); } catch (ee) {}
    }
    finally { setIsRefreshing(false); }
  }

  // Debounced refresh to avoid duplicate network calls when multiple events fire

  // Compute today's open entry (prefer normalized `visits`, fallback to `rawGyms`)
  const todayYMD_global = new Intl.DateTimeFormat('en-CA', { timeZone: MANILA_TZ, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
  const openVisit_global = (visits || []).find(v => {
    try {
      const d = v?.date; if (!d) return false;
      const ymd = new Date(d);
      const s = new Intl.DateTimeFormat('en-CA', { timeZone: MANILA_TZ, year:'numeric', month:'2-digit', day:'2-digit' }).format(ymd);
      if (s !== todayYMD_global) return false;
      return isTimeOutMissingRow(v);
    } catch (e) { return false; }
  });
  const openRaw_global = (rawGyms || []).find(r => {
    try {
      const n = norm(r || {});
      const dval = firstOf(n, ['date','Date','log_date','date_time']);
      if (!dval) return false;
      const ymd = new Date(dval);
      const s = new Intl.DateTimeFormat('en-CA', { timeZone: MANILA_TZ, year:'numeric', month:'2-digit', day:'2-digit' }).format(ymd);
      if (s !== todayYMD_global) return false;
      return isTimeOutMissingRow(r);
    } catch (e) { return false; }
  }) || null;
  const hasOpenEntryToday = !!openVisit_global || !!openRaw_global;

  return (
    <div className="content">
      {/* Header: buttons row on top, nickname centered below */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button className="back-btn" onClick={() => navigate(-1)}>← Back</button>
              {/* Separate Check In and Check Out buttons according to rules:
                  - Check In: available when there is NO open entry today and membership is active
                  - Check Out: available when there IS an open entry today */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="back-btn"
                  onClick={() => { setCheckModalMode('in'); setShowCheckInConfirm(true); }}
                  disabled={!(!hasOpenEntryToday && membershipState === 'active')}
                  title={!hasOpenEntryToday ? (membershipState === 'active' ? 'Check in' : 'Gym membership is not active') : 'Member already has an open visit for today'}
                  style={{ opacity: (!hasOpenEntryToday && membershipState === 'active') ? 1 : 0.5, cursor: (!hasOpenEntryToday && membershipState === 'active') ? 'pointer' : 'not-allowed' }}
                >
                  Check In
                </button>
                <button
                  className="back-btn"
                  onClick={() => { setCheckModalMode('out'); setShowCheckInConfirm(true); }}
                  disabled={!hasOpenEntryToday}
                  title={hasOpenEntryToday ? 'Member has an open visit today — checkout' : 'No open visit to check out'}
                  style={{ opacity: hasOpenEntryToday ? 1 : 0.5, cursor: hasOpenEntryToday ? 'pointer' : 'not-allowed' }}
                >
                  Check Out
                </button>
              </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{display(displayName(member) || nick || firstName || "Member")}</h2>
          {pills.length > 0 && (
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              {pills.map(p => <span key={p.key} className={`pill ${p.className}`}>{p.label}</span>)}
            </span>
          )}
          <div><RefreshBadge show={isRefreshing && !loading} /></div>
        </div>
      </div>

      <MemberProfileCard
        member={member}
        status={status}
        isRefreshing={isRefreshing}
        onEdit={() => setOpenEdit(true)}
        onAddPayment={() => setOpenPayment(true)}
        onShowQr={() => setOpenQr(true)}
        onShowProgress={() => setOpenProgress(true)}
        onCheckIn={() => { setCheckModalMode('in'); setShowCheckInConfirm(true); }}
      />

      {/* Purchases are handled via the Add Payment modal. */}

      {/* Payment modal */}
      <PaymentModal
        open={openPayment}
        onClose={() => setOpenPayment(false)}
        memberId={id}
        onSaved={() => { setOpenPayment(false); refreshBundle(); }}
        membershipEnd={status.membershipEnd}
        coachEnd={status.coachEnd}
        isStudent={isStudent}
        birthDate={bday}
        isSpecial={pills.some(p => p.key === 'special')}
      />

      {/* Admin-only payment actions modal (edit/delete) */}
      <PaymentActionModal
        open={!!selectedPayment}
        onClose={() => setSelectedPayment(null)}
        payment={selectedPayment}
        onChanged={() => {
          setSelectedPayment(null);
          refreshBundle();
        }}
      />

      {/* Edit Member modal */}
      <EditMemberModal
        open={openEdit}
        onClose={() => setOpenEdit(false)}
        member={member}
        // Accept an optional updatedRow from the modal for optimistic UI updates
        onSaved={(updatedRow) => {
          // Close modal immediately
          setOpenEdit(false);
          try {
            if (updatedRow) {
              // Normalize optimistic payload and only merge non-empty values.
              // This prevents accidental clobbering of existing fields with
              // empty strings when the modal returns a partial payload.
              const normalized = norm(updatedRow) || {};
              const patch = Object.fromEntries(
                Object.entries(normalized).filter(([k, v]) => v !== undefined && v !== null && String(v).trim() !== "")
              );
              if (Object.keys(patch).length) {
                setMember((prev) => ({ ...(prev || {}), ...patch }));
              }
            }
          } catch (e) {
            console.debug('onSaved merge error', e);
          }
          // Immediately fetch authoritative member row from server and update UI.
          // This ensures the profile card reflects the DB (the Members list already
          // shows the updated values, so we must mirror that authoritative state).
          (async () => {
            try {
              const idClean = String(firstOf(updatedRow || member || {}, ["memberid","member_id","id","MemberID"]) || "").trim();
              if (idClean) {
                try {
                  const fresh = await fetchMemberByIdFresh(idClean);
                  if (fresh) {
                    // Only merge non-empty fields from the authoritative fetch to avoid
                    // replacing the current member state with a sparse/partial object.
                    try {
                      const normalizedFresh = norm(fresh) || {};
                      const patch = Object.fromEntries(
                        Object.entries(normalizedFresh).filter(([k, v]) => v !== undefined && v !== null && String(v).trim() !== "")
                      );
                      if (Object.keys(patch).length) {
                        setMember((prev) => ({ ...(prev || {}), ...patch }));
                      } else {
                        // nothing useful in fresh — fallback to full bundle refresh
                        try { refreshBundle(); } catch (e) {}
                      }
                    } catch (e) {
                      try { refreshBundle(); } catch (ee) {}
                    }
                  }
                } catch (e) {
                  // if fresh fetch fails, fall back to refreshing the whole bundle
                  try { refreshBundle(); } catch (e2) {}
                }
              } else {
                try { refreshBundle(); } catch (e) {}
              }
            } catch (e) {
              try { refreshBundle(); } catch (ee) {}
            }
          })();

        }}
      />

      {/* QR Code modal */}
      <QrCodeModal
        open={openQr}
        onClose={() => setOpenQr(false)}
        memberId={id}
        nickname={nick || firstName || ""}
        firstName={firstName || ""}
        lastName={lastName || ""}
        memberSince={memberSince || null}
        photo={photoSrc}
      />

      {/* Progress modal */}
      <ProgressModal
        open={openProgress}
        onClose={() => setOpenProgress(false)}
        memberId={id}
        memberNick={nick || firstName || ""}
        memberSinceYMD={memberSince ? `${memberSince.getFullYear()}-${String(memberSince.getMonth()+1).padStart(2,"0")}-${String(memberSince.getDate()).padStart(2,"0")}` : ""}
        onSaved={() => { setOpenProgress(false); refreshBundle(); }}
      />

      {/* Progress view-only modal */}
      <ProgressViewModal
        open={openProgView}
        onClose={() => { setOpenProgView(false); setViewProgressIndex(-1); }}
        row={viewProgressIndex >= 0 ? progress[viewProgressIndex] : null}
        memberNick={nick || firstName || ""}
      />

      <div className="panel">
        <div className="panel-header">Gym Visits</div>
  <table className="aligned">
        <thead>
          <tr>
            <th>Date</th><th>Time In</th><th>Time Out</th><th>Total Hours</th><th>Coach</th><th>Focus</th>
          </tr>
        </thead>
        <tbody>
          {visits.length === 0 ? (
            <tr><td colSpan={6}>-</td></tr>
          ) : visits.slice(0, visitsLimit).map((v, i) => (
            <tr key={i} style={{ cursor: "pointer" }} onClick={() => setSelectedVisit(v)}>
              <td>{fmtDate(v.date)}</td>
              <td>{fmtTime(v.timeIn)}</td>
              <td>{fmtTime(v.timeOut)}</td>
              <td>{display(v.totalHours)}</td>
              <td>{display(v.coach)}</td>
              <td>{display(v.focus)}</td>
            </tr>
          ))}
        </tbody>
        </table>
        {visits.length > visitsLimit && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="load-more-link" type="button" onClick={() => setVisitsLimit((n) => Math.min(n + 20, visits.length))}>
              Load 20 more
            </button>
          </div>
        )}
      </div>

          {/* Visit detail modal (styled like progress view) */}
          {selectedVisit && (
            <VisitViewModal
              open={!!selectedVisit}
              onClose={() => setSelectedVisit(null)}
              row={selectedVisit}
              onCheckout={(row) => {
                try {
                  // Attempt to locate the original raw gym row that corresponds to the lightweight visit
                  const target = (rawGyms || []).find(r => {
                    try {
                      const rn = norm(r || {});
                      const rDate = firstOf(rn, ['date','Date','log_date','date_time']);
                      const rTimeIn = firstOf(rn, ['timein','TimeIn','time_in']);
                      if (!rDate) return false;
                      const a = new Date(rDate);
                      const b = new Date(row?.date || row?.Date || row?.date_time || '');
                      const fmtA = new Intl.DateTimeFormat('en-CA', { timeZone: MANILA_TZ, year:'numeric', month:'2-digit', day:'2-digit' }).format(a);
                      const fmtB = new Intl.DateTimeFormat('en-CA', { timeZone: MANILA_TZ, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(b));
                      if (fmtA !== fmtB) return false;
                      // if timeIn is available on both, use it as a stronger match
                      if (rTimeIn && (row?.timeIn || row?.TimeIn)) {
                        const rawIn = String(rTimeIn).trim();
                        const selIn = String(row.timeIn || row.TimeIn || row.timein || '').trim();
                        if (rawIn && selIn && rawIn.indexOf(selIn) === -1 && selIn.indexOf(rawIn) === -1) return false;
                      }
                      return true;
                    } catch (e) { return false; }
                  }) || null;
                  setCheckoutInitialEntry(target);
                } catch (e) { setCheckoutInitialEntry(null); }
                // open the canonical Confirm modal in this page so behavior matches member detail checkout
                setCheckModalMode('out');
                setShowCheckInConfirm(true);
              }}
            />
          )}
          {
            <CheckInConfirmModal
              open={!!showCheckInConfirm}
              memberId={id}
              // For checkout mode provide the located raw gym row (if found) so modal can upsert TimeOut
              initialEntry={checkModalMode === 'out' ? (checkoutInitialEntry || openRaw_global) : null}
              mode={checkModalMode}
              onClose={() => { setShowCheckInConfirm(false); setCheckModalMode(null); setCheckoutInitialEntry(null); }}
              status={status}
              onSuccess={async () => {
                setShowCheckInConfirm(false);
                setCheckModalMode(null);
                setCheckoutInitialEntry(null);
                try { await debouncedRefreshBundle(); } catch (e) {}
              }}
            />
          }
          {visits.length > 200 && (
            <div style={{ textAlign: "center", marginTop: 8 }}>
              <button className="button" onClick={() => setShowAllVisits(s => !s)}>{showAllVisits ? "Show less" : `Show all (${visits.length})`}</button>
            </div>
          )}

      <div className="panel">
        <div className="panel-header">Progress</div>
        <table className="aligned">
        <thead>
          <tr>
            <th>Date</th><th>No</th><th>Weight</th><th>BMI</th><th>Muscle Mass</th><th>Body Fat</th>
          </tr>
        </thead>
        <tbody>
          {progress.length === 0 ? (
            <tr><td colSpan={6}>-</td></tr>
          ) : progress.slice(0, progressLimit).map((r, i) => {
            const d = asDate(firstOf(r, ["date","recorded","log_date","timestamp"]));
            const no = firstOf(r, ["no","entry_no","seq","number"]);
            const weight = firstOf(r, [
              "weight","weight_kg","weight_lbs","weight_(lbs)","weight_(kg)",
              "weight(lbs)","weightkg","weightlbs"
            ]);
            const bmi = firstOf(r, ["bmi"]);
            const muscle = firstOf(r, ["musclemass","muscle_mass","muscle"]);
            const bodyfat = firstOf(r, ["bodyfat","body_fat","bf"]);
            return (
              <tr key={i} style={{ cursor: "pointer" }} onClick={() => {
                setViewProgressIndex(i);
                setOpenProgView(true);
              }}>
                <td>{fmtDate(d)}</td>
                <td>{display(no)}</td>
                <td>{display(weight)}</td>
                <td>{display(bmi)}</td>
                <td>{display(muscle)}</td>
                <td>{display(bodyfat)}</td>
              </tr>
            );
          })}
        </tbody>
        </table>
        {progress.length > progressLimit && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="load-more-link" type="button" onClick={() => setProgressLimit((n) => Math.min(n + 20, progress.length))}>
              Load 20 more
            </button>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-header">Payments</div>
        <table className="aligned payments-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Particulars</th>
            <th>
              Gym Membership
              <br />
              <span className="th-sub">Valid Until</span>
            </th>
            <th>
              Coach Subscription
              <br />
              <span className="th-sub">Valid Until</span>
            </th>
            <th>Mode</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {payments.length === 0 ? (
            <tr><td colSpan={6}>-</td></tr>
          ) : payments.slice(0, paymentsLimit).map((p, i) => {
            const paid = asDate(firstOf(p, ["date","paid_on","created","timestamp"]));
            const particulars = firstOf(p, ["particulars","type","item","category","product","paymentfor","plan","description"]);
            const gymUntil = asDate(firstOf(p, ["gymvaliduntil","gym_valid_until","gym_until"]));
            const coachUntil = asDate(firstOf(p, ["coachvaliduntil","coach_valid_until","coach_until"]));
            const mode = firstOf(p, ["mode","payment_mode","method","via"]);
            const cost = firstOf(p, ["cost","amount","price","total","paid"]);
            const canOpen = isAdmin && !!String(p?.id || '').trim();
            return (
              <tr
                key={i}
                style={canOpen ? { cursor: "pointer" } : undefined}
                onClick={() => {
                  if (!canOpen) return;
                  setSelectedPayment(p);
                }}
              >
                <td>{fmtDateTime(paid)}</td>
                <td>{display(particulars)}</td>
                <td>{fmtDate(gymUntil)}</td>
                <td>{fmtDate(coachUntil)}</td>
                <td>{display(mode)}</td>
                <td>{display(cost)}</td>
              </tr>
            );
          })}
        </tbody>
        </table>
        {payments.length > paymentsLimit && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="load-more-link" type="button" onClick={() => setPaymentsLimit((n) => Math.min(n + 20, payments.length))}>
              Load 20 more
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Named exports for shared formatting helpers used across pages
export { fmtTime, fmtDate, fmtDateTime, display, MANILA_TZ };
