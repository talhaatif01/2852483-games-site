/* Arrow Escape cube view: SVG projection, CPU only (no WebGL, no images). Based on the intake's cube-view.js
   (sha256 3bb26eee...).
   M1: readability floors, pinch-to-zoom, the 26 px block floor (auto-fit zoom), mount once per level with one
   ResizeObserver, render-order hit-testing (the tapped block is the topmost RENDERED element under the finger at
   pointerdown: elementFromPoint -> closest [data-block]).
   M2 (job 1083, owner priority 1-2):
   - every arrow, head-on dot or cross is built IN ITS FACE'S PLANE in 3D and projected with the face, so it is part of
     the face: foreshortened with it, and additionally clipped to the face polygon. It can never sit beside the block or
     on a neighbour;
   - the cube is painted FACE BY FACE in true depth order (each exposed face sorted by the depth of its centre), not
     block by block;
   - free 360 degree rotation: the pose is a quaternion; a drag turns the cube about the screen axes (trackball), with no
     pitch limit, so the cube can be turned upside down; pinch and the buttons zoom. Rotation and zoom never tap a block. */
(function (root) {
  'use strict';
  const MIN_GLYPH_PX = 14, MIN_STROKE_PX = 2, MIN_MARK_PX = 14, MIN_BLOCK_PX = 26, ZOOM_MIN = 0.65, ZOOM_MAX = 1.8;
  const HALF = 0.465, ARROW = 0.30, EDGE_ON = 0.2;   // face half-size and arrow half-length, in block units (arrow = 65 % of the face)
  const DEFAULT = { yaw: -0.58, pitch: 0.46, zoom: 1 };
  const VIEWS = [
    { name: 'front', yaw: -0.35, pitch: 0.3 }, { name: 'right', yaw: -0.35 - Math.PI / 2, pitch: 0.3 },
    { name: 'back', yaw: -0.35 + Math.PI, pitch: 0.3 }, { name: 'left', yaw: -0.35 + Math.PI / 2, pitch: 0.3 },
    { name: 'top', yaw: -0.35, pitch: 1.2 }, { name: 'bottom', yaw: -0.35, pitch: -1.2 },
  ];
  // ---- quaternions [w, x, y, z]; screen axes: x right, y up, z towards the viewer
  const qmul = (a, b) => [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2], a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
  const qaxis = (ax, ang) => { const s = Math.sin(ang / 2); return [Math.cos(ang / 2), ax[0] * s, ax[1] * s, ax[2] * s]; };
  const qnorm = (q) => { const l = Math.hypot(...q) || 1; return q.map((v) => v / l); };
  // the M1 pose (yaw about Y, then pitch about X) as a quaternion: R = Rx(pitch) * Ry(yaw)
  const fromYawPitch = (yaw, pitch) => qmul(qaxis([1, 0, 0], pitch), qaxis([0, 1, 0], yaw));
  let q = fromYawPitch(DEFAULT.yaw, DEFAULT.pitch), zoom = DEFAULT.zoom;
  function rotate(p) { // v' = q v q*
    const [w, x, y, z] = q, ix = w * p[0] + y * p[2] - z * p[1], iy = w * p[1] + z * p[0] - x * p[2], iz = w * p[2] + x * p[1] - y * p[0], iw = -x * p[0] - y * p[1] - z * p[2];
    return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
  }
  const palette = ['#ff826f', '#6fa8ff', '#ffc95a', '#5ed9b7', '#b69aff', '#ff9dc6'];
  function el(tag, attrs) { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, String(v)); return e; }
  const faces = [
    { normal: [1, 0, 0], corners: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]], shade: 0.9 }, { normal: [-1, 0, 0], corners: [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]], shade: 0.9 },
    { normal: [0, 1, 0], corners: [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]], shade: 1.08 }, { normal: [0, -1, 0], corners: [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]], shade: 0.8 },
    { normal: [0, 0, 1], corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], shade: 1 }, { normal: [0, 0, -1], corners: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]], shade: 1 },
  ];
  const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  function tint(hex, f) { return '#' + hex.slice(1).match(/../g).map(v => Math.min(255, Math.round(parseInt(v, 16) * f)).toString(16).padStart(2, '0')).join(''); }
  let clipSeq = 0;

  /** RC D4: back-to-front paint order for grid blocks (unit cubes, orthographic view). Two disjoint convex blocks whose
   *  projections can overlap are ordered by a plane that separates them: on an axis where they are at least one cell apart,
   *  the one further along the view direction is nearer and painted later. A topological sort of these constraints gives
   *  the order (if ever stuck, the remaining block with the smallest centre depth goes next). */
  function blockOrder(blocks, offset) {
    const v = [rotate([1, 0, 0])[2], rotate([0, 1, 0])[2], rotate([0, 0, 1])[2]]; // view-depth of each world axis
    const n = blocks.length, c = blocks.map((b) => [b.x - offset, b.y - offset, b.z - offset]);
    const depth = c.map((p) => p[0] * v[0] + p[1] * v[1] + p[2] * v[2]);
    const scr = c.map((p) => rotate(p)), reach = 2 * Math.sqrt(3) * HALF; // conservative overlap test on screen
    const after = Array.from({ length: n }, () => []), indeg = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (Math.hypot(scr[i][0] - scr[j][0], scr[i][1] - scr[j][1]) >= reach) continue;
      let best = 0;
      for (let a = 0; a < 3; a++) { const d = c[j][a] - c[i][a]; if (Math.abs(d) >= 1 && Math.abs(d * v[a]) > Math.abs(best)) best = d * v[a]; }
      if (best === 0) continue;
      const [back, front] = best > 0 ? [i, j] : [j, i]; // j further along the view direction -> j is in front
      after[back].push(front); indeg[front]++;
    }
    const done = new Array(n).fill(false), order = [];
    const ready = []; for (let i = 0; i < n; i++) if (!indeg[i]) ready.push(i);
    while (order.length < n) {
      let i;
      if (ready.length) { ready.sort((a, b) => depth[b] - depth[a]); i = ready.pop(); }
      else { i = -1; for (let k = 0; k < n; k++) if (!done[k] && (i < 0 || depth[k] < depth[i])) i = k; }
      if (done[i]) continue;
      done[i] = true; order.push(i);
      for (const k of after[i]) if (--indeg[k] === 0 && !done[k]) ready.push(k);
    }
    return order.map((i) => blocks[i]);
  }

  /** Mounts the cube view on the board once; returns { update(blocks), measure... }. */
  function mount(board, controls, initialBlocks, n, onRemove) {
    let svg = null, blocks = initialBlocks, drawn = []; // drawn: [{id, poly:[[x,y]..], glyph:{pts:[[x,y]..], stroke, kind}, facing}]
    const pxPerUnit = () => Math.max(0.05, Math.min(board.clientWidth / 900, board.clientHeight / 650)) / 1.03;
    const zoomFloor = () => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, MIN_BLOCK_PX / (0.93 * 105 * 4 / n * pxPerUnit())));
    const clampZoom = z => Math.max(zoomFloor(), Math.min(ZOOM_MAX, z));
    const scale = () => 105 * 4 / n * zoom;
    function project(p) { const r = rotate(p), s = scale(); return [450 + r[0] * s, 324 - r[1] * s, r[2]]; }
    function draw() {
      // RC: a hidden board (0 px, e.g. mounted behind the launch / Levels screen) has no size to clamp the zoom against;
      // clamping then would store the 1.8 maximum (rc-layout screenshot, job 1118)
      if (board.clientWidth > 0 && board.clientHeight > 0) zoom = clampZoom(zoom);
      const k = pxPerUnit(), stroke = Math.max(4 * 4 / n * zoom, MIN_STROKE_PX / k), r2 = (x) => Math.round(x * 100) / 100;
      board.replaceChildren(); drawn = [];
      svg = el('svg', { viewBox: '0 0 900 650', class: 'cube-svg', role: 'group', 'aria-label': 'Rotatable arrow cube. Drag to turn it any way, pinch to zoom; tap a block with a clear arrow path to remove it.' });
      const defs = el('defs'); svg.append(defs);
      svg.append(el('ellipse', { cx: 450, cy: 591, rx: 220, ry: 28, fill: '#7882ad', opacity: 0.16 }));
      const offset = (n - 1) / 2, occupied = new Set(blocks.map(b => `${b.x},${b.y},${b.z}`));
      // RC D4: painted BLOCK by block in a correct back-to-front order, then each block's exposed camera-facing faces (a
      // block is convex, so its own front faces never overlap). Face-centre depth sorting (M2) could paint a far block's face
      // after a nearer block's face and leave back-face slivers on partly cleared cubes.
      const list = blockOrder(blocks, offset).flatMap((b) => {
        const center = [b.x - offset, b.y - offset, b.z - offset], out = [];
        for (const f of faces) {
          const nz = rotate(f.normal)[2];
          if (nz <= 0.02 || occupied.has(`${b.x + f.normal[0]},${b.y + f.normal[1]},${b.z + f.normal[2]}`)) continue;
          out.push({ b, f, center, fc: add(center, f.normal, HALF), nz });
        }
        return out;
      });
      for (const { b, f, center, fc, nz } of list) {
        const poly3 = f.corners.map(c => project(center.map((v, i) => v + c[i] * HALF))), poly = poly3.map(p => [r2(p[0]), r2(p[1])]);
        const g = el('g', { 'data-block': b.id, class: 'voxel face', role: 'button', tabindex: -1, 'aria-label': `Block ${b.id + 1}, arrow ${CubeRules.names[b.d]}` });
        const pts = poly.map(p => p.join(',')).join(' ');
        g.append(el('polygon', { points: pts, fill: tint(palette[(b.x + b.y * 2 + b.z * 3) % palette.length], f.shade), stroke: '#fff5ef', 'stroke-width': 2, 'stroke-linejoin': 'round' }));
        const cid = `cf${++clipSeq}`, cp = el('clipPath', { id: cid }); cp.append(el('polygon', { points: pts })); defs.append(cp);
        // the arrow in the face plane: the block's direction projected onto the face; head-on -> dot (out) or cross (in)
        const d = CubeRules.directions[b.d], along = dot(d, f.normal), inPlane = add(d, f.normal, -along), len = Math.hypot(...inPlane);
        let glyph = null;
        // a face seen almost edge-on (turned more than ~78 degrees away) is a thin sliver: it shows no glyph (the line
        // could not fit inside it; lease 2908). The block's other visible faces carry its arrow.
        if (nz < EDGE_ON) { /* face only */ }
        else if (len > 0.5) {
          const u = inPlane.map(v => v / len), w = cross(f.normal, u);
          const P = (s, t) => project(add(add(fc, u, s), w, t)).slice(0, 2).map(r2);
          const tail = P(-ARROW, 0), tip = P(ARROW, 0), h1 = P(ARROW * 0.42, ARROW * 0.42), h2 = P(ARROW * 0.42, -ARROW * 0.42);
          glyph = { kind: 'arrow', pts: [tail, tip, h1, h2], len3: 2 * ARROW };
          g.append(el('path', { class: 'arrow-glyph', 'clip-path': `url(#${cid})`, d: `M ${tail} L ${tip} M ${h1} L ${tip} L ${h2}`, stroke: '#24324d', 'stroke-width': r2(stroke), fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'pointer-events': 'none' }));
        } else {
          const e1 = f.corners[1].map((v, i) => v - f.corners[0][i]).map(v => v / 2), e2 = f.corners[3].map((v, i) => v - f.corners[0][i]).map(v => v / 2);
          const P = (s, t) => project(add(add(fc, e1, s), e2, t)).slice(0, 2).map(r2);
          if (along > 0) { // pointing out of this face: a dot (a circle in the face plane)
            const ring = Array.from({ length: 16 }, (_, i) => P(0.16 * Math.cos(i * Math.PI / 8), 0.16 * Math.sin(i * Math.PI / 8))); // >= 14 px at 360 px (lease 2912: 0.13 gave 12 px)
            glyph = { kind: 'dot', pts: ring };
            g.append(el('polygon', { class: 'arrow-mark', 'clip-path': `url(#${cid})`, points: ring.map(p => p.join(',')).join(' '), fill: '#24324d', 'pointer-events': 'none' }));
          } else { // pointing into this face: a cross in the face plane
            const a = P(-0.19, -0.19), bq = P(0.19, 0.19), c2 = P(-0.19, 0.19), d2 = P(0.19, -0.19);
            glyph = { kind: 'cross', pts: [a, bq, c2, d2] };
            g.append(el('path', { class: 'arrow-mark', 'clip-path': `url(#${cid})`, d: `M ${a} L ${bq} M ${c2} L ${d2}`, stroke: '#24324d', 'stroke-width': r2(stroke), fill: 'none', 'stroke-linecap': 'round', 'pointer-events': 'none' }));
          }
        }
        drawn.push({ id: b.id, poly, poly3, glyph, stroke: r2(stroke), facing: +nz.toFixed(3) });
        g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRemove(b.id); } };
        svg.append(g);
      }
      // one keyboard stop per block: its first (nearest drawn last) face group
      const seen = new Set(); [...svg.querySelectorAll('g.face')].reverse().forEach(gg => { const id = gg.getAttribute('data-block'); if (!seen.has(id)) { seen.add(id); gg.setAttribute('tabindex', '0'); } });
      board.append(svg);
    }
    /** The block whose rendered shape is topmost under a screen point (CSS px), as the browser hit-tests it; null if none. */
    function blockAt(clientX, clientY, target) {
      const e = document.elementFromPoint(clientX, clientY) || target;
      const g = e && e.closest && e.closest('[data-block]');
      return g && board.contains(g) ? Number(g.getAttribute('data-block')) : null;
    }
    // ---- input (bound once): one finger drags to turn (trackball, any axis) or taps; two fingers pinch to zoom.
    // A gesture that ever had two fingers, or moved more than 7 px, never taps.
    const pointers = new Map(); let gesture = null;
    const dist = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    const turn = (dx, dy) => { q = qnorm(qmul(qaxis([1, 0, 0], dy * 0.007), qmul(qaxis([0, 1, 0], dx * 0.008), q))); };
    board.onpointerdown = e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { board.setPointerCapture(e.pointerId); } catch (x) { }
      if (pointers.size === 1) gesture = { startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, multi: false, block: blockAt(e.clientX, e.clientY, e.target) };
      else if (pointers.size === 2 && gesture) { gesture.multi = true; gesture.pinchStart = dist(); gesture.zoomStart = zoom; }
    };
    board.onpointermove = e => {
      const p = pointers.get(e.pointerId); if (!p || !gesture) return;
      p.x = e.clientX; p.y = e.clientY;
      if (gesture.multi) { if (pointers.size === 2 && gesture.pinchStart > 0) { zoom = clampZoom(gesture.zoomStart * dist() / gesture.pinchStart); draw(); } return; }
      if (Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY) > 7) gesture.moved = true;
      if (gesture.moved) { turn(e.clientX - gesture.lastX, e.clientY - gesture.lastY); draw(); }
      gesture.lastX = e.clientX; gesture.lastY = e.clientY;
    };
    const end = e => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      try { if (board.hasPointerCapture(e.pointerId)) board.releasePointerCapture(e.pointerId); } catch (x) { }
      if (pointers.size) return;
      const g = gesture; gesture = null;
      if (e.type === 'pointerup' && g && !g.moved && !g.multi && g.block !== null) onRemove(g.block);
    };
    board.onpointerup = end; board.onpointercancel = end;
    if (!board.__noTouchGesture) { board.__noTouchGesture = true; board.addEventListener('touchmove', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false }); } // no browser gesture from a drag (once per board)
    controls.replaceChildren();
    function control(label, action, aria) { const b = document.createElement('button'); b.textContent = label; b.setAttribute('aria-label', aria || label); b.onclick = () => { action(); draw(); }; controls.append(b); }
    // RC (owner relay 0030): no rotate / tilt / zoom icons; the cube turns only by dragging anywhere on the play area and
    // zooms by pinch. One small "Reset view" control stays.
    control('Reset view', () => { q = fromYawPitch(DEFAULT.yaw, DEFAULT.pitch); zoom = DEFAULT.zoom; });
    draw();
    // point-in-polygon and distance to the polygon's edges, for the arrow-in-face check
    const inside = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c; } return c; };
    const edgeDist = (pt, poly) => Math.min(...poly.map((a, i) => { const b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(pt[0] - a[0] - t * dx, pt[1] - a[1] - t * dy); }));
    const view = {
      update(next) { blocks = next; draw(); },
      VIEWS: VIEWS.map(v => v.name), limits: { MIN_GLYPH_PX, MIN_STROKE_PX, MIN_MARK_PX, MIN_BLOCK_PX, ZOOM_MIN, ZOOM_MAX, ARROW_FRACTION_OF_FACE: (2 * ARROW) / (2 * HALF) },
      setView(i) { q = fromYawPitch(VIEWS[i].yaw, VIEWS[i].pitch); zoom = DEFAULT.zoom; draw(); },
      setPose(y, p, z) { q = fromYawPitch(y, p); zoom = z; draw(); },            // no pitch clamp (M2)
      setQuat(nq, z) { q = qnorm(nq); if (z !== undefined) zoom = z; draw(); },
      turn(dx, dy) { turn(dx, dy); draw(); },
      get quat() { return q.slice(); }, get zoom() { return zoom; }, get zoomFloor() { return zoomFloor(); },
      get yaw() { const f = rotate([0, 0, 1]); return Math.atan2(f[0], f[2]); }, get pitch() { const u = rotate([0, 1, 0]); return Math.atan2(u[2], u[1]); },
      blockAt,
      /** Every glyph point inside its own face polygon, at least half the line width from the face's edges (screen units of the viewBox). */
      inFaceCheck() {
        const out = { faces: drawn.length, glyphs: 0, violations: [] };
        for (const d of drawn) {
          if (!d.glyph) continue;
          out.glyphs++;
          const margin = d.glyph.kind === 'dot' ? 0 : d.stroke / 2;
          for (const p of d.glyph.pts) { if (!inside(p, d.poly) || (margin && edgeDist(p, d.poly) < margin)) { out.violations.push({ id: d.id, kind: d.glyph.kind, pt: p, facing: d.facing }); break; } }
        }
        out.clipped = svg.querySelectorAll('[clip-path]').length === out.glyphs; out.edgeOnFacesWithoutGlyph = drawn.length - out.glyphs;
        return out;
      },
      /** RC D4 paint-order check: on a grid of sample points (viewBox units), the face painted last under the point must
       *  belong to the block truly nearest the viewer there (largest depth of the face plane at that point). Points within
       *  1.5 units of a containing face's edge are skipped (shared edges). Returns the number of wrong points. */
      occlusionCheck(step = 6) {
        const zAt = (p3, x, y) => { // plane through three corners, solved for z at (x, y)
          const [a, b, c] = p3, ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
          const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nzz = ux * vy - uy * vx;
          return a[2] - (nx * (x - a[0]) + ny * (y - a[1])) / nzz;
        };
        const out = { samples: 0, covered: 0, wrong: 0, examples: [] };
        for (let y = 2; y < 650; y += step) for (let x = 2; x < 900; x += step) {
          out.samples++;
          let top = -1, best = -1, bestZ = -Infinity, nearEdge = false;
          for (let i = 0; i < drawn.length; i++) {
            const d = drawn[i];
            if (!inside([x, y], d.poly)) continue;
            if (edgeDist([x, y], d.poly) < 1.5) { nearEdge = true; break; }
            top = i; const z = zAt(d.poly3, x, y); if (z > bestZ) { bestZ = z; best = i; }
          }
          if (nearEdge || top < 0) continue;
          out.covered++;
          if (drawn[top].id !== drawn[best].id) { out.wrong++; if (out.examples.length < 5) out.examples.push({ x, y, painted: drawn[top].id, nearest: drawn[best].id }); }
        }
        return out;
      },
      /** Readability: projected arrow length and line weight in CSS px. 'Frontal' = faces turned less than 45 degrees from the viewer. */
      measure() {
        const m = svg.getScreenCTM(), sc = m ? Math.hypot(m.a, m.b) : pxPerUnit();
        const arrows = drawn.filter(d => d.glyph && d.glyph.kind === 'arrow').map(d => ({ len: Math.hypot(d.glyph.pts[1][0] - d.glyph.pts[0][0], d.glyph.pts[1][1] - d.glyph.pts[0][1]) * sc, stroke: d.stroke * sc, facing: d.facing }));
        const frontal = arrows.filter(a => a.facing >= Math.SQRT1_2);
        const marks = drawn.filter(d => d.glyph && d.glyph.kind !== 'arrow').map(d => ({ size: Math.max(...d.glyph.pts.map(p => Math.hypot(p[0] - d.glyph.pts[0][0], p[1] - d.glyph.pts[0][1]))) * sc, facing: d.facing }));
        const blockIds = new Set(drawn.map(d => d.id));
        return { count: arrows.length, marks: marks.length, frontalArrows: frontal.length, minLen: frontal.length ? Math.min(...frontal.map(g => g.len)) : null, minLenAll: arrows.length ? Math.min(...arrows.map(g => g.len)) : null, minStroke: arrows.length ? Math.min(...arrows.map(g => g.stroke)) : null, minMark: marks.filter(m => m.facing >= Math.SQRT1_2).length ? Math.min(...marks.filter(m => m.facing >= Math.SQRT1_2).map(m => m.size)) : null, blocksDrawn: blockIds.size, blockPx: 0.93 * 105 * 4 / n * zoom * sc };
      },
    };
    root.__arrowView = view;
    return view;
  }
  let current = null;
  const ro = root.ResizeObserver ? new ResizeObserver(() => { if (current) current.update(current.blocksRef()); }) : null;
  function mountOnce(board, controls, blocks, n, onRemove) {
    const v = mount(board, controls, blocks, n, onRemove);
    let last = blocks; const upd = v.update; v.update = next => { last = next; upd(next); }; v.blocksRef = () => last;
    current = v; if (ro) { ro.disconnect(); ro.observe(board); }
    return v;
  }
  root.ArrowCube = { mount: mountOnce, VIEWS };
})(globalThis);
