import React, { useEffect, useMemo, useState } from 'react';
import RefreshBadge from '../components/RefreshBadge.jsx';
import '../styles.css';
import localCache from '../lib/localCache.js';
import displayName from '../lib/displayName';
import VisitViewModal from '../components/VisitViewModal';
import api from '../api';
import useLoadMore from '../lib/useLoadMore.js';

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

const monthShort = (monthIndex) => {
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return names[monthIndex] || '';
};

const ymdFromPartsManila = (year, monthIndex0, day) => {
  const mm = String(monthIndex0 + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const d = new Date(`${year}-${mm}-${dd}T00:00:00+08:00`);
  return new Intl.DateTimeFormat('en-CA', { timeZone: MANILA_TZ }).format(d);
};

const ymdToManilaDate = (ymd) => {
  try {
    const s = String(ymd || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    return new Date(s + 'T00:00:00+08:00');
  } catch {
    return null;
  }
};

const lastDayOfMonth = (year, monthIndex0) => new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();

// Half-month periods: 1-15 and 16-(end of month), inclusive.
const generateHalfMonthPeriodsBetween = (startYMD, endYMD) => {
  try {
    const startDate = ymdToManilaDate(startYMD);
    const endDate = ymdToManilaDate(endYMD);
    if (!startDate || !endDate || isNaN(startDate) || isNaN(endDate)) return [];

    const out = [];
    let year = startDate.getFullYear();
    let month = startDate.getMonth();
    // start at the month of startDate
    while (true) {
      const ld = lastDayOfMonth(year, month);
      const mName = monthShort(month);
      out.push({
        label: `${mName} 1-15, ${year}`,
        start: ymdFromPartsManila(year, month, 1),
        end: ymdFromPartsManila(year, month, 15),
      });
      out.push({
        label: `${mName} 16-${ld}, ${year}`,
        start: ymdFromPartsManila(year, month, 16),
        end: ymdFromPartsManila(year, month, ld),
      });

      // advance month
      const next = new Date(Date.UTC(year, month + 1, 1));
      year = next.getUTCFullYear();
      month = next.getUTCMonth();

      const nextMonthStart = ymdToManilaDate(ymdFromPartsManila(year, month, 1));
      if (!nextMonthStart || nextMonthStart > endDate) break;
    }

    // Filter to only those that overlap [startYMD, endYMD]
    const filtered = out.filter((p) => p.end >= startYMD && p.start <= endYMD);
    // Sort newest first
    filtered.sort((a, b) => b.start.localeCompare(a.start));
    return filtered;
  } catch {
    return [];
  }
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

  // Helper: staff already clocked in today (regardless of clock-out)
  const hasClockedInToday = (name) => {
    if (!name) return false;
    const key = String(name).trim().toLowerCase().replace(/\s+/g, '');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: MANILA_TZ }).format(new Date());
    for (const r of rows || []) {
      try {
        const staff = String(r?.Staff || r?.staff || r?.staff_name || '').trim().toLowerCase().replace(/\s+/g, '');
        const dateStr = rowDateYMD(r) || '';
        const tin = String(r?.TimeIn || r?.time_in || r?.timein || '').trim();
        if (staff === key && dateStr === today && tin) return true;
      } catch (e) { /* ignore */ }
    }
    return false;
  };

  const isOpenEntry = (r) => {
    const tout = String(r?.TimeOut || r?.time_out || r?.timeout || '').trim();
    return tout === '' || tout === '-' || tout === '—' || tout === 'null' || typeof tout === 'undefined';
  };

  const load = async () => {
    setLoading(true); setError('');
    try {
      // load cached rows first for instant UI
      const cached = localCache.getCached('attendance') || [];
      if (cached && cached.length) setRows(cached);

      // then fetch fresh server state and update cache
      const ares = useFirestore ? await api.fetchAttendanceSince({ days: 30, limit: 2000 }) : await api.fetchAttendance();
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
        const gres = useFirestore ? await api.fetchGymEntriesSince({ days: 180, limit: 6000 }) : await api.fetchGymEntries();
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

  const availableStaffForClockIn = useMemo(() => {
    try {
      return STAFF.filter((s) => !hasClockedInToday(s));
    } catch {
      return STAFF;
    }
  }, [rows]);

  // if selection becomes invalid (e.g., they just clocked in), clear it
  useEffect(() => {
    if (!selected) return;
    if (!availableStaffForClockIn.includes(selected)) setSelected('');
  }, [availableStaffForClockIn, selected]);

  // Collapse controls (match Reports UX)
  const [attCollapsed, setAttCollapsed] = useState(true);
  const [coachCollapsed, setCoachCollapsed] = useState(true);

  // Shared half-month periods for both tables
  const [periods, setPeriods] = useState([]);
  const [attPeriodIndex, setAttPeriodIndex] = useState(0);
  const [coachPeriodIndex, setCoachPeriodIndex] = useState(0);

  // Coaching sessions UI state
  const COACHES = ['Coach Jojo', 'Coach Elmer'];
  const [selectedCoach, setSelectedCoach] = useState(COACHES[0]);

  // Attendance table filter state
  const [attStaffFilter, setAttStaffFilter] = useState('');

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

  // Build shared periods list (based on earliest available date; fallback to previous-month second-half)
  useEffect(() => {
    try {
      const today = todayYMDManila;
      let minYMD = '';
      const consider = (r) => {
        const ymd = rowDateYMD(r) || '';
        if (!ymd) return;
        if (!minYMD || ymd < minYMD) minYMD = ymd;
      };
      (rows || []).forEach(consider);
      (gymVisits || []).forEach(consider);

      if (!minYMD) {
        const now = new Date();
        const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 16));
        const prevY = prev.getUTCFullYear();
        const prevM = prev.getUTCMonth();
        minYMD = ymdFromPartsManila(prevY, prevM, 16);
      } else {
        const d = ymdToManilaDate(minYMD);
        if (d) {
          const y = d.getFullYear();
          const m = d.getMonth();
          const day = d.getDate();
          minYMD = (day <= 15) ? ymdFromPartsManila(y, m, 1) : ymdFromPartsManila(y, m, 16);
        }
      }

      const ps = generateHalfMonthPeriodsBetween(minYMD, today);
      setPeriods(ps);

      const curIdx = ps.findIndex((p) => p.start <= today && p.end >= today);
      const idx = curIdx >= 0 ? curIdx : 0;
      setAttPeriodIndex((v) => (Number.isFinite(v) && v >= 0 && v < ps.length ? v : idx));
      setCoachPeriodIndex((v) => (Number.isFinite(v) && v >= 0 && v < ps.length ? v : idx));
    } catch {
      // ignore
    }
  }, [rows, gymVisits]);

  const attendanceStaffOptions = useMemo(() => {
    try {
      const s = new Set();
      (rows || []).forEach((r) => {
        const name = String(r?.Staff || r?.staff || r?.staff_name || '').trim();
        if (name) s.add(name);
      });
      const arr = Array.from(s);
      return arr.length ? arr : STAFF;
    } catch {
      return STAFF;
    }
  }, [rows]);

  const attendanceRows = useMemo(() => {
    try {
      if (!periods || periods.length === 0) return [];
      const p = periods[attPeriodIndex] || periods[0];
      const start = p?.start || '';
      const end = p?.end || '';
      const staffFilter = String(attStaffFilter || '').trim();
      const staffKey = staffFilter ? staffFilter.toLowerCase().replace(/\s+/g, '') : '';
      return (rows || []).filter((r) => {
        const ymd = rowDateYMD(r) || '';
        if (!ymd || ymd < start || ymd > end) return false;
        const staffName = String(r?.Staff || r?.staff || r?.staff_name || '').trim();
        if (!staffName) return false;
        if (!staffKey) return true;
        const sKey = staffName.toLowerCase().replace(/\s+/g, '');
        return sKey.includes(staffKey) || staffKey.includes(sKey);
      }).sort((a, b) => {
        const aKey = (rowDateYMD(a) || '0000-00-00') + 'T' + (String(a?.TimeIn || a?.time_in || '00:00'));
        const bKey = (rowDateYMD(b) || '0000-00-00') + 'T' + (String(b?.TimeIn || b?.time_in || '00:00'));
        return bKey.localeCompare(aKey);
      });
    } catch {
      return [];
    }
  }, [rows, periods, attPeriodIndex, attStaffFilter]);

  const attendancePager = useLoadMore(attendanceRows, { initial: 20, step: 20, resetDeps: [attStaffFilter, attPeriodIndex, attCollapsed, attendanceRows.length] });

  // Filtered coaching sessions for the selected coach & period
  const coachingSessions = useMemo(() => {
    try {
      if (!periods || periods.length === 0) return [];
      const p = periods[coachPeriodIndex] || periods[0];
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
  }, [gymVisits, periods, selectedCoach, coachPeriodIndex]);

  const coachingPager = useLoadMore(coachingSessions, { initial: 20, step: 20, resetDeps: [selectedCoach, coachPeriodIndex, coachCollapsed, coachingSessions.length] });

  const onClockIn = async () => {
    if (!selected) return;
    if (hasClockedInToday(selected)) {
      setSelected('');
      setError('This staff member already clocked in today.');
      return;
    }
    setBusy(true); setError('');
    try {
      // Optimistic local update (so UI is instant)
      const now = new Date();
      const iso = now.toISOString();
      const ymd = todayYMDManila;
      const tempId = 'local-' + Date.now();
      const opt = { id: tempId, Staff: selected, staff_name: selected, Date: ymd, TimeIn: iso, time_in: iso, status: 'On Duty', _localPending: true };
      // update UI + cache
      setRows(prev => [opt, ...((prev || []).filter(r => String(r.id) !== String(opt.id)))]);
      localCache.setCached('attendance', [opt, ...(localCache.getCached('attendance') || [])]);

      // Write using the same client helper pattern as gym entries so writes persist
      // to Firestore when configured (same behavior as gymQuickAppend).
      try {
        if (api && typeof api.attendanceQuickAppend === 'function') {
          await api.attendanceQuickAppend(selected, {});
        } else if (api && typeof api.clockIn === 'function') {
          await api.clockIn(selected);
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
      setSelected('');
    } catch (e) {
      console.error('kiosk error', e);
      setError(e?.message || 'Action failed');
    } finally { setBusy(false); }
  };

  const onClockOut = async (staffName) => {
    const staff = String(staffName || selected || '').trim();
    if (!staff) return;
    setBusy(true); setError('');
    try {
      if (api && typeof api.clockOut === 'function') {
        await api.clockOut(staff);
      } else {
        localCache.enqueueWrite({ method: 'POST', path: '/attendance/kiosk', body: { staff_name: staff }, tempId: 'local-out-' + Date.now(), collection: 'attendance' });
        await localCache.processQueue();
      }
      await load();
    } catch (e) {
      console.error('clock out error', e);
      setError(e?.message || 'Clock out failed');
    } finally {
      setBusy(false);
    }
  };

  const todayAttendance = useMemo(() => {
    try {
      const today = todayYMDManila;
      return (rows || []).filter((r) => {
        const ymd = rowDateYMD(r) || '';
        const staffName = String(r?.Staff || r?.staff || r?.staff_name || '').trim();
        const tin = String(r?.TimeIn || r?.time_in || r?.timein || '').trim();
        return staffName && tin && ymd === today;
      }).sort((a, b) => {
        const aKey = String(a?.TimeIn || a?.time_in || '');
        const bKey = String(b?.TimeIn || b?.time_in || '');
        return bKey.localeCompare(aKey);
      });
    } catch {
      return [];
    }
  }, [rows, todayYMDManila]);

  const computeHours = (r) => {
    const existing = (typeof r?.TotalHours !== 'undefined' && r?.TotalHours !== null) ? r.TotalHours
      : (typeof r?.NoOfHours !== 'undefined' && r?.NoOfHours !== null) ? r.NoOfHours
      : (typeof r?.hours !== 'undefined' && r?.hours !== null) ? r.hours
      : null;
    if (existing !== null) return String(existing);
    try {
      const tin = r?.time_in || r?.timeIn || r?.TimeIn || null;
      const tout = r?.time_out || r?.timeOut || r?.TimeOut || null;
      if (!tin || !tout) return '—';
      const a = new Date(tin);
      const b = new Date(tout);
      if (isNaN(a) || isNaN(b)) return '—';
      const hrs = (b.getTime() - a.getTime()) / (1000 * 60 * 60);
      if (!isFinite(hrs) || hrs < 0) return '—';
      const v = Math.round(hrs * 100) / 100;
      return String(v);
    } catch {
      return '—';
    }
  };

  return (
    <div className="dashboard-content">
      <h2 className="dashboard-title">Staff Attendance <RefreshBadge show={loading && !busy} /></h2>
      <div className="panel">
        <div className="panel-header">Select Staff Member</div>
        {error && <div className="small-error">{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12, flexWrap: 'wrap' }}>
            <select value={selected} onChange={e => setSelected(e.target.value)} style={{ width: 300, height: 44, padding: '8px 12px', border: '1px solid #e7e8ef', borderRadius: 10, fontSize: 16 }}>
              <option value="">(choose)</option>
              {availableStaffForClockIn.length === 0 ? (
                <option value="" disabled>All staff already clocked in today</option>
              ) : (
                availableStaffForClockIn.map(s => <option key={s} value={s}>{s}</option>)
              )}
            </select>
            <button className="primary-btn" onClick={onClockIn} disabled={!selected || busy || availableStaffForClockIn.length === 0}>
              {busy ? 'Processing…' : 'Clock In'}
            </button>
          </div>
        </div>

        <div style={{ overflowX: 'auto', padding: 8 }}>
          <table className="attendance-table aligned" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Staff</th>
                <th>Time In</th>
                <th>Time Out</th>
                <th style={{ textAlign: 'center' }}>Total Hours</th>
                <th style={{ textAlign: 'center' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {todayAttendance.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)' }}>No attendance records for today.</td></tr>
              ) : todayAttendance.map((r, i) => {
                const staffName = String(r?.Staff || r?.staff || r?.staff_name || '').trim();
                const tin = displayTime(r);
                const toutIso = r?.time_out || r?.TimeOut || r?.timeOut || '';
                const tout = toutIso ? (toutIso.length === 5 ? displayTime({ TimeIn: toutIso }) : fmtTime(toutIso)) : '—';
                const open = isOpenEntry(r);
                return (
                  <tr key={(String(r?.id || '') || (todayYMDManila + '|' + staffName + '|' + i))}>
                    <td style={{ fontWeight: 700 }}>{staffName}</td>
                    <td>{tin}</td>
                    <td>{tout}</td>
                    <td style={{ textAlign: 'center' }}>{computeHours(r)}</td>
                    <td style={{ textAlign: 'center' }}>
                      {open ? (
                        <button className="button" type="button" disabled={busy} onClick={() => onClockOut(staffName)}>
                          Clock Out
                        </button>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span>Attendance Records</span>
          <div style={{ display: 'inline-flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="button" type="button" onClick={() => setAttCollapsed(v => !v)} style={{ background: '#eee', color: '#333' }}>
              {attCollapsed ? 'Expand' : 'Collapse'}
            </button>
            <select value={attStaffFilter} onChange={(e) => setAttStaffFilter(e.target.value)} style={{ height: 44, padding: '8px 12px', border: '1px solid #e7e8ef', borderRadius: 10, fontSize: 16, minWidth: 220 }}>
              <option value="">All Staff</option>
              {attendanceStaffOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select value={attPeriodIndex} onChange={(e) => setAttPeriodIndex(Number(e.target.value))} style={{ height: 44, padding: '8px 12px', border: '1px solid #e7e8ef', borderRadius: 10, fontSize: 16, minWidth: 220 }}>
              {(periods || []).map((p, i) => (
                <option key={p.label} value={i}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>
        {/* error shown in top panel */}
        {!attCollapsed && (
          <>
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
                  {attendancePager.visible.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)' }}>No records.</td></tr>
                  ) : attendancePager.visible.map((r, i) => {
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
            {attendancePager.canLoadMore && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8, paddingRight: 8 }}>
                <button className="load-more-link" type="button" onClick={attendancePager.loadMore}>
                  Load 20 more
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Coaching Sessions Panel */}
      <div className="panel" style={{ marginTop: 18 }}>
        <div className="panel-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span>Coaching Sessions</span>
          <div style={{ display: 'inline-flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="button" type="button" onClick={() => setCoachCollapsed(v => !v)} style={{ background: '#eee', color: '#333' }}>
              {coachCollapsed ? 'Expand' : 'Collapse'}
            </button>
            <select value={selectedCoach} onChange={(e) => setSelectedCoach(e.target.value)} style={{ height: 44, padding: '8px 12px', border: '1px solid #e7e8ef', borderRadius: 10, fontSize: 16, minWidth: 220 }}>
              {coachOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={coachPeriodIndex} onChange={(e) => setCoachPeriodIndex(Number(e.target.value))} style={{ height: 44, padding: '8px 12px', border: '1px solid #e7e8ef', borderRadius: 10, fontSize: 16, minWidth: 220 }}>
              {(periods || []).map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
            </select>
          </div>
        </div>

        {!coachCollapsed && (
          <>
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
                  ) : coachingPager.visible.length === 0 ? (
                    <tr><td colSpan={6}>No sessions for selected coach / period.</td></tr>
                  ) : (
                    coachingPager.visible.map((r, i) => {
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
            {coachingPager.canLoadMore && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8, paddingRight: 8 }}>
                <button className="load-more-link" type="button" onClick={coachingPager.loadMore}>
                  Load 20 more
                </button>
              </div>
            )}
          </>
        )}
        {/* Visit detail modal for coaching session rows */}
        <VisitViewModal open={!!selectedVisit} onClose={() => setSelectedVisit(null)} row={selectedVisit} onCheckout={async (entry) => { try { await load(); } catch(e){} setSelectedVisit(null); }} />
      </div>
    </div>
  );
}
