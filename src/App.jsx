import { useEffect, useMemo, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import apiClient from './lib/apiClient';
import { getAuth, onAuthStateChanged, signOut } from 'firebase/auth';
import { ensureFirebase } from './lib/firebase';

import Nav from "./components/Nav";
import Dashboard from "./pages/Dashboard";
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

  useEffect(() => {
    const saved = apiClient.getToken();
    if (saved) setToken(saved);
  }, []);

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
    <div className="app">
      <GlobalToasts />
      <Nav onLogout={handleLogout} />
      <div className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
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