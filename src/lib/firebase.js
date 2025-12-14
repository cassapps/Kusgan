// Minimal Firebase client wrapper for browser usage (Firestore)
// Usage: set VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_APP_ID
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, doc, doc as docFn, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, query, where, orderBy, startAt, endAt, limit as limitFn, onSnapshot, documentId } from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

const clientConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  // Optional: storage bucket for Firebase Storage (e.g. 'your-bucket.appspot.com')
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let app;
let db;
let storage;
export function ensureFirebase() {
  if (!app) {
    if (getApps && getApps().length) {
      // Another module or HMR already initialized the default app — reuse it
      try { app = getApp(); } catch (e) { /* fall through to init below */ }
    }
    if (!app) {
      if (!clientConfig.projectId) throw new Error('Missing Firebase config in VITE_FIREBASE_PROJECT_ID');
      app = initializeApp(clientConfig);
    }
    db = getFirestore(app);
    try { storage = getStorage(app); } catch(e) { storage = null; }
  }
  return { app, db };
}

export function getDB() { return ensureFirebase().db; }

export function colRef(name) { return collection(getDB(), name); }
export function docRef(col, id) { return doc(getDB(), col, String(id)); }

export async function getCollection(name, opts = {}) {
  const col = colRef(name);
  if (opts.where) {
    const q = query(col, where(opts.where.field, opts.where.op || '==', opts.where.value));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  if (opts.orderBy) {
    const q = query(col, orderBy(opts.orderBy.field, opts.orderBy.dir || 'asc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  const snap = await getDocs(col);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Generic query helper: supports orderBy + startAt/endAt + limit and multiple where clauses.
export async function queryCollection(name, opts = {}) {
  const col = colRef(name);
  const constraints = [];
  if (Array.isArray(opts.wheres)) {
    for (const w of opts.wheres) {
      if (w.field === '__name__' || w.field === 'documentId') {
        constraints.push(where(documentId(), w.op || '==', w.value));
      } else {
        constraints.push(where(w.field, w.op || '==', w.value));
      }
    }
  } else if (opts.where) {
    const w = opts.where;
    if (w.field === '__name__' || w.field === 'documentId') {
      constraints.push(where(documentId(), w.op || '==', w.value));
    } else {
      constraints.push(where(w.field, w.op || '==', w.value));
    }
  }
  if (opts.orderBy) {
    constraints.push(orderBy(opts.orderBy.field, opts.orderBy.dir || 'asc'));
  }
  if (opts.startAt !== undefined) {
    constraints.push(startAt(opts.startAt));
  }
  if (opts.endAt !== undefined) {
    constraints.push(endAt(opts.endAt));
  }
  if (opts.limit) {
    constraints.push(limitFn(Number(opts.limit)));
  }
  const qref = constraints.length ? query(col, ...constraints) : query(col);
  const snap = await getDocs(qref);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Realtime listener variant of queryCollection.
// callback receives the array of docs ({id, ...data}). Returns unsubscribe.
export function listenQueryCollection(name, opts = {}, callback, onError) {
  const col = colRef(name);
  const constraints = [];
  if (Array.isArray(opts.wheres)) {
    for (const w of opts.wheres) {
      if (w.field === '__name__' || w.field === 'documentId') {
        constraints.push(where(documentId(), w.op || '==', w.value));
      } else {
        constraints.push(where(w.field, w.op || '==', w.value));
      }
    }
  } else if (opts.where) {
    const w = opts.where;
    if (w.field === '__name__' || w.field === 'documentId') {
      constraints.push(where(documentId(), w.op || '==', w.value));
    } else {
      constraints.push(where(w.field, w.op || '==', w.value));
    }
  }
  if (opts.orderBy) {
    constraints.push(orderBy(opts.orderBy.field, opts.orderBy.dir || 'asc'));
  }
  if (opts.startAt !== undefined) {
    constraints.push(startAt(opts.startAt));
  }
  if (opts.endAt !== undefined) {
    constraints.push(endAt(opts.endAt));
  }
  if (opts.limit) {
    constraints.push(limitFn(Number(opts.limit)));
  }
  const qref = constraints.length ? query(col, ...constraints) : query(col);
  const unsub = onSnapshot(
    qref,
    (snap) => {
      try {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        callback && callback(rows);
      } catch (e) {
        onError && onError(e);
      }
    },
    (err) => {
      onError && onError(err);
    }
  );
  return unsub;
}

export function listenCollection(name, callback, onError) {
  return listenQueryCollection(name, {}, callback, onError);
}

// Realtime listener for a single document by id.
// callback receives a single object ({id, ...data}) or null if it doesn't exist.
export function listenDocById(colName, id, callback, onError) {
  try {
    const ref = docRef(colName, id);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        try {
          if (!snap.exists()) return callback && callback(null);
          callback && callback({ id: snap.id, ...snap.data() });
        } catch (e) {
          onError && onError(e);
        }
      },
      (err) => onError && onError(err)
    );
    return unsub;
  } catch (e) {
    onError && onError(e);
    return () => {};
  }
}

export function getStorageInstance() {
  ensureFirebase();
  return storage;
}

export async function uploadFile(path, file) {
  const s = getStorageInstance();
  if (!s) throw new Error('Firebase Storage not initialized or not configured');
  const r = storageRef(s, path);
  // If file is a base64 string, convert to Uint8Array
  if (typeof file === 'string') {
    // assume base64 without mime prefix
    const b64 = file.replace(/^data:.*;base64,/, '');
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    await uploadBytes(r, u8);
  } else {
    await uploadBytes(r, file);
  }
  return await getDownloadURL(r);
}

export async function getDocById(colName, id) {
  const d = docRef(colName, id);
  const snap = await getDoc(d);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function addDocument(colName, data) {
  const col = colRef(colName);
  const ref = await addDoc(col, data);
  return { id: ref.id, ...data };
}

export async function setDocument(colName, id, data) {
  const d = docRef(colName, id);
  await setDoc(d, data, { merge: true });
  return { id, ...data };
}

export async function updateDocument(colName, id, patch) {
  const d = docRef(colName, id);
  await updateDoc(d, patch);
  const snap = await getDoc(d);
  return { id: snap.id, ...snap.data() };
}

export async function deleteDocument(colName, id) {
  const d = docRef(colName, id);
  await deleteDoc(d);
  return { ok: true, id: String(id) };
}

export default {
  ensureFirebase,
  getDB,
  colRef,
  docRef,
  getCollection,
  queryCollection,
  listenQueryCollection,
  listenCollection,
  listenDocById,
  getDocById,
  addDocument,
  setDocument,
  updateDocument,
  deleteDocument,
  getStorageInstance,
  uploadFile,
};
