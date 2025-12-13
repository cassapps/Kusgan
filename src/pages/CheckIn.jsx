import { useEffect, useMemo, useState } from "react";
import { useRef } from "react";
import QrScanModal from "../components/QrScanModal";
import LoadingSkeleton from "../components/LoadingSkeleton";
import events from "../lib/events";
import CheckInConfirmModal from "../components/CheckInConfirmModal";
import api from "../api";
const { fetchMemberBundle, fetchPricing, fetchMembers, fetchGymEntriesForDate, gymClockIn, gymClockOut, gymQuickAppend } = api;
import { computeStatusForMember } from '../lib/membership';

// Helper copied to keep page self-contained
const MANILA_TZ = "Asia/Manila";
const fmtDate = (d) => {
  if (!d) return "-";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date)) return "-";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: MANILA_TZ, month: "short", day: "numeric", year: "numeric" }).formatToParts(date);
  const m = parts.find((p) => p.type === "month")?.value || "";
  const day = parts.find((p) => p.type === "day")?.value || "";
  const y = parts.find((p) => p.type === "year")?.value || "";
  return `${m}-${day}, ${y}`;
};
// Date-only active check: return true if date >= today (date-only)
const isDateActive = (d) => {
  if (!d) return false;
  const dt = d instanceof Date ? new Date(d) : new Date(d);
  if (isNaN(dt)) return false;
  const today = new Date();
  today.setHours(0,0,0,0);
  dt.setHours(0,0,0,0);
  return dt >= today;
};

// membership detection uses shared helper in src/lib/membership

const FOCUSES = ["Full body", "Upper body", "Lower body", "Chest", "Other"];
const COACHES = ["Coach Jojo", "Coach Elmer"];

// Drive helpers (normalize and prefer thumbnail endpoint for <img>)
const driveId = (u) => {
  const s = String(u || "");
  const m = s.match(/(?:\/file\/d\/|[?&]id=|\/uc\?[^#]*id=)([^/&?#]+)/);
  return m && m[1] ? m[1] : "";
};
const driveImg = (u) => {
  const s = String(u || "");
  if (!s) return "";
  const anyUrl = s.match(/https?:\/\/[^\s}]+/);
  if (anyUrl) {
    const direct = anyUrl[0];
    if (/googleusercontent\.com\//.test(direct)) return direct;
    const mid = direct.match(/(?:\/file\/d\/|[?&]id=|\/uc\?[^#]*id=)([^/&?#]+)/);
    if (mid && mid[1]) return `https://drive.google.com/uc?export=view&id=${mid[1]}`;
    return direct;
  }
  if (/googleusercontent\.com\//.test(s)) return s;
  const id = driveId(s);
  return id ? `https://drive.google.com/uc?export=view&id=${id}` : s;
};
const driveThumb = (u) => {
  const s = String(u || "");
  if (/googleusercontent\.com\//.test(s)) return s;
  const id = driveId(s);
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w1000` : s;
};

export default function CheckIn(){
  const [scannerOpen, setScannerOpen] = useState(false);
  const [memberId, setMemberId] = useState("");
  const [members, setMembers] = useState([]);
  const [bundle, setBundle] = useState(null);
  const [pricing, setPricing] = useState([]);
  const [status, setStatus] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmInitialEntry, setConfirmInitialEntry] = useState(null);
  const [coach, setCoach] = useState("");
  const [focus, setFocus] = useState("");
  const [resultText, setResultText] = useState("");
  const [showToast, setShowToast] = useState(false);
  const [comments, setComments] = useState("");
  const [workouts, setWorkouts] = useState("");
  const [isCheckedIn, setIsCheckedIn] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const pendingWriteRef = useRef(null);
  const toastTimeout = useRef(null);

  // Load members for dropdown
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Fetch members + pricing; avoid loading full payments on this page.
        const [memRes, priceRes] = await Promise.all([
          fetchMembers(),
          fetchPricing(),
        ]);
        if (!alive) return;
        const members = (memRes?.rows || memRes?.data || []).slice();
        const pricing = priceRes?.rows || priceRes?.data || [];
        // Only fetch today's gym entries so we can detect open visits
        const todayYMD = new Intl.DateTimeFormat('en-CA', { timeZone: MANILA_TZ, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
        const gymRes = await fetchGymEntriesForDate(todayYMD);
        const gymEntries = (gymRes?.rows || gymRes?.data || []);

        const pick = (o, keys) => {
          for (const k of keys) {
            if (o && Object.prototype.hasOwnProperty.call(o, k)) return o[k];
            const alt = Object.keys(o || {}).find((kk) => kk.toLowerCase().replace(/\s+/g, "") === k.toLowerCase().replace(/\s+/g, ""));
            if (alt) return o[alt];
          }
          return undefined;
        };

        // Only include members who are allowed to check in:
        // - membership active (valid until today counts)
        // - AND no open gym entry for today (no entry with missing TimeOut)
        const filtered = members.filter(m => {
          const id = (m.MemberID || m.member_id || m.id || '').toString().trim();
          // Prefer member-level validity fields (avoid loading payment history)
          const membershipState = String(m.membershipState || m.membership_state || m.status || '').trim().toLowerCase();
          const membershipEnd = pick(m, ["membershipEnd","membership_end","gymvaliduntil","gym_valid_until","gym_until","enddate","end_date","valid_until","expiry","expires","until","end"]);
          // If member docs don't have validity fields, fall back to pricing-only best-effort (will likely mark inactive)
          const active = (membershipState === 'active') || isDateActive(membershipEnd);
          if (!active) return false;
          // find gym entries for this member today
          const todays = gymEntries.filter(g => {
            try {
              const mid = String(g.MemberID || g.memberId || g.memberid || g.id || '').trim();
              if (!mid || String(mid) !== String(id)) return false;
              const d = String(g.Date || g.date || '').trim();
              return d ? d.slice(0,10) === todayYMD : false;
            } catch (e) { return false; }
          });
          // If any today's entry has missing TimeOut (open), disallow check-in
          const hasOpen = todays.some(r => {
            try {
              const to = String(r.TimeOut || r.timeOut || r.time_out || r.Timeout || '').trim();
              if (!to) return true;
              if (/\d/.test(to)) return false;
              // treat dash-like as missing
              return ['-','—','–',''].includes(to);
            } catch (e) { return true; }
          });
          return !hasOpen;
        });
        filtered.sort((a,b)=>{
          const an = String(a.Nickname||a.NickName||a["Nick Name"]||"").toLowerCase();
          const bn = String(b.Nickname||b.NickName||b["Nick Name"]||"").toLowerCase();
          return an.localeCompare(bn);
        });
        setMembers(filtered);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Reset image-failed flag whenever we load a new bundle/member
  useEffect(() => { setImgFailed(false); }, [bundle?.member]);

  const loadData = async (id) => {
    const [b, p] = await Promise.all([fetchMemberBundle(id), fetchPricing()]);
    const rows = (p?.rows || p?.data || []);
    setBundle(b);
    setPricing(rows);
    const st = computeStatusForMember(b.payments || [], id, rows);
    setStatus(st);
    return { b, rows, status: st };
  };

  const onDetected = async (raw) => {
    const id = String(raw||"").trim();
    if (!id) return;
    setMemberId(id);
    // Open confirm modal immediately so user sees the UI while data loads
    setConfirmOpen(true);
    setResultText("");
    setBundle(null);
    setStatus(null);
  const loaded = await loadData(id);
    const r = loaded?.b?.member || null;
    const freshStatus = loaded?.status;
    const nick = r ? (r.NickName || r.Nickname || r["Nick Name"] || r.nick_name || r.nickname || "Member") : "Member";
    // Check membership status using freshly loaded status
    if (!r || freshStatus?.membershipState !== "active") {
      setResultText(null);
      // modal already open; show result after a tiny pause for UX
      setTimeout(() => {
        setResultText("NO ACTIVE GYM MEMBERSHIP");
      }, 100);
      return;
    }
    // Determine if there's an open entry today (use freshly loaded bundle)
    const todayYMD = new Intl.DateTimeFormat('en-CA', { timeZone: MANILA_TZ, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
    const todays = (loaded?.b?.gymEntries || []).filter(r => {
      const d = r?.Date || r?.date; if (!d) return false; const ymd = new Date(d); const s = new Intl.DateTimeFormat('en-CA', { timeZone: MANILA_TZ, year:'numeric', month:'2-digit', day:'2-digit' }).format(ymd); return s === todayYMD; });
    const open = todays.find(r => !String(r?.TimeOut||"").trim());
    if (open){
      setIsCheckedIn(true);
      setResultText("");
      // If we found an open entry in the freshly loaded bundle, pass it to the modal
      setConfirmInitialEntry(open || null);
      // modal already open; show card to confirm check-out
    } else {
      setIsCheckedIn(false);
      setResultText("");
      setConfirmInitialEntry(null);
      // modal already open; show card to confirm check-in + options
    }
  };

  // Refresh bundle/status when a gym entry for the current member is added/updated elsewhere
  useEffect(() => {
    const handler = async (entry) => {
      try {
        const id = String((entry && (entry.MemberID || entry.memberid || entry.Member)) || '').trim();
        if (!id) return;
        if (!memberId) return;
        if (String(id) !== String(memberId)) return;
        // reload bundle and status for the currently selected member
        await loadData(memberId);
        // clear any initial entry (we'll recompute open row from the fresh bundle)
        setConfirmInitialEntry(null);
      } catch (e) {
        console.debug('CheckIn: gymEntry event handler failed', e);
      }
    };
    const unsub = events.on('gymEntry:added', handler);
    return () => { try { unsub(); } catch(_){} };
  }, [memberId]);

  const confirmCheckIn = async () => {
    if (!bundle || !status) return; // details not loaded yet
    // Optimistic UI: show success immediately and perform the write in background
    const timeStr = new Intl.DateTimeFormat('en-US', { timeZone: MANILA_TZ, month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' }).format(new Date());
    const name = m?.nick || 'Member';
    setResultText(`${name} checked in on ${timeStr}.`);
    setShowToast(true);
    setConfirmOpen(false);
    setComments("");
    setWorkouts("");
    setIsCheckedIn(true);
    // Update local bundle optimistically so UI that reads bundle.gymEntries sees the new row
    // include Coach/Focus/Comments in the optimistic entry (only if provided)
    // capture a stable timestamp to help revert if needed
    const nowIso = new Date().toISOString();
    try {
      setBundle(prev => {
        const opt = { MemberID: memberId, Date: nowIso, TimeIn: nowIso };
        if (status?.coachActive && coach) opt.Coach = coach;
        if (status?.coachActive && focus) opt.Focus = focus;
        if (comments) opt.Comments = comments;
        return { ...(prev || {}), gymEntries: [opt, ...(prev?.gymEntries || [])] };
      });
    } catch (e) { /* ignore optimistic update failure */ }

    // clear any previous toast timer and set a new one
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    // provide an undo window before firing the network call
    const DELAY_MS = 2000;
    // store a cancelable pending write
    if (pendingWriteRef.current && pendingWriteRef.current.timer) {
      clearTimeout(pendingWriteRef.current.timer);
      pendingWriteRef.current = null;
    }
    pendingWriteRef.current = {
      type: 'checkin',
      memberId,
      nowIso,
      aborted: false,
      timer: setTimeout(async () => {
        // if undone, skip
        if (pendingWriteRef.current?.aborted) { pendingWriteRef.current = null; return; }
        try {
          const payload = {};
          if (status?.coachActive && coach) payload.Coach = coach;
          if (status?.coachActive && focus) payload.Focus = focus;
          if (comments) payload.Comments = comments;
          try { await gymQuickAppend(memberId, payload); }
          catch (fastErr) {
            const payload2 = {};
            if (status?.coachActive && coach) payload2.Coach = coach;
            if (status?.coachActive && focus) payload2.Focus = focus;
            if (comments) payload2.Comments = comments;
            await gymClockIn(memberId, payload2);
          }
          // success: clear pending
          pendingWriteRef.current = null;
          // keep toast briefly to show success then clear
          toastTimeout.current = setTimeout(() => { setShowToast(false); setResultText(''); }, 1400);
        } catch (err) {
          console.error('gymClockIn failed', err);
          // show error and revert optimistic change
          setResultText('Check-in failed — please retry');
          setShowToast(true);
          setIsCheckedIn(false);
          setBundle(prev => {
            if (!prev) return prev;
            const filtered = (prev.gymEntries || []).filter(e => !(String(e.MemberID||'') === String(memberId) && String(e.TimeIn||'') === String(nowIso)));
            return { ...prev, gymEntries: filtered };
          });
          pendingWriteRef.current = null;
          toastTimeout.current = setTimeout(() => { setShowToast(false); setResultText(''); }, 4000);
        }
      }, DELAY_MS)
    };
    // show undoable toast for the delay window
    setShowToast(true);
    toastTimeout.current = setTimeout(() => {
      // if pending write still exists, leave toast (it will be cleared after success/failure)
      if (!pendingWriteRef.current) { setShowToast(false); setResultText(''); }
    }, 3500);

  };

  const confirmCheckOut = async () => {
    if (!bundle || !status) return; // details not loaded yet
    // Optimistic UI: update local state immediately
    const timeStr = new Intl.DateTimeFormat('en-US', { timeZone: MANILA_TZ, month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' }).format(new Date());
    const name = m?.nick || 'Member';
    setResultText(`${name} checked out on ${timeStr}.`);
    setShowToast(true);
    setConfirmOpen(false);
    setWorkouts("");
    setComments("");
    setIsCheckedIn(false);
    // Optimistically add TimeOut to the first open entry in bundle.gymEntries
    try {
      setBundle(prev => {
        if (!prev) return prev;
        const entries = (prev.gymEntries || []).slice();
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          const toVal = String(e?.TimeOut || "").trim();
          if (!toVal || toVal === "-" || toVal === "—") {
            entries[i] = { ...e, TimeOut: new Date().toISOString() };
            break;
          }
        }
        return { ...prev, gymEntries: entries };
      });
    } catch (e) { /* ignore optimistic update failure */ }

    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    // undoable check-out: delay network write to allow undo
    const DELAY_MS = 2000;
    if (pendingWriteRef.current && pendingWriteRef.current.timer) {
      clearTimeout(pendingWriteRef.current.timer);
      pendingWriteRef.current = null;
    }
    pendingWriteRef.current = {
      type: 'checkout',
      memberId,
      aborted: false,
      timer: setTimeout(async () => {
        if (pendingWriteRef.current?.aborted) { pendingWriteRef.current = null; return; }
        try {
          try { await gymQuickAppend(memberId, { wantsOut: true, Workouts: workouts }); }
          catch (fastErr) { await gymClockOut(memberId, { Workouts: workouts }); }
          pendingWriteRef.current = null;
          toastTimeout.current = setTimeout(() => { setShowToast(false); setResultText(''); }, 1400);
        } catch (err) {
          console.error('gymClockOut failed', err);
          setResultText('Check-out failed — please retry');
          setShowToast(true);
          setIsCheckedIn(true);
          // revert optimistic change: remove TimeOut we added
          setBundle(prev => {
            if (!prev) return prev;
            const entries = (prev.gymEntries || []).map(e => {
              if (String(e.MemberID||'') === String(memberId) && String(e.TimeOut||'').length > 0) {
                return { ...e, TimeOut: '' };
              }
              return e;
            });
            return { ...prev, gymEntries: entries };
          });
          pendingWriteRef.current = null;
          toastTimeout.current = setTimeout(() => { setShowToast(false); setResultText(''); }, 4000);
        }
      }, DELAY_MS)
    };
    setShowToast(true);
    toastTimeout.current = setTimeout(() => {
      if (!pendingWriteRef.current) { setShowToast(false); setResultText(''); }
    }, 3500);
  };

  const m = useMemo(()=>{
    const r = bundle?.member || null;
    if (!r) return null;
    const get = (keys) => keys.map(k=>r[k]).find(v=>v!==undefined && v!=="");
    const first = get(["FirstName","First","first"]);
    const last = get(["LastName","Last","last"]);
    const nick = get(["NickName","Nickname","Nick Name","nick_name","nickname"]);
    const rawPhoto = get(["PhotoURL","Photo","photo","photo_url"]);
    const photo = driveThumb(driveImg(rawPhoto));
    const memberSince = r.MemberSince || r["Member Since"] || r.Joined || r["Join Date"] || r["join_date"];
    return { first, last, nick, photo, memberSince };
  }, [bundle]);

  return (
    <div className="content">
      <h2 className="dashboard-title">Member Check-In</h2>

      {/* Unified card container for a less bare layout */}
      <div className="card" style={{ marginTop: 8, marginBottom: 12, maxWidth: 480, minHeight: 600, marginLeft:'auto', marginRight:'auto', padding:16, border:'2px solid #d7d9e5', background:'#fff', boxShadow:'0 10px 24px rgba(0,0,0,.12)', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ display:'flex', flexDirection:'column', gap:12, alignItems:'center', width:'100%' }}>
          {/* Top-centered logo to make the card less bare */}
          <img
            src={`${import.meta.env.BASE_URL}favicon.png`}
            onError={(e)=>{ try { e.currentTarget.onerror = null; e.currentTarget.src = `${import.meta.env.BASE_URL}kusgan-logo.png`; } catch(_){} }}
            alt="Kusgan logo"
            style={{ width:250, height:250, objectFit:'contain', opacity:1, marginBottom:8 }}
          />
          <div style={{ maxWidth: 420, width:'100%', margin:'0 auto' }}>
            <button className="primary-btn" style={{ fontSize: '1.1rem', height: 54, width:'100%' }} onClick={()=>setScannerOpen(true)}>
              ▣ Scan QR Code
            </button>
          </div>
          <div style={{ color:'#666', textAlign:'center', marginTop:24 }}>or select a member below</div>
          <div style={{ maxWidth: 420, width:'100%', margin:'0 auto' }}>
            <select value={memberId} onChange={e=>setMemberId(e.target.value)} style={{ width:'100%', height:44, padding:'8px 12px', border:'1px solid #e7e8ef', borderRadius:10 }}>
              <option value="">Select member…</option>
              {members.map(m => (
                <option key={m.MemberID} value={m.MemberID}>
                  {(m.Nickname||m.NickName||m["Nick Name"]||"Member")} — {(m.FirstName||m.First||"")} {(m.LastName||m.Last||"")}
                </option>
              ))}
            </select>
          </div>
          <div style={{ maxWidth: 420, width:'100%', margin:'0 auto' }}>
            <button className="primary-btn" style={{ fontSize: '1.1rem', height: 54, width:'100%' }} onClick={()=>{ if(memberId) onDetected(memberId); }}>
              Proceed
            </button>
          </div>
        </div>
      </div>

      <QrScanModal open={scannerOpen} onClose={()=>setScannerOpen(false)} onDetected={onDetected} />

      <CheckInConfirmModal
        open={confirmOpen}
        memberId={memberId}
        initialEntry={confirmInitialEntry}
        onClose={() => { setConfirmOpen(false); setResultText(''); }}
        onSuccess={() => {
          setConfirmOpen(false);
          setResultText('');
          // refresh local bundle/status if needed
          setBundle(null);
          setStatus(null);
          setConfirmInitialEntry(null);
        }}
      />

      {/* Toast message for check-in */}
      {showToast && (
        <div style={{ position:'fixed', top:24, right:24, zIndex:2000, pointerEvents: pendingWriteRef.current ? 'auto' : 'none' }}>
          <div style={{ display:'flex', gap:12, alignItems:'center', background:'#333', color:'#fff', fontWeight:600, fontSize:16, borderRadius:8, boxShadow:'0 2px 12px rgba(0,0,0,.12)', padding:'10px 14px', minWidth:220, textAlign:'left', letterSpacing:0.1 }}>
            <div style={{ flex: 1 }}>{resultText}</div>
            {pendingWriteRef.current ? (
              <button style={{ background:'transparent', color:'#fff', border:'1px solid rgba(255,255,255,0.18)', padding:'6px 10px', borderRadius:6, cursor:'pointer' }} onClick={() => {
                // Undo handler
                const p = pendingWriteRef.current;
                if (!p) return;
                try {
                  if (p.timer) clearTimeout(p.timer);
                } catch (e) {}
                pendingWriteRef.current = null;
                // revert optimistic changes
                if (p.type === 'checkin') {
                  setIsCheckedIn(false);
                  setBundle(prev => {
                    if (!prev) return prev;
                    const filtered = (prev.gymEntries || []).filter(e => !(String(e.MemberID||'') === String(p.memberId) && String(e.TimeIn||'') === String(p.nowIso)));
                    return { ...prev, gymEntries: filtered };
                  });
                } else if (p.type === 'checkout') {
                  setIsCheckedIn(true);
                  setBundle(prev => {
                    if (!prev) return prev;
                    const entries = (prev.gymEntries || []).map(e => {
                      if (String(e.MemberID||'') === String(p.memberId) && String(e.TimeOut||'').length > 0) {
                        return { ...e, TimeOut: '' };
                      }
                      return e;
                    });
                    return { ...prev, gymEntries: entries };
                  });
                }
                setResultText('Action cancelled');
                setShowToast(true);
                if (toastTimeout.current) clearTimeout(toastTimeout.current);
                toastTimeout.current = setTimeout(() => { setShowToast(false); setResultText(''); }, 1800);
              }}>Undo</button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

const overlayStyle = { position:'fixed', inset:0, background:'rgba(0,0,0,.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 };
const modalStyle = { width:'min(720px, 96vw)', background:'#fff', borderRadius:12, padding:16, border:'1px solid #e7e8ef', boxShadow:'0 6px 24px rgba(0,0,0,.2)' };
