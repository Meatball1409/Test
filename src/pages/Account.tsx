import { useEffect, useState } from 'react';
import { authError, useSession } from '../auth';
import { CopyButton, Field, useToast } from '../components';
import { renewRecoveryCode, rewrapForPassword } from '../keys';
import { getSyncState, onSyncState, pendingChanges, signOut, supabase, syncNow, type SyncState } from '../sync';

const STATUS: Record<SyncState['status'], string> = { idle: 'Abgeglichen', syncing: 'Wird abgeglichen …', offline: 'Offline – wird nachgeholt', error: 'Fehler beim Abgleich' };

export default function AccountSection() {
  const session = useSession();
  const toast = useToast();
  const [sync, setSync] = useState(getSyncState());
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [newCode, setNewCode] = useState('');
  useEffect(() => onSyncState(setSync), []);
  if (!supabase || !session) return null;

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 10) return toast('Mindestens 10 Zeichen');
    if (pw !== pw2) return toast('Passwörter stimmen nicht überein');
    setBusy(true);
    const { error } = await supabase!.auth.updateUser({ password: pw });
    if (error) { setBusy(false); return toast(authError(error.message)); }
    try { await rewrapForPassword(pw); } catch (e) { setBusy(false); return toast('Passwort geändert, Schlüssel aber nicht aktualisiert: ' + authError((e as Error).message) + '. Bitte erneut versuchen.'); }
    setBusy(false);
    setPw(''); setPw2('');
    toast('Passwort geändert');
  }

  async function logout() {
    await syncNow();
    const open = await pendingChanges();
    if (open > 0 && !confirm(`${open} Änderung(en) konnten noch nicht hochgeladen werden (offline?). Beim Abmelden gehen sie verloren. Trotzdem abmelden?`)) return;
    await signOut();
  }

  return (
    <section className="card">
      <h2>Mein Konto</h2>
      <dl className="rows" style={{ marginBottom: '.8rem' }}>
        <dt>Angemeldet als</dt><dd>{session.user.email}</dd>
        <dt>Daten</dt><dd><span className={'sync-dot ' + sync.status} />{STATUS[sync.status]}</dd>
        {sync.lastSync && <><dt>Zuletzt</dt><dd>{new Date(sync.lastSync).toLocaleString('de-DE')}</dd></>}
      </dl>
      {sync.error && <p className="result bad">{authError(sync.error)}</p>}
      <p className="muted small">🔒 <b>Ende-zu-Ende verschlüsselt:</b> Deine Daten werden auf dem Gerät verschlüsselt, bevor sie auf den Server (EU) gehen. Nur du kannst sie lesen – auch der Admin nicht. Sie werden zwischen deinen Geräten abgeglichen.</p>
      <div className="row wrap">
        <button className="btn" onClick={() => syncNow()}>Jetzt abgleichen</button>
        <button className="btn danger" onClick={logout}>Abmelden</button>
      </div>
      <div className="row wrap">
        <button className="btn" onClick={async () => { if (confirm('Neuen Wiederherstellungscode erzeugen? Der alte Code wird ungültig.')) { try { setNewCode(await renewRecoveryCode()); } catch (e) { toast(authError((e as Error).message)); } } }}>Neuen Wiederherstellungscode</button>
      </div>
      {newCode && <div style={{ marginTop: '.8rem' }}><code className="recovery">{newCode}</code><p className="muted small">Jetzt sicher aufbewahren – er wird nur einmal angezeigt.</p><CopyButton text={newCode} className="btn small" /></div>}
      <form className="form" style={{ marginTop: '1rem' }} onSubmit={changePassword}>
        <Field label="Neues Passwort" hint="Mindestens 10 Zeichen"><input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <Field label="Wiederholen"><input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
        <div className="wide"><button className="btn" disabled={busy || !pw}>Passwort ändern</button></div>
      </form>
    </section>
  );
}
