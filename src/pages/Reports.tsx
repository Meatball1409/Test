import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { navigate, routeParam } from '../App';
import { logoDataUrl, useLogoUrl } from '../brand';
import { CopyButton, Empty, Field, Modal, PageHeader, useToast } from '../components';
import { db, useSettings } from '../db';
import { formatDateDE, todayISO, uid } from '../lib/dates';
import { compressImage, pickImages } from '../lib/images';
import { downloadPptx } from '../lib/pptx';
import { emptyReport, fileName, fsmText, missingFields, reportPages } from '../lib/report';
import { fillTemplate, placeholders } from '../lib/templates';
import type { NumberedItem, ServiceReport } from '../lib/types';
import { printReport, ReportPreview } from './ReportDoc';
import { FsmSendButton } from './FsmParts';
import { cachedActivities } from '../fsmSync';

const ASSIGNMENTS = ['Repair', 'Preventive maintenance', 'Commissioning', 'Installation', 'Training', 'Format change', 'Retrofit', 'Remote support', 'Inspection'];

export const periodText = (a?: string, d?: string) =>
  !a ? '' : !d || d === a ? formatDateDE(a) : `${formatDateDE(a)} - ${formatDateDE(d)}`;

export default function Reports() {
  const param = routeParam();
  const reports = useLiveQuery(() => db.reports.orderBy('updatedAt').reverse().toArray(), []) ?? [];
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(() => param.startsWith('neu'));
  if (param && !param.startsWith('neu')) return <ReportEditor id={param} />;
  const list = reports.filter((r) => [r.topic, r.customer, r.site, r.machineNumbers].join(' ').toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHeader title="Serviceberichte" sub="Neuer Bericht → Kopf mit Kunde, Maschine, Zeitraum → Texte und Fotos ergänzen → als PDF, PowerPoint oder FSM-Text exportieren"
        actions={<button className="btn primary" onClick={() => setCreating(true)}>+ Neuer Bericht</button>} />
      <input className="search" placeholder="Suchen (Kunde, Maschine, Thema) …" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.length === 0 ? <Empty>Noch keine Berichte. Tippe auf „+ Neuer Bericht“.</Empty> : (
        <div className="cards">
          {list.map((r) => (
            <button key={r.id} className="card item" onClick={() => navigate('berichte', r.id)}>
              <b>{r.customer || 'Ohne Kunde'}{r.site ? ` · ${r.site}` : ''}</b>
              <span>{r.topic || r.assignmentType || 'Servicebericht'} · Masch.-Nr. {r.machineNumbers || '—'}</span>
              <small>{r.servicePeriod || '—'} · {r.findings.filter((f) => f.title || f.text || f.photos?.length).length} Feststellungen · {missingFields(r).length ? `${missingFields(r).length} Angaben fehlen` : 'vollständig'}</small>
            </button>
          ))}
        </div>
      )}
      {creating && <HeaderDialog onClose={() => { setCreating(false); if (param) navigate('berichte'); }} onSave={async (r) => { await db.reports.add(r); navigate('berichte', r.id); }} />}
    </>
  );
}

/** Kopfdaten: beim Anlegen und zum Bearbeiten */
function HeaderDialog({ initial, onClose, onSave }: { initial?: ServiceReport; onClose: () => void; onSave: (r: ServiceReport) => void | Promise<void> }) {
  const s = useSettings();
  const [r, setR] = useState<ServiceReport>(() => {
    if (initial) return initial;
    const rep = emptyReport(uid(), s.name);
    rep.arrival = todayISO(); rep.departure = todayISO();
    rep.findings = [];
    return rep;
  });
  // Vorbelegung aus einem Kalender-Einsatz (#/berichte/neu?event=…)
  useEffect(() => {
    if (initial) return;
    const q = new URLSearchParams(routeParam().split('?')[1] ?? '');
    const evId = q.get('event'), fsmId = q.get('fsm') ?? (evId?.startsWith('fsm-') ? evId.slice(4) : null);
    if (fsmId) {
      // Kopf aus dem FSM-Einsatz: Kunde, Standort, Maschine, Zeitraum, Einsatznummer
      void cachedActivities().then((acts) => { const a = acts.find((x) => x.id === fsmId); if (a) setR((x) => ({ ...x, customer: a.customer, site: a.address.split(',').pop()!.trim().replace(/^\d{5}\s*/, ''), machineNumbers: a.equipment.serial, equipment: a.equipment.name, topic: a.subject, arrival: a.start.slice(0, 10), departure: a.end.slice(0, 10), fsm: { activityId: a.id, code: a.code } })); });
    } else if (evId) void db.events.get(evId).then((ev) => ev && setR((x) => ({ ...x, customer: ev.customer ?? '', site: ev.location ?? '', machineNumbers: ev.machine ?? '', topic: ev.title, arrival: ev.startDate, departure: ev.endDate })));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof ServiceReport>(k: K, v: ServiceReport[K]) => setR((x) => ({ ...x, [k]: v }));
  const valid = r.customer.trim() && r.machineNumbers.trim() && r.arrival;
  async function save() {
    if (!valid) return;
    const dep = r.departure && r.departure >= r.arrival! ? r.departure : r.arrival;
    await onSave({ ...r, departure: dep, servicePeriod: periodText(r.arrival, dep), technicians: r.technicians || s.name, updatedAt: new Date().toISOString() });
  }
  return (
    <Modal title={initial ? 'Berichtskopf bearbeiten' : 'Neuer Servicebericht'} onClose={onClose} footer={<>
      <span className="spacer" />
      <button className="btn" onClick={onClose}>Abbrechen</button>
      <button className="btn primary" disabled={!valid} onClick={save}>{initial ? 'Übernehmen' : 'Bericht anlegen'}</button>
    </>}>
      <div className="form">
        <Field label="Kunde *"><input autoFocus value={r.customer} onChange={(e) => set('customer', e.target.value)} placeholder="z. B. Musterfood GmbH" /></Field>
        <Field label="Standort"><input value={r.site} onChange={(e) => set('site', e.target.value)} placeholder="z. B. Kempten" /></Field>
        <Field label="Maschinennummer(n) *"><input value={r.machineNumbers} onChange={(e) => set('machineNumbers', e.target.value)} placeholder="z. B. 123456" /></Field>
        <Field label="Maschine / Anlage"><input value={r.equipment} onChange={(e) => set('equipment', e.target.value)} placeholder="z. B. Thermoforming packaging machine R 245" /></Field>
        <Field label="Anreise / Beginn *"><input type="date" value={r.arrival ?? ''} onChange={(e) => setR((x) => ({ ...x, arrival: e.target.value, departure: !x.departure || x.departure < e.target.value ? e.target.value : x.departure }))} /></Field>
        <Field label="Abreise / Ende"><input type="date" value={r.departure ?? ''} min={r.arrival} onChange={(e) => set('departure', e.target.value)} /></Field>
        <Field label="Einsatzart"><input list="assign" value={r.assignmentType} onChange={(e) => set('assignmentType', e.target.value)} placeholder="z. B. Repair" />
          <datalist id="assign">{ASSIGNMENTS.map((x) => <option key={x} value={x} />)}</datalist></Field>
        <Field label="Servicetechniker"><input value={r.technicians} onChange={(e) => set('technicians', e.target.value)} placeholder={s.name || 'Name'} /></Field>
        <Field label="Thema / Titel (optional)" wide><input value={r.topic} onChange={(e) => set('topic', e.target.value)} placeholder="z. B. Sealing problems on lane 2" /></Field>
        <p className="muted small wide">Daraus entsteht der Berichtskopf mit Logo (Deckblatt). Texte und Fotos fügst du danach hinzu. Pflichtfelder: *</p>
      </div>
    </Modal>
  );
}

function ReportEditor({ id }: { id: string }) {
  const s = useSettings();
  const toast = useToast();
  const logo = useLogoUrl();
  const [r, setR] = useState<ServiceReport | null | undefined>(undefined);
  const [headerOpen, setHeaderOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [tab, setTab] = useState<'doc' | 'fsm'>('doc');
  const [snippetFor, setSnippetFor] = useState<{ list: 'findings' | 'recommendations'; i: number } | null>(null);
  const [busy, setBusy] = useState('');

  useEffect(() => { void db.reports.get(id).then((x) => setR(x ?? null)); }, [id]);
  // Automatisch speichern
  useEffect(() => {
    if (!r) return;
    const t = setTimeout(() => void db.reports.put({ ...r, updatedAt: new Date().toISOString() }), 400);
    return () => clearTimeout(t);
  }, [r]);

  const text = useMemo(() => (r ? fsmText(r) : ''), [r]);
  if (r === undefined) return <Empty>Bericht wird geladen …</Empty>;
  if (r === null) return <Empty>Bericht nicht gefunden. <a href="#/berichte">Zur Übersicht</a></Empty>;
  const missing = missingFields(r);
  const set = <K extends keyof ServiceReport>(k: K, v: ServiceReport[K]) => setR({ ...r, [k]: v });
  const setItem = (list: 'findings' | 'recommendations', i: number, patch: Partial<NumberedItem>) =>
    setR((x) => x && ({ ...x, [list]: x[list].map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  const move = (list: 'findings' | 'recommendations', i: number, d: number) => {
    const a = [...r[list]]; const j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]]; set(list, a);
  };
  const add = (list: 'findings' | 'recommendations', item: NumberedItem = { title: '', text: '' }) => setR((x) => x && ({ ...x, [list]: [...x[list], item] }));

  async function addPhotos(i: number | null) {
    const files = await pickImages();
    if (!files.length) return;
    setBusy('Fotos werden verarbeitet …');
    try {
      const photos = await Promise.all(files.map((f) => compressImage(f)));
      if (i === null) add('findings', { title: '', text: '', photos });
      else setR((x) => x && ({ ...x, findings: x.findings.map((it, j) => (j === i ? { ...it, photos: [...(it.photos ?? []), ...photos] } : it)) }));
    } catch (e) { toast((e as Error).message); }
    setBusy('');
  }

  const branding = { companyName: s.companyName, logoDataUrl: logo };
  const exportPdf = () => printReport(reportPages(r, branding), fileName(r));
  async function exportPptx() {
    setBusy('PowerPoint wird erstellt …');
    try { await downloadPptx(r!, { companyName: s.companyName, logoDataUrl: await logoDataUrl(s.logoDataUrl) }); } catch (e) { toast('Fehler: ' + (e as Error).message); }
    setBusy('');
  }

  const items = (list: 'findings' | 'recommendations', label: string) => r[list].map((x, i) => (
    <div key={i} className="item-edit">
      <div className="item-head">
        <span className="num">{String(i + 1).padStart(2, '0')}</span>
        <input placeholder={`${label} – Titel`} value={x.title} onChange={(e) => setItem(list, i, { title: e.target.value })} />
        <button className="icon" title="Nach oben" onClick={() => move(list, i, -1)}>↑</button>
        <button className="icon" title="Nach unten" onClick={() => move(list, i, 1)}>↓</button>
        <button className="icon" title="Entfernen" onClick={() => { if (!(x.title || x.text || x.photos?.length) || confirm('Diesen Punkt entfernen?')) set(list, r[list].filter((_, j) => j !== i)); }}>✕</button>
      </div>
      <textarea rows={3} placeholder="Kurz und sachlich, in Englisch" value={x.text} onChange={(e) => setItem(list, i, { text: e.target.value })} />
      {list === 'findings' && (x.photos?.length ?? 0) > 0 && (
        <div className="thumbs">
          {x.photos!.map((p, k) => (
            <div key={k} className="thumb">
              <img src={p} alt={`Foto ${k + 1}`} />
              <button className="icon" aria-label="Foto entfernen" onClick={() => setItem(list, i, { photos: x.photos!.filter((_, m) => m !== k) })}>✕</button>
              {k > 0 && <button className="icon left" aria-label="Als Hauptfoto" title="Als Hauptfoto" onClick={() => { const ph = [...x.photos!]; [ph[0], ph[k]] = [ph[k], ph[0]]; setItem(list, i, { photos: ph }); }}>★</button>}
            </div>
          ))}
        </div>
      )}
      <div className="row">
        {list === 'findings' && <button className="btn small" onClick={() => addPhotos(i)}>📷 Foto</button>}
        <button className="btn ghost small" onClick={() => setSnippetFor({ list, i })}>❝ Textbaustein</button>
      </div>
    </div>
  ));

  return (
    <>
      <PageHeader title={r.customer || 'Servicebericht'} sub={[r.site, r.machineNumbers && `Masch.-Nr. ${r.machineNumbers}`, r.servicePeriod].filter(Boolean).join(' · ')} actions={<>
        <button className="btn ghost" onClick={() => navigate('berichte')}>← Übersicht</button>
        <button className="btn mobile-only" onClick={() => setPreview(true)}>Vorschau</button>
        <button className="btn primary" onClick={exportPdf}>PDF</button>
        <button className="btn" onClick={exportPptx}>PowerPoint</button>
        <CopyButton text={text} label="FSM-Text kopieren" className="btn" />
        <FsmSendButton r={r} text={text} onSent={(x) => setR(x)} />
      </>} />
      {r.fsm && <p className="muted small" style={{ marginTop: '-.6rem' }}>Verknüpft mit FSM-Einsatz <b>{r.fsm.code}</b>{r.fsm.sentAt ? ` · gesendet am ${new Date(r.fsm.sentAt).toLocaleString('de-DE')}` : ''}</p>}
      {busy && <p className="result warn">{busy}</p>}

      <div className="split">
        <div className="editor">
          <section className="card head-card">
            <div className="head-mini" onClick={() => setHeaderOpen(true)} role="button" aria-label="Berichtskopf bearbeiten"><ReportPreview report={r} pages={1} maxWidth={150} /></div>
            <div>
              <h2>Berichtskopf</h2>
              <dl className="rows">
                <dt>Kunde</dt><dd>{r.customer || '—'}</dd>
                <dt>Standort</dt><dd>{r.site || '—'}</dd>
                <dt>Maschine</dt><dd>{r.machineNumbers || '—'}</dd>
                <dt>Zeitraum</dt><dd>{r.servicePeriod || '—'}</dd>
                <dt>Techniker</dt><dd>{r.technicians || '—'}</dd>
              </dl>
              <button className="btn small" style={{ marginTop: '.6rem' }} onClick={() => setHeaderOpen(true)}>✎ Kopf bearbeiten</button>
            </div>
          </section>

          <section className="card">
            <h2>Initial situation and objective</h2>
            <textarea rows={3} value={r.initialSituation} onChange={(e) => set('initialSituation', e.target.value)} placeholder="Was hat der Kunde gemeldet, was ist das Ziel des Einsatzes?" />
          </section>

          <section className="card">
            <h2>Findings and work carried out</h2>
            {r.findings.length === 0 && <p className="muted">Noch keine Feststellungen. Füge Text oder Fotos hinzu.</p>}
            {items('findings', 'Finding')}
            <div className="row add-bar">
              <button className="btn" onClick={() => add('findings')}>+ Text</button>
              <button className="btn" onClick={() => addPhotos(null)}>📷 + Foto</button>
            </div>
          </section>

          <section className="card">
            <h2>Recommendations</h2>
            {items('recommendations', 'Recommendation')}
            <button className="btn" onClick={() => add('recommendations')}>+ Empfehlung</button>
          </section>

          <section className="card">
            <h2>Conclusion and open items</h2>
            <textarea rows={3} value={r.conclusion} onChange={(e) => set('conclusion', e.target.value)} placeholder="Kernaussage zum Abschluss" />
            <Field label="Offene Punkte (eine Zeile pro Punkt)" wide>
              <textarea rows={3} value={r.openItems.join('\n')} onChange={(e) => set('openItems', e.target.value.split('\n'))} /></Field>
          </section>

          <details className="card">
            <summary><b>Zusammenfassung für die PDF (optional)</b></summary>
            <div className="form">
              {(['problem', 'cause', 'result'] as const).map((k) => (
                <Field key={k} label={{ problem: 'Problem', cause: 'Cause', result: 'Result' }[k]} wide>
                  <textarea rows={2} value={r.summary?.[k] ?? ''} onChange={(e) => set('summary', { problem: '', cause: '', result: '', ...r.summary, [k]: e.target.value })} /></Field>
              ))}
            </div>
          </details>
          <button className="btn danger" onClick={async () => { if (confirm('Bericht wirklich löschen?')) { await db.reports.delete(r.id); navigate('berichte'); } }}>Bericht löschen</button>
        </div>

        <aside className="preview desktop-only">
          <div className="card sticky">
            <div className="tabs">
              <button className={tab === 'doc' ? 'pill on' : 'pill'} onClick={() => setTab('doc')}>Dokument</button>
              <button className={tab === 'fsm' ? 'pill on' : 'pill'} onClick={() => setTab('fsm')}>FSM-Text</button>
            </div>
            {tab === 'doc' ? <ReportPreview report={r} /> : <>
              {missing.length > 0 && <p className="warn">Fehlt noch ([___]): {missing.join(', ')}</p>}
              <pre className="fsm">{text}</pre>
              <CopyButton text={text} />
            </>}
          </div>
        </aside>
      </div>

      {headerOpen && <HeaderDialog initial={r} onClose={() => setHeaderOpen(false)} onSave={(x) => { setR(x); setHeaderOpen(false); }} />}
      {preview && (
        <Modal title="Vorschau" onClose={() => setPreview(false)} footer={<><span className="spacer" /><button className="btn" onClick={exportPptx}>PowerPoint</button><button className="btn primary" onClick={exportPdf}>PDF</button></>}>
          <ReportPreview report={r} />
        </Modal>
      )}
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
