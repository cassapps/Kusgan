import React, { useEffect, useMemo, useState } from 'react';
import RefreshBadge from '../components/RefreshBadge.jsx';
import '../styles.css';
import localCache from '../lib/localCache.js';
import displayName from '../lib/displayName';
import VisitViewModal from '../components/VisitViewModal';
import api from '../api';

const STAFF = [
  'Coach Jojo', 'Coach Elmer', 'Bezza', 'Jeanette', 'Johanna', 'Patpat', 'Sheena', 'Xyza'
];
const MANILA_TZ = 'Asia/Manila';

const fmtTime = (iso) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: MANILA_TZ }).format(d);
  } catch (e) { return String(iso); }
};

const fmtDate = (isoOrYmd) => {
  if (!isoOrYmd) return '';
  try {
    // accept 'YYYY-MM-DD' or ISO timestamp
    const raw = String(isoOrYmd || '');
    let d = null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) d = new Date(raw + 'T00:00:00');
    else d = new Date(raw);
    if (isNaN(d)) return raw.slice(0,10);
    const parts = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: MANILA_TZ }).formatToParts(d);
    const month = parts.find(p => p.type === 'month')?.value || '';
    const day = parts.find(p => p.type === 'day')?.value || '';
    const year = parts.find(p => p.type === 'year')?.value || '';
    return `${month}-${day}, ${year}`;
  } catch (e) { return String(isoOrYmd); }
};

const displayTime = (row) => {
  try {
    const iso = row?.time_in || row?.timeIn || row?.TimeIn || row?.TimeInISO || null;
    const hhmm = row?.TimeIn || row?.time_in_short || null;
    if (iso) return fmtTime(iso);
    const raw = String(row?.TimeIn || row?.time_in || row?.TimeIn || '');
    if (/^\d{1,2}:\d{2}$/.test(raw)) {
      const [hh, mm] = raw.split(':').map(x => Number(x));
      const d = new Date();
      d.setHours(hh, mm, 0, 0);
      return new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: MANILA_TZ }).format(d);
    }
    return raw || '—';
  } catch (e) { return '—'; }
};

const rowDateYMD = (r) => {
  try {
    const rawVal = r?.Date || r?.date || r?.time_in || r?.timeIn || r?.Timestamp || r?.timestamp || r?.TimestampISO || r?.timestampISO || '';
    // handle Firestore-like timestamp objects
    if (rawVal && typeof rawVal === 'object' && (rawVal.seconds || rawVal._seconds)) {
      const secs = rawVal.seconds || rawVal._seconds;
      const d = new Date(secs * 1000);
      return new Intl.DateTimeFormat('en-CA', { timeZone: MANILA_TZ }).format(d);
    }
    const raw = String(rawVal || '').trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.slice(0,10);
    const d = new Date(raw);
    if (!isNaN(d)) return new Intl.DateTimeFormat('en-CA', { timeZone: MANILA_TZ }).format(d);
    return raw.slice(0,10);
  } catch (e) { return ''; }
};

export default function StaffAttendance() {
  const useFirestore = String(import.meta.env.VITE_USE_FIRESTORE ?? 'true') === 'true';
  const [selected, setSelected] = useState('');
  const [rows, setRows] = useState([]);
  const [gymVisits, setGymVisits] = useState([]);
  const [members, setMembers] = useState([]);
  const [selectedVisit, setSelectedVisit] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Helper: determine if a staff is currently signed in for today
  const isSignedInToday = (name) => {
    if (!name) return false;
    const key = String(name).trim().toLowerCase();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: MANILA_TZ }).format(new Date());
    for (const r of rows || []) {
      try {
        const staff = String(r?.Staff || r?.staff || r?.staff_name || '').trim().toLowerCase();
        const dateStr = rowDateYMD(r) || '';
        const tin = String(r?.TimeIn || r?.time_in || r?.timein || '').trim();
        const tout = String(r?.TimeOut || r?.time_out || r?.timeout || '').trim();
        const noOut = tout === '' || tout === '-' || tout === '—' || tout === null || typeof tout === 'undefined';
        if (staff === key && dateStr === today && tin && noOut) return true;
      } catch (e) { /* ignore */ }
    }
    return false;
  };

  const load = async () => {
    setLoading(true); setError('');
    try {
      // load cached rows first for instant UI
      const cached = localCache.getCached('attendance') || [];
      if (cached && cached.length) setRows(cached);

      // then fetch fresh server state and update cache
      const ares = await api.fetchAttendance();
      const json = (ares && (ares.rows || ares.data)) ? (ares.rows || ares.data) : (Array.isArray(ares) ? ares : []);
      const serverRows = Array.isArray(json) ? json : [];
      setRows(serverRows);
      localCache.setCached('attendance', serverRows);
      // also fetch members so we can show nicknames in coaching sessions
      try {
        const mres = await api.fetchMembers();
        const ms = (mres && (mres.rows || mres.data)) ? (mres.rows || mres.data) : (Array.isArray(mres) ? mres : []);
        setMembers(Array.isArray(ms) ? ms : []);
      } catch (e) { /* ignore */ }
      // also load recent gym entries for coaching sessions panel (use shared API helper)
      try {
        const gres = await api.fetchGymEntries();
        const gj = (gres && (gres.rows || gres.data)) ? (gres.rows || gres.data) : (Array.isArray(gres) ? gres : []);
        setGymVisits(Array.isArray(gj) ? gj : []);
      } catch (e) { /* ignore */ }
      // attempt to flush any pending writes
      if (!useFirestore) localCache.processQueue();
    } catch (e) { console.error('load attendance', e); setError('Failed to load attendance'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // today's date in YYYY-MM-DD (Manila) to scope 'On' badges to today only
  const todayYMDManila = new Intl.DateTimeFormat('en-CA', { timeZone: MANILA_TZ }).format(new Date());

  // Coaching sessions UI state
  const COACHES = ['Coach Jojo', 'Coach Elmer'];
  const [selectedCoach, setSelectedCoach] = useState(COACHES[0]);
  const [periods, setPeriods] = useState([]);
  const [selectedPeriodIndex, setSelectedPeriodIndex] = useState(0);

  // derive coach options from gymVisits where possible so dropdown reflects actual data
  const coachOptions = useMemo(() => {
    try {
      const s = new Set();
      (gymVisits || []).forEach(r => {
        const c = String(r?.Coach || r?.coach || '').trim();
        if (c) s.add(c);
      });
      const arr = Array.from(s);
      return arr.length ? arr : COACHES;
    } catch (e) { return COACHES; }
  }, [gymVisits]);

  // ensure selectedCoach is valid when coachOptions change
  useEffect(() => {
    try {
      if (!selectedCoach && coachOptions && coachOptions.length) setSelectedCoach(coachOptions[0]);
      if (selectedCoach && coachOptions && coachOptions.length && !coachOptions.includes(selectedCoach)) {
        setSelectedCoach(coachOptions[0]);
      }
    } catch (e) { /* ignore */ }
  }, [coachOptions]);

  // Generate half-month periods between two dates (inclusive)
  const generateHalfMonthPeriodsBetween = (startDate, endDate) => {
    try {
      if (!startDate || !endDate) return [];
      const s = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      const e = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
      const out = [];
      let cur = new Date(s);
      while (cur <= e) {
        const year = cur.getFullYear();
        const month = cur.getMonth();
        const first = new Date(year, month, 1);
        const mid = new Date(year, month, 15);
        const last = new Date(year, month + 1, 0);
        out.push({
          label: `${first.toLocaleString('en-US', { month: 'short' })} 1-15, ${year}`,
          start: new Intl.DateTimeFormat('en-CA', { timeZone: MANILA_TZ }).format(first),
          end: new Intl.DateTimeFormat('en-CA', { timeZone: MANILA_TZ }).format(mid),
        });
        out.push({
          label: `${first.toLocaleString('en-US', { month: 'short' })} 16-${last.getDate()}, ${year}`,
          start: new Intl.DateTimeFormat('en-CA', { timeZone: MANILA_TZ }).format(new Date(year, month, 16)),
          end: new Intl.DateTimeFormat('en-CA', { timeZone: MANILA_TZ }).format(last),
        });
        // advance to next month
        cur = new Date(year, month + 1, 1);
      }
      // dedupe
      const unique = [];
      for (const p of out) if (!unique.find(u => u.label === p.label)) unique.push(p);
      return unique;
    } catch (e) { return []; }
  };

  // Regenerate periods when gymVisits load; use earliest entry as start
  useEffect(() => {
    try {
      if (!gymVisits || gymVisits.length === 0) {
        // fallback: generate recent periods for usability
        const now = new Date();
        const ps = generateHalfMonthPeriodsBetween(new Date(now.getFullYear(), now.getMonth() - 3, 1), now);
        setPeriods(ps);
        const today = todayYMDManila;
        const idx = ps.findIndex(p => (p.start <= today && p.end >= today));
        if (idx >= 0) setSelectedPeriodIndex(idx);
        return;
      }
      // find earliest date in gymVisits
      let minDate = null;
      for (const r of gymVisits) {
        const ymd = rowDateYMD(r) || '';
        if (!ymd) continue;
        const d = new Date(ymd + 'T00:00:00');
        if (isNaN(d)) continue;
        if (!minDate || d < minDate) minDate = d;
      }
      const now = new Date();
      const start = minDate || new Date(now.getFullYear(), now.getMonth(), 1);
      const ps = generateHalfMonthPeriodsBetween(start, now);
      setPeriods(ps);
      const today = todayYMDManila;
      const idx = ps.findIndex(p => (p.start <= today && p.end >= today));
      if (idx >= 0) setSelectedPeriodIndex(idx);
    } catch (e) {
      // ignore
    }
  }, [gymVisits]);

  const visibleRows = useMemo(() => {
    try {
      const cutoff = (() => { const d = new Date(); d.setDate(d.getDate() - 19); return new Intl.DateTimeFormat('en-CA', { timeZone: MANILA_TZ }).format(d); })();
      return (rows || []).filter(r => {
        const ymd = rowDateYMD(r) || '';
        return ymd && ymd >= cutoff && (r.Staff || r.staff || r.staff_name);
      }).sort((a,b) => {
        const aKey = (rowDateYMD(a) || '0000-00-00') + 'T' + (String(a?.TimeIn || a?.time_in || '00:00'));
        const bKey = (rowDateYMD(b) || '0000-00-00') + 'T' + (String(b?.TimeIn || b?.time_in || '00:00'));
        return bKey.localeCompare(aKey);
      });
    } catch (e) { return []; }
  }, [rows]);

  // Filtered coaching sessions for the selected coach & period
  const coachingSessions = useMemo(() => {
    try {
      if (!periods || periods.length === 0) return [];
      const p = periods[selectedPeriodIndex] || periods[0];
      const start = p?.start || '';
      const end = p?.end || '';
      const filtered = (gymVisits || []).filter(rv => {
        try {
          const coachVal = String(rv?.Coach || rv?.coach || '').trim();
          if (!coachVal) return false;
          if (selectedCoach) {
            const a = coachVal.toLowerCase().replace(/\s+/g, '');
            const b = String(selectedCoach).toLowerCase().replace(/\s+/g, '');
            if (!(a.includes(b) || b.includes(a))) return false;
          }
          const ymd = rowDateYMD(rv) || '';
          if (!ymd) return false;
          return (ymd >= start && ymd <= end);
        } catch (e) { return false; }
      }).sort((a,b) => (String(b?.TimeIn||b?.time_in||'').localeCompare(String(a?.TimeIn||a?.time_in||''))));
      return filtered;
    } catch (e) { return []; }
  }, [gymVisits, periods, selectedCoach, selectedPeriodIndex]);

  const onClock = async () => {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      // Optimistic local update (so UI is instant)
      const isOut = isSignedInToday(selected);
      const now = new Date();
      const iso = now.toISOString();
      const ymd = iso.slice(0, 10);
      const hhmm = iso.slice(11, 16);
      const tempId = 'local-' + Date.now();
      const opt = isOut
        ? { id: tempId, Staff: selected, staff_name: selected, Date: ymd, TimeOut: hhmm, time_out: iso, _localPending: true }
        : { id: tempId, Staff: selected, staff_name: selected, Date: ymd, TimeIn: hhmm, time_in: iso, status: 'On Duty', _localPending: true };
      // update UI + cache
      setRows(prev => [opt, ...((prev || []).filter(r => String(r.id) !== String(opt.id)))]);
      localCache.setCached('attendance', [opt, ...(localCache.getCached('attendance') || [])]);

      // Write using the same client helper pattern as gym entries so writes persist
      // to Firestore when configured (same behavior as gymQuickAppend).
      try {
        if (!isOut && api && typeof api.attendanceQuickAppend === 'function') {
          await api.attendanceQuickAppend(selected, {});
        } else if (api && typeof api.clockIn === 'function' && api && typeof api.clockOut === 'function') {
          if (isOut) await api.clockOut(selected);
          else await api.clockIn(selected);
        } else {
          // As a final fallback, enqueue the legacy /attendance/kiosk request
          localCache.enqueueWrite({ method: 'POST', path: '/attendance/kiosk', body: { staff_name: selected }, tempId: opt.id, collection: 'attendance' });
          await localCache.processQueue();
        }
      } catch (err) {
        // If client-side write fails, fallback to enqueueing the legacy kiosk POST
        console.warn('attendance client write failed, falling back to queue', err && err.message);
        localCache.enqueueWrite({ method: 'POST', path: '/attendance/kiosk', body: { staff_name: selected }, tempId: opt.id, collection: 'attendance' });
        await localCache.processQueue();
      }

      // Refresh authoritative list (Firestone or server) so UI reflects final persisted rows
      await load();
    } catch (e) {
      console.error('kiosk error', e);
      setError(e?.message || 'Action failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="dashboard-content">
      <h2 className="dashboard-title">Staff Attendance <RefreshBadge show={loading && !busy} /></h2>
      <div className="panel">
        <div className="panel-header">Select Staff Member</div>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12 }}>
            <select value={selected} onChange={e => setSelected(e.target.value)} style={{ width: 300, height: 44, padding: '8px 12px', border: '1px solid #e7e8ef', borderRadius: 10, fontSize: 18 }}>
              <option value="">(choose)</option>
              {STAFF.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="primary-btn" onClick={onClock} disabled={!selected || busy}>
              {busy ? 'Processing…' : (selected && isSignedInToday(selected) ? 'Sign Out' : 'Sign In')}
            </button>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">Attendance Records</div>
        {error && <div className="small-error">{error}</div>}
        <div style={{ overflowX: 'auto', padding: 8 }}>
          <table className="attendance-table aligned" style={{ width: '100%' }}>
            <thead>
                <tr>
                <th>Date</th>
                <th>Staff</th>
                <th>Time In</th>
                <th>Time Out</th>
                <th style={{ textAlign: 'center' }}>Total Hours</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)' }}>No records.</td></tr>
              ) : visibleRows.map((r, i) => {
                const ymd = rowDateYMD(r) || '';
                const tinDisp = displayTime(r);
                const toutIso = r?.time_out || r?.TimeOut || r?.timeOut || '';
                const toutDisp = toutIso ? (toutIso.length === 5 ? displayTime({ TimeIn: toutIso }) : fmtTime(toutIso)) : '—';
                const hours = (typeof r?.TotalHours !== 'undefined' && r?.TotalHours !== null) ? String(r?.TotalHours)
                  : (typeof r?.NoOfHours !== 'undefined' && r?.NoOfHours !== null) ? String(r?.NoOfHours)
                  : (typeof r?.hours !== 'undefined' && r?.hours !== null) ? String(r?.hours)
                  : '—';
                // determine if this entry is currently "on" (no sign-out) and is for today
                const toutRaw = String(r?.TimeOut || r?.time_out || r?.timeout || '').trim();
                const noOut = toutRaw === '' || toutRaw === '-' || toutRaw === '—' || toutRaw === 'null' || typeof toutRaw === 'undefined';
                const staffName = String(r?.Staff || r?.staff || r?.staff_name || '');
                const isToday = (rowDateYMD(r) || '') === todayYMDManila;
                return (
                  <tr key={(ymd || '') + '|' + (String(r?.Staff || r?.staff || i))}>
                    <td>{fmtDate(ymd)}</td>
                    <td style={{ fontWeight: 700 }}>
                          {staffName}{noOut && isToday && <span style={{ marginLeft: 8 }} className="status-badge on">On</span>}
                    </td>
                    <td>{tinDisp}</td>
                    <td>{toutDisp}</td>
                    <td style={{ textAlign: 'center' }}>{hours}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Coaching Sessions Panel */}
      <div className="panel" style={{ marginTop: 18 }}>
        <div className="panel-header">Coaching Sessions</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', padding: '8px 0 6px 0' }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Coach</div>
            <select value={selectedCoach} onChange={e => setSelectedCoach(e.target.value)} style={{ width: 260, height: 44, padding: '8px 12px', border: '1px solid #e7e8ef', borderRadius: 10, fontSize: 16 }}>
              {coachOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Period</div>
            <select value={selectedPeriodIndex} onChange={e => setSelectedPeriodIndex(Number(e.target.value))} style={{ width: 260, height: 44, padding: '8px 12px', border: '1px solid #e7e8ef', borderRadius: 10, fontSize: 16 }}>
              {periods.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
            </select>
          </div>
        </div>
        <div style={{ paddingTop: 6, paddingBottom: 12, fontWeight: 700, paddingLeft: 8 }}>Sessions: {coachingSessions?.length || 0}</div>
        <div style={{ overflowX: 'auto', padding: 8 }}>
          <table className="attendance-table aligned" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Nickname</th>
                <th>Time In</th>
                <th>Time Out</th>
                <th style={{ textAlign: 'center' }}>Total Hours</th>
                <th>Focus</th>
              </tr>
            </thead>
            <tbody>
              {!periods || periods.length === 0 ? (
                <tr><td colSpan={6}>No periods</td></tr>
              ) : coachingSessions.length === 0 ? (
                <tr><td colSpan={6}>No sessions for selected coach / period.</td></tr>
              ) : (
                coachingSessions.map((r, i) => {
                  const ymd = rowDateYMD(r) || '';
                  const tin = displayTime(r);
                  const toutIso = r?.time_out || r?.TimeOut || r?.timeOut || '';
                  const tout = toutIso ? (toutIso.length === 5 ? displayTime({ TimeIn: toutIso }) : fmtTime(toutIso)) : '—';
                  const hours = (typeof r?.TotalHours !== 'undefined' && r?.TotalHours !== null) ? String(r?.TotalHours)
                    : (typeof r?.NoOfHours !== 'undefined' && r?.NoOfHours !== null) ? String(r?.NoOfHours)
                    : (typeof r?.TotalHours !== 'undefined' && r?.TotalHours !== null) ? String(r?.TotalHours)
                    : (typeof r?.hours !== 'undefined' && r?.hours !== null) ? String(r?.hours)
                    : '—';
                  // Resolve nickname by looking up members collection (same as Dashboard)
                  const pid = String(r?.MemberID || r?.memberid || r?.member || r?.Member || r?.id || '').trim();
                  const member = (members || []).find(m => String(m?.MemberID || m?.memberid || m?.id || '').trim() === pid) || null;
                  const nick = member ? displayName(member) : (String(r?.NickName || r?.nickname || r?.Member || r?.member || '') || '');
                  return (
                    <tr key={(ymd || '') + '|' + nick + '|' + i} style={{ cursor: 'pointer' }} onClick={() => setSelectedVisit(r)}>
                      <td>{fmtDate(ymd)}</td>
                      <td style={{ fontWeight: 700 }}>{nick}</td>
                      <td>{tin}</td>
                      <td>{tout}</td>
                      <td style={{ textAlign: 'center' }}>{hours}</td>
                      <td>{String(r?.Focus || r?.focus || '')}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {/* Visit detail modal for coaching session rows */}
        <VisitViewModal open={!!selectedVisit} onClose={() => setSelectedVisit(null)} row={selectedVisit} onCheckout={async (entry) => { try { await load(); } catch(e){} setSelectedVisit(null); }} />
      </div>
    </div>
  );
}
