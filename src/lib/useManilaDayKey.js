import { useEffect, useRef, useState } from 'react';

const MANILA_TZ = 'Asia/Manila';

function manilaTodayYMD() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MANILA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function ymdNext(ymd) {
  try {
    const [yy, mm, dd] = String(ymd || '').split('-').map((n) => Number(n));
    if (!yy || !mm || !dd) return '';
    const d = new Date(`${String(ymd)}T00:00:00+08:00`);
    if (isNaN(d)) return '';
    d.setUTCDate(d.getUTCDate() + 1);
    return new Intl.DateTimeFormat('en-CA', { timeZone: MANILA_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return '';
  }
}

// React hook that changes value when the Manila calendar day rolls over.
export default function useManilaDayKey() {
  const [key, setKey] = useState(() => manilaTodayYMD());
  const timerRef = useRef(null);

  useEffect(() => {
    const schedule = () => {
      try {
        const cur = manilaTodayYMD();
        const next = ymdNext(cur);
        if (!next) return;
        // Fire at Manila midnight (+ a tiny buffer) regardless of user's local timezone.
        const nextMidnight = new Date(`${next}T00:00:02+08:00`).getTime();
        const now = Date.now();
        const ms = Math.max(1000, nextMidnight - now);
        timerRef.current = setTimeout(() => {
          setKey(manilaTodayYMD());
        }, ms);
      } catch {
        // ignore
      }
    };

    schedule();
    return () => {
      try {
        if (timerRef.current) clearTimeout(timerRef.current);
      } catch {
        // ignore
      }
      timerRef.current = null;
    };
  }, [key]);

  return key;
}
