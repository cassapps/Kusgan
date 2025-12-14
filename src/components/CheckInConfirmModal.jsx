import React, { useEffect, useState, useRef } from 'react';
import api from '../api';
const { fetchMemberBundle, fetchPricing, gymQuickAppend, gymClockOut, upsertGymEntry, gymClockIn, fetchMemberByIdFresh } = api;
import events from '../lib/events';
import { computeStatusForMember } from '../lib/membership';
import ModalWrapper from './ModalWrapper';
import { normalizeNickname } from '../lib/nickname.js';
// small helpers
const MANILA_TZ = 'Asia/Manila';
const fmtDate = (d) => {
  if (!d) return '-';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date)) return '-';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: MANILA_TZ, month: 'short', day: 'numeric', year: 'numeric' }).formatToParts(date);
  const m = parts.find(p => p.type === 'month')?.value || '';
  const day = parts.find(p => p.type === 'day')?.value || '';
  const y = parts.find(p => p.type === 'year')?.value || '';
  return `${m}-${day}, ${y}`;
};

const driveId = (u) => {
  const s = String(u || '');
  const m = s.match(/(?:\/file\/d\/|[?&]id=|\/uc\?[^#]*id=)([^/&?#]+)/);
  return m && m[1] ? m[1] : '';
};
const driveImg = (u) => {
  const s = String(u || '');
  if (!s) return '';
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
  const s = String(u || '');
  if (/googleusercontent\.com\//.test(s)) return s;
  const id = driveId(s);
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w1000` : s;
};

// membership detection now uses shared helper in src/lib/membership

export default function CheckInConfirmModal({ open, onClose, memberId, initialEntry = null, onSuccess, status: statusProp = null, mode = null }) {
  const [bundle, setBundle] = useState(null);
  const [pricing, setPricing] = useState([]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [workouts, setWorkouts] = useState('');
  const [comments, setComments] = useState('');
  const [coach, setCoach] = useState('');
  const [focus, setFocus] = useState('');
  const [isCheckedIn, setIsCheckedIn] = useState(false);
  const [busy, setBusy] = useState(false);

  const COACHES = ["Coach Elmer", "Coach Jojo", "None"];
  const FOCUSES = ["Full body", "Upper body", "Lower body", "Chest", "Other"];

  useEffect(() => {
    let alive = true;
    if (!open || !memberId) return;
    (async () => {
      setLoading(true);
      try {
        console.debug('[CheckInConfirmModal] loading bundle for', memberId);
        const [b, p] = await Promise.all([fetchMemberBundle(memberId), fetchPricing()]);
        if (!alive) return;
        // If the bundle didn't return a member (sometimes sheet lookups miss due to header/value shape),
        // try a fresh authoritative single-row fetch as a fallback so the modal can still show member info.
        if (b && !b.member) {
          try {
            console.debug('[CheckInConfirmModal] bundle missing member, trying fetchMemberByIdFresh', memberId);
            const fresh = await fetchMemberByIdFresh(memberId);
            if (fresh) {
              b.member = fresh;
            }
          } catch (e) {
            console.debug('[CheckInConfirmModal] fetchMemberByIdFresh fallback failed', e);
          }
        }
        setBundle(b);
        const rows = (p?.rows || p?.data || []);
        setPricing(rows);
        // Prefer status passed from parent (authoritative). Fallback to computing via shared helper.
        const st = statusProp || computeStatusForMember(b?.payments || [], memberId, rows);
        setStatus(st);
        // Determine if there's an open entry today
        const todayYMD = new Intl.DateTimeFormat('en-CA', { timeZone: MANILA_TZ, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
        const todays = (b?.gymEntries || []).filter(r => {
          const d = r?.Date || r?.date; if (!d) return false; const ymd = new Date(d); const s = new Intl.DateTimeFormat('en-CA', { timeZone: MANILA_TZ, year:'numeric', month:'2-digit', day:'2-digit' }).format(ymd); return s === todayYMD; });
        const openEntry = todays.find(r => !String(r?.TimeOut||r?.timeout||'').trim());
        // if caller passed an initialEntry, prefer that entry's open status when it refers to today
        let initialOpen = false;
        if (initialEntry) {
          const d = initialEntry.Date || initialEntry.date || '';
          if (d) {
            const ymd = new Date(d);
            const s = new Intl.DateTimeFormat('en-CA', { timeZone: MANILA_TZ, year:'numeric', month:'2-digit', day:'2-digit' }).format(ymd);
            if (s === todayYMD && !String(initialEntry.TimeOut||'').trim()) initialOpen = true;
          }
        }
        // Determine checked state, but allow caller to force mode ('in' or 'out')
        let checked = !!openEntry || initialOpen;
        if (mode === 'in') checked = false;
        if (mode === 'out') checked = true;
        setIsCheckedIn(checked);
        // If checked in, prefill editable fields from the authoritative open row (prefer initialEntry)
        const source = (mode === 'out' ? (initialOpen ? initialEntry : (openEntry || null)) : (initialOpen ? initialEntry : (openEntry || null)));
        if (checked && source) {
          const src = source || {};
          setWorkouts(String(src.Workouts ?? src.workouts ?? src.Done ?? '').trim());
          setComments(String(src.Comments ?? src.comments ?? src.Notes ?? '').trim());
          setCoach(String(src.Coach ?? src.coach ?? '') || '');
          setFocus(String(src.Focus ?? src.focus ?? '') || '');
        } else {
          // fresh check-in: clear fields
          setWorkouts('');
          setComments('');
          setCoach('');
          setFocus('');
        }
      } catch (e) {
        try { console.debug('[CheckInConfirmModal] load error', e); events.emit('modal:error', { message: 'Failed to load check-in data', source: 'CheckInConfirmModal', error: String(e) }); } catch (ee) {}
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  // Depend on identifying fields of initialEntry instead of whole object to avoid
  // rerunning the effect when the prop reference changes but meaningful data hasn't.
  }, [open, memberId, initialEntry?.rowNumber, initialEntry?.Date, initialEntry?.TimeIn, statusProp]);

  const m = bundle?.member || null;

  const confirmCheckOut = async () => {
    if (!memberId) return;
    setBusy(true);
    try {
      // If initialEntry points to a same-day open row, prefer to upsert that row (update TimeOut) rather than append
      if (initialEntry) {
        const d = initialEntry.Date || initialEntry.date || '';
        const todayYMD = new Intl.DateTimeFormat('en-CA', { timeZone: MANILA_TZ, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
        const entryYMD = d ? new Date(d) : null;
        const entryYMDstr = entryYMD ? new Intl.DateTimeFormat('en-CA', { timeZone: MANILA_TZ, year:'numeric', month:'2-digit', day:'2-digit' }).format(entryYMD) : '';
        const hasTimeOut = String(initialEntry.TimeOut || initialEntry.timeout || '').trim();
        if (entryYMDstr === todayYMD && !hasTimeOut) {
          // ask server to upsert (update) this gym entry's TimeOut targeting the exact TimeIn if available
          const nowIso = new Date().toISOString();
          try {
            // try to pass identifying info (TimeIn and Date) so server updates the exact row
            const timeInValue = initialEntry.TimeIn || initialEntry.Timein || initialEntry.timeIn || initialEntry.timein || null;
            const dateValue = initialEntry.Date || initialEntry.date || null;
            const payload = { memberId, timeOut: nowIso, Workouts: workouts, Comments: comments };
            try { console.debug('[CheckInConfirmModal] upsert payload', payload); } catch(e){}
            if (status?.coachActive) {
              if (coach && coach !== 'None') payload.Coach = coach;
              if (focus) payload.Focus = focus;
            }
            if (timeInValue) payload.TimeIn = timeInValue;
            if (dateValue) payload.Date = dateValue;
            // also allow passing explicit rowNumber if present
            if (initialEntry.rowNumber) payload.rowNumber = initialEntry.rowNumber;
            const res = await upsertGymEntry(payload);
            // Emit an event so other views refresh (Dashboard, MemberDetail, Members list)
            try { console.debug('[CheckInConfirmModal] upsertGymEntry res', res); } catch(e){}
            try { events.emit('gymEntry:added', { MemberID: memberId, ...(res || {}), Workouts: workouts, Comments: comments }); } catch (e) { /* ignore */ }
            setBusy(false);
            onSuccess && onSuccess();
            onClose && onClose();
            return;
          } catch (err) {
            try { events.emit('modal:error', { message: 'Failed to upsert gym entry', source: 'CheckInConfirmModal', error: String(err) }); } catch (ee) {}
          }
        }
      }

      // Fallback: try the fast quick-append with wantsOut which may update server-side open row, else gymClockOut
      try {
        const extra = { wantsOut: true, Workouts: workouts, Comments: comments };
        if (status?.coachActive) {
          if (coach && coach !== 'None') extra.Coach = coach;
          if (focus) extra.Focus = focus;
        }
        if (initialEntry) {
          const timeInValue = initialEntry.TimeIn || initialEntry.Timein || initialEntry.timeIn || initialEntry.timein || null;
          const dateValue = initialEntry.Date || initialEntry.date || null;
          if (timeInValue) extra.TimeIn = timeInValue;
          if (dateValue) extra.Date = dateValue;
          if (initialEntry.rowNumber) extra.rowNumber = initialEntry.rowNumber;
        }
        try { console.debug('[CheckInConfirmModal] gymQuickAppend extra', extra); } catch (e) {}
        await gymQuickAppend(memberId, extra);
      }
      catch (err) { 
        const extra2 = { Workouts: workouts, Comments: comments };
        if (initialEntry) { if (initialEntry.TimeIn) extra2.TimeIn = initialEntry.TimeIn; if (initialEntry.Date) extra2.Date = initialEntry.Date; if (initialEntry.rowNumber) extra2.rowNumber = initialEntry.rowNumber; }
        if (status?.coachActive) { if (coach && coach !== 'None') extra2.Coach = coach; if (focus) extra2.Focus = focus; }
        try { console.debug('[CheckInConfirmModal] gymQuickAppend failed, falling back to gymClockOut', extra2, err); } catch (e) {}
        await gymClockOut(memberId, extra2); 
      }

      // Best-effort emit to trigger refreshes in callers that watch gymEntry:added
      try { events.emit('gymEntry:added', { MemberID: memberId, Workouts: workouts, Comments: comments }); } catch (e) { /* ignore */ }

      setBusy(false);
      onSuccess && onSuccess();
      onClose && onClose();
      } catch (e) {
        try { events.emit('modal:error', { message: 'Checkout failed', source: 'CheckInConfirmModal', error: String(e) }); } catch (ee) {}
        setBusy(false);
        // keep modal open to allow retry
      }
  };

  const confirmCheckIn = async () => {
    if (!memberId) return;
    setBusy(true);
    try {
      const extra = { Workouts: workouts, Comments: comments };
      // include Coach and Focus when present
      if (status?.coachActive) {
        // normalize "None" to empty coach value if selected
        if (coach && coach !== 'None') extra.Coach = coach;
        if (focus) extra.Focus = focus;
      }
      try {
        await gymQuickAppend(memberId, extra);
      } catch (err) {
        // fallback to explicit clock-in endpoint
        await gymClockIn(memberId, extra);
      }
      setBusy(false);
      onSuccess && onSuccess();
      onClose && onClose();
    } catch (e) {
      try { events.emit('modal:error', { message: 'Checkin failed', source: 'CheckInConfirmModal', error: String(e) }); } catch (ee) {}
      setBusy(false);
      // leave modal open for retry
    }
  };

  if (!open) return null;
  return (
  <ModalWrapper open={open} onClose={onClose} width={720} noInternalScroll={true}>
        {loading ? (
          <div style={{ padding:24 }}>Loading…</div>
        ) : m ? (
          <>
            <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:16, alignItems:'center' }}>
              <div style={{ width:150, height:200, borderRadius:12, overflow:'hidden', border:'1px solid #e7e8ef', background:'#fafbff' }}>
                {m.PhotoURL || m.Photo ? (<img src={driveThumb(driveImg(m.PhotoURL||m.Photo))} alt="Member" style={{ width:'100%', height:'100%', objectFit:'cover' }} />) : (<div style={{ display:'flex', width:'100%', height:'100%', alignItems:'center', justifyContent:'center', color:'#999' }}>No Photo</div>)}
              </div>
              <div>
                <div style={{ fontWeight:900, fontSize:28, lineHeight:1.1 }}>{normalizeNickname(m.NickName || m.Nickname || '') || '-'}</div>
                <div style={{ fontWeight:700, fontSize:18, color:'#444', marginTop:4 }}>{[m.FirstName,m.LastName].filter(Boolean).join(' ') || '-'}</div>
                <div style={{ fontStyle:'italic', color:'#666', marginTop:8 }}>Member Since</div>
                <div style={{ fontWeight:800, fontSize:16 }}>{fmtDate(m.MemberSince || m['Member Since'] || m.Joined || m['Join Date'])}</div>
              </div>
            </div>

            <div className="status-tiles" style={{ marginTop:14 }}>
              <div className={`status-tile ${status?.membershipState == null ? 'none' : status.membershipState}`}>
                <div className="title">Gym Membership</div>
                <div style={{ marginBottom:10 }}>{status?.membershipState === 'active' ? <span className="pill ok">Active</span> : (status?.membershipState === 'expired' ? <span className="pill bad">Expired</span> : <span className="pill">None</span>)}</div>
                <div className="label">Valid until</div>
                <div className="value">{fmtDate(status?.membershipEnd)}</div>
              </div>
              <div className={`status-tile ${status?.coachActive ? 'active' : (status?.coachEnd ? 'expired' : 'none')}`}>
                <div className="title">Coach Subscription</div>
                <div style={{ marginBottom:10 }}>{status?.coachActive ? <span className="pill ok">Active</span> : (status?.coachEnd ? <span className="pill bad">Expired</span> : <span className="pill">None</span>)}</div>
                <div className="label">Valid until</div>
                <div className="value">{fmtDate(status?.coachEnd)}</div>
              </div>
            </div>

            {isCheckedIn && (
              <div>
                {status?.coachActive ? (
                  <>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginTop:14 }}>
                      <div className="field">
                        <label className="label">Coach</label>
                        <select value={coach} onChange={e=>setCoach(e.target.value)}>
                          <option value="">(Select)</option>
                          {COACHES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div className="field">
                        <label className="label">Workout Focus</label>
                        <select value={focus} onChange={e=>setFocus(e.target.value)}>
                          <option value="">(none)</option>
                          {FOCUSES.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="field" style={{ marginTop:16 }}>
                      <label className="label">Workouts Done</label>
                      <textarea value={workouts} onChange={e=>setWorkouts(e.target.value)} placeholder="Describe workouts done (optional)" style={{ width:'100%', minHeight:48, borderRadius:8, border:'1px solid #e7e8ef', padding:'8px 12px', fontSize:15, resize:'vertical' }} />
                    </div>
                  </>
                ) : (
                  <div className="field" style={{ marginTop:16 }}>
                    <label className="label">Workouts Done</label>
                    <textarea value={workouts} onChange={e=>setWorkouts(e.target.value)} placeholder="Describe workouts done (optional)" style={{ width:'100%', minHeight:48, borderRadius:8, border:'1px solid #e7e8ef', padding:'8px 12px', fontSize:15, resize:'vertical' }} />
                  </div>
                )}
              </div>
            )}
            {!isCheckedIn && (
              <div>
                {/* When member has coach subscription, require selecting Coach and Focus before check-in */}
                {status?.coachActive && (
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginTop:14 }}>
                    <div className="field">
                      <label className="label">Coach</label>
                      <select value={coach} onChange={e=>setCoach(e.target.value)}>
                        <option value="">(Select)</option>
                        {COACHES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label className="label">Workout Focus</label>
                      <select value={focus} onChange={e=>setFocus(e.target.value)}>
                        <option value="">(none)</option>
                        {FOCUSES.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Comments should be editable for both check-in and check-out and always written to the Comments column */}
            <div className="field" style={{ marginTop:16 }}>
              <label className="label">Comments</label>
              <textarea value={comments} onChange={e=>setComments(e.target.value)} placeholder="Add comments (optional)" style={{ width:'100%', minHeight:48, borderRadius:8, border:'1px solid #e7e8ef', padding:'8px 12px', fontSize:15, resize:'vertical' }} />
            </div>

            <div style={{ marginTop:12, color:'#b91c1c', fontSize:13 }}>
              {(!isCheckedIn && status?.membershipState !== 'active') && (
                <div style={{ marginBottom:8 }}>Cannot check in: gym membership is not active.</div>
              )}
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', marginTop:16 }}>
              {isCheckedIn ? (
                  <button className="primary-btn" onClick={confirmCheckOut} disabled={busy || (status?.coachActive && (!coach || !focus))}>{busy ? 'Checking out…' : 'Confirm Check-Out'}</button>
                ) : (
                  <button
                    className="primary-btn"
                    onClick={confirmCheckIn}
                    disabled={
                      busy ||
                      // Require active gym membership to check in
                      (status?.membershipState !== 'active') ||
                      // If coach subscription active, require coach and focus
                      (status?.coachActive && (!coach || !focus))
                    }
                  >
                    {busy ? 'Checking in…' : 'Confirm Check-In'}
                  </button>
                )}
            </div>
          </>
        ) : (
          <div style={{ padding:24 }}>Member not found.</div>
        )}
    </ModalWrapper>
  );
}
