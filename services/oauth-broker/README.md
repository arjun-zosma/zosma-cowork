# Zosma Cowork — Google OAuth token broker

Stateless backend that holds the **Web-application** Google OAuth **client secret**
so it never ships inside the desktop app. The Tauri app performs the OAuth flow
with **PKCE** and the **public client_id**, then asks this broker to do the two
operations Google requires a secret for.

```
 ┌────────────┐   1. open browser (PKCE, client_id, redirect=broker/callback)
 │  Tauri app │ ───────────────────────────────────────────────► Google consent
 │ (sidecar)  │                                                        │
 │            │   2. Google redirects with ?code  ──► broker /callback │
 │  loopback  │ ◄── 3. 302 bounce to 127.0.0.1:<port>/oauth2callback ──┘
 │  :<port>   │
 │            │   4. POST /token { code, code_verifier, redirect_uri }
 │            │ ──────────────────────────────────────────────► broker ──► Google
 │            │ ◄── { access_token, refresh_token, ... } ─────── (adds secret)
 │            │
 │            │   5. later: POST /refresh { refresh_token } ──► broker ──► Google
 └────────────┘ ◄── { access_token, expires_in, ... } ───────── (adds secret)
```

The app stores only the **public client_id** + the user's tokens. **No secret is
ever in the bundle, in git, or in this repo.**

## Endpoints

| Method | Path        | Body / Query                              | Returns |
|--------|-------------|-------------------------------------------|---------|
| GET    | `/health`   | —                                         | `{ ok }` |
| GET    | `/callback` | `?code&state` (state = b64url{port,nonce})| 302 → `http://127.0.0.1:<port>/oauth2callback` |
| POST   | `/token`    | `{ code, code_verifier, redirect_uri }`   | `{ access_token, refresh_token, expires_in, scope, ... }` |
| POST   | `/refresh`  | `{ refresh_token }`                        | `{ access_token, expires_in, scope, ... }` |

Stateless, scales horizontally, custodies nothing. Public endpoints are safe: a
caller can only finish an exchange for a code/refresh_token they already hold
(and `/token` also needs the matching PKCE verifier).

## Config

| Name                          | Where                | Secret? |
|-------------------------------|----------------------|---------|
| `GOOGLE_OAUTH_CLIENT_ID`      | `functions/.env`     | No (public) |
| `GOOGLE_OAUTH_CLIENT_SECRET`  | Google Secret Manager| **Yes** |
| `BROKER_REGION` (opt)         | `functions/.env`     | No |

One deployment **per environment** (12-factor). Staging uses the
"Zosma Cowork Staging" Web client; prod gets its own Web client + its own deploy.

## Deploy (staging)

Prereqs: Firebase **Blaze** plan on `keen-wavelet-461720-h0`, and the
`firebase` CLI authenticated.

```bash
cd services/oauth-broker
cp functions/.env.example functions/.env     # staging client_id is prefilled
cd functions && npm install && npm run build && cd ..

# Store the secret (reads from the downloaded client JSON; value never printed):
firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_SECRET --project keen-wavelet-461720-h0 \
  --data-file <(jq -r '.web.client_secret' ~/Downloads/client_secret_830231223031-pukjd742*.json)

firebase deploy --only functions:oauth-broker --project keen-wavelet-461720-h0
```

After deploy, the broker base URL is:

```
https://us-central1-keen-wavelet-461720-h0.cloudfunctions.net/broker
```

### Register the redirect URI (one-time, Google Console)

In the **Zosma Cowork Staging** OAuth client → *Authorised redirect URIs* → add:

```
https://us-central1-keen-wavelet-461720-h0.cloudfunctions.net/broker/callback
```

## Local dev (emulator)

```bash
cd services/oauth-broker/functions
npm run serve   # firebase emulators:start --only functions
```

The app points at the broker via `ZOSMA_OAUTH_BROKER_URL` (see the client-side
wiring in `agent-sidecar/src/google-auth/`).

## Security notes

- Secret only in Secret Manager; rotatable without redeploying the app.
- No tokens are logged. Inputs are type-checked; JSON body capped at 16 KB.
- Hardening backlog: Firebase App Check / a signed app header on `/token` &
  `/refresh`, per-IP rate limiting, structured audit logs.
