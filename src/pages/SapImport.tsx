import { useState } from 'react';
import { Field, Modal, pickFile, useToast } from '../components';
import { db, saveSettings, useSettings } from '../db';
import { addDays, formatDateDE } from '../lib/dates';
import { parseSapStatement, sapToEntries, type SapStatement } from '../lib/sapImport';
import { fmtHours, summarizeDay } from '../lib/time';

/** Offiziellen SAP-Zeitnachweis (PDF) einlesen und in die App übernehmen */
export function SapImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (month: string) => void }) {
  const s = useSettings();
  const toast = useToast();
  const [st, setSt] = useState<SapStatement | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [paste, setPaste] = useState('');
  const [takeTimes, setTakeTimes] = useState(true);
  const [takeGlz, setTakeGlz] = useState(true);
  const H = (m: number, signed = false) => fmtHours(m, { hourFormat: 'dezimal' }, signed);

  async function readPdf() {
    const f = await pickFile('application/pdf,.pdf');
    if (!f) return;
    setError(''); setBusy('PDF wird gelesen …');
    try {
      const { pdfLines } = await import('../lib/pdfText');
      evaluate(parseSapStatement(await pdfLines(f)));
    } catch (e) {
      setError('Die PDF konnte nicht gelesen werden: ' + (e as Error).message + '. Tipp: Text aus der PDF kopieren und unten einfügen.');
    }
    setBusy('');
  }
  function readText() { evaluate(parseSapStatement(paste.split(/\r?\n/))); }
  function evaluate(r: SapStatement) {
    if (!r.days.length && r.glzTotal === undefined) { setError('Kein Zeitnachweis erkannt. Bitte den offiziellen Zeitnachweis aus Fiori (PDF) verwenden.'); return; }
    setSt(r);
  }

  const entries = st ? sapToEntries(st) : [];
  const calc = (date: string) => summarizeDay(date, entries.filter((e) => e.date === date), { ...s, travelFactor: s.travelFactor, separateSunHoliday: false, nightSeparate: false }).worked;
  const compared = st ? st.days.filter((d) => d.segments.length && d.std !== undefined) : [];
  const mismatches = compared.filter((d) => calc(d.date) !== d.std);
  const from = st?.from ?? st?.days[0]?.date;
  const to = st?.to ?? st?.days[st.days.length - 1]?.date;

  async function apply() {
    if (!st || !from || !to) return;
    setBusy('Wird übernommen …');
    try {
      if (takeTimes) {
        await db.transaction('rw', db.times, async () => {
          const old = await db.times.where('date').between(from, to, true, true).primaryKeys();
          await db.times.bulkDelete(old);
          await db.times.bulkPut(entries);
        });
      }
      if (takeGlz && st.glzTotal !== undefined && (st.stichtag || to)) {
        await saveSettings({ overtimeStartBalance: st.glzTotal, overtimeStartDate: addDays(st.stichtag ?? to, 1) });
      }
      toast(`Zeitnachweis ${formatDateDE(from)}–${formatDateDE(to)} übernommen`);
      onImported(from.slice(0, 8) + '01');
      onClose();
    } catch (e) { setError((e as Error).message); }
    setBusy('');
  }

  return (
    <Modal title="SAP-Zeitnachweis importieren" onClose={onClose} footer={st ? <>
      <button className="btn ghost" onClick={() => setSt(null)}>Andere Datei</button>
      <span className="spacer" />
      <button className="btn primary" disabled={!!busy || (!takeTimes && !takeGlz)} onClick={apply}>Übernehmen</button>
    </> : undefined}>
      {!st ? (
        <div className="form">
          <p className="wide muted">Den Zeitnachweis aus Fiori als PDF speichern (z. B. in „Dateien“) und hier auswählen. Die Datei wird <b>nur auf diesem Gerät</b> gelesen. Persönliche Angaben wie Personalnummer oder Kostenstelle werden nicht übernommen.</p>
          <div className="wide"><button className="btn primary" disabled={!!busy} onClick={readPdf}>📄 PDF auswählen</button></div>
          {busy && <p className="wide result warn">{busy}</p>}
          {error && <p className="wide result bad">{error}</p>}
          <details className="wide">
            <summary className="muted">Alternative: Text einfügen</summary>
            <Field label="Text aus dem Zeitnachweis (in der PDF alles markieren → kopieren)" wide>
              <textarea rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'vom 01.10.2026 bis 31.10.2026\n26 MO Reisezeit 07:30 08:00 7,50 8,00 0,50- …\nKundenbesuch 08:00 12:00'} /></Field>
            <button className="btn" disabled={!paste.trim()} onClick={readText}>Text auswerten</button>
          </details>
        </div>
      ) : (
        <div className="form">
          <dl className="rows wide">
            <dt>Zeitraum</dt><dd>{from ? formatDateDE(from) : '?'} – {to ? formatDateDE(to) : '?'}</dd>
            <dt>Tage mit Zeiten</dt><dd>{st.days.filter((d) => d.segments.length).length} ({entries.filter((e) => e.start).length} Abschnitte)</dd>
            <dt>Urlaub / Krank</dt><dd>{st.days.filter((d) => d.absence === 'urlaub').length} / {st.days.filter((d) => d.absence === 'krank').length} Tage</dd>
            {st.glzTotal !== undefined && <><dt>GLZ-Saldo Gesamt{st.stichtag ? ` (${formatDateDE(st.stichtag)})` : ''}</dt><dd>{H(st.glzTotal)}</dd></>}
            {st.overCapPaid ? <><dt>Gleitzeitstunden 125 %</dt><dd>{H(st.overCapPaid)}</dd></> : null}
            {st.vacation && <><dt>Urlaub laut SAP</dt><dd>Anspruch {st.vacation.entitlement} · Rest {st.vacation.rest} · verplant {st.vacation.planned} · Verbrauch {st.vacation.used}</dd></>}
          </dl>
          {compared.length > 0 && (mismatches.length === 0
            ? <p className="wide result ok">✓ Abgleich: Für alle {compared.length} Tage rechnet die App dieselben Stunden wie SAP.</p>
            : <div className="wide result warn"><b>{mismatches.length} von {compared.length} Tagen weichen ab</b> (App ↔ SAP):
                <ul>{mismatches.slice(0, 8).map((d) => <li key={d.date}>{formatDateDE(d.date)}: {H(calc(d.date))} ↔ {H(d.std!)}</li>)}</ul>
                Prüfe Pausenregel und Reisezeit-Anrechnung in den Einstellungen.</div>)}
          {st.unknown.length > 0 && <p className="wide muted small">Nicht zugeordnet: {st.unknown.slice(0, 5).join(' · ')}</p>}
          <label className="check wide"><input type="checkbox" checked={takeTimes} onChange={(e) => setTakeTimes(e.target.checked)} /> Zeiten übernehmen (ersetzt alle Einträge vom {from ? formatDateDE(from) : '?'} bis {to ? formatDateDE(to) : '?'})</label>
          {st.glzTotal !== undefined && <label className="check wide"><input type="checkbox" checked={takeGlz} onChange={(e) => setTakeGlz(e.target.checked)} /> Gleitzeitkonto auf SAP-Stand setzen: {H(st.glzTotal)} ab {formatDateDE(addDays(st.stichtag ?? to!, 1))}</label>}
          {busy && <p className="wide result warn">{busy}</p>}
          {error && <p className="wide result bad">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
