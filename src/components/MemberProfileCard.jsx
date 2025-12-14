import React, { useState, useEffect } from 'react';

// Lightweight helpers (kept local to avoid circular imports)
const firstOf = (o, ks) => ks.map((k) => o[k]).find((v) => v !== undefined && v !== "");
const asDate = (v) => {
  if (!v && v !== 0) return null;
  try {
    if (v && typeof v.toDate === "function") return v.toDate();
  } catch (e) {}
  if (v && typeof v.seconds === "number") return new Date(v.seconds * 1000);
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d) ? null : d;
};
const MANILA_TZ = 'Asia/Manila';
const fmtDate = (d) => {
  if (!d) return "-";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date)) return "-";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: MANILA_TZ, month: "short", day: "numeric", year: "numeric" }).formatToParts(date);
  const m = parts.find((p) => p.type === "month")?.value || "";
  const day = parts.find((p) => p.type === "day")?.value || "";
  const y = parts.find((p) => p.type === "year")?.value || "";
  return `${m}-${day}, ${y}`;
};
const display = (v) => (v === undefined || v === null || String(v).trim() === "" ? "-" : String(v));

// Drive helpers copied from MemberDetail to normalize URLs and thumbnails
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
    const mid = direct.match(/(?:\/file\/d\/|[?&]id=|\/uc\?[^#]*id=)([^\/&?#]+)/);
    if (mid && mid[1]) return `https://drive.google.com/uc?export=view&id=${mid[1]}`;
    return direct;
  }
  if (/googleusercontent\.com\//.test(s)) return s;
  const m = s.match(/\/file\/d\/([^/]+)/) || s.match(/[?&]id=([^&]+)/) || s.match(/\/uc\?[^#]*id=([^&]+)/);
  const id = m ? m[1] : "";
  if (id) return `https://drive.google.com/uc?export=view&id=${id}`;
  return s;
};
const driveThumb = (u) => {
  const s = String(u || "");
  if (/googleusercontent\.com\//.test(s)) return s;
  const id = driveId(s);
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w1000` : s;
};

export default function MemberProfileCard({ member, status = {}, isRefreshing = false, onEdit = () => {}, onAddPayment = () => {}, onShowQr = () => {}, onShowProgress = () => {}, onCheckIn = () => {} }) {
  const [imgFailed, setImgFailed] = useState(false);

  const lastName = firstOf(member || {}, ["lastname","last_name"]);
  const firstName = firstOf(member || {}, ["firstname","first_name"]);
  const middle = firstOf(member || {}, ["middlename","middle_name"]);
  const gender = firstOf(member || {}, ["gender"]);
  const bdayRaw = firstOf(member || {}, ["birthday","birth_date","dob"]);
  const bday = asDate(bdayRaw);
  const nick = firstOf(member || {}, ["nick_name","nickname"]);
  const street = firstOf(member || {}, ["street"]);
  const brgy = firstOf(member || {}, ["brgy","barangay"]);
  const muni = firstOf(member || {}, ["municipality","city"]);
  const email = firstOf(member || {}, ["email"]);
  const mobile = firstOf(member || {}, ["mobile","phone"]);
  const memberSince = asDate(firstOf(member || {}, ["member_since","membersince","join_date"]));
  const id = String(firstOf(member || {}, ["memberid","member_id","id"]) || "").trim();
  const photoRaw = firstOf(member || {}, ["photourl","photo_url","photo"]);
  const photoUrl = driveImg(photoRaw);
  const photoSrc = driveThumb(photoUrl);

  useEffect(() => { setImgFailed(false); }, [photoUrl]);

  const age = bday ? (new Date().getFullYear() - bday.getFullYear() - ((new Date().getMonth() < bday.getMonth() || (new Date().getMonth() === bday.getMonth() && new Date().getDate() < bday.getDate())) ? 1 : 0)) : "-";

  return (
    <div className="member-card" style={{ marginTop: 12 }}>
      <div className="member-photo">
        <div className="photo-box">
          {photoUrl && !imgFailed ? (
            <img
              src={driveThumb(photoUrl)}
              alt="photo"
              onError={(e) => {
                const el = e.currentTarget;
                if (!el.dataset.retry && photoRaw) {
                  el.dataset.retry = "1";
                  const id = driveId(photoRaw) || driveId(photoUrl);
                  if (id) el.src = `https://drive.google.com/uc?export=view&id=${id}`;
                  else el.style.display = "none";
                } else if (el.dataset.retry === "1") {
                  el.dataset.retry = "2";
                  const id = driveId(photoRaw) || driveId(photoUrl);
                  if (id) el.src = `https://drive.google.com/uc?export=download&id=${id}`;
                  else setImgFailed(true);
                } else {
                  setImgFailed(true);
                }
              }}
            />
          ) : (
            <div style={{ color: "var(--muted)", padding: 16 }}>No photo</div>
          )}
        </div>
      </div>

      <div className="member-info">
        <div className="member-grid">
          <div className="cell lastname">
            <div className="label">Last Name</div>
            <div className="value">{display(lastName)}</div>
          </div>
          <div className="cell firstname">
            <div className="label">First Name</div>
            <div className="value">{display(firstName)}</div>
          </div>
          <div className="cell middlename">
            <div className="label">Middle Name</div>
            <div className="value">{display(middle)}</div>
          </div>

          <div className="cell gender">
            <div className="label">Gender</div>
            <div className="value">{display(gender)}</div>
          </div>
          <div className="cell birthday">
            <div className="label">Birthday</div>
            <div className="value">{fmtDate(bday)}</div>
          </div>
          <div className="cell age">
            <div className="label">Age</div>
            <div className="value">{display(age)}</div>
          </div>

          <div className="cell street">
            <div className="label">House No. / Street Name / Sitio</div>
            <div className="value">{display(street)}</div>
          </div>
          <div className="cell brgy">
            <div className="label">Brgy.</div>
            <div className="value">{display(brgy)}</div>
          </div>
          <div className="cell municipality">
            <div className="label">Municipality / City</div>
            <div className="value">{display(muni)}</div>
          </div>

          <div className="cell nickname">
            <div className="label">Member Since</div>
            <div className="value">{fmtDate(memberSince)}</div>
          </div>
          <div className="cell mobile">
            <div className="label">Mobile</div>
            <div className="value">{display(mobile)}</div>
          </div>
          <div className="cell email">
            <div className="label">Email</div>
            <div className="value">{display(email)}</div>
          </div>
        </div>

        <div className="status-tiles">
          <div className={`status-tile ${status.membershipState == null ? 'none' : status.membershipState}`}>
            <div className="title">Gym Membership</div>
            <div style={{ marginBottom: 10 }}>
              {status.membershipState === 'active' && <span className="pill ok">Active</span>}
              {status.membershipState === 'expired' && <span className="pill bad">Expired</span>}
              {(!status.membershipState || status.membershipState === 'none') && <span className="pill" style={{ background:'#fff', color:'#555', borderColor:'#ddd' }}>None</span>}
            </div>
            <div className="label">Valid until</div>
            <div className="value">{fmtDate(status.membershipEnd)}</div>
          </div>

          <div className={`status-tile ${status.coachEnd ? (status.coachActive ? 'active' : 'expired') : 'none'}`}>
            <div className="title">Coach Subscription</div>
            <div style={{ marginBottom: 10 }}>
              {status.coachActive && <span className="pill ok">Active</span>}
              {status.coachEnd && !status.coachActive && <span className="pill bad">Expired</span>}
              {!status.coachEnd && <span className="pill" style={{ background:'#fff', color:'#555', borderColor:'#ddd' }}>None</span>}
            </div>
            <div className="label">Valid until</div>
            <div className="value">{fmtDate(status.coachEnd)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
