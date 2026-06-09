-- NutriDesk — Esquema Supabase
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query → pegar y Run.
--
-- Modelo: cada nutricionista (usuario de Supabase Auth) tiene su estado de
-- aplicación completo (pacientes, planes, notas, evolución, perfil) en una
-- fila JSONB. Simple, suficiente para el MVP y compatible 1:1 con el formato
-- que la app ya guarda en localStorage. RLS garantiza que cada profesional
-- solo ve sus propios datos (Ley 25.326).

create table if not exists public.app_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

create policy "own state - select" on public.app_state
  for select using (auth.uid() = user_id);

create policy "own state - insert" on public.app_state
  for insert with check (auth.uid() = user_id);

create policy "own state - update" on public.app_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own state - delete" on public.app_state
  for delete using (auth.uid() = user_id);

-- Mantener updated_at al día
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists app_state_touch on public.app_state;
create trigger app_state_touch
  before update on public.app_state
  for each row execute function public.touch_updated_at();
