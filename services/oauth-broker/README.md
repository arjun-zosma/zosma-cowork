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

## Config (runtime env)

| Name                          | Where                     | Secret? |
|-------------------------------|---------------------------|---------|
| `GOOGLE_OAUTH_CLIENT_ID`      | deploy `--set-env-vars`   | No (public) |
| `GOOGLE_OAUTH_CLIENT_SECRET`  | Google Secret Manager (`--set-secrets`) | **Yes** |

One deployment **per environment** (12-factor). Staging uses the
"Zosma Cowork Staging" Web client; prod gets its own Web client + its own deploy.

## Deployed (staging)

| | |
|---|---|
| Project | `keen-wavelet-461720-h0` (Reva) |
| Region | `us-central1` |
| Service | Cloud Functions gen2 / Cloud Run `broker` |
| **Base URL** | `https://broker-uoux53xara-uc.a.run.app` |
| **Redirect URI to register** | `https://broker-uoux53xara-uc.a.run.app/callback` |
| Web client | `830231223031-pukjd742…` (Zosma Cowork Staging) |

### Register the redirect URI (one-time, Google Console)

In the **Zosma Cowork Staging** OAuth client → *Authorised redirect URIs* → add:

```
https://broker-uoux53xara-uc.a.run.app/callback
```

## Deploy / redeploy

Deployed via **gcloud** (not Firebase). `./deploy.sh` captures the exact working
sequence; deploy from an isolated, precompiled copy (the monorepo buildpack
otherwise picks up the root `package.json`).

```bash
cd services/oauth-broker
GOOGLE_OAUTH_CLIENT_ID=830231223031-pukjd742a01uau7oekvrs231fb737eo0.apps.googleusercontent.com \
CLIENT_SECRET_FILE=~/Downloads/client_secret_830231223031-pukjd742*.json \
./deploy.sh
```

One-time project gotchas this script / setup handles (gen2 specifics):

1. The gen2 **build runs as the default compute SA** — it needs
   `roles/cloudbuild.builds.builder` (logging + Artifact Registry). Missing this
   = builds fail with "An unexpected error occurred" and **no logs**.
2. The compute SA needs `roles/secretmanager.secretAccessor` on the secret.
3. Public access (`allUsers` invoker) requires the org policy
   `iam.allowedPolicyMemberDomains` to permit it — if your org enforces Domain
   Restricted Sharing, set a **project-level** override `allowAll: true`.
4. Deploy from an **isolated** precompiled dir + `GOOGLE_NODE_RUN_SCRIPTS=`.

## Local dev

```bash
cd services/oauth-broker/functions
npm install && npm run build
GOOGLE_OAUTH_CLIENT_ID=… GOOGLE_OAUTH_CLIENT_SECRET=… npm start   # functions-framework on :8080
```

The app points at the broker via `ZOSMA_OAUTH_BROKER_URL` (client-side wiring in
`agent-sidecar/src/google-auth/`, next PR).

## Security notes

- Secret only in Secret Manager; rotatable without redeploying the app.
- No tokens are logged. Inputs are type-checked; JSON body capped at 16 KB.
- Hardening backlog: Firebase App Check / a signed app header on `/token` &
  `/refresh`, per-IP rate limiting, structured audit logs.
