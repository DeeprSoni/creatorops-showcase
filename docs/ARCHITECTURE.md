# Architecture

## Design goals

- **Runs on one machine, no cloud bill.** It uses Node's built-in SQLite, a real Chrome, the mailbox you already have and a Google Sheet the team already knows.
- **Safe by default.** It warms up slowly, works only during set hours, backs off on platform warnings and stops sending on bad signals. Nobody is emailed twice, and opt-outs are honoured everywhere.
- **The team's sheet is the source of truth for people work.** Automation only fills empty cells, refreshes its own number columns and moves statuses forward. It never overwrites what a person typed and never touches the team's own stages (Negotiating, Booked).

## Data flow

1. **Queue → workers.** Each Instagram account runs a worker that claims the highest-priority handle, reads the profile and its related accounts, and queues the related ones with a priority.
   - The priority rises with the size band, niche match and "proven branch" (accounts whose neighbours already produced contactable creators).
   - A **drift guard** demotes branches whose results keep falling outside the band, niche or country, so the crawl doesn't wander into brands or other countries.
2. **Enrichment.** Bio emails are ranked against link-in-bio pages, the creator's own site (found from links, then the contact page) and Cloudflare-obfuscated addresses.
   - Each email gets a confidence: high, medium, low or rejected. Low ones go to a review list on the dashboard.
   - MX records are checked before anything is sent.
   - YouTube numbers come from the channel's public videos page.
3. **Outreach.** The mailer picks creators who are outreach-ready: home country, in band, trusted email, accepts mail, not a brand, never emailed.
   - Sends are plain text, one at a time, spread across the sending hours.
   - The daily cap is `min(provider max, start + days × step, queue / 4 + new per day)`. It ramps up for reputation and never empties the queue in one burst.
   - IMAP sync marks bounces (`X-Failed-Recipients`) and replies.
4. **CRM build (`tools/crm.py`).** Collected creators, team spreadsheets, PDF rosters and marketplace reports are merged into one row per person:
   - Rows are keyed by Instagram handle → marketplace username → YouTube channel → email → name.
   - Two different handles never merge, even when they share an email, because agencies manage many creators under one address.
   - IDs are stable across rebuilds (`crm-ids.json`). Rows the team deleted stay deleted (`crm-pushed.json`).
5. **Sheet web app (`tools/crm-sheet.gs`, `doPost`).** Token-protected `setup` / `upsert` / `read`.
   - Upserts are batched (400 rows) and follow per-column rules: fill when empty, always refresh, or status-by-rank.
   - The ER % column is a formula, so it updates as numbers change.
6. **Reply tracker (`trackInbox`, every 15 minutes in the mailbox's own Apps Script).** For each thread the mailbox took part in:
   - **Match the creator:** by any address in the thread, then by an Instagram link or @handle in the reply, then by a "core" of the sender's own name compared with handles ("Asha Rao (Official)", `iamasharao` → `asharao`).
   - **Strip quoted history:** including Gmail's wrapped "On … wrote:" lines.
   - **Classify:** Do not contact > Not interested > Quote received (rates, or a rate card attached) > Interested > Replied.
   - **Parse rates per deliverable:** `25k`, `₹1,50,000`, `2.7 L`, `4 Lakhs`, `20,000/-`. Phone numbers, years and durations are rejected. "12 months …" lines inherit the ad-rights context of the line before.
   - **Write:** status (forward only), last update, thread link, the first reply into `msg`, and quotes into empty cells.
   - **Unmatched replies** go to an "Inbox: not in CRM" tab and drop off once linked.

## Trust boundaries

| Boundary | Protection |
|---|---|
| Dashboard | Listens on 127.0.0.1 only |
| Owner page through the tunnel | Basic auth with a generated password, a timing-safe compare and lockout after 8 failures. Everything else is refused when the request arrives through the tunnel |
| Sheet web app | Shared-secret token in every request; executes as the owner |
| Secrets | `data/` only (app password, API key, token, browser profiles); git-ignored and never sent to a page |

## Why these choices

- **Plain text email, no tracking pixel, no bulk headers.** Plain text from a real mailbox lands in Primary. HTML sent through an ESP was sorted into Promotions in testing.
- **Apps Script for the tracker** instead of polling IMAP from the collector: it runs on Google's side, so progress keeps updating when the PC is off.
- **Sheet as the CRM** instead of a custom UI: zero onboarding for the team, and filters, comments and sharing come for free.
