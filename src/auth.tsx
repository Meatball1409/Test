import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Logo } from './brand';
import { CopyButton, download, Field } from './components';
import { getDek, rememberPassword, resetEncryptedData, takePassword, unlockWithPassword, unlockWithRecovery } from './keys';
import { getMeta } from './db';
import { claimDevice, signOut, supabase, syncNow } from './sync';

const SessionCtx = createContext<Session | null>(null);
export const useSession = () => useContext(SessionCtx);

/** Übersetzt Fehlermeldungen des Servers */
export function authError(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return 'E-Mail oder Passwort falsch.';
  if (/email not confirmed/i.test(msg)) return 'Die E-Mail-Adresse ist noch nicht bestätigt.';
  if (/password should be at least|weak password/i.test(msg)) return 'Das Passwort ist zu kurz oder zu einfach (mindestens 10 Zeichen).';
  if (/same.*password|different from the old/i.test(msg)) return 'Das neue Passwort muss sich vom alten unterscheiden.';
  if (/rate limit|too many/i.test(msg)) return 'Zu viele Versuche. Bitte kurz warten.';
  if (/fetch|network/i.test(msg)) return 'Keine Verbindung zum Server. Bitte Internet prüfen.';
  return msg;
}

type Stage =
  | { k: 'loading' } | { k: 'login' } | { k: 'unlock' }
  | { k: 'recover'; pw: string } | { k: 'code'; code: string } | { k: 'ready' };

/**
 * Zeigt die App nur angemeldeten und entsperrten Nutzern.
 * Ohne Server-Konfiguration läuft die App lokal wie bisher.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [stage, setStage] = useState<Stage>(supabase ? { k: 'loading' } : { k: 'ready' });
  const current = useRef('');

  /** Auf neuem Gerät erst die Daten holen, damit nicht kurz eine leere App erscheint */
  async function finish() {
    if (!(await getMeta<boolean>('initialized')) && navigator.onLine) { setStage({ k: 'loading' }); await syncNow(); }
    setStage({ k: 'ready' }); void syncNow();
  }

  async function proceed(s: Session, pw: string | null) {
    if (await getDek()) { await finish(); return; }
    if (!pw) { setStage({ k: 'unlock' }); return; }
    setStage({ k: 'loading' });
    const r = await unlockWithPassword(pw);
    if (!r.ok) { setStage({ k: 'recover', pw }); return; }
    if (r.recoveryCode) { setStage({ k: 'code', code: r.recoveryCode }); return; }
    await finish();
    void s;
  }

  useEffect(() => {
    if (!supabase) return;
    const handle = async (s: Session | null) => {
      setSession(s);
      if (!s) { current.current = ''; setStage({ k: 'login' }); return; }
      if (current.current === s.user.id) return; // z. B. Token-Erneuerung
      current.current = s.user.id;
      setStage({ k: 'loading' });
      try {
        await claimDevice(s);
        await proceed(s, takePassword());
      } catch { setStage({ k: 'unlock' }); }
    };
    supabase.auth.getSession().then(({ data }) => handle(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { void handle(s); });
    return () => sub.subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!supabase) return <SessionCtx.Provider value={null}>{children}</SessionCtx.Provider>;
  switch (stage.k) {
    case 'loading': return <Card><p className="muted">Daten werden geladen und entschlüsselt …</p></Card>;
    case 'login': return <Login />;
    case 'unlock': return <Unlock email={session?.user.email ?? ''} onPassword={(pw) => session && proceed(session, pw)} />;
    case 'recover': return <Recover pw={stage.pw} onDone={() => void finish()} onNewCode={(code) => setStage({ k: 'code', code })} />;
    case 'code': return <ShowCode code={stage.code} onDone={() => void finish()} />;
    case 'ready': return <SessionCtx.Provider value={session}>{children}</SessionCtx.Provider>;
  }
}

function Card({ children, onSubmit }: { children: ReactNode; onSubmit?: (e: React.FormEvent) => void }) {
  return <div className="auth-wrap"><form className="auth-card" onSubmit={(e) => { e.preventDefault(); onSubmit?.(e); }}><Logo height={34} />{children}</form></div>;
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setError('');
    rememberPassword(password);
    const { error } = await supabase!.auth.signInWithPassword({ email: email.trim(), password });
    if (error) { takePassword(); setError(authError(error.message)); }
    setBusy(false);
  }
  return (
    <Card onSubmit={submit}>
      <div><h1>Anmelden</h1><p className="muted">TechDesk · dein persönlicher, verschlüsselter Bereich</p></div>
      <Field label="E-Mail"><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Passwort"><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      {error && <p className="result bad" role="alert">{error}</p>}
      <button className="btn primary block" disabled={busy}>{busy ? 'Anmelden …' : 'Anmelden'}</button>
      <p className="muted small">Zugang nur auf Einladung. Noch kein Zugang oder Passwort vergessen? Bitte beim Admin melden.</p>
    </Card>
  );
}

/** Sitzung besteht, aber auf diesem Gerät fehlt der Schlüssel → Passwort erneut eingeben */
function Unlock({ email, onPassword }: { email: string; onPassword: (pw: string) => void }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setError('');
    const { error } = await supabase!.auth.signInWithPassword({ email, password: pw }); // Passwort prüfen
    setBusy(false);
    if (error) return setError(authError(error.message));
    onPassword(pw);
  }
  return (
    <Card onSubmit={submit}>
      <div><h1>Entsperren</h1><p className="muted">Deine Daten sind verschlüsselt. Bitte Passwort für {email} eingeben.</p></div>
      <Field label="Passwort"><input type="password" autoFocus autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      {error && <p className="result bad" role="alert">{error}</p>}
      <button className="btn primary block" disabled={busy}>{busy ? 'Prüfe …' : 'Entsperren'}</button>
      <button type="button" className="btn ghost block" onClick={() => signOut()}>Abmelden</button>
    </Card>
  );
}

/** Passwort wurde vom Admin zurückgesetzt → Wiederherstellungscode nötig */
function Recover({ pw, onDone, onNewCode }: { pw: string; onDone: () => void; onNewCode: (code: string) => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setError('');
    try {
      if (await unlockWithRecovery(code, pw)) onDone();
      else setError('Der Wiederherstellungscode passt nicht.');
    } catch (e) { setError(authError((e as Error).message)); }
    setBusy(false);
  }
  async function startOver() {
    if (!confirm('Ohne Wiederherstellungscode können deine bisherigen Daten nicht mehr entschlüsselt werden. Sie werden gelöscht und du startest mit einem leeren Bereich. Fortfahren?')) return;
    setBusy(true);
    try { onNewCode(await resetEncryptedData(pw)); } catch (e) { setError(authError((e as Error).message)); setBusy(false); }
  }
  return (
    <Card onSubmit={submit}>
      <div><h1>Wiederherstellungscode</h1><p className="muted">Dein Passwort wurde neu gesetzt. Um deine verschlüsselten Daten zu öffnen, gib bitte deinen Wiederherstellungscode ein.</p></div>
      <Field label="Wiederherstellungscode"><input autoFocus autoComplete="off" spellCheck={false} placeholder="XXXX-XXXX-XXXX-…" value={code} onChange={(e) => setCode(e.target.value)} style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: '.05em' }} /></Field>
      {error && <p className="result bad" role="alert">{error}</p>}
      <button className="btn primary block" disabled={busy || code.length < 10}>Entschlüsseln</button>
      <button type="button" className="btn ghost block" disabled={busy} onClick={startOver}>Ich habe keinen Code – neu beginnen</button>
      <button type="button" className="btn ghost block" onClick={() => signOut()}>Abmelden</button>
    </Card>
  );
}

export function ShowCode({ code, onDone, title = 'Dein Wiederherstellungscode' }: { code: string; onDone: () => void; title?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Card onSubmit={onDone}>
      <div><h1>{title}</h1><p className="muted">Deine Daten sind Ende-zu-Ende verschlüsselt – niemand außer dir kann sie lesen, auch nicht der Admin. Wird dein Passwort einmal zurückgesetzt, brauchst du diesen Code. <b>Ohne ihn sind deine Daten dann verloren.</b></p></div>
      <code className="recovery">{code}</code>
      <div className="row">
        <CopyButton text={code} label="Kopieren" className="btn" />
        <button type="button" className="btn" onClick={() => download('TechDesk-Wiederherstellungscode.txt', `TechDesk Wiederherstellungscode\n\n${code}\n\nSicher aufbewahren (z. B. Passwort-Manager). Nicht weitergeben.\n`)}>Als Datei speichern</button>
      </div>
      <label className="check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> Ich habe den Code sicher aufbewahrt (z. B. im Passwort-Manager).</label>
      <button className="btn primary block" disabled={!ok}>Weiter</button>
    </Card>
  );
}
