import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import displayName from "../lib/displayName";
import { fmtDate, fmtDateTime, display } from "./MemberDetail.jsx";
import ModalWrapper from "../components/ModalWrapper.jsx";
import { getMemberPills } from "../lib/discount.js";
import useLoadMore from "../lib/useLoadMore.js";

const {
  fetchMembers,
  listenMembers,
  listenPaymentsForMonth,
  fetchPaymentsForMonth,
  fetchExpensesForMonth,
  listenExpensesForMonth,
  fetchRevenuesForMonth,
  listenRevenuesForMonth,
  addExpense,
  addRevenue,
} = api;

const MANILA_TZ = "Asia/Manila";
const manilaTodayYMD = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

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
  const navigate = useNavigate();

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
  const [revenuesMonth, setRevenuesMonth] = useState([]);
  const [expensesMonth, setExpensesMonth] = useState([]);
  const [totalsByMonth, setTotalsByMonth] = useState({}); // { [monthKey]: { revenue, expenses } }

  const [revCollapsed, setRevCollapsed] = useState(true);
  const [expCollapsed, setExpCollapsed] = useState(true);
  const [openAddRevenue, setOpenAddRevenue] = useState(false);
  const [openAddExpense, setOpenAddExpense] = useState(false);
  const [revenueForm, setRevenueForm] = useState({ Date: manilaTodayYMD(), Category: "Grocery", Particulars: "", Mode: "Cash", Cost: "" });
  const [expenseForm, setExpenseForm] = useState({ Date: manilaTodayYMD(), Category: "Equipment", Item: "", Cost: "" });
  const [revBusy, setRevBusy] = useState(false);
  const [expBusy, setExpBusy] = useState(false);
  const [revErr, setRevErr] = useState("");
  const [expErr, setExpErr] = useState("");

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

  // Monthly manual revenues (realtime in Firestore mode).
  useEffect(() => {
    if (!useFirestore) {
      (async () => {
        try {
          const r = await fetchRevenuesForMonth(selectedMonthKey);
          setRevenuesMonth(r?.rows || []);
        } catch (e) {
          setRevenuesMonth([]);
        }
      })();
      return;
    }
    let unsub = null;
    try {
      unsub = listenRevenuesForMonth(selectedMonthKey, (rows) => setRevenuesMonth(rows || []), () => {});
    } catch (e) {
      unsub = null;
    }
    return () => { try { unsub && unsub(); } catch (e) {} };
  }, [useFirestore, selectedMonthKey]);

  // Monthly expenses (realtime in Firestore mode).
  useEffect(() => {
    if (!useFirestore) {
      (async () => {
        try {
          const r = await fetchExpensesForMonth(selectedMonthKey);
          setExpensesMonth(r?.rows || []);
        } catch (e) {
          setExpensesMonth([]);
        }
      })();
      return;
    }
    let unsub = null;
    try {
      unsub = listenExpensesForMonth(selectedMonthKey, (rows) => setExpensesMonth(rows || []), () => {});
    } catch (e) {
      unsub = null;
    }
    return () => { try { unsub && unsub(); } catch (e) {} };
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
        const [payRes, revRes, expRes] = await Promise.all([
          fetchPaymentsForMonth(mk),
          fetchRevenuesForMonth(mk),
          fetchExpensesForMonth(mk),
        ]);
        if (!alive) return;
        const revenue = sumRevenue(payRes?.rows || payRes?.data || []) + sumRevenue(revRes?.rows || revRes?.data || []);
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

  // Keep selected month totals in sync with live table rows (payments + manual revenues + expenses).
  useEffect(() => {
    const rev =
      (paymentsMonth || []).reduce((s, p) => s + (parseFloat(p?.Cost || p?.amount || 0) || 0), 0) +
      (revenuesMonth || []).reduce((s, r) => s + (parseFloat(r?.Cost || r?.amount || 0) || 0), 0);
    const exp = (expensesMonth || []).reduce((s, e) => s + (parseFloat(e?.Amount || e?.amount || 0) || 0), 0);
    setTotalsByMonth((prev) => ({
      ...(prev || {}),
      [selectedMonthKey]: { revenue: rev, expenses: exp },
    }));
  }, [selectedMonthKey, paymentsMonth, revenuesMonth, expensesMonth]);

  const monthlyRevenue = useMemo(() => {
    const pay = (paymentsMonth || []).reduce((sum, p) => sum + (parseFloat(p?.Cost || p?.amount || 0) || 0), 0);
    const manual = (revenuesMonth || []).reduce((sum, r) => sum + (parseFloat(r?.Cost || r?.amount || 0) || 0), 0);
    return pay + manual;
  }, [paymentsMonth, revenuesMonth]);

  const monthlyExpenses = useMemo(() => {
    return (expensesMonth || []).reduce((sum, e) => sum + (parseFloat(e?.Amount || e?.amount || 0) || 0), 0);
  }, [expensesMonth]);

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

    const paymentTagged = (paymentsMonth || []).map((p) => ({ kind: 'payment', row: p }));
    const revenueTagged = (revenuesMonth || []).map((r) => ({ kind: 'revenue', row: r }));

    const sorted = [...paymentTagged, ...revenueTagged].sort((a, b) => {
      const av = candidates(a.row);
      const bv = candidates(b.row);
      return (parseTs(bv) || 0) - (parseTs(av) || 0);
    });

    return sorted.map((it, idx) => {
      const p = it.row || {};
      const isManual = it.kind === 'revenue';
      const pid = String(p.MemberID || p.member_id || p.id || p.member || "").trim();
      const member = !isManual ? (members || []).find((m) => {
        if (!pid) return false;
        return String(m.MemberID || m.member_id || m.id || "").trim() === pid;
      }) : null;
      const memberId = !isManual ? String(member?.MemberID || member?.member_id || member?.id || pid || "").trim() : "";
      const paidRaw = candidates(p);
      const nickCell = isManual ? (p.Category || p.category || '-') : displayName(member);
      const pills = !isManual && member ? getMemberPills(member) : [];
      const particulars = isManual
        ? (p.Particulars || p.particulars || '-')
        : (p.Particulars || p.particulars || p.type || p.item || p.category || p.product || p.paymentfor || p.plan || p.description);

      const isClickable = !isManual && !!memberId;
      const onRowClick = isClickable
        ? () => {
            try {
              navigate(`/members/${encodeURIComponent(memberId)}`, { state: { row: member } });
            } catch (e) {}
          }
        : undefined;

      return (
        <tr
          key={idx}
          className={isClickable ? "row-link" : undefined}
          onClick={onRowClick}
          style={isClickable ? { cursor: 'pointer' } : undefined}
        >
          <td>{display(fmtDateTime(paidRaw))}</td>
          <td style={{ textAlign: 'center' }}>
            {isManual ? (
              display(nickCell)
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                <strong>{display(String(nickCell || '').toUpperCase())}</strong>
                {pills.length > 0 && (
                  <span style={{ display: 'inline-flex', gap: 6 }}>
                    {pills.map(p => <span key={p.key} className={`pill ${p.className}`}>{p.label}</span>)}
                  </span>
                )}
              </span>
            )}
          </td>
          <td>{display(particulars)}</td>
          <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>{display(p.Mode || p.mode || p.method)}</td>
          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{display((parseFloat(p.Cost || p.amount || 0) || 0).toLocaleString())}</td>
        </tr>
      );
    });
  }, [paymentsMonth, revenuesMonth, members]);

  const revenuePager = useLoadMore(monthlyRows, { initial: 20, step: 20, resetDeps: [selectedMonthKey, revCollapsed] });

  const expenseRows = useMemo(() => {
    const candidates = (e) => e.timestamp || e.created || e.createdAt || e.date || e.Date || null;
    const parseTs = (v) => {
      if (!v && v !== 0) return 0;
      if (typeof v === 'number') return v;
      try { if (v && typeof v.toMillis === 'function') return v.toMillis(); } catch (e) {}
      try { if (v && typeof v.seconds === 'number') return v.seconds * 1000; } catch (e) {}
      const parsed = Date.parse(String(v));
      return isNaN(parsed) ? 0 : parsed;
    };
    const sorted = [...(expensesMonth || [])].sort((a, b) => (parseTs(candidates(b)) || 0) - (parseTs(candidates(a)) || 0));
    return sorted.map((e, idx) => {
      const dt = candidates(e) || (e.Date ? `${e.Date}T00:00:00+08:00` : null);
      return (
        <tr key={idx}>
          <td>{display(fmtDateTime(dt))}</td>
          <td>{display(e.Category || e.category)}</td>
          <td>{display(e.Item || e.item)}</td>
          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{display((parseFloat(e.Amount || e.amount || 0) || 0).toLocaleString())}</td>
        </tr>
      );
    });
  }, [expensesMonth]);

  const expensesPager = useLoadMore(expenseRows, { initial: 20, step: 20, resetDeps: [selectedMonthKey, expCollapsed] });

  const resetRevenueForm = () => {
    setRevenueForm({ Date: manilaTodayYMD(), Category: "Grocery", Particulars: "", Mode: "Cash", Cost: "" });
    setRevErr("");
  };

  const resetExpenseForm = () => {
    setExpenseForm({ Date: manilaTodayYMD(), Category: "Equipment", Item: "", Cost: "" });
    setExpErr("");
  };

  const saveRevenue = async () => {
    try {
      setRevErr("");
      const date = String(revenueForm.Date || '').trim();
      const category = String(revenueForm.Category || '').trim();
      const particulars = String(revenueForm.Particulars || '').trim();
      const mode = String(revenueForm.Mode || '').trim();
      const cost = String(revenueForm.Cost || '').trim();
      const amt = parseFloat(cost);
      if (!date) return setRevErr('Date is required');
      if (!category) return setRevErr('Category is required');
      if (!particulars) return setRevErr('Particulars is required');
      if (!mode) return setRevErr('Mode is required');
      if (!cost || Number.isNaN(amt)) return setRevErr('Cost must be a number');
      setRevBusy(true);
      await addRevenue({ Date: date, Category: category, Particulars: particulars, Mode: mode, Cost: amt });
      setOpenAddRevenue(false);
      resetRevenueForm();
    } catch (e) {
      setRevErr(e?.message || 'Failed to add revenue');
    } finally {
      setRevBusy(false);
    }
  };

  const saveExpense = async () => {
    try {
      setExpErr("");
      const date = String(expenseForm.Date || '').trim();
      const category = String(expenseForm.Category || '').trim();
      const item = String(expenseForm.Item || '').trim();
      const cost = String(expenseForm.Cost || '').trim();
      const amt = parseFloat(cost);
      if (!date) return setExpErr('Date is required');
      if (!category) return setExpErr('Category is required');
      if (!item) return setExpErr('Item is required');
      if (!cost || Number.isNaN(amt)) return setExpErr('Cost must be a number');
      setExpBusy(true);
      await addExpense({ Date: date, Category: category, Item: item, Amount: amt });
      setOpenAddExpense(false);
      resetExpenseForm();
    } catch (e) {
      setExpErr(e?.message || 'Failed to add expense');
    } finally {
      setExpBusy(false);
    }
  };

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

        {/* Row 2: revenue/expenses/profit */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 32, maxWidth: 1100, margin: "32px auto 0" }}>
          <div className="dashboard-card">
            <div className="dashboard-label">Month Revenue</div>
            <div className="dashboard-value magenta">₱ {Number(monthlyRevenue || 0).toLocaleString()}</div>
          </div>
          <div className="dashboard-card">
            <div className="dashboard-label">Month Expenses</div>
            <div className="dashboard-value magenta">₱ {Number(monthlyExpenses || 0).toLocaleString()}</div>
          </div>
          <div className="dashboard-card">
            <div className="dashboard-label">Month Profit</div>
            <div className="dashboard-value magenta">₱ {Number(monthlyProfit || 0).toLocaleString()}</div>
          </div>
        </div>

        {/* Revenue table moved from Dashboard */}
        <div style={{ marginTop: 24 }} className="panel">
          <div className="panel-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span>Revenue</span>
            <div style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
              <button className="button" type="button" onClick={() => setRevCollapsed(v => !v)} style={{ background: '#eee', color: '#333' }}>
                {revCollapsed ? 'Expand' : 'Collapse'}
              </button>
              <button className="button" type="button" onClick={() => { resetRevenueForm(); setOpenAddRevenue(true); }}>
                Add Revenue
              </button>
            </div>
          </div>

          {!revCollapsed && (
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
                {(!revenuePager.visible || (Array.isArray(revenuePager.visible) && revenuePager.visible.length === 0)) ? (
                  <tr>
                    <td colSpan={5}>-</td>
                  </tr>
                ) : (
                  revenuePager.visible
                )}
              </tbody>
            </table>
          )}

          {!revCollapsed && revenuePager.canLoadMore && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="load-more-link" type="button" onClick={revenuePager.loadMore}>
                Load 20 more
              </button>
            </div>
          )}
        </div>

        {/* Expenses section */}
        <div style={{ marginTop: 24 }} className="panel">
          <div className="panel-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span>Expenses</span>
            <div style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
              <button className="button" type="button" onClick={() => setExpCollapsed(v => !v)} style={{ background: '#eee', color: '#333' }}>
                {expCollapsed ? 'Expand' : 'Collapse'}
              </button>
              <button className="button" type="button" onClick={() => { resetExpenseForm(); setOpenAddExpense(true); }}>
                Add Expense
              </button>
            </div>
          </div>

          {!expCollapsed && (
            <table className="aligned payments-table">
              <colgroup>
                <col style={{ width: '28%' }} />
                <col style={{ width: '24%' }} />
                <col style={{ width: '28%' }} />
                <col style={{ width: '20%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Item</th>
                  <th style={{ textAlign: 'right' }}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {(!expensesPager.visible || (Array.isArray(expensesPager.visible) && expensesPager.visible.length === 0)) ? (
                  <tr><td colSpan={4}>-</td></tr>
                ) : (
                  expensesPager.visible
                )}
              </tbody>
            </table>
          )}

          {!expCollapsed && expensesPager.canLoadMore && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="load-more-link" type="button" onClick={expensesPager.loadMore}>
                Load 20 more
              </button>
            </div>
          )}
        </div>

        <ModalWrapper
          open={openAddRevenue}
          onClose={() => { setOpenAddRevenue(false); }}
          title="Add Revenue"
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Date</div>
              <input
                value={revenueForm.Date}
                onChange={(e) => setRevenueForm((p) => ({ ...p, Date: e.target.value }))}
                type="date"
                style={{ width: '100%', height: 44, padding: '10px 12px', border: '1px solid #e7e8ef', borderRadius: 10, fontSize: 16 }}
              />
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Category</div>
              <select
                value={revenueForm.Category}
                onChange={(e) => setRevenueForm((p) => ({ ...p, Category: e.target.value }))}
                style={{ width: '100%', height: 44, padding: '10px 12px', border: '1px solid #e7e8ef', borderRadius: 10, fontSize: 16 }}
              >
                <option value="Grocery">Grocery</option>
                <option value="Others">Others</option>
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Particulars</div>
              <input
                value={revenueForm.Particulars}
                onChange={(e) => setRevenueForm((p) => ({ ...p, Particulars: e.target.value }))}
                placeholder="Particulars"
                style={{ width: '100%', height: 44, padding: '10px 12px', border: '1px solid #e7e8ef', borderRadius: 10, fontSize: 16 }}
              />
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Mode</div>
              <select
                value={revenueForm.Mode}
                onChange={(e) => setRevenueForm((p) => ({ ...p, Mode: e.target.value }))}
                style={{ width: '100%', height: 44, padding: '10px 12px', border: '1px solid #e7e8ef', borderRadius: 10, fontSize: 16 }}
              >
                <option value="Cash">Cash</option>
                <option value="GCash">GCash</option>
              </select>
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Cost</div>
              <input
                value={revenueForm.Cost}
                onChange={(e) => setRevenueForm((p) => ({ ...p, Cost: e.target.value }))}
                inputMode="decimal"
                placeholder="0"
                style={{ width: '100%', height: 44, padding: '10px 12px', border: '1px solid #e7e8ef', borderRadius: 10, fontSize: 16 }}
              />
            </div>
          </div>
          {revErr && <div style={{ marginTop: 12, color: 'crimson', fontWeight: 700 }}>{revErr}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <button className="button" type="button" onClick={() => { setOpenAddRevenue(false); }} style={{ background: '#eee', color: '#333' }}>
              Cancel
            </button>
            <button className="button" type="button" disabled={revBusy} onClick={saveRevenue}>
              {revBusy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </ModalWrapper>

        <ModalWrapper
          open={openAddExpense}
          onClose={() => { setOpenAddExpense(false); }}
          title="Add Expense"
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Date</div>
              <input
                value={expenseForm.Date}
                onChange={(e) => setExpenseForm((p) => ({ ...p, Date: e.target.value }))}
                type="date"
                style={{ width: '100%', height: 44, padding: '10px 12px', border: '1px solid #e7e8ef', borderRadius: 10, fontSize: 16 }}
              />
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Category</div>
              <select
                value={expenseForm.Category}
                onChange={(e) => setExpenseForm((p) => ({ ...p, Category: e.target.value }))}
                style={{ width: '100%', height: 44, padding: '10px 12px', border: '1px solid #e7e8ef', borderRadius: 10, fontSize: 16 }}
              >
                <option value="Equipment">Equipment</option>
                <option value="Grocery">Grocery</option>
                <option value="Rent">Rent</option>
                <option value="Utilities">Utilities</option>
                <option value="Salary">Salary</option>
                <option value="Others">Others</option>
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Item</div>
              <input
                value={expenseForm.Item}
                onChange={(e) => setExpenseForm((p) => ({ ...p, Item: e.target.value }))}
                placeholder="Item"
                style={{ width: '100%', height: 44, padding: '10px 12px', border: '1px solid #e7e8ef', borderRadius: 10, fontSize: 16 }}
              />
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Cost</div>
              <input
                value={expenseForm.Cost}
                onChange={(e) => setExpenseForm((p) => ({ ...p, Cost: e.target.value }))}
                inputMode="decimal"
                placeholder="0"
                style={{ width: '100%', height: 44, padding: '10px 12px', border: '1px solid #e7e8ef', borderRadius: 10, fontSize: 16 }}
              />
            </div>
            <div />
          </div>
          {expErr && <div style={{ marginTop: 12, color: 'crimson', fontWeight: 700 }}>{expErr}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <button className="button" type="button" onClick={() => { setOpenAddExpense(false); }} style={{ background: '#eee', color: '#333' }}>
              Cancel
            </button>
            <button className="button" type="button" disabled={expBusy} onClick={saveExpense}>
              {expBusy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </ModalWrapper>
      </div>
    </div>
  );
}
