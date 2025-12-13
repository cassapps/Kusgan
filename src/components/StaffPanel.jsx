import React, { useEffect, useState } from "react";
import useLoadMore from "../lib/useLoadMore.js";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

export default function StaffPanel() {
  const [list, setList] = useState([]);
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("PRIMARY ATTENDANT");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pager = useLoadMore(list, { initial: 20, step: 20, resetDeps: [list.length] });

  async function load() {
    setError("");
    try {
      const r = await fetch(`${API}/staff`);
      const data = await r.json();
      setList(data);
    } catch (e) {
      setError("Cannot reach API. Is the backend running on http://localhost:4000 ?");
    }
  }

  useEffect(() => { load(); }, []);

  async function addStaff(e) {
    e.preventDefault();
    if (!fullName.trim()) return;

    setSaving(true);
    setError("");
    try {
      const r = await fetch(`${API}/staff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName.trim(), role }),
      });
      if (!r.ok) throw new Error(await r.text());
      setFullName("");
      setRole("PRIMARY ATTENDANT");
      await load();
    } catch (e) {
      setError("Save failed: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="content">
      <h2>Staff</h2>

      <form onSubmit={addStaff} style={{display:"grid", gap:12, maxWidth:420, marginBottom:18}}>
        <input
          value={fullName}
          onChange={e=>setFullName(e.target.value)}
          placeholder="Full name"
        />
        <select value={role} onChange={e=>setRole(e.target.value)}>
          <option>PRIMARY ATTENDANT</option>
          <option>ASSISTANT</option>
          <option>COACH</option>
          <option>ADMIN</option>
        </select>
        <button className="button" disabled={saving}>{saving ? "Saving..." : "Add Staff"}</button>
        {error && <div className="badge warn">{error}</div>}
      </form>

      <table>
        <thead>
          <tr>
            <th>Name</th><th>Role</th><th>Created</th>
          </tr>
        </thead>
        <tbody>
          {pager.visible.map(s => (
            <tr key={s.id}>
              <td>{s.full_name}</td>
              <td><span className="badge info">{s.role}</span></td>
              <td>{new Date(s.created_at || s.createdAt || Date.now()).toLocaleString()}</td>
            </tr>
          ))}
          {list.length === 0 && (
            <tr><td colSpan={3}>No staff yet. Add one above.</td></tr>
          )}
        </tbody>
      </table>

      {pager.canLoadMore && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="pill white" type="button" onClick={pager.loadMore} style={{ cursor: 'pointer' }}>
            Load 20 more
          </button>
        </div>
      )}
    </div>
  );
}
