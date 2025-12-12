import { getAuth, GoogleAuthProvider, signInWithEmailAndPassword, signInWithPopup } from 'firebase/auth';
import { ensureFirebase } from '../lib/firebase';
import { useEffect, useState } from "react";
import { useNavigate } from 'react-router-dom';
import apiClient from '../lib/apiClient';

export default function Login({ setToken }) {

  const useFirestore = (import.meta.env.VITE_USE_FIRESTORE === 'true' || import.meta.env.VITE_USE_FIRESTORE === undefined);

  // Use setToken from props only!
  // Remove: const [token, setToken] = useState("");

  useEffect(() => {
    // legacy Google Sheets OAuth initialization removed — app now uses Firestore.
  }, []);

  // Simple local auth state (will POST to server-backed /auth/login)
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // Firebase Auth email/password (for static hosting like GitHub Pages)
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // single view: staff form first, member sign-in below (member uses Google, disabled for now)
  const navigate = useNavigate();

  const handleLocalSignIn = async (e) => {
    e && e.preventDefault();
    setError("");
    if (useFirestore) return; // Firestore-mode uses Firebase Auth instead (no backend on Pages)
    if (!username || !password) {
      setError("Please enter username and password");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error || 'Invalid username or password');
        setLoading(false);
        return;
      }
      const json = await res.json();
      // Expecting { ok: true, token, user }
      if (json && json.ok && json.token) {
        // persist token for session and attach to client helper
        try { apiClient.setToken(json.token); } catch (e) {}
        setToken(json.token);
        // navigate to app root so the main app UI shows
        try { navigate('/'); } catch (e) {}
      } else {
        setError('Login failed');
      }
    } catch (err) {
      setError('Server error — please try again');
    } finally {
      setLoading(false);
    }
  };

  const handleFirebaseEmailSignIn = async (e) => {
    e && e.preventDefault();
    setError('');
    if (!useFirestore) return;
    if (!email || !password) {
      setError('Please enter email and password');
      return;
    }
    setLoading(true);
    try {
      ensureFirebase();
      const auth = getAuth();
      const res = await signInWithEmailAndPassword(auth, email.trim(), password);
      const idToken = await res.user.getIdToken();
      try { apiClient.setToken(idToken); } catch (e) {}
      setToken(idToken);
      try { navigate('/'); } catch (e) {}
    } catch (err) {
      setError('Sign-in failed. Check your email/password and Firebase Auth settings.');
    } finally {
      setLoading(false);
    }
  };

  // Use Firebase sign-in for Google-based member/staff login
  const handleGoogleSignIn = async () => {
    try {
      ensureFirebase();
      const auth = getAuth();
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const idToken = await result.user.getIdToken();
      // Use ID token directly with existing API by storing it as auth token
      try { apiClient.setToken(idToken); } catch (e) {}
      setToken(idToken);
      try { navigate('/'); } catch (e) {}
    } catch (err) {
      setError('Google sign-in failed');
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        margin: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, rgba(255,182,213,0.94), rgba(180,196,255,0.92))",
        backgroundRepeat: "no-repeat",
        backgroundSize: "cover",
      }}
    >
      <div
        style={{
          width: 420,
          minHeight: 520,
          padding: "56px 48px",
          borderRadius: 28,
          background: "#11121d",
          boxShadow: "0 36px 70px rgba(0,0,0,0.40)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          color: "#fff",
          textAlign: "center",
        }}
      >
        <img
          src={`${import.meta.env.BASE_URL}kusgan-logo.png`}
          alt="Kusgan Logo"
          style={{
            width: 160,
            height: 160,
            objectFit: "cover",
            borderRadius: "22px",
            boxShadow: "0 10px 28px rgba(215,38,96,0.35)",
            marginBottom: 24,
            background: "#000",
          }}
        />

        <h1 style={{ fontSize: "1.6rem", fontWeight: 700, margin: "0 0 8px" }}>
          Kusgan Fitness Gym
        </h1>

        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
          {useFirestore ? (
            <>
              {/* Firestore-mode: Firebase Auth (Email/Password) */}
              <form onSubmit={handleFirebaseEmailSignIn} style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
                <label style={{ fontSize: 12, color: "#c9c9da", textAlign: "left" }}>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="frontdesk@yourdomain.com"
                  autoComplete="username"
                  style={{ padding: 10, fontSize: 16, borderRadius: 6, border: "1px solid #2a2a36", background: '#0f1114', color: '#fff' }}
                />

                <label style={{ fontSize: 12, color: "#c9c9da", textAlign: "left" }}>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter password"
                  autoComplete="current-password"
                  style={{ padding: 10, fontSize: 16, borderRadius: 6, border: "1px solid #2a2a36", background: '#0f1114', color: '#fff' }}
                />

                {error && <div style={{ color: "#f44336", fontSize: 13 }}>{error}</div>}

                <button type="submit" disabled={loading} style={{ marginTop: 6, padding: 12, borderRadius: 6, background: "#1976d2", color: "#fff", border: "none", cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.8 : 1 }}>
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
              </form>

              {/* Optional: Google sign-in */}
              <div style={{ marginTop: 18, width: '100%', textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: '#c9c9da', fontWeight: 600, marginBottom: 8 }}>Or</div>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <button onClick={handleGoogleSignIn} style={{ borderRadius: 8, padding: '8px 12px', background: '#fff', color: '#222', cursor: 'pointer' }}>Continue with Google</button>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Non-Firestore mode: server-backed username/password */}
              <form onSubmit={handleLocalSignIn} style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
                <label style={{ fontSize: 12, color: "#c9c9da", textAlign: "left" }}>Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="Enter staff username"
                  style={{ padding: 10, fontSize: 16, borderRadius: 6, border: "1px solid #2a2a36", background: '#0f1114', color: '#fff' }}
                />

                <label style={{ fontSize: 12, color: "#c9c9da", textAlign: "left" }}>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter staff password"
                  style={{ padding: 10, fontSize: 16, borderRadius: 6, border: "1px solid #2a2a36", background: '#0f1114', color: '#fff' }}
                />

                {error && <div style={{ color: "#f44336", fontSize: 13 }}>{error}</div>}

                <button type="submit" disabled={loading} style={{ marginTop: 6, padding: 12, borderRadius: 6, background: "#1976d2", color: "#fff", border: "none", cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.8 : 1 }}>
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
              </form>

              <div style={{ marginTop: 8, color: '#8b8b9b', fontSize: 13 }}>Member login via Google is not yet enabled.</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}