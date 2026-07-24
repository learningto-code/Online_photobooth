-- Booth Together — initial schema, RLS, RPCs, and storage.
-- Run this in the Supabase SQL editor (or `supabase db push`) on a fresh project.
-- Also enable Anonymous sign-ins: Dashboard → Authentication → Providers → Anonymous.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Server clock helper (epoch milliseconds) for cross-device countdown sync.
-- ---------------------------------------------------------------------------
create or replace function public.server_now_ms()
returns bigint
language sql
stable
as $$
  select (extract(epoch from clock_timestamp()) * 1000)::bigint;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.rooms (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,
  host_id    uuid not null references auth.users (id),
  name       text,
  status     text not null default 'open',      -- open | locked | closed
  layout     text not null default 'strip-4',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '12 hours'
);

create table if not exists public.participants (
  room_id      uuid not null references public.rooms (id) on delete cascade,
  user_id      uuid not null references auth.users (id),
  display_name text,
  role         text not null default 'guest',    -- host | guest
  joined_at    timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.sessions (
  id                uuid primary key default gen_random_uuid(),
  room_id           uuid not null references public.rooms (id) on delete cascade,
  started_by        uuid not null references auth.users (id),
  shoot_at          bigint,                       -- server-clock ms of the FIRST shot
  layout            text not null default 'strip-4',
  filter_id         text,
  frame_id          text,
  caption           text,
  shots             int not null default 4,       -- photos per strip
  frame_count       int not null default 6,       -- frames actually captured
  participant_order jsonb not null default '[]',  -- ordered user ids frozen at start
  status            text not null default 'pending', -- pending | shooting | done
  created_at        timestamptz not null default now()
);

create table if not exists public.photos (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.sessions (id) on delete cascade,
  room_id      uuid not null references public.rooms (id) on delete cascade,
  user_id      uuid not null references auth.users (id),
  frame_index  int not null,
  storage_path text not null,
  created_at   timestamptz not null default now()
);

create table if not exists public.strips (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms (id) on delete cascade,
  session_id   uuid references public.sessions (id) on delete set null,
  storage_path text not null,
  created_by   uuid not null references auth.users (id),
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Membership helper — SECURITY DEFINER so policies don't recurse on
-- participants, and so a lookup works before the row is visible to the user.
-- ---------------------------------------------------------------------------
create or replace function public.is_member(r uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.participants
    where room_id = r and user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Create a room (generates a unique code, adds caller as host).
-- ---------------------------------------------------------------------------
create or replace function public.create_room(p_name text default null, p_layout text default 'strip-4')
returns table (id uuid, code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_id   uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  loop
    -- md5(uuid) uses only built-ins (no pgcrypto / extensions-schema dependency)
    v_code := upper(substr(md5(gen_random_uuid()::text), 1, 6));
    -- alias the table: `code` alone is ambiguous with the RETURNS TABLE out-column
    exit when not exists (select 1 from public.rooms r where r.code = v_code);
  end loop;

  insert into public.rooms (code, host_id, name, layout)
  values (v_code, auth.uid(), p_name, p_layout)
  returning rooms.id into v_id;

  insert into public.participants (room_id, user_id, display_name, role)
  values (v_id, auth.uid(), coalesce(nullif(p_name, ''), 'Host'), 'host');

  return query select v_id, v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Join a room by code. Solves the chicken-and-egg (guest is not yet a member,
-- so cannot SELECT the room): this runs SECURITY DEFINER and returns the id.
-- ---------------------------------------------------------------------------
create or replace function public.join_room(p_code text, p_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_room from public.rooms where code = upper(p_code);
  if v_room.id is null then
    raise exception 'Room not found';
  end if;
  if v_room.status <> 'open' then
    raise exception 'Room is not open';
  end if;
  if v_room.expires_at < now() then
    raise exception 'Room has expired';
  end if;

  insert into public.participants (room_id, user_id, display_name, role)
  values (
    v_room.id,
    auth.uid(),
    coalesce(nullif(p_name, ''), 'Guest'),
    case when v_room.host_id = auth.uid() then 'host' else 'guest' end
  )
  on conflict (room_id, user_id) do update
    set display_name = coalesce(nullif(excluded.display_name, ''), public.participants.display_name);

  return v_room.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.rooms        enable row level security;
alter table public.participants enable row level security;
alter table public.sessions     enable row level security;
alter table public.photos       enable row level security;
alter table public.strips       enable row level security;

-- rooms: members read; host may update (lock/close). Inserts happen via RPC.
drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms
  for select using (public.is_member(id));

drop policy if exists rooms_update_host on public.rooms;
create policy rooms_update_host on public.rooms
  for update using (host_id = auth.uid()) with check (host_id = auth.uid());

-- participants: members read; a user may remove themselves. Inserts via RPC only.
drop policy if exists participants_select on public.participants;
create policy participants_select on public.participants
  for select using (public.is_member(room_id));

drop policy if exists participants_delete_self on public.participants;
create policy participants_delete_self on public.participants
  for delete using (user_id = auth.uid());

-- sessions
drop policy if exists sessions_select on public.sessions;
create policy sessions_select on public.sessions
  for select using (public.is_member(room_id));

drop policy if exists sessions_insert on public.sessions;
create policy sessions_insert on public.sessions
  for insert with check (public.is_member(room_id) and started_by = auth.uid());

drop policy if exists sessions_update on public.sessions;
create policy sessions_update on public.sessions
  for update using (public.is_member(room_id)) with check (public.is_member(room_id));

-- photos
drop policy if exists photos_select on public.photos;
create policy photos_select on public.photos
  for select using (public.is_member(room_id));

drop policy if exists photos_insert on public.photos;
create policy photos_insert on public.photos
  for insert with check (public.is_member(room_id) and user_id = auth.uid());

-- strips
drop policy if exists strips_select on public.strips;
create policy strips_select on public.strips
  for select using (public.is_member(room_id));

drop policy if exists strips_insert on public.strips;
create policy strips_insert on public.strips
  for insert with check (public.is_member(room_id) and created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- Storage: private buckets gated by the room_id (first path segment).
-- Paths: {room_id}/{session_id}/{user_id}-{frame}.jpg  and  {room_id}/{session_id}.png
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('captures', 'captures', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('strips', 'strips', false)
  on conflict (id) do nothing;

drop policy if exists "captures member read" on storage.objects;
create policy "captures member read" on storage.objects
  for select using (
    bucket_id = 'captures'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "captures member write" on storage.objects;
create policy "captures member write" on storage.objects
  for insert with check (
    bucket_id = 'captures'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "strips member read" on storage.objects;
create policy "strips member read" on storage.objects
  for select using (
    bucket_id = 'strips'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "strips member write" on storage.objects;
create policy "strips member write" on storage.objects
  for insert with check (
    bucket_id = 'strips'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );
