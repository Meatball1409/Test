import { useEffect, useRef, useState } from 'react';
import { Logo } from './brand';
import { BLOCKED_MSG, migrateDefaults, storageSelfTest } from './db';
import { Icon, type IconName } from './icons';
import { FsmAutoSync, FsmDemoBanner } from './pages/FsmParts';
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
  // Ganzen Hash merken: auch ein Wechsel innerhalb eines Bereichs (z. B. #/berichte → #/berichte/neu) muss neu darstellen
  const [hash, setHash] = useState(location.hash);
  const route = current();
  useEffect(() => {
    const h = () => { setHash(location.hash); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  const [storageError, setStorageError] = useState<string | null>(null);
  useEffect(() => {
    void storageSelfTest().then((r) => { setStorageError(r); if (!r) void migrateDefaults().catch(() => {}); });
    const h = () => setStorageError(BLOCKED_MSG);
    window.addEventListener('techdesk-storage', h);
    // sobald der andere Tab losgelassen hat, verschwindet der Hinweis von selbst
    const t = window.setInterval(() => { if (storageErrorRef.current) void storageSelfTest().then((r) => setStorageError(r)); }, 4000);
    return () => { window.removeEventListener('techdesk-storage', h); window.clearInterval(t); };
  }, []);
  const storageErrorRef = useRef<string | null>(null);
  storageErrorRef.current = storageError;
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
      <main className="main">
        <FsmDemoBanner />
        <FsmAutoSync />
        {storageError && (storageError === BLOCKED_MSG ? (
          <div className="result bad" role="alert" style={{ marginBottom: '1rem' }}>
            <b>Speichern gerade nicht möglich – TechDesk ist noch in einem anderen Tab offen.</b><br />
            Die App wurde aktualisiert und muss ihren Speicher einmal umstellen. Bitte <b>alle anderen TechDesk-Tabs in Safari schließen</b> (Tab-Übersicht → ✕) und die installierte App, falls offen, nach oben wegwischen. Danach geht es hier automatisch weiter.
            <div style={{ marginTop: '.5rem' }}><button className="btn small" onClick={() => location.reload()}>Neu laden</button></div>
          </div>
        ) : (
          <div className="result bad" role="alert" style={{ marginBottom: '1rem' }}>
            <b>Speichern auf diesem Gerät nicht möglich.</b> Mögliche Ursachen: privater Modus in Safari, Speicher voll oder „Alle Cookies blockieren“ (Einstellungen → Safari). Fehler: {storageError}
            <div style={{ marginTop: '.5rem' }}><button className="btn small" onClick={() => location.reload()}>App neu laden</button></div>
          </div>
        ))}
        <R.C key={hash} />
      </main>
    </div>
  );
}
