import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { navigate, routeParam } from '../App';
import { download, Field, Modal, PageHeader } from '../components';
import { db, saveSettings, useSettings } from '../db';
import { addDays, endOfMonth, parseHours, formatDateDE, formatMinutes, MONTHS, startOfMonth, timeToMinutes, todayISO, uid, weekdayShort } from '../lib/dates';
import { isDomestic } from '../lib/visa';
import { printZeitnachweis } from './Zeitnachweis';
import { SapImportDialog } from './SapImport';
import { FsmSyncButton, useFsmActivities } from './FsmParts';
import { balanceDate, breakLabel, creditedMinutes, dayWork, effectiveBreak, fmtHours, glzAccount, overtimeBalance, setBalanceAt, summarizeRange, vacationSummary, weeklySums, withCalendarVacation } from '../lib/time';
import { TIME_KINDS, type TimeEntry, type TimeKind } from '../lib/types';

const TIMED: TimeKind[] = ['arbeit', 'kunde', 'reise', 'bereitschaft'];
export const fmtDays = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 1 });
const hm = (m?: number) => (m === undefined ? '' : `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);

export default function TimePage() {
  const s = useSettings();
  const H = (m: number, signed = false) => fmtHours(m, s, signed);
  const [month, setMonth] = useState(startOfMonth(todayISO()));
  const [edit, setEdit] = useState<TimeEntry | null>(null);
  const [onlyFilled, setOnlyFilled] = useState(false);
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const loaded = useLiveQuery(() => db.times.toArray(), []);
  const vacEvents = useLiveQuery(() => db.events.where('type').equals('urlaub').toArray(), []) ?? [];
  const trips = useLiveQuery(() => db.trips.toArray(), []) ?? [];
  const own = loaded ?? [];
  const all = withCalendarVacation(own, vacEvents);
  const to = endOfMonth(month);
  const sum = summarizeRange(month, to, all, s);
  const cutoff = balanceDate(todayISO(), all);
  // Saldo nur bis heute (zukünftige Tage sind noch nicht „fehlend“) und erst ab Start des Kontos
  const counts = (d: string) => d >= s.overtimeStartDate && d <= cutoff;
  const stichtag = to < cutoff ? to : cutoff;
  const glz = glzAccount(stichtag, all, s);
  const monthDiff = month <= stichtag ? glz.periodSaldo : 0;
  const year = Number(month.slice(0, 4));
  const vac = vacationSummary(year, own, vacEvents, s, todayISO());
  const byDate = (d: string) => all.filter((e) => e.date === d).sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''));
  const weeks = weeklySums(sum, (d) => d >= s.overtimeStartDate && d <= balanceDate(todayISO(), all));
  const tripOn = (d: string) => trips.find((t) => t.departure && t.return && d >= t.departure.slice(0, 10) && d <= t.return.slice(0, 10));
  const counted = summarizeRange(month, stichtag >= month ? stichtag : month, all, s); // Zuschläge bis Stichtag
  // laufende Summe wie Spalte „Summe“ im Zeitnachweis
  let running = glz.previous;
  const runningByDate = new Map<string, number>();
  for (const d of sum.days) { if (counts(d.date)) running += d.diff; runningByDate.set(d.date, running); }

  const shift = (n: number) => {
    const t = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
    setMonth(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`);
  };

  function exportCsv() {
    const dec = (m: number) => (m / 60).toFixed(2).replace('.', ',');
    const rows: string[][] = [['Datum', 'Tag', 'Art', 'von', 'bis', 'Std.', 'Soll', 'Saldo', 'Kunde', 'Notiz']];
    for (const d of sum.days) {
      const es = byDate(d.date);
      if (!es.length && !d.target) continue;
      rows.push([formatDateDE(d.date), weekdayShort(d.date), d.holiday ?? d.half ?? '', d.first !== undefined ? hm(d.first) : '', d.last !== undefined ? hm(d.last) : '', dec(d.worked), dec(d.target), counts(d.date) ? dec(d.diff) : '', '', '']);
      for (const e of es) rows.push(['', '', TIME_KINDS[e.kind], e.start ?? '', e.end ?? '', '', '', '', e.customer ?? '', e.note ?? '']);
    }
    rows.push([], ['Monatssumme', '', '', '', '', dec(sum.worked), dec(sum.target), dec(monthDiff)], ['GLZ-Saldo Gesamt', dec(glz.balance)], ['Über Obergrenze', dec(glz.overCap)], ['Samstag (25 %)', dec(counted.sat)], ['Sonntag (50 %)', dec(counted.sun)], ['Feiertag (100 %)', dec(counted.hol)], ['Nachtstunden (Auszahlung)', dec(counted.nightPaid)]);
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    download(`Zeitnachweis_${month.slice(0, 7)}.csv`, csv, 'text/csv;charset=utf-8');
  }

  function exportPdf() {
    printZeitnachweis({ s, month, to, sum, byDate, glz, counted, weeks, vac, monthDiff, counts, running: runningByDate, tripOn });
  }

  // Neue Einträge: zuletzt verwendete Art/Zeiten; an einem Tag mit Einträgen beginnt der nächste Abschnitt am Ende des letzten
  const lastUsed = [...own].filter((e) => TIMED.includes(e.kind) && e.start && e.end).sort((a, b) => b.date.localeCompare(a.date) || (b.end ?? '').localeCompare(a.end ?? ''))[0];
  const newEntry = (date: string): TimeEntry => {
    const sameDay = own.filter((e) => e.date === date && e.end).sort((a, b) => (b.end ?? '').localeCompare(a.end ?? ''))[0];
    if (sameDay?.end) {
      const st = timeToMinutes(sameDay.end), en = Math.min(st + 60, 23 * 60 + 59);
      return { id: uid(), date, kind: sameDay.kind === 'reise' ? 'kunde' : 'reise', start: sameDay.end, end: hm(en), breakMin: 0 };
    }
    return { id: uid(), date, kind: lastUsed?.kind ?? 'arbeit', start: lastUsed?.start ?? '07:00', end: lastUsed?.end ?? '16:00', breakMin: 0 };
  };

  // Direktaufruf: #/zeit/neu (Eintrag für heute) und #/zeit/stand (Kontostand)
  const [handled, setHandled] = useState(false);
  useEffect(() => {
    if (handled || loaded === undefined) return;
    const p = routeParam();
    if (p === 'neu') setEdit(newEntry(todayISO()));
    if (p === 'stand') setBalanceOpen(true);
    if (p) history.replaceState(null, '', '#/zeit');
    setHandled(true);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader title="Zeiterfassung" actions={<>
        <FsmSyncButton label="FSM abgleichen" />
        <button className="btn" onClick={() => setImportOpen(true)}>SAP-Zeitnachweis importieren</button>
        <button className="btn" onClick={exportPdf}>Zeitnachweis (PDF)</button>
        <button className="btn" onClick={exportCsv}>CSV</button>
        <button className="btn primary" onClick={() => setEdit(newEntry(todayISO() >= month && todayISO() <= to ? todayISO() : month))}>+ Eintrag</button>
      </>} />

      <div className="cal-toolbar">
        <button className="btn" onClick={() => shift(-1)} aria-label="Vorheriger Monat">‹</button>
        <h2>{MONTHS[Number(month.slice(5, 7)) - 1]} {year}</h2>
        <button className="btn" onClick={() => shift(1)} aria-label="Nächster Monat">›</button>
        <label className="check"><input type="checkbox" checked={onlyFilled} onChange={(e) => setOnlyFilled(e.target.checked)} /> Nur Tage mit Einträgen</label>
      </div>

      <div className="kpis">
        <div className="kpi"><span>Ist Monat</span><b>{H(sum.worked)}</b><small>Soll {H(sum.target)}</small></div>
        <div className="kpi"><span>Saldo Monat</span><b className={monthDiff < 0 ? 'neg' : 'pos'}>{H(monthDiff, true)}</b><small>Ist − Soll bis heute</small></div>
        <button className="kpi link" onClick={() => setBalanceOpen(true)}><span>Gleitzeitkonto</span><b className={glz.balance < 0 ? 'neg' : 'pos'}>{H(glz.balance, true)}</b><small>{s.glzCapMin ? `Rahmen ${H(s.glzFloorMin, true)} bis +${H(s.glzCapMin)} · ` : ''}anpassen ›</small></button>
        {glz.overCap > 0 && <div className="kpi"><span>Auszahlung</span><b className="pos">{H(glz.overCap)}</b><small>über +{H(s.glzCapMin)} · mit {s.overPayPct} % = {H(Math.round(glz.overCap * (1 + s.overPayPct / 100)))}</small></div>}
        <a className="kpi link" href="#/kalender"><span>Urlaub {year}</span><b>{fmtDays(vac.rest)}</b><small>Rest · {fmtDays(vac.planned)} verplant ›</small></a>
      </div>

      {s.glzFloorMin < 0 && glz.balance < s.glzFloorMin && <p className="result bad" role="alert">⚠ Gleitzeitkonto unter {H(s.glzFloorMin, true)} Std. – der erlaubte Rahmen ist unterschritten.</p>}
      {s.glzFloorMin < 0 && glz.balance >= s.glzFloorMin && glz.balance < s.glzFloorMin + 10 * 60 && <p className="result warn">Gleitzeitkonto nahe der Untergrenze ({H(s.glzFloorMin, true)} Std.).</p>}

      <div className="card table-card">
        <table className="tt">
          <thead><tr><th>Tag</th><th>Einträge</th><th className="r">Std.</th><th className="r">Soll</th><th className="r">Saldo</th><th className="r hide-sm">Summe</th></tr></thead>
          <tbody>
            {sum.days.filter((d) => !onlyFilled || byDate(d.date).length).map((d) => {
              const es = byDate(d.date);
              const trip = tripOn(d.date);
              return (
                <tr key={d.date} className={d.target === 0 ? 'off' : ''}>
                  <td className="day"><b>{weekdayShort(d.date)} {d.date.slice(8)}.</b>
                    {d.holiday && <small>{d.holiday}</small>}{d.half && <small className="half">{d.half}</small>}
                    {trip && <small className="trip">{isDomestic(trip.country) ? 'Dienstreise' : 'Auslandsdienstreise'}</small>}</td>
                  <td>
                    {es.map((e) => (
                      <button key={e.id} className={'entry k-' + e.kind} onClick={() => (e.id.startsWith('cal-') ? navigate('kalender', e.date) : setEdit(e))}>
                        {e.id.startsWith('sap-') && <span className="sap-tag">SAP</span>}{(e.id.startsWith('fsm-') || e.fsm) && <span className="sap-tag fsm">FSM</span>}{TIME_KINDS[e.kind]}{e.start ? ` ${e.start}–${e.end ?? '…'}` : ''}{e.customer ? ` · ${e.customer}` : ''}
                      </button>
                    ))}
                    <button className="entry add" onClick={() => setEdit(newEntry(d.date))} aria-label={`Abschnitt am ${formatDateDE(d.date)} hinzufügen`}>+</button>
                    {d.breakDeducted > 0 && <div className="note">Pause {s.breakMode === 'firma' ? `${s.companyBreakStart}–${hm(timeToMinutes(s.companyBreakStart) + d.breakDeducted)}` : `${d.breakDeducted} min`} abgezogen</div>}
                    {d.nightPaid > 0 && <div className="note">Nacht {H(d.nightPaid)} Std. · Auszahlung mit {s.nightPct} %, nicht im Gleitzeitkonto</div>}
                    {(d.sat > 0 || d.sun > 0 || d.hol > 0) && <div className="note">{d.sat ? 'Samstag 25 %' : d.sun ? 'Sonntag 50 % · nicht im Gleitzeitkonto' : 'Feiertag 100 % · nicht im Gleitzeitkonto'}</div>}
                    {d.warnings.map((w) => <div key={w} className="warn">⚠ {w}</div>)}
                  </td>
                  <td className="r">{d.worked ? H(d.worked) : '–'}</td>
                  <td className="r">{d.target ? H(d.target) : '–'}</td>
                  <td className={'r ' + (counts(d.date) ? (d.diff < 0 ? 'neg' : d.diff > 0 ? 'pos' : '') : '')}>{counts(d.date) && (d.diff || d.actual) ? H(d.diff, true) : ''}</td>
                  <td className="r hide-sm muted">{counts(d.date) ? H(runningByDate.get(d.date) ?? 0) : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid2" style={{ marginTop: '1rem' }}>
        <section className="card">
          <h2>Monatsübersicht zum Stichtag {formatDateDE(stichtag >= month ? stichtag : month)}</h2>
          <table className="sumtable"><tbody>
            <tr><td>GLZ-Saldo Vorperiode</td><td className="r">{H(glz.previous)}</td></tr>
            <tr><td>GLZ-Saldo akt. Periode</td><td className="r">{H(glz.periodSaldo - glz.overCap, true)}</td></tr>
            <tr className="sub"><td>GLZ-Saldo Gesamt</td><td className="r">{H(glz.balance)}</td></tr>
            <tr><td>Rahmen Gleitzeitkonto</td><td className="r">{s.glzCapMin ? `${H(s.glzFloorMin, true)} bis +${H(s.glzCapMin)}` : 'ohne Grenze'}</td></tr>
            <tr><td>Auszahlung über +{H(s.glzCapMin)} (Gleitzeitstunden {100 + s.overPayPct} %)</td><td className="r">{H(glz.overCap)}</td></tr>
            {glz.overCap > 0 && <tr><td className="muted">= inkl. {s.overPayPct} % Zuschlag</td><td className="r muted">{H(Math.round(glz.overCap * (1 + s.overPayPct / 100)))}</td></tr>}
            <tr><td>Überstunden Samstag 25 %</td><td className="r">{H(counted.sat)}</td></tr>
            <tr><td>Sonntag 50 %{s.separateSunHoliday ? ' · Überstunden Sonntag' : ''}</td><td className="r">{H(counted.sun)}</td></tr>
            <tr><td>Feiertag 100 %{s.separateSunHoliday ? ' · Überstunden Feiertag' : ''}</td><td className="r">{H(counted.hol)}</td></tr>
            <tr><td>Nachtstunden {s.nightStart}–{s.nightEnd}{s.nightSeparate ? ` · Auszahlung mit ${s.nightPct} %` : ''}</td><td className="r">{H(s.nightSeparate ? counted.nightPaid : counted.night)}</td></tr>
            {s.nightSeparate && counted.nightPaid > 0 && <tr><td className="muted">= inkl. {s.nightPct} % Zuschlag</td><td className="r muted">{H(Math.round(counted.nightPaid * (1 + s.nightPct / 100)))}</td></tr>}
          </tbody></table>
        </section>
        <section className="card">
          <h2>Wochensummen</h2>
          <table className="sumtable weeks"><thead><tr><th>KW</th><th>Beginn</th><th>Ende</th><th className="r">Ist</th><th className="r">Soll</th><th className="r">Saldo</th></tr></thead><tbody>
            {weeks.map((w) => <tr key={w.kw + w.from}><td>{w.kw}</td><td>{formatDateDE(w.from).slice(0, 6)}</td><td>{formatDateDE(w.to).slice(0, 6)}</td><td className="r">{H(w.worked)}</td><td className="r">{H(w.target)}</td><td className={'r ' + (w.diff < 0 ? 'neg' : w.diff > 0 ? 'pos' : '')}>{H(w.diff, true)}</td></tr>)}
          </tbody></table>
          <h2 style={{ marginTop: '1.2rem' }}>Urlaub {year}</h2>
          <table className="sumtable"><tbody>
            <tr><td>Anspruch{vac.carryOver ? ` (inkl. ${fmtDays(vac.carryOver)} Übertrag)` : ''}</td><td className="r">{fmtDays(vac.entitlement)}</td></tr>
            <tr><td>Verbrauch</td><td className="r">{fmtDays(vac.taken)}</td></tr>
            <tr className="sub"><td>Rest</td><td className="r">{fmtDays(vac.rest)}</td></tr>
            <tr><td>davon verplant</td><td className="r">{fmtDays(vac.planned)}</td></tr>
          </tbody></table>
        </section>
      </div>
      <p className="muted small">Berechnung wie im SAP-Zeitnachweis: Abschnitte (Reisezeit, Kundenbesuch, Arbeit) ergeben die Anwesenheit; Lücken dazwischen gelten als Pause{s.breakMode === 'firma' ? `, fehlt sie, werden ab ${s.companyBreakFromMin / 60} h automatisch ${s.companyBreakMin} min abgezogen` : ''}. Reisezeit {Math.round(s.travelFactor * 100)} %. {s.glzCapMin ? `Gleitzeitkonto ${H(s.glzFloorMin, true)} bis +${H(s.glzCapMin)} Std.; was am Monatsende darüber liegt, wird mit ${s.overPayPct} % Zuschlag ausgezahlt. ` : ''}{s.separateSunHoliday ? 'Sonn-/Feiertagsstunden zählen nicht zum Gleitzeitkonto, sondern separat. ' : ''}{s.nightSeparate ? `Nachtstunden (${s.nightStart}–${s.nightEnd}) wie Überstunden: Auszahlung mit ${s.nightPct} % Zuschlag. ` : ''}Anpassbar unter Einstellungen.</p>

      {edit && <EntryEditor entry={edit} onClose={() => setEdit(null)} />}
      {importOpen && <SapImportDialog onClose={() => setImportOpen(false)} onImported={(m) => setMonth(m)} />}
      {balanceOpen && <BalanceEditor current={overtimeBalance(addDays(todayISO(), -1), all, s)} onClose={() => setBalanceOpen(false)} />}
    </>
  );
}

function EntryEditor({ entry, onClose }: { entry: TimeEntry; onClose: () => void }) {
  const s = useSettings();
  const acts = useFsmActivities();
  const fromFsm = entry.id.startsWith('fsm-');
  const [e, setE] = useState(entry);
  const [until, setUntil] = useState(entry.date);
  const exists = useLiveQuery(() => db.times.get(entry.id), [entry.id]);
  const set = <K extends keyof TimeEntry>(k: K, v: TimeEntry[K]) => setE((x) => ({ ...x, [k]: v }));
  const timed = TIMED.includes(e.kind);
  const others = useLiveQuery(() => db.times.where('date').equals(e.date).toArray(), [e.date]) ?? [];
  const dayInfo = dayWork([...others.filter((o) => o.id !== e.id), e], s);
  async function save() {
    const base = timed ? e : { ...e, start: undefined, end: undefined, breakMin: undefined };
    if (!exists && !timed && until > e.date) {
      // Abwesenheit über mehrere Tage
      const rows: TimeEntry[] = [];
      for (let d = e.date; d <= until; d = addDays(d, 1)) rows.push({ ...base, id: uid(), date: d });
      await db.times.bulkAdd(rows);
    } else await db.times.put(base);
    onClose();
  }
  return (
    <Modal title={exists ? 'Eintrag bearbeiten' : 'Neuer Eintrag'} onClose={onClose} footer={<>
      {exists && !fromFsm && <button className="btn danger" onClick={async () => { await db.times.delete(e.id); onClose(); }}>Löschen</button>}
      <span className="spacer" />
      <button className="btn" onClick={onClose}>Abbrechen</button>
      <button className="btn primary" onClick={save}>Speichern</button>
    </>}>
      <div className="form">
        <Field label="Art" hint="Mehrere Abschnitte pro Tag: z. B. Reisezeit, Kundenbesuch, Reisezeit"><select value={e.kind} onChange={(x) => set('kind', x.target.value as TimeKind)}>
          {Object.entries(TIME_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Datum"><input type="date" value={e.date} onChange={(x) => set('date', x.target.value)} /></Field>
        {!timed && !exists && <Field label="Bis (mehrere Tage)"><input type="date" value={until} min={e.date} onChange={(x) => setUntil(x.target.value)} /></Field>}
        {timed && <>
          <Field label="Beginn"><input type="time" value={e.start ?? ''} onChange={(x) => set('start', x.target.value)} /></Field>
          <Field label="Ende"><input type="time" value={e.end ?? ''} onChange={(x) => set('end', x.target.value)} /></Field>
          {s.breakMode !== 'firma' && (e.kind === 'arbeit' || e.kind === 'kunde') && <Field label="Pause (min)" hint={s.breakMode === 'gesetzlich' ? `Angerechnet: ${effectiveBreak(e, s)} min` : undefined}>
            <input type="number" min={0} step={5} value={e.breakMin ?? 0} onChange={(x) => set('breakMin', Number(x.target.value))} /></Field>}
          <Field label="Abschnitt"><output>{fmtHours(creditedMinutes({ ...e, breakMin: 0, kind: e.kind === 'kunde' ? 'arbeit' : e.kind }, { ...s, breakMode: 'manuell' }), s)} Std.</output></Field>
          <Field label="Tag gesamt" hint={dayInfo.breakDeducted ? `inkl. Pause ${s.breakMode === 'firma' ? breakLabel({ ...e, kind: 'arbeit', start: '00:00', end: '23:59' }, s).replace('Pause ', '') : dayInfo.breakDeducted + ' min'} abgezogen` : dayInfo.gaps ? `Lücke ${dayInfo.gaps} min = Pause` : undefined}><output>{fmtHours(dayInfo.worked, s)} Std.</output></Field>
        </>}
        {s.fsmMode !== 'aus' && ['arbeit', 'kunde', 'reise'].includes(e.kind) && (() => {
          const options = acts.filter((a) => (a.start.slice(0, 10) <= e.date && (a.end || a.start).slice(0, 10) >= e.date) || a.id === e.fsm?.activityId);
          return <Field label="FSM-Einsatz" wide hint={fromFsm ? 'Zeitbuchung aus FSM – Änderungen gehen beim Abgleich zurück an FSM. Löschen bitte in FSM.' : e.fsm ? 'Wird beim nächsten Abgleich als Zeitbuchung an FSM übertragen.' : options.length ? 'Zuordnen, damit die Zeit an FSM übertragen wird.' : 'Kein FSM-Einsatz an diesem Tag.'}>
            <select value={e.fsm?.activityId ?? ''} onChange={(x) => {
              const a = acts.find((y) => y.id === x.target.value);
              setE((y) => ({ ...y, fsm: a ? { activityId: a.id, code: a.code } : undefined, customer: y.customer || a?.customer }));
            }}>
              {!fromFsm && <option value="">– nicht an FSM übertragen –</option>}
              {options.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.customer || a.subject}</option>)}
            </select></Field>;
        })()}
        <Field label="Kunde / Auftrag"><input value={e.customer ?? ''} onChange={(x) => set('customer', x.target.value)} /></Field>
        <Field label="Notiz" wide><input value={e.note ?? ''} onChange={(x) => set('note', x.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function BalanceEditor({ current, onClose }: { current: number; onClose: () => void }) {
  const [text, setText] = useState(fmtHours(current, { hourFormat: 'dezimal' }).replace('−', '-'));
  const [date, setDate] = useState(todayISO());
  const minutes = parseHours(text);
  async function save() {
    if (minutes === null) return;
    await saveSettings(setBalanceAt(date, minutes));
    onClose();
  }
  return (
    <Modal title="Gleitzeitkonto einstellen" onClose={onClose} footer={<>
      <span className="spacer" />
      <button className="btn" onClick={onClose}>Abbrechen</button>
      <button className="btn primary" disabled={minutes === null} onClick={save}>Speichern</button>
    </>}>
      <div className="form">
        <Field label="GLZ-Saldo (z. B. 150,00 oder 23:15)" hint={minutes === null ? 'Bitte z. B. 150,00, 23:15, -4:30 oder 12,5 eingeben' : `= ${fmtHours(minutes, { hourFormat: 'dezimal' }, true)} Std. (${formatMinutes(minutes, true)})`}>
          <input autoFocus inputMode="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="z. B. 23:15" /></Field>
        <Field label="Stand zu Beginn von" hint="Alle Einträge ab diesem Tag werden dazugerechnet."><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <p className="muted small wide">Tipp: Aus dem SAP-Zeitnachweis den Wert „GLZ-Saldo Gesamt“ zum Stichtag übernehmen (z. B. 31.10.) und als Datum den Tag danach wählen (01.11.).</p>
      </div>
    </Modal>
  );
}
