import React from 'react';

export default function RefreshBadge({ show = true }) {
  if (!show) return null;
  return (
    <span className="refresh-badge" role="status" aria-live="polite">
      <span className="refresh-spinner" aria-hidden />
    </span>
  );
}
