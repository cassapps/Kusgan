import React from "react";
import { fmtDate, fmtTime } from "../pages/MemberDetail.jsx";
import { useNavigate } from "react-router-dom";
import CheckInConfirmModal from './CheckInConfirmModal';
import ModalWrapper from "./ModalWrapper";
import api from "../api";
const { fetchMemberById, fetchMemberByIdFresh } = api;

// Small helpers copied from ProgressViewModal / MemberDetail
const pick = (o, keys = []) => {
  if (!o) return "";
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(o, k)) return o[k];
    const alt = Object.keys(o).find(kk => kk.toLowerCase().replace(/\s+/g, "") === k.toLowerCase().replace(/\s+/g, ""));
    if (alt) return o[alt];
  }
  return "";
};

const driveId = (u = "") => {
  const m = String(u || "").match(/(?:\/file\/d\/|[?&]id=|\/uc\?[^#]*id=)([^\/#?]+)/);
  return m && m[1] ? m[1] : "";
};
const driveThumb = (u = "") => {
  const s = String(u || "");
  if (/googleusercontent\.com\//.test(s)) return s;
  const id = driveId(s);
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w1000` : s;
};

const asDate = (v) => {
  try {
    if (!v && v !== 0) return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    if (typeof v === 'number') {
      const d = new Date(v);
      return isNaN(d) ? null : d;
    }
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
    if (!v && v !== 0) return '';
    if (typeof v === 'string') {
      const s = v.trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    }
    const d = asDate(v);
    if (!d) return '';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch (e) {
    return '';
  }
};

export default function VisitViewModal({ open, onClose, row, onCheckout }) {
  const navigate = useNavigate();
  const [busy, setBusy] = React.useState(false);
  const [nickname, setNickname] = React.useState(null);
  // Prefer the original raw sheet row if caller provided a wrapper with `raw`.
  const r = (row && row.raw) ? row.raw : (row || {});
  const memberId = pick(r, ["MemberID", "memberid", "member_id", "id"]);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!memberId) return;
        let m = await fetchMemberById(memberId);
        if (!mounted) return;
        if (!m) {
          try {
            const fresh = await fetchMemberByIdFresh?.(memberId);
            if (fresh) m = fresh;
          } catch (e) {
            // ignore fetch fresh error
          }
        }
        // If we still don't have a member, attempt to derive from the visit `row` and exit early
        if (!m) {
          try {
            const rowNick = pick(r, ["NickName", "nickname", "Nick", "nick", "Nick_Name", "Nick Name"]) || pick(row, ["NickName", "nickname", "Nick", "nick", "Nick_Name", "Nick Name"]);
            if (rowNick) { setNickname(String(rowNick).trim()); return; }
            const rf = pick(r, ["FirstName", "firstname", "first_name", "first"]) || pick(row, ["FirstName", "firstname", "first_name", "first"]);
            const rl = pick(r, ["LastName", "lastname", "last_name", "last"]) || pick(row, ["LastName", "lastname", "last_name", "last"]);
            const rfull = ((rf || "").trim() || (rl || "").trim()) ? `${(rf||"").trim()} ${(rl||"").trim()}`.trim() : null;
            if (rfull) { setNickname(rfull); return; }
          } catch (e) {
            // ignore
          }
          return;
        }
        // Try common nickname keys from the raw record or canonicalized object
        const raw = m._raw || m;
        const nick = pick(raw, ["NickName", "nickname", "Nick", "nick", "Nick_Name", "Nick Name"]);
        if (nick) setNickname(String(nick).trim());
        else {
          // fallback to first + last
          const fn = (m.firstname || m.firstName || m.FirstName || "").trim();
          const ln = (m.lastname || m.lastName || m.LastName || "").trim();
          const full = (fn || ln) ? `${fn} ${ln}`.trim() : null;
          if (full) setNickname(full);
          // As a last resort, derive nickname from the visit `row` props in case member record is incomplete
          if (!full) {
            try {
              const rowNick = pick(r, ["NickName", "nickname", "Nick", "nick", "Nick_Name", "Nick Name"]) || pick(row, ["NickName", "nickname", "Nick", "nick", "Nick_Name", "Nick Name"]);
              if (rowNick) { setNickname(String(rowNick).trim()); return; }
              const rf = pick(r, ["FirstName", "firstname", "first_name", "first"]) || pick(row, ["FirstName", "firstname", "first_name", "first"]);
              const rl = pick(r, ["LastName", "lastname", "last_name", "last"]) || pick(row, ["LastName", "lastname", "last_name", "last"]);
              const rfull = ((rf || "").trim() || (rl || "").trim()) ? `${(rf||"").trim()} ${(rl||"").trim()}`.trim() : null;
              if (rfull) { setNickname(rfull); return; }
            } catch (e) { }
          }
        }
      } catch (e) {
        // ignore
      }
    })();
    return () => { mounted = false; };
  }, [memberId]);

  const dateRaw = pick(r, ["Date", "date", "visit_date", "timestamp"]) || pick(row, ["Date", "date", "visit_date", "timestamp"]);
  const timeIn = pick(r, ["TimeIn", "timein", "time_in"]) || pick(row, ["TimeIn", "timein", "time_in"]);
  const timeOut = pick(r, ["TimeOut", "timeout", "time_out"]) || pick(row, ["TimeOut", "timeout", "time_out"]);
  const totalHours = pick(r, ["TotalHours", "totalhours", "NoOfHours", "noofhours", "hours"]) || pick(row, ["TotalHours", "totalhours", "NoOfHours", "noofhours", "hours"]);
  const coach = pick(r, ["Coach", "coach"]) || pick(row, ["Coach", "coach"]);
  const focus = pick(r, ["Focus", "focus"]) || pick(row, ["Focus", "focus"]);
  const workouts = pick(r, ["Workouts", "workouts", "done", "workouts_done"]) || pick(row, ["Workouts", "workouts", "done", "workouts_done"]);
  const comments = pick(r, ["Comments", "comments", "notes"]) || pick(row, ["Comments", "comments", "notes"]);
  const photo = pick(r, ["Photo", "photo", "photo_url", "PhotoURL"]) || pick(row, ["Photo", "photo", "photo_url", "PhotoURL"]);

  const [openCheckoutModal, setOpenCheckoutModal] = React.useState(false);

  const isTodayVisit = React.useMemo(() => {
    const visitY = manilaYMD(dateRaw);
    if (!visitY) return false;
    return visitY === manilaYMD(new Date());
  }, [dateRaw]);

  // Keep hooks stable even when `open` is false — only short-circuit rendering after hooks
  if (!open) return null;

  const handleCheckoutSuccess = () => {
    if (typeof onCheckout === 'function') {
      try { onCheckout(row, { checkedOut: true }); } catch (e) { console.error(e); }
    }
  };

  return (
    <>
      <ModalWrapper open={open} onClose={onClose} title="Visit Details" noInternalScroll={true}>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
            <span style={{ fontSize: 14, fontStyle: "italic", color: "var(--muted)", display: "block", marginBottom: 4 }}>Nickname</span>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{nickname || memberId || "-"}</div>
          </div>
          <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
            <span style={{ fontSize: 14, fontStyle: "italic", color: "var(--muted)", display: "block", marginBottom: 4 }}>Date</span>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{fmtDate(dateRaw) || "-"}</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {[
            ["Time In", timeIn],
            ["Time Out", timeOut],
            ["Total Hours", totalHours],
          ].map(([label, val]) => (
            <div key={label} className="field">
              <span className="label" style={{ display: "block", marginBottom: 6 }}>{label}</span>
              <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: 10, fontWeight: 700, fontSize: 18 }}>
                {label === "Time In" || label === "Time Out" ? (val ? fmtTime(val) : "-") : (val ? String(val) : "-")}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <div className="field">
            <span className="label">Coach</span>
            <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, fontSize: 16, minHeight: 44 }}>{coach || "-"}</div>
          </div>
          <div className="field">
            <span className="label">Focus</span>
            <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, fontSize: 16, minHeight: 44 }}>{focus || "-"}</div>
          </div>
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <span className="label">Workouts Done</span>
          <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, fontSize: 16, minHeight: 72 }}>{workouts || "-"}</div>
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <span className="label">Comments</span>
          <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, fontSize: 16, minHeight: 72 }}>{comments || "-"}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          {/* Show Check Out if entry has no TimeOut: navigate to Check-In page to use the unified confirm modal */}
          {(!timeOut && isTodayVisit) ? (
            <button
              className="primary-btn"
              onClick={() => {
                try {
                  if (typeof onCheckout === 'function') {
                    try { onCheckout(r); } catch (e) { console.error(e); }
                    onClose && onClose();
                    return;
                  }
                  setOpenCheckoutModal(true);
                } catch (e) { console.error(e); }
              }}
            >
              Check Out
            </button>
          ) : null}
          <button className="primary-btn" onClick={onClose}>Close</button>
        </div>
      </ModalWrapper>
      {openCheckoutModal && (
        <CheckInConfirmModal
          open={openCheckoutModal}
          onClose={() => { setOpenCheckoutModal(false); }}
          memberId={memberId}
          initialEntry={r}
          onSuccess={() => { setOpenCheckoutModal(false); onClose && onClose(); handleCheckoutSuccess(); }}
        />
      )}
    </>
  );
}

