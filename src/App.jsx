import { useEffect, useMemo, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import apiClient from './lib/apiClient';
import { getAuth, getIdTokenResult, onAuthStateChanged, signOut } from 'firebase/auth';
import { ensureFirebase } from './lib/firebase';
import { isAdminUid } from './lib/admin';

import Nav from "./components/Nav";
import TopBar from './components/TopBar.jsx';
import Dashboard from "./pages/Dashboard";
import Reports from "./pages/Reports";
import Members from "./pages/Members";
import MemberDetail from "./pages/MemberDetail";
import CheckIn from "./pages/CheckIn";
import StaffAttendance from "./pages/StaffAttendance";
import AdminPage from "./pages/Admin";
import GlobalToasts from "./components/GlobalToasts";
// Note: non-primary pages (AddMember, Payments, ProgressDetail, Staff) are
// intended to be refactored into components under `src/components/`.
// Keep routed surface minimal: Dashboard, StaffAttendance, Members, MemberDetail, CheckIn
import "./styles.css";

// Use the centralized Login page (username/password) instead of the legacy Google-only card

export default function App() {
  const useFirestore = useMemo(() => (
    import.meta.env.VITE_USE_FIRESTORE === 'true' || import.meta.env.VITE_USE_FIRESTORE === undefined
  ), []);

  const [token, setToken] = useState("");
  const [fbUser, setFbUser] = useState(null);
  const [fbAuthReady, setFbAuthReady] = useState(!useFirestore);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const saved = apiClient.getToken();
    if (saved) setToken(saved);
  }, []);

  // Determine admin role for UI (best-effort; defaults to Front Desk).
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // Firestore mode: admin is currently defined by a client-side UID allowlist.
        // Prefer Firebase custom claims when available; fallback to UI-only UID allowlist.
        if (useFirestore) {
          if (!fbUser) return setIsAdmin(false);
          try {
            const tokenRes = await getIdTokenResult(fbUser);
            if (!mounted) return;
            const claims = tokenRes?.claims || {};
            const claimRole = String(claims.role || '').toLowerCase();
            const claimAdmin = Boolean(claims.admin);
            if (claimRole) return setIsAdmin(claimRole === 'admin');
            if (claimAdmin) return setIsAdmin(true);
          } catch {
            // ignore and fall back
          }

          if (!mounted) return;
          return setIsAdmin(isAdminUid(fbUser.uid));
        }

        // Legacy (server-token) mode: rely on /auth/me role.
        const hasToken = Boolean(apiClient.getToken());
        if (!hasToken) return setIsAdmin(false);
        const res = await apiClient.fetchWithAuth('/auth/me');
        if (!mounted) return;
        if (!res?.ok) return setIsAdmin(false);
        const json = await res.json().catch(() => ({}));
        setIsAdmin(Boolean(json?.user?.role === 'admin'));
      } catch {
        setIsAdmin(false);
      }
    })();
    return () => { mounted = false; };
  }, [token, fbUser]);

  // In Firestore mode, require Firebase Auth (otherwise Firestore rules often return PERMISSION_DENIED).
  // This prevents stale server tokens (from /auth/login) from putting the UI into a broken state.
  useEffect(() => {
    if (!useFirestore) return;
    let unsub = null;
    try {
      ensureFirebase();
      const auth = getAuth();
      unsub = onAuthStateChanged(auth, (user) => {
        setFbUser(user || null);
        setFbAuthReady(true);
      });
    } catch (e) {
      // If Firebase isn't configured, fail closed to the Login screen.
      setFbUser(null);
      setFbAuthReady(true);
    }
    return () => { try { unsub && unsub(); } catch (e) {} };
  }, [useFirestore]);

  const handleLogin = (cred) => {
    setToken(cred);
    try { apiClient.setToken(cred); } catch (e) {}
  };

  const handleLogout = () => {
    setToken("");
    setIsAdmin(false);
    localStorage.removeItem("authToken");
    if (useFirestore) {
      try { signOut(getAuth()); } catch (e) {}
    }
  };

  if (useFirestore) {
    if (!fbAuthReady) return null;
    if (!fbUser) return <Login setToken={handleLogin} />;
  } else {
    if (!token) return <Login setToken={handleLogin} />;
  }

  return (
    <div className={`app ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <GlobalToasts />
      <TopBar
        collapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
        onLogout={handleLogout}
        roleLabel={isAdmin ? 'Admin' : 'Front Desk'}
      />
      <Nav collapsed={sidebarCollapsed} isAdmin={isAdmin} />
      <div className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/attendance" element={<StaffAttendance />} />
          <Route path="/members" element={<Members />} />
          {/* Canonical member detail route */}
          <Route path="/members/:memberId" element={<MemberDetail />} />
          <Route path="/checkin" element={<CheckIn />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}