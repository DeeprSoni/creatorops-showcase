// Excerpt from CreatorOps (private). The Sheet web app around it (setup/upsert/read, book(), props(), TAB) is not included.
// Runs as a time trigger inside the sending mailbox's Apps Script project.

// ---------- Gmail tracker: runs every 15 minutes (installTrigger) and moves creators along the stages

// Statuses the system may set, in order; it only ever moves a row forward, and never touches Negotiating or Booked.
const RANK = { 'New': 0, 'Shortlisted': 1, 'Quoted on HashFame': 1, 'Emailed': 2, 'Emailed (manual)': 2, 'Bounced': 3, 'Replied': 4,
  'Interested': 5, 'Quote received': 6, 'Not interested': 7, 'Do not contact': 8 };
const UNMATCHED = 'Inbox: not in CRM';

/** Creates the 15-minute trigger (run once from the editor). */
function installTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'trackInbox').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('trackInbox').timeBased().everyMinutes(15).create();
  props().deleteProperty('INBOX_SINCE'); // look back 90 days again
  trackInbox();
}

/** "Asha Rao (Official)", "iamasharao", "asharao.official" -> "asharao". */
function core(s) {
  return String(s || '').toLowerCase().replace(/[^a-z]/g, '').replace(/officials|official|offical|^iam|^the|^its|music|singer|vlogs?$/g, '');
}

/** Strips the quoted earlier messages from a reply, leaving what the person wrote. */
function ownText(body) {
  const cut = body.search(/\n\s*(On [\s\S]{5,200}?wrote:|-----\s*Original Message|From:\s.+\nSent:|>)/i); // Gmail wraps long "On ... wrote:" lines
  return (cut > 0 ? body.slice(0, cut) : body).trim();
}

// "₹1,50,000", "Rs 8000", "25k", "2.7 L", "4 Lakhs", "20,000/-". Short forms need their unit ("2.7" alone is not money).
const AMOUNT = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(k|lakhs?|lacs?|l)?\b|(\d+(?:\.\d+)?\s*(?:k|lakhs?|lacs?|l)\b|[\d,]{3,}(?:\.\d+)?)\s*(?:\/-|rs\.?|inr|₹|rupees)?/i;
function money(line) {
  const m = AMOUNT.exec(line);
  if (!m) return null;
  const raw = (m[1] || m[3] || '').replace(/[,\s]/g, '').toLowerCase();
  const unit = (m[2] || (raw.match(/(k|lakhs?|lacs?|l)$/) || [])[1] || '').toLowerCase();
  const n = parseFloat(raw);
  if (isNaN(n)) return null;
  const v = Math.round(n * (unit === 'k' ? 1e3 : unit ? 1e5 : 1));
  if (!m[1] && !unit && !/\/-|rs|inr|₹|rupees/i.test(m[0]) && /^(19|20)\d\d$/.test(raw)) return null; // a year, e.g. "27 Oct 2026"
  return v >= 500 && v <= 5e7 ? v : null; // ignores dates, follower counts written short, phone numbers
}

/** Rates a reply names, by deliverable: one line per deliverable, e.g. "Reel - 25k", "Story: Rs 8,000". */
function rates(text) {
  const out = {};
  let prevAd = false;
  // Lines, and comma-separated parts of a line ("Ad rights 1 month 10k, 12 months 50k"); "8,000" stays whole.
  text.split(/\n|;|,(?=\s*\D)/).forEach(line => {
    let l = line.toLowerCase();
    if (prevAd && /month|year|yr|annual/.test(l) && !/\brights?\b|usage/.test(l)) l = 'ad rights ' + l;
    prevAd = /\brights?\b|usage|whitelist|paid ads?/.test(l);
    if (/\d{10}/.test(l.replace(/[\s-]/g, '')) && !/₹|rs|inr|k\b/.test(l)) return; // phone number
    const v = money(line);
    if (v === null) return;
    let k = null;
    if (/\brights?\b|usage|whitelist|paid ads?/.test(l)) k = /12|year|annual|yr/.test(l) ? 'quote: Ad Rights 12mo' : 'quote: Ad Rights 1mo';
    else if (/reel/.test(l) && /stor/.test(l)) k = 'quote: IG Reel + Story';
    else if (/short/.test(l)) k = 'quote: YT Short';
    else if (/youtube|\byt\b|long|integration|dedicated video/.test(l)) k = 'quote: YT Long';
    else if (/reel/.test(l)) k = 'quote: IG Reel (30/60 sec)';
    else if (/stor/.test(l)) k = 'quote: IG Story';
    if (k && !(k in out)) out[k] = v;
    else if (!k && !('any' in out)) out.any = v;
  });
  return out;
}

function stageOf(text, files) {
  const t = text.toLowerCase();
  if (/unsubscribe|remove me|stop (emailing|sending)|don'?t (email|contact) me/.test(t)) return 'Do not contact';
  if (/not interested|no,? thanks|not (taking|doing|accepting) (any )?(paid |brand )?(collab|promotion|partnership)|will pass|not a fit|decline/.test(t)) return 'Not interested';
  // Rates in the text, or a rate card sent as an attachment.
  if (Object.keys(rates(text)).length || (files && /rate ?card|commercials?|charges|pricing|price|cost|quote|rates/.test(t))) return 'Quote received';
  if (/interested|happy to (collab|work|connect|discuss|partner)|would love to|let'?s (connect|talk|discuss|do)|sounds (good|great)|count me in|share (the )?(brief|details|more)|keen|open to|sure[,!. ]|okay[,!. ]|yes[,!. ]|call me|whats ?app me|reach me/.test(t)) return 'Interested';
  return 'Replied';
}

function trackInbox() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(120000)) return;
  try { track_(); } finally { lock.releaseLock(); }
}

function track_() {
  const ss = book();
  const sh = ss.getSheetByName(TAB);
  const width = sh.getLastColumn();
  const head = sh.getRange(1, 1, 1, width).getValues()[0].map(String);
  const col = {};
  head.forEach((h, i) => { col[h] = i; });
  const last = sh.getLastRow();
  if (last < 2) return;
  const range = sh.getRange(2, 1, last - 1, width);
  const vals = range.getValues();
  const forms = range.getFormulas();
  const byEmail = {};
  const byHandle = {};
  const cores = []; // [core of handle or name, row] for matching a new address to a creator
  vals.forEach((r, i) => {
    String(r[col.email] || '').toLowerCase().split(/[;,\s]+/).filter(e => e.includes('@')).forEach(e => { byEmail[e] = i; });
    const h = (String(r[col['ig link']] || '').match(/instagram\.com\/([\w.]+)/i) || [])[1];
    if (h) { byHandle[h.toLowerCase()] = i; cores.push([core(h), i]); }
    if (r[col.name]) cores.push([core(r[col.name]), i]);
  });
  // An address like asharao.official@gmail.com, or the sender's name, matches one creator (@iamasharao).
  const guess = (address, name) => {
    const keys = [core(address.split('@')[0]), core(name)].filter(k => k.length >= 5);
    const hits = new Set();
    cores.forEach(([c, i]) => { if (c.length >= 5 && keys.some(k => k === c || k.includes(c) || c.includes(k))) hits.add(i); });
    return hits.size === 1 ? [...hits][0] : null;
  };

  const me = Session.getEffectiveUser().getEmail().toLowerCase();
  const p = props();
  const since = Number(p.getProperty('INBOX_SINCE') || 0);
  // First run looks back 90 days; later runs from the last run, with an hour of overlap.
  const after = since ? Math.floor(since / 1000) - 3600 : Math.floor(Date.now() / 1000) - 90 * 86400;
  const threads = GmailApp.search(`after:${after} -in:spam -in:trash -in:drafts`, 0, 400);
  const tz = Session.getScriptTimeZone();
  const changed = {};
  const unmatched = [];
  const linked = {};
  const addr = s => String(s || '').toLowerCase().match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) || [];

  const set = (i, k, v, only) => {
    if (!(k in col)) return;
    const cur = forms[i][col[k]] || vals[i][col[k]];
    if (only === 'empty' && cur !== '') return;
    if (String(cur) === String(v)) return;
    vals[i][col[k]] = v; forms[i][col[k]] = ''; changed[i] = true;
  };
  const advance = (i, stage, when) => {
    const cur = String(vals[i][col.status] || '');
    if (cur !== '' && !(cur in RANK)) return;          // a status the team chose
    if (cur !== '' && RANK[stage] <= RANK[cur]) return;
    set(i, 'status', stage);
    set(i, 'last update', Utilities.formatDate(when, tz, 'yyyy-MM-dd'));
  };

  threads.forEach(th => {
    const msgs = th.getMessages();
    const ours = msgs.some(m => addr(m.getFrom()).includes(me));
    if (!ours) return; // only conversations we are part of: no newsletters or notifications
    const link = 'https://mail.google.com/mail/u/0/#all/' + th.getId();
    let row = null;
    const people = new Set();
    msgs.forEach(m => {
      const from = addr(m.getFrom())[0] || '';
      if (from === me) addr(m.getTo() + ',' + m.getCc()).filter(a => a !== me).forEach(a => people.add(a));
      else if (!/mailer-daemon|postmaster|no-?reply/.test(from)) people.add(from);
    });
    people.forEach(a => { if (row === null && a in byEmail) row = byEmail[a]; });
    if (row === null) {
      // Not in the CRM by address: try the address and sender name against handles and names, then fill the email.
      const reply = msgs.map(m => m.getFrom()).find(f => !addr(f).includes(me) && !/mailer-daemon|postmaster|no-?reply/i.test(f));
      const other = reply || msgs.map(m => m.getTo()).find(Boolean) || '';
      const a = addr(other).filter(x => x !== me)[0];
      if (a) {
        // The sender's own name counts; a name in our To line is only what we typed (a test can carry anyone's name).
        const g = guess(a, reply ? other.replace(/<.*>/, '').replace(/"/g, '') : '');
        if (g !== null) { row = g; set(row, 'email', a, 'empty'); byEmail[a] = row; }
      }
    }
    msgs.forEach(m => {
      const from = addr(m.getFrom())[0] || '';
      const when = m.getDate();
      const body = m.getPlainBody() || '';
      if (/mailer-daemon|postmaster/.test(from)) {
        addr(body).forEach(a => { if (a in byEmail) advance(byEmail[a], 'Bounced', when); });
        return;
      }
      if (from === me) {
        if (row !== null) advance(row, 'Emailed', when);
        return;
      }
      const text = ownText(body);
      // A reply from an address not in the CRM can still name the creator's Instagram.
      if (row === null) {
        const h = (text.match(/instagram\.com\/([\w.]+)/i) || text.match(/(?:^|\s)@([\w.]{3,30})/) || [])[1];
        if (h && h.toLowerCase() in byHandle) { row = byHandle[h.toLowerCase()]; set(row, 'email', from, 'empty'); }
      }
      const stage = stageOf(text, m.getAttachments().length > 0);
      if (row === null) {
        unmatched.push([Utilities.formatDate(when, tz, 'yyyy-MM-dd HH:mm'), from, th.getFirstMessageSubject(), stage, text.slice(0, 300), link, th.getId()]);
        return;
      }
      advance(row, stage, when);
      const r = rates(text);
      Object.keys(r).forEach(k => { if (k !== 'any') set(row, k, r[k], 'empty'); });
      set(row, 'msg', Utilities.formatDate(when, tz, 'd MMM') + ': ' + text.replace(/\s+/g, ' ').slice(0, 250), 'empty');
    });
    if (row !== null) { set(row, 'email thread', link); linked[th.getId()] = true; }
  });

  Object.keys(changed).forEach(i => sh.getRange(Number(i) + 2, 1, 1, width).setValues([vals[i].map((v, c) => forms[i][c] || v)]));

  // Replies that could not be matched to a creator, for the team to link (put the address in that creator's email cell).
  if (unmatched.length) {
    const un = ss.getSheetByName(UNMATCHED) || ss.insertSheet(UNMATCHED);
    if (un.getLastRow() === 0) {
      un.appendRow(['date', 'from', 'subject', 'looks like', 'what they wrote', 'thread', 'thread id']);
      un.getRange(1, 1, 1, 7).setFontWeight('bold');
      un.setFrozenRows(1);
      un.getRange('A:G').setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP).setVerticalAlignment('top');
      un.setColumnWidth(5, 420);
    }
    const seen = {};
    if (un.getLastRow() > 1) un.getRange(2, 7, un.getLastRow() - 1, 1).getValues().forEach((r, j) => { seen[r[0]] = j + 2; });
    unmatched.forEach(u => {
      if (seen[u[6]]) un.getRange(seen[u[6]], 1, 1, 7).setValues([u]);
      else { un.appendRow(u); seen[u[6]] = un.getLastRow(); }
    });
  }
  // Threads linked to a creator since they were listed here leave this tab.
  const unTab = ss.getSheetByName(UNMATCHED);
  if (unTab && unTab.getLastRow() > 1) {
    const ids = unTab.getRange(2, 7, unTab.getLastRow() - 1, 1).getValues().map(r => String(r[0]));
    for (let j = ids.length - 1; j >= 0; j--) if (linked[ids[j]]) unTab.deleteRow(j + 2);
    unTab.setRowHeightsForced(2, Math.max(1, unTab.getLastRow() - 1), 36);
  }
  p.setProperty('INBOX_SINCE', String(Date.now()));
  return { threads: threads.length, updated: Object.keys(changed).length, unmatched: unmatched.length };
}
