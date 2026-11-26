import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Logo } from './brand';
import { Field } from './components';
import { prepareForUser, supabase } from './sync';

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

/** Zeigt die App nur angemeldeten Nutzern. Ohne Server-Konfiguration läuft die App lokal wie bisher. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null);
  const [ready, setReady] = useState(!supabase);

  useEffect(() => {
    if (!supabase) return;
    let prepared = '';
    const handle = async (s: Session | null) => {
      setSession(s);
      if (s && prepared !== s.user.id) {
        prepared = s.user.id;
        setReady(false);
        await prepareForUser(s).catch(() => {});
      }
      setReady(true);
    };
    supabase.auth.getSession().then(({ data }) => handle(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { void handle(s); });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!supabase) return <SessionCtx.Provider value={null}>{children}</SessionCtx.Provider>;
  if (session === undefined || (session && !ready)) return <div className="auth-wrap"><div className="auth-card"><Logo height={34} /><p className="muted">Daten werden geladen …</p></div></div>;
  if (!session) return <Login />;
  return <SessionCtx.Provider value={session}>{children}</SessionCtx.Provider>;
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    const { error } = await supabase!.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(authError(error.message));
    setBusy(false);
  }
  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <Logo height={34} />
        <div>
          <h1>Anmelden</h1>
          <p className="muted">TechDesk · dein persönlicher Bereich</p>
        </div>
        <Field label="E-Mail"><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Passwort"><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <p className="result bad" role="alert">{error}</p>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Anmelden …' : 'Anmelden'}</button>
        <p className="muted small">Zugang nur auf Einladung. Passwort vergessen oder noch kein Zugang? Bitte beim Admin melden.</p>
      </form>
    </div>
  );
}
