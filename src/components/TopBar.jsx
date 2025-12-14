import { useEffect, useState } from 'react';

const MANILA_TZ = 'Asia/Manila';

function manilaTopbarDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MANILA_TZ,
    weekday: 'long',
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  }).formatToParts(new Date());
  const weekday = (parts.find(p => p.type === 'weekday')?.value || '').toUpperCase();
  const mon = parts.find(p => p.type === 'month')?.value || 'Jan';
  const day = String(parseInt(parts.find(p => p.type === 'day')?.value || '01', 10));
  const yr = parts.find(p => p.type === 'year')?.value || '0000';
  return `${mon}-${day}, ${yr}, ${weekday}`;
}

export default function TopBar({ collapsed = false, onToggleSidebar, onLogout, roleLabel = '' }) {
  const [dateText, setDateText] = useState(manilaTopbarDate());

  useEffect(() => {
    const tick = () => setDateText(manilaTopbarDate());
    const id = setInterval(tick, 60_000);
    tick();
    return () => clearInterval(id);
  }, []);

  const logoSrc = `${import.meta.env.BASE_URL}kusgan-logo.png`;

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          type="button"
          className="topbar-icon-btn"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => onToggleSidebar?.()}
        >
          ☰
        </button>
        <img src={logoSrc} alt="Kusgan logo" className="topbar-logo" />
        <div className="topbar-title">KUSGAN FITNESS GYM</div>
      </div>

      <div className="topbar-center">{dateText}</div>

      <div className="topbar-right">
        {!!roleLabel && <div className="topbar-role">{roleLabel}</div>}
        <button type="button" className="topbar-logout-icon" aria-label="Logout" onClick={() => onLogout?.()}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M10 17a1 1 0 0 1 0-2h6V9h-6a1 1 0 0 1 0-2h7a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-7Zm-1.707-3.293a1 1 0 0 1 0-1.414L9.586 11H4a1 1 0 1 1 0-2h5.586L8.293 7.707a1 1 0 1 1 1.414-1.414l3 3a1 1 0 0 1 0 1.414l-3 3a1 1 0 0 1-1.414 0Z" />
          </svg>
        </button>
      </div>
    </header>
  );
}
