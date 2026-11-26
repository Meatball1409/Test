/**
 * Verbindung zum TechDesk-Server (Supabase).
 *
 * Hier stehen nur die ÖFFENTLICHEN Werte (Project URL + „anon“/„publishable“ Key).
 * Sie sind dafür gedacht, in der App zu stehen; die Sicherheit kommt aus der
 * Anmeldung und den Zugriffsregeln (Row Level Security) auf dem Server.
 * Den „service_role“/„secret“ Key NIEMALS hier eintragen.
 *
 * Alternativ per Build-Variable: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
 */
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const cloudEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
