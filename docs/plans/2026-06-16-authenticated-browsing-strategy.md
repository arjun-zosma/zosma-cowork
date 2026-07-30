# Authenticated Browsing + Anti-Detection Strategy

> Addendum to the browser-harness plan. Answers: *how do we browse as the real user,
> with their logins, and not get blocked by bot-detection?*
>
> **TL;DR — for a desktop app, don't win the anti-bot arms race. Become the user's
> actual browser.** A real browser has a real fingerprint and real logins, so it is
> undetectable *because it is not a bot*. Pair that with a human-takeover handoff for
> CAPTCHA/MFA/login walls. Reserve stealth browsers (nodriver/Camoufox) for the
> headless/cloud fallback only.

---

## The architectural fork

There are two fundamentally different ways to do agentic browsing. They solve
different problems and the choice dominates everything else.

### Strategy A — "Be the user's real browser" ✅ right fit for zosma-cowork
Attach to (or launch) the user's **actual Chrome** with their **real profile**.

- **You get all logins for free** — Gmail, internal dashboards, SaaS, banking. No
  credential upload, no re-login, no cookie export.
- **Inherently undetectable** — the fingerprint, TLS, canvas, fonts, plugins, IP are
  all genuinely the user's. There is nothing to spoof; anti-bot sees a real human's
  browser. You stop *being* a bot.
- **Fits a desktop app perfectly** — zosma-cowork is already a Tauri app on the
  user's machine. The real browser is right there.

This is what the cleanest *local* agents do. Relevant projects:

| Project | Mechanism | Note |
|---------|-----------|------|
| **browser-use "Real Browser"** | Connect to existing Chrome (CDP), preserve login/cookies/extensions | Mature, documented mode |
| **runbrowser/runbrowser** | Chrome **extension** + CDP relay — drives your *running* browser | Sidesteps ProcessSingleton lock; uses your existing logins/extensions |
| **leeguooooo/chrome-use** | Standalone fork of vercel-labs/agent-browser + stealth/extension-relay/anti-detection/humanize | ⭐ Same family as the `agent-browser` we already picked — possible drop-in upgrade |
| **pasky/chrome-cdp-skill** | One toggle, connect to live Chrome session | Zero-install, works out of the box |
| **zhiqi-li/browser-mcp-cdp** | Extension + CLI, snapshots your profile | MCP-native |
| **microsoft/playwright agent-cli** | Official `attach --cdp` / `--extension` | First-party, well-maintained |

**The ProcessSingleton gotcha:** Chromium locks a profile dir to one process
(`ProcessSingleton`). You *cannot* point Playwright/CDP at the user's live default
profile while Chrome is open on it. Three ways around it:
1. **Extension relay** (runbrowser, chrome-use) — ride *inside* the already-running
   browser. Best UX: nothing to launch, real session, real extensions.
2. **Launch with `--remote-debugging-port`** on a dedicated/cloned profile.
3. **Copy the profile** to a working dir (security smell — Cursor's Operator-Use is
   explicitly moving *away* from copying auth data, issue #20).

→ For zosma-cowork, **extension relay or a dedicated debugging-port profile** are the
clean options.

### Strategy B — "Stealth synthetic browser" (only the cloud/headless fallback)
Spawn a fake browser engineered to *look* real. This is the Browserbase / scraper
model — necessary when you can't borrow the user's window (server-side, scale,
isolation), **not** when you're on the user's desktop.

2026 benchmark (Ian Paterson — 7 tools, 31 Cloudflare targets, 651 verdicts, headed,
residential IP):

| Tool | Approach | Result |
|------|----------|--------|
| **nodriver** | Unmodified Chrome over raw CDP, no automation markers | 🏆 **zero blocked targets** |
| **Patchright** | Binary-patched Playwright | Passes most Cloudflare; variable on Akamai/PerimeterX |
| **CloakBrowser** | Custom Chromium build | Clusters behind nodriver |
| **Camoufox** | Custom **Firefox** build, C++-level fingerprint spoofing + rotation | Strong, but Firefox-only + Python |

**Verdict on Camoufox:** it *is* one of the best stealth engines (engine-level
spoofing is harder to detect than JS patches). But it's **Firefox + Python**, which
is off-axis from our Chrome/CDP/`agent-browser` stack. If we ever need stealth, on a
Chrome stack **nodriver** (or **Patchright**) is the more aligned pick, and
**rebrowser-patches** fixes the well-known `Runtime.Enable` CDP leak that Cloudflare/
DataDome flag.

**Why stealth is a losing arms race for us:** behavioral analysis (mouse dynamics,
event timing) on the highest-security configs (Akamai, PerimeterX/HUMAN) still catches
even patched tools. TLS JA3/JA4, IP/ASN reputation, and the CDP `Runtime.Enable`
signal are all checked. You can win individual rounds; you can't win permanently. The
user's real browser doesn't play this game at all.

---

## How the top companies actually do it

| Product | Browser | Auth model | Anti-bot approach |
|---------|---------|-----------|-------------------|
| **OpenAI Operator** | Remote virtual browser | Per-site logins granted in-session; **takeover mode** for login/payment | Human solves CAPTCHA/MFA via takeover |
| **ChatGPT agent mode** | Hosted browser, "device-level" ambitions | User authenticates per session | Handoff to user |
| **Cursor** | Clean profile by default (moving *away* from copying auth) | Credentials injected at the **MCP layer** (e.g. Authsome vault) | Avoids the problem — fresh profile, injected creds |
| **Browserbase / Stagehand** | Cloud Chromium | **Live View** for manual login + persisted context IDs | `advancedStealth` + residential `proxies` + `solveCaptchas` flags; **handoff** pattern for SSO/MFA/consent |

**The universal pattern that actually works: the human-takeover handoff.** Nobody
reliably *defeats* CAPTCHA/MFA at scale. Instead: when the agent hits a login /
CAPTCHA / MFA / consent wall, it **pauses and hands the live view to the user**, who
solves it, then the agent **resumes**. Browserbase formalizes this
(`handoff --action set/check`), Operator calls it takeover mode.

→ This **pairs exactly with our Phase 1 live viewport.** The PiP/fullscreen viewport
becomes interactive "take control": agent pauses → user logs in / clears CAPTCHA in
the same live browser → hands back. We were already going to build the viewport; the
handoff is a small addition on top.

---

## Recommendation for zosma-cowork

1. **Primary path — drive the user's real Chrome.** We're a desktop app; use an
   **extension relay** (runbrowser / chrome-use model) or launch Chrome with
   `--remote-debugging-port` on a dedicated profile. Real session, real fingerprint,
   all logins, undetectable. This directly answers "from the user's point of view."

2. **Handoff / take-control for walls.** Reuse the Phase 1 viewport. On login /
   CAPTCHA / MFA, pause and let the user act in the live browser, then resume. This is
   the reliable, ethical answer to "bypass those tests" — don't bypass, *delegate to
   the human* for the 5 seconds it takes.

3. **Evaluate `chrome-use` as an upgrade to `agent-browser`.** It's a fork of the
   exact CLI we picked, already adding stealth + extension-relay + anti-detection +
   humanize. Could collapse several of these steps into one dependency.

4. **Stealth only as the headless/background fallback.** If we later run tasks without
   the user's window (server-side, scheduled), use **nodriver** (Chrome-aligned) or
   **Patchright** + **rebrowser-patches**, not Camoufox (Firefox/Python is off-stack).

5. **Security/consent guardrails (non-negotiable):**
   - Never upload the user's cookies/profile to any cloud.
   - Per-site consent before first authenticated use; destructive-action confirm gates
     (purchase, send, delete) — reuse `confirm-dialog.tsx`.
   - Prefer credential *injection* over credential *copying* for headless flows.
   - Respect site ToS / robots; this capability is for the user acting as themselves,
     not for mass scraping.

---

## Revised phase impact

- **Phase 1 (live viewport)** — unchanged, but now *also* the substrate for handoff.
- **New Phase 1.5 — "Real session"**: extension-relay / debugging-port attach to the
  user's Chrome + per-site consent. This is what unlocks logged-in tasks.
- **New Phase 2 addition — "Take control / handoff"**: pause-resume + interactive
  viewport for login/CAPTCHA/MFA.
- **Phase 3 fallback — stealth headless**: nodriver/Patchright for window-less runs.
