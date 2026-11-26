-- TechDesk: Datenbank-Schema für Supabase
-- Einmal im Supabase-Dashboard unter „SQL Editor“ einfügen und „Run“ drücken.
--
-- Sicherheitsprinzip:
-- 1. Ende-zu-Ende-Verschlüsselung: Die App verschlüsselt jeden Datensatz auf dem Gerät.
--    Hier liegt nur Geheimtext ({v, iv, ct}). Ohne das Passwort des Nutzers kann
--    niemand die Inhalte lesen – auch nicht der Projekt-Admin.
-- 2. Row Level Security (RLS): Jeder Nutzer kann nur seine eigenen Zeilen lesen,
--    anlegen, ändern und löschen.

create table if not exists public.records (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  tbl        text        not null check (tbl in ('events', 'times', 'snippets', 'reports', 'trips', 'settings')),
  id         text        not null check (char_length(id) between 1 and 200),
  data       jsonb       check (data is null or (data ? 'ct' and data ? 'iv')), -- nur verschlüsselte Daten
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, tbl, id)
);

create index if not exists records_user_updated on public.records (user_id, updated_at);

-- Zeitstempel immer vom Server setzen (Grundlage für den Abgleich zwischen Geräten)
create or replace function public.records_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
  for each row execute function public.records_touch();

-- Zugriff nur für angemeldete Nutzer, nur auf eigene Zeilen
alter table public.records enable row level security;
alter table public.records force row level security;
revoke all on public.records from anon;
grant select, insert, update, delete on public.records to authenticated;

drop policy if exists "eigene Zeilen lesen" on public.records;
drop policy if exists "eigene Zeilen anlegen" on public.records;
drop policy if exists "eigene Zeilen ändern" on public.records;
drop policy if exists "eigene Zeilen löschen" on public.records;

create policy "eigene Zeilen lesen"   on public.records for select to authenticated using (user_id = (select auth.uid()));
create policy "eigene Zeilen anlegen" on public.records for insert to authenticated with check (user_id = (select auth.uid()));
create policy "eigene Zeilen ändern"  on public.records for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "eigene Zeilen löschen" on public.records for delete to authenticated using (user_id = (select auth.uid()));

-- Verschlüsselte Datenschlüssel (je Nutzer eine Zeile).
-- wrapped_* ist der Datenschlüssel, verschlüsselt mit dem Passwort bzw. dem Wiederherstellungscode.
create table if not exists public.user_keys (
  user_id    uuid        primary key default auth.uid() references auth.users (id) on delete cascade,
  pw         jsonb       not null, -- {salt, iterations, iv, key}
  recovery   jsonb       not null, -- {salt, iterations, iv, key}
  updated_at timestamptz not null default now()
);

alter table public.user_keys enable row level security;
alter table public.user_keys force row level security;
revoke all on public.user_keys from anon;
grant select, insert, update, delete on public.user_keys to authenticated;

drop policy if exists "eigener Schlüssel" on public.user_keys;
create policy "eigener Schlüssel" on public.user_keys for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
