import { useLiveQuery } from 'dexie-react-hooks';
import { navigate } from '../App';
import { useToast } from '../components';
import { db, useSettings } from '../db';
import { addDays, formatDateDE, formatMinutes, isoWeek, pad, todayISO, weekday, weekdayShort } from '../lib/dates';
import { holidayName } from '../lib/holidays';
import { overtimeBalance, summarizeRange } from '../lib/time';
import { EVENT_TYPES, TIME_KINDS } from '../lib/types';
import { uid } from '../lib/dates';

const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export default function Home() {
  const s = useSettings();
  const toast = useToast();
  const today = todayISO();
  const monday = addDays(today, -((weekday(today) + 6) % 7));
  const in14 = addDays(today, 14);
  const events = useLiveQuery(() => db.events.where('endDate').aboveOrEqual(today).filter((e) => e.startDate <= in14).sortBy('startDate'), [today]) ?? [];
  const times = useLiveQuery(() => db.times.toArray(), []) ?? [];
  const trips = useLiveQuery(() => db.trips.where('departure').aboveOrEqual(today).limit(3).toArray(), [today]) ?? [];
  const reports = useLiveQuery(() => db.reports.orderBy('updatedAt').reverse().limit(3).toArray(), []) ?? [];

  const week = summarizeRange(monday, addDays(monday, 6), times, s);
  const balance = overtimeBalance(today, times, s);
  const running = times.find((t) => t.date === today && t.kind === 'arbeit' && t.start && !t.end);
  const todays = times.filter((t) => t.date === today);
  const holiday = holidayName(today, s.state);

  async function stamp() {
    if (running) {
      await db.times.update(running.id, { end: nowHM() });
      toast('Arbeitsende gestempelt');
    } else {
      await db.times.add({ id: uid(), date: today, kind: 'arbeit', start: nowHM(), breakMin: 0 });
      toast('Arbeitsbeginn gestempelt');
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Hallo{s.name ? `, ${s.name.split(' ')[0]}` : ''}</h1>
          <p className="muted">{weekdayShort(today)}, {formatDateDE(today)} · KW {isoWeek(today)}{holiday ? ` · ${holiday}` : ''}</p>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi"><span>Diese Woche</span><b>{formatMinutes(week.actual)}</b><small>Soll {formatMinutes(week.target)}</small></div>
        <div className="kpi"><span>Überstunden-Konto</span><b className={balance < 0 ? 'neg' : 'pos'}>{formatMinutes(balance, true)}</b><small>Stand heute</small></div>
        <button className={'kpi stamp' + (running ? ' running' : '')} onClick={stamp}>
          <span>{running ? `Läuft seit ${running.start}` : 'Stempeluhr'}</span>
          <b>{running ? 'Stopp' : 'Start'}</b>
          <small>{todays.length ? todays.map((t) => `${TIME_KINDS[t.kind]} ${t.start ?? ''}–${t.end ?? ''}`).join(', ') : 'Heute noch nichts erfasst'}</small>
        </button>
      </div>

      <div className="grid2">
        <section className="card">
          <div className="card-head"><h2>Nächste 14 Tage</h2><button className="btn ghost" onClick={() => navigate('kalender')}>Kalender →</button></div>
          {events.length === 0 ? <p className="muted">Keine Termine.</p> : (
            <ul className="list">
              {events.map((e) => (
                <li key={e.id} onClick={() => navigate('kalender', e.startDate)}>
                  <span className="dot" style={{ background: EVENT_TYPES[e.type].color }} />
                  <div><b>{e.title}</b><small>{formatDateDE(e.startDate)}{e.endDate !== e.startDate ? ` – ${formatDateDE(e.endDate)}` : ''}{e.startTime ? ` · ${e.startTime}` : ''}{e.location ? ` · ${e.location}` : ''}</small></div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <div className="card-head"><h2>Schnellzugriff</h2></div>
          <div className="quick">
            <button className="btn" onClick={() => navigate('berichte', 'neu')}>+ Servicebericht</button>
            <button className="btn" onClick={() => navigate('texte')}>FSM-Text kopieren</button>
            <button className="btn" onClick={() => navigate('reisen', 'neu')}>+ Reise planen</button>
            <button className="btn" onClick={() => navigate('zeit')}>Zeit nachtragen</button>
          </div>
          {trips.length > 0 && <><h3>Anstehende Reisen</h3><ul className="list">
            {trips.map((t) => <li key={t.id} onClick={() => navigate('reisen', t.id)}><span className="dot" style={{ background: EVENT_TYPES.reise.color }} /><div><b>{t.title || t.destination}</b><small>{formatDateDE(t.departure.slice(0, 10))} · {t.destination}</small></div></li>)}
          </ul></>}
          {reports.length > 0 && <><h3>Zuletzt bearbeitete Berichte</h3><ul className="list">
            {reports.map((r) => <li key={r.id} onClick={() => navigate('berichte', r.id)}><span className="dot" style={{ background: EVENT_TYPES.einsatz.color }} /><div><b>{r.topic || 'Ohne Titel'}</b><small>{r.customer} {r.site}</small></div></li>)}
          </ul></>}
        </section>
      </div>
    </>
  );
}
