// The page around the 3D view: welcome screen, search, category filter, the bar that
// shows where you are in the log, and the panel that opens when a book is chosen.

import * as THREE from 'three';
import { formatDate } from './books.js';
import { challengeStats } from './signage.js';
import { BAY, PER_BAY, CHALLENGE, clamp, slotPlacement } from './config.js';

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

export class Interface {
  constructor({ books, layout, player, input, wall, camera, canvas }) {
    Object.assign(this, { books, layout, player, input, wall, camera, canvas });
    this.selected = null;
    this.hovered = null;
    this.pointer = null; // last mouse position over the view, awaiting a hover test
    this.raycaster = new THREE.Raycaster();
    this.touring = true;

    this._stats();
    this._timeline();
    this._filters();
    this._search();
    this._panel();
    this._pointer();
    this._touch();
    this._misc();
  }

  // ---- Welcome ------------------------------------------------------------

  progress(fraction) {
    $('loadingBar').style.width = `${Math.round(fraction * 100)}%`;
  }

  ready(source) {
    $('loading').classList.add('done');
    const enter = $('enter');
    enter.textContent = 'Enter the library';
    enter.disabled = false;
    enter.focus();
    const coarse = matchMedia('(pointer: coarse)').matches;
    $('introHint').textContent = coarse
      ? 'Drag to look · use the stick to walk · tap a cover to open it'
      : 'Drag to look · W A S D to walk · hold Space to follow the ramp · click a cover to open it';
    if (source === 'bundled') {
      $('introLede').textContent += ' (The live reading log could not be reached, so this is the last saved copy.)';
    }
    enter.addEventListener('click', () => {
      $('intro').classList.add('leaving');
      setTimeout(() => { $('intro').hidden = true; }, 950);
      $('hud').hidden = false;
      this.setTour(false);
    }, { once: true });
  }

  setTour(on) {
    this.touring = on;
    this.input.enabled = !on;
    $('btnTour').textContent = on ? 'Walk' : 'Overview';
    if (on) { this.close(); this.player.startTour(); } else this.player.stopTour();
  }

  // ---- Header and timeline ------------------------------------------------

  _stats() {
    const s = challengeStats(this.books);
    $('stats').textContent = `${s.finished.toLocaleString()} of 1,000 books · week ${s.week.toLocaleString()} of ${s.totalWeeks.toLocaleString()}`;
  }

  _timeline() {
    const slots = this.layout.slots;
    $('trackFill').style.width = `${(this.books.length / slots) * 100}%`;
    const ticks = $('trackTicks');
    const seen = new Set();
    for (const book of this.books) {
      if (!book.year || seen.has(book.year)) continue;
      seen.add(book.year);
      const tick = el('span');
      tick.dataset.year = seen.size === 1 ? book.year : `’${String(book.year).slice(2)}`;
      tick.style.left = `${(book.slot / slots) * 100}%`;
      ticks.append(tick);
    }
    const goal = el('span', { className: 'goal' });
    goal.dataset.year = CHALLENGE.books.toLocaleString();
    goal.style.left = `${((CHALLENGE.books - 1) / slots) * 100}%`;
    ticks.append(goal);

    $('track').addEventListener('click', (e) => {
      const box = $('track').getBoundingClientRect();
      const slot = Math.round(clamp((e.clientX - box.left) / box.width, 0, 1) * (slots - 1));
      if (this.touring) this.setTour(false);
      this.close();
      const target = this.books[slot] || { place: slotPlacement(slot, this.layout) };
      this.player.flyTo(this.player.viewOf(target));
    });
  }

  _whereLabel() {
    const p = this.player;
    if (p.tour) return 'Overview';
    if (!p.onRamp || p.u < 0) return 'The Atrium';
    if (p.u >= this.layout.uTop) return 'The Summit';
    const bay = Math.floor(p.u / BAY);
    const first = bay * PER_BAY + 1;
    const last = first + PER_BAY - 1;
    if (first > this.books.length) return `Awaiting books ${first.toLocaleString()}–${last.toLocaleString()}`;
    const here = this.books.slice(first - 1, last);
    const years = [...new Set(here.map((b) => b.year).filter(Boolean))];
    const span = years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : years[0] || 'now reading';
    return `Books ${first}–${Math.min(last, this.books.length)} · ${span}`;
  }

  // ---- Categories ---------------------------------------------------------

  _filters() {
    const counts = new Map();
    for (const b of this.books) counts.set(b.category, (counts.get(b.category) || 0) + 1);
    const box = $('filters');
    const chips = [];
    const choose = (category, chip) => {
      chips.forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      this.wall.setFilter(category ? (b) => b.category === category : null);
      $('btnFilters').textContent = category || 'Categories';
    };
    const add = (label, count, category) => {
      const chip = el('button', { type: 'button' }, label, el('small', {}, String(count)));
      chip.setAttribute('aria-pressed', String(!category));
      chip.addEventListener('click', () => choose(category, chip));
      chips.push(chip);
      box.append(chip);
    };
    add('All', this.books.length, null);
    [...counts].sort((a, b) => b[1] - a[1]).forEach(([c, n]) => add(c, n, c));

    $('btnFilters').addEventListener('click', () => {
      box.hidden = !box.hidden;
      $('btnFilters').setAttribute('aria-expanded', String(!box.hidden));
    });
  }

  // ---- Search -------------------------------------------------------------

  _search() {
    const input = $('search');
    const list = $('results');
    let matches = [];
    let active = 0;

    const render = () => {
      list.replaceChildren();
      const q = input.value.trim().toLowerCase();
      if (!q) { list.hidden = true; return; }
      const words = q.split(/\s+/);
      matches = this.books
        .filter((b) => words.every((w) => b.search.includes(w)))
        .sort((a, b) => Number(b.title.toLowerCase().startsWith(q)) - Number(a.title.toLowerCase().startsWith(q)))
        .slice(0, 8);
      active = 0;
      if (!matches.length) {
        list.append(el('li', { className: 'none', textContent: 'Nothing in the log matches that.' }));
      }
      matches.forEach((book, i) => {
        const item = el('li', { className: i === 0 ? 'active' : '' },
          el('img', { src: book.cover, alt: '', loading: 'lazy' }),
          el('div', {}, el('b', {}, book.title), el('span', {}, `${book.author} · No. ${book.number}`)));
        item.addEventListener('click', () => go(book));
        list.append(item);
      });
      list.hidden = false;
    };
    const go = (book) => {
      input.value = '';
      list.hidden = true;
      input.blur();
      this.select(book);
    };

    input.addEventListener('input', render);
    input.addEventListener('focus', render);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { input.value = ''; list.hidden = true; input.blur(); return; }
      if (!matches.length || list.hidden) return;
      if (e.key === 'Enter') { go(matches[active]); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length;
      [...list.children].forEach((li, i) => li.classList.toggle('active', i === active));
    });
    document.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.search')) list.hidden = true;
    });
  }

  // ---- Book panel ---------------------------------------------------------

  _panel() {
    $('panelClose').addEventListener('click', () => this.close());
    $('panelPrev').addEventListener('click', () => this.step(-1));
    $('panelNext').addEventListener('click', () => this.step(1));
  }

  step(by) {
    if (!this.selected) return;
    const next = this.books[this.selected.slot + by];
    if (next) this.select(next);
  }

  select(book, fly = true) {
    if (this.touring) this.setTour(false);
    this.selected = book;
    this.wall.setSelected(book);
    $('panelCover').src = book.cover;
    $('panelCover').alt = `Cover of ${book.title}`;
    $('panelNumber').textContent = `No. ${book.number} of ${this.books.length}`;
    $('panelTitle').textContent = book.title;
    $('panelAuthor').textContent = book.author;
    $('panelSummary').textContent = book.summary;
    const facts = $('panelFacts');
    facts.replaceChildren();
    if (!book.finished) facts.append(el('li', { className: 'reading', textContent: book.status || 'Reading now' }));
    if (book.dateCompleted) facts.append(el('li', { textContent: `Finished ${formatDate(book.dateCompleted)}` }));
    for (const fact of [book.category, book.ownership]) {
      if (fact) facts.append(el('li', { textContent: fact }));
    }
    $('panelPrev').disabled = book.slot === 0;
    $('panelNext').disabled = book.slot === this.books.length - 1;
    $('panel').hidden = false;
    document.querySelector('#panel .scroll').scrollTop = 0;
    document.body.classList.add('reading');
    if (fly) {
      const view = this.player.viewOf(book);
      // On a wide screen the panel covers the right-hand side, so stand a little to
      // one side and leave the book in the clear.
      if (innerWidth > 900) view.yaw -= 0.17;
      this.player.flyTo(view);
    }
  }

  close() {
    if (!this.selected) return;
    this.selected = null;
    this.wall.setSelected(null);
    $('panel').hidden = true;
    document.body.classList.remove('reading');
  }

  // ---- Pointing at books --------------------------------------------------

  _ray(x, y) {
    const ndc = new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster;
  }

  _pointer() {
    const canvas = this.canvas;
    canvas.addEventListener('pointermove', (e) => {
      this.pointer = e.pointerType === 'mouse' && e.buttons === 0 ? { x: e.clientX, y: e.clientY } : null;
      canvas.classList.toggle('dragging', e.buttons !== 0 && this.input.dragged);
      if (!this.pointer) this._hover(null);
    });
    canvas.addEventListener('pointerleave', () => { this.pointer = null; this._hover(null); });
    canvas.addEventListener('pointerup', () => canvas.classList.remove('dragging'));
    canvas.addEventListener('click', (e) => {
      if (this.input.dragged || this.touring) return;
      const book = this.wall.pick(this._ray(e.clientX, e.clientY));
      if (book) this.select(book);
    });
  }

  _hover(book, at) {
    const tip = $('tip');
    if (book !== this.hovered) {
      this.hovered = book;
      this.wall.setHover(book);
      this.canvas.classList.toggle('over-book', !!book);
      tip.hidden = !book;
      if (book) tip.replaceChildren(book.title, el('small', {}, `${book.author} · No. ${book.number}`));
    }
    if (book && at) {
      tip.style.left = `${Math.min(at.x + 16, innerWidth - 320)}px`;
      tip.style.top = `${Math.min(at.y + 18, innerHeight - 80)}px`;
    }
  }

  // ---- Touch controls -----------------------------------------------------

  _touch() {
    const stick = $('stick');
    const nub = stick.querySelector('.nub');
    const set = (x, y) => {
      this.input.stick.set(x, -y);
      nub.style.transform = `translate(${x * 33}px, ${y * 33}px)`;
    };
    const track = (e) => {
      const box = stick.getBoundingClientRect();
      let x = (e.clientX - box.left - box.width / 2) / (box.width / 2);
      let y = (e.clientY - box.top - box.height / 2) / (box.height / 2);
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      set(x, y);
    };
    stick.addEventListener('pointerdown', (e) => { stick.setPointerCapture(e.pointerId); track(e); });
    stick.addEventListener('pointermove', (e) => { if (stick.hasPointerCapture(e.pointerId)) track(e); });
    for (const type of ['pointerup', 'pointercancel']) stick.addEventListener(type, () => set(0, 0));

    for (const button of document.querySelectorAll('#stroll button')) {
      const dir = Number(button.dataset.stroll);
      button.addEventListener('pointerdown', (e) => { button.setPointerCapture(e.pointerId); this.input.buttons.stroll = dir; });
      for (const type of ['pointerup', 'pointercancel']) button.addEventListener(type, () => { this.input.buttons.stroll = 0; });
      button.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  // ---- Everything else ----------------------------------------------------

  _misc() {
    $('btnTour').addEventListener('click', () => this.setTour(!this.touring));
    $('btnHelp').addEventListener('click', () => $('help').showModal());
    this.input.onReset = () => { this.close(); this.player.home(); };

    // Capture phase, so that while a book is open the arrow keys page through the log
    // instead of walking the visitor away from it.
    window.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
      if (e.key === '/' && !typing && !$('hud').hidden) { e.preventDefault(); $('search').focus(); return; }
      if (typing || $('help').open) return;
      if (e.key === 'Escape') {
        if (!$('filters').hidden) { $('btnFilters').click(); return; }
        this.close();
        return;
      }
      if (this.selected && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.stopPropagation();
        e.preventDefault();
        this.step(e.key === 'ArrowLeft' ? -1 : 1);
      }
    }, true);
  }

  update() {
    if (this.pointer && !this.touring) {
      const at = this.pointer;
      this._hover(this.wall.pick(this._ray(at.x, at.y)), at);
      this.pointer = null;
    }
    const p = this.player;
    const where = this._whereLabel();
    if (where !== this._where) { this._where = where; $('where').textContent = where; }
    const you = $('trackYou');
    const onLog = p.onRamp && !p.tour;
    you.style.opacity = onLog ? 1 : 0.3;
    you.style.left = `${clamp(onLog ? p.u / this.layout.uTop : 0, 0, 1) * 100}%`;
  }
}
