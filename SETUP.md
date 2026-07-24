# Booth Together — Setup

## Run the solo booth (no backend)

```bash
npm install
npm run dev
```

Open http://localhost:3000 → **Enter the booth**. The solo photobooth works
entirely in the browser; no Supabase needed.

## Enable "together" mode (rooms + synced capture)

Rooms need a Supabase project (free tier is plenty).

### 1. Create a Supabase project
<https://supabase.com/dashboard> → **New project**. Wait for it to provision.

### 2. Enable anonymous sign-ins
Dashboard → **Authentication → Providers → Anonymous** → toggle **on**.
(This is how friends join a room with no signup.)

### 3. Run the schema
Dashboard → **SQL Editor** → paste the contents of
[`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) → **Run**.
This creates the tables, RLS policies, the `create_room` / `join_room` RPCs,
and the private `captures` + `strips` storage buckets.

> Prefer the CLI? `supabase link --project-ref <ref>` then `supabase db push`.

### 4. Set environment variables
Dashboard → **Settings → API**. Copy the **Project URL** and the **anon public**
key into a new `.env.local` (copy from `.env.example`):

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

Restart `npm run dev`.

### 5. Try it
- Open http://localhost:3000 → **Create a room**.
- Share the room link (or QR) with a friend — or just open it in a second
  browser / phone. HTTPS or `localhost` is required for the camera.
- Everyone taps **Ready**; the host taps **Start**. A synchronized 3-2-1
  countdown fires every camera at the same moment, and the finished strip
  (everyone side-by-side) appears for all to download.

## Deploy to Vercel
- Push to GitHub, import the repo in Vercel.
- Add the same two `NEXT_PUBLIC_SUPABASE_*` env vars in the Vercel project.
- Deploy. Vercel gives you the HTTPS the camera requires.

## Notes & limits
- **Camera** needs HTTPS (or `localhost`) and does not work inside in-app
  browsers (Instagram/Facebook) — open in Safari/Chrome.
- Broadcast/presence channels are keyed by the (unguessable) room id. Photos
  themselves are protected by RLS + private buckets; only room members can read
  them. For a public launch, also enable **Cloudflare Turnstile** on anonymous
  sign-in and prune stale anonymous users (see the plan).
- Free-tier watch-outs: Supabase pauses a project after ~7 days idle, and has a
  5 GB/mo egress cap. Keep strips small; both are fine at friends-and-family
  scale.
