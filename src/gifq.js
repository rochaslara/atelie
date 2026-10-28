/* GIFQ — shared GIF encoder for every Ateliê tool, with a Quality setting.
   Quality (0–100) trades size for fidelity through:
   · palette size (256 colours at 100, fewer below),
   · inter-frame optimisation: pixels that did not change (or changed less than a
     tolerance that grows as quality drops) are stored as transparent, each frame is
     cropped to the area that changed, and frames with no change are merged into the
     previous frame's delay.
   · lossy LZW (as in gifsicle --lossy): while compressing, a pixel may be swapped
     for a near-identical palette colour when that continues a longer run, so the
     compressor finds more repeats.
   At 100 everything except the palette is lossless.                                 */
const GIFQ = (() => {
  const BAYER = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
  const settings = q => {
    q = Math.max(0, Math.min(100, +q || 0)) / 100;
    const colors = Math.max(16, Math.min(256, Math.round(256 * Math.pow(2, -(1 - q) * 3))));
    const tol = 14 * Math.pow(1 - q, 1.3);
    const lossy = 38 * Math.pow(1 - q, 1.1);
    return { colors, tol, lossy };
  };
  function describe(q){
    const s = settings(q);
    const lvl = q >= 95 ? 'Best' : q >= 75 ? 'High' : q >= 50 ? 'Medium' : q >= 25 ? 'Low' : 'Smallest';
    return `${lvl} · ${s.colors} colours${s.tol > .5 ? ' · lossy compression' : ''}`;
  }
  /* --- palette: 5-bit histogram, weighted median cut --- */
  function Hist(){ return { n:new Uint32Array(32768), r:new Float64Array(32768), g:new Float64Array(32768), b:new Float64Array(32768) }; }
  function addHist(h, d, flipY, w, hh, transparent){
    const step = Math.max(1, Math.floor(Math.sqrt(w * hh / 60000)));
    for (let y = 0; y < hh; y += step) for (let x = (y * 3) % step; x < w; x += step) {
      const i = (y * w + x) * 4; if (transparent && d[i+3] < 128) continue;
      const r = d[i], g = d[i+1], b = d[i+2], k = ((r>>3)<<10) | ((g>>3)<<5) | (b>>3);
      h.n[k]++; h.r[k] += r; h.g[k] += g; h.b[k] += b;
    }
  }
  function palette(h, max){
    const keys = []; for (let k = 0; k < 32768; k++) if (h.n[k]) keys.push(k);
    if (!keys.length) return [[0,0,0]];
    const ch = (k, c) => c === 0 ? (k>>10)&31 : c === 1 ? (k>>5)&31 : k&31;
    const stats = arr => { const mn=[31,31,31], mx=[0,0,0]; let cnt=0;
      for (const k of arr) { for (let c = 0; c < 3; c++) { const v = ch(k,c); if (v<mn[c]) mn[c]=v; if (v>mx[c]) mx[c]=v; } cnt += h.n[k]; }
      const rg = [mx[0]-mn[0], (mx[1]-mn[1])*1.2, mx[2]-mn[2]]; const c = rg[0]>=rg[1]&&rg[0]>=rg[2]?0:rg[1]>=rg[2]?1:2;
      return { arr, cnt, range:rg[c], c, score:rg[c]*Math.sqrt(cnt) }; };
    const boxes = [stats(keys)];
    while (boxes.length < max) {
      let bi = -1, best = 0;
      for (let i = 0; i < boxes.length; i++) if (boxes[i].arr.length > 1 && boxes[i].range > 0 && boxes[i].score > best) { best = boxes[i].score; bi = i; }
      if (bi < 0) break;
      const bx = boxes[bi], c = bx.c; bx.arr.sort((a, b) => ch(a,c) - ch(b,c));
      let acc = 0, half = bx.cnt / 2, cut = 1;
      for (let i = 0; i < bx.arr.length - 1; i++) { acc += h.n[bx.arr[i]]; cut = i + 1; if (acc >= half) break; }
      boxes.splice(bi, 1, stats(bx.arr.slice(0, cut)), stats(bx.arr.slice(cut)));
    }
    return boxes.map(bx => { let n=0,r=0,g=0,b=0; for (const k of bx.arr) { n+=h.n[k]; r+=h.r[k]; g+=h.g[k]; b+=h.b[k]; } return [Math.round(r/n), Math.round(g/n), Math.round(b/n)]; });
  }
  function mapper(pal){
    const lut = new Int16Array(32768).fill(-1), n = pal.length;
    return (r, g, b) => { const k = ((r>>3)<<10) | ((g>>3)<<5) | (b>>3); let v = lut[k]; if (v >= 0) return v;
      const cr=(r&0xf8)|4, cg=(g&0xf8)|4, cb=(b&0xf8)|4; let bd = 1e9;
      for (let i = 0; i < n; i++) { const p = pal[i], dr=p[0]-cr, dg=p[1]-cg, db=p[2]-cb, d = dr*dr*2 + dg*dg*4 + db*db*3; if (d < bd) { bd = d; v = i; } }
      lut[k] = v; return v; };
  }
  /* --- output --- */
  class Bytes { constructor(){ this.buf = new Uint8Array(1<<20); this.len = 0; }
    grow(n){ if (this.len + n > this.buf.length) { let s = this.buf.length * 2; while (s < this.len + n) s *= 2; const nb = new Uint8Array(s); nb.set(this.buf.subarray(0, this.len)); this.buf = nb; } }
    byte(b){ this.grow(1); this.buf[this.len++] = b; } word(w){ this.byte(w & 255); this.byte((w >> 8) & 255); }
    str(s){ for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }
    bytes(a){ this.grow(a.length); this.buf.set(a, this.len); this.len += a.length; }
    result(){ return this.buf.slice(0, this.len); } }
  const table = new Int32Array(1 << 20); let gen = 0;
  // near[i] = palette indices close to i (closest first), used by lossy LZW
  function neighbours(pal, lim){
    if (lim <= 0) return null; const l2 = lim * lim * 9, n = pal.length, near = [];
    for (let i = 0; i < n; i++) { const a = pal[i], c = [];
      for (let j = 0; j < n; j++) { if (j === i) continue; const b = pal[j], dr=a[0]-b[0], dg=a[1]-b[1], db=a[2]-b[2], d = dr*dr*2 + dg*dg*4 + db*db*3; if (d <= l2) c.push([d, j]); }
      c.sort((x, y) => x[0] - y[0]); near.push(Int16Array.from(c.slice(0, 12).map(x => x[1]))); }
    return near;
  }
  function lzw(out, px, minCode, near){
    const CLEAR = 1 << minCode, EOI = CLEAR + 1; out.byte(minCode);
    const block = new Uint8Array(255); let bl = 0, acc = 0, nb = 0, size = minCode + 1, next = EOI + 1;
    if (++gen > 500000) { table.fill(0); gen = 1; }
    const fb = b => { block[bl++] = b; if (bl === 255) { out.byte(255); out.bytes(block); bl = 0; } };
    const emit = c => { acc |= c << nb; nb += size; while (nb >= 8) { fb(acc & 255); acc >>>= 8; nb -= 8; } };
    emit(CLEAR); let prefix = px[0];
    for (let i = 1; i < px.length; i++) {
      const k = px[i], key = (prefix << 8) | k, v = table[key];
      if ((v >>> 12) === gen) { prefix = v & 4095; continue; }
      if (near && k < near.length) {           // lossy: continue the run with a near-identical colour
        const nb = near[k]; let hit = -1;
        for (let t = 0; t < nb.length; t++) { const v2 = table[(prefix << 8) | nb[t]]; if ((v2 >>> 12) === gen) { hit = t; prefix = v2 & 4095; break; } }
        if (hit >= 0) { px[i] = nb[hit]; continue; }
      }
      emit(prefix);
      if (next < 4096) { table[key] = (gen << 12) | next; next++; if (next > (1 << size) && size < 12) size++; }
      else { emit(CLEAR); if (++gen > 500000) { table.fill(0); gen = 1; } next = EOI + 1; size = minCode + 1; }
      prefix = k;
    }
    emit(prefix); if (next >= (1 << size) && size < 12) size++; emit(EOI);
    if (nb > 0) fb(acc & 255);
    if (bl) { out.byte(bl); out.bytes(block.subarray(0, bl)); }
    out.byte(0);
  }
  /* --- main --- */
  // getFrame(i, phase) -> RGBA bytes (top-down unless flipY). Returns a Blob, or null if cancelled.
  async function encode({ w, h, n, delayCs = 5, transparent = false, quality = 80, dither = false, flipY = false,
                          getFrame, onProgress = () => {}, isCancelled = () => false, paletteFrames = 12 }){
    const { colors, tol, lossy } = settings(quality);
    const tol2 = tol * tol * 9;
    const yield_ = () => new Promise(r => setTimeout(r, 0));
    // palette
    const hist = Hist(), ps = Math.min(n, paletteFrames);
    for (let s = 0; s < ps; s++) {
      if (isCancelled()) return null;
      const d = await getFrame(Math.floor(s * n / ps)); addHist(hist, d, flipY, w, h, transparent);
      onProgress(.12 * (s + 1) / ps, 'Building colour palette…'); await yield_();
    }
    const diff = !transparent;                    // frame differencing needs an opaque image
    const reserve = transparent || diff;
    const pal = palette(hist, reserve ? Math.min(colors, 255) : colors);
    const T = reserve ? pal.length : -1;          // transparent index
    const used = pal.length + (reserve ? 1 : 0);
    let bits = 1; while ((1 << bits) < used) bits++;
    const minCode = Math.max(2, bits);
    const map = mapper(pal);
    const near = neighbours(pal, lossy);
    const amp = dither ? Math.min(30, 150 / Math.cbrt(pal.length)) * (.35 + .65 * Math.max(0, Math.min(1, quality / 100))) : 0;
    const o = new Bytes(); o.str('GIF89a'); o.word(w); o.word(h); o.byte(0xF0 | (bits - 1)); o.byte(0); o.byte(0);
    for (let i = 0; i < (1 << bits); i++) { const c = pal[i] || [0,0,0]; o.byte(c[0]); o.byte(c[1]); o.byte(c[2]); }
    o.byte(0x21); o.byte(0xFF); o.byte(11); o.str('NETSCAPE2.0'); o.byte(3); o.byte(1); o.word(0); o.byte(0);
    const cur = new Uint8Array(w * h), shown = new Int16Array(w * h).fill(-1), ideal = new Int16Array(w * h).fill(-1), chg = new Uint8Array(w * h);
    let pending = null;
    const write = f => {
      o.byte(0x21); o.byte(0xF9); o.byte(4);
      o.byte(transparent ? ((2 << 2) | 1) : diff ? ((1 << 2) | (f.full ? 0 : 1)) : (1 << 2));
      o.word(Math.min(65535, Math.max(1, Math.round(f.delay)))); o.byte(T >= 0 ? T : 0); o.byte(0);
      o.byte(0x2C); o.word(f.x); o.word(f.y); o.word(f.w); o.word(f.h); o.byte(0);
      o.bytes(f.data);
    };
    // compress now (lossy LZW may swap pixels), then record what the viewer will actually see
    const pack = (x, y, fw, fh, idx, delay, full) => {
      if (diff) for (let yy = 0; yy < fh; yy++) for (let xx = 0; xx < fw; xx++) { const v = idx[yy * fw + xx]; if (v !== T) ideal[(y + yy) * w + x + xx] = v; }
      const b = new Bytes(); lzw(b, idx, minCode, near);
      if (diff) for (let yy = 0; yy < fh; yy++) for (let xx = 0; xx < fw; xx++) { const v = idx[yy * fw + xx]; if (v !== T) shown[(y + yy) * w + x + xx] = v; }
      return { x, y, w:fw, h:fh, data:b.result(), delay, full };
    };
    for (let fi = 0; fi < n; fi++) {
      if (isCancelled()) return null;
      const d = await getFrame(fi);
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y++) {
        const sy = flipY ? h - 1 - y : y;
        for (let x = 0; x < w; x++) {
          const p = y * w + x, i = (sy * w + x) * 4;
          if (transparent && d[i+3] < 128) { cur[p] = T; continue; }
          let r = d[i], g = d[i+1], b = d[i+2], m;
          if (amp) { const t = (BAYER[(y & 3) * 4 + (x & 3)] / 15 - .5) * amp;
            m = map(Math.max(0, Math.min(255, r + t)) | 0, Math.max(0, Math.min(255, g + t)) | 0, Math.max(0, Math.min(255, b + t)) | 0); }
          else m = map(r, g, b);
          cur[p] = m;
          if (diff) {
            const s = shown[p]; let c = 1;
            if (s === m || ideal[p] === m) c = 0;      // same as what we last stored for this pixel
            else if (s >= 0 && tol2 > 0) { const q = pal[s], dr = q[0]-r, dg = q[1]-g, db = q[2]-b; if (dr*dr*2 + dg*dg*4 + db*db*3 <= tol2) c = 0; }
            chg[p] = c;
            if (c) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
          }
        }
      }
      const delay = delayCs;
      if (!diff || fi === 0) {
        if (pending) write(pending);
        pending = pack(0, 0, w, h, cur.slice(), delay, true);
      } else if (x1 < 0) {
        pending.delay += delay;                 // nothing changed: hold the previous frame longer
      } else {
        if (pending) write(pending);
        const fw = x1 - x0 + 1, fh = y1 - y0 + 1, idx = new Uint8Array(fw * fh);
        for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
          const p = (y0 + y) * w + x0 + x;
          idx[y * fw + x] = chg[p] ? cur[p] : T;
        }
        pending = pack(x0, y0, fw, fh, idx, delay, false);
      }
      onProgress(.12 + .88 * (fi + 1) / n, `Encoding frame ${fi + 1} of ${n}…`);
      if (fi % 2 === 1) await yield_();
    }
    if (pending) write(pending);
    o.byte(0x3B);
    return new Blob([o.result()], { type:'image/gif' });
  }
  return { encode, describe, settings };
})();

/* IMGX — still-image export (PNG, WebP, JPEG) shared by every Ateliê tool.
   encode() must be called right after the frame is drawn (WebGL canvases are read in the same task). */
const IMGX = (() => {
  const LABEL = { png:'PNG', webp:'WebP', jpeg:'JPEG' };
  const HINT = {
    png:'Lossless and keeps transparency. Largest file.',
    webp:'Usually the smallest file, and keeps transparency.',
    jpeg:'Opens everywhere. No transparency: see-through areas are filled.'
  };
  const label = t => LABEL[t] || 'PNG';
  const ext = t => t === 'jpeg' ? 'jpg' : (LABEL[t] ? t : 'png');
  const hint = t => HINT[t] || HINT.png;
  function encode(src, type, quality = 90, fill = '#ffffff'){
    type = LABEL[type] ? type : 'png';
    let c = src;
    if (type === 'jpeg') {                       // JPEG has no alpha: flatten onto a colour first
      c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
      const x = c.getContext('2d'); x.fillStyle = fill; x.fillRect(0, 0, c.width, c.height); x.drawImage(src, 0, 0);
    }
    const mime = 'image/' + type;
    return new Promise((res, rej) => c.toBlob(b => {
      if (!b) return rej(new Error(`The ${label(type)} couldn't be created. Try a smaller size.`));
      if (b.type !== mime) return rej(new Error(`This browser can't save ${label(type)} files. Choose PNG or JPEG.`));
      res(b);
    }, mime, type === 'png' ? undefined : Math.max(.05, Math.min(1, quality / 100))));
  }
  return { encode, label, ext, hint };
})();
