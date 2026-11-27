import { Logo } from '../brand';
import { cloudEnabled } from '../config';
import AccountSection from './Account';
import { FsmSettingsCard } from './FsmParts';
import { download, Field, PageHeader, pickFile, useToast } from '../components';
import { useEffect, useState } from 'react';
import { db, exportAll, importAll, saveSettings, storageSelfTest, useSettings } from '../db';
import { formatDateDE, todayISO } from '../lib/dates';
import { fmtHours } from '../lib/time';
import { STATES, type StateCode } from '../lib/holidays';
import { DEFAULT_SNIPPETS } from '../lib/snippets';

const DAYS = [[1, 'Mo'], [2, 'Di'], [3, 'Mi'], [4, 'Do'], [5, 'Fr'], [6, 'Sa'], [0, 'So']] as const;

export default function SettingsPage() {
  const s = useSettings();
  const toast = useToast();
  const [storage, setStorage] = useState<string | null>(null);
  useEffect(() => {
    void storageSelfTest().then((r) => setStorage(r ?? 'ok'));
    const t = window.setInterval(() => void storageSelfTest().then((r) => setStorage(r ?? 'ok')), 5000);
    return () => window.clearInterval(t);
  }, []);
  const num = (k: keyof typeof s) => (e: React.ChangeEvent<HTMLInputElement>) => saveSettings({ [k]: Number(e.target.value) });

  async function uploadLogo() {
    const f = await pickFile('image/png,image/jpeg,image/svg+xml');
    if (!f) return;
    if (f.size > 1_000_000) return toast('Logo bitte unter 1 MB');
    const r = new FileReader();
    r.onload = () => saveSettings({ logoDataUrl: String(r.result) });
    r.readAsDataURL(f);
  }
  async function restore(mode: 'merge' | 'replace') {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    if (mode === 'replace' && !confirm('Alle aktuellen Daten werden ersetzt. Fortfahren?')) return;
    try { await importAll(await f.text(), mode); toast('Sicherung eingespielt'); } catch (e) { toast((e as Error).message); }
  }

  return (
    <>
      <PageHeader title="Einstellungen" />
      <AccountSection />
      <div className="grid2">
        <section className="card">
          <h2>Persönlich</h2>
          <div className="form">
            <Field label="Name (für Berichte)"><input value={s.name} onChange={(e) => saveSettings({ name: e.target.value })} /></Field>
            <Field label="Bundesland (Feiertage)"><select value={s.state} onChange={(e) => saveSettings({ state: e.target.value as StateCode })}>
              {Object.entries(STATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Heimatadresse / Startpunkt" wide hint="Für Routenplanung"><input value={s.homeAddress} onChange={(e) => saveSettings({ homeAddress: e.target.value })} /></Field>
          </div>
        </section>

        <section className="card">
          <h2>Arbeitszeit</h2>
          <div className="form">
            <Field label="Wochenstunden (Soll)"><input type="number" step="0.5" min={0} value={s.weeklyHours} onChange={num('weeklyHours')} /></Field>
            <Field label="Urlaubstage / Jahr"><input type="number" min={0} value={s.vacationDaysPerYear} onChange={num('vacationDaysPerYear')} /></Field>
            <Field label="Arbeitstage" wide>
              <div className="pills">{DAYS.map(([d, l]) => (
                <button key={d} className={s.workDays.includes(d) ? 'pill on' : 'pill'} onClick={() => saveSettings({ workDays: s.workDays.includes(d) ? s.workDays.filter((x) => x !== d) : [...s.workDays, d] })}>{l}</button>
              ))}</div>
            </Field>
            <Field label="Reisezeit zählt zu (%)" hint="Laut Betriebsvereinbarung / Arbeitsvertrag"><input type="number" min={0} max={100} value={Math.round(s.travelFactor * 100)} onChange={(e) => saveSettings({ travelFactor: Number(e.target.value) / 100 })} /></Field>
            <Field label="Bereitschaft zählt zu (%)"><input type="number" min={0} max={100} value={Math.round(s.standbyFactor * 100)} onChange={(e) => saveSettings({ standbyFactor: Number(e.target.value) / 100 })} /></Field>
            <Field label="Pausenregel" wide hint={s.breakMode === 'firma' ? `Ab ${s.companyBreakFromMin / 60} h Anwesenheit werden ${s.companyBreakMin} min abgezogen (angezeigt ab ${s.companyBreakStart}). Darunter keine Pause.` : s.breakMode === 'gesetzlich' ? 'ArbZG §4: über 6 h → 30 min, über 9 h → 45 min (mindestens).' : 'Die Pause wird bei jedem Eintrag selbst eingetragen.'}>
              <select value={s.breakMode} onChange={(e) => saveSettings({ breakMode: e.target.value as typeof s.breakMode })}>
                <option value="firma">Firmenregel (automatisch)</option>
                <option value="gesetzlich">Gesetzliche Mindestpause</option>
                <option value="manuell">Manuell eintragen</option>
              </select></Field>
            {s.breakMode === 'firma' && <>
              <Field label="Pause (min)"><input type="number" min={0} step={5} value={s.companyBreakMin} onChange={num('companyBreakMin')} /></Field>
              <Field label="Ab Anwesenheit (h)"><input type="number" min={0} step={0.5} value={s.companyBreakFromMin / 60} onChange={(e) => saveSettings({ companyBreakFromMin: Math.round(Number(e.target.value) * 60) })} /></Field>
              <Field label="Pause ab Uhrzeit"><input type="time" value={s.companyBreakStart} onChange={(e) => saveSettings({ companyBreakStart: e.target.value })} /></Field>
            </>}
            <Field label="Stunden anzeigen"><select value={s.hourFormat} onChange={(e) => saveSettings({ hourFormat: e.target.value as typeof s.hourFormat })}>
              <option value="dezimal">Dezimal (7,50) wie SAP-Zeitnachweis</option><option value="hm">Std:Min (7:30)</option></select></Field>
            <Field label="Gleitzeitkonto bis + (Std.)" hint="Darüber wird ausgezahlt. 0 = ohne Grenze."><input type="number" min={0} step={1} value={s.glzCapMin / 60} onChange={(e) => saveSettings({ glzCapMin: Math.round(Number(e.target.value) * 60) })} /></Field>
            <Field label="Gleitzeitkonto bis − (Std.)" hint="Darunter warnt die App."><input type="number" max={0} step={1} value={s.glzFloorMin / 60} onChange={(e) => saveSettings({ glzFloorMin: Math.round(Number(e.target.value) * 60) })} /></Field>
            <Field label="Zuschlag Auszahlung (%)" hint="Für Stunden über der Grenze"><input type="number" min={0} max={200} step={5} value={s.overPayPct} onChange={(e) => saveSettings({ overPayPct: Number(e.target.value) })} /></Field>
            <Field label="Sonn-/Feiertagsstunden separat" hint="Nicht ins Gleitzeitkonto, sondern als Überstunden Sonntag/Feiertag (wie im Zeitnachweis)"><input type="checkbox" checked={s.separateSunHoliday} onChange={(e) => saveSettings({ separateSunHoliday: e.target.checked })} /></Field>
            <Field label="Nachtstunden von"><input type="time" value={s.nightStart} onChange={(e) => saveSettings({ nightStart: e.target.value })} /></Field>
            <Field label="Nachtstunden bis"><input type="time" value={s.nightEnd} onChange={(e) => saveSettings({ nightEnd: e.target.value })} /></Field>
            <Field label="Nachtstunden wie Überstunden" hint="Nicht ins Gleitzeitkonto, Auszahlung mit Zuschlag"><input type="checkbox" checked={s.nightSeparate} onChange={(e) => saveSettings({ nightSeparate: e.target.checked })} /></Field>
            <Field label="Zuschlag Nacht (%)"><input type="number" min={0} max={200} step={5} value={s.nightPct} onChange={(e) => saveSettings({ nightPct: Number(e.target.value) })} /></Field>
            <Field label="Hinweise Arbeitszeitgesetz" hint="Ruhezeit < 11 h, Sonn-/Feiertag"><input type="checkbox" checked={s.arbzgWarnings} onChange={(e) => saveSettings({ arbzgWarnings: e.target.checked })} /></Field>
            <Field label="Gleitzeitkonto" wide hint={`${fmtHours(s.overtimeStartBalance, s, true)} Std. zu Beginn vom ${formatDateDE(s.overtimeStartDate)} – ändern in der Zeiterfassung über „Gleitzeitkonto → anpassen“.`}>
              <a className="btn" href="#/zeit/stand">Stand anpassen</a></Field>
          </div>
        </section>

        <section className="card">
          <h2>Reisekosten</h2>
          <div className="form">
            <Field label="Kilometerpauschale (€/km)"><input type="number" step="0.01" value={s.kmRate} onChange={num('kmRate')} /></Field>
            <Field label="Verpflegung 24 h (€)"><input type="number" step="0.5" value={s.mealFull} onChange={num('mealFull')} /></Field>
            <Field label="Verpflegung An-/Abreise, >8 h (€)"><input type="number" step="0.5" value={s.mealPartial} onChange={num('mealPartial')} /></Field>
          </div>
        </section>

        <section className="card">
          <h2>Berichte &amp; Präsentationen</h2>
          <div className="form">
            <Field label="Firmenname (Wortmarke)"><input value={s.companyName} onChange={(e) => saveSettings({ companyName: e.target.value })} /></Field>
            <Field label="Logo">
              <div className="row">
                <Logo height={28} />
                <button className="btn" onClick={uploadLogo}>{s.logoDataUrl ? 'Ändern' : 'Eigenes Logo'}</button>
                {s.logoDataUrl && <button className="btn ghost" onClick={() => saveSettings({ logoDataUrl: undefined })}>Entfernen</button>}
              </div>
            </Field>
          </div>
        </section>

        <FsmSettingsCard />

        <section className="card">
          <h2>Daten &amp; Sicherung</h2>
          <p className="muted">{cloudEnabled ? 'Deine Daten werden automatisch in deinem Konto gesichert. Zusätzlich kannst du hier eine eigene Sicherungsdatei herunterladen.' : 'Alle Daten liegen nur auf diesem Gerät (offline nutzbar). Mach regelmäßig eine Sicherung – damit überträgst du auch Daten zwischen Handy und PC.'}</p>
          <div className="row wrap">
            <button className="btn primary" onClick={async () => download(`techdesk-backup-${todayISO()}.json`, await exportAll(), 'application/json')}>Sicherung herunterladen</button>
            <button className="btn" onClick={() => restore('merge')}>Sicherung zusammenführen</button>
            <button className="btn" onClick={() => restore('replace')}>Sicherung wiederherstellen</button>
            <button className="btn ghost" onClick={async () => { await db.snippets.bulkPut(DEFAULT_SNIPPETS); toast('Standard-Vorlagen wiederhergestellt'); }}>Standard-Vorlagen zurücksetzen</button>
          </div>
        </section>

        <section className="card">
          <h2>App</h2>
          <dl className="rows">
            <dt>Version</dt><dd>{__BUILD__}</dd>
            <dt>Speicher</dt><dd>{storage === null ? 'wird geprüft …' : storage === 'ok' ? '✓ funktioniert' : '✗ ' + storage}</dd>
          </dl>
          <div className="row wrap">
            <button className="btn" onClick={async () => { const r = await storageSelfTest(); setStorage(r ?? 'ok'); toast(r ? 'Speicher-Fehler: ' + r : 'Speicher funktioniert'); }}>Speicher prüfen</button>
            <button className="btn" onClick={() => location.reload()}>Neu laden / Update holen</button>
          </div>
        </section>
      </div>
    </>
  );
}
