import { useEffect, useState } from 'react';
import { authError, useSession } from '../auth';
import { Field, useToast } from '../components';
import { getSyncState, onSyncState, pendingChanges, signOut, supabase, syncNow, type SyncState } from '../sync';

const STATUS: Record<SyncState['status'], string> = { idle: 'Abgeglichen', syncing: 'Wird abgeglichen …', offline: 'Offline – wird nachgeholt', error: 'Fehler beim Abgleich' };

export default function AccountSection() {
  const session = useSession();
  const toast = useToast();
  const [sync, setSync] = useState(getSyncState());
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => onSyncState(setSync), []);
  if (!supabase || !session) return null;

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 10) return toast('Mindestens 10 Zeichen');
    if (pw !== pw2) return toast('Passwörter stimmen nicht überein');
    setBusy(true);
    const { error } = await supabase!.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return toast(authError(error.message));
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
      <p className="muted small">Deine Daten liegen in deinem persönlichen, geschützten Bereich auf dem Server (EU) und werden zwischen deinen Geräten abgeglichen. Niemand sonst kann sie sehen.</p>
      <div className="row wrap">
        <button className="btn" onClick={() => syncNow()}>Jetzt abgleichen</button>
        <button className="btn danger" onClick={logout}>Abmelden</button>
      </div>
      <form className="form" style={{ marginTop: '1rem' }} onSubmit={changePassword}>
        <Field label="Neues Passwort" hint="Mindestens 10 Zeichen"><input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <Field label="Wiederholen"><input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
        <div className="wide"><button className="btn" disabled={busy || !pw}>Passwort ändern</button></div>
      </form>
    </section>
  );
}
