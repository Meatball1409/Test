import { useLiveQuery } from 'dexie-react-hooks';
import { Fragment, useState } from 'react';
import { navigate, routeParam } from '../App';
import { download, Field, Modal, PageHeader, pickFile, useToast } from '../components';
import { db, saveSettings, useSettings } from '../db';
import { addDays, formatDateDE, isoWeek, MONTHS, startOfMonth, todayISO, uid, weekday } from '../lib/dates';
import { halfDayName, holidayName, holidays, STATES } from '../lib/holidays';
import { vacationSummary } from '../lib/time';
import { fmtDays } from './Time';
import { FsmSyncButton } from './FsmParts';
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
  const prev = vacationSummary(year - 1, times, vacEvents, s, todayISO());
  const prevHasData = prev.days.length > 0 || prev.carryOver > 0;
  const [carryOpen, setCarryOpen] = useState(false);
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
        <FsmSyncButton label="FSM abgleichen" />
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
          <div><dt>Anspruch</dt><dd>{fmtDays(vac.annual)}</dd></div>
          <div><dt>Übertrag {year - 1}</dt><dd>{vac.carryOver ? '+' + fmtDays(vac.carryOver) : '0'} <button className="icon edit" aria-label={`Resturlaub aus ${year - 1} bearbeiten`} onClick={() => setCarryOpen(true)}>✎</button></dd></div>
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
              <div><b>{e.id.startsWith('fsm-') && <span className="sap-tag fsm">FSM</span>}{e.title}</b><small>{e.fsm?.code ? `${e.fsm.code} · ` : ''}{EVENT_TYPES[e.type].label}{e.startTime ? ` · ${e.startTime}–${e.endTime ?? ''}` : ' · ganztägig'}{e.customer ? ` · ${e.customer}` : ''}{e.location ? ` · ${e.location}` : ''}</small></div>
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
      {carryOpen && <CarryOverEditor year={year} current={vac.carryOver} suggestion={prevHasData ? Math.max(0, prev.remaining) : null}
        onSave={(v) => { void saveSettings({ vacationCarryOver: { ...s.vacationCarryOver, [String(year)]: v } }); setCarryOpen(false); }} onClose={() => setCarryOpen(false)} />}
    </>
  );
}

function EventEditor({ ev, onClose }: { ev: CalendarEvent; onClose: () => void }) {
  const fromFsm = ev.id.startsWith('fsm-');
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
      {exists && !fromFsm && <button className="btn danger" onClick={remove}>Löschen</button>}
      {e.type === 'einsatz' && <button className="btn" onClick={toReport}>→ Bericht anlegen</button>}
      <span className="spacer" />
      <button className="btn" onClick={onClose}>Abbrechen</button>
      <button className="btn primary" onClick={save}>Speichern</button>
    </>}>
      {fromFsm && <p className="fsm-note"><span className="sap-tag fsm">FSM</span> Einsatz {e.fsm?.code}{e.fsm?.serviceCall ? ` · Serviceauftrag ${e.fsm.serviceCall}` : ''}{e.fsm?.equipment ? ` · ${e.fsm.equipment}` : ''}<br /><small>Titel und Notizen gehen beim Abgleich an FSM. Termin, Kunde und Ort plant die Disposition in FSM; abgeschlossen wird der Auftrag in FSM.</small></p>}
      <div className="form">
        <Field label="Titel" wide><input autoFocus value={e.title} onChange={(x) => set('title', x.target.value)} placeholder="z. B. Wartung Tiefziehmaschine" /></Field>
        <Field label="Typ"><select disabled={fromFsm} value={e.type} onChange={(x) => set('type', x.target.value as EventType)}>
          {Object.entries(EVENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
        <Field label="Ganztägig"><input disabled={fromFsm} type="checkbox" checked={allDay} onChange={(x) => { setAllDay(x.target.checked); if (!x.target.checked && !e.startTime) setE((y) => ({ ...y, startTime: '08:00', endTime: '16:30' })); }} /></Field>
        <Field label="Von"><input disabled={fromFsm} type="date" value={e.startDate} onChange={(x) => set('startDate', x.target.value)} /></Field>
        <Field label="Bis"><input disabled={fromFsm} type="date" value={e.endDate} min={e.startDate} onChange={(x) => set('endDate', x.target.value)} /></Field>
        {!allDay && <>
          <Field label="Beginn"><input disabled={fromFsm} type="time" value={e.startTime ?? ''} onChange={(x) => set('startTime', x.target.value)} /></Field>
          <Field label="Ende"><input disabled={fromFsm} type="time" value={e.endTime ?? ''} onChange={(x) => set('endTime', x.target.value)} /></Field>
        </>}
        <Field label="Kunde"><input disabled={fromFsm} value={e.customer ?? ''} onChange={(x) => set('customer', x.target.value)} /></Field>
        <Field label="Maschine / Nr."><input disabled={fromFsm} value={e.machine ?? ''} onChange={(x) => set('machine', x.target.value)} /></Field>
        <Field label="Ort / Adresse" wide><input disabled={fromFsm} value={e.location ?? ''} onChange={(x) => set('location', x.target.value)} />
          {e.location && <a className="link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.location)}`} target="_blank" rel="noreferrer">In Karten öffnen ↗</a>}</Field>
        <Field label="Notizen" wide><textarea rows={3} value={e.notes ?? ''} onChange={(x) => set('notes', x.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function CarryOverEditor({ year, current, suggestion, onSave, onClose }: { year: number; current: number; suggestion: number | null; onSave: (v: number) => void; onClose: () => void }) {
  const [val, setVal] = useState(String(current).replace('.', ','));
  const n = Number(val.replace(',', '.'));
  const valid = val.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 100 && Math.round(n * 2) === n * 2;
  return (
    <Modal title={`Resturlaub aus ${year - 1}`} onClose={onClose} footer={<>
      <span className="spacer" />
      <button className="btn" onClick={onClose}>Abbrechen</button>
      <button className="btn primary" disabled={!valid} onClick={() => onSave(n)}>Speichern</button>
    </>}>
      <div className="form">
        <Field label={`Übertragene Tage in ${year}`} hint={valid ? 'In halben Tagen, z. B. 4,5' : 'Bitte 0 bis 100 in halben Tagen eingeben, z. B. 4,5'}>
          <input autoFocus inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} /></Field>
        {suggestion !== null && (
          <div className="wide">
            <button className="btn" onClick={() => setVal(String(suggestion).replace('.', ','))}>Rest aus {year - 1} übernehmen: {fmtDays(suggestion)} Tage</button>
            <p className="muted small">Berechnet aus den in TechDesk eingetragenen Urlaubstagen von {year - 1}. Maßgeblich ist der Stand eurer Personalabteilung.</p>
          </div>
        )}
        <p className="muted small wide">Hinweis: Übertragener Urlaub verfällt je nach Firmenregelung (gesetzlich meist zum 31.03.). Am besten den Wert aus der Lohnabrechnung oder dem Personalportal übernehmen.</p>
      </div>
    </Modal>
  );
}
