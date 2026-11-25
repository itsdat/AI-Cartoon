/* Stickman engine: vẽ nhân vật (thân = ảnh, tay chân = vẽ bằng code), timeline từ truyện, camera, phụ đề.
   Toàn bộ là hàm thuần theo thời gian: render(t) → canvas, nên xem thử và xuất video dùng chung một đường. */
(function (global) {
  const SLOT_X = { far_left: 0.16, left: 0.3, center: 0.5, right: 0.7, far_right: 0.84 };
  const GESTURE_DUR = { wave: 2.2, point: 1.6, shrug: 1.3, nod: 1.0, shake_head: 1.3, jump: 0.8, cheer: 1.9, hands_on_head: 2.6, cover_face: 2.6, bow: 1.5 };
  const D2R = Math.PI / 180;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const hash = (str) => { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
  const easeOutBack = (x) => { x = clamp(x, 0, 1); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  const STRONG = new Set(['scared', 'surprised', 'angry', 'sad']);

  /* ---------------------------------------------------------------- phông nền thủ tục */
  function rng(seed) { return function () { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const rgb = (c, k = 1) => `rgb(${c.map(v => Math.round(clamp(v * k, 0, 255))).join(',')})`;
  const mix = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);
  const BG = {
    school_gate: { top: [120, 168, 176], bot: [214, 205, 176], ground: [150, 142, 112], sil: [70, 96, 104], sun: [0.4, 0.3, 0.13, [250, 236, 200]], gate: 1, path: [196, 184, 154] },
    classroom: { indoor: 1, wall: [222, 210, 178], floor: [168, 134, 96], sil: [120, 100, 80], window: [190, 220, 230], board: 1 },
    home_evening: { indoor: 1, wall: [214, 170, 120], floor: [120, 84, 64], sil: [100, 70, 56], window: [240, 190, 120], lamp: 1 },
    street_day: { top: [150, 190, 210], bot: [226, 222, 200], ground: [140, 140, 138], sil: [96, 110, 124], sun: [0.75, 0.2, 0.1, [255, 248, 220]], path: [170, 170, 166] },
    street_night: { top: [24, 32, 58], bot: [70, 80, 110], ground: [40, 46, 60], sil: [20, 26, 44], sun: [0.25, 0.22, 0.09, [200, 215, 255]], lights: 1 },
    park: { top: [150, 200, 210], bot: [220, 232, 200], ground: [120, 160, 100], sil: [70, 120, 90], sun: [0.7, 0.2, 0.11, [255, 250, 215]], trees: 1, path: [206, 190, 150] },
    village_sunset: { top: [226, 150, 100], bot: [244, 206, 150], ground: [150, 100, 78], sil: [110, 66, 62], sun: [0.5, 0.52, 0.18, [255, 226, 160]], path: [210, 150, 110], trees: 1 },
    rain_gloom: { top: [70, 84, 100], bot: [130, 142, 152], ground: [80, 90, 96], sil: [44, 54, 66], rain: 1 },
    hospital: { indoor: 1, wall: [232, 238, 238], floor: [190, 200, 200], sil: [160, 175, 175], window: [210, 232, 240], bed: 1 },
    office: { indoor: 1, wall: [210, 214, 220], floor: [120, 124, 132], sil: [90, 96, 108], window: [180, 205, 230], desk: 1 },
    river_dawn: { top: [250, 190, 160], bot: [236, 220, 200], ground: [120, 150, 160], sil: [140, 120, 140], sun: [0.5, 0.45, 0.16, [255, 236, 190]], river: 1 },
    plain_cream: { top: [226, 214, 188], bot: [240, 232, 212], ground: [206, 194, 166], sil: [180, 170, 150], sun: [0.55, 0.4, 0.2, [255, 244, 220]], plain: 1 },
  };
  const bgCache = {};
  function makeBg(id, W, H) {
    const key = id + W + 'x' + H;
    if (bgCache[key]) return bgCache[key];
    const P = BG[id] || BG.plain_cream;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const R = rng(id.split('').reduce((a, ch) => a + ch.charCodeAt(0), 7));
    const hz = Math.round(H * 0.74);
    if (P.indoor) {
      const wg = g.createLinearGradient(0, 0, 0, hz); wg.addColorStop(0, rgb(P.wall, 1.04)); wg.addColorStop(1, rgb(P.wall, 0.9));
      g.fillStyle = wg; g.fillRect(0, 0, W, hz);
      const fg = g.createLinearGradient(0, hz, 0, H); fg.addColorStop(0, rgb(P.floor, 1.05)); fg.addColorStop(1, rgb(P.floor, 0.8));
      g.fillStyle = fg; g.fillRect(0, hz, W, H - hz);
      g.fillStyle = rgb(P.wall, 0.7); g.fillRect(0, hz - 14, W, 14);
      const ww = W * 0.34, wh = H * 0.2, wx = W * 0.58, wy = H * 0.2;
      g.fillStyle = rgb(P.window); g.fillRect(wx, wy, ww, wh);
      g.strokeStyle = rgb(P.sil); g.lineWidth = 8; g.strokeRect(wx, wy, ww, wh);
      g.beginPath(); g.moveTo(wx + ww / 2, wy); g.lineTo(wx + ww / 2, wy + wh); g.moveTo(wx, wy + wh / 2); g.lineTo(wx + ww, wy + wh / 2); g.stroke();
      if (P.board) { g.fillStyle = rgb([60, 86, 76]); g.fillRect(W * 0.06, H * 0.22, W * 0.44, H * 0.17); g.strokeStyle = rgb([150, 110, 70]); g.lineWidth = 10; g.strokeRect(W * 0.06, H * 0.22, W * 0.44, H * 0.17); }
      g.fillStyle = rgb(P.sil, 0.9);
      if (P.board || P.desk) for (let i = 0; i < 3; i++) { const dx = W * (0.05 + i * 0.32), dy = hz + 30 + i * 6; g.fillRect(dx, dy, W * 0.24, 16); g.fillRect(dx + 14, dy + 16, 10, 70); g.fillRect(dx + W * 0.24 - 24, dy + 16, 10, 70); }
      if (P.bed) { g.fillStyle = rgb([250, 250, 250]); g.fillRect(W * 0.04, hz - 50, W * 0.42, 70); g.fillStyle = rgb(P.sil); g.fillRect(W * 0.04, hz + 20, W * 0.42, 14); }
      if (P.lamp) { const rg = g.createRadialGradient(W * 0.2, H * 0.3, 10, W * 0.2, H * 0.3, W * 0.5); rg.addColorStop(0, 'rgba(255,220,150,0.55)'); rg.addColorStop(1, 'rgba(255,220,150,0)'); g.fillStyle = rg; g.fillRect(0, 0, W, H); }
    } else {
      const sg = g.createLinearGradient(0, 0, 0, hz); sg.addColorStop(0, rgb(P.top)); sg.addColorStop(1, rgb(P.bot));
      g.fillStyle = sg; g.fillRect(0, 0, W, hz + 2);
      if (P.sun) {
        const [fx, fy, fr, col] = P.sun, sx = W * fx, sy = H * fy, sr = Math.min(W, H) * fr * 1.6;
        const rg = g.createRadialGradient(sx, sy, sr * 0.25, sx, sy, sr);
        rg.addColorStop(0, rgb(col)); rg.addColorStop(0.55, rgb(col)); rg.addColorStop(1, rgb(col).replace('rgb', 'rgba').replace(')', ',0)'));
        g.fillStyle = rg; g.beginPath(); g.arc(sx, sy, sr, 0, 7); g.fill();
      }
      if (!P.plain) for (const [alpha, hmax] of [[0.32, H * 0.18], [0.6, H * 0.11]]) {
        g.fillStyle = rgb(mix(P.bot, P.sil, alpha));
        let x = -20;
        while (x < W) {
          const w = W * (0.06 + R() * 0.12), h = H * 0.03 + R() * hmax;
          if (P.trees) { g.beginPath(); g.ellipse(x + w / 2, hz - h * 0.7, w * 0.8, h * 0.8, 0, 0, 7); g.fill(); }
          else { g.fillRect(x, hz - h, w, h + 4); if (R() < 0.35) { g.beginPath(); g.ellipse(x + w / 2, hz - h, w * 0.7, h * 0.3, 0, 0, 7); g.fill(); } }
          x += w + R() * W * 0.03;
        }
      }
      if (P.gate) { g.fillStyle = rgb(P.sil, 0.55); for (const gx of [W * 0.14, W * 0.74]) g.fillRect(gx, hz - H * 0.27, W * 0.12, H * 0.27 + 10); g.fillRect(W * 0.11, hz - H * 0.29, W * 0.78, H * 0.04); }
      const gg = g.createLinearGradient(0, hz, 0, H); gg.addColorStop(0, rgb(P.ground, 1.05)); gg.addColorStop(1, rgb(P.ground, 0.85));
      g.fillStyle = gg; g.fillRect(0, hz, W, H - hz);
      if (P.river) { g.fillStyle = rgb([150, 180, 190]); g.fillRect(0, hz, W, (H - hz) * 0.45); }
      if (P.path) { g.fillStyle = rgb(P.path); g.beginPath(); g.moveTo(W * 0.5 - 30, hz); g.lineTo(W * 0.5 + 30, hz); g.lineTo(W * 1.0, H); g.lineTo(0, H); g.fill(); }
      if (P.lights) for (const lx of [0.15, 0.55, 0.9]) { const x = W * lx, y = hz - H * 0.2; const rg = g.createRadialGradient(x, y, 2, x, y, 130); rg.addColorStop(0, 'rgba(255,230,160,0.9)'); rg.addColorStop(1, 'rgba(255,230,160,0)'); g.fillStyle = rg; g.fillRect(x - 130, y - 130, 260, 260); g.fillStyle = rgb([30, 34, 48]); g.fillRect(x - 4, y, 8, H * 0.2); }
      if (P.rain) { g.strokeStyle = 'rgba(210,225,240,0.35)'; g.lineWidth = 2; for (let i = 0; i < 260; i++) { const x = R() * W, y = R() * H; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 8, y + 36); g.stroke(); } }
    }
    // hạt giấy
    const id2 = g.getImageData(0, 0, W, H), d = id2.data, R2 = rng(99);
    for (let i = 0; i < d.length; i += 4) { const n = (R2() - 0.5) * 12; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(id2, 0, 0);
    return (bgCache[key] = c);
  }

  /* ---------------------------------------------------------------- tài nguyên */
  function loadImg(url) { return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url; }); }

  async function loadChar(c) {
    const rig = c.rig, base = c.base + (c.rev ? '?v=' + c.rev : '');
    const A = { name: c.name, meta: c, rig, views: {}, heads: {} };
    const jobs = [];
    for (const [k, v] of Object.entries(rig.views)) {
      A.views[k] = { ...v };
      jobs.push(loadImg(c.base + v.full + '?v=' + (c.rev || 0)).then(i => A.views[k].fullImg = i));
      if (v.torso) jobs.push(loadImg(c.base + v.torso + '?v=' + (c.rev || 0)).then(i => A.views[k].torsoImg = i));
    }
    for (const [k, v] of Object.entries(rig.heads)) { A.heads[k] = { ...v }; jobs.push(loadImg(c.base + v.img + '?v=' + (c.rev || 0)).then(i => A.heads[k].img = i)); }
    await Promise.all(jobs);
    return A;
  }
  function styleOf(A) {
    const s = Object.assign({ stroke_mul: 1, arm_mul: 1, leg_mul: 1, mouth_dy: 0.2, mouth_dx: 0, mouth_w: 0.17, neck: 0.1, side_faces: A.rig.style.side_faces || 'right' }, A.rig.style, A.meta.style || {});
    return s;
  }

  /* ---------------------------------------------------------------- vẽ nhân vật */
  function ik(l, tx, ty, pick) { // 2 đoạn bằng nhau l, đích (tx,ty) tính từ vai; trả về khuỷu & bàn tay
    let d = Math.hypot(tx, ty); const L = 2 * l;
    if (d > L * 0.999) { tx *= L * 0.999 / d; ty *= L * 0.999 / d; d = L * 0.999; }
    if (d < 1e-3) { tx = 0; ty = 1; d = 1; }
    const psi = Math.atan2(ty, tx), phi = Math.acos(clamp(d / L, -1, 1));
    const cands = [psi + phi, psi - phi].map(a => [l * Math.cos(a), l * Math.sin(a)]);
    cands.sort((a, b) => pick(b) - pick(a));
    return { ex: cands[0][0], ey: cands[0][1], hx: tx, hy: ty };
  }

  function drawChar(ctx, A, P) {
    const st = styleOf(A);
    const V = A.views[P.view] || A.views.front;
    if (!V || !V.fullImg) return;
    const vs = P.S * V.scale;
    const hips = V.hips.length >= 2 ? V.hips : [V.hips[0], V.hips[0]];
    const sh = V.shoulders.length >= 2 ? V.shoulders : [V.shoulders[0], V.shoulders[0]];
    const hnd = V.hands && V.hands.length >= 2 ? V.hands : [V.hands ? V.hands[0] : [sh[0][0], sh[0][1] + 40], V.hands ? V.hands[0] : [sh[0][0], sh[0][1] + 40]];
    const fts = V.feet && V.feet.length >= 2 ? V.feet : [V.feet[0], V.feet[0]];
    const hipC = [(hips[0][0] + hips[1][0]) / 2, (hips[0][1] + hips[1][1]) / 2];
    const dir = P.view === 'front' || P.view === 'back' ? 1 : 1; // local luôn vẽ hướng phải, lật bằng scale(-1)
    const dyT = P.dy;
    const loc = (p) => [(p[0] - hipC[0]) * vs, (p[1] - V.feet_y) * vs + dyT];
    const hipL = loc(hipC), lean = (P.lean || 0) * D2R;
    const tp = (p) => { const q = loc(p); const dx = q[0] - hipL[0], dy = q[1] - hipL[1]; const c = Math.cos(lean), s = Math.sin(lean); return [hipL[0] + dx * c - dy * s + (P.hipDx || 0) * vs, hipL[1] + dx * s + dy * c]; };
    const lw = Math.max(2, st.stroke * st.stroke_mul * vs);
    const lineCol = st.line_color;

    ctx.save();
    // bóng
    ctx.save(); ctx.translate(P.x, P.gy); ctx.fillStyle = 'rgba(0,0,0,0.20)'; ctx.beginPath();
    const shw = (P.fallAmt > 0.5 ? 1.6 : 1) * 34 * vs; ctx.ellipse(0, 3 * vs, shw, 7 * vs, 0, 0, 7); ctx.fill(); ctx.restore();

    ctx.translate(P.x, P.gy + (P.lift || 0));
    ctx.rotate((P.rot || 0) * D2R);
    if (P.sx !== undefined && P.sx !== 1) ctx.scale(P.sx, 1);
    if (P.flip) ctx.scale(-1, 1);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // ---- chân
    for (let i = 0; i < 2; i++) {
      const lg = P.legs[i]; const h = loc(hips[i]);
      const f = fts[i], rx = f[0] - hips[i][0], ry = f[1] - hips[i][1];
      const Ls = Math.hypot(rx, ry) * vs * st.leg_mul, l = Ls / 2, a0 = Math.atan2(rx, ry);
      const a1 = a0 + lg.a * D2R, a2 = a1 - lg.k * D2R;
      const kx = h[0] + l * Math.sin(a1), ky = h[1] + l * Math.cos(a1);
      const fx = kx + l * Math.sin(a2), fy = ky + l * Math.cos(a2);
      ctx.strokeStyle = lineCol; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(h[0], h[1]); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
      const sho = (V.shoe && V.shoe[Math.min(i, V.shoe.length - 1)]) || { w: 8, h: 4, dx: 0 };
      ctx.fillStyle = st.shoe_color || '#141414'; ctx.beginPath();
      const sdx = (P.view === 'side' || P.view === 'three') ? sho.dx * vs + sho.w * vs * 0.1 : sho.dx * vs;
      ctx.ellipse(fx + sdx, fy + sho.h * vs * 0.2, Math.max(2, sho.w * vs * 0.55), Math.max(1.5, sho.h * vs * 0.7), a2 * 0.3, 0, 7); ctx.fill();
    }

    // ---- tay (đoạn thẳng) — vẽ sau để dễ lấy toạ độ, nhưng nét nằm sau thân
    const arms = [];
    for (let i = 0; i < 2; i++) {
      const ar = P.arms[i]; const s0 = tp(sh[i]);
      const rx = hnd[i][0] - sh[i][0], ry = hnd[i][1] - sh[i][1];
      const Ls = Math.hypot(rx, ry) * vs * st.arm_mul, l = Ls / 2;
      let e, h;
      if (ar.ik) {
        const sideOut = (sh[i][0] < (sh[0][0] + sh[1][0]) / 2) ? -1 : 1;
        const r = ik(l, ar.ik[0] * Ls, ar.ik[1] * Ls, ar.elbow === 'out' && P.view !== 'side' ? (c) => c[0] * sideOut : (c) => c[1]);
        // trộn với tư thế nghỉ theo trọng số
        const rest = armFK(l, Math.atan2(rx, ry) + (ar.th || 0) * D2R, (ar.bend || 0) * D2R);
        const w = ar.w === undefined ? 1 : ar.w;
        e = [lerp(rest.ex, r.ex, w), lerp(rest.ey, r.ey, w)]; h = [lerp(rest.hx, r.hx, w), lerp(rest.hy, r.hy, w)];
      } else {
        const rest = armFK(l, Math.atan2(rx, ry) + (ar.th || 0) * D2R, (ar.bend || 0) * D2R);
        e = [rest.ex, rest.ey]; h = [rest.hx, rest.hy];
      }
      arms.push({ s0, e: [s0[0] + e[0], s0[1] + e[1]], h: [s0[0] + h[0], s0[1] + h[1]] });
    }
    const front0 = P.view === 'side' || P.view === 'three';
    const drawArmLine = (a) => { ctx.strokeStyle = lineCol; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(a.s0[0], a.s0[1]); ctx.lineTo(a.e[0], a.e[1]); ctx.lineTo(a.h[0], a.h[1]); ctx.stroke(); };
    const drawHand = (a, i) => { const hr = Math.max(2.5, (V.hand_r ? V.hand_r[Math.min(i, V.hand_r.length - 1)] : 5) * vs * st.arm_mul); ctx.fillStyle = st.hand_fill || '#fff'; ctx.strokeStyle = lineCol; ctx.lineWidth = Math.max(1.5, lw * 0.85); ctx.beginPath(); ctx.arc(a.h[0], a.h[1], hr, 0, 7); ctx.fill(); ctx.stroke(); };
    drawArmLine(arms[1]); if (!front0) drawArmLine(arms[0]);

    // ---- cổ (nét nối đầu với thân, vẽ bằng code vì cổ trong ảnh quá mảnh/bị tóc che)
    if (P.view === 'front' && !V.has_neck && A.heads[P.expr] && A.heads[P.expr].img && V.torsoImg) {
      const c0 = tp(V.chin), tt = tp([V.chin[0], V.torso_top !== undefined ? V.torso_top : sh[0][1] - 8 * V.scale]);
      const y0 = c0[1] - (V.head_h || 40) * vs * (0.15 + st.neck), y1 = tt[1] + 3 * vs;
      if (y1 > y0) { ctx.strokeStyle = lineCol; ctx.lineWidth = lw * 1.1; ctx.beginPath(); ctx.moveTo(c0[0] + (P.headDx || 0) * vs * 0.5, y0); ctx.lineTo(tt[0], y1); ctx.stroke(); }
    }
    // ---- thân
    const useHead = P.view === 'front' && A.heads[P.expr] && A.heads[P.expr].img && V.torsoImg;
    const img = useHead ? V.torsoImg : V.fullImg;
    ctx.save();
    ctx.translate(hipL[0] + (P.hipDx || 0) * vs, hipL[1]); ctx.rotate(lean); ctx.translate(-hipL[0], -hipL[1]);
    const o = loc([0, 0]);
    ctx.drawImage(img, o[0], o[1], img.width * vs, img.height * vs);
    ctx.restore();

    // ---- đầu (thay biểu cảm)
    if (useHead) {
      const H0 = A.heads[P.expr], hs = (A.rig.head_scale || 1) * vs;
      const c = tp(V.chin);
      ctx.save(); ctx.translate(c[0] + (P.headDx || 0) * vs, c[1] + (P.headDy || 0) * vs - (V.has_neck ? 0 : st.neck) * (V.head_h || 40) * vs); ctx.rotate(lean + (P.tilt || 0) * D2R);
      ctx.drawImage(H0.img, -H0.chin[0] * hs, -H0.chin[1] * hs, H0.img.width * hs, H0.img.height * hs);
      if (P.mouth > 0 && P.expr === 'neutral') {
        const mx = (st.mouth_dx) * H0.w * hs, my = -(st.mouth_dy) * H0.h * hs;
        const mw = st.mouth_w * H0.w * hs, mh = Math.max(1.2, P.mouth * 0.11 * H0.h * hs * 0.2);
        ctx.fillStyle = '#2b1a1a'; ctx.strokeStyle = lineCol; ctx.lineWidth = Math.max(1.5, lw * 0.6);
        ctx.beginPath(); ctx.ellipse(mx, my, mw * 0.32 + 1, mh, 0, 0, 7); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
      // cổ thật vẽ đè lên tóc sau của đầu (cổ nằm trước tóc trong ảnh gốc)
      if (V.has_neck && V.neck_box) {
        const nb = V.neck_box;
        ctx.save();
        ctx.translate(hipL[0] + (P.hipDx || 0) * vs, hipL[1]); ctx.rotate(lean); ctx.translate(-hipL[0], -hipL[1]);
        const o2 = loc([0, 0]);
        ctx.beginPath(); ctx.rect(o2[0] + nb[0] * vs, o2[1] + nb[1] * vs, (nb[2] - nb[0]) * vs, (nb[3] - nb[1]) * vs); ctx.clip();
        ctx.drawImage(V.torsoImg, o2[0], o2[1], V.torsoImg.width * vs, V.torsoImg.height * vs);
        ctx.restore();
      }
    }
    if (front0) drawArmLine(arms[0]);
    drawHand(arms[1], 1); drawHand(arms[0], 0);
    if (P.fx && P.fx.k) {
      const cc = tp(V.chin), hh = (V.head_h || 40) * vs, hw = (V.head_w || 40) * vs;
      drawFx(ctx, P.fx, cc[0] + (P.headDx || 0) * vs, cc[1] + (P.headDy || 0) * vs - hh * 0.5 - (V.has_neck ? 0 : st.neck) * hh, Math.max(hh, hw) * 0.5, lw, lineCol);
    }
    ctx.restore();
  }
  /* hiệu ứng cảm xúc kiểu truyện tranh quanh đầu: vạch giật mình, giọt mồ hôi, gân giận, sao vui */
  function drawFx(ctx, fx, cx, cy, r, lw, col) {
    const a = fx.age, k = fx.k; ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (k === 'surprised') {
      const f = a < 1.5 ? 1 - Math.max(0, (a - 1.0) / 0.5) : 0;
      if (f > 0) { ctx.globalAlpha = f; ctx.strokeStyle = col; ctx.lineWidth = lw * 0.85; const pop = 1 + 0.3 * Math.exp(-a * 9);
        for (const d of [28, 62, 118, 152]) { const rad = d * D2R, c = Math.cos(rad), s = -Math.sin(rad); ctx.beginPath(); ctx.moveTo(cx + c * r * 1.22 * pop, cy + s * r * 1.22 * pop); ctx.lineTo(cx + c * r * 1.55 * pop, cy + s * r * 1.55 * pop); ctx.stroke(); } }
    } else if (k === 'scared') {
      ctx.globalAlpha = clamp(a / 0.25, 0, 1);
      const bob = Math.sin(a * 5) * r * 0.05, dx = cx + r * 1.0, dy = cy - r * 0.45 + bob + Math.min(a, 1.2) * r * 0.1;
      ctx.fillStyle = '#7fd3ff'; ctx.strokeStyle = col; ctx.lineWidth = lw * 0.55; ctx.beginPath(); ctx.moveTo(dx, dy - r * 0.2); ctx.quadraticCurveTo(dx + r * 0.16, dy + r * 0.02, dx, dy + r * 0.14); ctx.quadraticCurveTo(dx - r * 0.16, dy + r * 0.02, dx, dy - r * 0.2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = lw * 0.6; const sh = Math.sin(a * 40) * r * 0.03;
      for (const sd of [-1, 1]) for (const o of [0, 1]) { ctx.beginPath(); ctx.arc(cx + sd * (r * 1.12 + o * r * 0.14) + sh, cy, r * 0.22, sd > 0 ? -0.8 : Math.PI - 0.8 + 0.1, sd > 0 ? 0.8 : Math.PI + 0.8 + 0.1); ctx.stroke(); }
    } else if (k === 'angry') {
      const f = a < 3 ? 1 : Math.max(0, 1 - (a - 3) / 0.6);
      if (f > 0) { ctx.globalAlpha = f; ctx.strokeStyle = '#e53935'; ctx.lineWidth = lw * 0.9; const vx = cx + r * 0.78, vy = cy - r * 0.95, sz = r * 0.16 * (1 + 0.18 * Math.sin(a * 14));
        [[-1, -1, 0], [1, -1, 0.5], [1, 1, 1], [-1, 1, 1.5]].forEach(([sx, sy, q]) => { ctx.beginPath(); ctx.arc(vx + sx * sz, vy + sy * sz, sz, q * Math.PI, (q + 0.5) * Math.PI); ctx.stroke(); }); }
    } else if (k === 'sad') {
      const f = a < 3.2 ? clamp(a / 0.3, 0, 1) : Math.max(0, 1 - (a - 3.2) / 0.6);
      if (f > 0) { ctx.globalAlpha = f * 0.85; ctx.strokeStyle = '#3d4b66'; ctx.lineWidth = lw * 0.8;
        [-0.55, 0, 0.55].forEach((o, i) => { const sw = Math.sin(a * 2 + i) * r * 0.04; ctx.beginPath(); ctx.moveTo(cx + o * r + sw, cy - r * 1.18); ctx.lineTo(cx + o * r + sw, cy - r * (1.42 + 0.06 * i % 2)); ctx.stroke(); }); }
    } else if (k === 'happy') {
      const f = a < 1.6 ? Math.sin(clamp(a / 1.6, 0, 1) * Math.PI) : 0;
      if (f > 0) { ctx.globalAlpha = f; ctx.fillStyle = '#ffcf33'; ctx.strokeStyle = col; ctx.lineWidth = lw * 0.45; const sx = cx + r * 0.95, sy = cy - r * 0.85, sz = r * 0.2 * (0.8 + 0.3 * Math.sin(a * 12)); ctx.beginPath();
        for (let i = 0; i < 8; i++) { const ang = i * Math.PI / 4, rr = i % 2 ? sz * 0.32 : sz; ctx.lineTo(sx + Math.cos(ang) * rr, sy + Math.sin(ang) * rr); } ctx.closePath(); ctx.fill(); ctx.stroke(); }
    }
    ctx.restore();
  }
  function armFK(l, a1, bend) {
    const ex = l * Math.sin(a1), ey = l * Math.cos(a1), a2 = a1 + bend;
    return { ex, ey, hx: ex + l * Math.sin(a2), hy: ey + l * Math.cos(a2) };
  }


  /* ---------------------------------------------------------------- bộ lọc phong cách */
  const _lookC = {};
  function noiseTile(a) { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), d = g.createImageData(256, 256); let sd = 7; for (let i = 0; i < d.data.length; i += 4) { sd = (sd * 1664525 + 1013904223) >>> 0; const v = (sd >>> 24); d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = a; } g.putImageData(d, 0, 0); return c; }
  function vignette(W, H, a) { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); const gr = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${a})`); g.fillStyle = gr; g.fillRect(0, 0, W, H); return c; }
  function solid(W, H, col) { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, W, H); return c; }
  function lookLayers(look, W, H) {
    const key = look + W + 'x' + H; if (_lookC[key]) return _lookC[key]; const k = W / 720, L = [];
    if (look === 'paper') {
      const c = solid(W, H, 'rgba(253,246,227,0.42)'), g = c.getContext('2d'); g.strokeStyle = 'rgba(76,90,105,0.10)'; g.lineWidth = 1; const st = 64 * k;
      for (let x = 0; x < W; x += st) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); } for (let y = 0; y < H; y += st) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      L.push({ op: 'multiply', c, a: 1 });
    } else if (look === 'cozy') { L.push({ op: 'multiply', c: solid(W, H, 'rgb(255,236,210)'), a: 0.35 }, { op: 'multiply', c: vignette(W, H, 0.5), a: 1 }, { op: 'grain', a: 0.05 });
    } else if (look === 'noir') { L.push({ op: 'multiply', c: solid(W, H, 'rgb(255,196,120)'), a: 0.55 }, { op: 'multiply', c: vignette(W, H, 0.85), a: 1 }, { op: 'grain', a: 0.08 });
    } else if (look === 'cave') { L.push({ op: 'multiply', c: solid(W, H, 'rgb(232,200,158)'), a: 0.55 }, { op: 'multiply', c: vignette(W, H, 0.6), a: 1 }, { op: 'grain', a: 0.10 });
    } else if (look === 'retro') {
      const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.fillStyle = 'rgba(0,0,0,0.20)'; for (let y = 0; y < H; y += 4 * k) g.fillRect(0, y, W, 1.5 * k);
      L.push({ op: 'multiply', c: solid(W, H, 'rgb(225,238,235)'), a: 0.45 }, { op: 'source-over', c, a: 1 }, { op: 'multiply', c: vignette(W, H, 0.9), a: 1 }, { op: 'grain', a: 0.06 });
    }
    return (_lookC[key] = L);
  }
  let _noise = null;
  function applyLook(ctx, W, H, look, t) {
    if (!look || look === 'none') return; const L = lookLayers(look, W, H); if (!L.length) return;
    ctx.save();
    for (const l of L) {
      if (l.op === 'grain') { _noise = _noise || noiseTile(255); const f = Math.floor(t * 12), ox = (f * 97) % 256, oy = (f * 61) % 256; ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = l.a * 2.5; ctx.fillStyle = ctx.createPattern(_noise, 'repeat'); ctx.translate(-ox, -oy); ctx.fillRect(ox, oy, W, H); ctx.translate(ox, oy); }
      else { ctx.globalCompositeOperation = l.op; ctx.globalAlpha = l.a; ctx.drawImage(l.c, 0, 0); }
    }
    ctx.restore();
  }

  /* ---------------------------------------------------------------- timeline */
  function estDur(text) { return Math.max(1.4, text.split(/\s+/).length * 0.38); }

  function buildTimeline(project, A) {
    const story = project.story, audio = project.audio || {};
    const scenes = []; let t = 0.5;
    story.scenes.forEach((sc, si) => {
      const S = { sc, si, t0: t, beats: [], tracks: {} };
      t += 0.5; // thời gian cho nhân vật vào
      sc.beats.forEach((b, bi) => {
        const au = audio[si + ':' + bi];
        const hasText = !!(b.text && b.text.trim());
        const dur = au ? au.duration : (hasText ? Math.max(estDur(b.text), +b.dur || 0) : (+b.dur || 1.5));
        const B = { b, bi, t0: t, dur, t1: t + dur + (b.pause_after || 0.25), au, speechEnd: t + dur };
        S.beats.push(B); t = B.t1;
      });
      t += 0.5;
      S.t1 = t; scenes.push(S);
      buildTracks(S, A); autoFace(S); buildShots(S);
    });
    const fx = collectSfx(scenes, project.sfx || 'calm');
    return { scenes, duration: t + 0.8, clips: collectClips(scenes), sfx: fx.sfx, beds: fx.beds };
  }

  /* ---------------------------------------------------------------- âm thanh theo hành động */
  const surfaceFor = (bg) => /village|park|river/.test(bg) ? 'grass' : /home|classroom|office|hospital/.test(bg) ? 'wood' : 'step';
  const bedFor = (bg) => /rain/.test(bg) ? ['bed_rain', 0.16] : /street|school_gate/.test(bg) ? ['bed_street', 0.09] : /village|park|river/.test(bg) ? ['bed_birds', 0.10] : /home|classroom|office|hospital/.test(bg) ? ['bed_room', 0.07] : null;
  function collectSfx(scenes, mode) {
    const ev = [], beds = [];
    if (mode === 'off') return { sfx: ev, beds };
    const comic = mode === 'comic';
    const add = (id, t, g) => { if (t < 0) return; if (ev.some(e => e.id === id && Math.abs(e.t - t) < 0.12)) return; ev.push({ id, t: +t.toFixed(3), g }); };
    scenes.forEach((S, si) => {
      const bg = S.sc.background || '';
      const sf = surfaceFor(bg), ids = sf === 'grass' ? ['grass'] : sf === 'wood' ? ['wood_a', 'wood_b', 'wood_c'] : ['step_a', 'step_b', 'step_c', 'step_d'];
      if (si > 0) add(comic ? 'swish_a' : 'transition', S.t0 - 0.05, comic ? 0.3 : 0.16);
      const bd = bedFor(bg);
      if (bd) { const last = beds[beds.length - 1]; if (last && last.id === bd[0] && Math.abs(last.t1 - S.t0) < 0.6) last.t1 = S.t1 + 0.3; else beds.push({ id: bd[0], t0: S.t0, t1: S.t1 + 0.3, g: bd[1] }); }
      for (const [nm, tr] of Object.entries(S.tracks)) {
        for (const sg of tr.seg) {
          if (Math.abs(sg.x1 - sg.x0) < 0.02) continue;
          const iv = sg.kind === 'run' ? 0.27 : 0.46; let n = 0;
          for (let tt = sg.t0 + 0.1; tt < sg.t1 - 0.05; tt += iv, n++) {
            const x = sg.x0 + (sg.x1 - sg.x0) * ((tt - sg.t0) / (sg.t1 - sg.t0)); if (x < -0.02 || x > 1.02) continue;
            add(ids[Math.floor(hash(nm + sg.t0 + n) * ids.length)], tt, (sg.kind === 'run' ? 0.42 : 0.32) * (0.85 + 0.3 * hash(nm + n + 'g')));
          }
        }
        for (const g of tr.gest) {
          if (g.type === 'jump') add('thud_med', g.t0 + 0.55, 0.32);
          else if (g.type === 'cheer' && comic) add('pop', g.t0 + 0.1, 0.3);
          else if (g.type === 'bow') add('cloth', g.t0 + 0.2, 0.2);
        }
        for (const st of tr.stance) {
          if (st.k === 'fall') { add('thud_soft', st.t + 0.52, 0.65); if (comic) add('squeak', st.t + 0.05, 0.3); }
          else if (st.k === 'sit' || st.k === 'stand' || st.k === 'getup') add('cloth', st.t + 0.3, 0.22);
        }
        let prev = 'neutral';
        for (const e of tr.emo) {
          if (e.e !== prev && comic) { if (e.e === 'surprised') add('boing', e.t, 0.3); else if (e.e === 'scared') add('squeak2', e.t, 0.3); }
          prev = e.e;
        }
      }
      for (const f of S.setFx) {
        if (f.k === 'door_open') add('door_open', f.t, 0.45); else if (f.k === 'door_close') add('door_close', f.t, 0.45);
        else if (f.k === 'press') add('ding', f.t, 0.28);
      }
    });
    ev.sort((a, b) => a.t - b.t);
    return { sfx: ev, beds };
  }
  function collectClips(scenes) {
    const out = [];
    for (const S of scenes) for (const B of S.beats) if (B.au) out.push({ file: B.au.file, start: B.t0 });
    return out;
  }

  function buildTracks(S, A) {
    const sc = S.sc; S.punch = []; S.setFx = [];
    for (const c of sc.cast) {
      const tr = { x0: SLOT_X[c.slot] || 0.5, slot: SLOT_X[c.slot] || 0.5, face0: c.facing || 'front', start: c.start || 'stand', seg: [], face: [], stance: [], gest: [], emo: [] };
      S.tracks[c.name] = tr;
    }
    const enters = new Set();
    for (const B of S.beats) for (const a of B.b.actions) if (a.do.startsWith('enter_')) enters.add(a.who);
    for (const [nm, tr] of Object.entries(S.tracks)) {
      if (tr.start.startsWith('offscreen')) {
        if (enters.has(nm)) tr.x0 = tr.start === 'offscreen_left' ? -0.15 : 1.15;
        else tr.start = 'stand';
      }
      tr.sit0 = tr.start === 'sit'; tr.dseg = [];
    }
    const last = {}; // x hiện tại & thời điểm rảnh của từng nhân vật
    for (const [nm, tr] of Object.entries(S.tracks)) last[nm] = { x: tr.x0, free: S.t0 + 0.2 };
    const W = 720; // tốc độ tính theo phần màn hình/giây
    for (const B of S.beats) {
      for (const [nm, e] of Object.entries(B.b.emotions || {})) if (S.tracks[nm]) { S.tracks[nm].emo.push({ t: B.t0 + 0.08, e }); if (e === 'surprised' || e === 'scared') S.punch.push(B.t0 + 0.08); }
      for (const a of B.b.actions) {
        const tr = S.tracks[a.who]; if (!tr) continue;
        let te = B.t0 + (a.at || 0) * B.dur; const L = last[a.who];
        const move = (x1, kind) => { te = Math.max(te, L.free); const sp = kind === 'run' ? 0.62 : 0.26; const d = Math.abs(x1 - L.x), dur = Math.max(0.3, d / sp); tr.seg.push({ t0: te, t1: te + dur, x0: L.x, x1, kind }); L.x = x1; L.free = te + dur; };
        switch (a.do) {
          case 'enter_left': L.x = -0.15; tr.x0 = -0.15; move(tr.slot, 'walk'); break;
          case 'enter_right': L.x = 1.15; tr.x0 = 1.15; move(tr.slot, 'walk'); break;
          case 'exit_left': move(-0.2, 'walk'); break;
          case 'exit_right': move(1.2, 'walk'); break;
          case 'walk_to': move(SLOT_X[a.to] || 0.5, 'walk'); break;
          case 'run_to': move(SLOT_X[a.to] || 0.5, 'run'); break;
          case 'face': tr.face.push({ t: te, to: a.to }); tr.userFace = true; break;
          case 'step_in': { te = Math.max(te, L.free); tr.dseg.push({ t0: te, t1: te + 0.9, from: 0, to: 1 }); tr.face.push({ t: te, to: 'back' }); L.free = te + 0.9; break; }
          case 'step_out': { te = Math.max(te, L.free); tr.dseg.push({ t0: te, t1: te + 0.9, from: 1, to: 0 }); tr.face.push({ t: te, to: 'front' }); L.free = te + 0.9; break; }
          case 'sit': tr.stance.push({ t: te, k: 'sit' }); break;
          case 'stand': tr.stance.push({ t: te, k: 'stand' }); break;
          case 'fall': tr.stance.push({ t: te, k: 'fall', dir: a.dir || 'right' }); S.punch.push(te + 0.55); break;
          case 'get_up': tr.stance.push({ t: te, k: 'getup' }); break;
          default: if (GESTURE_DUR[a.do]) tr.gest.push({ t0: te, t1: te + Math.min(GESTURE_DUR[a.do], Math.max(0.8, B.t1 - te + 0.4)), type: a.do });
        }
      }
    }
    for (const B of S.beats) for (const c of (B.b.cues || [])) if (c.fx) S.setFx.push({ t: B.t0 + c.at * B.dur, k: c.fx, v: c.value, who: c.who });
    S.setFx.sort((a, b) => a.t - b.t);
    for (const tr of Object.values(S.tracks)) { tr.face.sort((a, b) => a.t - b.t); tr.emo.sort((a, b) => a.t - b.t); tr.stance.sort((a, b) => a.t - b.t); tr.face.sort((a, b) => a.t - b.t); }
  }

  function xAt(tr, t) {
    let x = tr.x0, moving = null, dirMove = 0, dist = 0;
    for (const sg of tr.seg) { if (t >= sg.t0 && t < sg.t1) { const u = (t - sg.t0) / (sg.t1 - sg.t0); x = lerp(sg.x0, sg.x1, ease(u)); moving = sg.kind; dirMove = Math.sign(sg.x1 - sg.x0); dist = Math.abs(x - sg.x0); break; } if (t >= sg.t1) x = sg.x1; }
    return { x, moving, dirMove, dist };
  }
  function viewKey(tr, t) {
    const m = xAt(tr, t); let f = tr.face0; for (const e of tr.face) if (t >= e.t) f = e.to;
    if (m.moving) f = m.dirMove >= 0 ? 'right' : 'left';
    return (m.moving ? 'm' : '') + f;
  }
  function exprAt(tr, t) { let e = 'neutral'; for (const x of tr.emo) if (t >= x.t) e = x.e; return e; }

  /* khi hai nhân vật nói chuyện: tự quay mặt nhìn nhau (bình thường), quay thẳng ra khán giả khi cảm xúc mạnh */
  function autoFace(S) {
    const names = Object.keys(S.tracks); if (names.length < 2) return;
    if (!S.beats.some(B => names.includes(B.b.speaker))) return;
    const eligible = names.filter(n => { const tr = S.tracks[n]; return !tr.userFace && tr.face0 === 'front' && tr.start !== 'sit'; });
    if (!eligible.length) return;
    const lastTo = {};
    for (const B of S.beats) {
      if (!names.includes(B.b.speaker)) continue;
      const tt = B.t0 + 0.05;
      for (const nm of eligible) {
        const tr = S.tracks[nm]; if (xAt(tr, tt).moving) continue;
        let other = null, bd = 9; for (const o of names) if (o !== nm) { const d = Math.abs(xAt(S.tracks[o], tt).x - xAt(tr, tt).x); if (d < bd) { bd = d; other = o; } }
        if (!other) continue;
        const emo = (B.b.emotions || {})[nm] || exprAt(tr, tt);
        const to = STRONG.has(emo) ? 'front' : (xAt(S.tracks[other], tt).x >= xAt(tr, tt).x ? 'right' : 'left');
        if (lastTo[nm] !== to) { tr.face.push({ t: tt, to }); lastTo[nm] = to; }
      }
    }
    for (const n of eligible) S.tracks[n].face.sort((a, b) => a.t - b.t);
  }

  /* đạo diễn: chia mỗi cảnh thành các shot 2–4 giây, đổi cỡ cảnh (toàn/trung/cận), camera luôn trôi nhẹ như video mẫu */
  const SHOT = {
    wide:   { z: [1.0, 1.08], fy: 0.55 },
    two:    { z: [1.3, 1.42], fy: 0.62 },
    medium: { z: [1.55, 1.72], fy: 0.66 },
    close:  { z: [2.1, 2.45], fy: 0.82 },
    pull:   { z: [1.95, 1.2], fy: 0.7 },
    pov:    { z: [1.0, 1.05], fy: 0.5 },
    push:   { z: [1.15, 1.6], fy: 0.62 },
  };
  function buildShotsFromCues(S) {
    const sc = S.sc, names = Object.keys(S.tracks), def = sc.set && global.StkSets.DEFS[sc.set];
    const marks = [];
    for (const B of S.beats) for (const c of (B.b.cues || [])) if (c.angle || c.cam) marks.push({ t: B.t0 + c.at * B.dur, angle: c.angle, cam: c.cam, who: c.who, B });
    if (!marks.length) return null;
    marks.sort((a, b) => a.t - b.t);
    if (marks[0].t > S.t0 + 0.05) marks.unshift({ t: S.t0, angle: def ? def.default : 'main', cam: 'wide', B: S.beats[0] });
    const shots = []; let angle = def ? def.default : 'main', cam = 'wide';
    marks.forEach((m, i) => {
      const t0 = i === 0 ? S.t0 : m.t, t1 = i + 1 < marks.length ? marks[i + 1].t : S.t1;
      const newAngle = m.angle || angle;
      cam = m.cam || (newAngle === 'panel' ? 'pov' : (newAngle !== angle ? 'wide' : cam)); angle = newAngle;
      const B = S.beats.find(b => m.t >= b.t0 && m.t < b.t1) || m.B;
      const spk = names.includes(B.b.speaker) ? B.b.speaker : names[0];
      const sd = hash(S.si + ':x' + i);
      shots.push({ t0, t1: Math.max(t1, t0 + 0.2), type: angle === 'panel' ? 'pov' : cam, angle, focus: m.who || ((cam === 'wide' || cam === 'two') ? 'all' : spk), idx: shots.length, drift: (sd < 0.5 ? -1 : 1) * (0.012 + 0.015 * sd), rev: false });
    });
    if (shots.length) shots[shots.length - 1].t1 = Math.max(shots[shots.length - 1].t1, S.t1);
    return shots;
  }
  function buildShots(S) {
    const ex = buildShotsFromCues(S); if (ex) { S.shots = ex; return; }
    const sc = S.sc, names = Object.keys(S.tracks), hint = sc.camera || 'static';
    const shots = []; let prev = null, closeRun = 0;
    const alt = { close: names.length > 1 ? 'two' : 'medium', medium: names.length > 1 ? 'two' : 'close', wide: 'medium', two: 'close', pull: 'medium', push: 'close' };
    const salt = Math.floor(hash(sc.id || S.si) * 4);
    const push = (t0, t1, type, focus) => {
      if (type === prev) type = alt[type] || 'medium';
      if (type === 'close' && closeRun >= 2) type = names.length > 1 ? 'two' : 'medium';
      if ((type === 'two') && names.length < 2) type = 'medium';
      closeRun = type === 'close' ? closeRun + 1 : 0;
      const sd = hash(S.si + ':' + shots.length);
      shots.push({ t0, t1, type, angle: sc.set ? global.StkSets.DEFS[sc.set].default : 'main', focus: (type === 'wide' || type === 'two') ? 'all' : focus, idx: shots.length, drift: (sd < 0.5 ? -1 : 1) * (0.015 + 0.02 * sd), rev: sd > 0.75 });
      prev = type;
    };
    S.beats.forEach((B, bi) => {
      const dur = B.t1 - (bi === 0 ? S.t0 : B.t0), start = bi === 0 ? S.t0 : B.t0;
      const nseg = dur > 4.4 ? Math.round(dur / 3.4) : 1;
      const spk = B.b.speaker, isChar = names.includes(spk);
      const strong = Object.entries(B.b.emotions || {}).find(([n, e]) => STRONG.has(e) && names.includes(n));
      const act = B.b.actions.find(a => /^(run_to|fall|jump|enter_|exit_|walk_to|cheer)/.test(a.do));
      for (let k = 0; k < nseg; k++) {
        const t0 = start + dur * k / nseg, t1 = start + dur * (k + 1) / nseg;
        let type, focus = isChar ? spk : names[(shots.length + salt) % Math.max(1, names.length)];
        if (!shots.length) { type = hint === 'close_up' ? 'medium' : (hint === 'push_in' ? 'push' : 'wide'); focus = names[0]; }
        else if (strong && k === 0) { type = 'close'; focus = strong[0]; }
        else if (act && k === 0) { type = 'wide'; }
        else {
          const cyc = isChar ? (names.length > 1 ? ['medium', 'two', 'close', 'medium'] : ['medium', 'close', 'push'])
                             : (names.length > 1 ? ['two', 'medium', 'pull', 'wide'] : ['medium', 'push', 'wide', 'pull']);
          type = cyc[(shots.length + salt) % cyc.length];
        }
        push(t0, t1, type, focus);
      }
    });
    if (shots.length) shots[shots.length - 1].t1 = Math.max(shots[shots.length - 1].t1, S.t1);
    S.shots = shots;
  }
  function shotAt(S, t) { let sh = S.shots[0]; for (const x of S.shots) if (t >= x.t0) sh = x; return sh; }

  function charState(S, name, t, speakerBeat) {
    const tr = S.tracks[name]; if (!tr) return null;
    const m = xAt(tr, t);
    let facing = tr.face0; for (const f of tr.face) if (t >= f.t) facing = f.to;
    if (m.moving) facing = m.dirMove >= 0 ? 'right' : 'left';
    // quay người / bắt đầu đi: ép ngang rồi bật lại (che cú đổi góc nhìn)
    let sx = 1; const k1 = viewKey(tr, t);
    if (t > S.t0 + 0.35) for (let i = 1; i <= 5; i++) if (viewKey(tr, t - 0.04 * i) !== k1) { const age = 0.04 * (i - 1) + 0.02; sx = 0.3 + 0.7 * easeOutBack(age / 0.2); break; }
    // tư thế
    let sit = tr.sit0 ? 1 : 0, fall = 0, fallDir = 'right', ts = -1;
    for (const e of tr.stance) {
      if (t < e.t) break; const u = t - e.t;
      if (e.k === 'sit') sit = ease(u / 0.55); else if (e.k === 'stand') sit = 1 - ease(u / 0.55);
      else if (e.k === 'fall') { fall = Math.pow(clamp(u / 0.7, 0, 1), 2); fallDir = e.dir; sit = 0; ts = e.t; }
      else if (e.k === 'getup') { fall = 1 - ease(u / 1.0); }
    }
    let expr = 'neutral', emoAge = 99; for (const e of tr.emo) if (t >= e.t) { expr = e.e; emoAge = t - e.t; }
    let g = null; for (const gg of tr.gest) if (t >= gg.t0 && t < gg.t1) g = gg;
    const sp = speakerBeat && speakerBeat.b.text && speakerBeat.b.speaker === name && t >= speakerBeat.t0 + 0.05 && t <= speakerBeat.speechEnd;
    let depth = tr.dseg && tr.dseg.length ? (tr.dseg[0].from) : 0, dmove = 0;
    for (const dsg of (tr.dseg || [])) { if (t >= dsg.t1) depth = dsg.to; else if (t >= dsg.t0) { depth = lerp(dsg.from, dsg.to, ease((t - dsg.t0) / (dsg.t1 - dsg.t0))); dmove = dsg.to > dsg.from ? 1 : -1; break; } else break; }
    if (tr.dseg && tr.dseg.length && t < tr.dseg[0].t0) depth = tr.dseg[0].from;
    return { depth, dmove, x: m.x, moving: m.moving, dirMove: m.dirMove, dist: m.dist, facing, sit, fall, fallDir, expr, emoAge, g, sx, speaking: !!sp };
  }

  function wordPulse(B, t) {
    if (!B) return 0; const u = t - B.t0, ws = B.au && B.au.words;
    if (ws && ws.length && ws[0].kind === 'WordBoundary') { let p = 0; for (const w of ws) { if (u >= w.t0) { const a = u - w.t0; if (a < 0.5) p = Math.max(p, Math.exp(-a * 8)); } else break; } return p; }
    return Math.pow(Math.max(0, Math.sin(t * 6.5)), 2) * 0.8;
  }

  function mouthLevel(B, t) {
    if (!B) return 0;
    const u = t - B.t0;
    if (B.au && B.au.words && B.au.words.length && B.au.words[0].kind === 'WordBoundary') {
      let inWord = false; for (const w of B.au.words) if (u >= w.t0 - 0.02 && u <= w.t1) { inWord = true; break; }
      if (!inWord) return 0;
    }
    const v = 0.5 + 0.5 * Math.sin(t * 19) * Math.sin(t * 6.1 + 1);
    return Math.min(3, Math.floor(v * 4.2));
  }

  /* ---------------------------------------------------------------- tư thế từ trạng thái */
  function makePose(A, st, t, ctxInfo) {
    const sty = styleOf(A); const { W, H, groundY, charH } = ctxInfo;
    const S = (charH * (A.meta.height || 1)) / A.rig.ref_height * (1 - 0.1 * (st.depth || 0));
    const P = { S, x: st.x * W, gy: groundY - (st.depth || 0) * H * 0.02, view: 'front', flip: false, dy: 0, lean: 0, rot: 0, lift: 0, tilt: 0, headDx: 0, headDy: 0, expr: st.expr, mouth: 0, fallAmt: st.fall,
      legs: [{ a: 0, k: 0 }, { a: 0, k: 0 }], arms: [{ th: 0, bend: 0 }, { th: 0, bend: 0 }], sx: st.sx, hipDx: 0, fx: (st.expr !== 'neutral' && st.emoAge < 6) ? { k: st.expr, age: st.emoAge } : null };
    const seed = hash(A.name) * 6.283;
    const sideFace = sty.side_faces === 'left';
    const setFace = (face) => { P.flip = (face === 'left') !== sideFace; };
    const g = st.g; let gu = 0, gw = 0;
    if (g) { gu = t - g.t0; gw = Math.min(Math.min(1.12, easeOutBack(gu / 0.3)), ease((g.t1 - t) / 0.25)); }
    const hasHeadsAsset = !!A.views.side;
    // chọn góc nhìn
    let face = st.facing;
    if (ctxInfo.backView && !st.moving && !st.dmove) face = 'back';
    if (st.fall > 0 || st.sit > 0.05) { P.view = hasHeadsAsset ? 'side' : 'front'; face = st.fall > 0 ? (st.fallDir === 'right' ? 'left' : 'right') : (face === 'left' ? 'left' : 'right'); setFace(face); }
    else if (st.dmove) { P.view = st.dmove > 0 ? (A.views.back ? 'back' : 'front') : 'front'; }
    else if (st.moving) { P.view = A.views.side ? 'side' : 'front'; setFace(face); }
    else if (face === 'front') P.view = 'front';
    else if (face === 'back') P.view = A.views.back ? 'back' : 'front';
    else { P.view = A.views.side ? 'side' : 'front'; setFace(face); }
    if (g && (g.type === 'bow' || g.type === 'point') && P.view === 'front' && A.views.side) { P.view = 'side'; setFace(st.x < 0.5 ? 'right' : 'left'); face = st.x < 0.5 ? 'right' : 'left'; }
    if (!A.views[P.view]) P.view = 'front';
    const V = A.views[P.view];
    const side = P.view === 'side' || P.view === 'three';
    const legL = Math.hypot(V.feet[0][0] - V.hips[0][0], V.feet[0][1] - V.hips[0][1]) * sty.leg_mul;

    // bước vào/ra khoang (đi dọc trục sâu): chân đổi nhịp tại chỗ
    if (st.dmove) {
      const ph = (t - 0) * 9 + seed;
      for (let i = 0; i < 2; i++) { const p = ph + i * Math.PI; P.legs[i] = { a: 12 * Math.sin(p), k: 22 * Math.max(0, Math.cos(p)) }; P.arms[i] = { th: -10 * Math.sin(p), bend: 8 }; }
      P.dy = -Math.abs(Math.sin(ph)) * 2.6 * P.S * V.scale; P.lean = 2;
    } else if (st.moving) {
      const run = st.moving === 'run', stride = (run ? 70 : 46) * P.S * V.scale;
      const ph = (st.dist * W / stride) * Math.PI;
      const amp = run ? 42 : 26, kn = run ? 62 : 32;
      for (let i = 0; i < 2; i++) { const p = ph + i * Math.PI; P.legs[i] = { a: amp * Math.sin(p), k: kn * Math.max(0, Math.cos(p)) }; P.arms[i] = { th: -(run ? 38 : 22) * Math.sin(p), bend: run ? 55 : 14 }; }
      P.dy = -Math.abs(Math.sin(ph)) * (run ? 7 : 3.4) * P.S * V.scale; P.lean = (run ? 10 : 3) + Math.sin(ph * 2) * (run ? 1.5 : 0.8); P.headDy += Math.sin(ph * 2) * 0.8; P.tilt += Math.sin(ph) * (run ? 2.5 : 1.2);
    } else if (st.sit > 0.01) {
      const s = st.sit;
      for (let i = 0; i < 2; i++) P.legs[i] = { a: 90 * s, k: 90 * s };
      P.dy = legL * 0.5 * s * P.S * V.scale; P.arms[0] = { th: 20 * s, bend: 40 * s }; P.arms[1] = { th: 20 * s, bend: 40 * s };
      P.lean = 3 * s;
    } else {
      const br = Math.sin(t * 1.9 + seed), sw = Math.sin(t * 1.1 + seed * 1.7) * 2.6 + br * 0.8;
      P.lean += br * 0.55 + Math.sin(t * 0.7 + seed * 2) * 0.55;           // thở + đung đưa
      P.hipDx += Math.sin(t * 0.63 + seed) * 1.6;                           // dồn trọng tâm
      P.headDy += br * 0.5; P.tilt += Math.sin(t * 0.5 + seed) * 1.8;
      P.arms[0].th += sw * (side ? 1 : -1); P.arms[1].th += -sw * (side ? 1 : -1) * 0.85;
      P.arms[0].bend += 3 + br * 1.2; P.arms[1].bend += 3 - br * 1.2;
    }
    if (st.sit > 0.01 && !st.moving) { const br2 = Math.sin(t * 1.9 + seed); P.lean += br2 * 0.5; P.headDy += br2 * 0.5; P.tilt += Math.sin(t * 0.5 + seed) * 1.2; }
    // dùng chung cho cử chỉ
    const sh0 = V.shoulders[0], sh1 = V.shoulders[V.shoulders.length - 1];
    const Lh = Math.hypot(V.hands[0][0] - sh0[0], V.hands[0][1] - sh0[1]) * sty.arm_mul || 1;
    const headC = V.chin[1] - (V.head_h || 40) * 0.5, tyH = (headC - sh0[1]) / Lh, txH = ((V.head_w || 40) * 0.42) / Lh;
    const calm = !g && !st.moving && st.sit < 0.5 && !st.fall;
    // nói: đầu gật theo từng từ, thân nhún nhẹ, tay khua theo ý
    if (st.speaking) {
      const pu = ctxInfo.pulse || 0, bs = ctxInfo.beatSeed || 0, sgn = bs < 0.5 ? 1 : -1;
      P.mouth = ctxInfo.mouth; P.tilt += Math.sin(t * 2.3 + seed) * 1.5 + pu * 2.4 * sgn; P.headDy += pu * 2.4; P.lean += pu * 1.1 * sgn; P.dy -= pu * 0.9 * P.S * V.scale;
      if (calm) {
        const gate = ease(clamp(Math.sin(t * 0.85 + bs * 6.28) * 1.7 + 0.45, 0, 1));
        if (gate > 0.01) {
          const osc = Math.sin(t * 3.4 + seed), ph2 = Math.sin(t * 1.9 + bs * 5);
          const use = (i, x, y, w) => { P.arms[i] = { ik: [x, y], w: w * gate, elbow: side ? 'down' : 'out', th: P.arms[i].th, bend: P.arms[i].bend }; };
          if (side) { use(0, 0.62 + 0.1 * osc + 0.12 * pu, -0.2 + 0.18 * ph2 - 0.15 * pu, 0.8); }
          else if (bs < 0.5) { use(1, 0.62 + 0.1 * osc + 0.1 * pu, -0.2 + 0.2 * ph2 - 0.2 * pu, 0.8); if (bs < 0.2) use(0, -0.55 - 0.08 * osc, -0.12 + 0.15 * ph2, 0.6); }
          else { use(0, -0.62 - 0.1 * osc - 0.1 * pu, -0.2 + 0.2 * ph2 - 0.2 * pu, 0.8); if (bs > 0.8) use(1, 0.55 + 0.08 * osc, -0.12 + 0.15 * ph2, 0.6); }
        }
      }
    } else if (ctxInfo.someoneSpeaking && calm) { // nghe: thỉnh thoảng gật đầu
      const nn = Math.pow(Math.max(0, Math.sin(t * 0.9 + seed * 5)), 14); P.headDy += nn * 2.6; P.tilt += nn * 3.2;
    }
    // ngôn ngữ cơ thể theo cảm xúc
    if (calm) {
      const ea = st.emoAge;
      if (st.expr === 'sad') { P.lean += 3.5; P.headDy += 2.5; P.tilt -= 3; P.arms[0].th += 2; P.arms[1].th -= 2; }
      else if (st.expr === 'angry') { P.lean += 2; const sh = ea < 1.5 ? 0.6 : 0.25; P.headDx += Math.sin(t * 38) * sh; P.hipDx += Math.sin(t * 33) * sh * 0.8; }
      else if (st.expr === 'scared') { P.lean -= 2; P.hipDx += Math.sin(t * 41) * 1.0; P.headDx += Math.sin(t * 37 + 1) * 1.0; }
      else if (st.expr === 'surprised') { const rc = Math.exp(-ea * 6); P.lean -= 9 * rc; P.headDy -= 3 * rc; if (ea < 0.22) P.dy -= Math.sin(clamp(ea / 0.22, 0, 1) * Math.PI) * 6 * P.S * V.scale; }
      else if (st.expr === 'happy' && ea < 1.6) { P.dy -= Math.abs(Math.sin(t * 6)) * 2.5 * P.S * V.scale * (1 - ea / 1.6); }
    }
    // cử chỉ
    if (g && gw > 0) {
      const set = (i, ikv, w, elbow) => { P.arms[i] = { ik: ikv, w: w * gw, elbow, th: P.arms[i].th, bend: P.arms[i].bend }; };
      const osc = Math.sin(gu * 9);
      switch (g.type) {
        case 'wave': if (side) set(0, [0.45 + 0.12 * osc, -0.92], 1, 'down'); else set(1, [0.6 + 0.12 * osc, -0.9], 1, 'down'); P.tilt += 2 * gw; break;
        case 'point': if (side) set(0, [0.98, -0.12], 1, 'down'); else set(1, [0.98, -0.1], 1, 'down'); P.lean += 3 * gw; break;
        case 'shrug': if (side) { set(0, [0.55, 0.05], 1, 'down'); set(1, [0.5, 0.1], 1, 'down'); } else { set(0, [-0.85, -0.05], 1, 'out'); set(1, [0.85, -0.05], 1, 'out'); } P.headDy -= 1.5 * gw; P.tilt += 4 * gw; break;
        case 'cheer': if (side) { set(0, [0.3 + 0.1 * osc, -1], 1, 'down'); set(1, [0.1, -1], 1, 'down'); } else { set(0, [-0.42 - 0.08 * osc, -1], 1, 'out'); set(1, [0.42 + 0.08 * osc, -1], 1, 'out'); } P.dy -= Math.abs(Math.sin(gu * 8)) * 8 * P.S * V.scale * gw; break;
        case 'hands_on_head': if (side) { set(0, [0.0, tyH], 1, 'down'); set(1, [0.05, tyH], 1, 'down'); } else { set(0, [-txH, tyH], 1, 'out'); set(1, [txH, tyH], 1, 'out'); } P.tilt += Math.sin(gu * 6) * 2 * gw; break;
        case 'cover_face': { const tf = (V.chin[1] - (V.head_h || 40) * 0.35 - sh0[1]) / Lh; if (side) { set(0, [0.12, tf], 1, 'down'); set(1, [0.12, tf], 1, 'down'); } else { set(0, [-0.1, tf], 1, 'out'); set(1, [0.1, tf], 1, 'out'); } P.headDy += 2 * gw; P.tilt += Math.sin(gu * 14) * 1.5 * gw; break; }
        case 'bow': P.lean += 30 * Math.sin(Math.min(1, gu / (g.t1 - g.t0)) * Math.PI) * gw; break;
        case 'nod': P.tilt += 9 * Math.sin(gu * 8) * gw; P.headDy += 1.2 * Math.abs(Math.sin(gu * 8)) * gw; break;
        case 'shake_head': P.headDx += 4 * Math.sin(gu * 14) * gw; P.tilt += 6 * Math.sin(gu * 14) * gw; break;
        case 'jump': { const u = gu / 0.8; P.dy -= Math.sin(clamp(u, 0, 1) * Math.PI) * 70 * (P.S * V.scale / 2.2) * 1; for (let i = 0; i < 2; i++) P.legs[i] = { a: 0, k: 25 * Math.sin(clamp(u, 0, 1) * Math.PI) }; break; }
      }
    }
    // ngã
    if (st.fall > 0) {
      const f = st.fall, rotSign = st.fallDir === 'right' ? 1 : -1;
      P.rot = 90 * f * rotSign; P.lift = -(V.w * 0.18 * P.S * V.scale) * f;
      P.x -= rotSign * 0.5 * A.rig.ref_height * P.S * f; // thân nằm giữa chỗ đứng, không tràn ra mép
      const flail = f < 0.98 ? Math.sin(t * 22) * 0.25 : 0;
      P.arms[0] = { ik: [-0.5 + flail, -0.9], w: Math.sin(f * Math.PI) * 0.9, elbow: 'down' }; P.arms[1] = { ik: [0.5 - flail, -0.9], w: Math.sin(f * Math.PI) * 0.9, elbow: 'down' };
      P.legs[0] = { a: 8 * f, k: 10 * f }; P.legs[1] = { a: -6 * f, k: 4 * f };
    }
    return P;
  }

  /* ---------------------------------------------------------------- camera */
  function shake(t, W) { const k = W / 720; return [(Math.sin(t * 1.7) + 0.6 * Math.sin(t * 3.3 + 1.3) + 0.3 * Math.sin(t * 7.1 + 0.4)) * 1.5 * k, (Math.sin(t * 1.3 + 2) + 0.6 * Math.sin(t * 2.9 + 0.7) + 0.3 * Math.sin(t * 6.3)) * 1.2 * k]; }
  const vn = (x, seed) => { const i = Math.floor(x), f = x - i, a = hash(seed + ':' + i), b = hash(seed + ':' + (i + 1)); return lerp(a, b, f * f * (3 - 2 * f)) * 2 - 1; };
  function rideShake(t, W, amp) { const k = W / 720; return [(vn(t * 9, 'x') * 1.2 + vn(t * 23, 'x2') * 0.6) * 2.2 * k * amp, (vn(t * 7.3, 'y') * 2.4 + vn(t * 19, 'y2') * 1.1 + Math.sin(t * 31) * 0.4) * 3.4 * k * amp]; }
  function finishCam(S, t, W, H, z, cx, cy, extra) {
    for (const pt of (S.punch || [])) { const a = t - pt; if (a >= 0 && a < 0.5) z *= 1 + 0.07 * Math.exp(-a * 9); }
    z *= 1 + 0.004 * Math.sin(t * 0.9);
    const hw = W / z / 2, hh = H / z / 2;
    if (extra > 0) z = Math.max(z, 1.07);
    const sh = shake(t, W); cx += sh[0] / z; cy += sh[1] / z;
    if (extra > 0) { const rs = rideShake(t, W, extra); cx += rs[0] / z; cy += rs[1] / z; }
    cx = clamp(cx, hw, W - hw); cy = clamp(cy, hh, H - hh);
    return { z, cx, cy };
  }
  function cameraShot(S, shot, t, W, H, groundY, charH, states, extra) {
    const d = SHOT[shot.type] || SHOT.medium, u = clamp((t - shot.t0) / Math.max(0.5, shot.t1 - shot.t0), 0, 1), e = ease(u);
    const z0 = shot.rev ? d.z[1] : d.z[0], z1 = shot.rev ? d.z[0] : d.z[1];
    const on = Object.keys(states).filter(n => states[n].x > -0.05 && states[n].x < 1.05);
    let fx = W / 2;
    if (shot.focus !== 'all' && states[shot.focus] && states[shot.focus].x > -0.05 && states[shot.focus].x < 1.05) fx = states[shot.focus].x * W;
    else if (on.length) fx = on.reduce((a, n) => a + states[n].x * W, 0) / on.length;
    let z = lerp(z0, z1, e), cx = fx + shot.drift * W * (u - 0.5), cy = groundY - charH * d.fy;
    if (shot.focus === 'all' && on.length > 1) { const xs = on.map(n => states[n].x * W), span = Math.max(...xs) - Math.min(...xs) + charH * 0.55; z = Math.min(z, Math.max(1, W / span)); }
    return finishCam(S, t, W, H, z, cx, cy, extra);
  }
  function cameraFor(S, tl, t, W, H, groundY, charH, states, extra) {
    const u = clamp((t - S.t0) / (S.t1 - S.t0), 0, 1), e = ease(u);
    const cam = S.sc.camera || 'static';
    let z = 1, cx = W / 2, cy = H / 2;
    const names = Object.keys(S.tracks);
    let fx = W / 2; if (names.length) fx = names.reduce((a, n) => a + states[n].x * W, 0) / names.length; fx = clamp(fx, W * 0.3, W * 0.7);
    const fy = groundY - charH * 0.62;
    if (cam === 'push_in') { z = lerp(1, 1.4, e); cx = lerp(W / 2, fx, e); cy = lerp(H / 2, fy, e); }
    else if (cam === 'pull_out') { z = lerp(1.45, 1, e); cx = lerp(fx, W / 2, e); cy = lerp(fy, H / 2, e); }
    else if (cam === 'pan_left') { z = 1.2; cx = lerp(W * 0.6, W * 0.4, e); cy = H / 2 + (groundY - charH * 0.5 - H / 2) * 0.4; }
    else if (cam === 'pan_right') { z = 1.2; cx = lerp(W * 0.4, W * 0.6, e); cy = H / 2 + (groundY - charH * 0.5 - H / 2) * 0.4; }
    else if (cam === 'close_up') {
      let B = S.beats.find(b => t >= b.t0 && t < b.t1) || S.beats[0]; const sp = B.b.speaker in states ? B.b.speaker : names[0];
      const x = sp ? states[sp].x * W : W / 2; const k = ease(clamp((t - B.t0) / 0.6, 0, 1));
      z = lerp(1.3, 1.85, k); cx = lerp(W / 2, clamp(x, W * 0.28, W * 0.72), k); cy = lerp(H / 2, groundY - charH * 0.8, k);
    }
    return finishCam(S, t, W, H, z, cx, cy, extra);
  }

  /* ---------------------------------------------------------------- phụ đề */
  function chunkText(text, maxChars) {
    const parts = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?…;:])\s+/);
    const out = [];
    for (const p of parts) {
      if (p.length <= maxChars) { out.push(p); continue; }
      const words = p.split(' '); let cur = '';
      const n = Math.ceil(p.length / maxChars), target = p.length / n;
      for (const w of words) { if (cur && (cur + ' ' + w).length > target * 1.15) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; }
      if (cur) out.push(cur);
    }
    return out;
  }
  function subtitleAt(B, t) {
    if (!B._chunks) {
      const ch = chunkText(B.b.text, 44), total = ch.reduce((a, c) => a + c.length, 0) || 1;
      let acc = 0; const t0 = B.t0, span = Math.max(0.5, B.speechEnd - B.t0);
      B._chunks = ch.map(c => { const a = t0 + span * acc / total; acc += c.length; return { text: c, a, b: t0 + span * acc / total }; });
    }
    for (const c of B._chunks) if (t >= c.a - 0.02 && t < c.b + (c === B._chunks[B._chunks.length - 1] ? 0.25 : 0)) return c.text;
    return null;
  }
  function wrapText(ctx, text, maxW) {
    const words = text.split(' '), lines = []; let cur = '';
    for (const w of words) { const test = cur ? cur + ' ' + w : w; if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test; }
    if (cur) lines.push(cur); return lines;
  }

  /* ---------------------------------------------------------------- Player */
  class Player {
    constructor(canvas, project, chars, bgImgs, opts) {
      this.cv = canvas; this.ctx = canvas.getContext('2d'); this.W = canvas.width; this.H = canvas.height;
      this.project = project; this.A = chars; this.bgImgs = bgImgs || {}; this.opts = Object.assign({ subtitles: true, title: '', titleSec: 0, autoCam: true }, opts || {});
      this.landscape = this.W > this.H;
      this.groundY = this.H * (this.landscape ? 0.88 : 0.80); this.charH = this.H * (this.landscape ? 0.62 : 0.40);
      this.rebuild();
    }
    rebuild() { this.tl = buildTimeline(this.project, this.A); this.duration = this.tl.duration; }
    sceneAt(t) { let s = this.tl.scenes[0]; for (const S of this.tl.scenes) if (t >= S.t0) s = S; return s; }
    bgFor(S) { const id = S.sc.background; if (this.bgImgs[id]) return this.bgImgs[id]; return makeBg(id, this.W, this.H); }
    renderScene(S, t, ctx, shotOverride) {
      const W = this.W, H = this.H;
      const speakerBeat = S.beats.find(b => t >= b.t0 && t < b.t1) || null;
      const states = {}; for (const n of Object.keys(S.tracks)) states[n] = charState(S, n, t, speakerBeat);
      const setName = S.sc.set && global.StkSets && global.StkSets.DEFS[S.sc.set] ? S.sc.set : null;
      const shot = (S.shots && S.shots.length) ? (shotOverride || shotAt(S, t)) : null;
      const angle = setName ? ((shot && shot.angle) || global.StkSets.DEFS[setName].default) : 'main';
      const adef = setName ? (global.StkSets.DEFS[setName].angles[angle] || {}) : {};
      const sst = setName ? global.StkSets.state(S, t) : null;
      const extra = sst ? sst.shake : 0;
      const cam = (this.opts.autoCam !== false && shot) ? cameraShot(S, shot, t, W, H, this.groundY, this.charH, states, extra) : cameraFor(S, this.tl, t, W, H, this.groundY, this.charH, states, extra);
      const anySpeaking = !!(speakerBeat && speakerBeat.b.text && t >= speakerBeat.t0 + 0.05 && t <= speakerBeat.speechEnd && states[speakerBeat.b.speaker]);
      const pulse = anySpeaking ? wordPulse(speakerBeat, t) : 0, bseed = speakerBeat ? hash(S.si + ':' + speakerBeat.bi) : 0;
      ctx.save();
      ctx.translate(W / 2, H / 2); ctx.scale(cam.z, cam.z); ctx.translate(-cam.cx, -cam.cy);
      const env = this.setEnv();
      if (setName) global.StkSets.drawBack(ctx, setName, angle, sst, W, H, env);
      else { const bg = this.bgFor(S); if (bg.width === W && bg.height === H) ctx.drawImage(bg, 0, 0); else { const k = Math.max(W / bg.width, H / bg.height); ctx.drawImage(bg, (W - bg.width * k) / 2, (H - bg.height * k) / 2, bg.width * k, bg.height * k); } }
      const order = Object.keys(states).sort((a, b) => states[a].x - states[b].x);
      const drawOne = (n) => {
        const st = states[n], A = this.A[n]; if (!A) return; if (st.x < -0.3 || st.x > 1.3) return;
        const ml = st.speaking ? mouthLevel(speakerBeat, t) : 0;
        const P = makePose(A, st, t, { W, H, groundY: this.groundY, charH: this.charH, mouth: ml, pulse: st.speaking ? pulse : 0, beatSeed: bseed, someoneSpeaking: anySpeaking && !st.speaking, backView: !!adef.backView });
        drawChar(ctx, A, P);
      };
      if (!adef.hideChars) {
        if (adef.splitDepth) { for (const n of order) if (states[n].depth >= 0.5) drawOne(n); global.StkSets.drawDoors(ctx, setName, angle, sst, W, H, env); for (const n of order) if (states[n].depth < 0.5) drawOne(n); }
        else { if (setName) global.StkSets.drawDoors(ctx, setName, angle, sst, W, H, env); for (const n of order) drawOne(n); }
      } else if (setName) global.StkSets.drawDoors(ctx, setName, angle, sst, W, H, env);
      ctx.restore();
      return speakerBeat;
    }
    setEnv() {
      if (this._env) return this._env;
      const A = Object.values(this.A)[0]; const sty = A ? styleOf(A) : {};
      return (this._env = { groundY: this.groundY, charH: this.charH, lineCol: sty.line_color || '#111', handFill: sty.hand_fill || '#fff', lw: Math.max(3, (sty.stroke || 3) * (this.charH / ((A && A.rig.ref_height) || 400))) });
    }
    render(t) {
      const ctx = this.ctx, W = this.W, H = this.H;
      t = clamp(t, 0, this.duration);
      let S = this.sceneAt(t), idx = this.tl.scenes.indexOf(S);
      const XF = 0.45; let beat;
      if (idx > 0 && t - S.t0 < XF) {
        const prev = this.tl.scenes[idx - 1]; this.renderScene(prev, t, ctx);
        const tmp = this._tmp || (this._tmp = document.createElement('canvas')); tmp.width = W; tmp.height = H;
        beat = this.renderScene(S, t, tmp.getContext('2d'));
        ctx.globalAlpha = ease((t - S.t0) / XF); ctx.drawImage(tmp, 0, 0); ctx.globalAlpha = 1;
      } else if (this.opts.autoCam !== false && S.shots && S.shots.length > 1 && shotAt(S, t).idx > 0 && t - shotAt(S, t).t0 < 0.16 && S.shots[shotAt(S, t).idx - 1].angle === shotAt(S, t).angle) {
        const sh = shotAt(S, t); this.renderScene(S, t, ctx, S.shots[sh.idx - 1]);
        const tmp = this._tmp || (this._tmp = document.createElement('canvas')); tmp.width = W; tmp.height = H;
        beat = this.renderScene(S, t, tmp.getContext('2d'), sh);
        ctx.globalAlpha = ease((t - sh.t0) / 0.16); ctx.drawImage(tmp, 0, 0); ctx.globalAlpha = 1;
      } else beat = this.renderScene(S, t, ctx);
      applyLook(ctx, W, H, this.opts.look, t);
      const k = W / 720;
      ctx.textAlign = 'center'; ctx.lineJoin = 'round';
      if (this.opts.title && t < (this.opts.titleSec || 1e9)) { ctx.font = `800 ${Math.round(44 * k)}px "Be Vietnam Pro", system-ui, sans-serif`; ctx.lineWidth = 7 * k; ctx.strokeStyle = '#000'; ctx.fillStyle = '#ffe000'; ctx.strokeText(this.opts.title, W / 2, 80 * k); ctx.fillText(this.opts.title, W / 2, 80 * k); }
      if (this.opts.subtitles && beat && beat.b.text) {
        const txt = subtitleAt(beat, t);
        if (txt) {
          ctx.font = `700 ${Math.round(34 * k)}px "Be Vietnam Pro", system-ui, sans-serif`;
          const lines = wrapText(ctx, txt, W * 0.88); const lh = 42 * k, y0 = H - (this.landscape ? 70 : 150) * k - (lines.length - 1) * lh;
          const spk = beat.b.speaker !== 'narrator' ? beat.b.speaker : null;
          const ss = this.opts.subStyle || 'bold';
          if (ss === 'box') { const bw = Math.max(...lines.map(l => ctx.measureText(l).width)) + 36 * k; ctx.fillStyle = 'rgba(0,0,0,0.68)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(W / 2 - bw / 2, y0 - 34 * k, bw, lines.length * lh + 18 * k, 12 * k) : ctx.rect(W / 2 - bw / 2, y0 - 34 * k, bw, lines.length * lh + 18 * k); ctx.fill(); }
          lines.forEach((ln, i) => {
            if (ss === 'ink') { ctx.lineWidth = 6 * k; ctx.strokeStyle = 'rgba(253,250,240,.95)'; ctx.fillStyle = spk ? '#0b3d63' : '#1b1b1b'; ctx.strokeText(ln, W / 2, y0 + i * lh); ctx.fillText(ln, W / 2, y0 + i * lh); }
            else if (ss === 'box') { ctx.fillStyle = spk ? '#bfe9ff' : '#fff'; ctx.fillText(ln, W / 2, y0 + i * lh); }
            else { ctx.lineWidth = 7 * k; ctx.strokeStyle = '#000'; ctx.fillStyle = spk ? '#bfe9ff' : '#fff'; ctx.strokeText(ln, W / 2, y0 + i * lh); ctx.fillText(ln, W / 2, y0 + i * lh); }
          });
        }
      }
      if (t < 0.4) { ctx.fillStyle = `rgba(0,0,0,${1 - t / 0.4})`; ctx.fillRect(0, 0, W, H); }
      if (t > this.duration - 0.7) { ctx.fillStyle = `rgba(0,0,0,${clamp((t - (this.duration - 0.7)) / 0.7, 0, 1)})`; ctx.fillRect(0, 0, W, H); }
    }
  }

  global.Stk = { collectSfx, applyLook, Player, loadChar, loadImg, makeBg, BG, SLOT_X, drawChar, makePose, charState, styleOf, ease, clamp };
})(window);
