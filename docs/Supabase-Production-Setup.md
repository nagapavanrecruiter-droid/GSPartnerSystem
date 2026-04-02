# Supabase Production Setup

Use this setup for the current live build.

The live permission model is intentionally simple:
- `Read Access`: user can only view data
- `Edit Access`: user can add partners, edit partners, delete partners, and upload files

Job titles such as `Bid Management` or `HR Admin` stay as role labels. Access is controlled separately by `access_level`.

## 1. Partners Table

```sql
create table if not exists public.partners (
  id uuid primary key,
  employee text not null,
  company text not null,
  website text,
  contact text,
  email text,
  technologies text[] default '{}',
  status text not null,
  opportunities text[] default '{}',
  event_id text,
  notes text,
  capability_statement jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  updated_by text
);
```

## 2. Portal Users Table

```sql
create table if not exists public.portal_users (
  user_id uuid primary key,
  email text not null unique,
  full_name text,
  requested_role text default 'hr_admin',
  assigned_role text default 'hr_admin',
  access_level text not null default 'read',
  status text default 'pending',
  shared_admin boolean default false,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz default now()
);

alter table public.portal_users
add column if not exists access_level text not null default 'read';
```

## 3. Audit Log Table

```sql
create table if not exists public.partner_audit_logs (
  id bigint generated always as identity primary key,
  record_id uuid,
  action text not null,
  actor_email text,
  actor_role text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);
```

## 4. Storage Bucket

Create a private bucket named `partner-files`.

```sql
insert into storage.buckets (id, name, public)
values ('partner-files', 'partner-files', false)
on conflict (id) do nothing;
```

## 5. Enable RLS

```sql
alter table public.partners enable row level security;
alter table public.portal_users enable row level security;
alter table public.partner_audit_logs enable row level security;
```

## 6. Policies

Run this block to align the backend with the current portal behavior.

```sql
drop policy if exists "portal_users_read_own_profile" on public.portal_users;
drop policy if exists "portal_users_insert_own_profile" on public.portal_users;
drop policy if exists "portal_users_update_own_profile" on public.portal_users;
drop policy if exists "partners_read_authenticated" on public.partners;
drop policy if exists "partners_insert_edit_access" on public.partners;
drop policy if exists "partners_update_edit_access" on public.partners;
drop policy if exists "partners_delete_edit_access" on public.partners;
drop policy if exists "audit_logs_insert_authenticated" on public.partner_audit_logs;
drop policy if exists "audit_logs_read_admins" on public.partner_audit_logs;
drop policy if exists "partner_files_read_authenticated" on storage.objects;
drop policy if exists "partner_files_write_edit_access" on storage.objects;
drop policy if exists "partners_write_editor_roles" on public.partners;
drop policy if exists "partner_files_write_editor_roles" on storage.objects;

create policy "portal_users_read_own_profile"
on public.portal_users
for select
to authenticated
using (auth.uid() = user_id);

create policy "portal_users_insert_own_profile"
on public.portal_users
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "portal_users_update_own_profile"
on public.portal_users
for update
to authenticated
using (auth.uid() = user_id);

create policy "partners_read_authenticated"
on public.partners
for select
to authenticated
using (true);

create policy "partners_insert_edit_access"
on public.partners
for insert
to authenticated
with check (
  exists (
    select 1
    from public.portal_users pu
    where pu.user_id = auth.uid()
      and pu.status = 'approved'
      and (
        pu.shared_admin = true
        or pu.assigned_role = 'super_admin'
        or pu.access_level = 'edit'
      )
  )
);

create policy "partners_update_edit_access"
on public.partners
for update
to authenticated
using (
  exists (
    select 1
    from public.portal_users pu
    where pu.user_id = auth.uid()
      and pu.status = 'approved'
      and (
        pu.shared_admin = true
        or pu.assigned_role = 'super_admin'
        or pu.access_level = 'edit'
      )
  )
)
with check (
  exists (
    select 1
    from public.portal_users pu
    where pu.user_id = auth.uid()
      and pu.status = 'approved'
      and (
        pu.shared_admin = true
        or pu.assigned_role = 'super_admin'
        or pu.access_level = 'edit'
      )
  )
);

create policy "partners_delete_edit_access"
on public.partners
for delete
to authenticated
using (
  exists (
    select 1
    from public.portal_users pu
    where pu.user_id = auth.uid()
      and pu.status = 'approved'
      and (
        pu.shared_admin = true
        or pu.assigned_role = 'super_admin'
        or pu.access_level = 'edit'
      )
  )
);

create policy "audit_logs_insert_authenticated"
on public.partner_audit_logs
for insert
to authenticated
with check (true);

create policy "audit_logs_read_admins"
on public.partner_audit_logs
for select
to authenticated
using (
  exists (
    select 1
    from public.portal_users pu
    where pu.user_id = auth.uid()
      and pu.status = 'approved'
      and (
        pu.shared_admin = true
        or pu.assigned_role = 'super_admin'
      )
  )
);

create policy "partner_files_read_authenticated"
on storage.objects
for select
to authenticated
using (bucket_id = 'partner-files');

create policy "partner_files_write_edit_access"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'partner-files'
  and exists (
    select 1
    from public.portal_users pu
    where pu.user_id = auth.uid()
      and pu.status = 'approved'
      and (
        pu.shared_admin = true
        or pu.assigned_role = 'super_admin'
        or pu.access_level = 'edit'
      )
  )
);
```

## 7. How The UI Works

- Super Admin and Shared Admin can approve users from `Manage Access`
- Each user keeps a job title in `assigned_role`
- Each user also gets one operational permission:
  - `Read Access`
  - `Edit Access`
- Users with `Read Access` only see view actions in the portal
- Users with `Edit Access` can add, edit, delete, and upload files

## 8. Handover Notes

The frontend and backend code are handover-ready, but a new company-owned deployment still cannot be truly zero-setup because these services are account-bound:
- Supabase project
- Vercel project
- GitHub repository

What the company will still need to do once:
1. Create their own Supabase project
2. Run the SQL in this document
3. Add their own Supabase keys to Vercel environment variables
4. Import the repository into their own Vercel account

After that initial setup, normal redeploys are just:
- push files to GitHub
- Vercel redeploys

## 9. Deployment Notes

- The current frontend uses Supabase for auth, partner CRUD, partner file storage, and audit trail
- The Vercel backend still powers access-management admin actions, auth-status lookup, signup-request creation, and Groq partner insights
- Deleting a partner currently removes the row but intentionally leaves uploaded files in storage for recovery
