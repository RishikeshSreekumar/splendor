'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  ChevronsUpDown,
  Code2,
  FlaskConical,
  Gem,
  Moon,
  Network,
  Shapes,
  Sun,
  Trophy,
  UserRound,
} from 'lucide-react';
import { browserAuth } from '@/src/client-auth';
const links = [
  ['/play', 'Practice table', Shapes],
  ['/', 'Evaluation arena', FlaskConical],
  ['/bots', 'Bot workshop', Code2],
  ['/ladder', 'Leaderboard', Trophy],
] as const;
/** Pages reached from the profile menu rather than the main navigation. */
const secondary = [
  ['/account', 'Account'],
  ['/design', 'System design'],
] as const;
const RULES_URL =
  'https://cdn.svc.asmodee.net/production-spacecowboys/uploads/2025/10/SCSPL01EN_SPLENDOR_RULES_LIGHT.pdf';
const THEME_KEY = 'splendor-theme';
type Theme = 'light' | 'dark';
/** Light by default; a saved choice is applied before paint by the script in the root layout. */
function useTheme() {
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => {
    // Read once after hydration: the server always renders the light default.
    const saved: Theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    void Promise.resolve(saved).then((t) => setTheme(t));
  }, []);
  const choose = (next: Theme) => {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* the choice lasts for this page only */
    }
  };
  return [theme, choose] as const;
}
/** Who is signed in: an email, nobody yet, or a local lab without accounts. */
function useIdentity() {
  const [who, setWho] = useState<{ email: string; cloud: boolean }>({ email: '', cloud: false });
  useEffect(() => {
    let unsubscribe = () => {};
    browserAuth()
      .then(async (c) => {
        if (!c) return;
        setWho({ email: (await c.auth.getUser()).data.user?.email ?? '', cloud: true });
        unsubscribe = c.auth.onAuthStateChange((_e, s) =>
          setWho({ email: s?.user.email ?? '', cloud: true }),
        ).data.subscription.unsubscribe;
      })
      .catch(() => {});
    return () => unsubscribe();
  }, []);
  return who;
}
function ProfileMenu({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const who = useIdentity();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  // Navigating closes the menu (adjusting state during render, keyed on the path).
  const [lastPath, setLastPath] = useState(path);
  if (lastPath !== path) {
    setLastPath(path);
    setOpen(false);
  }
  const name = who.email || (who.cloud ? 'Not signed in' : 'Guest');
  const detail = who.email ? 'Signed in' : who.cloud ? 'Sign in to submit bots' : 'Local lab';
  return (
    <div className={`profile ${open ? 'open' : ''}`} ref={root}>
      {open && (
        <div className="profile-menu" role="menu" aria-label="Profile and settings">
          <div className="profile-menu-head">
            <strong>{name}</strong>
            <span>{detail}</span>
          </div>
          {secondary.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              role="menuitem"
              className={`profile-item ${path.startsWith(href) ? 'active' : ''}`}
            >
              {href === '/account' ? <UserRound size={16} /> : <Network size={16} />}
              {href === '/account' && !who.email && who.cloud ? 'Sign in' : label}
            </Link>
          ))}
          <a className="profile-item" href={RULES_URL} target="_blank" rel="noreferrer">
            <BookOpen size={16} /> Official game rules <ArrowUpRight size={14} />
          </a>
          <div className="profile-theme">
            <span>Appearance</span>
            <div className="theme-switch" role="radiogroup" aria-label="Appearance">
              {(
                [
                  ['light', 'Light', Sun],
                  ['dark', 'Dark', Moon],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  role="radio"
                  aria-checked={theme === value}
                  className={theme === value ? 'current' : ''}
                  onClick={() => setTheme(value)}
                >
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <button
        className="profile-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title="Profile and settings"
      >
        <span className="profile-avatar" aria-hidden="true">
          {who.email ? who.email[0].toUpperCase() : <UserRound size={16} />}
        </span>
        <span className="profile-text nav-text">
          <strong>{name}</strong>
          <span>{detail}</span>
        </span>
        <ChevronsUpDown size={15} className="profile-chevron nav-text" />
      </button>
    </div>
  );
}
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const isActive = (href: string) =>
    href === '/' ? path === '/' || path.startsWith('/evaluations') : path.startsWith(href);
  const section =
    links.find(([href]) => isActive(href))?.[1] ??
    secondary.find(([href]) => path.startsWith(href))?.[1] ??
    'Splendor Lab';
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand" title="Splendor Lab">
          <span className="brand-icon">
            <Gem size={24} />
          </span>
          <span className="brand-text">
            SPLENDOR<span className="brand-sub">STRATEGY LAB</span>
          </span>
        </Link>
        <nav aria-label="Main navigation">
          {links.map(([href, label, Icon]) => (
            <Link
              key={href}
              href={href}
              title={label}
              className={isActive(href) ? 'nav-link active' : 'nav-link'}
              aria-current={isActive(href) ? 'page' : undefined}
            >
              <Icon size={18} />
              <span className="nav-text">{label}</span>
            </Link>
          ))}
        </nav>
        <ProfileMenu path={path} />
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="topbar-crumb">
            Splendor Lab <span className="topbar-dot">/</span> <strong>{section}</strong>
          </span>
          <span className="status-pill">
            <i /> Vanilla rules
          </span>
        </header>
        <main>{children}</main>
        <footer>
          Built for curious players and thoughtful algorithms.<span>Splendor Lab / 0.2</span>
        </footer>
      </div>
    </div>
  );
}
