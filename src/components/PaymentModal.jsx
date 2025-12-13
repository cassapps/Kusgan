import React, { useEffect, useMemo, useState } from "react";
import api from "../api";
const { addPayment, fetchPricing, fetchPayments } = api;
import ModalWrapper from "./ModalWrapper";
import events from "../lib/events";
import { effectiveValidityDays, isManilaOffPeak, isParticularsVisible } from "../lib/pricingRules";

const MANILA_TZ = "Asia/Manila";

// Manila today YYYY-MM-DD
const manilaTodayYMD = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

// Format any date as YYYY-MM-DD in Manila time
const toManilaYMD = (d) => {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date)) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

// Manila current time HH:mm (24h)
const manilaNowHM = () =>
  new Intl.DateTimeFormat("en-PH", {
    timeZone: MANILA_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .replace(/^(\d{2}):(\d{2}).*$/, "$1:$2");

// Manila display: Mon-D, YYYY
const displayManila = (dOrYmd) => {
  if (!dOrYmd) return "-";
  let date;
  if (typeof dOrYmd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dOrYmd)) {
    const [y, m, d] = dOrYmd.split("-").map(Number);
    date = new Date(Date.UTC(y, m - 1, d));
  } else {
    date = dOrYmd instanceof Date ? dOrYmd : new Date(dOrYmd);
  }
  if (isNaN(date)) return "-";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: MANILA_TZ, month: "short", day: "numeric", year: "numeric" }).formatToParts(date);
  const m = parts.find((p) => p.type === "month")?.value || "";
  const day = parts.find((p) => p.type === "day")?.value || "";
  const y = parts.find((p) => p.type === "year")?.value || "";
  return `${m}-${day}, ${y}`;
};

// Inclusive end-date: end = start + (days - 1)
const endDateFrom = (startYMD, validityDays) => {
  if (!startYMD || !validityDays) return "";
  const [y, m, d] = startYMD.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + Math.max(0, Number(validityDays) - 1));
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(utc);
};

  // Helper: extract flags from pricing row (moved here so filtering can use it)
  const truthy = (v) => {
    const s = String(v ?? "").trim().toLowerCase();
    return s === "yes" || s === "y" || s === "true" || s === "1";
  };
  const getFlags = (row) => {
    if (!row) return { gym: false, coach: false };
    const entries = Object.entries(row || {});
    const findVal = (keys) => {
      for (const [k, v] of entries) {
        const nk = k.toLowerCase().replace(/\s+/g, "");
        if (keys.some((kk) => nk === kk.toLowerCase().replace(/\s+/g, ""))) return v;
      }
      return undefined;
    };
    const gymFlag = truthy(findVal(["Gym membership", "Gym Membership", "GymMembership", "Membership"]))
    const coachFlag = truthy(findVal(["Coach subscription", "Coach Subscription", "CoachSubscription", "Coach"]))
    return { gym: gymFlag, coach: coachFlag };
  };

const addDaysYMD = (startYMD, days = 0) => {
  if (!startYMD) return "";
  const [y, m, d] = String(startYMD).split("-").map(Number);
  if ([y, m, d].some((v) => Number.isNaN(v))) return "";
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + Number(days || 0));
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(utc);
};

export default function PaymentModal({ open, onClose, memberId, onSaved, membershipEnd, coachEnd, isStudent, birthDate, isSpecial }) {
  const [pricing, setPricing] = useState([]);
  const [busy, setBusy] = useState(false);
  const [memberPayments, setMemberPayments] = useState([]);
  const [form, setForm] = useState({ Particulars: "", Mode: "", Cost: "", StartDate: "", EndDate: "" });
  const [error, setError] = useState("");
  const [nowTick, setNowTick] = useState(0);

  // Refresh time-window logic while the modal is open.
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNowTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [open]);

  // Load pricing (Firestore -> { rows }) and fall back to legacy /api/products when needed
  useEffect(() => {
    let mounted = true;
    if (!open) {
      // clear transient state when modal closed
      setPricing([]);
      setForm({ Particulars: "", Mode: "", Cost: "", StartDate: "", EndDate: "" });
      setError("");
      return;
    }

    (async () => {
      try {
        setError("");
        // Try primary API first
        let rows = [];
        try {
          const res = await fetchPricing();
          if (res && Array.isArray(res.rows)) rows = res.rows;
          else if (res && Array.isArray(res)) rows = res;
        } catch (e) {
          // ignore and fallback below
        }

        // If we didn't get pricing rows, attempt a lightweight fallback to /api/products
        if ((!rows || rows.length === 0) && typeof fetch === "function") {
          const endpoints = ["/api/products", "http://localhost:4000/products"];
          for (const ep of endpoints) {
            try {
              const prodRes = await fetch(ep);
              if (prodRes && prodRes.ok) {
                const prods = await prodRes.json().catch(() => null);
                if (prods && Array.isArray(prods)) {
                  rows = (prods || []).map((pr) => ({
                    Particulars: pr.name || pr.sku || `Product ${pr.id}`,
                    Cost: typeof pr.price !== "undefined" ? Number(pr.price).toFixed(2) : "",
                    Validity: pr.validity_days || pr.validity || 0,
                    "Gym membership": pr.is_gym_membership ? "Yes" : "No",
                    "Coach subscription": pr.is_coach_subscription ? "Yes" : "No",
                    Notes: pr.notes || "",
                  }));
                  break;
                }
              }
            } catch (err) {
              // try next endpoint
            }
          }
        }

        if (mounted) setPricing(rows || []);
      } catch (e) {
        if (mounted) setError(e?.message || "Failed to load pricing");
      }
    })();

    return () => {
      mounted = false;
    };
  }, [open]);

  // Load member's payments when modal opens so we can compute promo eligibility
  useEffect(() => {
    if (!open || !memberId) {
      setMemberPayments([]);
      return;
    }
    let mounted = true;
    (async () => {
      try {
        const res = await fetchPayments();
        const rows = res && Array.isArray(res.rows) ? res.rows : (Array.isArray(res) ? res : []);
        if (!mounted) return;
        // normalize MemberID keys and filter for this member
        const id = String(memberId).trim();
        const mine = (rows || []).filter(r => String(r.MemberID || r.memberId || r.MemberID || r.memberid || '').trim() === id);
        setMemberPayments(mine || []);
      } catch (e) {
        setMemberPayments([]);
      }
    })();
    return () => { mounted = false; };
  }, [open, memberId]);
 

  // Senior check (>= 60) based on provided birthDate
  const isSenior = useMemo(() => {
    if (!birthDate) return false;
    const b = birthDate instanceof Date ? birthDate : new Date(birthDate);
    if (isNaN(b)) return false;
    const now = new Date();
    let age = now.getFullYear() - b.getFullYear();
    const m = now.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
    return age >= 60;
  }, [birthDate]);

  // Manila window flag
  const isOffPeak = useMemo(() => isManilaOffPeak(new Date()), [nowTick]);

  const hasActiveGym = useMemo(() => {
    try {
      if (!membershipEnd) return false;
      const today = manilaTodayYMD();
      const ymd = toManilaYMD(membershipEnd);
      return !!ymd && ymd >= today;
    } catch {
      return false;
    }
  }, [membershipEnd]);

  const hasActiveCoach = useMemo(() => {
    try {
      if (!coachEnd) return false;
      const today = manilaTodayYMD();
      const ymd = toManilaYMD(coachEnd);
      return !!ymd && ymd >= today;
    } catch {
      return false;
    }
  }, [coachEnd]);

  // Filter pricing based on eligibility rules (visibility rules from pricing sheet)
  const filteredPricing = useMemo(() => {
    const ctx = { hasActiveGym, hasActiveCoach, isStudent: !!isStudent, isSenior: !!isSenior, isSpecial: !!isSpecial, isOffPeak };
    return (pricing || []).filter((p) => {
      const name = String(p?.Particulars || "").trim();
      if (!name) return false;
      return isParticularsVisible(name, ctx);
    });
  }, [pricing, hasActiveGym, hasActiveCoach, isStudent, isSenior, isSpecial, isOffPeak]);

  // Clear selection if it becomes ineligible due to filters
  useEffect(() => {
    if (!form.Particulars) return;
    const stillThere = filteredPricing.some((p) => String(p.Particulars) === String(form.Particulars));
    if (!stillThere) setForm((f) => ({ ...f, Particulars: "", Cost: "", EndDate: "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredPricing]);

  

  // Group filtered pricing into categories for the dropdown
  const groupedPricing = useMemo(() => {
    const groups = { gymOnly: [], coachOnly: [], bundle: [], merch: [] };
    (filteredPricing || []).forEach((p) => {
      const f = getFlags(p);
      if (f.gym && !f.coach) groups.gymOnly.push(p);
      else if (!f.gym && f.coach) groups.coachOnly.push(p);
      else if (f.gym && f.coach) groups.bundle.push(p);
      else groups.merch.push(p);
    });
    return groups;
  }, [filteredPricing]);

  // Debug UI removed in production

  const onParticulars = (val) => {
    const item = (filteredPricing || []).find((r) => String(r.Particulars) === String(val));
    const cost = item ? (parseFloat(item.Cost) || 0).toFixed(2) : "";
    const validity = item ? effectiveValidityDays(item.Particulars, item.Validity) : 0;
    const flags = getFlags(item);
    // Promo: if this is a daily pass and the member has availed the exact same pass >=12 times in the last 30 days,
    // the next one is free.
    const isDailyName = /\bdaily\b|daily\s*pass|1[- ]?day/i.test(String(val || ""));
    let promoApplies = false;
    if (isDailyName && memberPayments && memberPayments.length) {
      const now = Date.now();
      const cutoff = now - (30 * 24 * 60 * 60 * 1000);
      const nameTrim = String(val || "").trim();
      const recentSame = (memberPayments || []).filter((p) => {
        try {
          const pname = String(p.Particulars || p.Particular || "").trim();
          if (pname !== nameTrim) return false;
          const d = p.Date || p.DatePaid || p.DateTime || p.timestamp || p.Timestamp || p.Time || null;
          if (!d) return false;
          let dt = new Date(d);
          if (isNaN(dt)) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(String(d))) dt = new Date(String(d) + 'T00:00:00');
            else return false;
          }
          return dt.getTime() >= cutoff;
        } catch (e) { return false; }
      }).length;
      if (recentSame >= 12) promoApplies = true;
    }
  const today = manilaTodayYMD();
  // Determine extension base: if covers gym/coach and existing validity is active, start from the next day
  // Use Manila YMD string comparisons to avoid timezone/parsing differences.
  const gymCurrentYMD = membershipEnd ? toManilaYMD(membershipEnd) : "";
  const coachCurrentYMD = coachEnd ? toManilaYMD(coachEnd) : "";
  // Compute separate bases for gym and coach so they don't force a single shared start
  const gymBase = flags.gym
    ? (gymCurrentYMD && gymCurrentYMD >= today ? addDaysYMD(gymCurrentYMD, 1) : today)
    : null;
  const coachBase = flags.coach
    ? (coachCurrentYMD && coachCurrentYMD >= today ? addDaysYMD(coachCurrentYMD, 1) : today)
    : null;

  // Determine a sensible default StartDate shown in the form:
  // - If item affects both gym and coach, default StartDate to today so coach (when missing)
  //   starts immediately while gym will still use gymBase when present.
  // - If only gym is affected, default to gymBase (so extension continues from current end).
  // - If only coach is affected, default to coachBase.
  // - Otherwise default to today.
  let startDefault = today;
  if (flags.gym && flags.coach) {
    startDefault = today;
  } else if (flags.gym && gymBase) {
    startDefault = gymBase;
  } else if (flags.coach && coachBase) {
    startDefault = coachBase;
  } else {
    startDefault = today;
  }

    setForm((f) => {
      const start = startDefault || f.StartDate || today;
      return {
        ...f,
        Particulars: val,
        Cost: promoApplies ? "0.00" : cost,
        StartDate: start,
        EndDate: validity ? endDateFrom(start, validity) : "",
        PromoApplied: promoApplies,
      };
    });
  };

  const onStartDate = (start) => {
    const item = (filteredPricing || []).find((r) => String(r.Particulars) === String(form.Particulars));
    const validity = item ? effectiveValidityDays(item.Particulars, item.Validity) : 0;
    setForm((f) => ({ ...f, StartDate: start, EndDate: validity ? endDateFrom(start, validity) : "" }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!memberId) return setError("Missing MemberID");
    if (!form.Particulars) return setError("Select Particulars.");
    if (!form.Mode) return setError("Select a payment mode.");
    if (!form.Cost) return setError("Cost is missing for this item.");

    setBusy(true);
    setError("");
    try {
      // Derive the resulting new valid-until dates for gym/coach based on the selected item
      const item = (filteredPricing || []).find((r) => String(r.Particulars) === String(form.Particulars));
      if (!item) throw new Error("Selected Particulars is not available.");
      const validity = effectiveValidityDays(item.Particulars, item.Validity);
      const flags = getFlags(item);
      const ctx = { hasActiveGym, hasActiveCoach, isStudent: !!isStudent, isSenior: !!isSenior, isSpecial: !!isSpecial, isOffPeak };
      if (!isParticularsVisible(item.Particulars, ctx)) {
        setError('This Particulars is not available right now.');
        setBusy(false);
        return;
      }
  const today = manilaTodayYMD();
  const gymCurrent = membershipEnd ? toManilaYMD(membershipEnd) : "";
  const coachCurrent = coachEnd ? toManilaYMD(coachEnd) : "";
  const gymBase = flags.gym ? (gymCurrent && gymCurrent >= today ? addDaysYMD(gymCurrent, 1) : form.StartDate || today) : null;
  const coachBase = flags.coach ? (coachCurrent && coachCurrent >= today ? addDaysYMD(coachCurrent, 1) : form.StartDate || today) : null;
      const gymNew = gymBase && validity ? endDateFrom(gymBase, validity) : "";
      const coachNew = coachBase && validity ? endDateFrom(coachBase, validity) : "";

      await addPayment({
        MemberID: memberId,
        Particulars: form.Particulars,
        StartDate: form.StartDate || "",
        EndDate: form.EndDate || "",
        GymValidUntil: gymNew,
        CoachValidUntil: coachNew,
        Mode: form.Mode,
        Cost: String(form.Cost).trim(),
        Date: manilaTodayYMD(),
        Time: manilaNowHM(),
      });
      if (onSaved) onSaved();
      onClose && onClose();
    } catch (e2) {
      const msg = e2?.message || "Failed to add payment";
      setError(msg);
      try { events.emit('modal:error', { message: msg, source: 'PaymentModal', error: String(e2) }); } catch(e) {}
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

    return (
  <ModalWrapper open={open} onClose={onClose} title="Add Payment" width={560} noInternalScroll={true}>
        <form onSubmit={submit} style={{ width: '100%' }}>
        {error && (
          <div className="small-error" style={{ marginBottom: 8 }}>{error}</div>
        )}

        {/* Membership validity snapshot (current only) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Gym Membership - Valid until</div>
            <div style={{ fontWeight: 700 }}>{membershipEnd ? displayManila(membershipEnd) : "-"}</div>
          </div>
          <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Coach Subscription - Valid until</div>
            <div style={{ fontWeight: 700 }}>{coachEnd ? displayManila(coachEnd) : "-"}</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label className="field" style={{ gridColumn: "1 / span 2" }}>
            <span className="label">Particulars</span>
            <select value={form.Particulars} onChange={(e) => onParticulars(e.target.value)} required>
              <option value="">Choose product/service</option>
              {groupedPricing.gymOnly.length > 0 && (
                <optgroup label="Gym membership only">
                  {groupedPricing.gymOnly.map((p, i) => (
                    <option key={`gym-${p.Particulars}-${i}`} value={p.Particulars}>{p.Particulars}</option>
                  ))}
                </optgroup>
              )}
              {groupedPricing.coachOnly.length > 0 && (
                <optgroup label="Coach subscription only">
                  {groupedPricing.coachOnly.map((p, i) => (
                    <option key={`coach-${p.Particulars}-${i}`} value={p.Particulars}>{p.Particulars}</option>
                  ))}
                </optgroup>
              )}
              {groupedPricing.bundle.length > 0 && (
                <optgroup label="Gym & Coach bundle">
                  {groupedPricing.bundle.map((p, i) => (
                    <option key={`bundle-${p.Particulars}-${i}`} value={p.Particulars}>{p.Particulars}</option>
                  ))}
                </optgroup>
              )}
              {groupedPricing.merch.length > 0 && (
                <optgroup label="Merchandise">
                  {groupedPricing.merch.map((p, i) => (
                    <option key={`merch-${p.Particulars}-${i}`} value={p.Particulars}>{p.Particulars}</option>
                  ))}
                </optgroup>
              )}
            </select>
            {/* New validity preview below Particulars, soft pink */}
            {form.Particulars && (() => {
              const item = (filteredPricing || []).find((r) => String(r.Particulars) === String(form.Particulars));
              const flags = getFlags(item);
              const validity = item ? effectiveValidityDays(item.Particulars, item.Validity) : 0;
              if (!validity) return null;
              const today = manilaTodayYMD();
              const gymCurrent = membershipEnd ? toManilaYMD(membershipEnd) : "";
              const coachCurrent = coachEnd ? toManilaYMD(coachEnd) : "";
              const gymBase = flags.gym ? (gymCurrent && gymCurrent >= today ? addDaysYMD(gymCurrent, 1) : form.StartDate || today) : null;
              const coachBase = flags.coach ? (coachCurrent && coachCurrent >= today ? addDaysYMD(coachCurrent, 1) : form.StartDate || today) : null;
              const gymNew = gymBase ? endDateFrom(gymBase, validity) : null;
              const coachNew = coachBase ? endDateFrom(coachBase, validity) : null;
              if (!gymNew && !coachNew) return null;
              return (
                <div style={{ background: "#fde8ef", border: "1px solid #ffd7e3", color: "#8b1a3b", marginTop: 8, padding: 8, borderRadius: 8, fontSize: 13, lineHeight: 1.35 }}>
                  {gymNew && (
                    <div>
                      New Gym valid until: <b>{displayManila(gymNew)}</b>
                    </div>
                  )}
                  {coachNew && (
                    <div>
                      New Coach valid until: <b>{displayManila(coachNew)}</b>
                    </div>
                  )}
                </div>
              );
            })()}
            {/* debug UI removed */}
          </label>

          <label className="field">
            <span className="label">Mode of Payment</span>
            <select value={form.Mode} onChange={(e) => setForm((f) => ({ ...f, Mode: e.target.value }))} required>
              <option value="">Select mode…</option>
              <option value="Cash">Cash</option>
              <option value="GCash">GCash</option>
            </select>
          </label>

          <label className="field">
            <span className="label">Cost</span>
            <input type="number" step="0.01" min="0" value={form.Cost} readOnly disabled />
            {form.PromoApplied && (
              <div style={{ marginTop: 6, fontSize: 12, color: '#065f46' }}>Promo applied — this item will be free (12 uses in last 30 days)</div>
            )}
          </label>
        </div>

        <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 12 }}>
          Validity is applied inclusive of the Start Date.
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" className="back-btn" onClick={onClose} style={{ background: "#e5e7eb", color: "#111", fontWeight: 700 }}>Cancel</button>
          <button type="submit" className="primary-btn" disabled={busy}>+ Add Payment</button>
        </div>
        </form>
      </ModalWrapper>
    );
}
