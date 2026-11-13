// The books themselves.
//
// Covers are drawn at two levels of detail. Every book always shows a thumbnail cut
// from a shared sheet ("atlas"), so the whole collection is a handful of images and a
// handful of draw calls however large it grows. The books nearest the visitor are then
// topped up with the full 664 x 1000 cover, loaded on demand and released again when
// the visitor moves on.
//
// Thumbnail sheets are prepared ahead of time by tools/sync-library.mjs. Any book that
// is not on a prepared sheet yet (one added to the log since the last sync) is fetched
// on its own and painted onto a spare sheet in the browser, so nothing is ever missing.

import * as THREE from 'three';
import { axisMatrix } from './geo.js';
import { makeCanvas } from './textures.js';
import { BOOK_W, BOOK_H, BOOK_D, R_OUT, slotPlacement, polar } from './config.js';

const TILT = -0.055; // books lean back against the wall a little
const PAPER = new THREE.Color(0xd9cfba);

const VERT = /* glsl */ `
  #ifdef INSTANCED
    attribute vec4 aRect;
    attribute float aDim;
    attribute float aId;
  #else
    uniform float uDim;
    uniform float uId;
  #endif
  varying vec2 vUv;
  varying vec2 vMapUv;
  varying float vFront;
  varying float vDim;
  varying float vId;
  void main() {
    vUv = uv;
    vFront = step( 0.5, normal.z );
    #ifdef INSTANCED
      vMapUv = aRect.xy + uv * aRect.zw;
      vDim = aDim;
      vId = aId;
      vec4 world = modelMatrix * instanceMatrix * vec4( position, 1.0 );
    #else
      vMapUv = uv;
      vDim = uDim;
      vId = uId;
      vec4 world = modelMatrix * vec4( position, 1.0 );
    #endif
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 uPaper;
  uniform float uHover;
  uniform float uSelected;
  uniform float uCurrent;
  uniform float uTime;
  varying vec2 vUv;
  varying vec2 vMapUv;
  varying float vFront;
  varying float vDim;
  varying float vId;
  void main() {
    vec3 col = vFront > 0.5 ? texture2D( map, vMapUv ).rgb : uPaper * ( 0.35 + 0.3 * vUv.y );
    // Lit from the strip under the shelf above.
    col *= 0.84 + 0.2 * vUv.y;
    // Books outside the active filter fall back into shadow.
    float grey = dot( col, vec3( 0.3, 0.6, 0.1 ) );
    col = mix( grey * vec3( 0.05, 0.04, 0.032 ), col, vDim );

    float edge = min( min( vUv.x, 1.0 - vUv.x ) * ${(BOOK_W / BOOK_H).toFixed(4)}, min( vUv.y, 1.0 - vUv.y ) );
    float rim = ( 1.0 - smoothstep( 0.008, 0.02, edge ) ) * vFront;
    float hover = 1.0 - step( 0.5, abs( vId - uHover ) );
    float selected = 1.0 - step( 0.5, abs( vId - uSelected ) );
    float current = 1.0 - step( 0.5, abs( vId - uCurrent ) );
    vec3 gold = vec3( 1.0, 0.74, 0.36 );
    col += hover * ( 0.07 + rim * gold * 0.9 ) * vFront;
    col = mix( col, gold * 1.7, selected * rim );
    col = mix( col, gold * ( 1.2 + 0.8 * sin( uTime * 2.2 ) ), current * rim * ( 1.0 - selected ) );
    gl_FragColor = vec4( col, 1.0 );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function drawPlaceholder(ctx, x, y, w, h, book) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#6b4a2e');
  g.addColorStop(1, '#3a2617');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#c9a45c';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 7, y + 7, w - 14, h - 14);
  ctx.fillStyle = '#f3ead8';
  ctx.textAlign = 'center';
  ctx.font = '600 15px Georgia, serif';
  const words = book.title.split(/\s+/);
  let line = '';
  let ty = y + 46;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > w - 30 && line) {
      ctx.fillText(line, x + w / 2, ty);
      line = word;
      ty += 19;
      if (ty > y + h - 70) { line += '…'; break; }
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x + w / 2, ty);
  ctx.font = 'italic 12px Georgia, serif';
  ctx.fillStyle = '#d9c9a8';
  ctx.fillText(book.author.slice(0, 30), x + w / 2, y + h - 24, w - 24);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

export class BookWall {
  constructor(scene, layout, books, renderer, quality) {
    this.scene = scene;
    this.layout = layout;
    this.books = books;
    this.quality = quality;
    this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.group = new THREE.Group();
    scene.add(this.group);

    this.uniforms = {
      uPaper: { value: PAPER },
      uHover: { value: -1 },
      uSelected: { value: -1 },
      uCurrent: { value: -1 },
      uTime: { value: 0 },
    };
    this.pages = []; // { mesh, slots[], dim: InstancedBufferAttribute }
    this.dynamic = []; // sheets painted in the browser
    this.hires = new Map(); // slot -> { texture, mesh } | 'loading' | 'failed'
    this.hiresLoading = 0;
    this.overlayPool = [];
    this.filter = null;
    this._since = 1;
    this._matrix = new THREE.Matrix4();
    this._tilt = new THREE.Matrix4().makeRotationX(TILT);

    for (const book of books) {
      const place = slotPlacement(book.slot, layout);
      book.place = place;
      book.pos = polar(place.r, place.u, place.y, new THREE.Vector3());
      if (!book.finished && this.uniforms.uCurrent.value < 0) this.uniforms.uCurrent.value = book.slot;
    }
    this.boxGeo = new THREE.BoxGeometry(BOOK_W, BOOK_H, BOOK_D);
    this.planeGeo = new THREE.PlaneGeometry(BOOK_W, BOOK_H);
    this._buildEmptySlots();
  }

  bookMatrix(book, forward = 0) {
    const p = book.place;
    axisMatrix(p.r, p.u, p.y, this._matrix).multiply(this._tilt);
    if (forward) this._matrix.multiply(new THREE.Matrix4().makeTranslation(0, 0, forward));
    return this._matrix;
  }

  // Dark, faintly outlined panels where the books still to be read will go.
  _buildEmptySlots() {
    const from = this.books.length;
    const count = this.layout.slots - from;
    if (count <= 0) return;
    const c = makeCanvas(128, 192);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1c120c';
    ctx.fillRect(0, 0, 128, 192);
    ctx.strokeStyle = 'rgba(201,164,92,0.38)';
    ctx.lineWidth = 2;
    ctx.strokeRect(9, 9, 110, 174);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.InstancedMesh(this.planeGeo, new THREE.MeshBasicMaterial({ map: tex }), count);
    for (let i = 0; i < count; i++) {
      const p = slotPlacement(from + i, this.layout);
      mesh.setMatrixAt(i, axisMatrix(R_OUT - 0.03, p.u, p.y, this._matrix));
    }
    this.group.add(mesh);
  }

  _material(map, instanced) {
    return new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, map: { value: map }, uDim: { value: 1 }, uId: { value: -2 } },
      defines: instanced ? { INSTANCED: '' } : {},
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
  }

  _addPage(texture, entries) {
    // entries: [{ book, rect: [x, y, w, h] in UV }]
    const geo = this.boxGeo.clone();
    const n = entries.length;
    const rect = new Float32Array(n * 4);
    const dim = new Float32Array(n).fill(1);
    const id = new Float32Array(n);
    const mesh = new THREE.InstancedMesh(geo, this._material(texture, true), n);
    entries.forEach((e, i) => {
      rect.set(e.rect, i * 4);
      id[i] = e.book.slot;
      mesh.setMatrixAt(i, this.bookMatrix(e.book));
    });
    geo.setAttribute('aRect', new THREE.InstancedBufferAttribute(rect, 4));
    geo.setAttribute('aId', new THREE.InstancedBufferAttribute(id, 1));
    const dimAttr = new THREE.InstancedBufferAttribute(dim, 1);
    dimAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aDim', dimAttr);
    this.group.add(mesh);
    const page = { mesh, slots: entries.map((e) => e.book.slot), dim: dimAttr };
    this.pages.push(page);
    if (this.filter) this._applyFilter(page);
    return page;
  }

  _prepare(texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.anisotropy;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    return texture;
  }

  // Loads the prepared sheets, then anything they do not cover. `onProgress` is called
  // with a 0..1 fraction as sheets arrive.
  async load(onProgress = () => {}) {
    let manifest = null;
    try {
      const res = await fetch('covers/atlas.json', { cache: 'no-cache' });
      if (res.ok) manifest = await res.json();
    } catch (err) {
      console.warn('No prepared cover sheets; loading covers one by one.', err);
    }

    const leftover = [];
    if (manifest) {
      const cell = new Map(manifest.covers.map((url, i) => [url, i]));
      const perPage = manifest.cols * manifest.rows;
      const byPage = manifest.pages.map(() => []);
      const sx = (manifest.cellW - manifest.pad * 2) / manifest.page;
      const sy = (manifest.cellH - manifest.pad * 2) / manifest.page;
      for (const book of this.books) {
        const i = cell.get(book.cover);
        if (i === undefined) { leftover.push(book); continue; }
        const k = i % perPage;
        const px = (k % manifest.cols) * manifest.cellW + manifest.pad;
        const py = Math.floor(k / manifest.cols) * manifest.cellH + manifest.pad;
        byPage[Math.floor(i / perPage)].push({
          book,
          rect: [px / manifest.page, 1 - (py + manifest.cellH - manifest.pad * 2) / manifest.page, sx, sy],
        });
      }
      const loader = new THREE.TextureLoader();
      let done = 0;
      await Promise.all(manifest.pages.map(async (name, p) => {
        if (!byPage[p].length) return;
        try {
          const texture = this._prepare(await loader.loadAsync(`covers/${name}`));
          this._addPage(texture, byPage[p]);
        } catch (err) {
          console.warn(`Cover sheet ${name} failed; loading its covers one by one.`, err);
          leftover.push(...byPage[p].map((e) => e.book));
        }
        onProgress(++done / manifest.pages.length);
      }));
    } else {
      leftover.push(...this.books);
    }

    if (leftover.length) this._paintLive(leftover.sort((a, b) => a.slot - b.slot));
    onProgress(1);
  }

  // Builds sheets in the browser for books without a prepared thumbnail.
  _paintLive(books) {
    const SIZE = 2048, COLS = 10, ROWS = 7, PAD = 2;
    const cw = Math.floor(SIZE / COLS), ch = Math.floor(SIZE / ROWS);
    const jobs = [];
    for (let p = 0; p * COLS * ROWS < books.length; p++) {
      const slice = books.slice(p * COLS * ROWS, (p + 1) * COLS * ROWS);
      const canvas = makeCanvas(SIZE, SIZE);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#1a120c';
      ctx.fillRect(0, 0, SIZE, SIZE);
      const texture = this._prepare(new THREE.CanvasTexture(canvas));
      const sheet = { ctx, texture, dirty: false };
      this.dynamic.push(sheet);
      const entries = slice.map((book, i) => {
        const x = (i % COLS) * cw, y = Math.floor(i / COLS) * ch;
        drawPlaceholder(ctx, x, y, cw, ch, book);
        jobs.push({ book, sheet, x, y });
        return { book, rect: [(x + PAD) / SIZE, 1 - (y + ch - PAD) / SIZE, (cw - PAD * 2) / SIZE, (ch - PAD * 2) / SIZE] };
      });
      this._addPage(texture, entries);
    }
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        if (!job.book.cover) continue;
        try {
          const img = await loadImage(job.book.cover);
          job.sheet.ctx.drawImage(img, job.x, job.y, cw, ch);
          job.sheet.dirty = true;
        } catch {
          job.book.coverFailed = true; // keeps its painted title card
        }
      }
    };
    for (let i = 0; i < 6; i++) worker();
  }

  setHover(book) {
    this.uniforms.uHover.value = book ? book.slot : -1;
  }

  setSelected(book) {
    this.uniforms.uSelected.value = book ? book.slot : -1;
  }

  // `test` decides which books stay lit; pass null to light them all.
  setFilter(test) {
    this.filter = test;
    for (const page of this.pages) this._applyFilter(page);
    for (const [slot, entry] of this.hires) {
      if (entry.mesh) entry.mesh.material.uniforms.uDim.value = this._dimOf(this.books[slot]);
    }
  }

  _dimOf(book) {
    return !this.filter || this.filter(book) ? 1 : 0;
  }

  _applyFilter(page) {
    page.slots.forEach((slot, i) => { page.dim.array[i] = this._dimOf(this.books[slot]); });
    page.dim.needsUpdate = true;
  }

  pick(raycaster) {
    let best = null;
    for (const page of this.pages) {
      const hits = raycaster.intersectObject(page.mesh, false);
      if (hits.length && (!best || hits[0].distance < best.distance)) {
        best = { distance: hits[0].distance, slot: page.slots[hits[0].instanceId] };
      }
    }
    return best ? this.books[best.slot] : null;
  }

  update(camera, dt, time) {
    this.uniforms.uTime.value = time;
    this._since += dt;
    if (this._since < 0.3) return;
    this._since = 0;
    for (const sheet of this.dynamic) {
      if (sheet.dirty) { sheet.texture.needsUpdate = true; sheet.dirty = false; }
    }
    this._refreshHires(camera);
  }

  _refreshHires(camera) {
    const limit = this.quality.hiresCovers;
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const near = [];
    for (const book of this.books) {
      const d = book.pos.distanceToSquared(eye);
      if (d < 49 && book.cover) near.push([d, book]);
    }
    near.sort((a, b) => a[0] - b[0]);
    const wanted = new Set();
    for (const [, book] of near.slice(0, limit)) {
      wanted.add(book.slot);
      if (!this.hires.has(book.slot) && this.hiresLoading < 4) this._loadHires(book);
    }
    if (this.hires.size > limit + 12) {
      for (const [slot, entry] of this.hires) {
        if (wanted.has(slot) || !entry.mesh) continue;
        entry.texture.dispose();
        entry.mesh.visible = false;
        this.overlayPool.push(entry.mesh);
        this.hires.delete(slot);
        if (this.hires.size <= limit + 4) break;
      }
    }
  }

  async _loadHires(book) {
    this.hires.set(book.slot, 'loading');
    this.hiresLoading++;
    try {
      const img = await loadImage(book.cover);
      const texture = this._prepare(new THREE.Texture(img));
      texture.needsUpdate = true;
      let mesh = this.overlayPool.pop();
      if (mesh) {
        mesh.material.uniforms.map.value = texture;
      } else {
        mesh = new THREE.Mesh(this.planeGeo, this._material(texture, false));
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
      }
      mesh.material.uniforms.uId.value = book.slot;
      mesh.material.uniforms.uDim.value = this._dimOf(book);
      mesh.matrix.copy(this.bookMatrix(book, BOOK_D / 2 + 0.0015));
      mesh.matrixWorldNeedsUpdate = true;
      mesh.visible = true;
      this.hires.set(book.slot, { texture, mesh });
    } catch {
      this.hires.set(book.slot, 'failed');
    } finally {
      this.hiresLoading--;
    }
  }
}
