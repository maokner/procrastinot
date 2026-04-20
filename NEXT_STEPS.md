# Next Steps — wallet-only auth, clean session UX, image evidence

This document is the agreed plan for the next three workstreams. Items
within a workstream are ordered; workstreams themselves are mostly
independent and can ship in parallel once the DB migrations land.

---

## Workstream A — Wallet-first authentication

### Goal

The wallet **is** the account. A user connects Phantom/MetaMask/etc.,
signs a SIWE challenge, and that single action creates (or resumes) their
account. No email, no password. The wallet used to sign in is the
wallet bound to any commitments they create; funds can only flow to that
address because the contract already bakes `(creator, enemy)` into the
commitment struct at creation time (`contracts/src/Procrastinot.sol:119-138`).

### Current state (what we're replacing)

- **Signup**: `supabase.auth.signUp({ email, password })` in
  `web/components/auth/SignupForm.tsx`.
- **Login**: `signInWithPassword` in `web/components/auth/LoginForm.tsx`.
- **Wallet linking**: after signup, a two-step onboarding forces the user
  to pick a username (`profiles.insert`) then click "Link wallet" which
  runs SIWE → `web/app/api/siwe/verify/route.ts` upserts a `wallets` row
  keyed to the authed `profiles.id`.
- **Schema**: `profiles.id` is a FK to `auth.users(id)`. One wallet per
  profile via the unique constraint on `wallets.profile_id`.

### Target state

- Connect wallet → sign SIWE message → server verifies → server issues
  a Supabase session cookie bound to the wallet address.
- No email column required. Username is still chosen once, on first
  login.
- A new wallet signing in = a new account. A returning wallet = same
  account, no re-onboarding beyond username if it's somehow missing.

### Approach: SIWE → custom Supabase session

Supabase supports provisioning users via the Admin API and issuing
access tokens server-side. We'll piggyback on that so we keep RLS,
cookies, and the rest of the stack intact.

Flow:

1. Client connects wallet via wagmi (already done — `web/lib/wagmi.ts`).
2. Client requests a nonce from `POST /api/siwe/nonce` (already exists).
3. Client builds + signs a SIWE message (already exists —
   `web/components/auth/SiweButton.tsx`).
4. Client posts message + signature to `POST /api/siwe/verify`.
5. Server verifies SIWE, then:
   - Looks up `wallets.address == msg.address`.
   - If found → get the bound `profile_id` → generate a Supabase session
     for that user via the admin client.
   - If not found → create an `auth.users` row (email set to
     `${address}@wallet.procrastinot.local` or similar
     synthetic value), a paired `profiles` row with `username = null`,
     a `wallets` row pinning the address, then generate a session.
6. Server sets Supabase auth cookies on the response.
7. Client navigates to `/my` (or `/onboarding` if `username is null`).

### Files to change

**Delete / retire:**

- `web/app/login/page.tsx` and `web/components/auth/LoginForm.tsx` — replace
  with a single "Connect wallet" CTA.
- `web/app/signup/page.tsx` and `web/components/auth/SignupForm.tsx` —
  redundant; signing in with a never-seen wallet *is* signup.
- Email/password UI in `OnboardingClient.tsx` (the SIWE step becomes the
  entry point, not step 2).

**Modify:**

- `web/app/api/siwe/verify/route.ts`: upgrade from "attach wallet to
  existing session" to "produce session from SIWE". Uses the
  service-role client + admin APIs (`auth.admin.createUser`,
  `auth.admin.generateLink({ type: 'magiclink' })` or
  `auth.signInWithIdToken` depending on which turns out cleanest — the
  goal is an `access_token` + `refresh_token` pair to set as cookies).
- `web/middleware.ts` (if it exists, else create one): bounce unauthed
  traffic to `/login`.
- `web/app/onboarding/page.tsx`: drop the SIWE step, keep only the
  username picker. First-login users land here.

**New:**

- `web/app/login/page.tsx` (rewritten): single-purpose page with one
  "Connect wallet" button and a tagline. No form.
- `web/lib/session.ts` (small helper): `setSessionCookies(res, tokens)`
  using `@supabase/ssr`.

### Schema change

`supabase/migrations/0003_wallet_auth.sql`:

- Make `profiles.username` nullable (it's currently `not null`). Reason:
  the row now exists the moment a wallet signs in for the first time;
  the username gets filled in on the next page load.
- Optionally add `wallets.is_primary boolean not null default true` if
  we later want multiple wallets per profile — for now we keep the
  1:1 unique constraint.
- No change to `auth.users`; we keep using it as Supabase's identity
  table, we just populate it ourselves from SIWE.

### Security notes

- The synthetic email is never sent anywhere; it's just to satisfy
  Supabase's uniqueness constraint. Emails stay un-verified and
  unusable for recovery.
- The service-role key stays server-only; `siwe/verify` is the only
  route that calls it for auth purposes.
- SIWE nonces: keep the single-use in-process cache we already have;
  5-minute TTL is fine. If we go horizontal on Vercel, move nonces into
  a Supabase `siwe_nonces(nonce text pk, issued_at)` table with a
  cleanup policy.
- Rate-limit `siwe/verify` by IP (add to middleware once the core flow
  is proven).

### Verification

1. Clear cookies, visit `/login` → see "Connect wallet" only.
2. Connect MetaMask (never seen) → sign → land on `/onboarding` with
   only the username prompt.
3. Pick username → land on `/my` with the new profile populated.
4. Log out (Workstream B), reconnect same wallet → land straight on
   `/my`, no re-onboarding.
5. Try to open `/my` without a session → redirected to `/login`.
6. In Supabase: confirm one `auth.users` row, one `profiles` row, one
   `wallets` row, all referencing each other consistently.

---

## Workstream B — Session UX (clear logged-in state + logout)

### Goal

Every page shows whether you're logged in, as whom, with a one-click
logout that also disconnects the wallet.

### Current state

- No global header. Logged-in status is only visible on `/settings`.
- `SignOutButton` in `web/components/auth/SignOutButton.tsx` calls
  `supabase.auth.signOut()` but does NOT disconnect the wallet — wagmi
  still has the connector live, so the next SIWE attempt silently
  reuses the previous connection.

### Target state

- A global header on every authenticated route showing:
  `@username • 0xABCD…1234 [disconnect]`.
- A single "Disconnect" button that:
  1. Calls the signout route (`/api/auth/signout`).
  2. Calls wagmi's `disconnect()` so the provider actually drops.
  3. Redirects to `/login`.
- When not logged in, the same header shows a "Connect wallet" button.

### Files to change

**New:**

- `web/components/layout/AppHeader.tsx` — server-fetches the current
  profile (username, wallet address) and renders a client-side
  `SessionMenu` component for the disconnect action.
- `web/components/layout/SessionMenu.tsx` — client component; uses
  `useDisconnect()` from wagmi + posts to `/api/auth/signout`.

**Modify:**

- `web/app/layout.tsx` — mount `<AppHeader />` above `{children}`.
- `web/components/auth/SignOutButton.tsx` — delete or fold into
  `SessionMenu`.
- `web/app/api/auth/signout/route.ts` — no change, still just clears
  the session cookie (the wagmi disconnect happens client-side after
  the fetch resolves).

### Verification

1. After logging in, every page shows `@username • 0x… [disconnect]`.
2. Clicking disconnect: Supabase session cleared, MetaMask shows "not
   connected", URL is `/login`.
3. Hard reload `/login` — header shows "Connect wallet", not the old
   session.
4. On mobile widths, header collapses to avatar + menu (Tailwind only,
   no extra library).

---

## Workstream C — Image evidence upload → multimodal oracle

### Goal

User submits a commitment's evidence as one or more **images**
(plus optional caption), the image URL(s) land on-chain as the
evidence URI, the oracle fetches them and passes them to GPT-4o (or
gpt-4o-mini) as `image_url` content parts so the model actually *sees*
the photo.

### Current state

- `SubmitEvidenceForm.tsx` accepts a single string: `text:foo`, a URL,
  or `ipfs://…`. It's a one-line `<input>`.
- `contracts/src/Procrastinot.sol:requestVerdict(id, evidenceURI)`
  writes the full string to the `VerdictRequested` event. The oracle
  reads it back off-chain.
- `oracle/src/evidence.ts:resolveEvidence` caps fetches at 8 KB, which
  is far below a single phone photo (~500 KB – 5 MB).
- `oracle/src/judge.ts` embeds evidence as plain-text in the user
  message. Even when we send image bytes, the judge prompt never
  flips to a multimodal shape.
- No file-storage integration anywhere in the repo (no Supabase Storage
  usage, no IPFS pinning service, no avatar uploader).

### Target state

- UI has a drag-and-drop/file-picker that accepts JPEG/PNG/WebP/HEIC.
- Client uploads directly to a Supabase Storage bucket (public,
  read-only for anon) and gets back a permanent public URL.
- The URL is written on-chain via `requestVerdict`. Exactly the same
  contract call we have today; no contract change needed.
- Oracle detects image MIME, fetches the bytes (raised cap), sends them
  to OpenAI as `image_url` content parts alongside the task + rubric.
- Judge prompt explicitly tells the model "evidence is a photo; judge
  it against the rubric visually."

### Storage choice: Supabase Storage (public bucket) for v1

- **Pros**: already in the stack, free tier is generous, no new keys,
  one SQL migration to provision the bucket.
- **Cons**: not decentralized — if the bucket is wiped, the evidence is
  unverifiable post-hoc. Acceptable for a demo; revisit before mainnet.
- **v2 upgrade path**: switch to Pinata or web3.storage pinning; the
  same oracle code that fetches an `https://` URL fetches an
  `ipfs://` URI via the existing gateway logic
  (`oracle/src/evidence.ts:ipfsToHttp`).

### Files to change

**Supabase:**

- `supabase/migrations/0004_evidence_storage.sql`:
  - Create bucket `evidence` with `public = true`.
  - Storage RLS policy: `INSERT` allowed to authenticated users only;
    `SELECT` open to anon. File names namespaced by `profile_id` so a
    user can't overwrite another user's uploads.

**Web:**

- `web/components/commitment/SubmitEvidenceForm.tsx` (rewrite):
  - Add `<input type="file" accept="image/*" multiple>` and a drop zone.
  - On submit: upload each file to Supabase Storage under
    `evidence/${profile_id}/${commitment_id}/${attempt}-${index}.${ext}`.
  - Build a JSON manifest URL if multiple files, or pass a single URL
    directly. Manifest format:
    ```json
    { "kind": "images", "urls": ["https://…1.jpg", "https://…2.jpg"], "note": "optional caption" }
    ```
    Stored as a JSON file in the same bucket; its URL is what goes
    on-chain.
  - Fall back to the existing text input for users who want to paste
    a link (keeps our current flexibility).
- `web/lib/storage.ts` (new): tiny wrapper around
  `supabase.storage.from('evidence').upload(...)`.

**Oracle:**

- `oracle/src/evidence.ts`:
  - Raise `MAX_BYTES` cap for image content to ~10 MB (keep 8 KB for
    text). Detect by `Content-Type` from the HEAD response.
  - Return a typed union:
    ```ts
    type Evidence =
      | { kind: 'text', text: string }
      | { kind: 'image', mime: string, dataBase64: string }
      | { kind: 'images', items: Array<{ mime: string, dataBase64: string }>, note?: string };
    ```
  - When the fetched resource is JSON with `kind === 'images'`, fetch
    each URL in the array (parallel, bounded) and return the `images`
    variant.
- `oracle/src/judge.ts`:
  - Switch from string-only prompt to OpenAI's multimodal content
    format. Each image becomes a
    `{ type: 'image_url', image_url: { url: 'data:<mime>;base64,<…>' } }`
    content part.
  - Leave text evidence on the existing code path.
  - Update the system prompt to say "Evidence may be one or more
    photographs. If so, judge them against the rubric visually. Be
    strict but fair."
- `oracle/src/config.ts`: default `OPENAI_MODEL` stays `gpt-4o-mini`
  (it's multimodal and cheap). Document that any non-multimodal model
  will break image judgments.

### Size + cost considerations

- Phone photos commonly land at 2-5 MB. For `gpt-4o-mini`, image
  tokens depend on the "detail" level; use `detail: 'low'` for cheap
  judgments, `'high'` only if the task demands it. Make this an env
  var (`OPENAI_IMAGE_DETAIL`, default `'low'`).
- Client-side: resize images to max 2048px longest edge before upload
  (browser `canvas` + `toBlob`). Keeps storage costs flat and OpenAI
  costs predictable.

### Verification

1. Create a commitment with a task like "push-ups at 8 AM".
2. On the commitment page, evidence form shows a file picker.
3. Drop a phone photo → see it upload with a progress bar → see a
   "submit" button enable.
4. Submit → MetaMask prompts for the `requestVerdict` tx → tx confirms.
5. In Supabase Storage: file lives under
   `evidence/<profile_id>/<commitment_id>/…`.
6. In the oracle Railway logs: `poller.evidence.fetched` with the
   correct MIME and byte count; `poller.judge.image.submitted` (new
   log event) just before the OpenAI call.
7. `oracle_verdicts.reason` reflects an actual visual judgment
   ("photo shows 30 push-ups completed at timestamp…").
8. Submit a text-only evidence (paste a URL) — the old path still
   works end-to-end.

---

## Ordering + rough effort

| # | Workstream | Effort | Depends on |
|---|---|---|---|
| 1 | A — wallet-first auth | ~1 day | nothing |
| 2 | B — session UX | ~0.5 day | A (uses the new session) |
| 3 | C — image evidence | ~1 day | nothing |

A and C can ship in parallel if two people are working. Migrations
should be applied in order: `0003_wallet_auth.sql`, then
`0004_evidence_storage.sql`.

## Not in scope (intentionally)

- Multi-wallet per profile.
- On-chain proof-of-storage / IPFS (deferred to v2).
- Evidence tamper-detection (hashing the image and storing the hash
  on-chain alongside the URL) — worth doing before mainnet, not for
  the demo.
- Admin/mod tools for flagging abusive evidence.
- Anything touching the existing `forfeit` / `submitVerdict` contract
  logic — wallet-binding is already enforced by the contract storing
  `(creator, enemy)` addresses at commitment creation.
