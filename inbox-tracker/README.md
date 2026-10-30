# Inbox tracker

`tracker.gs` runs as a 15-minute time trigger inside the sending mailbox's Google Apps Script project. Because it runs on Google's side, the CRM keeps updating when the rest of the system is offline.

| Function | Role |
|---|---|
| `ownText` | Removes quoted history from a reply (Gmail, Outlook and `>` styles, including Gmail's line-wrapped "On … wrote:") |
| `money` | One amount from a line: currency marks, `k`, `L` / `lakh` / `lac`, `/-`. Rejects years, durations and anything under 500 |
| `rates` | Amount per deliverable (Reel, Story, Reel + Story, YT Short, YT Long, Ad rights 1 month / 12 months), line by line and comma by comma, carrying ad-rights context to the next line |
| `stageOf` | Do not contact > Not interested > Quote received (rates, or a rate card attached) > Interested > Replied |
| `core` | Reduces names and handles to a comparable core ("Asha Rao (Official)", `iamasharao`, `asharao.official` → `asharao`) |
| `track_` | Reads the threads, matches each to a CRM row, moves the status forward, fills empty cells, and lists replies it could not match on their own tab |

Rules it keeps:

- Only conversations the mailbox took part in count, so newsletters and notifications are ignored.
- Statuses only move forward. The team's own stages (e.g. Negotiating, Booked) are never changed.
- The sender's own name is used to guess the creator only for replies, never names on the To line. A test email to a colleague must not match a creator.
- A guessed match also needs a unique core. When two creators share one, the reply is left for a person to link.
