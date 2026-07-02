# Delphi — App Store Submission Guide

Everything you need to get Delphi onto the US App Store, and what's already done.
Work top-to-bottom. Items marked **[you]** need your hands (Apple/Netlify accounts);
items marked **[code]** are things I still need to build in the app.

---

## 0. Status so far

**Done**
- Backend hardened: auth gate, burst rate-limiting, input caps, `max_tokens`.
- Per-device **monthly USD metering** with **free ($0.50)** and **paid ($2.00)** tiers,
  both tunable via env vars. Verified end-to-end with real API calls.
- Monorepo: `ios/` + `web/`, Netlify builds from `web/` (verified).
- iOS **limit reminder window** (free/paid variants) + dev preview via `TEST_ADMIN`.
- Hosted **Privacy Policy, Terms of Use, Support** pages.

**Still to build [code]** (next coding sessions)
- First-launch **Terms acceptance** gate.
- **Report** action on a reply (email-based).
- **StoreKit** subscription: the actual $1.99/mo purchase + restore + set `isPaid`.

---

## 1. Netlify (backend) — do this first  [you]

In the Netlify dashboard for the site (delphi-web):

1. **Environment variables** (Site configuration → Environment variables):
   - `OPENROUTER_API_KEY` — already set; keep it.
   - `APP_SHARED_TOKEN` = `cCx6MQkSGsGtw3cBe_PHqIYZjeyUGwHbDxm-rbSEZLw`
     (matches the token compiled into the app — turns on the auth gate).
   - *(optional)* `FREE_BUDGET_USD` = `0.5`, `PAID_BUDGET_USD` = `2` — only if you want
     to change the defaults later.
2. **Redeploy** (the monorepo move changed the build to `base = "web"`; confirm the deploy
   succeeds and the site still loads).
3. **Verify** the pages are live:
   - https://delphi-web.netlify.app/privacy.html
   - https://delphi-web.netlify.app/terms.html
   - https://delphi-web.netlify.app/support.html
4. Keep your **OpenRouter balance low with auto-reload OFF** — your hard backstop.

> Order matters: only set `APP_SHARED_TOKEN` once the app build that carries the token is
> the one you're running, or older builds get 401. The web app keeps working either way.

---

## 2. GitHub  [you + me]

I'll run these with your go-ahead (no force-push; the rename auto-redirects):
```
gh repo rename delphi -R j1mmy2hang/delphi-web
git remote set-url origin https://github.com/j1mmy2hang/delphi.git
git push origin main
```
Then Netlify keeps deploying via the redirect (or point it at the renamed repo once).

---

## 3. Apple Developer / App Store Connect  [you]

### 3a. Create the app record
- App Store Connect → **My Apps → + → New App**.
- Platform iOS, Name **Delphi** (see trademark note below), Primary language English (U.S.),
  Bundle ID **com.jimmyzhang.delphi**, SKU `delphi-ios`.
- ⚠️ **Trademark:** "Delphi" is a crowded name (Embarcadero's Delphi language, Delphi auto
  parts). The bundle ID is fine, but consider a more distinctive **display name** (e.g.
  "Delphi — Think Clearer") to reduce rejection/legal risk. You can change the display name
  without touching code.

### 3b. Agreements, Tax & Banking (required to charge)
- App Store Connect → **Business** → accept the **Paid Apps Agreement**, then complete
  **Tax** (W-8BEN as a China-based individual; use the China–US treaty) and **Banking**.
  Payments can't happen until this is green.
- Join the **Small Business Program** (15% fee instead of 30%) — you qualify.

### 3c. Subscription product (for the paid tier)
- **Monetization → Subscriptions** → create a **Subscription Group** (e.g. "Delphi Plus").
- Add an **auto-renewable subscription**:
  - Reference name: `Delphi Plus Monthly`
  - Product ID: **`com.jimmyzhang.delphi.plus.monthly`** (I'll use this exact id in code)
  - Duration: 1 month, Price: **US$1.99** (Apple sets regional equivalents).
  - Add a localized display name ("Delphi Plus"), description, and a review screenshot.
- This is what my StoreKit code (next session) will purchase.

### 3d. App Privacy "nutrition label" (App Store Connect → App Privacy)
Answer exactly:
- **Do you collect data?** Yes (minimal).
- **User Content → Other User Content** (the messages): **Used for App Functionality**;
  **Not linked to identity**; **Not used for tracking**.
- **Identifiers → Device ID** (our anonymous usage id): **App Functionality / Fraud
  prevention**; **Not linked to identity**; **Not used for tracking**.
- **Purchases**: handled by Apple — you may mark Purchase History → App Functionality, not
  linked, not tracking.
- Everything else: **No**. Tracking: **No**.

### 3e. Age rating
- Set to **17+**. In the questionnaire, mark **"Unrestricted Web Access" No**, but flag
  **frequent/intense mature themes possible via AI-generated content** honestly — open-ended
  AI generation generally lands at 17+.

### 3f. Export compliance
- In Xcode Info (or App Store Connect), set **`ITSAppUsesNonExemptEncryption` = NO**
  (you only use standard HTTPS, which is exempt). Avoids the question on every upload.

### 3g. Store listing / metadata
Use the copy in `docs/app-store-metadata.md`. You'll also need:
- **Screenshots**: 6.9" iPhone (required) + 6.5"; iPad 13" (your app is universal). Capture
  from the simulator or device.
- **Privacy Policy URL**: `https://delphi-web.netlify.app/privacy.html`
- **Support URL**: `https://delphi-web.netlify.app/support.html`
- **App Review notes**: mention there's no login; the AI is a general reflection companion;
  include how to reach the Report feature. (Do **not** mention the `TEST_ADMIN` dev code — it's
  DEBUG-only and won't exist in the App Store build.)

---

## 4. Xcode — build & upload  [you]

1. Open **`ios/Delphi.xcodeproj`** (the copy inside the monorepo now).
2. Signing: Team already set to your paid team (`F65N98WT62`), automatic signing.
3. Set **Version** 1.0 and **Build** 1 (bump the build each upload).
4. **Product → Archive** → **Distribute App → App Store Connect → Upload**.
5. In App Store Connect, attach the build to the version, fill metadata, submit for review.
6. Use **TestFlight** first to test on your phone (incl. sandbox subscription purchases).

---

## 5. Before you submit — final checks
- [ ] Terms acceptance gate + Report action shipped (I build these) — Apple requires them for AI apps.
- [ ] StoreKit purchase working in sandbox; `isPaid` flips on purchase; Restore Purchases works.
- [ ] `APP_SHARED_TOKEN` set on Netlify and matches the app.
- [ ] Privacy/Support URLs load.
- [ ] Screenshots for all required sizes.
- [ ] Age rating 17+, export compliance NO, privacy label filled.

---

## 6. Money & cost notes
- Each message currently costs **~$0.006** (mostly the 2,088-token system prompt sent every
  turn). So free ≈ **~80 msgs/mo**, paid ≈ **~310 msgs/mo**.
- **Paid-tier margin warning:** $1.99 − Apple's 15% ≈ **$1.69** net, but the paid cap allows
  **$2.00** of spend. A user who maxes out is a small net loss. Options: raise the price, lower
  `PAID_BUDGET_USD`, or accept it (most users won't max out). All tunable via env vars.
- **Big cost win available:** enable **prompt caching** on the system prompt — it's re-sent
  uncached every call today. Caching can cut per-message cost ~10×, stretching both tiers far
  further. Worth doing before/after launch.
