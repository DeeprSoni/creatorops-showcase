# Identity resolution

`resolve.py` is the part of the CRM build that decides who is the same person.

**Keys, strongest first**

- Instagram handle, normalised from links, `@handles` and pasted page titles. Post and reel links are rejected.
- Marketplace username, treated as an Instagram handle too.
- YouTube channel: `@name`, `channel/…`, `c/…` or `user/…`.
- Email, lower-cased.
- Name, only when a row has no other key.

**`merge(groups)`** folds rows in source order. The first source wins where both have a value. Empty fields are filled from later sources, the furthest status wins, and lead sources and notes are combined. Two rows with different Instagram handles never merge, because agencies use one email for many creators.

**`assign_ids(people)`** gives each person an ID (`T0001`, …) that survives rebuilds:

- IDs are stored against every strong key the person has had, so a creator who later gains a YouTube link keeps their ID.
- Email and name keys only assign an ID to rows with no handle or channel. Two people who share an address never collapse into one.

The readers for each source (xlsx/csv header mapping, PDF rosters through link positions, marketplace reports) and the Google Sheet sync are not included.
