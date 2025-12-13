import React, { useEffect, useMemo, useState } from "react";
import "../styles.css";
import api from "../api";
import apiClient from '../lib/apiClient';
import { fmtDateTime } from "../pages/MemberDetail.jsx";
const { fetchPayments, addPayment, fetchMembers } = api;

const MANILA_TZ = "Asia/Manila";

// Manila today YYYY-MM-DD
const manilaTodayYMD = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

// Manila current time HH:mm
const manilaNowHM = () =>
  new Intl.DateTimeFormat("en-PH", {
    timeZone: MANILA_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .replace(/^(\d{2}):(\d{2}).*$/, "$1:$2");

const toManilaDate = (value) => {
  if (!value) return null;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  }
  return new Date(s);
};

const fmtManilaDate = (value) => {
  const d = toManilaDate(value);
  if (!d || isNaN(d)) return "";
  const s = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: MANILA_TZ,
  }).format(d);
  return s.replace(" ", "-");
};
const fmtManilaTime = (value) => {
  const d = toManilaDate(value);
  if (!d || isNaN(d)) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: MANILA_TZ,
  }).format(d);
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

export default function PaymentsPanel() {
  const [rows, setRows] = useState([]);
  const [pricing, setPricing] = useState([]); // [{Particulars, Gym Membership, Coach Subscription, Cost, Validity}]
  const [members, setMembers] = useState([]); // normalized below
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Search filter for members
  const [memberQuery, setMemberQuery] = useState("");

  // Form state
  const [form, setForm] = useState({
    Date: manilaTodayYMD(),
    Time: manilaNowHM(),
    MemberID: "",
    Particulars: "",
    StartDate: manilaTodayYMD(), // editable
    EndDate: "", // computed
    Mode: "", // required, no prefill
    Cost: "", // from pricing, read-only
  });

  // Load table rows
  const load = async () => {
    setError("");
    try {
      const res = await fetchPayments();
      setRows(res?.rows || res?.data || res || []);
    } catch (e) {
      setError(e.message || "Failed to load payments");
    }
  };

  // Load metadata: products (pricing), members
  const loadMeta = async () => {
    setError("");
    try {
      const [m, productsRes] = await Promise.all([fetchMembers(), apiClient.fetchWithAuth('/products')]);
      const prodJson = productsRes && productsRes.ok ? await productsRes.json().catch(() => []) : [];
      // Map products to the older pricing shape so the form logic still works
      const pRows = (prodJson || []).map(p => ({ Particulars: p.name, Cost: Number(p.price).toFixed(2), Validity: p.validity_days, 'Gym Membership': p.is_gym_membership ? 'Yes' : 'No', 'Coach Subscription': p.is_coach_subscription ? 'Yes' : 'No' }));
      setPricing(pRows);

      // Normalize members to { id, nickname, first, last }
      const mRows = (m?.rows || m?.data || m || []).map((r) => ({
        id: r.MemberID || r.ID || r.Id || r.id || "",
        nickname: r.Nickname || r.Nick || r.nickname || "",
        first: r.FirstName || r.First || r.GivenName || r.first || "",
        last: r.LastName || r.Last || r.Surname || r.last || "",
      }));
      setMembers(mRows);
    } catch (e) {
      setError(e.message || "Failed to load pricing/members");
    }
  };

  useEffect(() => {
    load();
    loadMeta();
  }, []);

  // When Particulars changes, prefill Cost, Validity and EndDate
  const onParticulars = (val) => {
    const item = pricing.find((r) => String(r.Particulars) === String(val));
    const cost = item ? (parseFloat(item.Cost) || 0).toFixed(2) : "";
    const validity = item ? Number(item.Validity || 0) : 0;
    setForm((f) => {
      const start = f.StartDate || manilaTodayYMD();
      const end = validity ? endDateFrom(start, validity) : "";
      return {
        ...f,
        Particulars: val,
        Cost: cost,
        StartDate: start, // ensure prefill to today if empty
        EndDate: end,
      };
    });
  };

  // When StartDate changes, recompute EndDate using chosen validity
  const onStartDate = (start) => {
    const item = pricing.find(
      (r) => String(r.Particulars) === String(form.Particulars)
    );
    const validity = item ? Number(item.Validity || 0) : 0;
    setForm((f) => ({ ...f, StartDate: start, EndDate: validity ? endDateFrom(start, validity) : "" }));
  };

  const onChange = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.MemberID) return setError("Select a Member.");
    if (!form.Particulars) return setError("Select Particulars.");
    if (!form.Mode) return setError("Select a payment mode.");
    if (!form.Cost) return setError("Cost is missing for this item.");

    setBusy(true);
    setError("");
    try {
      // If Particulars matches one of our server products, call purchase endpoint
      const prod = pricing.find(p => String(p.Particulars) === String(form.Particulars));
      if (prod) {
        // find product id by name
        const productsRes = await apiClient.fetchWithAuth('/products');
        if (productsRes && productsRes.ok) {
          const prodList = await productsRes.json().catch(() => []);
          const found = prodList.find(x => String(x.name) === String(form.Particulars));
          if (found) {
            const tokenRes = await apiClient.fetchWithAuth(`/members/${encodeURIComponent(form.MemberID)}/purchase`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: found.id, method: form.Mode }) });
            if (!tokenRes || !tokenRes.ok) {
              const j = await (tokenRes && tokenRes.json().catch(() => ({})));
              throw new Error(j.error || 'Purchase failed');
            }
          } else {
            // fallback to direct addPayment if product not found
            await addPayment({ Date: form.Date, Time: form.Time, MemberID: form.MemberID, Particulars: form.Particulars, StartDate: form.StartDate || '', EndDate: form.EndDate || '', Mode: form.Mode, Cost: String(form.Cost).trim() });
          }
        } else {
          // product list not reachable -> fallback
          await addPayment({ Date: form.Date, Time: form.Time, MemberID: form.MemberID, Particulars: form.Particulars, StartDate: form.StartDate || '', EndDate: form.EndDate || '', Mode: form.Mode, Cost: String(form.Cost).trim() });
        }
      } else {
        await addPayment({
          Date: form.Date,
          Time: form.Time,
          MemberID: form.MemberID,
          Particulars: form.Particulars,
          StartDate: form.StartDate || "",
          EndDate: form.EndDate || "",
          Mode: form.Mode,
          Cost: String(form.Cost).trim(),
        });
      }

      // Reset, keep primary attendant
      setForm((f) => ({
        ...f,
        Date: manilaTodayYMD(),
        Time: manilaNowHM(),
        MemberID: "",
        Particulars: "",
        StartDate: manilaTodayYMD(),
        EndDate: "",
        Mode: "",
        Cost: "",
      }));
      setMemberQuery("");
      await load();
    } catch (e2) {
      setError(e2.message || "Failed to add payment");
    } finally {
      setBusy(false);
    }
  };

  const total = useMemo(
    () => rows.reduce((sum, r) => sum + (parseFloat(r.Cost) || 0), 0),
    [rows]
  );

  // Filtered member list
  const filteredMembers = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    const withLabel = members.map((m) => ({
      ...m,
      label: `${m.nickname || "—"} – ${m.first || ""} ${m.last || ""}`.trim(),
    }));
    if (!q) return withLabel;
    return withLabel.filter((m) =>
      [m.nickname, m.first, m.last, `${m.first} ${m.last}`]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [members, memberQuery]);

  return (
    <div className="content">
      <h2>Payments</h2>

      {error && (
        <div className="small-error" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      {/* Form card */}
      <form
        onSubmit={submit}
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Add Payment</div>

        <div className="form-grid">
          {/* Date (auto, not editable) */}
          <label className="fg-item">
            <span>Date</span>
            <input type="date" value={form.Date} readOnly disabled />
          </label>

          {/* Time (auto, not editable) */}
          <label className="fg-item">
            <span>Time</span>
            <input type="time" value={form.Time} readOnly disabled />
          </label>

          {/* Member: searchable */}
          <div className="fg-item fg-span-2">
            <span>Member</span>
            <div className="member-picker">
              <input
                type="text"
                className="member-filter"
                placeholder="Search nickname, first or last name"
                value={memberQuery}
                onChange={(e) => setMemberQuery(e.target.value)}
              />
              <select
                required
                value={form.MemberID}
                onChange={(e) => onChange("MemberID", e.target.value)}
              >
                <option value="">Select member…</option>
                {filteredMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Particulars (from Pricing) */}
          <label className="fg-item">
            <span>Particulars</span>
            <select
              value={form.Particulars}
              onChange={(e) => onParticulars(e.target.value)}
              required
            >
              <option value="">Choose product/service</option>
              {pricing.map((p, i) => (
                <option key={`${p.Particulars}-${i}`} value={p.Particulars}>
                  {p.Particulars}
                </option>
              ))}
            </select>
          </label>

          {/* Start / End dates (validity) */}
          <label className="fg-item">
            <span>Start Date</span>
            <input
              type="date"
              value={form.StartDate}
              onChange={(e) => onStartDate(e.target.value)}
            />
          </label>
          <label className="fg-item">
            <span>End Date</span>
            <input type="date" value={form.EndDate} readOnly disabled />
          </label>

          {/* Mode (Cash/GCash, required, no prefill) */}
          <label className="fg-item">
            <span>Mode</span>
            <select
              value={form.Mode}
              onChange={(e) => onChange("Mode", e.target.value)}
              required
            >
              <option value="">Select mode…</option>
              <option value="Cash">Cash</option>
              <option value="GCash">GCash</option>
            </select>
          </label>

          {/* Cost (prefilled, locked) */}
          <label className="fg-item">
            <span>Cost</span>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={form.Cost}
              readOnly
              disabled
            />
          </label>
        </div>

        <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 12 }}>
          Validity is applied inclusive of the Start Date.
        </div>

        <div style={{ marginTop: 12 }}>
          <button className="primary-btn" disabled={busy} type="submit">
            + Add Payment
          </button>
        </div>
      </form>

      {/* Table card */}
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 16,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 10 }}>
          Payment Records {rows.length ? `· ₱${total.toFixed(2)}` : ""}
        </div>

        <table className="attendance-table aligned">
          <thead>
            <tr>
              <th>Date</th>
              <th>Time</th>
              <th>MemberID</th>
              <th>Particulars</th>
              <th>Start Date</th>
              <th>End Date</th>
              <th>Mode</th>
              <th style={{ textAlign: "right" }}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ color: "var(--muted)", textAlign: "center", padding: 16 }}>
                  No payments found.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i}>
                  <td>{fmtDateTime(`${r.Date}T${r.Time || "00:00"}:00+08:00`)}</td>
                  <td>{fmtManilaTime(`${r.Date}T${r.Time || "00:00"}:00+08:00`)}</td>
                  <td>{r.MemberID}</td>
                  <td>{r.Particulars}</td>
                  <td>{r.StartDate ? fmtManilaDate(r.StartDate) : "—"}</td>
                  <td>{r.EndDate ? fmtManilaDate(r.EndDate) : "—"}</td>
                  <td>{r.Mode}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>₱{Number(r.Cost || 0).toFixed(2)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
