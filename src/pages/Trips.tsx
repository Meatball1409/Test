import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { navigate, routeParam } from '../App';
import { CopyButton, download, Empty, eur, Field, PageHeader, useToast } from '../components';
import { db, useSettings } from '../db';
import { formatDateDE, todayISO, uid } from '../lib/dates';
import { DEFAULT_CHECKLIST, EXPENSE_CATEGORIES, tripCosts } from '../lib/travel';
import type { Trip } from '../lib/types';

const TRANSPORT: Record<Trip['transport'], string> = { auto: 'Privat-PKW', firmenwagen: 'Firmenwagen', flug: 'Flug', bahn: 'Bahn' };

export default function Trips() {
  const param = routeParam();
  const trips = useLiveQuery(() => db.trips.orderBy('departure').reverse().toArray(), []) ?? [];
  if (param) return <TripEditor param={param} />;
  const today = todayISO();
  const upcoming = trips.filter((t) => t.return.slice(0, 10) >= today).reverse();
  const past = trips.filter((t) => t.return.slice(0, 10) < today);
  const row = (t: Trip) => (
    <button key={t.id} className="card item" onClick={() => navigate('reisen', t.id)}>
      <b>{t.title || t.destination || 'Reise'}</b>
      <span>{t.customer}{t.destination ? ` · ${t.destination}` : ''}</span>
      <small>{t.departure ? formatDateDE(t.departure.slice(0, 10)) : '?'} – {t.return ? formatDateDE(t.return.slice(0, 10)) : '?'} · {TRANSPORT[t.transport]} · Checkliste {t.checklist.filter((c) => c.done).length}/{t.checklist.length}</small>
    </button>
  );
  return (
    <>
      <PageHeader title="Reiseplanung" actions={<button className="btn primary" onClick={() => navigate('reisen', 'neu')}>+ Neue Reise</button>} />
      {trips.length === 0 && <Empty>Noch keine Reisen. Plane Anreise, Hotel, Packliste und rechne Spesen & Verpflegungspauschalen automatisch.</Empty>}
      {upcoming.length > 0 && <><h2 className="h2">Anstehend</h2><div className="cards">{upcoming.map(row)}</div></>}
      {past.length > 0 && <><h2 className="h2">Vergangen</h2><div className="cards">{past.map(row)}</div></>}
    </>
  );
}

function TripEditor({ param }: { param: string }) {
  const s = useSettings();
  const toast = useToast();
  const [t, setT] = useState<Trip | null>(null);
  const [newItem, setNewItem] = useState('');
  const created = useRef(false);

  useEffect(() => {
    (async () => {
      if (param === 'neu') {
        if (created.current) return;
        created.current = true;
        const d = todayISO();
        const trip: Trip = {
          id: uid(), title: '', customer: '', destination: '', country: 'DE', departure: `${d}T06:00`, return: `${d}T18:00`,
          transport: 'firmenwagen', km: 0, breakfasts: 0, lunches: 0, dinners: 0,
          checklist: DEFAULT_CHECKLIST.map((text) => ({ id: uid(), text, done: false })), expenses: [],
        };
        await db.trips.add(trip);
        history.replaceState(null, '', `#/reisen/${trip.id}`);
        setT(trip);
      } else setT((await db.trips.get(param)) ?? null);
    })();
  }, [param]);

  useEffect(() => {
    if (!t) return;
    const h = setTimeout(() => db.trips.put(t), 400);
    return () => clearTimeout(h);
  }, [t]);

  if (!t) return <Empty>Reise wird geladen …</Empty>;
  const set = <K extends keyof Trip>(k: K, v: Trip[K]) => setT({ ...t, [k]: v });
  const costs = tripCosts(t, s);
  const dest = encodeURIComponent(t.destination);
  const links = t.destination ? [
    ['Route planen', `https://www.google.com/maps/dir/?api=1${s.homeAddress ? `&origin=${encodeURIComponent(s.homeAddress)}` : ''}&destination=${dest}`],
    ['Hotels in der Nähe', `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Hotel ' + t.destination)}`],
    ['Restaurants', `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Restaurant ' + t.destination)}`],
    ['Tankstellen', `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Tankstelle ' + t.destination)}`],
    ['Wetter', `https://www.google.com/search?q=${encodeURIComponent('Wetter ' + t.destination)}`],
    ...(t.country && t.country.toUpperCase() !== 'DE' ? [['Reise- & Sicherheitshinweise (AA)', 'https://www.auswaertiges-amt.de/de/ReiseUndSicherheit/reise-und-sicherheitshinweise']] : []),
    ...(t.transport === 'bahn' ? [['DB Verbindung', 'https://www.bahn.de/']] : []),
  ] : [];

  async function toCalendar() {
    await db.events.put({
      id: 'trip-' + t!.id, tripId: t!.id, type: 'reise', title: t!.title || `Reise ${t!.destination}`,
      startDate: t!.departure.slice(0, 10), endDate: t!.return.slice(0, 10), customer: t!.customer, location: t!.destination,
      notes: [t!.hotel && `Hotel: ${t!.hotel}`, t!.bookingRefs && `Buchungen: ${t!.bookingRefs}`, t!.contactOnSite && `Kontakt: ${t!.contactOnSite}`].filter(Boolean).join('\n'),
    });
    toast('Im Kalender eingetragen');
  }

  const summaryText = [
    `REISEKOSTEN - ${t.title || t.destination}`,
    `Kunde: ${t.customer || '[___]'}`, `Ziel: ${t.destination || '[___]'} (${t.country})`,
    `Zeitraum: ${t.departure.replace('T', ' ')} bis ${t.return.replace('T', ' ')}`,
    `Verkehrsmittel: ${TRANSPORT[t.transport]}${t.transport === 'auto' ? `, ${t.km} km x ${s.kmRate.toFixed(2)} EUR = ${costs.mileage.toFixed(2)} EUR` : ''}`,
    '', 'VERPFLEGUNGSMEHRAUFWAND',
    ...costs.meals.days.map((d) => `- ${formatDateDE(d.date)} ${d.label}: ${d.amount.toFixed(2)} EUR`),
    `- Kürzung gestellte Mahlzeiten: -${costs.meals.deductions.toFixed(2)} EUR`, `Summe: ${costs.meals.net.toFixed(2)} EUR`,
    '', 'BELEGE', ...t.expenses.map((e) => `- ${formatDateDE(e.date)} ${e.category}: ${Number(e.amount).toFixed(2)} EUR${e.note ? ` (${e.note})` : ''}`),
    `Summe Belege: ${costs.expenses.toFixed(2)} EUR`, '', `GESAMT: ${costs.total.toFixed(2)} EUR`,
  ].join('\n');

  function exportCsv() {
    const rows = [['Datum', 'Kategorie', 'Betrag', 'Notiz'], ...t!.expenses.map((e) => [formatDateDE(e.date), e.category, String(e.amount).replace('.', ','), e.note ?? ''])];
    download(`Spesen_${(t!.title || t!.destination || 'Reise').replace(/\W+/g, '_')}.csv`, '﻿' + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
  }

  return (
    <>
      <PageHeader title={t.title || t.destination || 'Neue Reise'} actions={<>
        <button className="btn ghost" onClick={() => navigate('reisen')}>← Übersicht</button>
        <button className="btn" onClick={toCalendar}>In Kalender eintragen</button>
        <CopyButton text={summaryText} label="Abrechnung kopieren" className="btn" />
      </>} />

      <div className="split">
        <div className="editor">
          <section className="card">
            <h2>Reisedaten</h2>
            <div className="form">
              <Field label="Bezeichnung" wide><input value={t.title} onChange={(e) => set('title', e.target.value)} placeholder="z. B. Inbetriebnahme Kunde XY" /></Field>
              <Field label="Kunde"><input value={t.customer} onChange={(e) => set('customer', e.target.value)} /></Field>
              <Field label="Zieladresse"><input value={t.destination} onChange={(e) => set('destination', e.target.value)} placeholder="Straße, PLZ Ort" /></Field>
              <Field label="Land (ISO)"><input value={t.country} maxLength={2} onChange={(e) => set('country', e.target.value.toUpperCase())} /></Field>
              <Field label="Verkehrsmittel"><select value={t.transport} onChange={(e) => set('transport', e.target.value as Trip['transport'])}>
                {Object.entries(TRANSPORT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label="Abfahrt"><input type="datetime-local" value={t.departure} onChange={(e) => set('departure', e.target.value)} /></Field>
              <Field label="Rückkehr"><input type="datetime-local" value={t.return} min={t.departure} onChange={(e) => set('return', e.target.value)} /></Field>
              {t.transport === 'auto' && <Field label="Gefahrene km (gesamt)"><input type="number" min={0} value={t.km} onChange={(e) => set('km', Number(e.target.value))} /></Field>}
              <Field label="Hotel" wide><input value={t.hotel ?? ''} onChange={(e) => set('hotel', e.target.value)} placeholder="Name, Adresse, Tel." /></Field>
              <Field label="Buchungsnummern" wide><input value={t.bookingRefs ?? ''} onChange={(e) => set('bookingRefs', e.target.value)} placeholder="Flug, Hotel, Mietwagen" /></Field>
              <Field label="Ansprechpartner vor Ort" wide><input value={t.contactOnSite ?? ''} onChange={(e) => set('contactOnSite', e.target.value)} /></Field>
              <Field label="Notizen" wide><textarea rows={3} value={t.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
            </div>
            {links.length > 0 && <div className="links">{links.map(([l, u]) => <a key={l} className="btn small" href={u} target="_blank" rel="noreferrer">{l} ↗</a>)}</div>}
          </section>

          <section className="card">
            <div className="card-head"><h2>Packliste</h2><small className="muted">{t.checklist.filter((c) => c.done).length}/{t.checklist.length} erledigt</small></div>
            <ul className="checklist">
              {t.checklist.map((c) => (
                <li key={c.id}>
                  <label><input type="checkbox" checked={c.done} onChange={() => set('checklist', t.checklist.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)))} /> <span className={c.done ? 'done' : ''}>{c.text}</span></label>
                  <button className="icon" aria-label="Entfernen" onClick={() => set('checklist', t.checklist.filter((x) => x.id !== c.id))}>✕</button>
                </li>
              ))}
            </ul>
            <form className="row" onSubmit={(e) => { e.preventDefault(); if (newItem.trim()) { set('checklist', [...t.checklist, { id: uid(), text: newItem.trim(), done: false }]); setNewItem(''); } }}>
              <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Eigener Punkt …" /><button className="btn">+</button>
            </form>
          </section>

          <section className="card">
            <div className="card-head"><h2>Belege / Ausgaben</h2><button className="btn small" onClick={exportCsv}>CSV</button></div>
            {t.expenses.map((x) => (
              <div key={x.id} className="expense">
                <input type="date" value={x.date} onChange={(e) => set('expenses', t.expenses.map((y) => (y.id === x.id ? { ...y, date: e.target.value } : y)))} />
                <select value={x.category} onChange={(e) => set('expenses', t.expenses.map((y) => (y.id === x.id ? { ...y, category: e.target.value } : y)))}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
                <input type="number" step="0.01" min={0} value={x.amount} onChange={(e) => set('expenses', t.expenses.map((y) => (y.id === x.id ? { ...y, amount: Number(e.target.value) } : y)))} aria-label="Betrag" />
                <input value={x.note ?? ''} placeholder="Notiz" onChange={(e) => set('expenses', t.expenses.map((y) => (y.id === x.id ? { ...y, note: e.target.value } : y)))} />
                <button className="icon" aria-label="Entfernen" onClick={() => set('expenses', t.expenses.filter((y) => y.id !== x.id))}>✕</button>
              </div>
            ))}
            <button className="btn" onClick={() => set('expenses', [...t.expenses, { id: uid(), date: t.departure.slice(0, 10), category: 'Hotel', amount: 0 }])}>+ Beleg</button>
          </section>
        </div>

        <aside className="preview">
          <div className="card sticky">
            <h2>Kostenübersicht</h2>
            <div className="form">
              <Field label="Gestellte Frühstücke"><input type="number" min={0} value={t.breakfasts} onChange={(e) => set('breakfasts', Number(e.target.value))} /></Field>
              <Field label="Gestellte Mittagessen"><input type="number" min={0} value={t.lunches} onChange={(e) => set('lunches', Number(e.target.value))} /></Field>
              <Field label="Gestellte Abendessen"><input type="number" min={0} value={t.dinners} onChange={(e) => set('dinners', Number(e.target.value))} /></Field>
              {t.country !== 'DE' && <>
                <Field label="Auslandspauschale 24 h" hint="Länderwert lt. BMF-Tabelle"><input type="number" step="0.5" value={t.mealFullOverride ?? ''} onChange={(e) => set('mealFullOverride', e.target.value === '' ? undefined : Number(e.target.value))} /></Field>
                <Field label="Auslandspauschale An-/Abreise"><input type="number" step="0.5" value={t.mealPartialOverride ?? ''} onChange={(e) => set('mealPartialOverride', e.target.value === '' ? undefined : Number(e.target.value))} /></Field>
              </>}
            </div>
            <table className="sumtable"><tbody>
              {costs.meals.days.map((d) => <tr key={d.date}><td>{formatDateDE(d.date)} <small>{d.label}</small></td><td className="r">{eur(d.amount)}</td></tr>)}
              <tr><td>Kürzung Mahlzeiten</td><td className="r neg">−{eur(costs.meals.deductions)}</td></tr>
              <tr className="sub"><td>Verpflegung</td><td className="r">{eur(costs.meals.net)}</td></tr>
              {t.transport === 'auto' && <tr><td>Kilometer ({t.km} × {s.kmRate.toFixed(2)} €)</td><td className="r">{eur(costs.mileage)}</td></tr>}
              <tr><td>Belege</td><td className="r">{eur(costs.expenses)}</td></tr>
              <tr className="total"><td>Gesamt</td><td className="r">{eur(costs.total)}</td></tr>
            </tbody></table>
            <p className="muted small">Steuerliche Pauschalen (DE): {eur(s.mealFull)} / {eur(s.mealPartial)}. Firmen-Reisekostenrichtlinie hat Vorrang.</p>
          </div>
        </aside>
      </div>
      <button className="btn danger" onClick={async () => { if (confirm('Reise löschen?')) { await db.trips.delete(t.id); await db.events.delete('trip-' + t.id); navigate('reisen'); } }}>Reise löschen</button>
    </>
  );
}
