# Delphi

> **Think Deeper, Clearer, Better.**

An AI thinking companion with a custom system prompt. This is a monorepo with two
clients that share one backend:

```
delphi/
├─ ios/     Native SwiftUI + Metal app (Xcode project)
├─ web/     React/Vite web app + the Netlify function backend
└─ docs/    Privacy policy, terms, and App Store submission material
```

## web/

The Vite site and the serverless `chat` function (Netlify). The function holds
the OpenRouter key + system prompt server-side, enforces the auth gate, rate
limits, and meters spend per device per month (free / paid tiers). Netlify builds
from `web/` (see `netlify.toml` `base`).

## ios/

The native rebuild. Talks to the same `web/` backend. Requires Xcode 26+ (iOS 26
SDK — Liquid Glass). See `ios/README.md`.

## Backend contract

The client POSTs `{ "messages": [...] }` to `/.netlify/functions/chat` and reads
an SSE stream. Secrets never leave the server.
