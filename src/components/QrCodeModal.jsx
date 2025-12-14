import React, { useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { normalizeNickname } from '../lib/nickname.js';

// Lightweight QR Code Modal — portrait front + back stacked.
// Shows when `open` is true. Props mirror previous usage in MemberDetail.jsx.
// Render custom overlay for QR modal to avoid the default ModalWrapper
// which imposes inner scrolling. We want the QR preview to be fully visible
// and not scroll inside the modal container.

export default function QrCodeModal({ open, onClose, memberId = "", nickname = "", firstName = "", lastName = "" }) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose && onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const label = normalizeNickname(nickname) || nickname || firstName || lastName || "Member";
  const value = String(memberId || label || "");

  // Custom overlay: full-viewport fixed overlay with centered content. The
  // inner container uses `overflow: visible` and no `maxHeight` so it does not
  // produce internal scroll bars. Clicking the overlay or the close button
  // will call onClose.
  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose && onClose(); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
      <div style={{ width: 'min(98vw, 820px)', boxSizing: 'border-box', padding: 20, background: '#fff', borderRadius: 14, border: '1px solid var(--light-border)', boxShadow: '0 20px 60px rgba(0,0,0,.2)', overflow: 'visible' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 18 }}></div>
          <button type="button" className="button" onClick={onClose} style={{ background: '#eee', color: '#333' }}>✕</button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: 520, maxWidth: '78vw', aspectRatio: '1 / 1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: '100%', height: '100%', borderRadius: 10, border: '6px solid var(--kusgan-magenta, #c51c8a)', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', background: '#fff' }}>
              <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', fontSize: 16, color: 'var(--kusgan-magenta, #c51c8a)', fontWeight: 700 }}>kusgan</div>

              <div style={{ width: '72%', height: '72%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <QRCodeSVG value={value} size={Math.min(700, Math.floor(window.innerWidth * 0.7))} />
              </div>

              <div style={{ position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', fontSize: 16, color: '#333', fontWeight: 600 }}>{label}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

