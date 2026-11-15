# Showcase runbook (food bank volunteering event, 2026-11-13)

How to run the live BiteDown demo from this Windows PC, and what to do when something breaks.
Presenter script: [`DEMO.md`](DEMO.md). Setup details: [`SETUP.md`](SETUP.md) ("Showcase").

**How it fits together:** phones run the Android APK or the web app (`https://bitedown.expo.app`). Both read the
backend address from `https://bitedown.expo.app/api-config.json`. The backend is docker compose on this PC, put on the
internet by `scripts\serve_public.ps1` (Tailscale Funnel if approved, otherwise a Cloudflare quick tunnel).

## The night before (owner)
1. **Power:** Windows Settings, System, Power: when plugged in, never sleep and never turn off the screen. Keep the PC
   plugged in. A sleeping PC takes the backend offline for everyone.
2. **Gemini billing:** enable billing (prepay 10 to 20 USD, budget alert at 10 USD). An event of about 100 people
   costs about 1 to 2 USD; billing mainly lifts the free-tier rate limits that caused 429s before. If the key
   changes, update `GEMINI_API_KEY` in `.env`, then `docker compose up -d --force-recreate api`.
3. **Optional, best:** have the tailnet admin approve Funnel for this PC
   (https://login.tailscale.com/f/funnel?node=nYD94JSEKw11CNTRL). Funnel gives a fixed address that the APK already
   has built in, so no republish is ever needed.
4. **Go live once:** start Docker Desktop, then double-click `scripts\start_showcase.cmd` and leave the window open.
   Wait for the "Demo URLs" block. If it prints `API URL PUBLISH FAILED`, read the error; it retries every 2 minutes.
5. **Check from a phone on mobile data (not the PC's Wi-Fi):** open `https://bitedown.expo.app`, log in with the demo
   account, open Fridge. Install the new APK on one Android phone and do the same.

## Morning of (T minus 60 minutes)
1. The `serve_public` window is still open and shows no repeated warnings. If it was closed, run it again (a
   Cloudflare address changes on every start; the script republishes it, and apps pick it up within a minute).
2. `http://127.0.0.1:5055/health` on the PC answers `{"status":"ok"}`.
3. On the presenter phone: open the app, pull through Home, Fridge and Impact with the demo account.
4. Do one photo scan and one text add on the presenter phone, then remove those test items (Used it).

## Demo account
`demo@bitedown.app`; the password is in `.env.demo` on this PC (gitignored). The account has 13 items: spinach and
leftover pasta expire tomorrow, yogurt and chicken in 2 days, the rest later, across Fridge, Pantry and Freezer, with
prices so Money saved moves. Impact already shows earlier removals (used and thrown out). Attendees should **sign up
with their own email**; there is no rate limit per network, so a whole venue on one Wi-Fi is fine.

## When something breaks
| Symptom | Likely cause | Fix |
|---|---|---|
| App says "Can't reach BiteDown" for everyone | Tunnel or PC down | Check the `serve_public` window and `http://127.0.0.1:5055/health`. Restart the script. Phones recover on their own (they refetch the config every 60 s and after a network error). |
| `bitedown.expo.app` shows "No worker deployment was found" right after a publish | The production alias is still propagating (the first deploy on 2026-11-13 took about 6 minutes) | Wait and refresh. Meanwhile the deployment's own URL works (listed under Hosting > Deployments on expo.dev). |
| The script warns "can't resolve ... yet (local DNS cache)" | The router cached "not found" for a brand-new tunnel name | Nothing: phones use their own DNS. The watchdog doesn't count it as a failure. |
| One phone can't reach the server | Venue Wi-Fi blocks the tunnel, or a stale address | Switch that phone to mobile data. Or tap **Server settings** (welcome, login or error screen) and check the address. |
| Nothing works and time is short | Backend unreachable | On the presenter phone, tap **Server settings**, turn on **Demo mode**, create any account. The app then runs on the phone alone: the fridge starts empty, and photo, text and recipes return sample results, so the whole demo path (add, remove, Undo, Impact) still works. Say so to the audience. |
| Photo scan says the scanner is busy | Gemini overloaded | Try again; the backend already falls back across 3 models (`GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS`). Use **Add by text** as the backup demo. |
| Barcode scanner on iPhone never scans | The web scanner's download is blocked | Tap **Type it instead**. |
| Recipe card missing on Home | Gemini slow or failing | Home still works; the card appears when Gemini answers. Recipes tab has its own retry. |
| Web app loads but every action fails | CORS | The `serve_public` window warns about it. Add `https://bitedown.expo.app` to `CORS_ORIGINS` in `.env`, then `docker compose up -d --force-recreate api`. |
| A removal shows an error, then the item is gone | First response was lost | Nothing to do: a retry now counts as done and offers Undo. |

## Limits to mention honestly
- Photo detection and receipt reading use Gemini (`source: "gemini"`); the YOLO service is not running for the demo.
- Expiry dates are estimates from category defaults and Gemini; they can be edited.
- iPhone uses the web app (Add to Home Screen); a native iOS build needs a paid Apple account.
- Google Sign-In is not in the Expo app yet.
