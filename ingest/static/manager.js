// Fretwork library manager.
//
// Drop a tab file, confirm what was read out of it, and it becomes a
// catalogue row the phone can sync (ADR-006). Two rules shape this file:
//
// 1. alphaTab does the parsing, not us and not Python. It reads every format
//    the player supports, so a file it cannot open is one the player could
//    not have opened either, and the drop zone is the right place to find
//    that out rather than on the phone hours later.
// 2. Nothing is written until the metadata has been seen. Titles inside tab
//    files are routinely blank, lowercase, or the transcriber's name.

const API = ''; // same origin

// --- ULID ------------------------------------------------------------------
// Byte-for-byte the algorithm in app/src/db/ulid.ts. Song ids generated here
// share an id space with ids generated on the phone, and practice events are
// keyed by them, so the two must not drift.

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ENCODING_LEN = ENCODING.length;

function encodeTime(now) {
  let mut = now;
  let str = '';
  for (let i = 9; i >= 0; i--) {
    const mod = mut % ENCODING_LEN;
    str = ENCODING.charAt(mod) + str;
    mut = (mut - mod) / ENCODING_LEN;
  }
  return str;
}

function encodeRandom() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let str = '';
  for (let i = 0; i < 16; i++) str += ENCODING.charAt(bytes[i] % ENCODING_LEN);
  return str;
}

function ulid() {
  return encodeTime(Date.now()) + encodeRandom();
}

// --- format ----------------------------------------------------------------
// Mirrors TAB_FORMATS in api.py and TabFormat in app/src/core/types.ts.

const EXTENSION_FORMATS = {
  gp: 'gp',
  gpx: 'gpx',
  gp5: 'gp5',
  gp4: 'gp4',
  gp3: 'gp3',
  xml: 'musicxml',
  musicxml: 'musicxml',
  mxl: 'musicxml',
};

function formatFor(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return EXTENSION_FORMATS[ext] || null;
}

// --- element handles -------------------------------------------------------

const el = (id) => document.getElementById(id);
const dropzone = el('dropzone');
const fileInput = el('file-input');
const confirmPanel = el('confirm');
const messageEl = el('message');
const songsEl = el('songs');

/** The file waiting on the confirm form: {bytes, name, format}. */
let pending = null;

// --- messages --------------------------------------------------------------

function showMessage(text, isError) {
  messageEl.textContent = text;
  messageEl.classList.toggle('is-error', Boolean(isError));
  messageEl.hidden = false;
}

function clearMessage() {
  messageEl.hidden = true;
}

// --- parsing ---------------------------------------------------------------

const alphaTabReady = () =>
  !window.__alphaTabMissing && typeof window.alphaTab !== 'undefined';

/**
 * Read what we can out of the file. Returns null when alphaTab is unavailable
 * or the file will not open, so the caller decides whether that is fatal.
 */
function parseScore(bytes) {
  if (!alphaTabReady()) return null;
  try {
    const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(
      new Uint8Array(bytes),
    );
    return {
      title: (score.title || '').trim(),
      artist: (score.artist || '').trim(),
      album: (score.album || '').trim(),
      tempo: score.tempo || null,
      tracks: (score.tracks || []).map((t, i) => ({
        index: i,
        name: (t.name || '').trim() || `Track ${i + 1}`,
      })),
    };
  } catch (err) {
    return { error: err && err.message ? err.message : String(err) };
  }
}

// --- the drop flow ---------------------------------------------------------

async function handleFile(file) {
  clearMessage();
  const format = formatFor(file.name);
  if (!format) {
    showMessage(
      `${file.name} is not a tab file this player can open. Guitar Pro or MusicXML only.`,
      true,
    );
    return;
  }

  const bytes = await file.arrayBuffer();
  const parsed = parseScore(bytes);

  // alphaTab opened it and objected: refuse now rather than store a file the
  // player will fail on later.
  if (parsed && parsed.error) {
    showMessage(`alphaTab could not read ${file.name}: ${parsed.error}`, true);
    return;
  }

  pending = { bytes, name: file.name, format };
  fillForm(file.name, parsed);
  confirmPanel.hidden = false;
  el('f-title').focus();
}

function fillForm(filename, parsed) {
  el('confirm-file').textContent = `${filename} (${pending.format})`;
  el('f-title').value = parsed ? parsed.title : '';
  el('f-artist').value = parsed ? parsed.artist : '';
  el('f-album').value = parsed ? parsed.album : '';
  el('f-tempo').value = parsed && parsed.tempo ? parsed.tempo : '';

  const select = el('f-track');
  select.innerHTML = '';
  const tracks = parsed && parsed.tracks.length ? parsed.tracks : [{ index: 0, name: 'Track 1' }];
  for (const track of tracks) {
    const option = document.createElement('option');
    option.value = String(track.index);
    option.textContent = `${track.index + 1}. ${track.name}`;
    select.appendChild(option);
  }
}

function resetForm() {
  pending = null;
  confirmPanel.hidden = true;
  fileInput.value = '';
  for (const id of ['f-title', 'f-artist', 'f-album', 'f-tempo']) {
    el(id).classList.remove('is-invalid');
  }
}

// --- saving ----------------------------------------------------------------

async function save() {
  if (!pending) return;

  const title = el('f-title').value.trim();
  const artist = el('f-artist').value.trim();
  el('f-title').classList.toggle('is-invalid', !title);
  el('f-artist').classList.toggle('is-invalid', !artist);
  if (!title || !artist) {
    showMessage('Title and artist are required.', true);
    return;
  }

  const saveBtn = el('save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Adding...';

  try {
    // Upload first: /songs rejects a tab hash with no blob behind it, so this
    // order is the one that cannot leave a catalogue row pointing at nothing.
    const blobRes = await fetch(`${API}/blob`, {
      method: 'POST',
      body: pending.bytes,
    });
    if (!blobRes.ok) throw new Error(await describeError(blobRes));
    const { hash } = await blobRes.json();

    const tempo = parseInt(el('f-tempo').value, 10);
    const songRes = await fetch(`${API}/songs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: ulid(),
        title,
        artist,
        album: el('f-album').value.trim() || null,
        source_id: 'purchased',
        tab_blob_hash: hash,
        tab_format: pending.format,
        default_track_index: parseInt(el('f-track').value, 10) || 0,
        target_tempo_bpm: Number.isFinite(tempo) ? tempo : null,
      }),
    });
    if (!songRes.ok) throw new Error(await describeError(songRes));

    resetForm();
    showMessage(`Added ${title}.`, false);
    await loadLibrary();
  } catch (err) {
    showMessage(err.message || String(err), true);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Add to library';
  }
}

async function describeError(response) {
  try {
    const body = await response.json();
    if (typeof body.detail === 'string') return body.detail;
    return JSON.stringify(body.detail || body);
  } catch {
    return `Request failed (${response.status}).`;
  }
}

// --- library list ----------------------------------------------------------

async function loadLibrary() {
  try {
    const response = await fetch(`${API}/library`);
    if (!response.ok) throw new Error(`Could not load the library (${response.status}).`);
    renderLibrary((await response.json()).songs);
  } catch (err) {
    showMessage(err.message, true);
  }
}

function renderLibrary(songs) {
  songsEl.innerHTML = '';
  el('empty').hidden = songs.length > 0;
  el('count').textContent = songs.length ? `(${songs.length})` : '';

  for (const song of songs) {
    const li = document.createElement('li');
    li.className = song.archived ? 'song is-archived' : 'song';

    const text = document.createElement('div');
    text.className = 'song__text';
    const title = document.createElement('div');
    title.className = 'song__title';
    title.textContent = song.title;
    const sub = document.createElement('div');
    sub.className = 'song__sub';
    sub.textContent = [song.artist, song.tab_format, song.target_tempo_bpm ? `${song.target_tempo_bpm} BPM` : null]
      .filter(Boolean)
      .join(' · ');
    text.append(title, sub);
    li.append(text);

    if (song.bundles.length) {
      const tag = document.createElement('span');
      tag.className = 'tag tag--audio';
      tag.textContent = 'audio';
      li.append(tag);
    }

    if (!song.archived) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn--danger';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => archive(song));
      li.append(remove);
    }

    songsEl.append(li);
  }
}

async function archive(song) {
  // Worth spelling out what this does: the row survives, and so does every
  // practice event attached to it. Nothing here can destroy history.
  const ok = window.confirm(
    `Remove "${song.title}" from the library?\n\n` +
      'It disappears from the phone but its practice history is kept, so ' +
      're-adding it later picks up where you left off.',
  );
  if (!ok) return;

  try {
    const response = await fetch(`${API}/songs/${encodeURIComponent(song.id)}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error(await describeError(response));
    await loadLibrary();
  } catch (err) {
    showMessage(err.message, true);
  }
}

// --- status ----------------------------------------------------------------

async function checkHealth() {
  try {
    const response = await fetch(`${API}/health`);
    const body = await response.json();
    el('status-dot').className = 'dot is-ok';
    el('status-text').textContent = `service ${body.version}`;
  } catch {
    el('status-dot').className = 'dot is-bad';
    el('status-text').textContent = 'service unreachable';
  }
}

// --- wiring ----------------------------------------------------------------

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) void handleFile(fileInput.files[0]);
});

// dragover must be cancelled or the browser navigates to the dropped file
// and the whole window is replaced by it.
for (const type of ['dragenter', 'dragover']) {
  dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    dropzone.classList.add('is-over');
  });
}
for (const type of ['dragleave', 'drop']) {
  dropzone.addEventListener(type, () => dropzone.classList.remove('is-over'));
}
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) void handleFile(file);
});

// The window is the drop target, not just the zone: a file dropped anywhere
// else would otherwise be opened by the browser, losing the page.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

el('save').addEventListener('click', () => void save());
el('cancel').addEventListener('click', () => {
  resetForm();
  clearMessage();
});

if (!alphaTabReady()) {
  const warning = el('parser-warning');
  warning.textContent =
    'alphaTab is not loaded, so titles and tempo cannot be read from files ' +
    'automatically. You can still add tabs by filling the form in yourself. ' +
    'Run npm install in app/ and restart to fix.';
  warning.hidden = false;
}

void checkHealth();
void loadLibrary();
