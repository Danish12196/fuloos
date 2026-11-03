-- Fuloos Phase 1. Run once in a dedicated Supabase project's SQL editor.
-- All amounts are integer fils (100 fils = 1 AED). No floating-point money.
begin;
create table public.accounts (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check (length(trim(name)) between 1 and 80),
 type text not null check (type in ('current','savings','credit_card','cash','other')),
 currency text not null default 'AED' check (currency='AED'),
 opening_balance bigint not null default 0 check (abs(opening_balance)<=100000000000),
 opening_date date not null,
 color text not null default '#1d5b48' check (color ~ '^#[0-9A-Fa-f]{6}$'),
 created_at timestamptz not null default now(),
 unique(user_id,id)
);
create table public.categories (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check (length(trim(name)) between 1 and 80),
 type text not null check (type in ('expense','income')),
 description text not null default '' check(length(description)<=500),
 color text not null default '#1d5b48' check (color ~ '^#[0-9A-Fa-f]{6}$'),
 created_at timestamptz not null default now(),
 unique(user_id,id), unique(user_id,id,type)
);
create table public.transactions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 type text not null check (type in ('expense','income','transfer')),
 amount bigint not null check (amount>0 and amount<=100000000000),
 account_id uuid not null,
 to_account_id uuid,
 category_id uuid,
 date date not null,
 payee text not null default '' check(length(payee)<=160),
 notes text not null default '' check(length(notes)<=1000),
 created_at timestamptz not null default now(),
 foreign key(user_id,account_id) references public.accounts(user_id,id) on delete restrict,
 foreign key(user_id,to_account_id) references public.accounts(user_id,id) on delete restrict,
 foreign key(user_id,category_id,type) references public.categories(user_id,id,type) on delete restrict,
 check ((type='transfer' and to_account_id is not null and to_account_id<>account_id and category_id is null) or (type in ('expense','income') and to_account_id is null))
);
create index transactions_user_date on public.transactions(user_id,date desc);
create index transactions_account on public.transactions(user_id,account_id);
create index transactions_destination on public.transactions(user_id,to_account_id) where to_account_id is not null;
create index transactions_category on public.transactions(user_id,category_id,type) where category_id is not null;
create index accounts_user on public.accounts(user_id);
create index categories_user on public.categories(user_id);
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
create policy accounts_owner on public.accounts for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy categories_owner on public.categories for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy transactions_owner on public.transactions for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
revoke all on public.accounts,public.categories,public.transactions from anon;
grant select,insert,update,delete on public.accounts,public.categories,public.transactions to authenticated;
-- Serialize related ledger writes per user, preserving account-date constraints
-- even when two clients edit opening dates and insert transactions concurrently.
create function public.validate_ledger_dates() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,0));
 if TG_TABLE_NAME='transactions' then
  if exists(select 1 from public.accounts a where a.user_id=new.user_id and a.id in (new.account_id,new.to_account_id) and a.opening_date>new.date) then
   raise exception 'Transaction cannot be before the account opening date';
  end if;
 else
  if exists(select 1 from public.transactions t where t.user_id=new.user_id and (t.account_id=new.id or t.to_account_id=new.id) and t.date<new.opening_date) then
   raise exception 'Opening date cannot be after an existing transaction';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.validate_ledger_dates() from public,anon;
grant execute on function public.validate_ledger_dates() to authenticated;
create trigger accounts_validate_dates before insert or update on public.accounts for each row execute function public.validate_ledger_dates();
create trigger transactions_validate_dates before insert or update on public.transactions for each row execute function public.validate_ledger_dates();
commit;
