import express from 'express';
import cors from 'cors';
import db from './db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import admin from 'firebase-admin';
import prodHelpers from './products.js';
import fs from 'fs';
import path from 'path';

// Initialize firebase-admin if credentials are provided or a key file exists in ./keys
let adminReady = false;
try {
  // Support both a JSON string env (GOOGLE_APPLICATION_CREDENTIALS_JSON) and
  // the Google application credentials env path (GOOGLE_APPLICATION_CREDENTIALS).
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    try {
      const svc = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
      const adminInit = { credential: admin.credential.cert(svc) };
      if (process.env.FIREBASE_STORAGE_BUCKET) adminInit.storageBucket = process.env.FIREBASE_STORAGE_BUCKET;
      admin.initializeApp(adminInit);
      adminReady = true;
      console.log('firebase-admin initialized for API server (GOOGLE_APPLICATION_CREDENTIALS_JSON)');
    } catch (e) {
      console.warn('firebase-admin failed to initialize from GOOGLE_APPLICATION_CREDENTIALS_JSON:', e && e.message);
    }
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const adminInit = { credential: admin.credential.applicationDefault() };
    if (process.env.FIREBASE_STORAGE_BUCKET) adminInit.storageBucket = process.env.FIREBASE_STORAGE_BUCKET;
    admin.initializeApp(adminInit);
    adminReady = true;
    console.log('firebase-admin initialized for API server (applicationDefault)');
  } else {
    // Try to find a service account JSON inside ./keys/ for local dev convenience
    const keysDir = path.resolve('./keys');
    if (fs.existsSync(keysDir)) {
      const jsonFiles = fs.readdirSync(keysDir).filter(f => f.toLowerCase().endsWith('.json'));
      if (jsonFiles.length > 0) {
        try {
          const keyPath = path.join(keysDir, jsonFiles[0]);
          const svc = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
          const adminInit = { credential: admin.credential.cert(svc) };
          if (process.env.FIREBASE_STORAGE_BUCKET) adminInit.storageBucket = process.env.FIREBASE_STORAGE_BUCKET;
          admin.initializeApp(adminInit);
          adminReady = true;
          console.log('firebase-admin initialized for API server using key file', keyPath);
        } catch (e) {
          console.warn('firebase-admin failed to initialize from keys directory:', e && e.message);
        }
      }
    }
  }
} catch (e) {
  console.warn('firebase-admin initialization error:', e && e.message);
}

// Toggle mirroring to Firestore. Set MIRROR_TO_FIRESTORE='false' to disable even if credentials exist.
const MIRROR_TO_FIRESTORE = (process.env.MIRROR_TO_FIRESTORE === undefined) ? true : (String(process.env.MIRROR_TO_FIRESTORE).toLowerCase() === 'true');

// Simple in-memory cache for server-side search/recent endpoints
const SERVER_CACHE = new Map();
const SERVER_CACHE_TTL = 1000 * 30; // 30s

const app = express();
app.use(cors());
// allow larger JSON payloads (image base64) for local upload proxy
app.use(express.json({ limit: '20mb' }));

// ensure uploads dir exists and serve it statically for local dev
const uploadsDir = path.resolve('./uploads');
try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch (e) { /* ignore */ }
app.use('/uploads', express.static(uploadsDir));

/* ---------- AUTH (simple username/password) ---------- */
app.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });

  // Environment override (optional): ADMIN_USERNAME & ADMIN_PASSWORD
  if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
    if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
      const secret = process.env.JWT_SECRET || 'dev_jwt_secret_change_me';
      const token = jwt.sign({ username, role: process.env.ADMIN_ROLE || 'admin' }, secret, { expiresIn: '8h' });
      return res.json({ ok: true, token, user: { username, role: process.env.ADMIN_ROLE || 'admin' } });
    }
    return res.status(401).json({ error: 'invalid credentials' });
  }

  try {
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!row) return res.status(401).json({ error: 'invalid credentials' });
    const match = bcrypt.compareSync(password, row.password_hash);
    if (!match) return res.status(401).json({ error: 'invalid credentials' });
    const secret = process.env.JWT_SECRET || 'dev_jwt_secret_change_me';
    const token = jwt.sign({ username: row.username, role: row.role }, secret, { expiresIn: '8h' });
    return res.json({ ok: true, token, user: { username: row.username, role: row.role } });
  } catch (e) {
    console.error('auth/login error', e);
    return res.status(500).json({ error: 'server error' });
  }
});

// auth/me - validate JWT and return user info
app.get('/auth/me', async (req, res) => {
  const auth = req.get('Authorization') || '';
  const [, token] = auth.split(' ');
  if (!token) return res.status(401).json({ error: 'missing token' });
  const secret = process.env.JWT_SECRET || 'dev_jwt_secret_change_me';
  try {
    const payload = jwt.verify(token, secret);
    return res.json({ ok: true, user: payload });
  } catch (e) {
    if (adminReady) {
      try {
        const fbPayload = await admin.auth().verifyIdToken(token);
        const role = (fbPayload && fbPayload.role) || (fbPayload && fbPayload.admin ? 'admin' : 'staff');
        return res.json({ ok: true, user: { username: fbPayload.email || fbPayload.uid, uid: fbPayload.uid, role } });
      } catch (e2) {
        return res.status(401).json({ error: 'invalid token' });
      }
    }
    return res.status(401).json({ error: 'invalid token' });
  }
});

// Middleware to require a valid JWT and attach req.user
async function requireAuth(req, res, next) {
  const auth = req.get('Authorization') || '';
  const [, token] = auth.split(' ');
  if (!token) return res.status(401).json({ error: 'missing token' });
  const secret = process.env.JWT_SECRET || 'dev_jwt_secret_change_me';
  try {
    // First, try existing JWT flow for backward compatibility
    const payload = jwt.verify(token, secret);
    req.user = payload;
    return next();
  } catch (e) {
    // If firebase admin is initialized, try verifying an ID token
    if (adminReady) {
      try {
        const fbPayload = await admin.auth().verifyIdToken(token);
        // Map Firebase ID token payload to our req.user structure
        // prefer role from custom claims if present
        const role = (fbPayload && fbPayload.role) || (fbPayload && fbPayload.admin ? 'admin' : 'staff');
        req.user = { username: fbPayload.email || fbPayload.uid, uid: fbPayload.uid, role };
        return next();
      } catch (e2) {
        // Not a Firebase token either; fall through to 401
      }
    }
    return res.status(401).json({ error: 'invalid token' });
  }
}

app.post('/staff', requireAuth, async (req, res) => {
  const { full_name, role } = req.body;
  if (!full_name) return res.status(400).json({ error: 'full_name required' });
  db.prepare('INSERT INTO staff (full_name, role, active) VALUES (?,?,1)').run(full_name.toUpperCase(), role || 'Staff');
  const row = db.prepare('SELECT * FROM staff ORDER BY id DESC LIMIT 1').get();
  // Mirror to Firestore if available (best-effort)
  if (adminReady && MIRROR_TO_FIRESTORE) {
    try {
      const dbf = admin.firestore();
      await dbf.collection('staff').doc(String(row.id)).set({
        id: String(row.id),
        full_name: row.full_name,
        role: row.role,
        active: Boolean(row.active),
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (e) { console.warn('Failed to mirror staff to Firestore', e && e.message); }
  }
  res.status(201).json(row);
});

// Create a user login (admin only)
app.post('/users', requireAuth, async (req, res) => {
  try {
    const { username, password, role } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    // ensure unique
    const existing = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (existing) return res.status(409).json({ error: 'username already exists' });
    const hash = bcrypt.hashSync(String(password), 10);
    const created_at = new Date().toISOString();
    const stmt = db.prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?,?,?,?)');
    const info = stmt.run(username, hash, role || 'staff', created_at);
    const row = db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(info.lastInsertRowid);
    // If firebase-admin is configured, mirror non-sensitive fields to Firestore
    if (adminReady && MIRROR_TO_FIRESTORE) {
      try {
        const dbf = admin.firestore();
        await dbf.collection('users').doc(String(row.username)).set({ username: row.username, role: row.role, created_at: row.created_at, active: true }, { merge: true });
      } catch (e) { console.warn('Failed to write user to firestore', e && e.message); }
    }
    return res.status(201).json(row);
  } catch (e) {
    console.error('POST /users error', e && e.message);
    return res.status(500).json({ error: 'server error' });
  }
});

// Update user properties (role, active) - admin only
app.put('/users/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: 'id required' });
    const payload = req.body || {};
    // allow updating role and active flag
    if (typeof payload.role !== 'undefined') {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(payload.role, id);
    }
    if (typeof payload.active !== 'undefined') {
      try {
        db.prepare('UPDATE users SET active = ? WHERE id = ?').run(payload.active ? 1 : 0, id);
      } catch (e) {
        // If schema doesn't have active column, ignore
      }
    }
    const row = db.prepare('SELECT id, username, role, created_at, active FROM users WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'not found' });
    if (adminReady && MIRROR_TO_FIRESTORE) {
      try {
        const dbf = admin.firestore();
        await dbf.collection('users').doc(String(row.username)).set({ username: row.username, role: row.role, created_at: row.created_at, active: Boolean(row.active) }, { merge: true });
      } catch (e) { console.warn('Failed to update user in firestore', e && e.message); }
    }
    return res.json(row);
  } catch (e) {
    console.error('PUT /users/:id error', e && e.message);
    return res.status(500).json({ error: 'server error' });
  }
});

// Update user password (admin only)
app.put('/users/:id/password', requireAuth, (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const { password } = req.body || {};
    if (!id || !password) return res.status(400).json({ error: 'id and password required' });
    const hash = bcrypt.hashSync(String(password), 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
    return res.json({ ok: true });
  } catch (e) {
    console.error('PUT /users/:id/password error', e && e.message);
    return res.status(500).json({ error: 'server error' });
  }
});

// Allow the authenticated user to change their own password (no id required)
app.put('/users/self/password', requireAuth, (req, res) => {
  try {
    const username = req.user && req.user.username;
    const { password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const hash = bcrypt.hashSync(String(password), 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hash, username);
    return res.json({ ok: true });
  } catch (e) {
    console.error('PUT /users/self/password error', e && e.message);
    return res.status(500).json({ error: 'server error' });
  }
});

// List users (admin-only)
    const jsonEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    const b64Env = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON_B64;
    if (jsonEnv || b64Env) {
      try {
        let svc = null;
        if (b64Env) {
          svc = JSON.parse(Buffer.from(String(b64Env), 'base64').toString('utf8'));
        } else {
          svc = JSON.parse(jsonEnv);
        }
        const adminInit = { credential: admin.credential.cert(svc) };
        if (process.env.FIREBASE_STORAGE_BUCKET) adminInit.storageBucket = process.env.FIREBASE_STORAGE_BUCKET;
        admin.initializeApp(adminInit);
        adminReady = true;
        console.log('firebase-admin initialized for API server (GOOGLE_APPLICATION_CREDENTIALS_JSON/_B64)');
      } catch (e) {
        console.warn('firebase-admin failed to initialize from GOOGLE_APPLICATION_CREDENTIALS_JSON/_B64:', e && e.message);
      }
        status: row.status,
        created_at: row.created_at || created_at
      }, { merge: true });
    } catch (e) { console.warn('Failed to mirror member to Firestore', e && e.message); }
  }

  res.status(201).json(row);
});

// PUT /members/:id - update member (server-side fallback)
app.put('/members/:id', requireAuth, async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ error: 'member id required' });
  const payload = req.body || {};
  try {
    if (adminReady && MIRROR_TO_FIRESTORE) {
      const dbf = admin.firestore();
      await dbf.collection('members').doc(id).set(payload, { merge: true });
      const snap = await dbf.collection('members').doc(id).get();
      return res.json({ ok: true, row: { id: snap.id, ...(snap.data() || {}) } });
    }
    // Fallback: update minimal sqlite members table where possible
    const fullName = String((payload.FirstName || payload.firstName || '') + ' ' + (payload.LastName || payload.lastName || '')).trim();
    if (fullName) {
      const stmt = db.prepare('UPDATE members SET full_name = ? WHERE id = ?');
      stmt.run(fullName, id);
    }
    // Return best-effort row from sqlite
    const row = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
    return res.json({ ok: true, row });
  } catch (e) {
    console.error('members/:id update error', e && e.message);
    return res.status(500).json({ ok: false, error: String(e || 'update failed') });
  }
});


/* ---------- ATTENDANCE (uses staff) ---------- */
app.get('/attendance', (req, res) => {
  const rows = db.prepare('SELECT * FROM attendance ORDER BY id DESC LIMIT 200').all();
  res.json(rows);
});

app.post('/attendance/checkin', requireAuth, async (req, res) => {
  const { staff_id } = req.body;
  if (!staff_id) return res.status(400).json({ error: 'staff_id required' });

  const staff = db.prepare('SELECT * FROM staff WHERE id = ? AND active=1').get(staff_id);
  if (!staff) return res.status(404).json({ error: 'staff not found' });

  const time_in = new Date().toISOString();
  db.prepare(`
    INSERT INTO attendance (staff_id, staff_name, time_in, status)
    VALUES (?, ?, ?, 'On Duty')
  `).run(staff.id, staff.full_name, time_in);

  const row = db.prepare('SELECT * FROM attendance ORDER BY id DESC LIMIT 1').get();
  // Mirror to Firestore if available (best-effort)
  if (adminReady && MIRROR_TO_FIRESTORE) {
    try {
      const dbf = admin.firestore();
      await dbf.collection('attendance').doc(String(row.id)).set({
        id: String(row.id),
        staff_id: row.staff_id || null,
        staff_name: row.staff_name || row.Staff || null,
        time_in: row.time_in || null,
        Date: row.Date || null,
        Staff: row.Staff || row.staff_name || null,
        TimeIn: row.TimeIn || null,
        status: row.status || 'On Duty',
        mirroredAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (e) { console.warn('Failed to mirror attendance checkin to Firestore', e && e.message); }
  }

  res.status(201).json(row);
});

// Clock endpoint: sign-in or sign-out by staff id or name. Protected by auth.
app.post('/attendance/clock', requireAuth, async (req, res) => {
  try {
    const { staff_id, staff_name, staff_identifier, staff_identifier: identifierStr } = req.body || {};
    let staff = null;
    if (staff_id) {
      staff = db.prepare('SELECT * FROM staff WHERE id = ? AND active=1').get(Number(staff_id));
    }
    if (!staff && staff_name) {
      staff = db.prepare('SELECT * FROM staff WHERE upper(full_name) = upper(?) AND active=1').get(String(staff_name));
    }
    if (!staff && staff_identifier) {
      // Try numeric id first
      const maybeId = Number(staff_identifier);
      if (!Number.isNaN(maybeId)) {
        staff = db.prepare('SELECT * FROM staff WHERE id = ? AND active=1').get(maybeId);
      }
      // Fallback: match by name (contains)
      if (!staff) {
        staff = db.prepare('SELECT * FROM staff WHERE upper(full_name) LIKE upper(?) AND active=1').get(`%${String(staff_identifier)}%`);
      }
    }
    if (!staff) {
      // If staff not found, create a lightweight staff row so dropdown names can be used
      try {
        const info = db.prepare('INSERT INTO staff (full_name, role, active) VALUES (?,?,1)').run(staff_name || staff_identifier || 'Staff');
        staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(info.lastInsertRowid);
      } catch (e) {
        return res.status(404).json({ error: 'staff not found' });
      }
    }

      // Use today's date (YYYY-MM-DD) and prefer the `Date` column when present
      const today = new Date().toISOString().slice(0,10);
      const openRow = db.prepare(
        "SELECT * FROM attendance WHERE ((staff_id = ? AND staff_id IS NOT NULL) OR (Staff = ?)) AND (Date = ? OR date(time_in) = ?) AND (time_out IS NULL OR time_out = '' OR TRIM(time_out) = '') ORDER BY id DESC LIMIT 1"
      ).get(staff ? staff.id : null, identifierStr, today, today);
    if (openRow) {
        const now = new Date();
        const timeOut = now.toISOString();
        const timeOutHHMM = now.toISOString().slice(11,16);
      // compute hours diff
      let noOfHours = null;
      try {
          const tin = new Date(openRow.time_in);
          const tout = new Date(timeOut);
          const diff = (tout.getTime() - tin.getTime()) / (1000 * 60 * 60);
          noOfHours = Math.round(diff * 100) / 100;
      } catch (e) { noOfHours = null; }
        // Update both snake_case and sheet-style columns for compatibility
        db.prepare('UPDATE attendance SET time_out = ?, TimeOut = ?, status = ?, NoOfHours = ? WHERE id = ?').run(timeOut, timeOutHHMM, 'Off Duty', noOfHours, openRow.id);
      const updated = db.prepare('SELECT * FROM attendance WHERE id = ?').get(openRow.id);
      // Mirror to Firestore if available (best-effort)
      if (adminReady && MIRROR_TO_FIRESTORE) {
        try {
          const dbf = admin.firestore();
          await dbf.collection('attendance').doc(String(updated.id)).set({
            id: String(updated.id),
            staff_id: updated.staff_id || null,
            staff_name: updated.staff_name || updated.Staff || null,
            time_in: updated.time_in || null,
            time_out: updated.time_out || null,
            Date: updated.Date || null,
            Staff: updated.Staff || updated.staff_name || null,
            TimeIn: updated.TimeIn || null,
            TimeOut: updated.TimeOut || null,
            NoOfHours: typeof updated.NoOfHours !== 'undefined' ? updated.NoOfHours : null,
            status: updated.status || null,
            mirroredAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        } catch (e) { console.warn('Failed to mirror attendance checkout to Firestore', e && e.message); }
      }
      return res.json({ ok: true, action: 'checkout', row: updated });
    } else {
        const now = new Date();
        const timeIn = now.toISOString();
        const timeInHHMM = now.toISOString().slice(11,16);
        const dateYMD = timeIn.slice(0,10);
        // Insert both canonical DB columns and sheet-style columns so frontend can read Date/Staff/TimeIn
        db.prepare('INSERT INTO attendance (staff_id, staff_name, time_in, Date, Staff, TimeIn, status) VALUES (?,?,?,?,?,?,?)')
          .run(staff.id, staff.full_name, timeIn, dateYMD, staff.full_name, timeInHHMM, 'On Duty');
        const row = db.prepare('SELECT * FROM attendance ORDER BY id DESC LIMIT 1').get();
      // Mirror to Firestore if available (best-effort)
      if (adminReady && MIRROR_TO_FIRESTORE) {
        try {
          const dbf = admin.firestore();
          await dbf.collection('attendance').doc(String(row.id)).set({
            id: String(row.id),
            staff_id: row.staff_id || null,
            staff_name: row.staff_name || row.Staff || null,
            time_in: row.time_in || null,
            Date: row.Date || null,
            Staff: row.Staff || row.staff_name || null,
            TimeIn: row.TimeIn || null,
            status: row.status || 'On Duty',
            mirroredAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        } catch (e) { console.warn('Failed to mirror attendance checkin to Firestore', e && e.message); }
      }
      return res.json({ ok: true, action: 'checkin', row });
    }
  } catch (e) {
    console.error('/attendance/clock error', e && e.message);
    return res.status(500).json({ error: 'server error' });
  }
});

// Public kiosk endpoint for simple staff clocking (no auth). Writes Date, Staff, TimeIn/TimeOut, NoOfHours.
app.post('/attendance/kiosk', async (req, res) => {
  try {
    const { staff_name, staff_identifier } = req.body || {};
    const name = String(staff_name || staff_identifier || '').trim();
    if (!name) return res.status(400).json({ error: 'staff_name required' });

    // Use today's date (YYYY-MM-DD) and prefer the `Date` column when present
    const today = new Date().toISOString().slice(0,10);
    // Try to find an open row by Staff name (case-insensitive) for today
    const openRow = db.prepare(
      "SELECT * FROM attendance WHERE upper(Staff) = upper(?) AND (Date = ? OR date(time_in) = ?) AND (time_out IS NULL OR TRIM(time_out) = '') ORDER BY id DESC LIMIT 1"
    ).get(name, today, today);

    if (openRow) {
      const now = new Date();
      const timeOut = now.toISOString();
      const timeOutHHMM = now.toISOString().slice(11,16);
      let noOfHours = null;
      try {
        const tin = new Date(openRow.time_in);
        const tout = new Date(timeOut);
        const diff = (tout.getTime() - tin.getTime()) / (1000 * 60 * 60);
        noOfHours = Math.round(diff * 100) / 100;
      } catch (e) { noOfHours = null; }
      db.prepare('UPDATE attendance SET time_out = ?, TimeOut = ?, status = ?, NoOfHours = ? WHERE id = ?')
        .run(timeOut, timeOutHHMM, 'Off Duty', noOfHours, openRow.id);
      const updated = db.prepare('SELECT * FROM attendance WHERE id = ?').get(openRow.id);
      // Mirror to Firestore if available (best-effort)
      if (adminReady && MIRROR_TO_FIRESTORE) {
        try {
          const dbf = admin.firestore();
          await dbf.collection('attendance').doc(String(updated.id)).set({
            id: String(updated.id),
            staff_id: updated.staff_id || null,
            staff_name: updated.staff_name || updated.Staff || null,
            time_in: updated.time_in || null,
            time_out: updated.time_out || null,
            Date: updated.Date || null,
            Staff: updated.Staff || updated.staff_name || null,
            TimeIn: updated.TimeIn || null,
            TimeOut: updated.TimeOut || null,
            NoOfHours: typeof updated.NoOfHours !== 'undefined' ? updated.NoOfHours : null,
            status: updated.status || null,
            mirroredAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        } catch (e) { console.warn('Failed to mirror kiosk checkout to Firestore', e && e.message); }
      }
      return res.json({ ok: true, action: 'checkout', row: updated });
    }

    // No open row for today: insert a new sign-in row using sheet-style fields
    const now = new Date();
    const timeIn = now.toISOString();
    const timeInHHMM = timeIn.slice(11,16);
    const dateYMD = timeIn.slice(0,10);
    db.prepare('INSERT INTO attendance (time_in, Date, Staff, TimeIn, status, staff_name) VALUES (?,?,?,?,?,?)')
      .run(timeIn, dateYMD, name, timeInHHMM, 'On Duty', name);
    const row = db.prepare('SELECT * FROM attendance ORDER BY id DESC LIMIT 1').get();
    // Mirror to Firestore if available (best-effort)
    if (adminReady && MIRROR_TO_FIRESTORE) {
      try {
        const dbf = admin.firestore();
        await dbf.collection('attendance').doc(String(row.id)).set({
          id: String(row.id),
          staff_id: row.staff_id || null,
          staff_name: row.staff_name || row.Staff || null,
          time_in: row.time_in || null,
          Date: row.Date || null,
          Staff: row.Staff || row.staff_name || null,
          TimeIn: row.TimeIn || null,
          status: row.status || 'On Duty',
          mirroredAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (e) { console.warn('Failed to mirror kiosk checkin to Firestore', e && e.message); }
    }
    return res.json({ ok: true, action: 'checkin', row });
  } catch (e) {
    console.error('/attendance/kiosk error', e && e.message);
    return res.status(500).json({ error: 'server error' });
  }
});

// WebAuthn endpoints removed — biometric prototype cleaned up. If you need WebAuthn later,
// add proper verification with @simplewebauthn/server or fido2-lib and reintroduce endpoints.

/* ---------- PAYMENTS ---------- */
app.get('/payments', (req, res) => {
  const rows = db.prepare('SELECT * FROM payments ORDER BY id DESC LIMIT 200').all();
  res.json(rows);
});

app.post('/payments', requireAuth, async (req, res) => {
  const { pay_date, member_id, member_name, method, amount } = req.body;
  if (!member_id || !member_name || !method || !amount) {
    return res.status(400).json({ error: 'member_id, member_name, method, amount required' });
  }
  const date = pay_date || new Date().toISOString().slice(0,10);

  const productId = req.body.productId || null;
  db.prepare(`
    INSERT INTO payments (pay_date, member_id, member_name, method, amount, product_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(date, member_id, member_name, method, amount, productId);

  const row = db.prepare('SELECT * FROM payments ORDER BY id DESC LIMIT 1').get();
  // Mirror to Firestore if available (best-effort)
  if (adminReady && MIRROR_TO_FIRESTORE) {
    try {
      const dbf = admin.firestore();
      await dbf.collection('payments').doc(String(row.id)).set({
        id: String(row.id),
        pay_date: row.pay_date,
        member_id: row.member_id,
        member_name: row.member_name,
        method: row.method,
        amount: row.amount,
        product_id: row.product_id || null,
        mirroredAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (e) { console.warn('Failed to mirror payment to Firestore', e && e.message); }
  }

  res.status(201).json(row);
});


// Purchase endpoint: apply a product to a member (creates payment and updates membership/coach end dates)
app.post('/members/:id/purchase', requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'member id required' });
    const { productId, method } = req.body || {};
    if (!productId) return res.status(400).json({ error: 'productId required' });

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!product) return res.status(404).json({ error: 'product not found' });

    const member = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
    if (!member) return res.status(404).json({ error: 'member not found' });

    const now = new Date();
    // Use helper validation and computation
    const v = prodHelpers.validatePurchaseRules(member, product, now);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const ends = prodHelpers.computeNewEndDates(member, product, now);
    const newMembershipEnd = ends.newMembershipEnd;
    const newCoachEnd = ends.newCoachEnd;

    // Create payment record referencing product
    const payDate = new Date().toISOString().slice(0,10);
    const amount = Number(product.price || 0);
    db.prepare(`INSERT INTO payments (pay_date, member_id, member_name, method, amount, product_id) VALUES (?,?,?,?,?,?)`).run(payDate, member.id, member.full_name, method || 'Cash', amount, product.id);

    // Update member rows
    db.prepare('UPDATE members SET membership_end = ?, coach_subscription_end = ? WHERE id = ?').run(newMembershipEnd, newCoachEnd, member.id);

    const updated = db.prepare('SELECT * FROM members WHERE id = ?').get(member.id);

    // Mirror payment and updated member to Firestore if available (best-effort)
    if (adminReady && MIRROR_TO_FIRESTORE) {
      try {
        const dbf = admin.firestore();
        // Mirror latest payment
        const paymentRow = db.prepare('SELECT * FROM payments ORDER BY id DESC LIMIT 1').get();
        if (paymentRow) {
          await dbf.collection('payments').doc(String(paymentRow.id)).set({
            id: String(paymentRow.id),
            pay_date: paymentRow.pay_date,
            member_id: paymentRow.member_id,
            member_name: paymentRow.member_name,
            method: paymentRow.method,
            amount: paymentRow.amount,
            product_id: paymentRow.product_id || null,
            mirroredAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }
        // Mirror member
        await dbf.collection('members').doc(String(updated.id)).set({
          id: String(updated.id),
          full_name: updated.full_name,
          plan: updated.plan,
          status: updated.status,
          membership_end: updated.membership_end || null,
          coach_subscription_end: updated.coach_subscription_end || null
        }, { merge: true });
      } catch (e) { console.warn('Failed to mirror purchase to Firestore', e && e.message); }
    }

    return res.json({ ok: true, member: updated });
  } catch (e) {
    console.error('members/:id/purchase error', e && e.message);
    return res.status(500).json({ error: 'server error' });
  }
});


/* ---------- PRODUCTS API ---------- */
app.get('/products', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM products ORDER BY id').all();
    res.json(rows);
  } catch (e) {
    console.error('GET /products error', e && e.message);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/products/:id', (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  } catch (e) {
    console.error('GET /products/:id error', e && e.message);
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/products', requireAuth, async (req, res) => {
  try {
    const p = req.body || {};
    if (!p.name || typeof p.price === 'undefined') return res.status(400).json({ error: 'name and price required' });
    const stmt = db.prepare(`INSERT INTO products (sku, name, price, validity_days, is_gym_membership, is_coach_subscription, notes) VALUES (?,?,?,?,?,?,?)`);
    const info = stmt.run(p.sku || null, p.name, Number(p.price), Number(p.validity_days || 0), p.is_gym_membership ? 1 : 0, p.is_coach_subscription ? 1 : 0, p.notes || null);
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
    // Mirror to Firestore if available (best-effort)
    if (adminReady && MIRROR_TO_FIRESTORE) {
      try {
        const dbf = admin.firestore();
        await dbf.collection('products').doc(String(row.id)).set({
          id: String(row.id),
          sku: row.sku || null,
          name: row.name,
          price: row.price,
          validity_days: row.validity_days || null,
          is_gym_membership: !!row.is_gym_membership,
          is_coach_subscription: !!row.is_coach_subscription,
          notes: row.notes || null,
          mirroredAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (e) { console.warn('Failed to mirror product to Firestore', e && e.message); }
    }
    res.status(201).json(row);
  } catch (e) {
    console.error('POST /products error', e && e.message);
    res.status(500).json({ error: 'server error' });
  }
});

app.put('/products/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const p = req.body || {};
    const stmt = db.prepare(`UPDATE products SET sku = ?, name = ?, price = ?, validity_days = ?, is_gym_membership = ?, is_coach_subscription = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`);
    stmt.run(p.sku || null, p.name || '', Number(p.price || 0), Number(p.validity_days || 0), p.is_gym_membership ? 1 : 0, p.is_coach_subscription ? 1 : 0, p.notes || null, id);
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    // Mirror to Firestore if available (best-effort)
    if (adminReady && MIRROR_TO_FIRESTORE) {
      try {
        const dbf = admin.firestore();
        await dbf.collection('products').doc(String(row.id)).set({
          id: String(row.id),
          sku: row.sku || null,
          name: row.name,
          price: row.price,
          validity_days: row.validity_days || null,
          is_gym_membership: !!row.is_gym_membership,
          is_coach_subscription: !!row.is_coach_subscription,
          notes: row.notes || null,
          mirroredAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (e) { console.warn('Failed to mirror updated product to Firestore', e && e.message); }
    }
    res.json(row);
  } catch (e) {
    console.error('PUT /products/:id error', e && e.message);
    res.status(500).json({ error: 'server error' });
  }
});

app.delete('/products/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    // Mirror delete to Firestore (best-effort)
    if (adminReady && MIRROR_TO_FIRESTORE) {
      try {
        const dbf = admin.firestore();
        await dbf.collection('products').doc(String(id)).delete().catch(() => {});
      } catch (e) { console.warn('Failed to mirror product delete to Firestore', e && e.message); }
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /products/:id error', e && e.message);
    res.status(500).json({ error: 'server error' });
  }
});

// Reports: product usage (counts and totals)
app.get('/reports/product-usage', requireAuth, (req, res) => {
  try {
    // Aggregate payments by product_id and join product name
    const rows = db.prepare(`
      SELECT p.id AS product_id, p.sku AS sku, p.name AS product_name, COUNT(*) AS count, SUM(pmt.amount) AS total_amount
      FROM payments pmt
      LEFT JOIN products p ON pmt.product_id = p.id
      GROUP BY p.id, p.sku, p.name
      ORDER BY count DESC
    `).all();

    if (String(req.query.format || '').toLowerCase() === 'csv') {
      const header = 'product_id,sku,product_name,count,total_amount\n';
      const csv = rows.map(r => `${r.product_id || ''},"${(r.sku||'').replace(/"/g,'""')}","${(r.product_name||'').replace(/"/g,'""')}",${r.count||0},${r.total_amount||0}`).join('\n');
      res.set('Content-Type', 'text/csv');
      return res.send(header + csv);
    }

    return res.json(rows);
  } catch (e) {
    console.error('GET /reports/product-usage error', e && e.message);
    return res.status(500).json({ error: 'server error' });
  }
});

/* ---------- GYM ENTRIES (server-backed) ---------- */
app.get('/gymEntries', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM gymEntries ORDER BY id DESC LIMIT 1000').all();
    res.json(rows);
  } catch (e) { console.error('GET /gymEntries error', e && e.message); res.status(500).json({ error: 'server error' }); }
});

app.post('/gymEntries', requireAuth, async (req, res) => {
  try {
    const payload = req.body || {};
    // Accept flexible fields (MemberID, TimeIn, TimeOut, Date, Coach, Comments)
    const MemberID = payload.MemberID || payload.memberId || payload.memberid || payload.Member || '';
    const TimeIn = payload.TimeIn || payload.timeIn || payload.time_in || null;
    const TimeOut = payload.TimeOut || payload.timeOut || payload.time_out || null;
    const DateVal = payload.Date || payload.date || null;
    const Coach = payload.Coach || payload.coach || null;
    const Comments = payload.Comments || payload.comments || payload.notes || null;

    const stmt = db.prepare('INSERT INTO gymEntries (MemberID, TimeIn, TimeOut, Date, Coach, Comments) VALUES (?,?,?,?,?,?)');
    const info = stmt.run(MemberID, TimeIn, TimeOut, DateVal, Coach, Comments);
    const row = db.prepare('SELECT * FROM gymEntries WHERE id = ?').get(info.lastInsertRowid);
      if (adminReady && MIRROR_TO_FIRESTORE) {
      try {
        const dbf = admin.firestore();
        await dbf.collection('gymEntries').doc(String(row.id)).set({ ...row, mirroredAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      } catch (e) { console.warn('Failed to mirror gymEntry to Firestore', e && e.message); }
    }
    res.status(201).json(row);
  } catch (e) { console.error('POST /gymEntries error', e && e.message); res.status(500).json({ error: 'server error' }); }
});

app.put('/gymEntries/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: 'id required' });
    const p = req.body || {};
    const stmt = db.prepare('UPDATE gymEntries SET MemberID = ?, TimeIn = ?, TimeOut = ?, Date = ?, Coach = ?, Comments = ? WHERE id = ?');
    stmt.run(p.MemberID || p.memberId || p.memberid || null, p.TimeIn || p.timeIn || p.time_in || null, p.TimeOut || p.timeOut || p.time_out || null, p.Date || p.date || null, p.Coach || p.coach || null, p.Comments || p.comments || p.notes || null, id);
    const row = db.prepare('SELECT * FROM gymEntries WHERE id = ?').get(id);
    if (adminReady && MIRROR_TO_FIRESTORE) {
      try { const dbf = admin.firestore(); await dbf.collection('gymEntries').doc(String(id)).set({ ...row, mirroredAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }); } catch (e) { console.warn('Failed to mirror gymEntry update', e && e.message); }
    }
    res.json(row);
  } catch (e) { console.error('PUT /gymEntries/:id error', e && e.message); res.status(500).json({ error: 'server error' }); }
});

/* ---------- PROGRESS TRACKER (server-backed) ---------- */
app.get('/progress', (req, res) => {
  try { const rows = db.prepare('SELECT * FROM progress ORDER BY id DESC LIMIT 1000').all(); res.json(rows); } catch (e) { console.error('GET /progress error', e && e.message); res.status(500).json({ error: 'server error' }); }
});

app.post('/progress', requireAuth, async (req, res) => {
  try {
    const payload = req.body || {};
    const MemberID = payload.MemberID || payload.memberId || payload.memberid || '';
    const dateVal = payload.date || payload.Date || null;
    const notes = payload.notes || payload.Notes || null;
    const data = typeof payload.data === 'string' ? payload.data : JSON.stringify(payload.data || {});
    const stmt = db.prepare('INSERT INTO progress (MemberID, date, notes, data) VALUES (?,?,?,?)');
    const info = stmt.run(MemberID, dateVal, notes, data);
    const row = db.prepare('SELECT * FROM progress WHERE id = ?').get(info.lastInsertRowid);
    if (adminReady && MIRROR_TO_FIRESTORE) { try { const dbf = admin.firestore(); await dbf.collection('progress').doc(String(row.id)).set({ ...row, mirroredAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }); } catch (e) { console.warn('Failed to mirror progress to Firestore', e && e.message); } }
    res.status(201).json(row);
  } catch (e) { console.error('POST /progress error', e && e.message); res.status(500).json({ error: 'server error' }); }
});

app.put('/progress/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: 'id required' });
    const p = req.body || {};
    const data = typeof p.data === 'string' ? p.data : JSON.stringify(p.data || {});
    db.prepare('UPDATE progress SET MemberID = ?, date = ?, notes = ?, data = ? WHERE id = ?').run(p.MemberID || p.memberId || p.memberid || null, p.date || p.Date || null, p.notes || p.Notes || null, data, id);
    const row = db.prepare('SELECT * FROM progress WHERE id = ?').get(id);
    if (adminReady && MIRROR_TO_FIRESTORE) { try { const dbf = admin.firestore(); await dbf.collection('progress').doc(String(id)).set({ ...row, mirroredAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }); } catch (e) { console.warn('Failed to mirror progress update', e && e.message); } }
    res.json(row);
  } catch (e) { console.error('PUT /progress/:id error', e && e.message); res.status(500).json({ error: 'server error' }); }
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`Kusgan API running on http://localhost:${PORT}`);
});

// Debug endpoint to inspect mirroring status and recent mirrored attendance docs
app.get('/debug/mirroring', async (req, res) => {
  try {
    const info = { adminReady: !!adminReady, MIRROR_TO_FIRESTORE: !!MIRROR_TO_FIRESTORE };
    if (!adminReady) return res.json({ ...info, note: 'firebase-admin not initialized' });
    if (!MIRROR_TO_FIRESTORE) return res.json({ ...info, note: 'mirroring disabled via MIRROR_TO_FIRESTORE' });
    try {
      const dbf = admin.firestore();
      const snap = await dbf.collection('attendance').orderBy('mirroredAt', 'desc').limit(10).get().catch(() => null);
      const rows = [];
      if (snap && typeof snap.forEach === 'function') snap.forEach(d => rows.push({ id: d.id, ...(d.data() || {}) }));
      return res.json({ ...info, recent: rows });
    } catch (e) {
      return res.json({ ...info, error: String(e && e.message || e) });
    }
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
});

// ---------- Firestore-backed endpoints (optional) ----------
// /members/recent?page=1&pageSize=50&days=90
app.get('/members/recent', async (req, res) => {
  if (!adminReady) return res.status(501).json({ error: 'firebase-admin not configured for server-side queries' });
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
  const days = Math.max(1, Number(req.query.days) || 90);

  const cacheKey = `members:recent:${page}:${pageSize}:${days}`;
  const cached = SERVER_CACHE.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < SERVER_CACHE_TTL) return res.json(cached.value);

  try {
    const dbf = admin.firestore();
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const cutoffStr = cutoff.toISOString();

    // Gather member IDs from recent gymEntries and payments
    const recentIds = new Set();
    const gymSnap = await dbf.collection('gymEntries').where('Date', '>=', cutoffStr).get();
    gymSnap.forEach(d => {
      const v = d.data();
      const mid = String(v.MemberID || v.memberId || v.memberid || '').trim();
      if (mid) recentIds.add(mid);
    });
    const paySnap = await dbf.collection('payments').where('date', '>=', cutoffStr).get().catch(() => ({ forEach: () => {} }));
    if (paySnap && typeof paySnap.forEach === 'function') paySnap.forEach(d => { const v = d.data(); const mid = String(v.MemberID || v.memberId || v.memberid || v.member || '').trim(); if (mid) recentIds.add(mid); });

    // Also include recently created members (approximate: createdAt/memberDate fields)
    const membersSnap = await dbf.collection('members').where('createdAt', '>=', cutoffStr).get().catch(() => ({ forEach: () => {} }));
    if (membersSnap && typeof membersSnap.forEach === 'function') membersSnap.forEach(d => { const id = d.id; if (id) recentIds.add(id); });

    // Fetch member docs in batches (Firestore 'in' supports up to 10 per query)
    const ids = Array.from(recentIds);
    const chunks = [];
    for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));
    const results = [];
    for (const c of chunks) {
      const q = dbf.collection('members').where(admin.firestore.FieldPath.documentId(), 'in', c);
      const snap = await q.get();
      snap.forEach(d => results.push({ id: d.id, ...d.data() }));
    }

    // fallback: if no recent ids, return newest members by createdAt (limit pageSize * page)
    let sorted = results;
    if (sorted.length === 0) {
      const snapAll = await dbf.collection('members').orderBy('createdAt', 'desc').limit(pageSize * page).get();
      snapAll.forEach(d => sorted.push({ id: d.id, ...d.data() }));
    }

    // sort by createdAt desc if possible
    sorted.sort((a,b) => (new Date(b.createdAt || b.memberDate || b.joined || 0) - new Date(a.createdAt || a.memberDate || a.joined || 0)));

    const total = sorted.length;
    const start = (page - 1) * pageSize;
    const items = sorted.slice(start, start + pageSize);
    const payload = { total, page, pageSize, rows: items };
    SERVER_CACHE.set(cacheKey, { value: payload, ts: Date.now() });
    return res.json(payload);
  } catch (e) {
    console.error('members/recent error', e);
    return res.status(500).json({ error: 'server error' });
  }
});

// /members/search?q=...&limit=50
app.get('/members/search', async (req, res) => {
  if (!adminReady) return res.status(501).json({ error: 'firebase-admin not configured for server-side queries' });
  const qRaw = String(req.query.q || '').trim();
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
  if (!qRaw) return res.json({ rows: [] });
  const cacheKey = `members:search:${qRaw}:${limit}`;
  const cached = SERVER_CACHE.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < SERVER_CACHE_TTL) return res.json({ rows: cached.value });

  try {
    const dbf = admin.firestore();
    const q = qRaw.toLowerCase();
    const end = q + '\uF8FF';
    const fields = ['firstName','firstname','lastName','lastname','nickname','nick_name','nickName'];
    const collected = new Map();
    for (const f of fields) {
      try {
        const snap = await dbf.collection('members').orderBy(f).startAt(q).endAt(end).limit(limit).get();
        snap.forEach(d => collected.set(d.id, { id: d.id, ...d.data() }));
      } catch (e) {
        continue;
      }
    }
    const out = Array.from(collected.values()).slice(0, limit);
    SERVER_CACHE.set(cacheKey, { value: out, ts: Date.now() });
    return res.json({ rows: out });
  } catch (e) {
    console.error('members/search error', e);
    return res.status(500).json({ rows: [] });
  }
});

// POST /members/create
// Body: member row object (fields as in frontend). This endpoint will attempt a strict,
// race-free uniqueness guarantee by creating a document under `nicknames/{nickLower}`
// and the member document inside a Firestore transaction. If the nickname already
// exists the transaction will fail and return 409.
app.post('/members/create', requireAuth, async (req, res) => {
  if (!adminReady) return res.status(501).json({ ok: false, error: 'firebase-admin not configured' });
  const payload = req.body || {};
  const nickRawInput = String(payload.NickName || payload.nickName || payload.nickname || payload.Nick || '').trim();
  if (!nickRawInput) return res.status(400).json({ ok: false, error: 'NickName required' });
  // Rules: max 10 chars, letters/numbers and '-' only, no spaces.
  if (/\s/.test(nickRawInput)) return res.status(400).json({ ok: false, error: "NickName cannot contain spaces" });
  if (nickRawInput.length > 10) return res.status(400).json({ ok: false, error: "NickName must be at most 10 characters" });
  if (!/^[A-Za-z0-9-]+$/.test(nickRawInput)) return res.status(400).json({ ok: false, error: "NickName can only contain letters, numbers, and '-'" });
  const nickRaw = nickRawInput.toUpperCase();
  const nickLower = nickRaw.toLowerCase();

  try {
    const dbf = admin.firestore();

    const result = await dbf.runTransaction(async (t) => {
      const nickRef = dbf.collection('nicknames').doc(nickLower);
      const nickSnap = await t.get(nickRef);
      if (nickSnap.exists) {
        throw new Error('nickname_exists');
      }

      const membersRef = dbf.collection('members').doc();
      const memberData = { ...payload };
      // Normalize some fields
      memberData.NickName = nickRaw;
      memberData.createdAt = admin.firestore.FieldValue.serverTimestamp();

      // create nickname mapping and member doc in the same transaction
      t.set(nickRef, { memberId: membersRef.id, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      t.set(membersRef, memberData);
      return { id: membersRef.id, row: memberData };
    });

    return res.status(201).json({ ok: true, id: result.id, row: result.row });
  } catch (e) {
    if (String(e.message || '').includes('nickname_exists')) {
      return res.status(409).json({ ok: false, error: 'Nickname already taken' });
    }
    console.error('members/create error', e);
    return res.status(500).json({ ok: false, error: 'server error' });
  }
});

// Simple upload proxy for local dev: accepts JSON { filename, data } where data is a dataURL or base64
// Writes the file to ./uploads and returns a URL path that the frontend can use.
app.post('/upload-photo', async (req, res) => {
  try {
    const { filename, data } = req.body || {};
    if (!data) return res.status(400).json({ ok: false, error: 'data required' });
    // strip data URL prefix if present
    const m = String(data).match(/^data:(.*?);base64,(.*)$/);
    const mime = m ? (m[1] || 'application/octet-stream') : 'application/octet-stream';
    const b64 = m ? m[2] : String(data).replace(/^data:.*;base64,/, '');
    const buf = Buffer.from(b64, 'base64');
    const safeName = (String(filename || `photo-${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '-'));
    const outName = `${Date.now()}-${safeName}`;

    // If firebase-admin is initialized and a storage bucket is configured, upload to the real bucket
    if (adminReady && process.env.FIREBASE_STORAGE_BUCKET) {
      try {
        const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
        const bucket = admin.storage().bucket(bucketName);
        const file = bucket.file(outName);
        await file.save(buf, { metadata: { contentType: mime } });
        // generate a signed URL valid for 7 days
        const expires = Date.now() + 7 * 24 * 60 * 60 * 1000;
        const [url] = await file.getSignedUrl({ action: 'read', expires });
        return res.json({ ok: true, url });
      } catch (e) {
        console.error('firebase-admin upload failed', e && e.message);
        // fall through to local save fallback
      }
    }

    // Fallback: save to local uploads dir for dev
    const outPath = path.join(uploadsDir, outName);
    fs.writeFileSync(outPath, buf);
    return res.json({ ok: true, url: `/uploads/${outName}` });
  } catch (e) {
    console.error('upload-photo error', e && e.message);
    return res.status(500).json({ ok: false, error: 'upload failed' });
  }
});

// Backwards-compatible alias so client can POST to /api/upload-photo when proxied
app.post('/api/upload-photo', async (req, res) => {
  try {
    // reuse same body handling as /upload-photo
    const { filename, data } = req.body || {};
    if (!data) return res.status(400).json({ ok: false, error: 'data required' });
    const m = String(data).match(/^data:(.*?);base64,(.*)$/);
    const mime = m ? (m[1] || 'application/octet-stream') : 'application/octet-stream';
    const b64 = m ? m[2] : String(data).replace(/^data:.*;base64,/, '');
    const buf = Buffer.from(b64, 'base64');
    const safeName = (String(filename || `photo-${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '-'));
    const outName = `${Date.now()}-${safeName}`;

    if (adminReady && process.env.FIREBASE_STORAGE_BUCKET) {
      try {
        const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
        const bucket = admin.storage().bucket(bucketName);
        const file = bucket.file(outName);
        await file.save(buf, { metadata: { contentType: mime } });
        const expires = Date.now() + 7 * 24 * 60 * 60 * 1000;
        const [url] = await file.getSignedUrl({ action: 'read', expires });
        return res.json({ ok: true, url });
      } catch (e) {
        console.error('api/upload-photo firebase-admin upload failed', e && e.message);
      }
    }

    const outPath = path.join(uploadsDir, outName);
    fs.writeFileSync(outPath, buf);
    return res.json({ ok: true, url: `/uploads/${outName}` });
  } catch (e) {
    console.error('api/upload-photo error', e && e.message);
    return res.status(500).json({ ok: false, error: 'upload failed' });
  }
});


// GET /members/check?nick=...  -> { exists: true|false }
app.get('/members/check', async (req, res) => {
  const nickRawInput = String(req.query.nick || '').trim();
  if (!nickRawInput) return res.status(400).json({ error: 'nick query param required' });
  if (/\s/.test(nickRawInput)) return res.status(400).json({ error: 'nick cannot contain spaces' });
  if (nickRawInput.length > 10) return res.status(400).json({ error: 'nick must be at most 10 characters' });
  if (!/^[A-Za-z0-9-]+$/.test(nickRawInput)) return res.status(400).json({ error: "nick can only contain letters, numbers, and '-'" });
  const nickRaw = nickRawInput.toUpperCase();
  const nickLower = nickRaw.toLowerCase();
  if (!adminReady) {
    // If admin not configured, conservatively return false so local dev isn't blocked.
    return res.json({ exists: false });
  }
  try {
    const dbf = admin.firestore();
    // Check nicknames mapping first
    const nickRef = dbf.collection('nicknames').doc(nickLower);
    const nickSnap = await nickRef.get();
    if (nickSnap.exists) return res.json({ exists: true });
    // fallback: check members collection for exact NickName field
    const q = dbf.collection('members').where('NickName', '==', nickRaw).limit(1);
    const snap = await q.get();
    if (!snap.empty) return res.json({ exists: true });
    return res.json({ exists: false });
  } catch (e) {
    console.error('members/check error', e);
    return res.status(500).json({ error: 'server error' });
  }
});
