const fs = require('fs');
const path = require('path');

/** Loads the pure reply-reading functions from the Apps Script source, which has no module system. */
function tracker() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'inbox-tracker', 'tracker.gs'), 'utf8').replace(/\r/g, '');
  const from = src.indexOf('function ownText');
  const to = src.indexOf('function trackInbox');
  if (from < 0 || to < 0) throw new Error('tracker functions not found in tracker.gs');
  return new Function(`${src.slice(from, to)}; return { ownText, money, rates, stageOf };`)();
}

module.exports = { tracker };
