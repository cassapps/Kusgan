// Local-first cache backed by IndexedDB (idb) with in-memory mirror for sync API.
// We keep synchronous getters (reading in-memory state) so callers don't need to be async.
import { openDB } from 'idb';

const DB_NAME = 'kusgan-local-cache';
const DB_VERSION = 1;
const STORE_KV = 'kv';
const STATE_KEY = 'state';
const PROCESS_LOCK = '__kusgan_sync_lock__';

let _state = { members: [], attendance: [], payments: [], gymEntries: [], progress: [], queue: [] };
let dbPromise = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_KV)) db.createObjectStore(STORE_KV);
      }
    });
  }
  return dbPromise;
}

async function loadStateFromIdb() {
  try {
    const db = await getDb();
    const stored = await db.get(STORE_KV, STATE_KEY);
    if (stored && typeof stored === 'object') {
      _state = Object.assign(_state, stored);
      if (!_state.members) _state.members = [];
      if (!_state.attendance) _state.attendance = [];
      if (!_state.queue) _state.queue = [];
      if (!_state.payments) _state.payments = [];
      if (!_state.gymEntries) _state.gymEntries = [];
      if (!_state.progress) _state.progress = [];
    }
  } catch (e) {
    console.warn('localCache: failed to load from idb', e && e.message);
  }
}

async function writeStateToIdb(state) {
  try {
    const db = await getDb();
    await db.put(STORE_KV, state, STATE_KEY);
  } catch (e) {
    console.warn('localCache: failed to write to idb', e && e.message);
  }
}

function ensureState() {
  if (!_state) _state = { members: [], attendance: [], payments: [], gymEntries: [], progress: [], queue: [] };
  if (!_state.members) _state.members = [];
  if (!_state.attendance) _state.attendance = [];
  if (!_state.queue) _state.queue = [];
  if (!_state.payments) _state.payments = [];
  if (!_state.gymEntries) _state.gymEntries = [];
  if (!_state.progress) _state.progress = [];
  return _state;
}

// Load initial state from idb (async) — fill _state when ready
loadStateFromIdb();

export function getCached(collection) {
  const s = ensureState();
  return s[collection] || [];
}

export function setCached(collection, rows) {
  const s = ensureState();
  s[collection] = Array.isArray(rows) ? rows : [];
  // persist async
  writeStateToIdb(s).catch(() => {});
}

function pushQueue(item) {
  const s = ensureState();
  s.queue.unshift(item);
  writeStateToIdb(s).catch(() => {});
}

export function enqueueWrite(req) {
  // req: { method, path, body, onSuccess (optional) }
  // In Firestore mode (static hosting), legacy REST endpoints don't exist.
  // Avoid queueing writes that will never succeed.
  try {
    const useFirestore = String(import.meta.env.VITE_USE_FIRESTORE ?? 'true') === 'true';
    if (useFirestore) return;
  } catch (e) { /* ignore */ }
  pushQueue({ id: 'q-' + Date.now() + '-' + Math.floor(Math.random()*1000), ...req });
  processQueue();
}

export function addOptimisticAttendance(staffName) {
  const now = new Date();
  const iso = now.toISOString();
  const ymd = iso.slice(0,10);
  const hhmm = iso.slice(11,16);
  const tempId = 'local-' + Date.now();
  const optRow = {
    id: tempId,
    Staff: staffName,
    staff_name: staffName,
    Date: ymd,
    TimeIn: hhmm,
    time_in: iso,
    status: 'On Duty',
    _localPending: true
  };
  const s = ensureState();
  s.attendance = [optRow, ...(s.attendance || [])];
  writeStateToIdb(s).catch(() => {});

  // enqueue network write (only in non-Firestore mode)
  enqueueWrite({ method: 'POST', path: '/attendance/kiosk', body: { staff_name: staffName }, tempId, collection: 'attendance' });
  return optRow;
}

export function addOptimisticMember(memberRow) {
  // memberRow should contain at least full_name and optional plan
  const tempId = 'local-m-' + Date.now();
  const created_at = new Date().toISOString();
  const opt = { id: tempId, full_name: memberRow.full_name || memberRow.fullName || '', plan: memberRow.plan || 'Monthly', status: 'Active', created_at, _localPending: true };
  const s = ensureState();
  s.members = [opt, ...(s.members || [])];
  writeStateToIdb(s).catch(() => {});
  enqueueWrite({ method: 'POST', path: '/members', body: { full_name: opt.full_name, plan: opt.plan }, tempId, collection: 'members' });
  return opt;
}

import { getToken } from './apiClient.js';

async function sendRequest(item) {
  try {
    const token = getToken && typeof getToken === 'function' ? getToken() : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(item.path, { method: item.method || 'POST', headers, body: JSON.stringify(item.body || {}) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json && json.error ? json.error : 'Request failed');
    return { ok: true, json };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

export async function processQueue() {
  // Simple single-run processor
  if (window[PROCESS_LOCK]) return;
  window[PROCESS_LOCK] = true;
  try {
    let s = ensureState();
    while ((s.queue || []).length) {
      const item = s.queue[s.queue.length - 1]; // pop from end
      if (!item) break;
      // attempt send
      const result = await sendRequest(item);
      if (result.ok) {
        // remove from queue
        s = ensureState();
        s.queue = (s.queue || []).filter(q => q.id !== item.id);
        // if attendance with tempId, replace optimistic row with server row
        if (item.collection === 'attendance' && item.tempId) {
          try {
            const serverRow = result.json && (result.json.row || result.json);
            if (serverRow) {
              s.attendance = (s.attendance || []).map(r => (r.id === item.tempId ? serverRow : r));
            }
          } catch (e) { /* ignore */ }
        }
        // if members with tempId, replace optimistic member with server row
        if (item.collection === 'members' && item.tempId) {
          try {
            const serverRow = result.json && (result.json.row || result.json);
            if (serverRow) {
              s.members = (s.members || []).map(r => (r.id === item.tempId ? serverRow : r));
            }
          } catch (e) { /* ignore */ }
        }
        writeStateToIdb(s).catch(() => {});
      } else {
        // failed: stop processing now and retry later
        break;
      }
    }
  } finally { window[PROCESS_LOCK] = false; }
}

// auto-process when online
window.addEventListener && window.addEventListener('online', () => { processQueue(); });

// expose a helper to clear cache (for debugging)
export async function clearCache() {
  try {
    _state = { members: [], attendance: [], payments: [], gymEntries: [], progress: [], queue: [] };
    const db = await getDb();
    await db.delete(STORE_KV, STATE_KEY);
  } catch (e) {
    console.warn('localCache.clearCache failed', e && e.message);
  }
}

// init
ensureState();

export default { getCached, setCached, addOptimisticAttendance, enqueueWrite, processQueue, clearCache };
