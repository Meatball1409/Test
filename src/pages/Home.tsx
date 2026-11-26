import { useLiveQuery } from 'dexie-react-hooks';
import { navigate } from '../App';
import { useToast } from '../components';
import { Icon } from '../icons';
import { db, useSettings } from '../db';
import { addDays, formatDateDE, formatMinutes, isoWeek, pad, todayISO, weekday, weekdayShort } from '../lib/dates';
import { holidayName } from '../lib/holidays';
import { balanceDate, overtimeBalance, summarizeRange } from '../lib/time';
import { EVENT_TYPES, TIME_KINDS } from '../lib/types';
import { uid } from '../lib/dates';

const greeting = () => { const h = new Date().getHours(); return h < 11 ? 'Guten Morgen' : h < 18 ? 'Hallo' : 'Guten Abend'; };
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
  const balance = overtimeBalance(balanceDate(today, times), times, s);
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
      <section className="hero">
        <div className="hero-text">
          <span className="eyebrow">{weekdayShort(today)}, {formatDateDE(today)} · KW {isoWeek(today)}{holiday ? ` · ${holiday}` : ''}</span>
          <h1>{greeting()}{s.name ? `, ${s.name.split(' ')[0]}` : ''}</h1>
          <p>{events.filter((e) => e.startDate <= today).length ? `Heute: ${events.filter((e) => e.startDate <= today).map((e) => e.title).join(', ')}` : 'Heute keine Termine eingetragen.'}</p>
        </div>
        <button className={'stamp' + (running ? ' running' : '')} onClick={stamp} aria-label={running ? 'Arbeitsende stempeln' : 'Arbeitsbeginn stempeln'}>
          <span className="stamp-ico"><Icon name={running ? 'stop' : 'play'} size={22} /></span>
          <span className="stamp-txt"><b>{running ? 'Arbeitsende' : 'Arbeitsbeginn'}</b>
            <small>{running ? `läuft seit ${running.start}` : todays.length ? todays.map((t) => `${TIME_KINDS[t.kind]} ${t.start ?? ''}–${t.end ?? ''}`).join(', ') : 'jetzt stempeln'}</small></span>
        </button>
      </section>

      <div className="kpis">
        <div className="kpi"><span className="kpi-ico"><Icon name="clock" /></span><span>Diese Woche</span><b>{formatMinutes(week.actual)}</b>
          <div className="bar"><i style={{ width: `${Math.min(100, week.target ? (week.actual / week.target) * 100 : 0)}%` }} /></div><small>von {formatMinutes(week.target)} Soll</small></div>
        <div className="kpi"><span className="kpi-ico"><Icon name="trend" /></span><span>Überstunden</span><b className={balance < 0 ? 'neg' : 'pos'}>{formatMinutes(balance, true)}</b><small>Kontostand heute</small></div>
        <div className="kpi"><span className="kpi-ico"><Icon name="calendar" /></span><span>Termine</span><b>{events.length}</b><small>in den nächsten 14 Tagen</small></div>
        <div className="kpi"><span className="kpi-ico"><Icon name="plane" /></span><span>Reisen</span><b>{trips.length}</b><small>anstehend</small></div>
      </div>

      <div className="grid2">
        <section className="card">
          <div className="card-head"><h2>Nächste 14 Tage</h2><button className="btn ghost" onClick={() => navigate('kalender')}>Kalender <Icon name="arrow" size={16} /></button></div>
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
            <button className="tile" onClick={() => navigate('berichte', 'neu')}><Icon name="report" size={22} /><b>Servicebericht</b><small>neu anlegen</small></button>
            <button className="tile" onClick={() => navigate('texte')}><Icon name="copy" size={22} /><b>FSM-Text</b><small>kopieren & einfügen</small></button>
            <button className="tile" onClick={() => navigate('reisen', 'neu')}><Icon name="plane" size={22} /><b>Reise</b><small>planen</small></button>
            <button className="tile" onClick={() => navigate('zeit')}><Icon name="clock" size={22} /><b>Zeit</b><small>nachtragen</small></button>
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
