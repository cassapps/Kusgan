import { useEffect, useMemo, useState } from "react";
import api from "../api";
import displayName from "../lib/displayName";
import { fmtDate, fmtDateTime, display } from "./MemberDetail.jsx";

const { fetchMembers, listenMembers, listenPaymentsForMonth, fetchPaymentsForMonth, fetchExpensesForMonth } = api;

function monthKeyForDate(d) {
  try {
    if (!d || isNaN(d)) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  } catch (e) {
    return "";
  }
}

function monthKeyToLabel(monthKey) {
  try {
    const [y, m] = String(monthKey || "").split("-").map(Number);
    if (!y || !m) return String(monthKey || "");
    const d = new Date(y, m - 1, 1);
    return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(d);
  } catch (e) {
    return String(monthKey || "");
  }
}

function monthKeyPrev(monthKey) {
  try {
    const [y0, m0] = String(monthKey || "").split("-").map(Number);
    if (!y0 || !m0) return "";
    const d = new Date(y0, m0 - 1, 1);
    d.setMonth(d.getMonth() - 1);
    return monthKeyForDate(d);
  } catch (e) {
    return "";
  }
}

function monthKeysBetween(startKey, endKey) {
  const out = [];
  try {
    const [sy, sm] = String(startKey || "").split("-").map(Number);
    const [ey, em] = String(endKey || "").split("-").map(Number);
    if (!sy || !sm || !ey || !em) return out;
    const cur = new Date(sy, sm - 1, 1);
    const end = new Date(ey, em - 1, 1);
    while (cur <= end) {
      out.push(monthKeyForDate(cur));
      cur.setMonth(cur.getMonth() + 1);
    }
    return out;
  } catch (e) {
    return out;
  }
}

export default function Reports() {
  const useFirestore = String(import.meta.env.VITE_USE_FIRESTORE ?? "true") === "true";

  const START_MONTH = "2025-11";

  const monthOptions = useMemo(() => {
    const out = [];
    const start = new Date(2025, 10, 1); // Nov 2025
    const now = new Date();
    const cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur <= now) {
      const key = monthKeyForDate(cur);
      out.push({ key, label: monthKeyToLabel(key) });
      cur.setMonth(cur.getMonth() + 1);
    }
    return out;
  }, []);

  const defaultMonthKey = useMemo(() => {
    const cur = monthKeyForDate(new Date());
    return cur && cur >= START_MONTH ? cur : START_MONTH;
  }, []);

  const [selectedMonthKey, setSelectedMonthKey] = useState(defaultMonthKey);
  const [members, setMembers] = useState([]);
  const [paymentsMonth, setPaymentsMonth] = useState([]);
  const [totalsByMonth, setTotalsByMonth] = useState({}); // { [monthKey]: { revenue, expenses } }

  useEffect(() => {
    if (!useFirestore) {
      // legacy mode: just fetch members once
      (async () => {
        try {
          const m = await fetchMembers();
          setMembers(m?.rows || m?.data || []);
        } catch (e) {
          setMembers([]);
        }
      })();
      return;
    }

    let unsub = null;
    try {
      unsub = listenMembers((rows) => setMembers(rows || []), () => {});
    } catch (e) {
      unsub = null;
    }
    return () => {
      try {
        unsub && unsub();
      } catch (e) {}
    };
  }, [useFirestore]);

  // Monthly payments rows for the table (realtime in Firestore mode).
  useEffect(() => {
    if (!useFirestore) {
      (async () => {
        try {
          const r = await fetchPaymentsForMonth(selectedMonthKey);
          setPaymentsMonth(r?.rows || []);
        } catch (e) {
          setPaymentsMonth([]);
        }
      })();
      return;
    }

    let unsub = null;
    try {
      unsub = listenPaymentsForMonth(selectedMonthKey, (rows) => {
        setPaymentsMonth(rows || []);
      });
    } catch (e) {
      unsub = null;
    }
    return () => {
      try {
        unsub && unsub();
      } catch (e) {}
    };
  }, [useFirestore, selectedMonthKey]);

  // Compute totals (revenue + expenses) for months needed to derive balances.
  useEffect(() => {
    let alive = true;

    const sumRevenue = (rows) =>
      (rows || []).reduce((sum, p) => sum + (parseFloat(p?.Cost || p?.amount || 0) || 0), 0);

    const sumExpenses = (rows) =>
      (rows || []).reduce((sum, e) => sum + (parseFloat(e?.Amount || e?.amount || 0) || 0), 0);

    const ensureMonth = async (mk) => {
      if (!mk) return;
      setTotalsByMonth((prev) => {
        if (prev && prev[mk]) return prev;
        return { ...(prev || {}), [mk]: { revenue: 0, expenses: 0, _loading: true } };
      });
      try {
        const [payRes, expRes] = await Promise.all([
          fetchPaymentsForMonth(mk),
          fetchExpensesForMonth(mk),
        ]);
        if (!alive) return;
        const revenue = sumRevenue(payRes?.rows || payRes?.data || []);
        const expenses = sumExpenses(expRes?.rows || expRes?.data || []);
        setTotalsByMonth((prev) => ({
          ...(prev || {}),
          [mk]: { revenue, expenses },
        }));
      } catch (e) {
        if (!alive) return;
        setTotalsByMonth((prev) => ({
          ...(prev || {}),
          [mk]: { revenue: 0, expenses: 0 },
        }));
      }
    };

    (async () => {
      const needed = monthKeysBetween(START_MONTH, selectedMonthKey);
      for (const mk of needed) {
        if (!alive) return;
        if (totalsByMonth && totalsByMonth[mk] && !totalsByMonth[mk]._loading) continue;
        // eslint-disable-next-line no-await-in-loop
        await ensureMonth(mk);
      }
    })();

    return () => {
      alive = false;
    };
  }, [selectedMonthKey]);

  const monthlyRevenue = useMemo(() => {
    return (paymentsMonth || []).reduce((sum, p) => sum + (parseFloat(p?.Cost || p?.amount || 0) || 0), 0);
  }, [paymentsMonth]);

  const monthlyExpenses = useMemo(() => {
    const t = totalsByMonth?.[selectedMonthKey];
    return t ? (parseFloat(t.expenses) || 0) : 0;
  }, [totalsByMonth, selectedMonthKey]);

  const monthlyProfit = useMemo(() => (monthlyRevenue || 0) - (monthlyExpenses || 0), [monthlyRevenue, monthlyExpenses]);

  const { monthStartBalance, monthEndBalance } = useMemo(() => {
    // Base: Nov 2025 starts at 0
    const keys = monthKeysBetween(START_MONTH, selectedMonthKey);
    let bal = 0;
    for (const mk of keys) {
      const t = totalsByMonth?.[mk];
      const rev = parseFloat(t?.revenue || 0) || 0;
      const exp = parseFloat(t?.expenses || 0) || 0;
      if (mk === selectedMonthKey) {
        const start = bal;
        const end = bal + (rev - exp);
        return { monthStartBalance: start, monthEndBalance: end };
      }
      bal = bal + (rev - exp);
    }
    return { monthStartBalance: 0, monthEndBalance: 0 };
  }, [totalsByMonth, selectedMonthKey]);

  const monthlyRows = useMemo(() => {
    const candidates = (p) => p.timestamp || p.created || p.paid_on || p.createdAt || p.date || p.Date || p.pay_date || null;
    const parseTs = (v) => {
      if (!v && v !== 0) return 0;
      if (typeof v === "number") return v;
      try {
        if (v && typeof v.toMillis === "function") return v.toMillis();
      } catch (e) {}
      try {
        if (v && typeof v.seconds === "number") return v.seconds * 1000;
      } catch (e) {}
      const parsed = Date.parse(String(v));
      return isNaN(parsed) ? 0 : parsed;
    };

    const sorted = [...(paymentsMonth || [])].sort((a, b) => (parseTs(candidates(b)) || 0) - (parseTs(candidates(a)) || 0));

    return sorted.map((p, idx) => {
      const pid = String(p.MemberID || p.member_id || p.id || p.member || "").trim();
      const member = (members || []).find((m) => {
        if (!pid) return false;
        return String(m.MemberID || m.member_id || m.id || "").trim() === pid;
      });
      const paidRaw = candidates(p);
      return (
        <tr key={idx}>
          <td>{display(fmtDateTime(paidRaw))}</td>
          <td>{displayName(member)}</td>
          <td>{display(p.Particulars || p.particulars || p.type || p.item || p.category || p.product || p.paymentfor || p.plan || p.description)}</td>
          <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>{display(p.Mode || p.mode || p.method)}</td>
          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{display((parseFloat(p.Cost || p.amount || 0) || 0).toLocaleString())}</td>
        </tr>
      );
    });
  }, [paymentsMonth, members]);

  return (
    <div className="dashboard-content">
      <h2 className="dashboard-title">Monthly Reports</h2>

      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "0 0 24px", flexWrap: "wrap" }}>
          <select
            value={selectedMonthKey}
            onChange={(e) => setSelectedMonthKey(e.target.value)}
            style={{ width: 320, height: 52, padding: "10px 14px", border: "1px solid #e7e8ef", borderRadius: 10, fontSize: 18 }}
          >
            {monthOptions.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Row 1: balances */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 32, maxWidth: 1100, margin: "0 auto" }}>
          <div className="dashboard-card">
            <div className="dashboard-label">Month Start Balance</div>
            <div className="dashboard-value magenta">₱ {Number(monthStartBalance || 0).toLocaleString()}</div>
          </div>
          <div className="dashboard-card">
            <div className="dashboard-label">Month End Balance</div>
            <div className="dashboard-value magenta">₱ {Number(monthEndBalance || 0).toLocaleString()}</div>
          </div>
        </div>

        {/* Row 2: expenses/revenue/profit */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 32, maxWidth: 1100, margin: "32px auto 0" }}>
          <div className="dashboard-card">
            <div className="dashboard-label">Monthy Expenses</div>
            <div className="dashboard-value magenta">₱ {Number(monthlyExpenses || 0).toLocaleString()}</div>
          </div>
          <div className="dashboard-card">
            <div className="dashboard-label">Monthly Revenue</div>
            <div className="dashboard-value magenta">₱ {Number(monthlyRevenue || 0).toLocaleString()}</div>
          </div>
          <div className="dashboard-card">
            <div className="dashboard-label">Monthly Profit</div>
            <div className="dashboard-value magenta">₱ {Number(monthlyProfit || 0).toLocaleString()}</div>
          </div>
        </div>

        {/* Monthly Revenue Table moved from Dashboard */}
        <div style={{ marginTop: 24 }} className="panel">
          <div className="panel-header">Monthly Revenue</div>
          <table className="aligned payments-table">
            <colgroup>
              <col style={{ width: "24%" }} />
              <col style={{ width: "24%" }} />
              <col style={{ width: "24%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "14%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Date</th>
                <th>Nickname</th>
                <th>Particulars</th>
                <th style={{ textAlign: "center" }}>Mode</th>
                <th style={{ textAlign: "right" }}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {(!monthlyRows || (Array.isArray(monthlyRows) && monthlyRows.length === 0)) ? (
                <tr>
                  <td colSpan={5}>-</td>
                </tr>
              ) : (
                monthlyRows
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
