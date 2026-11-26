import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { download, Field, Modal, PageHeader } from '../components';
import { db, useSettings } from '../db';
import { addDays, endOfMonth, formatDateDE, formatMinutes, MONTHS, startOfMonth, todayISO, uid, weekdayShort } from '../lib/dates';
import { balanceDate, creditedMinutes, effectiveBreak, grossMinutes, overtimeBalance, summarizeRange, vacationUsed } from '../lib/time';
import { TIME_KINDS, type TimeEntry, type TimeKind } from '../lib/types';

const TIMED: TimeKind[] = ['arbeit', 'reise', 'bereitschaft'];

export default function TimePage() {
  const s = useSettings();
  const [month, setMonth] = useState(startOfMonth(todayISO()));
  const [edit, setEdit] = useState<TimeEntry | null>(null);
  const [onlyFilled, setOnlyFilled] = useState(false);
  const all = useLiveQuery(() => db.times.toArray(), []) ?? [];
  const to = endOfMonth(month);
  const sum = summarizeRange(month, to, all, s);
  const cutoff = balanceDate(todayISO(), all);
  // Saldo nur bis heute (zukünftige Tage sind noch nicht „fehlend“) und erst ab Start des Überstundenkontos
  const saldoFrom = month < s.overtimeStartDate ? s.overtimeStartDate : month;
  const saldoTo = to < cutoff ? to : cutoff;
  const monthDiff = saldoFrom <= saldoTo ? summarizeRange(saldoFrom, saldoTo, all, s).diff : 0;
  const counts = (d: string) => d >= s.overtimeStartDate && d <= cutoff;
  const balanceEnd = overtimeBalance(to < cutoff ? to : cutoff, all, s);
  const year = Number(month.slice(0, 4));
  const vacUsed = vacationUsed(year, all, s);
  const byDate = (d: string) => all.filter((e) => e.date === d).sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''));
  const travel = all.filter((e) => e.kind === 'reise' && e.date >= month && e.date <= to).reduce((a, e) => a + grossMinutes(e.start, e.end) - (e.breakMin ?? 0), 0);

  const shift = (n: number) => {
    const t = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
    setMonth(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`);
  };

  function exportCsv() {
    const rows = [['Datum', 'Tag', 'Art', 'Beginn', 'Ende', 'Pause (min)', 'Angerechnet (h)', 'Kunde', 'Notiz']];
    for (const d of sum.days) for (const e of byDate(d.date))
      rows.push([formatDateDE(e.date), weekdayShort(e.date), TIME_KINDS[e.kind], e.start ?? '', e.end ?? '', String(effectiveBreak(e, s)), (creditedMinutes(e, s) / 60).toFixed(2).replace('.', ','), e.customer ?? '', e.note ?? '']);
    rows.push([], ['Soll', formatMinutes(sum.target)], ['Ist', formatMinutes(sum.actual)], ['Saldo Monat (bis heute)', formatMinutes(monthDiff, true)], ['Überstundenkonto', formatMinutes(balanceEnd, true)]);
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    download(`Zeiten_${month.slice(0, 7)}.csv`, csv, 'text/csv;charset=utf-8');
  }

  const newEntry = (date: string): TimeEntry => ({ id: uid(), date, kind: 'arbeit', start: '07:30', end: '16:30', breakMin: 30 });

  return (
    <>
      <PageHeader title="Zeiterfassung" actions={<>
        <button className="btn" onClick={exportCsv}>Export CSV (Excel)</button>
        <button className="btn primary" onClick={() => setEdit(newEntry(todayISO() >= month && todayISO() <= to ? todayISO() : month))}>+ Eintrag</button>
      </>} />

      <div className="cal-toolbar">
        <button className="btn" onClick={() => shift(-1)} aria-label="Vorheriger Monat">‹</button>
        <h2>{MONTHS[Number(month.slice(5, 7)) - 1]} {year}</h2>
        <button className="btn" onClick={() => shift(1)} aria-label="Nächster Monat">›</button>
        <label className="check"><input type="checkbox" checked={onlyFilled} onChange={(e) => setOnlyFilled(e.target.checked)} /> Nur Tage mit Einträgen</label>
      </div>

      <div className="kpis">
        <div className="kpi"><span>Soll Monat</span><b>{formatMinutes(sum.target)}</b><small>{s.weeklyHours} h/Woche</small></div>
        <div className="kpi"><span>Ist Monat</span><b>{formatMinutes(sum.actual)}</b><small>davon Reise {formatMinutes(travel)}</small></div>
        <div className="kpi"><span>Saldo Monat</span><b className={monthDiff < 0 ? 'neg' : 'pos'}>{formatMinutes(monthDiff, true)}</b><small>Ist − Soll bis heute</small></div>
        <div className="kpi"><span>Überstundenkonto</span><b className={balanceEnd < 0 ? 'neg' : 'pos'}>{formatMinutes(balanceEnd, true)}</b><small>seit {formatDateDE(s.overtimeStartDate)}</small></div>
        <div className="kpi"><span>Urlaub {year}</span><b>{s.vacationDaysPerYear - vacUsed}</b><small>von {s.vacationDaysPerYear} Tagen übrig</small></div>
      </div>

      <div className="card table-card">
        <table className="tt">
          <thead><tr><th>Tag</th><th>Einträge</th><th className="r">Soll</th><th className="r">Ist</th><th className="r">Saldo</th></tr></thead>
          <tbody>
            {sum.days.filter((d) => !onlyFilled || byDate(d.date).length).map((d) => {
              const es = byDate(d.date);
              return (
                <tr key={d.date} className={d.target === 0 ? 'off' : ''}>
                  <td className="day"><b>{weekdayShort(d.date)} {d.date.slice(8)}.</b>{d.holiday && <small>{d.holiday}</small>}</td>
                  <td>
                    {es.map((e) => (
                      <button key={e.id} className="entry" onClick={() => setEdit(e)}>
                        {TIME_KINDS[e.kind]}{e.start ? ` ${e.start}–${e.end ?? '…'}` : ''}{TIMED.includes(e.kind) && e.end ? ` (P ${effectiveBreak(e, s)}′)` : ''}{e.customer ? ` · ${e.customer}` : ''}
                      </button>
                    ))}
                    <button className="entry add" onClick={() => setEdit(newEntry(d.date))} aria-label={`Eintrag am ${formatDateDE(d.date)} hinzufügen`}>+</button>
                    {d.warnings.map((w) => <div key={w} className="warn">⚠ {w}</div>)}
                  </td>
                  <td className="r">{d.target ? formatMinutes(d.target) : '–'}</td>
                  <td className="r">{d.actual ? formatMinutes(d.actual) : '–'}</td>
                  <td className={'r ' + (counts(d.date) ? (d.diff < 0 ? 'neg' : d.diff > 0 ? 'pos' : '') : '')}>{counts(d.date) && (d.diff || d.actual) ? formatMinutes(d.diff, true) : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">Pausen werden {s.autoLegalBreak ? 'automatisch auf das gesetzliche Minimum (ArbZG §4: >6 h → 30 min, >9 h → 45 min) angehoben' : 'wie eingetragen berücksichtigt'}. Reisezeit zählt zu {Math.round(s.travelFactor * 100)} %, Bereitschaft zu {Math.round(s.standbyFactor * 100)} % – anpassbar in den Einstellungen gemäß eurer Betriebsvereinbarung.</p>

      {edit && <EntryEditor entry={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function EntryEditor({ entry, onClose }: { entry: TimeEntry; onClose: () => void }) {
  const s = useSettings();
  const [e, setE] = useState(entry);
  const [until, setUntil] = useState(entry.date);
  const exists = useLiveQuery(() => db.times.get(entry.id), [entry.id]);
  const set = <K extends keyof TimeEntry>(k: K, v: TimeEntry[K]) => setE((x) => ({ ...x, [k]: v }));
  const timed = TIMED.includes(e.kind);
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
      {exists && <button className="btn danger" onClick={async () => { await db.times.delete(e.id); onClose(); }}>Löschen</button>}
      <span className="spacer" />
      <button className="btn" onClick={onClose}>Abbrechen</button>
      <button className="btn primary" onClick={save}>Speichern</button>
    </>}>
      <div className="form">
        <Field label="Art"><select value={e.kind} onChange={(x) => set('kind', x.target.value as TimeKind)}>
          {Object.entries(TIME_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Datum"><input type="date" value={e.date} onChange={(x) => set('date', x.target.value)} /></Field>
        {!timed && !exists && <Field label="Bis (mehrere Tage)"><input type="date" value={until} min={e.date} onChange={(x) => setUntil(x.target.value)} /></Field>}
        {timed && <>
          <Field label="Beginn"><input type="time" value={e.start ?? ''} onChange={(x) => set('start', x.target.value)} /></Field>
          <Field label="Ende"><input type="time" value={e.end ?? ''} onChange={(x) => set('end', x.target.value)} /></Field>
          <Field label="Pause (min)" hint={e.kind === 'arbeit' && s.autoLegalBreak ? `Angerechnet: ${effectiveBreak(e, s)} min` : undefined}>
            <input type="number" min={0} step={5} value={e.breakMin ?? 0} onChange={(x) => set('breakMin', Number(x.target.value))} /></Field>
          <Field label="Angerechnet"><output>{formatMinutes(creditedMinutes(e, s))} h</output></Field>
        </>}
        <Field label="Kunde / Auftrag"><input value={e.customer ?? ''} onChange={(x) => set('customer', x.target.value)} /></Field>
        <Field label="Notiz" wide><input value={e.note ?? ''} onChange={(x) => set('note', x.target.value)} /></Field>
      </div>
    </Modal>
  );
}
