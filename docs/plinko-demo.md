# Plinko demo

Run the board in isolation — no Supabase, no auth, no on-chain calls.

```bash
pnpm plinko:demo
```

Then open http://localhost:3000/demo/plinko.

The page uses a client-side `Math.random()` path generator so you can iterate
on visuals and physics without touching the server. Production builds return
404 for this route (`NODE_ENV === 'production'` check in the server
component), so it is safe to merge.

Unit tests for the payout math live in `web/lib/plinko.test.ts` and run via
`pnpm test:web`.
