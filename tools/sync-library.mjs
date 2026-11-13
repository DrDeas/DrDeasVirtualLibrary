#!/usr/bin/env node
// Refreshes the library's local snapshot from the DrDeasBookLog repository:
//
//   1. data.js            – offline fallback copy of the book list
//   2. covers/atlas-N.webp – thumbnail sheets so 400+ covers load in a few requests
//   3. covers/atlas.json   – which cover lives in which cell of which sheet
//
// The library works without running this (new books are fetched live, one cover at a
// time), but running it after adding a batch of books keeps the first load fast.
//
//   cd tools && npm install && npm run sync

import { mkdir, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_URL = 'https://raw.githubusercontent.com/DrDeas/DrDeasBookLog/main/data.js';
const CACHE = process.env.COVER_CACHE || join(ROOT, 'tools', '.cache');
const OUT = join(ROOT, 'covers');

// Sheet layout. Each cover is stored at INNER_W x INNER_H with a PAD-pixel border of
// repeated edge colour, so neighbouring covers never bleed into each other when the
// GPU samples a shrunken copy of the sheet.
const PAGE = 2048;
const COLS = 10;
const ROWS = 7;
const PAD = 2;
const CELL_W = Math.floor(PAGE / COLS);
const CELL_H = Math.floor(PAGE / ROWS);
const INNER_W = CELL_W - PAD * 2;
const INNER_H = CELL_H - PAD * 2;
const PER_PAGE = COLS * ROWS;

function parseBooks(source) {
  const start = source.indexOf('[');
  const end = source.lastIndexOf(']');
  if (start < 0 || end < 0) throw new Error('data.js does not contain a book array');
  const books = JSON.parse(source.slice(start, end + 1));
  return books.sort((a, b) => a.number - b.number);
}

async function fetchBuffer(url, attempts = 4) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (i + 1 >= attempts) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
}

async function coverBuffer(url) {
  const file = join(CACHE, url.split('/').pop());
  if (existsSync(file) && (await stat(file)).size > 0) return readFile(file);
  const buf = await fetchBuffer(url);
  await writeFile(file, buf);
  return buf;
}

async function pool(items, size, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i], i);
      }
    })
  );
  return results;
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  await mkdir(OUT, { recursive: true });

  console.log('Fetching book list…');
  const source = (await fetchBuffer(DATA_URL)).toString('utf8');
  const books = parseBooks(source);
  await writeFile(join(ROOT, 'data.js'), source);
  console.log(`  ${books.length} books`);

  console.log('Preparing covers…');
  const missing = [];
  const tiles = await pool(books, 8, async (book) => {
    try {
      const buf = await coverBuffer(book.customCoverUrl);
      return await sharp(buf)
        .resize(INNER_W, INNER_H, { fit: 'fill' })
        .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, extendWith: 'copy' })
        .toBuffer();
    } catch (err) {
      missing.push(`#${book.number} ${book.title} (${err.message})`);
      return null;
    }
  });

  // Covers that could not be read are simply left out; the library loads those live.
  const placed = books.map((book, i) => ({ book, tile: tiles[i] })).filter((p) => p.tile);

  for (const name of await readdir(OUT)) {
    if (/^atlas-\d+\.webp$/.test(name)) await rm(join(OUT, name));
  }

  const pages = [];
  for (let p = 0; p * PER_PAGE < placed.length; p++) {
    const slice = placed.slice(p * PER_PAGE, (p + 1) * PER_PAGE);
    const name = `atlas-${p}.webp`;
    await sharp({ create: { width: PAGE, height: PAGE, channels: 3, background: '#1a120c' } })
      .composite(
        slice.map((entry, i) => ({
          input: entry.tile,
          left: (i % COLS) * CELL_W,
          top: Math.floor(i / COLS) * CELL_H,
        }))
      )
      .webp({ quality: 82, effort: 5 })
      .toFile(join(OUT, name));
    pages.push(name);
    console.log(`  ${name} (${slice.length} covers)`);
  }

  const manifest = {
    generated: new Date().toISOString().slice(0, 10),
    page: PAGE,
    cols: COLS,
    rows: ROWS,
    cellW: CELL_W,
    cellH: CELL_H,
    pad: PAD,
    pages,
    covers: placed.map((p) => p.book.customCoverUrl),
  };
  await writeFile(join(OUT, 'atlas.json'), JSON.stringify(manifest));

  console.log(`Done: ${placed.length} covers on ${pages.length} sheets.`);
  if (missing.length) {
    console.warn(`\n${missing.length} cover(s) could not be loaded and were skipped:`);
    for (const m of missing) console.warn('  ' + m);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
