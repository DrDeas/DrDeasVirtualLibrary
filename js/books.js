// Loads the book list. The library reads it live from the DrDeasBookLog repository so
// a book added to the log appears here with no further work; the copy of data.js that
// ships with this site is only used when the log cannot be reached.

const LIVE_URL = 'https://raw.githubusercontent.com/DrDeas/DrDeasBookLog/main/data.js';
const LOCAL_URL = 'data.js';

function parse(source) {
  const start = source.indexOf('[');
  const end = source.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('no book array found');
  const body = source.slice(start, end + 1);
  let list;
  try {
    list = JSON.parse(body);
  } catch {
    // Hand-edited files sometimes pick up a trailing comma, which JSON forbids.
    list = JSON.parse(body.replace(/,(\s*[\]}])/g, '$1'));
  }
  if (!Array.isArray(list) || !list.length) throw new Error('book array is empty');
  return list;
}

async function fetchText(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-cache' });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function normalise(list) {
  const books = list
    .filter((b) => b && b.title)
    .map((b) => ({
      number: Number(b.number) || 0,
      title: String(b.title),
      author: String(b.author || ''),
      category: String(b.category || 'Uncategorised'),
      ownership: String(b.ownership || ''),
      status: String(b.status || ''),
      dateCompleted: b.dateCompleted || '',
      cover: b.customCoverUrl || '',
      summary: String(b.summary || ''),
    }))
    .sort((a, b) => a.number - b.number);
  books.forEach((b, i) => {
    b.slot = i;
    b.finished = b.status === 'Finished';
    b.year = b.dateCompleted ? Number(b.dateCompleted.slice(0, 4)) : null;
    b.search = `${b.title} ${b.author} ${b.category}`.toLowerCase();
  });
  return books;
}

export async function loadBooks() {
  let source = 'live';
  let list;
  try {
    list = parse(await fetchText(LIVE_URL, 8000));
  } catch (err) {
    console.warn('Book log unreachable, using the bundled copy.', err);
    source = 'bundled';
    list = parse(await fetchText(LOCAL_URL, 20000));
  }
  return { books: normalise(list), source };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

export function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return '';
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}
