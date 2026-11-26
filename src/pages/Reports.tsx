import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { navigate, routeParam } from '../App';
import { CopyButton, Empty, Field, Modal, PageHeader, useToast } from '../components';
import { db, useSettings } from '../db';
import { formatDateDE, uid } from '../lib/dates';
import { downloadPptx } from '../lib/pptx';
import { customerHtml, emptyReport, fsmText, missingFields } from '../lib/report';
import { fillTemplate, placeholders } from '../lib/templates';
import type { NumberedItem, ServiceReport } from '../lib/types';

export default function Reports() {
  const param = routeParam();
  const reports = useLiveQuery(() => db.reports.orderBy('updatedAt').reverse().toArray(), []) ?? [];
  const [q, setQ] = useState('');
  if (param) return <ReportEditor param={param} />;
  const list = reports.filter((r) => [r.topic, r.customer, r.site, r.machineNumbers].join(' ').toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHeader title="Serviceberichte" sub="Struktur: General information · Initial situation · Findings · Recommendations · Conclusion"
        actions={<button className="btn primary" onClick={() => navigate('berichte', 'neu')}>+ Neuer Bericht</button>} />
      <input className="search" placeholder="Suchen (Kunde, Maschine, Thema) …" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.length === 0 ? <Empty>Noch keine Berichte. Lege den ersten an – der FSM-Text entsteht automatisch beim Tippen.</Empty> : (
        <div className="cards">
          {list.map((r) => (
            <button key={r.id} className="card item" onClick={() => navigate('berichte', r.id)}>
              <b>{r.topic || 'Ohne Titel'}</b>
              <span>{r.customer || '—'}{r.site ? ` · ${r.site}` : ''}</span>
              <small>{r.machineNumbers} · geändert {formatDateDE(r.updatedAt.slice(0, 10))} · {missingFields(r).length ? `${missingFields(r).length} Angaben fehlen` : 'vollständig'}</small>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function ReportEditor({ param }: { param: string }) {
  const s = useSettings();
  const toast = useToast();
  const [r, setR] = useState<ServiceReport | null>(null);
  const [summary, setSummary] = useState({ problem: '', cause: '', result: '' });
  const [snippetFor, setSnippetFor] = useState<{ list: 'findings' | 'recommendations'; i: number } | null>(null);

  const created = useRef(false);
  useEffect(() => {
    (async () => {
      if (param.startsWith('neu')) {
        if (created.current) return;
        created.current = true;
        const rep = emptyReport(uid(), s.name);
        const evId = new URLSearchParams(param.split('?')[1] ?? '').get('event');
        const ev = evId ? await db.events.get(evId) : undefined;
        if (ev) Object.assign(rep, {
          topic: ev.title, customer: ev.customer ?? '', site: ev.location ?? '', machineNumbers: ev.machine ?? '',
          servicePeriod: ev.startDate === ev.endDate ? formatDateDE(ev.startDate) : `${formatDateDE(ev.startDate)} - ${formatDateDE(ev.endDate)}`,
        });
        await db.reports.add(rep);
        history.replaceState(null, '', `#/berichte/${rep.id}`);
        setR(rep);
      } else setR((await db.reports.get(param)) ?? null);
    })();
  }, [param]); // eslint-disable-line react-hooks/exhaustive-deps

  // Autospeichern (debounced)
  useEffect(() => {
    if (!r) return;
    const t = setTimeout(() => db.reports.put({ ...r, updatedAt: new Date().toISOString() }), 400);
    return () => clearTimeout(t);
  }, [r]);

  const text = useMemo(() => (r ? fsmText(r) : ''), [r]);
  if (!r) return <Empty>Bericht wird geladen …</Empty>;
  const missing = missingFields(r);
  const set = <K extends keyof ServiceReport>(k: K, v: ServiceReport[K]) => setR({ ...r, [k]: v });
  const setItem = (list: 'findings' | 'recommendations', i: number, patch: Partial<NumberedItem>) =>
    set(list, r[list].map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (list: 'findings' | 'recommendations', i: number, d: number) => {
    const a = [...r[list]]; const j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]]; set(list, a);
  };

  function openPdf() {
    const w = window.open('', '_blank');
    if (!w) { toast('Pop-up blockiert – bitte erlauben'); return; }
    w.document.write(customerHtml(r!, { companyName: s.companyName, logoDataUrl: s.logoDataUrl }, summary));
    w.document.close();
    setTimeout(() => w.print(), 500);
  }

  const items = (list: 'findings' | 'recommendations', label: string) => (
    <>
      {r[list].map((x, i) => (
        <div key={i} className="item-edit">
          <div className="item-head">
            <span className="num">{String(i + 1).padStart(2, '0')}</span>
            <input placeholder={`${label} – Titel`} value={x.title} onChange={(e) => setItem(list, i, { title: e.target.value })} />
            <button className="icon" title="Nach oben" onClick={() => move(list, i, -1)}>↑</button>
            <button className="icon" title="Nach unten" onClick={() => move(list, i, 1)}>↓</button>
            <button className="icon" title="Entfernen" onClick={() => set(list, r[list].filter((_, j) => j !== i))}>✕</button>
          </div>
          <textarea rows={3} placeholder="Kurz und sachlich, in Englisch" value={x.text} onChange={(e) => setItem(list, i, { text: e.target.value })} />
          <button className="btn ghost small" onClick={() => setSnippetFor({ list, i })}>❝ Textbaustein einfügen</button>
        </div>
      ))}
      <button className="btn" onClick={() => set(list, [...r[list], { title: '', text: '' }])}>+ {label}</button>
    </>
  );

  return (
    <>
      <PageHeader title={r.topic || 'Neuer Servicebericht'} actions={<>
        <button className="btn ghost" onClick={() => navigate('berichte')}>← Übersicht</button>
        <CopyButton text={text} label="FSM-Text kopieren" />
        <button className="btn" onClick={openPdf}>Kunden-PDF</button>
        <button className="btn" onClick={() => downloadPptx(r, { companyName: s.companyName, logoDataUrl: s.logoDataUrl }).catch((e) => toast('Fehler: ' + e.message))}>PowerPoint</button>
      </>} />

      <div className="split">
        <div className="editor">
          <section className="card">
            <h2>1 · General information</h2>
            <div className="form">
              <Field label="Thema / Titel" wide><input value={r.topic} onChange={(e) => set('topic', e.target.value)} placeholder="e.g. Sealing problems on thermoforming machine" /></Field>
              <Field label="Service period"><input value={r.servicePeriod} onChange={(e) => set('servicePeriod', e.target.value)} placeholder="24.11.2026 - 26.11.2026" /></Field>
              <Field label="Type of assignment"><input list="assign" value={r.assignmentType} onChange={(e) => set('assignmentType', e.target.value)} />
                <datalist id="assign">{['Repair', 'Preventive maintenance', 'Commissioning', 'Installation', 'Training', 'Format change', 'Retrofit', 'Remote support', 'Inspection'].map((x) => <option key={x} value={x} />)}</datalist></Field>
              <Field label="Customer"><input value={r.customer} onChange={(e) => set('customer', e.target.value)} /></Field>
              <Field label="Site"><input value={r.site} onChange={(e) => set('site', e.target.value)} /></Field>
              <Field label="Equipment"><input value={r.equipment} onChange={(e) => set('equipment', e.target.value)} placeholder="e.g. Thermoforming packaging machine" /></Field>
              <Field label="Machine number(s)"><input value={r.machineNumbers} onChange={(e) => set('machineNumbers', e.target.value)} /></Field>
              <Field label="Service technician(s)" wide><input value={r.technicians} onChange={(e) => set('technicians', e.target.value)} /></Field>
            </div>
          </section>
          <section className="card">
            <h2>2 · Initial situation and objective</h2>
            <textarea rows={4} value={r.initialSituation} onChange={(e) => set('initialSituation', e.target.value)} />
          </section>
          <section className="card"><h2>3 · Findings and work carried out</h2>{items('findings', 'Finding')}</section>
          <section className="card"><h2>4 · Recommendations</h2>{items('recommendations', 'Recommendation')}</section>
          <section className="card">
            <h2>5 · Conclusion and open items</h2>
            <textarea rows={3} value={r.conclusion} onChange={(e) => set('conclusion', e.target.value)} placeholder="Key statement" />
            <Field label="Offene Punkte (eine Zeile pro Punkt)" wide>
              <textarea rows={3} value={r.openItems.join('\n')} onChange={(e) => set('openItems', e.target.value.split('\n'))} /></Field>
          </section>
          <details className="card">
            <summary><b>Zusammenfassung für Kunden-PDF (optional)</b></summary>
            <div className="form">
              <Field label="Problem" wide><textarea rows={2} value={summary.problem} onChange={(e) => setSummary({ ...summary, problem: e.target.value })} /></Field>
              <Field label="Cause" wide><textarea rows={2} value={summary.cause} onChange={(e) => setSummary({ ...summary, cause: e.target.value })} /></Field>
              <Field label="Result" wide><textarea rows={2} value={summary.result} onChange={(e) => setSummary({ ...summary, result: e.target.value })} /></Field>
            </div>
          </details>
          <button className="btn danger" onClick={async () => { if (confirm('Bericht wirklich löschen?')) { await db.reports.delete(r.id); navigate('berichte'); } }}>Bericht löschen</button>
        </div>

        <aside className="preview">
          <div className="card sticky">
            <div className="card-head"><h2>FSM-Text (Vorschau)</h2><CopyButton text={text} /></div>
            {missing.length > 0 && <p className="warn">Fehlt noch ([___]): {missing.join(', ')}</p>}
            <pre className="fsm">{text}</pre>
          </div>
        </aside>
      </div>

      {snippetFor && <SnippetPicker onClose={() => setSnippetFor(null)} onPick={(t) => {
        const cur = r[snippetFor.list][snippetFor.i];
        setItem(snippetFor.list, snippetFor.i, { text: cur.text ? cur.text + '\n' + t : t });
        setSnippetFor(null);
      }} />}
    </>
  );
}

function SnippetPicker({ onClose, onPick }: { onClose: () => void; onPick: (t: string) => void }) {
  const snippets = useLiveQuery(() => db.snippets.toArray(), []) ?? [];
  const [sel, setSel] = useState<string | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const sn = snippets.find((x) => x.id === sel);
  return (
    <Modal title="Textbaustein einfügen" onClose={onClose} footer={sn && <><span className="spacer" /><button className="btn primary" onClick={() => onPick(fillTemplate(sn.body, vals))}>Einfügen</button></>}>
      {!sn ? <ul className="list">{snippets.map((x) => <li key={x.id} onClick={() => { setSel(x.id); setVals({}); }}><div><b>{x.title}</b><small>{x.category} · {x.lang.toUpperCase()}</small></div></li>)}</ul> : (
        <div className="form">
          {placeholders(sn.body).map((p) => <Field key={p.name} label={p.name}><input placeholder={p.def} value={vals[p.name] ?? ''} onChange={(e) => setVals({ ...vals, [p.name]: e.target.value })} /></Field>)}
          <pre className="fsm wide">{fillTemplate(sn.body, vals)}</pre>
        </div>
      )}
    </Modal>
  );
}
