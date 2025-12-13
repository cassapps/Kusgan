import { useEffect, useMemo, useState } from 'react';
import apiClient from '../lib/apiClient';
import api from '../api';
import useLoadMore from '../lib/useLoadMore.js';
const { fetchPricing } = api;

export default function AdminPage() {
  const [staffName, setStaffName] = useState('');
  const [staffRole, setStaffRole] = useState('Staff');
  const [msg, setMsg] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [password, setPassword] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingPrice, setEditingPrice] = useState('');
  const [users, setUsers] = useState([]);
  const [resettingId, setResettingId] = useState(null);
  const [resetPassword, setResetPassword] = useState('');

  const buttonStyle = { padding: '8px 12px', fontSize: 14, lineHeight: '1', minHeight: 36 };

  // products stored in localStorage for now
  const [products, setProducts] = useState([]);
  const [prodName, setProdName] = useState('');
  const [prodPrice, setProdPrice] = useState('');
  const [pricingRows, setPricingRows] = useState([]);
  const [prodGym, setProdGym] = useState('No');
  const [prodCoach, setProdCoach] = useState('No');
  const [prodValidity, setProdValidity] = useState('');
  const [editingValidity, setEditingValidity] = useState('');
  const [showAddMerch, setShowAddMerch] = useState(false);
  const [merchName, setMerchName] = useState('');
  const [merchPrice, setMerchPrice] = useState('');

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await apiClient.fetchWithAuth('/products');
        if (!mounted) return;
        if (!res.ok) {
          setProducts([]);
          return;
        }
        const rows = await res.json().catch(() => []);
        setProducts(rows || []);
      } catch (e) {
        setProducts([]);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // load pricing rules for admin view
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const p = await fetchPricing();
        if (!mounted) return;
        setPricingRows(p?.rows || p?.data || []);
      } catch (e) {
        setPricingRows([]);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Combined view: merge products and pricing rules so everything shows in one table.
  const combinedPricing = (() => {
    // Build an index of pricingRows by Particulars/name for quick merge
    const idx = {};
    (pricingRows || []).forEach(r => {
      const name = String(r.Particulars || r.particulars || r.name || '').trim();
      if (!name) return;
      idx[name.toLowerCase()] = r;
    });

    const out = [];
    // Include all pricingRows first
    (pricingRows || []).forEach(r => {
      const name = String(r.Particulars || r.particulars || r.name || '').trim();
      if (!name) return;
      out.push({
        id: r.id || r.ID || r._id || null,
        particulars: name,
        gym: (r['Gym membership'] ?? r['Gym Membership'] ?? r.gym_membership ?? r.is_gym_membership ?? '') || '',
        coach: (r['Coach subscription'] ?? r['Coach Subscription'] ?? r.coach_subscription ?? r.is_coach_subscription ?? '') || '',
        cost: r.Cost || r.cost || r.Price || r.price || '',
        validity: r.Validity || r.validity || r.validity_days || r.ValidityDays || 0,
        source: 'pricing',
        raw: r,
      });
    });

    // Include products that aren't already represented in pricingRows
    (products || []).forEach(p => {
      const name = String(p.name || p.Particulars || p.particulars || '').trim();
      if (!name) return;
      if (idx[name.toLowerCase()]) return; // already present
      out.push({
        id: p.id || null,
        particulars: name,
        gym: (p.is_gym_membership || p.is_gym || (p.gym ? 'Yes' : 'No')) ? (p.is_gym_membership ? 'Yes' : (p.gym ? 'Yes' : 'No')) : (p.is_gym_membership === false ? 'No' : ''),
        coach: (p.is_coach_subscription || p.is_coach || (p.coach ? 'Yes' : 'No')) ? (p.is_coach_subscription ? 'Yes' : (p.coach ? 'Yes' : 'No')) : (p.is_coach_subscription === false ? 'No' : ''),
        cost: p.price || p.Cost || p.cost || '',
        validity: p.validity_days || p.Validity || p.validity || 0,
        source: 'products',
        raw: p,
      });
    });

    return out;
  })();

  const grouped = (() => {
    const gymOnly = [];
    const coachOnly = [];
    const bundle = [];
    const merch = [];
    combinedPricing.forEach(r => {
      const gymYes = String(r.gym || '').toLowerCase().startsWith('y');
      const coachYes = String(r.coach || '').toLowerCase().startsWith('y');
      if (gymYes && !coachYes) gymOnly.push(r);
      else if (!gymYes && coachYes) coachOnly.push(r);
      else if (gymYes && coachYes) bundle.push(r);
      else merch.push(r);
    });
    return { gymOnly, coachOnly, bundle, merch };
  })();

  const pricingItems = useMemo(() => (
    [
      ...(grouped.gymOnly || []).map((r) => ({ group: 'gymOnly', r })),
      ...(grouped.coachOnly || []).map((r) => ({ group: 'coachOnly', r })),
      ...(grouped.bundle || []).map((r) => ({ group: 'bundle', r })),
      ...(grouped.merch || []).map((r) => ({ group: 'merch', r })),
    ]
  ), [grouped.gymOnly, grouped.coachOnly, grouped.bundle, grouped.merch]);

  const pricingPager = useLoadMore(pricingItems, {
    initial: 20,
    step: 20,
    resetDeps: [pricingRows.length, products.length],
  });

  const visiblePricingByGroup = useMemo(() => {
    const out = { gymOnly: [], coachOnly: [], bundle: [], merch: [] };
    pricingPager.visible.forEach(({ group, r }) => {
      if (out[group]) out[group].push(r);
    });
    return out;
  }, [pricingPager.visible]);

  // load users list
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await apiClient.fetchWithAuth('/users');
        if (!mounted) return;
        if (res && res.ok) {
          const rows = await res.json().catch(() => []);
          setUsers(rows || []);
          return;
        }
        // If /users failed (insufficient privileges or other), try to show current user
        try {
          const meRes = await apiClient.fetchWithAuth('/auth/me');
          if (meRes && meRes.ok) {
            const body = await meRes.json().catch(() => ({}));
            const username = body?.user?.username || '';
            if (username) setUsers([{ id: null, username }]);
            else setUsers([]);
            return;
          }
        } catch (e) {
          // ignore
        }
        setUsers([]);
      } catch (e) {}
    })();
    return () => { mounted = false; };
  }, []);

  const refreshUsers = async () => {
    try {
      let res;
      try {
        res = await apiClient.fetchWithAuth('/users');
      } catch (e) { res = null; }
      if (!res || !res.ok) {
        // try direct API host fallback
        try {
          const apiHost = `${window.location.protocol}//${window.location.hostname}:4000`;
          const token = apiClient.getToken && apiClient.getToken();
          const headers = {};
          if (token) headers['Authorization'] = `Bearer ${token}`;
          const fres = await fetch(`${apiHost}/users`, { headers });
          if (!fres.ok) { setUsers([]); return; }
          const rows = await fres.json().catch(() => []);
          setUsers(rows || []);
          return;
        } catch (ee) { setUsers([]); return; }
      }
      const rows = await res.json().catch(() => []);
      setUsers(rows || []);
    } catch (e) { setUsers([]); }
  };

  const refreshProducts = async () => {
    try {
      const res = await apiClient.fetchWithAuth('/products');
      if (!res.ok) return;
      const rows = await res.json().catch(() => []);
      setProducts(rows || []);
    } catch (e) {}
  };

  const addStaff = async (e) => {
    e && e.preventDefault();
    setMsg('');
    if (!staffName) return setMsg('Please enter username');
    setIsAdding(true);
    try {
      const res = await apiClient.fetchWithAuth('/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: staffName, role: staffRole })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        return setMsg(j.error || 'Failed to add staff');
      }
      const row = await res.json().catch(() => ({}));
      // Always create a login user for staff; generate a random password and show it in the message
      try {
        const generatedPassword = Math.random().toString(36).slice(-10);
        const passwordToUse = password || generatedPassword;
        // Try normal relative request first
        let ures;
        try {
          ures = await apiClient.fetchWithAuth('/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: staffName, password: passwordToUse, role: staffRole === 'Admin' ? 'admin' : 'staff' }) });
        } catch (e) {
          ures = null;
        }

        // If relative request failed or returned non-JSON/html (common when Vite dev server proxies not configured), try direct API host fallback
        if (!ures || !ures.ok) {
          // attempt fallback to localhost:4000
          try {
            const apiHost = `${window.location.protocol}//${window.location.hostname}:4000`;
            const token = apiClient.getToken && apiClient.getToken();
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const fres = await fetch(`${apiHost}/users`, { method: 'POST', headers, body: JSON.stringify({ username: staffName, password: passwordToUse, role: staffRole === 'Admin' ? 'admin' : 'staff' }) });
            if (!fres.ok) {
              let txt = '';
              try { txt = await fres.text(); } catch (ee) { txt = ''; }
              setMsg(`Staff added. User creation failed: ${fres.status} ${txt || fres.statusText || 'error'}`);
              setStaffName(''); setPassword(''); setIsAdding(false);
              return;
            }
            await refreshUsers();
            setMsg(`Staff added. User created (password: ${passwordToUse})`);
            setStaffName(''); setPassword(''); setIsAdding(false);
            return;
          } catch (e) {
            // fallback failed too
            setMsg('Staff added. User creation failed (network)');
            setStaffName(''); setPassword(''); setIsAdding(false);
            return;
          }
        }

        // If we get here, ures is ok
        try {
          await ures.json().catch(() => ({}));
        } catch (e) {
          // ignore parsing error but treat as success
        }
        await refreshUsers();
        setMsg(`Staff added. User created (password: ${passwordToUse})`);
        setStaffName(''); setPassword(''); setIsAdding(false);
      } catch (e) {
        setMsg('Staff added. User creation failed');
        setStaffName('');
        setPassword('');
        setIsAdding(false);
        return;
      }
    } catch (e) {
      setMsg('Server error');
      setIsAdding(false);
    }
  };

  const addProduct = (e) => {
    e && e.preventDefault();
    setMsg('');
    if (!prodName || !prodPrice) return setMsg('Please enter product name and price');
    (async () => {
      try {
        const payload = { name: prodName, price: Number(prodPrice) };
        const res = await apiClient.fetchWithAuth('/products', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          return setMsg(j.error || 'Failed to add product');
        }
        await refreshProducts();
        setProdName(''); setProdPrice(''); setMsg('Product added');
      } catch (e) { setMsg('Server error'); }
    })();
  };

  const toggleProductActive = (p) => {
    (async () => {
      try {
        const newActive = !Boolean(p.active);
        const res = await apiClient.fetchWithAuth(`/products/${p.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...p, active: newActive }) });
        if (!res.ok) return setMsg('Update failed');
        await refreshProducts();
        setMsg(newActive ? 'Product activated' : 'Product deactivated');
      } catch (e) { setMsg('Server error'); }
    })();
  };

  const toggleUserActive = (u) => {
    if (!u.id) { setMsg('Cannot change status for current user from here'); return; }
    (async () => {
      try {
        const newActive = !Boolean(u.active);
        const res = await apiClient.fetchWithAuth(`/users/${u.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...u, active: newActive }) });
        if (!res.ok) return setMsg('Update failed');
        await refreshUsers();
        setMsg(newActive ? 'User activated' : 'User deactivated');
      } catch (e) { setMsg('Server error'); }
    })();
  };

  return (
    <div className="content">
      <div className="panel">
        <div className="panel-header">Admin Console</div>
        <div style={{ color: 'var(--muted)', marginBottom: 8 }}>Add staff accounts and manage products/services.</div>

        <div className="panel" style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="panel-header">Users</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>{/* last refreshed placeholder */}</div>
              <button className="button" style={buttonStyle} onClick={() => { refreshUsers(); setMsg('Refreshed users'); }}>
                Refresh
              </button>
            </div>
          </div>
          <div style={{ marginTop: 6 }}>
            <form onSubmit={addStaff} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
              <input className="input-compact" value={staffName} onChange={e => setStaffName(e.target.value)} placeholder="username (e.g. jsmith)" style={{ width: 240 }} />
              <select className="select-compact" value={staffRole} onChange={e => setStaffRole(e.target.value)} style={{ width: 140 }}>
                <option>Staff</option>
                <option>Admin</option>
              </select>
              <input type="password" className="input-compact" placeholder="password (optional)" value={password} onChange={e => setPassword(e.target.value)} style={{ width: 180 }} />
              <button type="submit" className="button btn-compact" disabled={isAdding} style={buttonStyle}>Add</button>
              {isAdding && <div style={{ color: 'var(--muted)', marginLeft: 8 }}>Adding...</div>}
            </form>
            <div style={{ marginTop: 0, color: 'var(--muted)', fontSize: 13, marginBottom: 12 }}>Creates a staff record; a login user will be created automatically (you may provide a password).</div>

            <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
              {users.map(u => (
                <li key={u.id ?? u.username} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--light-border)' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{u.username}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 13 }}>{u.role || (u.id ? '' : 'You')}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {resettingId === (u.id ?? 'self') ? (
                      <>
                        <input className="input-compact" value={resetPassword} onChange={e => setResetPassword(e.target.value)} placeholder="new password" style={{ width: 140 }} />
                        <button className="button btn-compact" style={buttonStyle} onClick={async () => {
                          if (!resetPassword) return setMsg('Enter new password');
                          try {
                            let res;
                            if (u.id) {
                              res = await apiClient.fetchWithAuth(`/users/${u.id}/password`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: resetPassword }) });
                            } else {
                              // fallback to self-password endpoint when we don't have user id
                              res = await apiClient.fetchWithAuth(`/users/self/password`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: resetPassword }) });
                            }
                            if (!res.ok) { const j = await res.json().catch(()=>({})); setMsg(j.error || 'Reset failed'); return; }
                            setMsg('Password reset'); setResettingId(null); setResetPassword(''); await refreshUsers();
                          } catch (e) { setMsg('Server error'); }
                        }}>Save</button>
                        <button className="button" style={buttonStyle} onClick={() => { setResettingId(null); setResetPassword(''); }}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button className="button btn-compact" style={buttonStyle} onClick={() => { setResettingId(u.id ?? 'self'); setResetPassword(''); }}>Reset</button>
                        {u.id ? (
                          <button className="button" style={buttonStyle} onClick={() => toggleUserActive(u)}>{(u.active ?? true) ? 'Deactivate' : 'Activate'}</button>
                        ) : null}
                      </>
                    )}
                  </div>
                </li>
              ))}
              {users.length === 0 && <li style={{ color: '#888', padding: 12 }}>No users found.</li>}
            </ul>
          </div>

          
          <div className="panel-header" style={{ marginTop: 18 }}>Pricing Rules</div>
          <div style={{ marginTop: 8 }}>
            <div style={{ color: 'var(--muted)', marginBottom: 8 }}>This table lists the product rules used by the app to decide whether a Particulars value grants gym access and/or coach subscription.</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ color: 'var(--muted)' }}>This table lists the product rules used by the app to decide whether a Particulars value grants gym access and/or coach subscription.</div>
              <div>
                {showAddMerch ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input placeholder="Merchandise name" value={merchName} onChange={e => setMerchName(e.target.value)} style={{ width: 240 }} />
                    <input placeholder="Price" value={merchPrice} onChange={e => setMerchPrice(e.target.value)} style={{ width: 120 }} />
                    <button className="button" onClick={async () => {
                      if (!merchName) return setMsg('Enter merchandise name');
                      try {
                        const payload = { Particulars: merchName, Cost: Number(merchPrice) || 0, Validity: 0, 'Gym membership': 'No', 'Coach subscription': 'No' };
                        await api.addPricing(payload);
                        const p = await fetchPricing(); setPricingRows(p?.rows || []);
                        setMerchName(''); setMerchPrice(''); setShowAddMerch(false); setMsg('Merchandise added');
                      } catch (e) { setMsg('Add failed'); }
                    }}>Add</button>
                    <button className="button" onClick={() => { setShowAddMerch(false); setMerchName(''); setMerchPrice(''); }}>Cancel</button>
                  </div>
                ) : (
                  <button className="button" onClick={() => setShowAddMerch(true)}>Add Merchandise</button>
                )}
              </div>
            </div>
            <table className="aligned" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <colgroup>
                <col style={{ width: '36%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '10%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Particulars</th>
                  <th>Gym Membership</th>
                  <th>Coach Subscription</th>
                  <th>Cost</th>
                  <th>Validity (days)</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pricingItems.length === 0 ? (
                  <tr><td colSpan={6} style={{ color: '#888', padding: 12 }}>No pricing rules configured.</td></tr>
                ) : (
                  <>
                    {visiblePricingByGroup.gymOnly.length > 0 && (
                      <>
                        <tr style={{ background: 'var(--muted-background)', fontWeight: 700 }}><td colSpan={6} style={{ padding: 8 }}>Gym Membership Only</td></tr>
                        {visiblePricingByGroup.gymOnly.map(r => {
                          const editing = editingId === (r.id || r.particulars);
                          return (
                            <tr key={(r.id || r.particulars)} style={{ borderTop: '1px solid var(--light-border)' }}>
                              <td style={{ padding: '6px 8px' }}>{r.particulars}</td>
                              <td style={{ textAlign: 'center' }}>{r.gym}</td>
                              <td style={{ textAlign: 'center' }}>{r.coach}</td>
                              <td style={{ textAlign: 'center' }}>{editing ? (<input value={editingPrice} onChange={e => setEditingPrice(e.target.value)} style={{ width: 96 }} />) : (r.cost || '')}</td>
                              <td style={{ textAlign: 'center' }}>{r.validity || ''}</td>
                              <td style={{ textAlign: 'right' }}>{editing ? (<><button className="button" onClick={async () => {
                                try {
                                  if (r.source === 'pricing') {
                                    await api.updatePricing(r.id, { Cost: Number(editingPrice) || 0 });
                                    const p = await fetchPricing(); setPricingRows(p?.rows || []);
                                  } else if (r.source === 'products' && r.id) {
                                    await apiClient.fetchWithAuth(`/products/${r.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...r.raw, price: Number(editingPrice) || 0 }) });
                                    await refreshProducts();
                                  }
                                  setEditingId(null); setEditingPrice(''); setMsg('Pricing updated');
                                } catch (e) { setMsg('Update failed'); }
                              }}>Save</button><button className="button" onClick={() => { setEditingId(null); setEditingPrice(''); }}>Cancel</button></>) : (<button className="button" onClick={() => { setEditingId(r.id || r.particulars); setEditingPrice(r.cost || ''); }}>Edit</button>)}</td>
                            </tr>
                          );
                        })}
                      </>
                    )}

                    {visiblePricingByGroup.coachOnly.length > 0 && (
                      <>
                        <tr style={{ background: 'var(--muted-background)', fontWeight: 700 }}><td colSpan={6} style={{ padding: 8 }}>Coach Subscription Only</td></tr>
                        {visiblePricingByGroup.coachOnly.map(r => {
                          const editing = editingId === (r.id || r.particulars);
                          return (
                            <tr key={(r.id || r.particulars)} style={{ borderTop: '1px solid var(--light-border)' }}>
                              <td style={{ padding: '6px 8px' }}>{r.particulars}</td>
                              <td style={{ textAlign: 'center' }}>{r.gym}</td>
                              <td style={{ textAlign: 'center' }}>{r.coach}</td>
                              <td style={{ textAlign: 'center' }}>{editing ? (<input value={editingPrice} onChange={e => setEditingPrice(e.target.value)} style={{ width: 96 }} />) : (r.cost || '')}</td>
                              <td style={{ textAlign: 'center' }}>{r.validity || ''}</td>
                              <td style={{ textAlign: 'right' }}>{editing ? (<><button className="button" onClick={async () => {
                                try {
                                  if (r.source === 'pricing') {
                                    await api.updatePricing(r.id, { Cost: Number(editingPrice) || 0 });
                                    const p = await fetchPricing(); setPricingRows(p?.rows || []);
                                  } else if (r.source === 'products' && r.id) {
                                    await apiClient.fetchWithAuth(`/products/${r.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...r.raw, price: Number(editingPrice) || 0 }) });
                                    await refreshProducts();
                                  }
                                  setEditingId(null); setEditingPrice(''); setMsg('Pricing updated');
                                } catch (e) { setMsg('Update failed'); }
                              }}>Save</button><button className="button" onClick={() => { setEditingId(null); setEditingPrice(''); }}>Cancel</button></>) : (<button className="button" onClick={() => { setEditingId(r.id || r.particulars); setEditingPrice(r.cost || ''); }}>Edit</button>)}</td>
                            </tr>
                          );
                        })}
                      </>
                    )}

                    {visiblePricingByGroup.bundle.length > 0 && (
                      <>
                        <tr style={{ background: 'var(--muted-background)', fontWeight: 700 }}><td colSpan={6} style={{ padding: 8 }}>Gym &amp; Coach Bundle</td></tr>
                        {visiblePricingByGroup.bundle.map(r => {
                          const editing = editingId === (r.id || r.particulars);
                          return (
                            <tr key={(r.id || r.particulars)} style={{ borderTop: '1px solid var(--light-border)' }}>
                              <td style={{ padding: '6px 8px' }}>{r.particulars}</td>
                              <td style={{ textAlign: 'center' }}>{r.gym}</td>
                              <td style={{ textAlign: 'center' }}>{r.coach}</td>
                              <td style={{ textAlign: 'center' }}>{editing ? (<input value={editingPrice} onChange={e => setEditingPrice(e.target.value)} style={{ width: 96 }} />) : (r.cost || '')}</td>
                              <td style={{ textAlign: 'center' }}>{r.validity || ''}</td>
                              <td style={{ textAlign: 'right' }}>{editing ? (<><button className="button" onClick={async () => {
                                try {
                                  if (r.source === 'pricing') {
                                    await api.updatePricing(r.id, { Cost: Number(editingPrice) || 0 });
                                    const p = await fetchPricing(); setPricingRows(p?.rows || []);
                                  } else if (r.source === 'products' && r.id) {
                                    await apiClient.fetchWithAuth(`/products/${r.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...r.raw, price: Number(editingPrice) || 0 }) });
                                    await refreshProducts();
                                  }
                                  setEditingId(null); setEditingPrice(''); setMsg('Pricing updated');
                                } catch (e) { setMsg('Update failed'); }
                              }}>Save</button><button className="button" onClick={() => { setEditingId(null); setEditingPrice(''); }}>Cancel</button></>) : (<button className="button" onClick={() => { setEditingId(r.id || r.particulars); setEditingPrice(r.cost || ''); }}>Edit</button>)}</td>
                            </tr>
                          );
                        })}
                      </>
                    )}

                    {visiblePricingByGroup.merch.length > 0 && (
                      <>
                        <tr style={{ background: 'var(--muted-background)', fontWeight: 700 }}><td colSpan={6} style={{ padding: 8 }}>Merchandise</td></tr>
                        {visiblePricingByGroup.merch.map(r => {
                          const editing = editingId === (r.id || r.particulars);
                          return (
                            <tr key={(r.id || r.particulars)} style={{ borderTop: '1px solid var(--light-border)' }}>
                              <td style={{ padding: '6px 8px' }}>{r.particulars}</td>
                              <td style={{ textAlign: 'center' }}>{r.gym}</td>
                              <td style={{ textAlign: 'center' }}>{r.coach}</td>
                              <td style={{ textAlign: 'center' }}>{editing ? (<input value={editingPrice} onChange={e => setEditingPrice(e.target.value)} style={{ width: 96 }} />) : (r.cost || '')}</td>
                              <td style={{ textAlign: 'center' }}>{r.validity || ''}</td>
                              <td style={{ textAlign: 'right' }}>{editing ? (<><button className="button" onClick={async () => {
                                try {
                                  if (r.source === 'pricing') {
                                    await api.updatePricing(r.id, { Cost: Number(editingPrice) || 0 });
                                    const p = await fetchPricing(); setPricingRows(p?.rows || []);
                                  } else if (r.source === 'products' && r.id) {
                                    await apiClient.fetchWithAuth(`/products/${r.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...r.raw, price: Number(editingPrice) || 0 }) });
                                    await refreshProducts();
                                  }
                                  setEditingId(null); setEditingPrice(''); setMsg('Pricing updated');
                                } catch (e) { setMsg('Update failed'); }
                              }}>Save</button><button className="button" onClick={() => { setEditingId(null); setEditingPrice(''); }}>Cancel</button></>) : (<button className="button" onClick={() => { setEditingId(r.id || r.particulars); setEditingPrice(r.cost || ''); }}>Edit</button>)}</td>
                            </tr>
                          );
                        })}
                      </>
                    )}
                  </>
                )}
              </tbody>
            </table>

            {pricingPager.canLoadMore && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 10 }}>
                <button className="button" onClick={pricingPager.loadMore}>Load 20 more</button>
              </div>
            )}
            
          </div>
        </div>

        {msg && <div style={{ marginTop: 12, color: '#2b7', fontWeight: 600 }}>{msg}</div>}
        
        
      </div>
    </div>
  );
}
