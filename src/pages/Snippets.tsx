import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { CopyButton, download, Empty, Field, Modal, PageHeader, pickFile, useToast } from '../components';
import { db, exportSnippets, importAll } from '../db';
import { uid } from '../lib/dates';
import { fillTemplate, placeholders, toPlainText } from '../lib/templates';
import type { Snippet } from '../lib/types';

export default function Snippets() {
  const toast = useToast();
  const snippets = useLiveQuery(() => db.snippets.toArray(), []) ?? [];
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [edit, setEdit] = useState<Snippet | null>(null);

  const cats = [...new Set(snippets.map((s) => s.category))].sort();
  const list = snippets
    .filter((s) => (!cat || s.category === cat) && (s.title + s.body).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite) || a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
  const sn = snippets.find((s) => s.id === active);
  const out = sn ? toPlainText(fillTemplate(sn.body, vals)) : '';

  async function importShared() {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    try { await importAll(await f.text(), 'merge'); toast('Vorlagen importiert'); } catch (e) { toast((e as Error).message); }
  }

  return (
    <>
      <PageHeader title="FSM-Textbausteine" sub="Vorlage wählen → Platzhalter ausfüllen → kopieren → im FSM einfügen"
        actions={<>
          <button className="btn" onClick={importShared}>Import</button>
          <button className="btn" onClick={async () => download('techdesk-vorlagen.json', await exportSnippets(), 'application/json')}>Mit Kollegen teilen</button>
          <button className="btn primary" onClick={() => setEdit({ id: uid(), title: '', category: cat || 'Allgemein', lang: 'en', body: '' })}>+ Vorlage</button>
        </>} />

      <div className="split">
        <div>
          <div className="filters">
            <input className="search" placeholder="Suchen …" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="pills">
              <button className={!cat ? 'pill on' : 'pill'} onClick={() => setCat('')}>Alle</button>
              {cats.map((c) => <button key={c} className={cat === c ? 'pill on' : 'pill'} onClick={() => setCat(c)}>{c}</button>)}
            </div>
          </div>
          {list.length === 0 ? <Empty>Keine Vorlagen gefunden.</Empty> : (
            <ul className="list big">
              {list.map((s) => (
                <li key={s.id} className={s.id === active ? 'sel' : ''} onClick={() => { setActive(s.id); setVals({}); }}>
                  <button className="icon star" aria-label="Favorit" onClick={(e) => { e.stopPropagation(); db.snippets.update(s.id, { favorite: !s.favorite }); }}>{s.favorite ? '★' : '☆'}</button>
                  <div><b>{s.title}</b><small>{s.category} · {s.lang.toUpperCase()} · {placeholders(s.body).length} Platzhalter</small></div>
                  <CopyButton className="btn small" label="Kopieren" text={toPlainText(fillTemplate(s.body, {}))} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <aside className="preview">
          {sn ? (
            <div className="card sticky">
              <div className="card-head"><h2>{sn.title}</h2><button className="btn ghost" onClick={() => setEdit(sn)}>Bearbeiten</button></div>
              <div className="form">
                {placeholders(sn.body).map((p) => (
                  <Field key={p.name} label={p.name}><input placeholder={p.def || ''} value={vals[p.name] ?? ''} onChange={(e) => setVals({ ...vals, [p.name]: e.target.value })} /></Field>
                ))}
              </div>
              <pre className="fsm">{out}</pre>
              <div className="row"><CopyButton text={out} label="Text kopieren" /><button className="btn ghost" onClick={() => setVals({})}>Zurücksetzen</button></div>
            </div>
          ) : <Empty>Wähle links eine Vorlage. Platzhalter schreibst du als {'{{Name}}'} oder {'{{Name|Standardwert}}'}.</Empty>}
        </aside>
      </div>

      {edit && <SnippetEditor sn={edit} cats={cats} onClose={() => setEdit(null)} onSaved={(id) => setActive(id)} />}
    </>
  );
}

function SnippetEditor({ sn, cats, onClose, onSaved }: { sn: Snippet; cats: string[]; onClose: () => void; onSaved: (id: string) => void }) {
  const [s, setS] = useState(sn);
  const exists = useLiveQuery(() => db.snippets.get(sn.id), [sn.id]);
  return (
    <Modal title={exists ? 'Vorlage bearbeiten' : 'Neue Vorlage'} onClose={onClose} footer={<>
      {exists && <button className="btn danger" onClick={async () => { await db.snippets.delete(s.id); onClose(); }}>Löschen</button>}
      <span className="spacer" />
      <button className="btn" onClick={onClose}>Abbrechen</button>
      <button className="btn primary" onClick={async () => { await db.snippets.put({ ...s, title: s.title || 'Neue Vorlage' }); onSaved(s.id); onClose(); }}>Speichern</button>
    </>}>
      <div className="form">
        <Field label="Titel"><input autoFocus value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} /></Field>
        <Field label="Kategorie"><input list="cats" value={s.category} onChange={(e) => setS({ ...s, category: e.target.value })} /><datalist id="cats">{cats.map((c) => <option key={c} value={c} />)}</datalist></Field>
        <Field label="Sprache"><select value={s.lang} onChange={(e) => setS({ ...s, lang: e.target.value as 'de' | 'en' })}><option value="en">Englisch</option><option value="de">Deutsch</option></select></Field>
        <Field label="Text" wide hint="Platzhalter: {{Kunde}}, {{Menge|1}} (mit Standardwert). Kein Markdown – das FSM zeigt nur reinen Text.">
          <textarea rows={10} value={s.body} onChange={(e) => setS({ ...s, body: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
