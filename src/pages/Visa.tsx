import { useMemo, useState } from 'react';
import { PageHeader } from '../components';
import { aaUrl, ALL, allowance, CAT_LABEL, checkLink, EMBASSY, fallbackHint, keyOf, onSite, RW, search, splitDomain, TRW, type VisaEntry } from '../lib/visa';

const FILTERS = [
  ['all', 'Alle'], ['eta', 'ETA / ESTA'], ['evisa', 'e-Visum'], ['card', 'Einreiseformular'], ['free', 'Kostenlos'], ['vf', 'Ohne Antrag'], ['fav', 'Meine Ziele'],
] as const;

const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privat/blockiert */ } };

export default function Visa() {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<string>(() => load('vk-filter', 'all'));
  const [favs, setFavs] = useState<Set<string>>(() => new Set(load<string[]>('vk-favs', [])));
  const [link, setLink] = useState('');
  const [checked, setChecked] = useState<ReturnType<typeof checkLink>>();

  const list = useMemo(() => search(q, filter, favs), [q, filter, favs]);
  const toggleFav = (d: VisaEntry) => {
    const n = new Set(favs); const k = keyOf(d);
    n.has(k) ? n.delete(k) : n.add(k);
    setFavs(n); save('vk-favs', [...n]);
  };
  const seen = new Set<string>();
  const hint = list.length === 0 ? fallbackHint(q) : undefined;

  return (
    <>
      <PageHeader title="Visa-Kompass" sub="Deutscher Reisepass · Einreise, Steckdose, Sicherheit und Spesen pro Land (Stand 10.11.2026)" />

      <div className="visa-search">
        <input className="search" type="search" placeholder="Land suchen, z. B. USA, Bali, Kenia" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Land suchen" />
        <div className="pills scroll">
          {FILTERS.map(([id, label]) => (
            <button key={id} className={filter === id ? 'pill on' : 'pill'} onClick={() => { setFilter(id); save('vk-filter', id); }}>
              {label}{id === 'fav' && favs.size ? ` (${favs.size})` : ''}
            </button>
          ))}
        </div>
        <small className="muted">{list.length ? `${list.length} ${list.length === 1 ? 'Eintrag' : 'Einträge'} von ${ALL.length}` : ''}</small>
      </div>

      {list.length === 0 ? (
        <div className="empty">
          {filter === 'fav' && !q ? <><b>Noch keine Ziele gemerkt.</b> Tippe bei einem Land auf den Stern.</>
            : hint?.kind === 'warning' ? <><b>{hint.country}: Reise- oder Teilreisewarnung.</b> Bitte zuerst die <a href={aaUrl(hint.country)} target="_blank" rel="noreferrer">Hinweise des Auswärtigen Amts</a> lesen.</>
            : hint?.kind === 'embassy' ? <><b>{hint.country}: Visum über die Botschaft.</b> Kein Online-Portal für Touristen – Antrag bei Botschaft oder Konsulat.</>
            : hint?.kind === 'visafree' ? <><b>{hint.country}: visumfrei.</b> Für einen Kurzaufenthalt vorab nichts beantragen. Pass (teils Personalausweis) und <a href="https://www.auswaertiges-amt.de/de/reiseundsicherheit" target="_blank" rel="noreferrer">Auswärtiges Amt</a> prüfen.</>
            : <><b>Kein Treffer.</b> Sicher geht es über das <a href="https://www.auswaertiges-amt.de/de/reiseundsicherheit" target="_blank" rel="noreferrer">Auswärtige Amt</a> → Land → „Einreise und Zoll“.</>}
        </div>
      ) : (
        <div className="cards visa-grid">
          {list.map((d) => { const first = !seen.has(d.c); seen.add(d.c); return <VisaCard key={keyOf(d)} d={d} showInfo={first} fav={favs.has(keyOf(d))} onFav={() => toggleFav(d)} />; })}
        </div>
      )}

      <section className="card" style={{ marginTop: '1.2rem' }}>
        <h2>Link prüfen</h2>
        <p className="muted">Link aus Google oder einer E-Mail einfügen. Er wird mit den offiziellen Portalen verglichen.</p>
        <form className="row" style={{ marginTop: '.7rem' }} onSubmit={(e) => { e.preventDefault(); setChecked(checkLink(link)); }}>
          <input style={{ flex: '1 1 240px' }} inputMode="url" placeholder="z. B. https://esta-usa-online.com/apply" value={link} onChange={(e) => setLink(e.target.value)} aria-label="Link zum Prüfen" />
          <button className="btn primary">Prüfen</button>
        </form>
        {checked && <div className={`result ${checked.tone}`} role="status"><b>{checked.title}</b> {checked.host && <code>{checked.host}</code>} {checked.text}</div>}
      </section>

      <details className="card" open>
        <summary><b>5 Regeln gegen Abzock-Seiten</b></summary>
        <ol className="rules">
          <li>Bei Google nie auf Treffer mit <b>„Anzeige“</b> oder <b>„Gesponsert“</b> klicken – dort stehen fast immer Vermittler.</li>
          <li>Auf die Endung achten: offiziell meist <code>.gov</code>, <code>.gov.uk</code>, <code>canada.ca</code>, <code>.go.ke</code>, <code>.gov.in</code>, <code>.govt.nz</code>. Namen wie <code>esta-usa-online.com</code> sind nicht offiziell.</li>
          <li>Preis vergleichen: Vermittler verlangen oft das 2- bis 10-fache (z. B. 80–150 USD für ESTA statt 40,27 USD).</li>
          <li>Einreiseformulare wie TDAC (Thailand) oder MDAC (Malaysia) sind immer kostenlos.</li>
          <li>Im Zweifel über das <a href="https://www.auswaertiges-amt.de/de/reiseundsicherheit" target="_blank" rel="noreferrer">Auswärtige Amt</a> einsteigen: Land → „Einreise und Zoll“.</li>
        </ol>
      </details>

      <details className="card">
        <summary><b>Botschaftsvisum und Reisewarnungen</b></summary>
        <div className="info">
          <p><b>Visum nur über die Botschaft:</b> {EMBASSY.join(', ')}.</p>
          <p><b>Reisewarnung:</b> {RW.map((n, i) => <span key={n}>{i ? ', ' : ''}<a href={aaUrl(n)} target="_blank" rel="noreferrer">{n}</a></span>)}.</p>
          <p><b>Teilreisewarnung:</b> {TRW.map((n, i) => <span key={n}>{i ? ', ' : ''}<a href={aaUrl(n)} target="_blank" rel="noreferrer">{n}</a></span>)}.</p>
          <p>Die Lage ändert sich schnell. Vor jeder Reise das <a href="https://www.auswaertiges-amt.de/de/reiseundsicherheit" target="_blank" rel="noreferrer">Auswärtige Amt</a> lesen und in die Krisenvorsorgeliste <a href="https://krisenvorsorgeliste.diplo.de" target="_blank" rel="noreferrer">ELEFAND</a> eintragen.</p>
        </div>
      </details>

      <details className="card">
        <summary><b>Stecker, Spannung und Spesen – so liest du es</b></summary>
        <div className="info">
          <p><b>Deutschland:</b> Typ C und F, 230 V. Steckdosen vom Typ C, E und F passen ohne Adapter.</p>
          <p><span className="tag ok">Nicht nötig</span> alle Steckdosen passen · <span className="tag warn">Empfohlen</span> teils passend · <span className="tag bad">Nötig</span> ohne Adapter geht nichts.</p>
          <p><b>100–127 V</b> (USA, Kanada, Japan, Mexiko …): Ladegeräte mit „100–240 V“ funktionieren. Föhn, Lötkolben oder reine 230-V-Geräte brauchen einen Spannungswandler.</p>
          <p><b>Spesen:</b> Verpflegungspauschalen ab 01.01.2026 laut BMF-Schreiben vom 05.12.2025. Gestelltes Frühstück −20 %, Mittag-/Abendessen je −40 % des 24-Std.-Satzes. Maßgeblich ist der Ort, den du vor 24 Uhr Ortszeit zuletzt erreichst. Die Firmenregelung kann abweichen.</p>
          <p><b>Tipp für Werkzeug:</b> Weltreiseadapter mit USB-C plus kleine deutsche Mehrfachsteckdose.</p>
        </div>
      </details>

      <p className="muted small">Genehmigungen hängen am Reisepass: neuer Pass, neuer Antrag. USA und Kanada verlangen ESTA bzw. eTA auch beim Umsteigen. Quellen: offizielle Regierungsportale, Auswärtiges Amt, BMF, IEC World Plugs. Angaben ohne Gewähr; maßgeblich ist die offizielle Seite.</p>
    </>
  );
}

export function VisaCard({ d, showInfo = true, fav, onFav, compact }: { d: VisaEntry; showInfo?: boolean; fav?: boolean; onFav?: () => void; compact?: boolean }) {
  const site = showInfo ? onSite(d.c) : undefined;
  const sp = showInfo && !compact ? allowance(d.c) : undefined;
  const [rest, tld] = d.url ? splitDomain(d.url) : ['auswaertiges-amt.', 'de'];
  return (
    <article className="card visa">
      <div className="card-head">
        <h3>{d.c}</h3>
        {onFav && <button className="icon star" aria-pressed={!!fav} aria-label={fav ? 'Aus Meine Ziele entfernen' : 'Zu Meine Ziele hinzufügen'} onClick={onFav}>{fav ? '★' : '☆'}</button>}
      </div>
      <div className="sec">
        <span className="sec-h">Einreise</span>
        <div className="pills">
          <span className="tag info">{CAT_LABEL[d.cat]}</span>
          <span className={'tag ' + (d.cat === 'vf' ? 'ok' : 'info')}>{d.what}</span>
          {d.free && <span className="tag ok">Kostenlos</span>}
          {d.warn && <span className="tag warn">Hinweise AA beachten</span>}
        </div>
        <dl className="rows"><dt>{d.cat === 'vf' ? 'Dokument' : 'Offizielle Gebühr'}</dt><dd>{d.fee}</dd></dl>
        {d.note && <p className="note">{d.note}</p>}
      </div>
      {site && (
        <div className="sec">
          <span className="sec-h">Vor Ort</span>
          <dl className="rows">
            <dt>Steckdose</dt><dd>Typ {site.plugs}</dd>
            <dt>Spannung</dt><dd>{site.voltage} V{site.lowVoltage ? ' · nur 100–240-V-Geräte' : ''}</dd>
            <dt>Adapter</dt><dd><span className={'tag ' + site.adapter.tone}>{site.adapter.text}</span></dd>
            <dt>Sicherheit</dt><dd><a className={'tag ' + site.safety.tone} href={aaUrl(d.c)} target="_blank" rel="noreferrer">{site.safety.text} ↗</a></dd>
          </dl>
          {site.note && <p className="note">{site.note}</p>}
        </div>
      )}
      {sp && (
        <div className="sec">
          <span className="sec-h">Spesen 2026 (BMF){sp.cities.length ? ' · Rest des Landes' : ''}</span>
          <dl className="rows"><dt>&gt; 8 Std. / An- & Abreise</dt><dd>{sp.partial} €</dd><dt>24 Std.</dt><dd>{sp.full} €</dd></dl>
          {sp.cities.length > 0 && <p className="note">Abweichend (8 / 24 Std.): {sp.cities.map((c) => `${c.name} ${c.partial} / ${c.full} €`).join(' · ')}</p>}
          {sp.hint && <p className="note">Pauschale {sp.hint}.</p>}
        </div>
      )}
      <a className="portal" href={d.url ?? aaUrl(d.c)} target="_blank" rel="noreferrer">
        <span className="domain">{rest}<b>{tld}</b></span><span className="go">{d.url ? 'Öffnen ↗' : 'Reisehinweise ↗'}</span>
      </a>
    </article>
  );
}
