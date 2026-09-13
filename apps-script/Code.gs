/**
 * Shared Bet Ledger - the cloud half.
 *
 * One Google Sheet behind all five boards (MLB Edge, NCAAF Edge Lab,
 * NFL Edge Lab, Props Edge, Ladder). Every board keeps working exactly as it
 * does now, against the browser's own storage; this script is the place those
 * copies meet, so a bet added on a phone shows up on a laptop and a bet settled
 * on the laptop shows up on the phone.
 *
 * HOW TO INSTALL  (there is a step-by-step version of this in SETUP-SYNC.md)
 *   1. Make a new Google Sheet. Name it "Bet Ledger".
 *   2. Extensions -> Apps Script. Delete whatever is in the editor.
 *   3. Paste this whole file in. Save.
 *   4. Pick "setup" in the function dropdown and press Run. Authorise it.
 *      The Execution log prints your secret token - copy it somewhere safe.
 *   5. Deploy -> New deployment -> type "Web app".
 *        Execute as:      Me
 *        Who has access:  Anyone
 *      Deploy, copy the /exec URL.
 *   6. Open each board, tap "Sync", paste the URL and the token, tap Connect.
 *
 * "Anyone" only means anyone who knows the URL can reach the script. The token
 * is what actually lets them in, so treat it like a password: it is typed into
 * each device once and is never committed to any of the public repositories.
 */

var SHEET_BETS = 'bets';
var SHEET_SETTINGS = 'settings';
var SHEET_DEVICES = 'devices';
var SCHEMA = 1;

/* The flat columns exist so the sheet is readable and sortable by hand. The
 * app's own record travels verbatim in native_json, so a board can be restored
 * to the exact shape its own code expects without this script having to know
 * anything about run lines, ladders or player props. */
var COLUMNS = [
  'id', 'app', 'sport', 'placed_at', 'event_date', 'event', 'market',
  'selection', 'side', 'line', 'price', 'book', 'stake', 'tier', 'edge',
  'model_prob', 'status', 'pnl', 'closing_price', 'score', 'notes',
  'updated_at', 'device', 'deleted', 'native_json'
];

var NUMERIC = { line: 1, price: 1, stake: 1, edge: 1, model_prob: 1, pnl: 1, closing_price: 1 };

/* ------------------------------------------------------------------ setup */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, SHEET_BETS, COLUMNS);
  ensureSheet_(ss, SHEET_SETTINGS, ['key', 'value', 'updated_at']);
  ensureSheet_(ss, SHEET_DEVICES, ['device', 'app', 'last_seen', 'rows_pushed']);

  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TOKEN');
  if (!token) {
    token = randomToken_();
    props.setProperty('TOKEN', token);
  }
  var settings = readSettings_(ss);
  if (settings.starting_bankroll == null) {
    writeSetting_(ss, 'starting_bankroll', 250);
    writeSetting_(ss, 'currency', 'CAD');
  }

  Logger.log('=================================================');
  Logger.log('  Your sync token:  ' + token);
  Logger.log('=================================================');
  Logger.log('Paste it, with the deployment URL, into the Sync panel on each board.');
  Logger.log('Starting bankroll is on the "settings" tab - edit it there.');
  return token;
}

/** Run this if you ever want a fresh token (every device must be reconnected). */
function resetToken() {
  var token = randomToken_();
  PropertiesService.getScriptProperties().setProperty('TOKEN', token);
  Logger.log('New token: ' + token);
  return token;
}

function randomToken_() {
  var chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  var out = '';
  for (var i = 0; i < 28; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

function ensureSheet_(ss, name, header) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  var width = Math.max(header.length, sh.getLastColumn());
  var current = sh.getLastRow() ? sh.getRange(1, 1, 1, width).getValues()[0] : [];
  var same = current.length >= header.length;
  for (var i = 0; same && i < header.length; i++) if (String(current[i]) !== header[i]) same = false;
  if (!same) {
    sh.getRange(1, 1, 1, header.length).setValues([header]);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/* ------------------------------------------------------------- entrypoints */

function doGet(e) {
  return handle_(e, (e && e.parameter) || {});
}

function doPost(e) {
  var body = {};
  try {
    if (e && e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply_(e, { ok: false, error: 'bad_json' });
  }
  var params = {};
  var k;
  for (k in (e && e.parameter) || {}) params[k] = e.parameter[k];
  for (k in body) params[k] = body[k];
  return reply_(e, route_(params));
}

function handle_(e, params) {
  return reply_(e, route_(params));
}

function route_(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!expected) return { ok: false, error: 'not_set_up', hint: 'Run setup() in the Apps Script editor.' };
  if (!safeEqual_(String(params.token || ''), expected)) return { ok: false, error: 'bad_token' };

  var action = String(params.action || 'pull');
  if (action === 'ping') return { ok: true, now: nowIso_(), schema: SCHEMA };
  if (action === 'pull') return pull_(params);
  if (action === 'push') return push_(params);
  if (action === 'settings') return saveSettings_(params);
  return { ok: false, error: 'unknown_action', action: action };
}

/* Length-checked, constant-ish comparison. The token is not a password hash and
 * this is one person's betting ledger, but there is no reason to leak length or
 * to short-circuit on the first wrong character. */
function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------------------------------------------- read */

function pull_(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var since = String(params.since || '');
  var all = readBets_(ss);
  var rows = [];
  for (var i = 0; i < all.length; i++) {
    if (!since || String(all[i].updated_at) > since) rows.push(all[i]);
  }
  return {
    ok: true,
    now: nowIso_(),
    schema: SCHEMA,
    full: !since,
    total: all.length,
    rows: rows,
    settings: readSettings_(ss)
  };
}

/* ------------------------------------------------------------------ write */

function push_(params) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { ok: false, error: 'busy' };
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ensureSheet_(ss, SHEET_BETS, COLUMNS);
    var incoming = params.rows || [];
    if (typeof incoming === 'string') incoming = JSON.parse(incoming);
    var now = nowIso_();

    var existing = readBets_(ss, true);       // includes _row
    var index = {};
    for (var i = 0; i < existing.length; i++) index[existing[i].id] = existing[i];

    var appends = [], updates = [], applied = 0, skipped = 0;

    for (var j = 0; j < incoming.length; j++) {
      var row = normalise_(incoming[j]);
      if (!row.id || !row.app) { skipped++; continue; }
      var prev = index[row.id];

      if (prev) {
        /* A device that has been offline can arrive holding a stale copy of a
         * bet that has since been graded somewhere else. Losing a settlement
         * that way is the one failure that actually costs money to reconstruct,
         * so a Pending write never overwrites a result the sheet already has. */
        if (prev.status && prev.status !== 'Pending' && row.status === 'Pending' &&
            String(prev.updated_at) > String(row.base_rev || '')) {
          skipped++;
          continue;
        }
        row.updated_at = now;
        row.device = row.device || prev.device;
        updates.push({ rowNumber: prev._row, values: toValues_(row) });
      } else {
        row.updated_at = now;
        appends.push(toValues_(row));
      }
      index[row.id] = row;
      applied++;
    }

    for (var u = 0; u < updates.length; u++) {
      sh.getRange(updates[u].rowNumber, 1, 1, COLUMNS.length).setValues([updates[u].values]);
    }
    if (appends.length) {
      sh.getRange(sh.getLastRow() + 1, 1, appends.length, COLUMNS.length).setValues(appends);
    }

    if (params.settings) applySettings_(ss, params.settings);
    if (params.device) touchDevice_(ss, params.device, params.app, applied);

    /* A push doubles as a pull so a board only needs one round trip: everything
     * the sheet has changed since this device last looked comes back with it. */
    var since = String(params.since || '');
    var after = readBets_(ss);
    var back = [];
    for (var k = 0; k < after.length; k++) {
      if (!since || String(after[k].updated_at) > since) back.push(after[k]);
    }

    return {
      ok: true, now: now, schema: SCHEMA, applied: applied, skipped: skipped,
      total: after.length, rows: back, settings: readSettings_(ss)
    };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------- rows */

function readBets_(ss, withRowNumbers) {
  var sh = ensureSheet_(ss, SHEET_BETS, COLUMNS);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, COLUMNS.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = {};
    for (var c = 0; c < COLUMNS.length; c++) row[COLUMNS[c]] = values[i][c];
    if (!row.id) continue;
    row.id = String(row.id);
    row.deleted = row.deleted === true || String(row.deleted).toLowerCase() === 'true';
    row.updated_at = isoish_(row.updated_at);
    row.placed_at = isoish_(row.placed_at);
    row.event_date = dateish_(row.event_date);
    for (var n in NUMERIC) row[n] = row[n] === '' || row[n] == null ? null : Number(row[n]);
    if (withRowNumbers) row._row = i + 2;
    out.push(row);
  }
  return out;
}

function normalise_(raw) {
  var row = {};
  for (var i = 0; i < COLUMNS.length; i++) {
    var key = COLUMNS[i];
    var v = raw[key];
    if (key === 'native_json') {
      if (raw.native != null && v == null) v = JSON.stringify(raw.native);
      row[key] = v == null ? '' : String(v);
    } else if (NUMERIC[key]) {
      row[key] = (v === '' || v == null || isNaN(Number(v))) ? '' : Number(v);
    } else if (key === 'deleted') {
      row[key] = v === true || String(v).toLowerCase() === 'true';
    } else {
      row[key] = v == null ? '' : String(v);
    }
  }
  row.base_rev = raw.base_rev || raw.updated_at || '';
  if (!row.status) row.status = 'Pending';
  return row;
}

function toValues_(row) {
  var out = [];
  for (var i = 0; i < COLUMNS.length; i++) {
    var key = COLUMNS[i];
    var v = row[key];
    out.push(v == null ? '' : v);
  }
  return out;
}

/* --------------------------------------------------------------- settings */

function readSettings_(ss) {
  var sh = ensureSheet_(ss, SHEET_SETTINGS, ['key', 'value', 'updated_at']);
  var last = sh.getLastRow();
  var out = { starting_bankroll: null, currency: 'CAD' };
  if (last < 2) return out;
  var values = sh.getRange(2, 1, last - 1, 3).getValues();
  for (var i = 0; i < values.length; i++) {
    var k = String(values[i][0] || '').trim();
    if (!k) continue;
    var v = values[i][1];
    out[k] = (k === 'starting_bankroll') ? Number(v) || 0 : v;
    out[k + '_updated_at'] = isoish_(values[i][2]);
  }
  return out;
}

function writeSetting_(ss, key, value) {
  var sh = ensureSheet_(ss, SHEET_SETTINGS, ['key', 'value', 'updated_at']);
  var last = sh.getLastRow();
  var now = nowIso_();
  if (last >= 2) {
    var keys = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]).trim() === key) {
        sh.getRange(i + 2, 2, 1, 2).setValues([[value, now]]);
        return;
      }
    }
  }
  sh.getRange(sh.getLastRow() + 1, 1, 1, 3).setValues([[key, value, now]]);
}

function applySettings_(ss, incoming) {
  var current = readSettings_(ss);
  for (var key in incoming) {
    if (key.indexOf('_updated_at') >= 0) continue;
    var stamp = incoming[key + '_updated_at'] || '';
    var mine = current[key + '_updated_at'] || '';
    if (current[key] != null && mine && stamp && stamp <= mine) continue;
    writeSetting_(ss, key, incoming[key]);
  }
}

function saveSettings_(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  applySettings_(ss, params.settings || {});
  return { ok: true, now: nowIso_(), settings: readSettings_(ss) };
}

function touchDevice_(ss, device, app, pushed) {
  var sh = ensureSheet_(ss, SHEET_DEVICES, ['device', 'app', 'last_seen', 'rows_pushed']);
  var last = sh.getLastRow();
  var now = nowIso_();
  var label = String(device) + ' / ' + String(app || '');
  if (last >= 2) {
    var rows = sh.getRange(2, 1, last - 1, 2).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) + ' / ' + String(rows[i][1]) === label) {
        sh.getRange(i + 2, 3, 1, 2).setValues([[now, pushed]]);
        return;
      }
    }
  }
  sh.getRange(sh.getLastRow() + 1, 1, 1, 4).setValues([[device, app || '', now, pushed]]);
}

/* ------------------------------------------------------------------ utils */

function nowIso_() {
  return new Date().toISOString();
}

function isoish_(v) {
  if (v == null || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return v.toISOString();
  return String(v);
}

function dateish_(v) {
  if (v == null || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd');
  return String(v).slice(0, 10);
}

/* A cross-origin GET from a page cannot always read a normal JSON response, so
 * every reply can also come back wrapped in a callback the page supplied. */
function reply_(e, payload) {
  var cb = e && e.parameter && e.parameter.callback;
  var text = JSON.stringify(payload);
  if (cb && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(cb)) {
    return ContentService.createTextOutput(cb + '(' + text + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}
