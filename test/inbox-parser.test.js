// The Gmail tracker's reply reading (inbox-tracker/tracker.gs) is plain JavaScript, so it is tested here outside Apps Script.
// Every reply below is invented.
const test = require('node:test');
const assert = require('node:assert');
const { tracker } = require('./helpers');

const { ownText, money, rates, stageOf } = tracker();

test('ownText keeps only what the sender wrote, even when Gmail wraps the "On ... wrote:" line', () => {
  const body = 'Thank you for your offer.\n\nOn Mon, 26 Oct 2026 at 6:28 PM, Acme Team <team@acme.test>\nwrote:\n\n> Reel - 80k';
  assert.strictEqual(ownText(body), 'Thank you for your offer.');
  assert.strictEqual(ownText('Sure!\n-----Original Message-----\nFrom: x'), 'Sure!');
});

test('money understands Indian and shorthand amounts', () => {
  assert.strictEqual(money('Reel - 25k'), 25000);
  assert.strictEqual(money('Story: Rs 8,000'), 8000);
  assert.strictEqual(money('₹1,50,000 for both'), 150000);
  assert.strictEqual(money('YT long 2.7 L'), 270000);
  assert.strictEqual(money('Ad rights 1 year: 4 Lakhs'), 400000);
  assert.strictEqual(money('20,000/-'), 20000);
});

test('money ignores years, small numbers and dates', () => {
  assert.strictEqual(money('On 27 Oct 2026 we spoke'), null);
  assert.strictEqual(money('30/60 sec video'), null);
  assert.strictEqual(money('12 months'), null);
});

test('rates maps each line to the deliverable it names', () => {
  const r = rates('Insta reel - 45k\nStory - 4k\nReel+story - 47k\nYouTube short - 5k\nYt long - 50k\nRights - 1 month - 5k\nRights - 12 months - 30k');
  assert.deepStrictEqual(r, {
    'quote: IG Reel (30/60 sec)': 45000, 'quote: IG Story': 4000, 'quote: IG Reel + Story': 47000, 'quote: YT Short': 5000,
    'quote: YT Long': 50000, 'quote: Ad Rights 1mo': 5000, 'quote: Ad Rights 12mo': 30000,
  });
});

test('rates skips phone numbers', () => {
  assert.deepStrictEqual(rates('Call my manager on 98765 43210'), {});
});

test('stageOf reads where the conversation is', () => {
  assert.strictEqual(stageOf('Reel 55k\nStory 15k'), 'Quote received');
  assert.strictEqual(stageOf('I would love to be a part of the collaboration! Talk to my manager.'), 'Interested');
  assert.strictEqual(stageOf('Not interested in paid collaborations right now, thanks.'), 'Not interested');
  assert.strictEqual(stageOf('Please remove me from your list'), 'Do not contact');
  assert.strictEqual(stageOf('Thank you for your offer.'), 'Replied');
});

test('rates reads usage rights written without "ad", and a 12-month line that follows a rights line', () => {
  assert.deepStrictEqual(rates('Rights - 1 month - 5k\nRights - 12 months - 30k'), { 'quote: Ad Rights 1mo': 5000, 'quote: Ad Rights 12mo': 30000 });
  assert.deepStrictEqual(rates('Ad right-1 month 10k\n12 month-80k'), { 'quote: Ad Rights 1mo': 10000, 'quote: Ad Rights 12mo': 80000 });
  assert.deepStrictEqual(rates('Ad rights 1 month 10k, 12 months 50k'), { 'quote: Ad Rights 1mo': 10000, 'quote: Ad Rights 12mo': 50000 });
});
