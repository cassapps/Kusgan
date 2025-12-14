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
        <button type="button" className="button topbar-logout" onClick={() => onLogout?.()}>
          Logout
        </button>
      </div>
    </header>
  );
}
