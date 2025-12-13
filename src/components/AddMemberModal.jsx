import { useEffect, useRef, useState } from "react";
import { useNavigate } from 'react-router-dom';
import CameraModal from "./CameraModal";
import ModalWrapper from "./ModalWrapper";
import events from "../lib/events";
import api from "../api";
import localCache from '../lib/localCache.js';
const { uploadMemberPhoto, saveMember, fetchMembersFresh } = api;
import { MUNICIPALITIES, getBarangays } from "../utils/locations";

export default function AddMemberModal({ open, onClose, onSaved }) {
  const [form, setForm] = useState({
    nickName: "",
    lastName: "",
    firstName: "",
    middleName: "",
    gender: "",
    birthday: "",
    street: "",
    brgy: "",
    municipality: "",
    email: "",
    mobile: "",
    validId: "",
    discount: "na",
  });
  const [photoPreview, setPhotoPreview] = useState("");
  const [photoFile, setPhotoFile] = useState(null);
  const previewUrlRef = useRef(null);
  const [showCam, setShowCam] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  // Dependent barangay list based on selected municipality
  const brgyOptions = getBarangays(form.municipality);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) {
      // reset form when closed
      setForm({
        nickName: "",
        lastName: "",
        firstName: "",
        middleName: "",
        gender: "",
        birthday: "",
        street: "",
        brgy: "",
        municipality: "",
        email: "",
        mobile: "",
        validId: "",
        discount: "na",
      });
      setPhotoPreview("");
      setPhotoFile(null);
      setErr("");
      setOk("");
      if (previewUrlRef.current) { URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = null; }
    }
  }, [open]);

  const onChange = (e) => {
    const { name, value } = e.target;
    if (name === "discount-select") {
      setForm((s) => ({ ...s, discount: String(value) || "na" }));
      return;
    }
    if (name === "municipality") {
      // Reset barangay when municipality changes
      setForm((s) => ({ ...s, municipality: value, brgy: "" }));
      return;
    }
    setForm((s) => ({ ...s, [name]: value }));
  };

  const openCamera = () => setShowCam(true);
  const onCapture = (dataUrl) => {
    try {
      const arr = dataUrl.split(",");
      const mime = (arr[0].match(/:(.*?);/)?.[1]) || "image/jpeg";
      const bin = atob(arr[1]);
      const u8 = new Uint8Array(bin.length);
      for (let i=0;i<bin.length;i++) u8[i] = bin.charCodeAt(i);
      const f = new File([u8], `passport-${Date.now()}.jpg`, { type: mime });
      if (previewUrlRef.current) { URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = null; }
      const url = URL.createObjectURL(f);
      previewUrlRef.current = url;
      setPhotoFile(f);
      setPhotoPreview(url);
    } catch { /* ignore */ }
  };

  useEffect(() => () => { if (previewUrlRef.current) { URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = null; } }, []);

  function buildLocalMemberId(nick, when = new Date()) {
    const clean = String(nick||"").replace(/[^A-Za-z0-9]/g,"").toUpperCase();
    const nick6 = clean.slice(0,6);
    const y = String(when.getFullYear()%100).padStart(2,"0");
    const m = String(when.getMonth()+1).padStart(2,"0");
    const d = String(when.getDate()).padStart(2,"0");
    return (nick6 + y + m + d).slice(0,12);
  }

  const save = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const nickUp = String(form.nickName || "").trim().toUpperCase();
      if (!nickUp) throw new Error("Nick Name is required");
      // Server-side check to avoid uploading photo if nickname already taken.
      try {
        const checkRes = await fetch(`/api/members/check?nick=${encodeURIComponent(nickUp)}`);
        if (checkRes && checkRes.ok) {
          const body = await checkRes.json();
          if (body.exists) throw new Error('Nick Name already taken');
        }
      } catch (eCheck) {
        // If check failed (server not configured), fall back to client search helper
        try {
          const searchRes = await api.searchMembersByName(nickUp);
          const found = (searchRes?.rows || []).some(r => (String(r.NickName || r.nickName || r.nickname || r.nick_name || r.nick || '')).toUpperCase() === nickUp);
          if (found) throw new Error('Nick Name already taken');
        } catch (_) {
          // ignore and let server enforce on save
        }
      }

  const now = new Date();
  const baseId = buildLocalMemberId(nickUp, now);
      const baseIdLower = baseId.toLowerCase();

      let photoUrl = "";
      if (photoFile) {
        const uploadRes = await uploadMemberPhoto(photoFile, baseIdLower);
        photoUrl = typeof uploadRes === "string" ? uploadRes : (uploadRes?.url || "");
      }

      const row = {
        LastName: String(form.lastName || "").trim(),
        FirstName: String(form.firstName || "").trim(),
        MiddleName: String(form.middleName || "").trim(),
        NickName: nickUp,
        Gender: form.gender,
        Birthday: form.birthday || "",
        Street: String(form.street || "").trim(),
    Brgy: String(form.brgy || "").trim(),
        Municipality: String(form.municipality || "").trim(),
        Email: String(form.email || "").trim(),
        Mobile: String(form.mobile || "").trim(),
        ValidID: String(form.validId || "").trim(),
        Discount: form.discount === 'student' ? 'Student Rate' : (form.discount === 'special' ? 'Special Rate' : 'N/A'),
        // legacy field (keep for older UI/data expectations)
        Student: form.discount === 'student' ? "Yes" : "No",
        // store photo under multiple common keys to maximize compatibility
        PhotoURL: photoUrl,
        photourl: photoUrl,
        photo: photoUrl,
        // Save MemberSince as an ISO string so the server and Firestore store a portable value
        MemberSince: now.toISOString(),
      };

  // Local-first: add optimistic member to local cache immediately
  try { localCache.addOptimisticMember({ full_name: `${row.FirstName} ${row.LastName}`.trim(), plan: 'Monthly' }); } catch (_) {}
  const resp = await saveMember(row);
  if (!resp?.ok) throw new Error(resp?.error || "Failed to save");

      setOk("Member added");
      // slight delay for toast
      setTimeout(async () => {
        try { await fetchMembersFresh(); } catch(_) {}
        // Pass the server response to the parent (id + row) so callers can react
        try { onSaved?.(resp); } catch(e) {}
        try { onClose?.(); } catch(e) {}
        // Navigate to the newly created member's detail page if server provided an id
        try {
          // If we have an id, navigate to the member detail route and pass the row
          const newId = resp?.id || (resp?.row && (resp.row.MemberID || resp.row.memberId || resp.row.id));
          if (newId) {
            try { navigate(`/members/${encodeURIComponent(String(newId))}`, { state: { row: resp.row } }); } catch(e) {}
          }
        } catch (e) {}
        setOk("");
      }, 600);
    } catch (e2) {
      const msg = e2?.message || "Failed to save";
      setErr(msg);
      try { events.emit('modal:error', { message: msg, source: 'AddMemberModal', error: String(e2) }); } catch(e) {}
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
  <ModalWrapper open={open} onClose={onClose} title="Add Member" width={1000} noInternalScroll={true}>
    <form onSubmit={save} style={{ width: "100%", padding: 0, background: "transparent", border: "none", boxShadow: "none", overflow: "visible" }}>

        {err && <div className="small-error" style={{ marginBottom: 8 }}>{err}</div>}
        {ok && (
          <div style={{ position: 'fixed', top: 20, right: 20, background: '#16a34a', color: '#fff', padding: '8px 12px', borderRadius: 10, boxShadow: '0 6px 16px rgba(0,0,0,.15)', zIndex: 10000 }}>
            {ok}
          </div>
        )}

        {/* Photo + fields grid matching Edit layout (240px photo left) */}
        <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 16 }}>
          {/* Column 1: photo area and camera button BELOW photo */}
          <div>
            <div style={{ width: 240, height: 240, border: "1px solid var(--light-border)", borderRadius: 12, background: "#fafbff", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {photoPreview ? (
                <img src={photoPreview} alt="preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <div style={{ color: "var(--muted)" }}>No photo</div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button type="button" className="button" onClick={openCamera} disabled={true} title="Camera disabled in this build" style={{ flex: '1 1 auto', cursor: 'not-allowed', opacity: 0.6 }}>📷 Open Camera</button>
            </div>
          </div>

          {/* Column 2: controls */}
          <div>
            {/* Row 0: Nick Name, Valid ID, Discount */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 160px', gap: 12, alignItems: 'end' }}>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">Nick Name *</label>
                <input name="nickName" value={form.nickName} onChange={onChange} required disabled={busy} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">Valid ID *</label>
                <input name="validId" value={form.validId} onChange={onChange} required disabled={busy} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">Discount</label>
                <select name="discount-select" value={form.discount} onChange={onChange} disabled={busy}>
                  <option value="na">N/A</option>
                  <option value="special">Special Rate</option>
                  <option value="student">Student Rate</option>
                </select>
              </div>
            </div>

            {/* Row 1: Last, First, Middle */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 12 }}>
              <div className="field"><label className="label">Last Name *</label><input name="lastName" value={form.lastName} onChange={onChange} required disabled={busy} /></div>
              <div className="field"><label className="label">First Name *</label><input name="firstName" value={form.firstName} onChange={onChange} required disabled={busy} /></div>
              <div className="field"><label className="label">Middle Name</label><input name="middleName" value={form.middleName} onChange={onChange} disabled={busy} /></div>
            </div>

            {/* Row 2: Birthday, Gender */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
              <div className="field"><label className="label">Birthday *</label><input type="date" name="birthday" value={form.birthday} onChange={onChange} required disabled={busy} /></div>
              <div className="field"><label className="label">Gender *</label>
                <select name="gender" value={form.gender} onChange={onChange} required disabled={busy}>
                  <option value=""></option>
                  <option>Male</option>
                  <option>Female</option>
                </select>
              </div>
            </div>

            {/* Row 3: Mobile, Email */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
              <div className="field"><label className="label">Mobile *</label><input name="mobile" value={form.mobile} onChange={onChange} required disabled={busy} /></div>
              <div className="field"><label className="label">Email</label><input name="email" type="email" value={form.email} onChange={onChange} disabled={busy} /></div>
            </div>

            {/* Row 4: Municipality/City, Brgy., Street */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 12, marginTop: 12 }}>
                  <div className="field"><label className="label">Municipality / City</label>
                    <select name="municipality" value={form.municipality} onChange={onChange} disabled={busy}>
                      <option value=""></option>
                      {MUNICIPALITIES.map((m)=> (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label className="label">Brgy.</label>
                    <select name="brgy" value={form.brgy} onChange={onChange} disabled={busy || !form.municipality}>
                      <option value=""></option>
                      {brgyOptions.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field"><label className="label">House No. / Street Name / Sitio</label><input name="street" value={form.street} onChange={onChange} disabled={busy} /></div>
            </div>

            {/* Actions are rendered at the very bottom to match Edit layout */}
          </div>

        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" className="back-btn" onClick={onClose} style={{ background: "#e5e7eb", color: "#111", fontWeight: 700 }}>Cancel</button>
          <button type="submit" className="primary-btn" disabled={busy}>Save</button>
        </div>

        {showCam && (
          <CameraModal
            open={showCam}
            onClose={() => setShowCam(false)}
            onCapture={onCapture}
            aspectRatio={3/4}
            targetWidth={720}
            targetHeight={960}
          />
        )}
      </form>
    </ModalWrapper>
  );
}
