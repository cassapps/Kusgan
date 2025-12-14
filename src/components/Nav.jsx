import { NavLink } from "react-router-dom";
import React from "react";

export default function Nav({ collapsed = false, isAdmin = false }) {

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <nav className="nav">
        <NavLink to="/" end>
          <span className="nav-icon" aria-hidden="true">🏠</span>
          <span className="nav-label">Dashboard</span>
        </NavLink>
        <NavLink to="/attendance">
          <span className="nav-icon" aria-hidden="true">🕒</span>
          <span className="nav-label">Staff Attendance</span>
        </NavLink>
        <NavLink to="/members">
          <span className="nav-icon" aria-hidden="true">💪</span>
          <span className="nav-label">All Members</span>
        </NavLink>
        <NavLink to="/checkin">
          <span className="nav-icon" aria-hidden="true">🎟️</span>
          <span className="nav-label">Member Check-In</span>
        </NavLink>
        <NavLink to="/reports">
          <span className="nav-icon" aria-hidden="true">📊</span>
          <span className="nav-label">Reports</span>
        </NavLink>
        {isAdmin && (
          <NavLink to="/admin">
            <span className="nav-icon" aria-hidden="true">🔧</span>
            <span className="nav-label">Admin</span>
          </NavLink>
        )}
      </nav>
    </aside>
  );
}
