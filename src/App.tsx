import { useEffect, useState } from 'react';
import Home from './pages/Home';
import CalendarPage from './pages/Calendar';
import TimePage from './pages/Time';
import Reports from './pages/Reports';
import Snippets from './pages/Snippets';
import Trips from './pages/Trips';
import SettingsPage from './pages/Settings';

const ROUTES = [
  { id: 'home', label: 'Heute', icon: '⌂', C: Home },
  { id: 'kalender', label: 'Kalender', icon: '▦', C: CalendarPage },
  { id: 'zeit', label: 'Zeit', icon: '◷', C: TimePage },
  { id: 'berichte', label: 'Berichte', icon: '▤', C: Reports },
  { id: 'texte', label: 'FSM-Texte', icon: '❝', C: Snippets },
  { id: 'reisen', label: 'Reisen', icon: '✈', C: Trips },
  { id: 'einstellungen', label: 'Einstellungen', icon: '⚙', C: SettingsPage },
] as const;

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
      <nav className="nav" aria-label="Hauptnavigation">
        <div className="brand">TechDesk</div>
        {ROUTES.map((r) => (
          <a key={r.id} href={`#/${r.id}`} className={r.id === R.id ? 'active' : ''} aria-current={r.id === R.id ? 'page' : undefined}>
            <span className="ico" aria-hidden>{r.icon}</span><span className="lbl">{r.label}</span>
          </a>
        ))}
      </nav>
      <main className="main"><R.C key={location.hash} /></main>
    </div>
  );
}
