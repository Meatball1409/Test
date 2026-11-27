import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useToast } from '../components';
import { db, getMeta, saveSettings, useSettings } from '../db';
import { CONCUR_GATEWAY, removeConcurData, sendTrip, syncConcur, type ConcurSyncResult } from '../concurSync';
import { ConcurLoginError, editable, planTripPush } from '../lib/concur';
import type { Trip } from '../lib/types';

function useConcurAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState<string | null>(null);
  async function run<T>(fn: () => Promise<T>, msg: (r: T) => string) {
    setBusy(true);
    try { toast(msg(await fn())); setLogin(null); } catch (e) {
      if (e instanceof ConcurLoginError) setLogin(e.loginUrl);
      toast((e as Error).message);
    }
    setBusy(false);
  }
  return { busy, login, run };
}
const LoginLink = ({ url }: { url: string | null }) => (url ? <a className="btn" href={url} target="_blank" rel="noreferrer">Firmen-Login öffnen ↗</a> : null);

export const concurMessage = (r: ConcurSyncResult) =>
  `Concur: ${r.sent ? `↑ ${r.sent} gesendet · ` : ''}↓ ${r.reports} Abrechnungen, ${r.trips} gebuchte Reisen${r.failed.length ? ` · ${r.failed.length} nicht gesendet (${r.failed[0]})` : ''}`;

export function ConcurSyncButton({ className = 'btn', label = 'Concur abgleichen' }: { className?: string; label?: string }) {
  const s = useSettings();
  const a = useConcurAction();
  if (s.concurMode === 'aus') return null;
  return <><button className={className} disabled={a.busy} onClick={() => a.run(() => syncConcur(s), concurMessage)}>{a.busy ? 'Abgleich läuft …' : <>⇅ {label}</>}</button><LoginLink url={a.login} /></>;
}

const STATUS_CLASS: Record<string, string> = { Entwurf: '', Eingereicht: 'warn', Genehmigt: 'ok', Bezahlt: 'ok', Zurückgewiesen: 'bad' };
export function ConcurTag({ t }: { t: Trip }) {
  if (!t.concur?.status && !t.concur?.itineraryId) return null;
  return <span className={`tag concur ${STATUS_CLASS[t.concur?.status ?? ''] ?? ''}`}>Concur{t.concur?.status ? ` · ${t.concur.status}` : ' · gebucht'}</span>;
}

/** Reise: Abrechnung in Concur */
export function ConcurTripCard({ t, onChange }: { t: Trip; onChange: (t: Trip) => void }) {
  const s = useSettings();
  const a = useConcurAction();
  if (s.concurMode === 'aus') return null;
  const open = planTripPush(t).filter((o) => o.kind !== 'report').length;
  const eur = (n?: number) => (n ?? 0).toLocaleString('de-DE', { style: 'currency', currency: t.concur?.currency || 'EUR' });
  return (
    <div className="card concur-card">
      <div className="card-head"><h2>SAP Concur {s.concurMode === 'demo' && <span className="tag warn">Demo</span>}</h2><ConcurTag t={t} /></div>
      {t.concur?.reportId
        ? <p className="small">Abrechnung <b>{t.concur.status}</b>{t.concur.total != null ? ` · ${eur(t.concur.total)} in Concur` : ''}{t.concur.syncedAt ? <><br /><span className="muted">Stand {new Date(t.concur.syncedAt).toLocaleString('de-DE')}</span></> : null}</p>
        : <p className="muted small">Noch keine Abrechnung in Concur. „Senden“ legt sie an und überträgt Belege (mit Foto) und Kilometer.</p>}
      {t.concur?.itineraryId && <p className="muted small">Buchung aus Concur Travel – Termine, Hotel und Buchungsnummern kommen von dort.</p>}
      {!editable(t) && <p className="muted small">Abrechnung ist {t.concur?.status?.toLowerCase()} – Änderungen nur noch in Concur.</p>}
      <div className="row wrap">
        <button className="btn primary" disabled={a.busy || !editable(t) || !open} onClick={() => a.run(async () => {
          await db.trips.put(t); // aktuellen Bearbeitungsstand zuerst sichern
          try { return await sendTrip(s, t.id); } finally { const u = await db.trips.get(t.id); if (u) onChange(u); }
        }, (r) => `Concur: ${r.sent} übertragen${r.failed.length ? ` · ${r.failed.length} fehlgeschlagen (${r.failed[0]})` : ''}`)}>
          {a.busy ? 'Wird gesendet …' : open ? `↑ An Concur senden (${open})` : '✓ Alles in Concur'}</button>
        <LoginLink url={a.login} />
      </div>
      <p className="muted small">Verpflegungspauschalen berechnet Concur selbst nach Firmenrichtlinie.</p>
    </div>
  );
}

/** Einstellungen: Verbindung zu SAP Concur */
export function ConcurSettingsCard() {
  const s = useSettings();
  const a = useConcurAction();
  const last = useLiveQuery(() => getMeta<string>('concur-last-sync'), []);
  return (
    <section className="card">
      <h2>SAP Concur</h2>
      <div className="form">
        <label className="field wide"><span>Verbindung</span>
          <select value={s.concurMode} onChange={(e) => saveSettings({ concurMode: e.target.value as typeof s.concurMode })}>
            <option value="aus">Aus</option>
            <option value="demo">Demo – Testdaten für Präsentationen</option>
            <option value="live" disabled={!CONCUR_GATEWAY && s.concurMode !== 'live'}>Live – über die Plattform der IT{CONCUR_GATEWAY ? '' : ' (noch nicht eingerichtet)'}</option>
          </select>
          <small>{s.concurMode === 'demo' ? 'Zeigt den Abgleich mit erfundenen Daten: eine gebuchte Reise, eine bezahlte Abrechnung, eigene Belege an Concur.' : s.concurMode === 'live' ? 'Anmeldung mit deinem Firmen-Login. Die Verbindung betreibt die IT – es gibt keinen TechDesk-Server.' : 'Reisekosten werden wie bisher direkt in Concur erfasst.'}</small>
        </label>
      </div>
      {s.concurMode !== 'aus' && <ul className="muted small fsm-rules">
        <li><b>Aus Concur:</b> gebuchte Reisen (Flug, Bahn, Hotel, Mietwagen) und der Status deiner Abrechnungen.</li>
        <li><b>An Concur:</b> Reise als Abrechnung, Belege mit Foto, Kilometer mit dem Privat-PKW.</li>
        <li><b>Bleibt in Concur:</b> Einreichen, Genehmigung, Verpflegungspauschalen und Auszahlung.</li>
      </ul>}
      {s.concurMode !== 'aus' && <p className="muted small">Zuletzt abgeglichen: {last ? new Date(last).toLocaleString('de-DE') : 'noch nie'}</p>}
      <div className="row wrap">
        <ConcurSyncButton />
        {s.concurMode !== 'aus' && <button className="btn ghost" disabled={a.busy} onClick={() => a.run(removeConcurData, (n) => `Concur-Verknüpfungen entfernt (${n} gebuchte Reisen)`)}>Concur-Daten vom Gerät entfernen</button>}
      </div>
    </section>
  );
}
