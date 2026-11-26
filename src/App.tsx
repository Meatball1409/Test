import { useEffect, useState } from 'react';
import { Logo } from './brand';
import { Icon, type IconName } from './icons';
import Home from './pages/Home';
import CalendarPage from './pages/Calendar';
import TimePage from './pages/Time';
import Reports from './pages/Reports';
import Snippets from './pages/Snippets';
import Trips from './pages/Trips';
import Visa from './pages/Visa';
import SettingsPage from './pages/Settings';

const ROUTES = [
  { id: 'home', label: 'Heute', icon: 'home', C: Home },
  { id: 'kalender', label: 'Kalender', icon: 'calendar', C: CalendarPage },
  { id: 'zeit', label: 'Zeit', icon: 'clock', C: TimePage },
  { id: 'berichte', label: 'Berichte', icon: 'report', C: Reports },
  { id: 'texte', label: 'FSM-Texte', icon: 'text', C: Snippets },
  { id: 'reisen', label: 'Reisen', icon: 'plane', C: Trips },
  { id: 'visa', label: 'Visa', icon: 'globe', C: Visa },
  { id: 'einstellungen', label: 'Einstellungen', icon: 'settings', C: SettingsPage },
] as const satisfies readonly { id: string; label: string; icon: IconName; C: () => JSX.Element }[];

export type RouteId = (typeof ROUTES)[number]['id'];
const current = () => (location.hash.replace('#/', '').split('/')[0] || 'home') as RouteId;
export const navigate = (id: RouteId, sub = '') => { location.hash = `#/${id}${sub ? '/' + sub : ''}`; };
export const routeParam = () => location.hash.replace('#/', '').split('/')[1] ?? '';

export default function App() {
  const [route, setRoute] = useState<RouteId>(current);
  useEffect(() => {
    const h = () => { setRoute(current()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  const R = ROUTES.find((r) => r.id === route) ?? ROUTES[0];
  return (
    <div className="shell">
      <header className="topbar">
        <a href="#/home" className="topbar-brand" aria-label="Startseite"><Logo height={22} /></a>
        <div className="topbar-actions">
          <span className="app-tag">TechDesk</span>
          <a href="#/einstellungen" aria-label="Einstellungen"><Icon name="settings" size={22} /></a>
        </div>
      </header>
      <nav className="nav" aria-label="Hauptnavigation">
        <a href="#/home" className="brand" aria-label="Startseite">
          <Logo height={26} />
          <span className="app-tag">TechDesk · Service</span>
        </a>
        {ROUTES.map((r) => (
          <a key={r.id} href={`#/${r.id}`} className={'nav-item' + (r.id === R.id ? ' active' : '') + (r.id === 'einstellungen' ? ' last' : '')} aria-current={r.id === R.id ? 'page' : undefined}>
            <span className="ico"><Icon name={r.icon} size={21} /></span><span className="lbl">{r.label}</span>
          </a>
        ))}
      </nav>
      <main className="main"><R.C key={location.hash} /></main>
    </div>
  );
}
