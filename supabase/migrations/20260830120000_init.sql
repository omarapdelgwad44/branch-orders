-- Branch Orders schema. The Edge Function uses the service role;
-- RLS is on with no public policies so the anon key cannot read tables.

create table if not exists settings (
  key text primary key,
  value text not null default ''
);

create table if not exists branches (
  branch_id text primary key,
  branch_code text not null unique,
  branch_name text not null,
  location text not null default '',
  status text not null default 'active',
  created_at text not null,
  updated_at text not null
);

create table if not exists users (
  user_id text primary key,
  username text not null unique,
  email text not null default '',
  password_hash text not null,
  password_salt text not null default '',
  full_name text not null default '',
  role text not null,
  branch_id text not null default '',
  status text not null default 'active',
  created_at text not null,
  updated_at text not null,
  last_login_at text not null default ''
);

create table if not exists items (
  item_id text primary key,
  item_code text not null default '',
  item_name text not null,
  category text not null default '',
  unit text not null default 'pc',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at text not null,
  updated_at text not null
);

create table if not exists branch_items (
  branch_id text not null,
  item_id text not null,
  is_available boolean not null default true,
  max_quantity integer,
  updated_at text not null,
  primary key (branch_id, item_id)
);

create table if not exists orders (
  order_id text primary key,
  order_number text not null,
  branch_id text not null,
  created_by text not null,
  status text not null,
  notes text not null default '',
  admin_notes text not null default '',
  cancel_reason text not null default '',
  submitted_at text not null default '',
  processed_at text not null default '',
  sent_at text not null default '',
  received_at text not null default '',
  created_at text not null,
  updated_at text not null
);

create table if not exists order_items (
  order_item_id text primary key,
  order_id text not null,
  item_id text not null,
  requested_quantity double precision not null default 0,
  approved_quantity double precision,
  sent_quantity double precision,
  received_quantity double precision,
  shortage_quantity double precision,
  shortage_reason text not null default '',
  created_at text not null,
  updated_at text not null
);

create table if not exists sessions (
  token text primary key,
  user_id text not null,
  created_at text not null,
  expires_at text not null,
  active boolean not null default true
);

create table if not exists activity_log (
  log_id text primary key,
  actor_user_id text not null default '',
  action text not null,
  entity_type text not null default '',
  entity_id text not null default '',
  details_json text not null default '{}',
  created_at text not null
);

create index if not exists orders_branch_idx on orders (branch_id);
create index if not exists orders_created_idx on orders (created_at);
create index if not exists order_items_order_idx on order_items (order_id);
create index if not exists sessions_user_idx on sessions (user_id);
create index if not exists activity_created_idx on activity_log (created_at);

create or replace function next_setting_seq(p_key text)
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  loop
    update settings
       set value = (coalesce(nullif(value, ''), '0')::int + 1)::text
     where key = p_key
     returning value::int into n;
    if found then
      return n;
    end if;
    begin
      insert into settings(key, value) values (p_key, '1');
      return 1;
    exception when unique_violation then
      -- concurrent insert; retry the update
    end;
  end loop;
end;
$$;

alter table settings enable row level security;
alter table branches enable row level security;
alter table users enable row level security;
alter table items enable row level security;
alter table branch_items enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table sessions enable row level security;
alter table activity_log enable row level security;
