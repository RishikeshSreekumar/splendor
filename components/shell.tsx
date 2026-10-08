'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Gem, FlaskConical, Code2, Shapes, Network, ArrowUpRight, Trophy } from 'lucide-react';
const links = [
  ['/', 'Evaluation arena', FlaskConical],
  ['/play', 'Practice table', Shapes],
  ['/bots', 'Bot workshop', Code2],
  ['/ladder', 'Leaderboard', Trophy],
  ['/design', 'System design', Network],
  ['/account', 'Account', Gem],
] as const;
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const isActive = (href: string) =>
    href === '/' ? path === '/' || path.startsWith('/evaluations') : path.startsWith(href);
  const section = links.find(([href]) => isActive(href))?.[1] ?? 'Splendor Lab';
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-icon">
            <Gem size={25} />
          </span>
          <span className="brand-text">
            SPLENDOR<span className="brand-sub">STRATEGY LAB</span>
          </span>
        </Link>
        <div className="sidebar-label">YOUR WORKSPACE</div>
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
        <div className="sidebar-note">
          <span className="tiny-label">THE ORIGINAL GAME</span>
          <p>
            Five gems.
            <br />
            Endless possibilities.
          </p>
          <span>Vanilla Splendor · 2–4 players</span>
        </div>
        <a
          className="sidebar-bottom"
          href="https://cdn.svc.asmodee.net/production-spacecowboys/uploads/2025/10/SCSPL01EN_SPLENDOR_RULES_LIGHT.pdf"
          target="_blank"
          rel="noreferrer"
        >
          <span className="nav-text">Official game rules</span> <ArrowUpRight size={15} />
        </a>
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
