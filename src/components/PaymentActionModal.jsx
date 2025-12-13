import React from "react";
import ModalWrapper from "./ModalWrapper";
import api from "../api";
import { fmtDate, display, MANILA_TZ } from "../pages/MemberDetail.jsx";

const { updatePayment, deletePayment } = api;

const asDate = (v) => {
  try {
    if (!v && v !== 0) return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    if (typeof v === "number") {
      const d = new Date(v);
      return isNaN(d) ? null : d;
    }
    if (v && typeof v.toDate === "function") {
      const d = v.toDate();
      return d instanceof Date && !isNaN(d) ? d : null;
    }
    if (v && typeof v.toMillis === "function") {
      const d = new Date(v.toMillis());
      return isNaN(d) ? null : d;
    }
    if (v && typeof v.seconds === "number") {
      const d = new Date(v.seconds * 1000);
      return isNaN(d) ? null : d;
    }
    if (v && typeof v._seconds === "number") {
      const d = new Date(v._seconds * 1000);
      return isNaN(d) ? null : d;
    }
    const d = new Date(v);
    return isNaN(d) ? null : d;
  } catch {
    return null;
  }
};

const manilaYMD = (v) => {
  try {
    if (!v && v !== 0) return "";
    if (typeof v === "string") {
      const s = v.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
    }
    const d = asDate(v);
    if (!d) return "";
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: MANILA_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return "";
  }
};

const firstOf = (row, candidates = []) => {
  const n = row || {};
  for (const c of candidates) {
    if (n[c] !== undefined) return n[c];
    const found = Object.keys(n).find((k) => String(k).toLowerCase().replace(/\s+/g, "") === String(c).toLowerCase().replace(/\s+/g, ""));
    if (found) return n[found];
  }
  return "";
};

export default function PaymentActionModal({ open, onClose, payment, onChanged }) {
  const [mode, setMode] = React.useState("view"); // 'view' | 'edit'
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const pid = String(payment?.id || "").trim();

  const initialForm = React.useMemo(() => {
    const p = payment || {};
    return {
      Date: manilaYMD(firstOf(p, ["date", "paid_on", "created", "timestamp", "Date"])),
      Particulars: String(firstOf(p, ["particulars", "type", "item", "category", "product", "paymentfor", "plan", "description", "Particulars"]) || ""),
      GymValidUntil: manilaYMD(firstOf(p, ["gymvaliduntil", "gym_valid_until", "gym_until", "GymValidUntil"])),
      CoachValidUntil: manilaYMD(firstOf(p, ["coachvaliduntil", "coach_valid_until", "coach_until", "CoachValidUntil"])),
      Mode: String(firstOf(p, ["mode", "payment_mode", "method", "via", "Mode"]) || ""),
      Cost: String(firstOf(p, ["cost", "amount", "price", "total", "paid", "Cost"]) || ""),
    };
  }, [payment]);

  const [form, setForm] = React.useState(initialForm);

  React.useEffect(() => {
    if (!open) return;
    setMode("view");
    setBusy(false);
    setError("");
    setForm(initialForm);
  }, [open, initialForm]);

  if (!open) return null;

  const paidRaw = firstOf(payment || {}, ["date", "paid_on", "created", "timestamp", "Date"]);
  const gymUntilRaw = firstOf(payment || {}, ["gymvaliduntil", "gym_valid_until", "gym_until", "GymValidUntil"]);
  const coachUntilRaw = firstOf(payment || {}, ["coachvaliduntil", "coach_valid_until", "coach_until", "CoachValidUntil"]);
  const particularsRaw = firstOf(payment || {}, ["particulars", "type", "item", "category", "product", "paymentfor", "plan", "description", "Particulars"]);
  const modeRaw = firstOf(payment || {}, ["mode", "payment_mode", "method", "via", "Mode"]);
  const costRaw = firstOf(payment || {}, ["cost", "amount", "price", "total", "paid", "Cost"]);

  const onSave = async () => {
    if (!pid) return setError("Missing payment id");
    setBusy(true);
    setError("");
    try {
      const patch = {
        Date: String(form.Date || "").trim(),
        Particulars: String(form.Particulars || "").trim(),
        GymValidUntil: String(form.GymValidUntil || "").trim(),
        CoachValidUntil: String(form.CoachValidUntil || "").trim(),
        Mode: String(form.Mode || "").trim(),
        Cost: String(form.Cost || "").trim(),
      };
      await updatePayment(pid, patch);
      setMode("view");
      onChanged && onChanged({ type: "updated", id: pid });
      onClose && onClose();
    } catch (e) {
      setError(e?.message || "Failed to update payment");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!pid) return setError("Missing payment id");
    const ok = window.confirm("Delete this payment? This cannot be undone.");
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      await deletePayment(pid);
      onChanged && onChanged({ type: "deleted", id: pid });
      onClose && onClose();
    } catch (e) {
      setError(e?.message || "Failed to delete payment");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalWrapper open={open} onClose={onClose} title="Payment" width={620} noInternalScroll={true}>
      {error && <div className="small-error" style={{ marginBottom: 8 }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
          <span style={{ fontSize: 14, fontStyle: "italic", color: "var(--muted)", display: "block", marginBottom: 4 }}>Date</span>
          <div style={{ fontWeight: 700, fontSize: 18 }}>{fmtDate(paidRaw) || "-"}</div>
        </div>
        <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
          <span style={{ fontSize: 14, fontStyle: "italic", color: "var(--muted)", display: "block", marginBottom: 4 }}>Cost</span>
          <div style={{ fontWeight: 700, fontSize: 18 }}>{display(costRaw) || "-"}</div>
        </div>
      </div>

      {mode === "view" ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <span className="label">Particulars</span>
              <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, fontSize: 16, minHeight: 44 }}>{display(particularsRaw) || "-"}</div>
            </div>
            <div className="field">
              <span className="label">Mode</span>
              <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, fontSize: 16, minHeight: 44 }}>{display(modeRaw) || "-"}</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
            <div className="field">
              <span className="label">Gym Membership - Valid Until</span>
              <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, fontSize: 16, minHeight: 44 }}>{fmtDate(gymUntilRaw) || "-"}</div>
            </div>
            <div className="field">
              <span className="label">Coach Subscription - Valid Until</span>
              <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, fontSize: 16, minHeight: 44 }}>{fmtDate(coachUntilRaw) || "-"}</div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
            <button className="button" type="button" onClick={() => setMode("edit")} disabled={busy}>
              Edit
            </button>
            <button className="button" type="button" onClick={onDelete} disabled={busy}>
              Delete
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label className="field">
              <span className="label">Date</span>
              <input value={form.Date} onChange={(e) => setForm((f) => ({ ...f, Date: e.target.value }))} placeholder="YYYY-MM-DD" />
            </label>
            <label className="field">
              <span className="label">Cost</span>
              <input value={form.Cost} onChange={(e) => setForm((f) => ({ ...f, Cost: e.target.value }))} placeholder="0.00" />
            </label>
            <label className="field" style={{ gridColumn: "1 / span 2" }}>
              <span className="label">Particulars</span>
              <input value={form.Particulars} onChange={(e) => setForm((f) => ({ ...f, Particulars: e.target.value }))} />
            </label>
            <label className="field">
              <span className="label">Mode</span>
              <input value={form.Mode} onChange={(e) => setForm((f) => ({ ...f, Mode: e.target.value }))} />
            </label>
            <label className="field">
              <span className="label">Gym Valid Until</span>
              <input value={form.GymValidUntil} onChange={(e) => setForm((f) => ({ ...f, GymValidUntil: e.target.value }))} placeholder="YYYY-MM-DD" />
            </label>
            <label className="field">
              <span className="label">Coach Valid Until</span>
              <input value={form.CoachValidUntil} onChange={(e) => setForm((f) => ({ ...f, CoachValidUntil: e.target.value }))} placeholder="YYYY-MM-DD" />
            </label>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
            <button className="button" type="button" onClick={() => { setMode("view"); setForm(initialForm); }} disabled={busy}>
              Cancel
            </button>
            <button className="button" type="button" onClick={onSave} disabled={busy}>
              Save
            </button>
          </div>
        </>
      )}
    </ModalWrapper>
  );
}
