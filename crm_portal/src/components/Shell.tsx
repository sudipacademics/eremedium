import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  actionNavAllowed,
  buildWaNavItems,
  categoryAllowed,
  channelAllowed,
  defaultWaPath,
  readCrmPortalAccess,
} from '../crmAccess';
import { modulePath, moduleWingsForDomain, type CrmDomain } from '../crmModules';
import { initials } from '../data';
import { Icon, type IconName } from '../icons';
import { clearCrmLocalData, readCrmSession, writeCrmSession } from '../security';
import { useCrm } from '../store';
import { AddLeadModal, BookingModal, StartFranchiseModal } from './Forms';
import { formatWaBadgeCount, useWaUnreadCounts } from '../whatsappUnread';

declare global {
  interface Window {
    __crmUserImage?: string;
    crmGate?: {
      signOut?: () => void;
      openHrWorkspace?: () => void;
      closeHrWorkspace?: () => void;
      getUserImage?: () => string;
    };
  }
}

function readSessionPhoto() {
  try {
    if (typeof window.crmGate?.getUserImage === 'function') {
      const fromGate = String(window.crmGate.getUserImage() || '').trim();
      if (fromGate) return fromGate;
    }
    const bridge = String(window.__crmUserImage || '').trim();
    if (bridge) return bridge;
    const s = readCrmSession();
    return String(s?.user_image || '').trim();
  } catch {
    return '';
  }
}

type NavItem = { to: string; label: string; icon: IconName; end?: boolean };

type NavGroup = {
  id: string;
  label: string;
  icon: IconName;
  kind: 'lead' | 'followup';
  domain: CrmDomain;
};

const LEAD_GROUPS: NavGroup[] = [
  { id: 'service-lead', label: 'Service Lead', icon: 'leads', kind: 'lead', domain: 'service' },
  { id: 'franchise-lead', label: 'Franchise Lead', icon: 'franchise', kind: 'lead', domain: 'franchise' },
];

const FOLLOWUP_GROUPS: NavGroup[] = [
  { id: 'service-fu', label: 'Service Followup', icon: 'activities', kind: 'followup', domain: 'service' },
  { id: 'franchise-fu', label: 'Franchise Followup', icon: 'activities', kind: 'followup', domain: 'franchise' },
];

const MID_NAV: NavItem[] = [
  { to: '/contacts', label: 'Contacts', icon: 'contacts' },
  { to: '/accounts', label: 'Accounts / Organizations', icon: 'accounts' },
  { to: '/deals', label: 'Deals & Opportunities', icon: 'deals' },
];

const ACTION_NAV: NavItem[] = [
  { to: '/bookings', label: 'Bookings', icon: 'bookings' },
  { to: '/franchise', label: 'Franchise (FFMS/RFMS)', icon: 'franchise' },
  { to: '/partner-bookings', label: 'Partner Unit Bookings', icon: 'partner' },
];

const MORE_NAV: NavItem[] = [
  { to: '/campaigns', label: 'Campaigns', icon: 'campaigns' },
  { to: '/reports', label: 'Reports & Analytics', icon: 'reports' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

function pageTitle(pathname: string) {
  if (pathname.startsWith('/leads/service')) return 'Service Lead';
  if (pathname.startsWith('/leads/franchise')) return 'Franchise Lead';
  if (pathname.startsWith('/activities/service')) return 'Service Followup';
  if (pathname.startsWith('/activities/franchise')) return 'Franchise Followup';
  if (pathname.startsWith('/whatsapp')) {
    const parts = pathname.split('/').filter(Boolean);
    const channel = parts[1];
    const wing = parts[2];
    if (channel === 'service') {
      return wing && wing !== 'all' ? `WhatsApp · Service · ${wing}` : 'WhatsApp · Service';
    }
    if (channel === 'franchise') {
      return wing && wing !== 'all' ? `WhatsApp · Franchise · ${wing}` : 'WhatsApp · Franchise';
    }
    return 'WhatsApp Centre';
  }
  const flat = [...MID_NAV, ...ACTION_NAV, ...MORE_NAV, { to: '/', label: 'CRM Dashboard', end: true as const }];
  const hit = flat.find((item) =>
    'end' in item && item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`),
  );
  return hit?.label ?? 'Smilecure CRM';
}

function groupMatchesPath(pathname: string, group: NavGroup) {
  const base = group.kind === 'lead' ? '/leads' : '/activities';
  return pathname.startsWith(`${base}/${group.domain}`);
}

function NavGroupBlock({
  group,
  open,
  routeActive,
  onToggle,
}: {
  group: NavGroup;
  open: boolean;
  routeActive: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`nav-group${open ? ' open' : ''}`}>
      <button
        type="button"
        className={`nav-group-toggle${routeActive ? ' active' : ''}`}
        aria-expanded={open}
        onClick={onToggle}
      >
        <Icon name={group.icon} size={17} />
        <span>{group.label}</span>
        <span className="nav-chevron" aria-hidden="true">
          <Icon name="chevron" size={14} />
        </span>
      </button>
      <div className={`nav-sub${open ? ' show' : ''}`} hidden={!open}>
        {moduleWingsForDomain(group.domain).map((sub) => (
          <NavLink
            key={sub.id}
            to={modulePath(group.kind, group.domain, sub.id)}
            className={({ isActive }) => `nav-link nav-sub-link${isActive ? ' active' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            {sub.label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}

export function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const crm = useCrm();
  const [portalAccess, setPortalAccess] = useState(readCrmPortalAccess);
  const leadGroups = LEAD_GROUPS.filter((g) => categoryAllowed(g.domain, portalAccess));
  const followupGroups = FOLLOWUP_GROUPS.filter((g) => categoryAllowed(g.domain, portalAccess));
  const waNav = useMemo(() => buildWaNavItems(portalAccess), [portalAccess]);
  const actionNav = ACTION_NAV.filter((item) => actionNavAllowed(item.to, portalAccess));
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState<'lead' | 'aesthetic' | 'care' | 'partner' | 'franchise' | null>(null);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [userPhoto, setUserPhoto] = useState(readSessionPhoto);
  const profileRef = useRef<HTMLDivElement>(null);
  const [waOpen, setWaOpen] = useState(() =>
    typeof window !== 'undefined' ? window.location.pathname.startsWith('/whatsapp') : false,
  );
  const waUnread = useWaUnreadCounts();
  const waTotalBadge = formatWaBadgeCount(waUnread.total);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const g of [...LEAD_GROUPS, ...FOLLOWUP_GROUPS]) {
      if (typeof window !== 'undefined' && groupMatchesPath(window.location.pathname, g)) {
        init[g.id] = true;
      }
    }
    return init;
  });

  useEffect(() => {
    const syncPhoto = () => {
      const next = readSessionPhoto();
      setUserPhoto((prev) => (prev === next ? prev : next));
    };
    syncPhoto();
    window.addEventListener('crm-session-updated', syncPhoto);
    window.addEventListener('storage', syncPhoto);
    const timer = window.setInterval(syncPhoto, 1000);
    return () => {
      window.removeEventListener('crm-session-updated', syncPhoto);
      window.removeEventListener('storage', syncPhoto);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const syncAccess = () => setPortalAccess(readCrmPortalAccess());
    syncAccess();
    window.addEventListener('crm-portal-access', syncAccess);
    const timer = window.setInterval(syncAccess, 1500);
    return () => {
      window.removeEventListener('crm-portal-access', syncAccess);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!location.pathname.startsWith('/whatsapp/')) return;
    const parts = location.pathname.split('/').filter(Boolean);
    /* Legacy /whatsapp/:wing → /whatsapp/:channel/:wing */
    if (parts.length === 2) {
      navigate(defaultWaPath(portalAccess), { replace: true });
      return;
    }
    const channel = parts[1] || 'all';
    if (channel !== 'all' && !channelAllowed(channel, portalAccess)) {
      navigate(defaultWaPath(portalAccess), { replace: true });
    }
  }, [location.pathname, portalAccess, navigate]);

  useEffect(() => {
    if (!profileOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!profileRef.current?.contains(e.target as Node)) setProfileOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setProfileOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [profileOpen]);

  useEffect(() => {
    document.title = `${pageTitle(location.pathname)} · Smilecure CRM`;
    setMenuOpen(false);
    setProfileOpen(false);
    /* Auto-expand the group that owns the current route; leave others as the user left them. */
    setOpenGroups((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const g of [...LEAD_GROUPS, ...FOLLOWUP_GROUPS]) {
        if (groupMatchesPath(location.pathname, g) && !next[g.id]) {
          next[g.id] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    if (location.pathname.startsWith('/whatsapp')) setWaOpen(true);
  }, [location.pathname]);

  const toggleGroup = (group: NavGroup) => {
    const peers = group.kind === 'lead' ? LEAD_GROUPS : FOLLOWUP_GROUPS;
    setOpenGroups((prev) => {
      const willOpen = !prev[group.id];
      const next: Record<string, boolean> = { ...prev };
      /* Accordion within Leads / within Follow-ups so only one parent is open. */
      for (const g of peers) next[g.id] = false;
      next[group.id] = willOpen;
      return next;
    });
    if (!openGroups[group.id]) {
      /* Opening a collapsed parent → land on its first submodule if not already inside it. */
      if (!groupMatchesPath(location.pathname, group)) {
        navigate(modulePath(group.kind, group.domain, 'aesthetic'));
      }
    }
  };

  const hits = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return [
      ...crm.leads.map((l) => {
        const domain = l.wing === 'franchise' ? 'franchise' : 'service';
        const wing =
          l.wing === 'franchise'
            ? l.franchiseVertical || 'lab'
            : l.wing === 'nexilab'
              ? 'lab'
              : l.wing === 'aesthetic' || l.wing === 'care' || l.wing === 'lab'
                ? l.wing
                : 'aesthetic';
        return {
          label: l.name,
          hint: `${l.id} · ${l.wing}`,
          to: modulePath('lead', domain, wing),
        };
      }),
      ...crm.bookings.map((b) => ({ label: b.patient, hint: `${b.id} · ${b.service}`, to: '/bookings' })),
      ...crm.deals.map((d) => ({ label: d.title, hint: d.id, to: '/deals' })),
    ]
      .filter((h) => `${h.label} ${h.hint}`.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [crm.leads, crm.bookings, crm.deals, query]);

  return (
    <div className="app">
      {menuOpen ? <button type="button" className="backdrop" aria-label="Close menu" onClick={() => setMenuOpen(false)} /> : null}
      <aside className={`sidebar${menuOpen ? ' open' : ''}`}>
        <a className="brand" href="/" aria-label="Smilecure CRM">
          <span className="brand-light">
            <img src="/smilecure-logo.png?v=3" alt="Smilecure Lifestyle Private Limited" />
          </span>
        </a>
        <nav className="nav-scroll">
          <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <Icon name="dashboard" size={17} />
            CRM Dashboard
          </NavLink>

          {leadGroups.length ? <div className="nav-label">Leads</div> : null}
          {leadGroups.map((g) => (
            <NavGroupBlock
              key={g.id}
              group={g}
              open={Boolean(openGroups[g.id])}
              routeActive={groupMatchesPath(location.pathname, g)}
              onToggle={() => toggleGroup(g)}
            />
          ))}

          {MID_NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <Icon name={item.icon} size={17} />
              {item.label}
            </NavLink>
          ))}

          {followupGroups.length ? <div className="nav-label">Follow-ups</div> : null}
          {followupGroups.map((g) => (
            <NavGroupBlock
              key={g.id}
              group={g}
              open={Boolean(openGroups[g.id])}
              routeActive={groupMatchesPath(location.pathname, g)}
              onToggle={() => toggleGroup(g)}
            />
          ))}

          {waNav.length ? (
            <>
              <div className="nav-label">WhatsApp</div>
              <div className={`nav-group${waOpen ? ' open' : ''}`}>
                <button
                  type="button"
                  className={`nav-group-toggle${location.pathname.startsWith('/whatsapp') ? ' active' : ''}`}
                  aria-expanded={waOpen}
                  onClick={() => {
                    const willOpen = !waOpen;
                    setWaOpen(willOpen);
                    if (willOpen && !location.pathname.startsWith('/whatsapp')) {
                      navigate(defaultWaPath(portalAccess));
                    }
                  }}
                >
                  <Icon name="whatsapp" size={17} />
                  <span>
                    WhatsApp Centre
                    {waTotalBadge ? (
                      <em className="nav-wa-badge" aria-label={`${waUnread.total} unread chats`}>
                        {waTotalBadge}
                      </em>
                    ) : null}
                  </span>
                  <span className="nav-chevron" aria-hidden="true">
                    <Icon name="chevron" size={14} />
                  </span>
                </button>
                <div className={`nav-sub${waOpen ? ' show' : ''}`} hidden={!waOpen}>
                  {waNav.map((sub) => {
                    const n = waUnread.countFor(sub.wing, sub.channel);
                    const badge = formatWaBadgeCount(n);
                    return (
                      <NavLink
                        key={sub.key}
                        to={sub.to}
                        className={({ isActive }) => `nav-link nav-sub-link${isActive ? ' active' : ''}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="nav-wa-sub-label">
                          {sub.label}
                          {badge ? (
                            <em className="nav-wa-badge" aria-label={`${n} unread in ${sub.label}`}>
                              {badge}
                            </em>
                          ) : null}
                        </span>
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            </>
          ) : null}

          <div className="nav-label">Telecaller actions</div>
          {actionNav.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <Icon name={item.icon} size={17} />
              {item.label}
            </NavLink>
          ))}
          <div className="nav-label">More</div>
          {MORE_NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <Icon name={item.icon} size={17} />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" aria-label="Menu" onClick={() => setMenuOpen(true)}>
            <Icon name="menu" />
          </button>
          <div className="top-title">
            <h1>
              Smilecure CRM <span className="badge-pill">CRM Portal</span>
            </h1>
            <p>Lead · Opportunity · Sales · Customer Relationship for All Business Wings.</p>
          </div>
          <div className="search">
            <Icon name="search" size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search leads, contacts, deals…"
              aria-label="Global search"
            />
          </div>
          <div className="top-actions">
            <button type="button" className="btn btn-primary" onClick={() => setModal('lead')}>
              <Icon name="plus" size={16} /> Add Lead
            </button>
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="icon-btn"
                aria-label="Notifications"
                aria-expanded={noticesOpen}
                onClick={() => {
                  setNoticesOpen((o) => !o);
                  if (!noticesOpen) crm.refreshTransferNotices().catch(() => undefined);
                }}
              >
                <Icon name="bell" />
                {crm.transferNoticeUnread > 0 ? <span className="ping" /> : null}
              </button>
              {noticesOpen ? (
                <div
                  className="card"
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: 'calc(100% + 8px)',
                    width: 340,
                    maxHeight: 380,
                    overflow: 'auto',
                    zIndex: 40,
                    padding: 12,
                    boxShadow: '0 12px 40px rgba(15,23,42,0.18)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <strong style={{ fontSize: '0.9rem' }}>Transfer notices</strong>
                    <button type="button" className="btn btn-ghost" style={{ padding: '2px 8px' }} onClick={() => setNoticesOpen(false)}>
                      Close
                    </button>
                  </div>
                  {crm.transferNotices.length === 0 ? (
                    <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>No transfer notifications.</p>
                  ) : (
                    crm.transferNotices.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        className="btn btn-ghost"
                        style={{
                          width: '100%',
                          justifyContent: 'flex-start',
                          flexDirection: 'column',
                          alignItems: 'stretch',
                          textAlign: 'left',
                          marginBottom: 6,
                          opacity: n.read ? 0.7 : 1,
                          border: '1px solid var(--line)',
                        }}
                        onClick={() => {
                          if (!n.read) crm.markTransferNoticeRead(n.id).catch(() => undefined);
                          if (n.lead_id) {
                            setNoticesOpen(false);
                            navigate('/leads/service/aesthetic');
                          }
                        }}
                      >
                        <strong style={{ fontSize: '0.85rem' }}>{n.title}</strong>
                        <span style={{ color: 'var(--muted)', fontSize: '0.78rem', whiteSpace: 'normal' }}>{n.body}</span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
            <div className="user-menu" ref={profileRef}>
              <button
                type="button"
                className={`user user-trigger${profileOpen ? ' open' : ''}`}
                aria-haspopup="menu"
                aria-expanded={profileOpen}
                onClick={() => {
                  setNoticesOpen(false);
                  setProfileOpen((o) => !o);
                }}
              >
                <span className={`avatar${userPhoto ? ' has-photo' : ''}`}>
                  {userPhoto ? (
                    <img
                      src={userPhoto}
                      alt=""
                      onError={() => {
                        setUserPhoto('');
                        try {
                          window.__crmUserImage = '';
                          const s = readCrmSession();
                          if (s) writeCrmSession({ ...s, user_image: '' });
                        } catch {
                          /* ignore */
                        }
                      }}
                    />
                  ) : (
                    initials(crm.userName)
                  )}
                </span>
                <span>
                  <strong>{crm.userName}</strong>
                  <small>{crm.userRoleLabel}</small>
                </span>
                <Icon name="chevron" size={14} />
              </button>
              {profileOpen ? (
                <div className="user-menu-pop" role="menu">
                  <div className="user-menu-meta">
                    <strong>{crm.userName}</strong>
                    <span>{crm.userRoleLabel}</span>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    className="user-menu-item"
                    onClick={() => {
                      setProfileOpen(false);
                      if (typeof window.crmGate?.openHrWorkspace === 'function') {
                        window.crmGate.openHrWorkspace();
                      } else {
                        window.location.hash = 'my-hr-workspace';
                      }
                    }}
                  >
                    My Profile
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="user-menu-item"
                    onClick={() => {
                      setProfileOpen(false);
                      if (typeof window.crmGate?.signOut === 'function') {
                        window.crmGate.signOut();
                      } else {
                        clearCrmLocalData();
                        window.location.reload();
                      }
                    }}
                  >
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {hits.length > 0 ? (
          <div className="content" style={{ paddingBottom: 0 }}>
            <div className="card" style={{ marginBottom: 0 }}>
              {hits.map((hit) => (
                <button
                  key={hit.label + hit.hint}
                  type="button"
                  className="btn btn-ghost"
                  style={{ width: '100%', justifyContent: 'flex-start', marginBottom: 4 }}
                  onClick={() => {
                    setQuery('');
                    navigate(hit.to);
                  }}
                >
                  <strong>{hit.label}</strong>
                  <span style={{ color: 'var(--muted)', marginLeft: 8 }}>{hit.hint}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="content">
          <Outlet context={{ openModal: setModal }} />
        </div>
      </div>

      <div className="toast-stack">
        {crm.toasts.map((t) => (
          <div key={t.id} className={`toast${t.tone === 'err' ? ' err' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>

      {modal === 'lead' ? <AddLeadModal onClose={() => setModal(null)} /> : null}
      {modal === 'aesthetic' || modal === 'care' || modal === 'partner' ? (
        <BookingModal mode={modal} onClose={() => setModal(null)} />
      ) : null}
      {modal === 'franchise' ? <StartFranchiseModal onClose={() => setModal(null)} /> : null}
    </div>
  );
}
