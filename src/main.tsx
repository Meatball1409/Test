import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { AuthGate } from './auth';
import { ToastProvider, toastGlobal } from './components';
import { db } from './db';
import './styles.css';

// Updates aktiv suchen – iPhones prüfen installierte Web-Apps sonst nur selten
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return;
    const check = () => { if (navigator.onLine) void reg.update().catch(() => {}); };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    window.setInterval(check, 30 * 60_000);
  },
});

// Speicherfehler nicht verschlucken: anzeigen und Verbindung zur Datenbank neu aufbauen.
// (Bekanntes iPhone-Problem: nach dem Zurückkehren in die App ist die Verbindung manchmal getrennt.)
window.addEventListener('unhandledrejection', (ev) => {
  const err = ev.reason as { name?: string; message?: string } | undefined;
  const msg = `${err?.name ?? 'Fehler'}: ${err?.message ?? String(ev.reason)}`;
  const storage = /Database|IndexedDB|UnknownError|InvalidState|VersionError|QuotaExceeded|DataClone/i.test(msg);
  if (storage) {
    db.close();
    void db.open().catch(() => {});
    toastGlobal(/Quota/i.test(msg) ? 'Speicher voll – bitte Platz auf dem Gerät freigeben.' : 'Speichern fehlgeschlagen. Verbindung wurde neu aufgebaut – bitte nochmal speichern. (' + msg.slice(0, 120) + ')');
  } else {
    toastGlobal('Fehler: ' + msg.slice(0, 160));
  }
});
navigator.storage?.persist?.(); // Browser bitten, die Daten nicht automatisch zu löschen

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider><AuthGate><App /></AuthGate></ToastProvider>
  </StrictMode>,
);
