import { useLiveQuery } from 'dexie-react-hooks';
import { Fragment, useState } from 'react';
import { navigate, routeParam } from '../App';
import { download, Field, Modal, PageHeader, pickFile, useToast } from '../components';
import { db, useSettings } from '../db';
import { addDays, formatDateDE, isoWeek, MONTHS, startOfMonth, todayISO, uid, weekday } from '../lib/dates';
import { halfDayName, holidayName, holidays, STATES } from '../lib/holidays';
import { vacationSummary } from '../lib/time';
import { fmtDays } from './Time';
import { fromIcs, toIcs } from '../lib/ics';
import { EVENT_TYPES, type CalendarEvent, type EventType } from '../lib/types';

export default function CalendarPage() {
  const s = useSettings();
  const toast = useToast();
  const p = routeParam();
  const [selected, setSelected] = useState(/^\d{4}-\d{2}-\d{2}$/.test(p) ? p : todayISO());
  const [month, setMonth] = useState(startOfMonth(selected));
  const [edit, setEdit] = useState<CalendarEvent | null>(null);
  const [filter, setFilter] = useState<EventType | ''>('');

  const year = Number(month.slice(0, 4));
  const vacEvents = useLiveQuery(() => db.events.where('type').equals('urlaub').toArray(), []) ?? [];
  const times = useLiveQuery(() => db.times.where('kind').equals('urlaub').toArray(), []) ?? [];
  const vac = vacationSummary(year, times, vacEvents, s, todayISO());
  const yearHolidays = [...holidays(year, s.state).entries()].sort();
  const gridStart = addDays(month, -((weekday(month) + 6) % 7));
  const gridEnd = addDays(gridStart, 41);
  const events = useLiveQuery(() => db.events.where('startDate').belowOrEqual(gridEnd).filter((e) => e.endDate >= gridStart).toArray(), [gridStart, gridEnd]) ?? [];
  const shown = filter ? events.filter((e) => e.type === filter) : events;
  const on = (d: string) => shown.filter((e) => e.startDate <= d && e.endDate >= d).sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));

  const shift = (n: number) => {
    const total = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
    setMonth(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`);
  };
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const weekdayLong = (d: string) => ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'][weekday(d)];
  const newEvent = (date: string): CalendarEvent => ({ id: uid(), title: '', type: 'einsatz', startDate: date, endDate: date });

  async function importIcs() {
    const f = await pickFile('.ics,text/calendar');
    if (!f) return;
    const evs = fromIcs(await f.text(), uid);
    await db.events.bulkAdd(evs);
    toast(`${evs.length} Termine importiert`);
  }
  async function exportIcs() {
    const all = await db.events.toArray();
    download('techdesk-kalender.ics', toIcs(all), 'text/calendar;charset=utf-8');
  }

  return (
    <>
      <PageHeader title="Kalender" actions={<>
        <button className="btn" onClick={importIcs}>Import .ics</button>
        <button className="btn" onClick={exportIcs}>Export .ics</button>
        <button className="btn primary" onClick={() => setEdit(newEvent(selected))}>+ Termin</button>
      </>} />

      <section className="card vac">
        <div className="vac-main">
          <span className="eyebrow-dark">Urlaub {year}</span>
          <b className={vac.remaining < 0 ? 'neg' : ''}>{fmtDays(vac.remaining)}</b>
          <small>Tage übrig</small>
        </div>
        <div className="vac-bar" aria-hidden>
          <i className="t" style={{ width: `${Math.min(100, (vac.taken / vac.entitlement) * 100)}%` }} />
          <i className="p" style={{ width: `${Math.min(100, (vac.planned / vac.entitlement) * 100)}%` }} />
          <i className="h" style={{ width: `${Math.min(100, (vac.halfTotal / vac.entitlement) * 100)}%` }} />
        </div>
        <dl className="vac-rows">
          <div><dt>Anspruch</dt><dd>{fmtDays(vac.entitlement)}</dd></div>
          <div><dt><i className="dot t" />Genommen</dt><dd>{fmtDays(vac.taken)}</dd></div>
          <div><dt><i className="dot p" />Geplant</dt><dd>{fmtDays(vac.planned)}</dd></div>
          <div><dt><i className="dot h" />24.12. + 31.12.</dt><dd>{fmtDays(vac.halfTotal)}</dd></div>
        </dl>
        <button className="btn small" onClick={() => setEdit({ ...newEvent(selected), type: 'urlaub', title: 'Urlaub' })}>+ Urlaub eintragen</button>
      </section>

      <div className="cal-toolbar">
        <button className="btn" onClick={() => shift(-1)} aria-label="Vorheriger Monat">‹</button>
        <h2>{MONTHS[m - 1]} {y}</h2>
        <button className="btn" onClick={() => shift(1)} aria-label="Nächster Monat">›</button>
        <button className="btn ghost" onClick={() => { setMonth(startOfMonth(todayISO())); setSelected(todayISO()); }}>Heute</button>
        <select value={filter} onChange={(e) => setFilter(e.target.value as EventType | '')} aria-label="Filter">
          <option value="">Alle Typen</option>
          {Object.entries(EVENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      <div className="cal">
        <div className="cal-wk" />
        {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => <div key={d} className="cal-dow">{d}</div>)}
        {days.map((d, i) => {
          const hol = holidayName(d, s.state);
          const evs = on(d);
          return (
            <Fragment key={d}>
              {i % 7 === 0 && <div className="cal-wk">{isoWeek(d)}</div>}
              <button className={['cal-day', d.slice(0, 7) !== month.slice(0, 7) && 'out', d === todayISO() && 'today', d === selected && 'sel', (hol || weekday(d) === 0 || weekday(d) === 6) && 'off', hol && 'holiday'].filter(Boolean).join(' ')}
                onClick={() => setSelected(d)} onDoubleClick={() => setEdit(newEvent(d))}>
                <span className="num">{Number(d.slice(8))}</span>
                {hol && <span className="hol">{hol}</span>}
                {!hol && halfDayName(d) && <span className="hol half">{halfDayName(d)}</span>}
                {evs.slice(0, 3).map((e) => <span key={e.id} className="chip" style={{ background: EVENT_TYPES[e.type].color }}>{e.title}</span>)}
                {evs.length > 3 && <span className="more">+{evs.length - 3}</span>}
                {evs.length > 0 && <span className="dots">{evs.slice(0, 4).map((e) => <i key={e.id} style={{ background: EVENT_TYPES[e.type].color }} />)}</span>}
              </button>
            </Fragment>
          );
        })}
      </div>

      <section className="card">
        <div className="card-head"><h2>{formatDateDE(selected)}{holidayName(selected, s.state) ? ` · ${holidayName(selected, s.state)} (arbeitsfrei)` : halfDayName(selected) ? ` · ${halfDayName(selected)}` : ''}</h2>
          <button className="btn" onClick={() => setEdit(newEvent(selected))}>+ Termin</button></div>
        {on(selected).length === 0 ? <p className="muted">Keine Termine. Doppelklick auf einen Tag legt einen Termin an.</p> : (
          <ul className="list">{on(selected).map((e) => (
            <li key={e.id} onClick={() => setEdit(e)}>
              <span className="dot" style={{ background: EVENT_TYPES[e.type].color }} />
              <div><b>{e.title}</b><small>{EVENT_TYPES[e.type].label}{e.startTime ? ` · ${e.startTime}–${e.endTime ?? ''}` : ' · ganztägig'}{e.customer ? ` · ${e.customer}` : ''}{e.location ? ` · ${e.location}` : ''}</small></div>
            </li>))}</ul>
        )}
        <p className="legend">{Object.values(EVENT_TYPES).map((t) => <span key={t.label}><i style={{ background: t.color }} />{t.label}</span>)}</p>
      </section>

      <details className="card">
        <summary><b>Feiertage {year} · {STATES[s.state]}</b> <span className="muted small">({yearHolidays.length} arbeitsfreie Tage{vac.halfDays.length ? ' + 2 halbe' : ''})</span></summary>
        <ul className="list hol-list">
          {yearHolidays.map(([d, n]) => (
            <li key={d} onClick={() => { setMonth(startOfMonth(d)); setSelected(d); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
              <span className="dot" style={{ background: 'var(--neg)' }} />
              <div><b>{n}</b><small>{weekdayLong(d)}, {formatDateDE(d)}{weekday(d) === 0 || weekday(d) === 6 ? ' · fällt aufs Wochenende' : ''}</small></div>
            </li>
          ))}
          {[`${year}-12-24`, `${year}-12-31`].map((d) => (
            <li key={d} onClick={() => { setMonth(startOfMonth(d)); setSelected(d); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
              <span className="dot" style={{ background: 'var(--warn)' }} />
              <div><b>{halfDayName(d)}</b><small>{weekdayLong(d)}, {formatDateDE(d)} · {vac.halfDays.some((h) => h.date === d) ? '½ Urlaubstag wird automatisch abgezogen' : 'kein Arbeitstag – kein Abzug'}</small></div>
            </li>
          ))}
        </ul>
        {s.state === 'BY' && <p className="muted small">Mariä Himmelfahrt (15.08.) gilt in Gemeinden mit überwiegend katholischer Bevölkerung – das ist der Großteil Bayerns. Das Augsburger Friedensfest (08.08.) gilt nur im Stadtgebiet Augsburg und ist nicht eingetragen.</p>}
      </details>

      {edit && <EventEditor ev={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function EventEditor({ ev, onClose }: { ev: CalendarEvent; onClose: () => void }) {
  const [e, setE] = useState(ev);
  const [allDay, setAllDay] = useState(!ev.startTime);
  const set = <K extends keyof CalendarEvent>(k: K, v: CalendarEvent[K]) => setE((x) => ({ ...x, [k]: v }));
  const exists = useLiveQuery(() => db.events.get(ev.id), [ev.id]);
  async function save() {
    const out = { ...e, title: e.title.trim() || EVENT_TYPES[e.type].label, endDate: e.endDate < e.startDate ? e.startDate : e.endDate };
    if (allDay) { delete out.startTime; delete out.endTime; }
    await db.events.put(out);
    onClose();
  }
  async function remove() { await db.events.delete(e.id); onClose(); }
  async function toReport() {
    await save();
    navigate('berichte', 'neu?event=' + e.id);
  }
  return (
    <Modal title={exists ? 'Termin bearbeiten' : 'Neuer Termin'} onClose={onClose} footer={<>
      {exists && <button className="btn danger" onClick={remove}>Löschen</button>}
      {e.type === 'einsatz' && <button className="btn" onClick={toReport}>→ Bericht anlegen</button>}
      <span className="spacer" />
      <button className="btn" onClick={onClose}>Abbrechen</button>
      <button className="btn primary" onClick={save}>Speichern</button>
    </>}>
      <div className="form">
        <Field label="Titel" wide><input autoFocus value={e.title} onChange={(x) => set('title', x.target.value)} placeholder="z. B. Wartung Tiefziehmaschine" /></Field>
        <Field label="Typ"><select value={e.type} onChange={(x) => set('type', x.target.value as EventType)}>
          {Object.entries(EVENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
        <Field label="Ganztägig"><input type="checkbox" checked={allDay} onChange={(x) => { setAllDay(x.target.checked); if (!x.target.checked && !e.startTime) setE((y) => ({ ...y, startTime: '08:00', endTime: '16:30' })); }} /></Field>
        <Field label="Von"><input type="date" value={e.startDate} onChange={(x) => set('startDate', x.target.value)} /></Field>
        <Field label="Bis"><input type="date" value={e.endDate} min={e.startDate} onChange={(x) => set('endDate', x.target.value)} /></Field>
        {!allDay && <>
          <Field label="Beginn"><input type="time" value={e.startTime ?? ''} onChange={(x) => set('startTime', x.target.value)} /></Field>
          <Field label="Ende"><input type="time" value={e.endTime ?? ''} onChange={(x) => set('endTime', x.target.value)} /></Field>
        </>}
        <Field label="Kunde"><input value={e.customer ?? ''} onChange={(x) => set('customer', x.target.value)} /></Field>
        <Field label="Maschine / Nr."><input value={e.machine ?? ''} onChange={(x) => set('machine', x.target.value)} /></Field>
        <Field label="Ort / Adresse" wide><input value={e.location ?? ''} onChange={(x) => set('location', x.target.value)} />
          {e.location && <a className="link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.location)}`} target="_blank" rel="noreferrer">In Karten öffnen ↗</a>}</Field>
        <Field label="Notizen" wide><textarea rows={3} value={e.notes ?? ''} onChange={(x) => set('notes', x.target.value)} /></Field>
      </div>
    </Modal>
  );
}
