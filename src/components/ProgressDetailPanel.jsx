import React, { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getMemberById, getMemberProgress } from "../utils/membersStore";
import { normalizeNickname } from '../lib/nickname.js';

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' }).formatToParts(d);
  const month = parts.find(p => p.type === 'month')?.value || '';
  const day = parts.find(p => p.type === 'day')?.value || '';
  const year = parts.find(p => p.type === 'year')?.value || '';
  return `${month}-${day}, ${year}`;
}
function daysSince(startIso, dateIso) {
  if (!startIso || !dateIso) return null;
  try {
    const toManilaMidnightMs = (v) => {
      const raw = String(v || '').trim();
      if (!raw) return NaN;
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T00:00:00+08:00`).getTime();
      const d = new Date(raw);
      if (isNaN(d)) return NaN;
      const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year:'numeric', month:'2-digit', day:'2-digit' }).format(d);
      return new Date(`${ymd}T00:00:00+08:00`).getTime();
    };
    const startMs = toManilaMidnightMs(startIso);
    const dateMs = toManilaMidnightMs(dateIso);
    if (!isFinite(startMs) || !isFinite(dateMs)) return null;
    const ms = dateMs - startMs;
    return Math.floor(ms / 86400000) + 1;
  } catch {
    return null;
  }
}

export default function ProgressDetailPanel({ memberId, entryIndex }) {
  const navigate = useNavigate();
  const params = useParams();
  // If props not provided, fall back to route params (id, index)
  const resolvedMemberId = memberId || params.id || params.memberId || params.memberID;
  const resolvedIndex = entryIndex ?? params.index ?? params.i ?? params.idx;
  const member = useMemo(() => getMemberById(resolvedMemberId), [resolvedMemberId]);
  const prog = useMemo(() => getMemberProgress(resolvedMemberId), [resolvedMemberId]);
  const entry = prog?.[Number(resolvedIndex)];

  if (!member || !entry) {
    return (
      <div className="content">
        <button className="button back-btn" onClick={() => navigate(-1)}>← Back</button>
        <p>Progress not found.</p>
      </div>
    );
  }

  const dayNo = daysSince(member.memberDate, entry.date) ?? (Number(resolvedIndex)+1);

  return (
    <div className="content">
      <button className="button back-btn" onClick={() => navigate(-1)}>← Back</button>
      <h2>{normalizeNickname(member.nickname) || member.nickname || `${member.firstName} ${member.lastName}`}</h2>
      <div className="card" style={{ padding:16 }}>
        <div style={{ fontWeight:800, marginBottom:8 }}>Day {dayNo} — {fmtDate(entry.date)}</div>
        <div>Weight: <b>{entry.weight ?? "—"}</b></div>
        <div>BMI: <b>{entry.bmi ?? "—"}</b></div>
        <div>Muscle Mass: <b>{entry.muscle ?? "—"}</b></div>
        <div>Body Fat: <b>{entry.bodyFat ?? "—"}</b></div>
        <div>Visceral Fat: <b>{entry.visceralFat ?? "—"}</b></div>
        {entry.photoUrl && (
          <div style={{ marginTop:12 }}>
            <img src={entry.photoUrl} alt="Progress" style={{ width:240, borderRadius:12, border:"1px solid #e7e8ef" }} />
          </div>
        )}
      </div>
    </div>
  );
}
