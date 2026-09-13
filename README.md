# Ledger HQ

Every bet from every board, in one place — and the shared ledger the five boards
sync through.

The boards ([mlb-edge](https://github.com/chillychilly14/mlb-edge),
[ncaaf-edge-lab](https://github.com/chillychilly14/ncaaf-edge-lab),
[nfl-edge-lab](https://github.com/chillychilly14/nfl-edge-lab),
[props-edge](https://github.com/chillychilly14/props-edge),
[ladderbet](https://github.com/chillychilly14/ladderbet)) each keep their bets in
the browser, as they always have. This repository holds the two things that let
those copies agree with each other:

- **`apps-script/Code.gs`** — the Google Apps Script behind one Google Sheet.
  It is the only server involved, it is free, and the sheet is yours to read and
  edit by hand.
- **`betsync.js`** — the client the boards load. It works out what changed on
  this device, sends it, takes back what changed elsewhere, and resolves the
  disagreements. It is byte-identical in all five boards.

And the page itself:

- **`index.html` + `hq.js`** — the cross-sport dashboard. Combined bankroll and
  its curve, ROI by board, tier and market, open bets you can settle from your
  phone, closing-line value, and a CSV export.

**Setup: [SETUP-SYNC.md](SETUP-SYNC.md)** — written for someone who has never
opened Apps Script. About ten minutes, once.

## How the pieces fit

Each board keeps its own ledger in its own shape, because each sport needs a
different one — a run line is not a player prop is not a ladder rung. The sheet
stores a flat row per bet with the columns every sport shares, plus the board's
own record carried verbatim in `native_json`. So the sheet stays readable and
sortable, a cross-sport view is possible, and no board loses anything it depends
on by passing through.

Conflicts resolve on the sheet's clock: the later write wins, with one exception
enforced on the server — a device that has been offline can never push a bet
back to "pending" over a result the sheet already has. Losing a settlement is
the only failure here that costs real money to reconstruct.

## One bankroll

All five boards size their stakes off one number: what you started with, plus
every settled result anywhere. Set it once, in any Sync panel or on this page.
A losing weekend on the props board shrinks the next MLB stake, which is the
point — five separate bankrolls that only exist on paper are five ways to be
more exposed than you think.

## Tests

```sh
node tests/test_betsync.mjs   # what gets sent, what wins a conflict, what the bankroll comes to
node tests/test_server.mjs    # the real Code.gs and the real client, two devices, one sheet
```

Both run offline with no browser: the sync layer is pure functions and the Apps
Script runs against an in-memory spreadsheet. Each board also has its own
`tests/test_sync.mjs` checking that its bets survive the round trip unchanged.

## Privacy

The web app URL and the token live in each browser's own storage and are never
committed here. "Anyone with the link" is how a Google Apps Script web app is
published; the token is what actually grants access. `resetToken` in the Apps
Script editor issues a new one if you ever need to.
