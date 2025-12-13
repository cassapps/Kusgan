import { useEffect, useMemo, useState, useRef } from "react";
import CameraModal from "./CameraModal";
import ModalWrapper from "./ModalWrapper";
import events from "../lib/events";
import api from "../api";
const { updateMember, uploadMemberPhoto, fetchMemberById, fetchMemberByIdFresh } = api;
import { MUNICIPALITIES, getBarangays } from "../utils/locations";

// Helpers to normalize values from possibly varying header keys
const lowerMap = (obj) => {
  const m = {};
  Object.entries(obj || {}).forEach(([k, v]) => (m[String(k).toLowerCase()] = v));
  return m;
};
const pickVal = (row, ...cands) => {
  if (!row) return "";
  for (const k of cands) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== "") return row[k];
    const kl = String(k).toLowerCase();
    const m = lowerMap(row);
    if (m[kl] !== undefined && m[kl] !== "") return m[kl];
    const k1 = kl.replace(/\s+/g, "");
    if (m[k1] !== undefined && m[k1] !== "") return m[k1];
    const k2 = kl.replace(/\s+/g, "_");
    if (m[k2] !== undefined && m[k2] !== "") return m[k2];
  }
  return "";
};

function dataUrlToFile(dataUrl, filename = `photo-${Date.now()}.jpg`) {
  const arr = dataUrl.split(",");
  const mime = arr[0].match(/:(.*?);/)[1] || "image/jpeg";
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new File([u8arr], filename, { type: mime });
}

export default function EditMemberModal({ open, onClose, member, onSaved }) {
  const [form, setForm] = useState({
    lastName: "",
    firstName: "",
    middleName: "",
    nickName: "",
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
  const [existingId, setExistingId] = useState("");
  const [existingPhotoUrl, setExistingPhotoUrl] = useState("");
  const [photoPreview, setPhotoPreview] = useState("");
  const [photoFile, setPhotoFile] = useState(null);
  const previewUrlRef = useRef(null); // for object URL cleanup
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showCam, setShowCam] = useState(false);
  const [ok, setOk] = useState("");
  const initializedRef = useRef(false); // prevent re-prefill while editing
  // Dependent barangay list based on selected municipality
  const brgyOptions = getBarangays(form.municipality);

  // Drive helpers for reliable preview
  const driveId = (u) => {
    const s = String(u || "");
    const m = s.match(/(?:\/file\/d\/|[?&]id=|\/uc\?[^#]*id=)([^/&?#]+)/);
    return m && m[1] ? m[1] : "";
  };
  const driveImg = (u) => {
    const s = String(u || "");
    if (!s) return "";
    const anyUrl = s.match(/https?:\/\/[^\s}]+/);
    if (anyUrl) {
      const direct = anyUrl[0];
      if (/googleusercontent\.com\//.test(direct)) return direct;
      const mid = direct.match(/(?:\/file\/d\/|[?&]id=|\/uc\?[^#]*id=)([^/&?#]+)/);
      if (mid && mid[1]) return `https://drive.google.com/uc?export=view&id=${mid[1]}`;
      return direct;
    }
    if (/googleusercontent\.com\//.test(s)) return s;
    const id = driveId(s);
    return id ? `https://drive.google.com/uc?export=view&id=${id}` : s;
  };
  const driveThumb = (u) => {
    const s = String(u || "");
    if (/googleusercontent\.com\//.test(s)) return s;
    const id = driveId(s);
    return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w1000` : s;
  };

  // Prefill once per open. Avoid resetting user input if parent re-renders or member prop refreshes.
  useEffect(() => {
    let cancelled = false;
    if (!open) { initializedRef.current = false; return; }
    if (initializedRef.current) return; // already initialized for this open session
    const row = member || {};
    const id = String(pickVal(row, "MemberID", "memberId", "member_id", "id") || "").trim();
    setExistingId(id);

    // Fetch authoritative member data from the server when the modal opens so the editor
    // shows the freshest values. Fall back to the provided `member` prop if fetch fails.
    (async () => {
      try {
        if (id) {
          const fresh = await fetchMemberById(String(id).trim());
          if (!cancelled && fresh) {
            const ln = pickVal(fresh, "LastName", "lastName", "last_name", "Last");
            const fn = pickVal(fresh, "FirstName", "firstName", "first_name", "First");
            const mn = pickVal(fresh, "MiddleName", "middleName", "middle_name");
            const nn = pickVal(fresh, "NickName", "nickname", "nick_name", "Nick Name");
            const gen = pickVal(fresh, "Gender", "gender");
            const bday = pickVal(fresh, "Birthday", "birth_date", "dob", "Birth Date");
            const street = pickVal(fresh, "Street", "street");
            const brgy = pickVal(fresh, "Brgy", "Barangay", "brgy", "barangay");
            const muni = pickVal(fresh, "Municipality", "City", "municipality", "city");
            const email = pickVal(fresh, "Email", "email");
            const mobile = pickVal(fresh, "Mobile", "Phone", "mobile", "phone");
            const validId = pickVal(fresh, "ValidID", "Valid Id", "Valid ID", "validId", "valid_id");
            const rawDiscount = pickVal(fresh, "Discount", "discount", "discount_rate", "discountRate", "DiscountRate", "discount_type", "discountType") || '';
            let discount = String(rawDiscount || '').trim().toLowerCase();
            if (!discount || discount === 'n/a' || discount === 'na' || discount === 'none') discount = 'na';
            else if (discount.includes('student')) discount = 'student';
            else if (discount.includes('special')) discount = 'special';
            else discount = 'na';
            const legacyStudent = String(pickVal(fresh, "Student", "student") || "").toLowerCase().startsWith("y");
            if (discount === 'na' && legacyStudent) discount = 'student';
            const photo = pickVal(fresh, "PhotoURL", "photoUrl", "photo_url", "photo");
            const normalized = photo ? driveThumb(driveImg(photo)) : "";
            setExistingPhotoUrl(photo || "");
            setPhotoPreview(normalized);
            setPhotoFile(null);
            setErr("");
            const candidateBrgy = String(brgy || "");
            setForm({
              lastName: String(ln || ""),
              firstName: String(fn || ""),
              middleName: String(mn || ""),
              nickName: String(nn || ""),
              gender: String(gen || ""),
              birthday: bday ? new Date(bday).toISOString().slice(0, 10) : "",
              street: String(street || ""),
              brgy: candidateBrgy,
              municipality: String(muni || ""),
              email: String(email || ""),
              mobile: String(mobile || ""),
              validId: String(validId || ""),
              discount,
            });
            initializedRef.current = true;
            return;
          }
        }
      } catch (e) {
        // ignore fetch error and fall back to passed member
      }

      // fallback: use prop `member` if fetch failed or no id
      if (!cancelled) {
        const ln = pickVal(row, "LastName", "lastName", "last_name", "Last");
        const fn = pickVal(row, "FirstName", "firstName", "first_name", "First");
        const mn = pickVal(row, "MiddleName", "middleName", "middle_name");
        const nn = pickVal(row, "NickName", "nickname", "nick_name", "Nick Name");
        const gen = pickVal(row, "Gender", "gender");
        const bday = pickVal(row, "Birthday", "birth_date", "dob", "Birth Date");
        const street = pickVal(row, "Street", "street");
        const brgy = pickVal(row, "Brgy", "Barangay", "brgy", "barangay");
        const muni = pickVal(row, "Municipality", "City", "municipality", "city");
        const email = pickVal(row, "Email", "email");
        const mobile = pickVal(row, "Mobile", "Phone", "mobile", "phone");
        const validId = pickVal(row, "ValidID", "Valid Id", "Valid ID", "validId", "valid_id");
        const rawDiscount = pickVal(row, "Discount", "discount", "discount_rate", "discountRate", "DiscountRate", "discount_type", "discountType") || '';
        let discount = String(rawDiscount || '').trim().toLowerCase();
        if (!discount || discount === 'n/a' || discount === 'na' || discount === 'none') discount = 'na';
        else if (discount.includes('student')) discount = 'student';
        else if (discount.includes('special')) discount = 'special';
        else discount = 'na';
        const legacyStudent = String(pickVal(row, "Student", "student") || "").toLowerCase().startsWith("y");
        if (discount === 'na' && legacyStudent) discount = 'student';
        const photo = pickVal(row, "PhotoURL", "photoUrl", "photo_url", "photo");
        const normalized = photo ? driveThumb(driveImg(photo)) : "";
        setExistingPhotoUrl(photo || "");
        setPhotoPreview(normalized);
        setPhotoFile(null);
        setErr("");
        const candidateBrgy = String(brgy || "");
        setForm({
          lastName: String(ln || ""),
          firstName: String(fn || ""),
          middleName: String(mn || ""),
          nickName: String(nn || ""),
          gender: String(gen || ""),
          birthday: bday ? new Date(bday).toISOString().slice(0, 10) : "",
          street: String(street || ""),
          brgy: candidateBrgy,
          municipality: String(muni || ""),
          email: String(email || ""),
          mobile: String(mobile || ""),
          validId: String(validId || ""),
          discount,
        });
        initializedRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, [open, member]);

  const onChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (name === "discount-select") {
      setForm((s) => ({ ...s, discount: String(value) || 'na' }));
      return;
    }
    if (name === "municipality") {
      setForm((s) => ({ ...s, municipality: value, brgy: "" }));
      return;
    }
    setForm((s) => ({ ...s, [name]: type === "checkbox" ? checked : value }));
  };

  const onPickFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (previewUrlRef.current) { URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = null; }
    const url = URL.createObjectURL(f);
    previewUrlRef.current = url;
    setPhotoFile(f);
    setPhotoPreview(url);
  };

  const onCapture = (dataUrl) => {
    try {
      const f = dataUrlToFile(dataUrl);
      if (previewUrlRef.current) { URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = null; }
      const url = URL.createObjectURL(f);
      previewUrlRef.current = url;
      setPhotoFile(f);
      setPhotoPreview(url);

      // If we have an existing member id, proactively upload the captured photo
      // and return the upload promise so CameraModal can await it for a smooth UX.
      if (existingId) {
        const idLower = String(existingId).trim().toLowerCase();
        const uploadPromise = (async () => {
          try {
            const res = await uploadMemberPhoto(f, idLower);
            const photoUrl = typeof res === "string" ? res : (res?.url || "");
            // update authoritative photo url and preview to the stored location
            setExistingPhotoUrl(photoUrl || existingPhotoUrl);
            const normalized = photoUrl ? driveThumb(driveImg(photoUrl)) : url;
            setPhotoPreview(normalized);
            // we've already uploaded the file; clear local file so `save` won't re-upload
            setPhotoFile(null);
            return photoUrl;
          } catch (err) {
            // surface error but resolve so CameraModal doesn't stay waiting
            try { setErr(String(err || 'Photo upload failed')); } catch {}
            return null;
          }
        })();
        // ensure we always return a Promise that resolves (possibly to null)
        return Promise.resolve(uploadPromise).catch(() => null);
      }
    } catch (e) {
      try { setErr(String(e || 'Failed to handle capture')); } catch {}
      return Promise.resolve(null);
    }
    return Promise.resolve(null);
  };

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) { URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = null; }
    };
  }, []);

  const sameAfterUpdate = (a, b) => {
    if (!a || !b) return false;
    const norm = (v) => String(v ?? "").trim();
    return (
      norm(a.LastName) === norm(b.LastName) &&
      norm(a.FirstName) === norm(b.FirstName) &&
      norm(a.MiddleName) === norm(b.MiddleName) &&
      norm(a.Gender) === norm(b.Gender) &&
      norm(a.Birthday) === norm(b.Birthday) &&
      norm(a.Street) === norm(b.Street) &&
      norm(a.Brgy) === norm(b.Brgy) &&
      norm(a.Municipality) === norm(b.Municipality) &&
      norm(a.Email) === norm(b.Email) &&
      norm(a.Mobile) === norm(b.Mobile) &&
      norm(a.ValidID) === norm(b.ValidID) &&
      norm(a.Discount) === norm(b.Discount) &&
      norm(a.Student) === norm(b.Student)
    );
  };

  const save = async (e) => {
    try { e?.preventDefault?.(); } catch(e) {}
    if (!existingId) { setErr("Missing MemberID"); return; }
    // debug marker to surface start of save
    try { console.debug('[EditMemberModal] save() starting for', existingId); } catch(e) {}
    // Build optimistic payload from current form (use existingPhotoUrl for now)
    const optimisticPayload = {
      MemberID: existingId,
      LastName: form.lastName.trim(),
      FirstName: form.firstName.trim(),
      MiddleName: form.middleName.trim(),
      NickName: String(form.nickName || "").trim().toUpperCase(),
      Gender: form.gender,
      Birthday: form.birthday || "",
      Street: form.street.trim(),
      Brgy: form.brgy.trim(),
      Municipality: form.municipality.trim(),
      Email: form.email.trim(),
      Mobile: form.mobile.trim(),
      ValidID: form.validId.trim(),
      Discount: form.discount === 'student' ? 'Student Rate' : (form.discount === 'special' ? 'Special Rate' : 'N/A'),
      // legacy field (keep for older UI/data expectations)
      Student: form.discount === 'student' ? "Yes" : "No",
      // If user picked a new photo, use the local preview so the card updates immediately.
      PhotoURL: photoPreview || existingPhotoUrl || "",
    };

    // Debug: show optimistic payload so we can trace what we attempted to send
    try { console.debug('[EditMemberModal] optimisticPayload', optimisticPayload); } catch (e) { /* ignore */ }

    // Perform network operations and wait for an authoritative server row before
    // closing the modal or informing the parent. This ensures the MemberDetail
    // reads directly from the database and displays authoritative values.
    setBusy(true);
    setErr("");
    try {
      let photoUrl = existingPhotoUrl || "";
      if (photoFile) {
        try {
          // protect against hanging network calls (CORS/proxy down) with a timeout
          const uploadPromise = uploadMemberPhoto(photoFile, String(existingId).toLowerCase());
          const uploadWithTimeout = Promise.race([
            uploadPromise,
            new Promise((_, rej) => setTimeout(() => rej(new Error('photo upload timeout')), 15000)),
          ]);
          const res = await uploadWithTimeout;
          try { console.debug('[EditMemberModal] uploadMemberPhoto result', res); } catch (e) {}
          photoUrl = typeof res === "string" ? res : (res?.url || photoUrl);
          // clear local file if upload succeeded
          setPhotoFile(null);
        } catch (upErr) {
          // Upload failed (CORS or network). Surface error but continue with save using existingPhotoUrl.
          try { console.debug('[EditMemberModal] uploadMemberPhoto failed', String(upErr)); } catch (e) {}
          setErr(String(upErr) || 'Photo upload failed — saving without photo change');
          // do not rethrow; continue to attempt update with current photoUrl
        }
      }

      const payload = { ...optimisticPayload, PhotoURL: photoUrl };

      // Send update and try to obtain authoritative row from server response.
      let authoritative = null;
      try {
        try { console.debug('[EditMemberModal] sending update payload', payload); } catch (e) {}
        // wrap updateMember in a timeout to avoid hanging when Firestore or the API proxy is unreachable
        const updatePromise = updateMember(payload);
        const resp = await Promise.race([
          updatePromise,
          new Promise((_, rej) => setTimeout(() => rej(new Error('update timeout')), 20000)),
        ]);
        try { console.debug('[EditMemberModal] updateMember response', resp); } catch (e) {}
        if (resp && typeof resp === 'object') {
          if (resp.row && typeof resp.row === 'object') authoritative = resp.row;
          else if (resp.updated && typeof resp.updated === 'object') authoritative = resp.updated;
          else if (resp.data && typeof resp.data === 'object') authoritative = resp.data;
          else {
            const hasMemberKeys = ['MemberID','memberid','LastName','FirstName'].some(k => Object.prototype.hasOwnProperty.call(resp, k));
            if (hasMemberKeys) authoritative = resp;
          }
        }
        try { console.debug('[EditMemberModal] authoritative after response', authoritative); } catch (e) {}
      } catch (err) {
        // surface server error to the user
        try { console.debug('[EditMemberModal] updateMember error', String(err)); } catch (e) {}
        setErr(String(err) || 'Failed to update member');
        events.emit('modal:error', { message: 'Failed to update member', source: 'EditMemberModal', error: String(err) });
      }

      // If server didn't echo a row, fetch fresh authoritative row directly
      if (!authoritative) {
        try {
          try { console.debug('[EditMemberModal] fetching fresh member by id', String(existingId).trim()); } catch (e) {}
          // protect fetch from hanging
          const fetchPromise = fetchMemberByIdFresh(String(existingId).trim());
          const fresh = await Promise.race([
            fetchPromise,
            new Promise((_, rej) => setTimeout(() => rej(new Error('fetch member timeout')), 15000)),
          ]);
          try { console.debug('[EditMemberModal] fetchMemberByIdFresh result', fresh); } catch (e) {}
          if (fresh) authoritative = fresh;
        } catch (e) {
          // fall back to payload if fetch fails
          try { console.debug('[EditMemberModal] fetchMemberByIdFresh failed', String(e)); } catch (ee) {}
        }
      }

  if (!authoritative) authoritative = payload;

  try { console.debug('[EditMemberModal] final authoritative row passed to parent', authoritative); } catch (e) {}

  // Inform parent with authoritative row and close modal
  try { onSaved?.(authoritative); } catch (e) { /* ignore parent handler errors */ }
  try { onClose?.(); } catch (e) {}
    } catch (e2) {
      events.emit('modal:error', { message: 'Background member update failed', source: 'EditMemberModal', error: String(e2) });
      setErr(String(e2) || 'Background member update failed');
    } finally {
      setBusy(false);
    }
  };


  if (!open) return null;

  return (
  <ModalWrapper open={open} onClose={onClose} title={form.nickName || "Edit Member"} width={1000} noInternalScroll={true}>
    <form onSubmit={save} style={{ width: "100%", padding: 0, background: "transparent", border: "none", boxShadow: "none", overflow: "visible" }}>
        {ok && (
          <div style={{ position: 'fixed', top: 20, right: 20, background: '#16a34a', color: '#fff', padding: '8px 12px', borderRadius: 10, boxShadow: '0 6px 16px rgba(0,0,0,.15)', zIndex: 10000 }}>
            {ok}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 16 }}>
          {/* Photo */}
          <div>
            <div style={{ width: 240, height: 240, border: "1px solid var(--light-border)", borderRadius: 12, background: "#fafbff", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {photoPreview ? (
                <img src={photoPreview} alt="preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <div style={{ color: "var(--muted)" }}>No photo</div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button type="button" className="button" onClick={() => setShowCam(true)} disabled={true} title="Camera disabled in this build" style={{ flex: '1 1 auto', cursor: 'not-allowed', opacity: 0.6 }}>📷 Change Photo</button>
              {/* Removed Upload button to make Change Photo wider */}
            </div>
          </div>

          {/* Fields: arranged by rows as requested */}
          <div style={{ display: "grid", gap: 12 }}>
            {/* Row 1: Valid ID, Discount */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 12, alignItems: 'end' }}>
              <label className="field" style={{ margin: 0 }}>
                <span className="label">Valid ID *</span>
                <input name="validId" value={form.validId} onChange={onChange} required />
              </label>
              <label className="field" style={{ margin: 0 }}>
                <span className="label">Discount</span>
                <select name="discount-select" value={form.discount} onChange={onChange}>
                  <option value="na">N/A</option>
                  <option value="special">Special Rate</option>
                  <option value="student">Student Rate</option>
                </select>
              </label>
            </div>

            {/* Row 2: Last, First, Middle */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <label className="field">
                <span className="label">Last Name *</span>
                <input name="lastName" value={form.lastName} onChange={onChange} required />
              </label>
              <label className="field">
                <span className="label">First Name *</span>
                <input name="firstName" value={form.firstName} onChange={onChange} required />
              </label>
              <label className="field">
                <span className="label">Middle Name</span>
                <input name="middleName" value={form.middleName} onChange={onChange} />
              </label>
            </div>

            {/* Row 3: Birthday, Gender */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label className="field">
                <span className="label">Birthday *</span>
                <input type="date" name="birthday" value={form.birthday} onChange={onChange} required />
              </label>
              <label className="field">
                <span className="label">Gender *</span>
                <select name="gender" value={form.gender} onChange={onChange} required>
                  <option value="">— Select —</option>
                  <option>Male</option>
                  <option>Female</option>
                </select>
              </label>
            </div>

            {/* Row 4: Mobile, Email */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label className="field">
                <span className="label">Mobile No. *</span>
                <input name="mobile" value={form.mobile} onChange={onChange} placeholder="09XXXXXXXXX" required />
              </label>
              <label className="field">
                <span className="label">Email Address</span>
                <input name="email" value={form.email} onChange={onChange} placeholder="name@example.com" />
              </label>
            </div>

            {/* Row 5: Municipality/City, Brgy., House/Street/Sitio */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 12 }}>
              <label className="field">
                <span className="label">Municipality / City</span>
                <select name="municipality" value={form.municipality} onChange={onChange}>
                  <option value=""></option>
                  {MUNICIPALITIES.map((m)=> (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="label">Brgy.</span>
                <select name="brgy" value={form.brgy} onChange={onChange} disabled={!form.municipality}>
                  <option value=""></option>
                  {brgyOptions.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="label">House No. / Street Name / Sitio</span>
                <input name="street" value={form.street} onChange={onChange} />
              </label>
            </div>
              {/* Error block: render here (below municipality fields) with larger text */}
              {err && (
                <div style={{ color: '#d33', fontSize: 15, marginTop: 8, fontWeight: 600 }}>{err}</div>
              )}
          </div>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" className="back-btn" onClick={onClose} style={{ background: "#e5e7eb", color: "#111", fontWeight: 700 }}>Cancel</button>
          <button type="button" className="primary-btn" disabled={busy} onClick={save}>💾 Save Changes</button>
        </div>

        <CameraModal open={showCam} onClose={() => setShowCam(false)} onCapture={onCapture} />
      </form>
    </ModalWrapper>
  );
}
