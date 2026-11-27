import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { navigate } from '../App';
import { useToast } from '../components';
import { db, getMeta, saveSettings, useSettings } from '../db';
import { fsmClient, syncFsm } from '../fsmSync';
import { formatDateDE, todayISO } from '../lib/dates';
import type { FsmActivity } from '../lib/fsm';
import { insideFsm } from '../lib/fsmBridge';
import type { ServiceReport } from '../lib/types';

export function useFsmActivities(): FsmActivity[] {
  return useLiveQuery(async () => ((await getMeta<FsmActivity[]>('fsm-activities')) ?? []), []) ?? [];
}

/** Hinweisleiste im Demo-Modus – damit bei der Präsentation klar ist: Testdaten */
export function FsmDemoBanner() {
  const s = useSettings();
  if (s.fsmMode !== 'demo') return null;
  return <div className="demo-banner" role="note"><b>SAP FSM · Demo-Modus</b><span>Einsätze und Zeiten sind Testdaten</span><a href="#/einstellungen">Einstellungen</a></div>;
}

export function FsmSyncButton({ what, label = 'Mit FSM abgleichen', className = 'btn' }: { what?: { calendar?: boolean; times?: boolean }; label?: string; className?: string }) {
  const s = useSettings();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (s.fsmMode === 'aus') return null;
  return (
    <button className={className} disabled={busy} onClick={async () => {
      setBusy(true);
      try { const r = await syncFsm(s, what); toast(`FSM: ${r.activities} Einsätze${what?.times === false ? '' : `, ${r.efforts} Zeitbuchungen`} übernommen`); } catch (e) { toast((e as Error).message); }
      setBusy(false);
    }}>{busy ? 'FSM wird abgefragt …' : <>⇅ {label}</>}</button>
  );
}

/** Startseite: anstehende FSM-Einsätze mit „Bericht anlegen“ */
export function FsmActivitiesCard() {
  const s = useSettings();
  const acts = useFsmActivities();
  if (s.fsmMode === 'aus') return null;
  const today = todayISO();
  const list = acts.filter((a) => a.end.slice(0, 10) >= today).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 5);
  const recent = acts.filter((a) => a.end.slice(0, 10) < today).sort((a, b) => b.end.localeCompare(a.end)).slice(0, 2);
  return (
    <section className="card">
      <div className="card-head"><h2>Meine FSM-Einsätze {s.fsmMode === 'demo' && <span className="tag warn">Demo</span>}</h2><FsmSyncButton className="btn small" label="Abgleichen" /></div>
      {!acts.length ? <p className="muted">Noch nicht abgeglichen. Tippe auf „Abgleichen“.</p> : (
        <ul className="list">
          {[...list, ...recent].map((a) => (
            <li key={a.id}>
              <span className="dot" style={{ background: a.status === 'OPEN' ? 'var(--accent)' : 'var(--muted)' }} />
              <div onClick={() => navigate('kalender', a.start.slice(0, 10))}>
                <b>{a.customer}</b>
                <small>{formatDateDE(a.start.slice(0, 10))}{a.end.slice(0, 10) !== a.start.slice(0, 10) ? ` – ${formatDateDE(a.end.slice(0, 10))}` : ''} · {a.subject} · Masch. {a.equipment.serial} · {a.code}</small>
              </div>
              <button className="btn small" onClick={() => navigate('berichte', `neu?fsm=${a.id}`)}>Bericht</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Einstellungen: Verbindung zu SAP FSM */
export function FsmSettingsCard() {
  const s = useSettings();
  const toast = useToast();
  const last = useLiveQuery(() => getMeta<string>('fsm-last-sync'), []);
  async function removeData() {
    const ev = await db.events.filter((e) => e.id.startsWith('fsm-')).primaryKeys();
    const tm = await db.times.filter((t) => t.id.startsWith('fsm-')).primaryKeys();
    await db.events.bulkDelete(ev); await db.times.bulkDelete(tm);
    await db.meta.put({ key: 'fsm-activities', value: [] });
    toast(`${ev.length} Einsätze und ${tm.length} Zeitbuchungen aus FSM entfernt`);
  }
  return (
    <section className="card">
      <h2>SAP FSM</h2>
      <div className="form">
        <label className="field wide"><span>Verbindung</span>
          <select value={s.fsmMode} onChange={(e) => saveSettings({ fsmMode: e.target.value as typeof s.fsmMode })}>
            <option value="aus">Aus</option>
            <option value="demo">Demo – Testdaten für Präsentationen</option>
            <option value="live" disabled={!insideFsm() && s.fsmMode !== 'live'}>Live – in der SAP-FSM-App{insideFsm() ? '' : ' (nur in FSM geöffnet)'}</option>
          </select>
          <small>{s.fsmMode === 'demo' ? 'Zeigt, wie die Anbindung funktioniert: Einsätze → Kalender, gebuchte Zeiten → Zeiterfassung, Bericht → FSM. Alle Daten sind erfunden.' : s.fsmMode === 'live' ? 'Einsätze und Zeiten kommen direkt aus FSM – mit deiner FSM-Anmeldung und deinen FSM-Rechten. Kein TechDesk-Server, kein eigenes Konto.' : 'Die App arbeitet ohne FSM. Berichtstexte werden per Kopieren übertragen.'}</small>
        </label>
      </div>
      {s.fsmMode !== 'aus' && <p className="muted small">Zuletzt abgeglichen: {last ? new Date(last).toLocaleString('de-DE') : 'noch nie'}</p>}
      <div className="row wrap">
        <FsmSyncButton />
        <button className="btn ghost" onClick={removeData}>FSM-Daten vom Gerät entfernen</button>
      </div>
    </section>
  );
}

/** Bericht: an FSM-Einsatz senden (Text + PDF) */
export function FsmSendButton({ r, text, onSent }: { r: ServiceReport; text: string; onSent: (r: ServiceReport) => void }) {
  const s = useSettings();
  const toast = useToast();
  const acts = useFsmActivities();
  const [pick, setPick] = useState(false);
  const [busy, setBusy] = useState(false);
  if (s.fsmMode === 'aus') return null;
  async function send(link = r.fsm) {
    if (!link) { setPick(true); return; }
    setBusy(true);
    try {
      const c = fsmClient(s)!;
      const res = await c.sendReport({ activityId: link.activityId, text, pdfFileName: `Service_Report_${r.customer.replace(/\W+/g, '_')}.pdf` });
      onSent({ ...r, fsm: { ...link, sentAt: res.at } });
      toast(`An FSM-Einsatz ${link.code} gesendet${s.fsmMode === 'demo' ? ' (Demo)' : ''}`);
    } catch (e) { toast((e as Error).message); }
    setBusy(false);
  }
  return (
    <>
      <button className="btn" disabled={busy} onClick={() => send()}>{busy ? 'Wird gesendet …' : r.fsm?.sentAt ? '✓ An FSM gesendet' : '↗ An FSM senden'}</button>
      {pick && (
        <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && setPick(false)}>
          <div className="modal"><header><h2>FSM-Einsatz wählen</h2><button className="icon" onClick={() => setPick(false)}>✕</button></header>
            <div className="modal-body">{!acts.length ? <p className="muted">Keine Einsätze. Zuerst mit FSM abgleichen.</p> : (
              <ul className="list">{acts.map((a) => (
                <li key={a.id} onClick={() => { setPick(false); void send({ activityId: a.id, code: a.code }); }}>
                  <div><b>{a.customer} · {a.code}</b><small>{formatDateDE(a.start.slice(0, 10))} · {a.subject} · Masch. {a.equipment.serial}</small></div>
                </li>))}</ul>)}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
