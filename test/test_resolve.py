"""Identity resolution (identity-resolution/resolve.py): one row per person across scraped data, team sheets and rosters.
Run: python -m unittest discover -s test -p "test_*.py"   (all people below are invented)"""
import json, os, sys, tempfile, unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'identity-resolution'))
import resolve as crm  # noqa: E402


class Keys(unittest.TestCase):
    def test_ig_handle(self):
        self.assertEqual(crm.ig_handle('https://www.instagram.com/asha.rao_/?utm_source=x'), 'asha.rao_')
        self.assertEqual(crm.ig_handle('@Asha.Rao'), 'asha.rao')
        self.assertEqual(crm.ig_handle('https://www.instagram.com/reel/Cxyz/'), '')
        self.assertEqual(crm.ig_handle('not a handle at all'), '')

    def test_yt_key(self):
        self.assertEqual(crm.yt_key('https://youtube.com/@AshaRao?si=1'), '@asharao')
        self.assertEqual(crm.yt_key('https://www.youtube.com/channel/UC123abc'), 'channel/uc123abc')

    def test_clean_num(self):
        self.assertEqual(crm.clean_num('12.5K'), 12500)
        self.assertEqual(crm.clean_num('1.2 lakh'), 120000)
        self.assertEqual(crm.clean_num('3M'), 3000000)

    def test_clean_name(self):
        self.assertEqual(crm.clean_name('Asha Rao | Certified Fitness Coach ✨'), 'Asha Rao')


class Merge(unittest.TestCase):
    def test_same_handle_merges_and_keeps_both_sources(self):
        team = [{'_handle': 'asha.rao', 'msg': 'Rates on request', 'status': 'Shortlisted', 'lead source': 'Sheet: Fitness'}]
        scraped = [{'_handle': 'asha.rao', 'ig followers': 52000, 'status': 'New', 'lead source': 'Collector', 'msg': ''}]
        merged, dupes = crm.merge([team, scraped])
        self.assertEqual((len(merged), dupes), (1, 1))
        p = merged[0]
        self.assertEqual(p['ig followers'], 52000)            # filled from the second source
        self.assertEqual(p['msg'], 'Rates on request')        # the first source wins
        self.assertEqual(p['status'], 'Shortlisted')          # the further status wins
        self.assertEqual(p['lead source'], 'Sheet: Fitness + Collector')

    def test_youtube_and_email_link_rows_without_a_handle(self):
        a = [{'yt link': 'https://youtube.com/@ashafit', 'name': 'Asha', 'lead source': 'A'}]
        b = [{'_handle': 'asha.fit', 'yt link': 'https://www.youtube.com/@AshaFit', 'lead source': 'B'}]
        c = [{'email': 'Team@AshaFit.test', 'name': 'Asha F', 'lead source': 'C'}]
        d = [{'_handle': 'asha.fit', 'email': 'team@ashafit.test', 'lead source': 'D'}]
        merged, _ = crm.merge([a, b, c, d])
        self.assertEqual(len(merged), 2)  # a+b+d (YouTube, then handle) and c joins through the email
        self.assertEqual(sum(1 for p in merged if p.get('_handle') == 'asha.fit'), 1)

    def test_agency_email_never_merges_two_creators(self):
        rows = [[{'_handle': 'creator.one', 'email': 'bookings@agency.test', 'lead source': 'X'}],
                [{'_handle': 'creator.two', 'email': 'bookings@agency.test', 'lead source': 'Y'}]]
        merged, dupes = crm.merge(rows)
        self.assertEqual((len(merged), dupes), (2, 0))

    def test_marketplace_username_counts_as_instagram_handle(self):
        merged, _ = crm.merge([[{'_hf': 'asha.rao', 'lead source': 'Report'}], [{'_handle': 'asha.rao', 'lead source': 'Collector'}]])
        self.assertEqual(len(merged), 1)


class Ids(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self._data, crm.DATA = crm.DATA, self.tmp

    def tearDown(self):
        crm.DATA = self._data

    def test_ids_are_stable_between_runs_and_survive_new_keys(self):
        first = [{'_handle': 'asha.rao'}, {'_handle': 'ben.k'}]
        crm.assign_ids(first)
        second = [{'_handle': 'new.person'}, {'_handle': 'ben.k', 'yt link': 'https://youtube.com/@benk'}, {'_handle': 'asha.rao'}]
        crm.assign_ids(second)
        self.assertEqual({p['_handle']: p['id'] for p in second},
                         {'asha.rao': first[0]['id'], 'ben.k': first[1]['id'], 'new.person': 'T0003'})
        with open(os.path.join(self.tmp, 'crm-ids.json'), encoding='utf-8') as f:
            saved = json.load(f)
        self.assertEqual(saved['yt:@benk'], first[1]['id'])


if __name__ == '__main__':
    unittest.main()
