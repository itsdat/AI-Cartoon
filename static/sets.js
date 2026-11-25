/* "Set" = bối cảnh nhiều góc quay + đạo cụ chuyển động (cửa thang máy, nút bấm, số tầng, đèn nháy...).
   Tất cả là hàm thuần theo thời gian: state(S,t) → trạng thái đạo cụ; drawBack/drawDoors vẽ theo góc quay.
   Thứ tự vẽ do engine điều khiển: drawBack → (nhân vật trong khoang) → drawDoors → (nhân vật ngoài khoang). */
(function (global) {
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const hh = (n) => { let h = Math.imul(n | 0, 2654435761) ^ 0x9e3779b9; h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

  const DEFS = {
    elevator: {
      default: 'hall',
      angles: {
        hall: { splitDepth: true },       // nhân vật ở sâu trong khoang vẽ trước cửa, ngoài khoang vẽ sau cửa
        panel: { hideChars: true },       // góc nhìn của người trong thang máy: chỉ thấy bảng nút + bàn tay
        inside: { backView: true },       // trong thang máy nhìn ra cửa, nhân vật quay lưng
      },
    },
  };

  /* ------------------------------------------------------------ trạng thái đạo cụ theo thời gian */
  function state(S, t) {
    const sc = S.sc, ev = S.setFx || [];
    const st = { door: 0, floor: sc.floor_start || 1, lit: [], hand: null, ride: false, shake: 0, light: 1, arrow: 0 };
    const doors = ev.filter(e => e.k === 'door_open' || e.k === 'door_close');
    let dv = doors.length && doors[0].k === 'door_close' ? 1 : 0, anim = null;
    for (const e of doors) {
      if (e.t > t) break;
      if (anim) dv = lerp(anim.from, anim.to, ease((e.t - anim.t0) / 0.95));
      anim = { t0: e.t, from: dv, to: e.k === 'door_open' ? 1 : 0 };
    }
    st.door = anim ? lerp(anim.from, anim.to, ease((t - anim.t0) / 0.95)) : dv;
    let floor0 = sc.floor_start || 1, jolt = 0;
    const lit = new Set();
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i]; if (e.t > t) break;
      if (e.k === 'press') {
        const v = clamp(e.v || 1, 1, 20); lit.add(v);
        const p = (t - e.t) / 1.3; if (p >= 0 && p <= 1) st.hand = { p, floor: v };
        if (p >= 0.42) lit.add(v); else lit.delete(v);
      } else if (e.k === 'ride_start') {
        const target = clamp(e.v || floor0 + 1, 1, 20);
        const stop = ev.slice(i + 1).find(x => x.k === 'ride_stop');
        const t1 = stop ? stop.t : e.t + clamp(Math.abs(target - floor0) * 0.45, 2, 6);
        if (t < t1) { st.ride = true; st.floor = Math.round(lerp(floor0, target, clamp((t - e.t) / (t1 - e.t), 0, 1))); st.arrow = target >= floor0 ? 1 : -1; }
        else { st.floor = target; floor0 = target; lit.delete(target); }
        const a = t - e.t; if (a >= 0 && a < 0.5) jolt = Math.max(jolt, Math.exp(-a * 7) * 0.8);
      } else if (e.k === 'ride_stop') {
        const a = t - e.t; if (a >= 0 && a < 0.6) jolt = Math.max(jolt, Math.exp(-a * 6));
      } else if (e.k === 'flicker') {
        const a = t - e.t; if (a >= 0 && a < 1.3) st.light = (Math.floor(a * 14) % 3 === 1 || hh(Math.floor(a * 20)) < 0.25) ? 0.35 : 1;
      }
    }
    st.lit = [...lit];
    st.shake = (st.ride ? 1 : 0) + jolt * 1.6;
    return st;
  }

  /* ------------------------------------------------------------ tiện ích vẽ */
  function rr(ctx, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function steel(ctx, x, y, w, h, c0, c1) { const g = ctx.createLinearGradient(x, y, x + w, y); g.addColorStop(0, c0); g.addColorStop(0.5, c1); g.addColorStop(1, c0); ctx.fillStyle = g; ctx.fillRect(x, y, w, h); }
  function dim(ctx, W, H, light) { if (light < 1) { ctx.fillStyle = `rgba(8,10,16,${(1 - light) * 0.62})`; ctx.fillRect(0, 0, W, H); } }
  function digits(ctx, text, cx, cy, size, col) {
    ctx.save(); ctx.font = `700 ${size}px ui-monospace, Menlo, Consolas, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = col; ctx.shadowBlur = size * 0.45; ctx.fillStyle = col; ctx.fillText(text, cx, cy); ctx.restore();
  }
  function indicator(ctx, cx, y, w, h, st) {
    ctx.fillStyle = '#0b0c0f'; rr(ctx, cx - w / 2, y, w, h, h * 0.18); ctx.fill();
    ctx.strokeStyle = '#3b3f46'; ctx.lineWidth = Math.max(2, h * 0.07); ctx.stroke();
    digits(ctx, String(st.floor), cx + (st.arrow ? w * 0.08 : 0), y + h * 0.54, h * 0.62, '#ff3b30');
    if (st.arrow) { ctx.fillStyle = '#ff3b30'; const ax = cx - w * 0.3, ay = y + h * 0.5, s = h * 0.2, dir = -st.arrow; ctx.beginPath(); ctx.moveTo(ax, ay + dir * s); ctx.lineTo(ax - s * 0.9, ay - dir * s * 0.6); ctx.lineTo(ax + s * 0.9, ay - dir * s * 0.6); ctx.closePath(); ctx.fill(); }
  }
  function geo(W, H, env) {
    const gy = env.groundY, ch = env.charH;
    const dW = ch * 0.92, dH = ch * 1.26, dx = W / 2 - dW / 2, top = gy - dH;
    return { gy, ch, dW, dH, dx, top, xc: W / 2 };
  }

  /* ------------------------------------------------------------ góc "hall": hành lang nhìn vào cửa thang máy */
  function wallFloor(ctx, W, H, gy, st) {
    let g = ctx.createLinearGradient(0, 0, 0, gy); g.addColorStop(0, '#d8d1c3'); g.addColorStop(1, '#c4bcab'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, gy);
    g = ctx.createLinearGradient(0, gy, 0, H); g.addColorStop(0, '#948c7f'); g.addColorStop(1, '#6b645a'); ctx.fillStyle = g; ctx.fillRect(0, gy, W, H - gy);
    ctx.fillStyle = 'rgba(0,0,0,.14)'; ctx.fillRect(0, gy - H * 0.012, W, H * 0.012);          // len chân tường
    ctx.strokeStyle = 'rgba(0,0,0,.06)'; ctx.lineWidth = 2; for (let i = 1; i < 6; i++) { const x = (W / 6) * i; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, gy); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(0,0,0,.08)'; for (let i = 1; i < 5; i++) { const y = gy + (H - gy) * (i / 5) ** 1.6; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    const rg = ctx.createRadialGradient(W / 2, 0, 10, W / 2, 0, H * 0.7); rg.addColorStop(0, 'rgba(255,244,210,.55)'); rg.addColorStop(1, 'rgba(255,244,210,0)'); ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
  }
  function cavity(ctx, G, st) {
    const { dx, top, dW, dH, gy } = G;
    let g = ctx.createLinearGradient(0, top, 0, gy); g.addColorStop(0, '#f0e4c4'); g.addColorStop(1, '#cdbb92'); ctx.fillStyle = g; ctx.fillRect(dx, top, dW, dH);
    ctx.fillStyle = 'rgba(80,60,30,.10)'; for (let i = 1; i < 4; i++) ctx.fillRect(dx + (dW / 4) * i - 1, top, 2, dH);          // ván ốp tường
    ctx.fillStyle = '#9aa0a8'; ctx.fillRect(dx, gy - dH * 0.46, dW, Math.max(4, dH * 0.018));                                    // tay vịn
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(dx, gy - dH * 0.46, dW, Math.max(1, dH * 0.005));
    ctx.fillStyle = '#756c5e'; ctx.fillRect(dx, gy - dH * 0.03, dW, dH * 0.03);                                                   // sàn khoang
    ctx.fillStyle = 'rgba(255,250,225,.9)'; ctx.fillRect(dx + dW * 0.15, top, dW * 0.7, dH * 0.03);                               // đèn trần
    if (st.light < 1) { ctx.fillStyle = `rgba(10,10,20,${(1 - st.light) * 0.7})`; ctx.fillRect(dx, top, dW, dH); }
  }
  function backHall(ctx, W, H, st, env) {
    const G = geo(W, H, env), { dx, top, dW, dH, gy, xc } = G;
    wallFloor(ctx, W, H, gy, st);
    const fw = dW * 0.09;
    steel(ctx, dx - fw, top - fw * 1.2, dW + fw * 2, dH + fw * 1.2, '#656b73', '#8a9099');                                     // khung cửa
    cavity(ctx, G, st);
    // bóng đổ sáng của khoang ra sàn khi cửa mở
    if (st.door > 0.02) { ctx.fillStyle = `rgba(255,236,180,${0.3 * st.door})`; ctx.beginPath(); ctx.moveTo(dx, gy); ctx.lineTo(dx + dW, gy); ctx.lineTo(dx + dW * 1.3, gy + H * 0.2); ctx.lineTo(dx - dW * 0.3, gy + H * 0.2); ctx.closePath(); ctx.fill(); }
    indicator(ctx, xc, top - fw * 1.2 - dH * 0.14, dW * 0.46, dH * 0.1, st);
    // nút gọi thang bên phải
    const bx = dx + dW + fw * 2.2, by = gy - dH * 0.5, bw = dH * 0.07, bh = dH * 0.15;
    ctx.fillStyle = '#4a4f57'; rr(ctx, bx, by, bw, bh, bw * 0.3); ctx.fill();
    const lit = st.ride || st.lit.length || st.door > 0.05;
    for (const [i, up] of [[0, true], [1, false]]) { ctx.fillStyle = lit ? '#ffd34d' : '#c7cbd1'; const cy = by + bh * (0.3 + 0.4 * i), r = bw * 0.26; ctx.beginPath(); ctx.moveTo(bx + bw / 2, cy + (up ? -r : r)); ctx.lineTo(bx + bw / 2 - r, cy + (up ? r : -r)); ctx.lineTo(bx + bw / 2 + r, cy + (up ? r : -r)); ctx.closePath(); ctx.fill(); }
    dim(ctx, W, H, Math.max(0.6, st.light));
  }
  function doorPanels(ctx, G, st, beyond) {
    const { dx, top, dW, dH, gy, xc } = G, half = dW / 2, d = st.door;
    ctx.save(); ctx.beginPath(); ctx.rect(dx, top, dW, dH); ctx.clip();
    if (beyond) beyond(ctx, G, st);
    const pan = (x, w) => { steel(ctx, x, top, w, dH, '#aeb4bb', '#d7dce1'); ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(x + w * 0.18, top, w * 0.06, dH); ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(x + w * 0.62, top, w * 0.03, dH); };
    pan(dx - d * half, half); pan(xc + d * half, half);
    ctx.fillStyle = 'rgba(30,32,36,.75)'; ctx.fillRect(xc - d * half - 1.5, top, 3, dH); ctx.fillRect(xc + d * half - 1.5, top, 3, dH);
    if (st.light < 1) { ctx.fillStyle = `rgba(10,10,20,${(1 - st.light) * 0.5})`; ctx.fillRect(dx, top, dW, dH); }
    ctx.restore();
    ctx.fillStyle = '#4b5057'; ctx.fillRect(dx, gy - 2, dW, 6);
  }

  /* ------------------------------------------------------------ góc "inside": trong thang máy nhìn ra cửa (nhân vật quay lưng) */
  function backInside(ctx, W, H, st, env) {
    const G = geo(W, H, env), { dx, top, dW, dH, gy, xc } = G;
    let g = ctx.createLinearGradient(0, 0, 0, gy); g.addColorStop(0, '#d9ccab'); g.addColorStop(1, '#bba980'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, gy);
    ctx.fillStyle = '#6e665a'; ctx.fillRect(0, gy, W, H - gy);
    ctx.strokeStyle = 'rgba(0,0,0,.10)'; ctx.lineWidth = 2; for (let i = 1; i < 8; i++) { const x = (W / 8) * i; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, gy); ctx.stroke(); }
    ctx.fillStyle = '#9aa0a8'; ctx.fillRect(0, gy - dH * 0.46, dx - dW * 0.1, Math.max(4, dH * 0.02)); ctx.fillRect(dx + dW * 1.1, gy - dH * 0.46, W, Math.max(4, dH * 0.02));
    ctx.fillStyle = 'rgba(255,250,225,.95)'; ctx.fillRect(W * 0.12, 0, W * 0.76, H * 0.035);
    const fw = dW * 0.09; steel(ctx, dx - fw, top - fw, dW + fw * 2, dH + fw, '#656b73', '#8a9099');
    indicator(ctx, xc, top - dH * 0.14, dW * 0.46, dH * 0.1, st);
    dim(ctx, W, H, st.light);
  }
  function beyondCorridor(ctx, G, st) {
    const { dx, top, dW, dH, gy } = G;
    ctx.fillStyle = '#efe9da'; ctx.fillRect(dx, top, dW, dH); ctx.fillStyle = '#8f877a'; ctx.fillRect(dx, gy - dH * 0.14, dW, dH * 0.14);
    ctx.fillStyle = '#7a5a3a'; ctx.fillRect(dx + dW * 0.2, gy - dH * 0.74, dW * 0.28, dH * 0.6);          // cánh cửa căn hộ ở xa
    ctx.fillStyle = '#d9b84a'; ctx.beginPath(); ctx.arc(dx + dW * 0.43, gy - dH * 0.44, dW * 0.012, 0, 7); ctx.fill();
  }

  /* ------------------------------------------------------------ góc "panel": POV bảng nút + bàn tay */
  function panelLayout(W, H) { const ph = H * (W > H ? 0.84 : 0.56), pw = ph * 0.5; return { pw, ph, px: W * 0.58 - pw / 2, py: H * 0.46 - ph / 2 }; }
  function buttonPos(L, n, total) {
    const cols = total > 12 ? 4 : 3, rows = Math.ceil(total / cols), top = L.py + L.ph * 0.24, hgt = L.ph * 0.62;
    const idx = total - n, r = Math.floor(idx / cols), c = idx % cols;
    return [L.px + L.pw * (0.16 + 0.68 * (cols === 1 ? 0.5 : c / (cols - 1))), top + hgt * ((r + 0.5) / rows), Math.min(L.pw / (cols * 3.0), hgt / (rows * 2.6))];
  }
  function backPanel(ctx, W, H, st, env) {
    let g = ctx.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#7e858c'); g.addColorStop(0.55, '#a6acb3'); g.addColorStop(1, '#6a7078'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1; for (let i = 0; i < 90; i++) { const x = hh(i * 7 + 3) * W; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,248,220,.9)'; ctx.fillRect(W * 0.1, 0, W * 0.8, H * 0.03);
    const hg = ctx.createLinearGradient(0, 0, 0, H * 0.25); hg.addColorStop(0, 'rgba(255,248,220,.35)'); hg.addColorStop(1, 'rgba(255,248,220,0)'); ctx.fillStyle = hg; ctx.fillRect(0, 0, W, H * 0.25);
    ctx.fillStyle = '#9ba1a8'; ctx.fillRect(0, H * 0.86, W, H * 0.018); ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillRect(0, H * 0.86, W, 2);   // tay vịn
    const L = panelLayout(W, H), total = st.floorMax || 12;
    ctx.fillStyle = '#1b1d21'; rr(ctx, L.px, L.py, L.pw, L.ph, L.pw * 0.08); ctx.fill(); ctx.strokeStyle = '#575c64'; ctx.lineWidth = Math.max(3, W * 0.006); ctx.stroke();
    ctx.fillStyle = '#050607'; rr(ctx, L.px + L.pw * 0.14, L.py + L.ph * 0.04, L.pw * 0.72, L.ph * 0.13, L.pw * 0.04); ctx.fill();
    digits(ctx, String(st.floor), L.px + L.pw * (st.arrow ? 0.56 : 0.5), L.py + L.ph * 0.105, L.ph * 0.1, '#ff3b30');
    if (st.arrow) { ctx.fillStyle = '#ff3b30'; const ax = L.px + L.pw * 0.28, ay = L.py + L.ph * 0.105, s = L.ph * 0.03, dir = -st.arrow; ctx.beginPath(); ctx.moveTo(ax, ay + dir * s); ctx.lineTo(ax - s, ay - dir * s * 0.7); ctx.lineTo(ax + s, ay - dir * s * 0.7); ctx.closePath(); ctx.fill(); }
    for (let n = 1; n <= total; n++) {
      const [bx, by, r] = buttonPos(L, n, total), on = st.lit.includes(n);
      ctx.save(); if (on) { ctx.shadowColor = '#ffcf33'; ctx.shadowBlur = r * 1.1; }
      ctx.fillStyle = on ? '#ffd34d' : '#d6dade'; ctx.beginPath(); ctx.arc(bx, by, r, 0, 7); ctx.fill(); ctx.restore();
      ctx.strokeStyle = '#3a3e45'; ctx.lineWidth = Math.max(2, r * 0.14); ctx.beginPath(); ctx.arc(bx, by, r, 0, 7); ctx.stroke();
      ctx.fillStyle = '#23262b'; ctx.font = `700 ${r * 0.95}px ui-sans-serif, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(n), bx, by + r * 0.05);
    }
    const ay = L.py + L.ph * 0.93; ctx.fillStyle = '#c0c5cb'; for (const dxx of [0.3, 0.7]) { ctx.beginPath(); ctx.arc(L.px + L.pw * dxx, ay, L.pw * 0.07, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#23262b'; ctx.font = `700 ${L.pw * 0.09}px ui-sans-serif`; ctx.fillText('◀▶', L.px + L.pw * 0.3, ay); ctx.fillText('▶◀', L.px + L.pw * 0.7, ay);
    // bàn tay bấm nút (nét que + bàn tay tròn như nhân vật)
    if (st.hand) {
      const p = st.hand.p, tgt = buttonPos(L, st.hand.floor, total), start = [W * 0.2, H * 1.05];
      const reach = p < 0.35 ? ease(p / 0.35) : (p < 0.55 ? 1 : 1 - ease((p - 0.55) / 0.45));
      const press = p >= 0.35 && p < 0.55 ? Math.sin((p - 0.35) / 0.2 * Math.PI) : 0;
      const hx = lerp(start[0], tgt[0], reach), hy = lerp(start[1], tgt[1], reach) + press * tgt[2] * 0.25;
      const sx = -W * 0.08, sy = H * 1.12, cx1 = (sx + hx) / 2 - W * 0.05, cy1 = Math.max(sy, hy) - Math.abs(sy - hy) * 0.15;
      ctx.strokeStyle = env.lineCol || '#111'; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(8, (env.lw || 5) * 2.4);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(cx1, cy1, hx, hy); ctx.stroke();
      ctx.fillStyle = env.handFill || '#fff'; ctx.lineWidth = Math.max(4, (env.lw || 5) * 1.3); const hr = Math.max(18, W * 0.05) * (1 - press * 0.1);
      ctx.beginPath(); ctx.arc(hx, hy, hr, 0, 7); ctx.fill(); ctx.stroke();
    }
    dim(ctx, W, H, st.light);
  }

  /* ------------------------------------------------------------ API */
  function drawBack(ctx, set, angle, st, W, H, env) {
    if (set !== 'elevator') return;
    st.floorMax = (st.lit.length || st.hand) ? Math.max(12, ...st.lit, st.hand ? st.hand.floor : 0) : 12;
    if (angle === 'panel') backPanel(ctx, W, H, st, env);
    else if (angle === 'inside') backInside(ctx, W, H, st, env);
    else backHall(ctx, W, H, st, env);
  }
  function drawDoors(ctx, set, angle, st, W, H, env) {
    if (set !== 'elevator' || angle === 'panel') return;
    const G = geo(W, H, env);
    doorPanels(ctx, G, st, angle === 'inside' ? beyondCorridor : null);
  }

  global.StkSets = { DEFS, state, drawBack, drawDoors };
})(window);
