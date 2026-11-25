/* Stickman Studio — giao diện. Logic vẽ/chuyển động nằm ở engine.js */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (t) => { t = Math.max(0, t); return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`; };

function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = 'on' + (err ? ' err' : ''); clearTimeout(toast._t); toast._t = setTimeout(() => t.className = '', err ? 6000 : 2400); }
async function api(url, opts = {}) {
  if (opts.json !== undefined) { opts.method = opts.method || 'POST'; opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(opts.json); }
  const r = await fetch(url, opts);
  let d = null; try { d = await r.json(); } catch (e) { }
  if (!r.ok) throw new Error((d && (d.detail || d.error)) || ('Lỗi ' + r.status));
  return d;
}
async function pollJob(id, onProg) {
  for (; ;) {
    const j = await api('/api/jobs/' + id);
    onProg && onProg(j);
    if (j.status === 'done') return j.result;
    if (j.status === 'error') throw new Error(j.error);
    await new Promise(r => setTimeout(r, 1000));
  }
}
function setProg(box, p, msg) { box.classList.remove('hidden'); $('i', box).style.width = Math.round(p * 100) + '%'; $('span', box).textContent = msg || ''; }

/* ------------------------------------------------------------------ trạng thái */
let ST = { chars: [], backgrounds: [], settings: {}, projects: [], vocab: { actions: {}, emotions: [], slots: {}, bg_presets: {} } };
let proj = newProject();
const ASSETS = {}; const BGIMG = {};
function newProject() { return { id: null, title: '', story: { title: '', scenes: [] }, audio: {}, orient: 'v', subOn: true, titleText: '' }; }

async function refresh(keepProj = true) {
  ST = await api('/api/state'); ST.chars = ST.characters;
  renderCastPick(); renderCharGrid(); renderBgs(); renderProjSel(); fillSettings(); try { fillDirector(); } catch (e) { }
}

/* ------------------------------------------------------------------ tab */
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  $$('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  $$('.tab').forEach(x => x.classList.toggle('on', x.id === 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'export') setupPlayer(); else pausePlayer();
  if (b.dataset.tab !== 'chars') pvStop(); else pvResume();
});

/* ------------------------------------------------------------------ dự án */
function renderProjSel() {
  const sel = $('#projSel');
  sel.innerHTML = `<option value="">(dự án mới)</option>` + ST.projects.map(p => `<option value="${p.id}">${esc(p.title || p.id)}</option>`).join('');
  sel.value = proj.id || '';
}
$('#projSel').onchange = async (e) => { if (!e.target.value) { proj = newProject(); } else proj = await api('/api/projects/' + e.target.value); localStorage.setItem('stk_proj', proj.id || ''); renderStory(); toast('Đã mở dự án'); };
$('#projNew').onclick = () => { proj = newProject(); $('#projSel').value = ''; renderStory(); };
async function saveProject(quiet) {
  proj.title = proj.story.title || proj.title || 'Dự án';
  const r = await api('/api/projects', { json: proj }); proj.id = r.id; localStorage.setItem('stk_proj', proj.id);
  ST.projects = (await api('/api/state')).projects; renderProjSel(); if (!quiet) toast('Đã lưu');
}
$('#projSave').onclick = () => saveProject().catch(e => toast(e.message, 1));

/* ------------------------------------------------------------------ TAB TRUYỆN */
function renderCastPick() {
  $('#castPick').innerHTML = ST.chars.length ? ST.chars.map(c => `<label class="chip on"><input type="checkbox" checked value="${esc(c.name)}"> ${esc(c.name)}</label>`).join('') : '<span class="muted">Chưa có nhân vật. Hãy thêm ở tab Nhân vật.</span>';
  $$('#castPick .chip').forEach(l => l.onclick = () => setTimeout(() => l.classList.toggle('on', $('input', l).checked)));
  $('#provider').value = ST.settings.provider || 'demo';
}
$('#genBtn').onclick = async () => {
  const names = $$('#castPick input:checked').map(i => i.value);
  const btn = $('#genBtn'); btn.disabled = true; setProg($('#genProg'), 0.02, 'Đang gửi yêu cầu…');
  try {
    const { job } = await api('/api/story/generate', { json: { idea: $('#idea').value, genre: $('#genre').value, style: $('#style').value, minutes: +$('#minutes').value, pov: $('#pov').value, provider: $('#provider').value, characters: names } });
    const story = await pollJob(job, j => setProg($('#genProg'), j.progress, j.message));
    proj.story = story; proj.title = story.title; proj.audio = {}; applyStyle(story.style); showLint(story.lint);
    renderStory(); toast(`Xong: ${story.scenes.length} cảnh, ~${story.words || ''} từ`);
    await saveProject(true);
  } catch (e) { toast(e.message, 1); $('#genProg span').textContent = '❌ ' + e.message; }
  btn.disabled = false;
};

function showLint(l) {
  const el = $('#lint'); if (!l || !l.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden'); el.innerHTML = '<b>Gợi ý của đạo diễn:</b><br>' + l.map(x => (x.level === 'warn' ? '⚠ ' : '💡 ') + esc(x.msg)).join('<br>');
}
const EMO_VI = { neutral: 'bình thường', happy: 'vui', sad: 'buồn', angry: 'giận', surprised: 'ngạc nhiên', scared: 'sợ' };
const CAMS = { static: 'Đứng yên', push_in: 'Tiến vào', pull_out: 'Lùi ra', pan_left: 'Lia trái', pan_right: 'Lia phải', close_up: 'Cận người nói' };
function renderStory() {
  const s = proj.story; $('#title').value = s.title || '';
  const words = s.scenes.reduce((a, sc) => a + sc.beats.reduce((b, x) => b + x.text.split(/\s+/).length, 0), 0);
  $('#storyMeta').textContent = s.scenes.length ? `${s.scenes.length} cảnh · ${words} từ · ≈ ${(words / 150).toFixed(1)} phút` : '';
  const o = s.outline, ob = $('#outline');
  if (o && (o.hook || o.twist)) { ob.classList.remove('hidden'); ob.innerHTML = `<b>Hook:</b> ${esc(o.hook)} · <b>Mâu thuẫn:</b> ${esc(o.central_question)} · <b>Bước ngoặt:</b> ${esc(o.twist)} · <b>Hình ảnh kết:</b> ${esc(o.ending_image)}`; } else ob.classList.add('hidden');
  const bgOpts = (cur) => Object.entries(ST.vocab.bg_presets).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(v)}</option>`).join('') + ST.backgrounds.map(b => `<option value="${esc(b.name)}" ${b.name === cur ? 'selected' : ''}>★ ${esc(b.name)}</option>`).join('');
  const slotOpts = (cur) => Object.keys(ST.vocab.slots).map(k => `<option ${k === cur ? 'selected' : ''}>${k}</option>`).join('');
  $('#scenes').innerHTML = s.scenes.map((sc, si) => {
    const names = sc.cast.map(c => c.name);
    return `<div class="scene" data-si="${si}">
      <div class="sh"><span class="num">${si + 1}</span><input class="st" data-p="scenes.${si}.title" value="${esc(sc.title)}" placeholder="Tên cảnh">
        <select data-p="scenes.${si}.background">${bgOpts(sc.background)}</select>
        <select data-p="scenes.${si}.set" title="Set = bối cảnh nhiều góc quay + đạo cụ chuyển động"><option value="">Set: không</option>${Object.entries((ST.vocab.sets || {})).map(([k, v]) => `<option value="${k}" ${k === sc.set ? 'selected' : ''}>🎬 ${esc(v.desc)}</option>`).join('')}</select>
        <select data-p="scenes.${si}.camera">${Object.entries(CAMS).map(([k, v]) => `<option value="${k}" ${k === sc.camera ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button class="sm danger" data-do="delScene">Xoá cảnh</button></div>
      <div class="castline">Có mặt: ${sc.cast.map((c, ci) => `<span class="act">${esc(c.name)} <select data-p="scenes.${si}.cast.${ci}.slot">${slotOpts(c.slot)}</select><select data-p="scenes.${si}.cast.${ci}.start">${['stand', 'sit', 'offscreen_left', 'offscreen_right'].map(x => `<option ${x === c.start ? 'selected' : ''}>${x}</option>`).join('')}</select><button class="sm" data-do="delCast" data-ci="${ci}">×</button></span>`).join(' ')}
        <select data-do="addCast" style="width:auto"><option value="">+ thêm</option>${ST.chars.filter(c => !names.includes(c.name)).map(c => `<option>${esc(c.name)}</option>`).join('')}</select></div>
      ${sc.bg_prompt ? `<div class="bgp">🖼 Prompt nền: <i>${esc(sc.bg_prompt)}</i> <button class="sm" data-do="copyBg">Chép</button></div>` : ''}
      ${sc.beats.map((b, bi) => `<div class="beat" data-bi="${bi}"><div class="l1">
        <select data-p="scenes.${si}.beats.${bi}.speaker"><option value="narrator" ${b.speaker === 'narrator' ? 'selected' : ''}>🎙 Người kể</option>${names.map(n => `<option ${n === b.speaker ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <textarea data-p="scenes.${si}.beats.${bi}.text" data-stale="${si}:${bi}">${esc(b.text)}</textarea></div>
        <div class="meta">${names.map(n => `<span>${esc(n)}: <select data-emo="${esc(n)}"><option value="">—</option>${ST.vocab.emotions.map(e => `<option value="${e}" ${(b.emotions || {})[n] === e ? 'selected' : ''}>${EMO_VI[e]}</option>`).join('')}</select></span>`).join('')}
        ${(b.actions || []).map((a, ai) => `<span class="act"><select data-p="scenes.${si}.beats.${bi}.actions.${ai}.who">${names.map(n => `<option ${n === a.who ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select><select data-p="scenes.${si}.beats.${bi}.actions.${ai}.do">${Object.keys(ST.vocab.actions).map(k => `<option ${k === a.do ? 'selected' : ''}>${k}</option>`).join('')}</select>${['walk_to', 'run_to'].includes(a.do) ? `<select data-p="scenes.${si}.beats.${bi}.actions.${ai}.to">${slotOpts(a.to)}</select>` : ''}${a.do === 'face' ? `<select data-p="scenes.${si}.beats.${bi}.actions.${ai}.to">${['front', 'left', 'right', 'back'].map(x => `<option ${x === a.to ? 'selected' : ''}>${x}</option>`).join('')}</select>` : ''}<input type="number" step="0.1" min="0" max="0.9" data-p="scenes.${si}.beats.${bi}.actions.${ai}.at" value="${a.at ?? 0}" title="thời điểm trong câu (0–0.9)"><button class="sm" data-do="delAct" data-ai="${ai}">×</button></span>`).join('')}
        <span class="act" title="Thời lượng ép (giây). Beat không có lời: bắt buộc dùng để cảnh có thời gian chạy">⏱ <input type="number" step="0.1" min="0" max="8" style="width:54px" data-p="scenes.${si}.beats.${bi}.dur" value="${b.dur ?? ''}"></span>
        <button class="sm" data-do="addAct">+ hành động</button><button class="sm danger" data-do="delBeat">Xoá câu</button></div>
        <textarea class="cues" rows="1" data-cues="1" spellcheck="false" placeholder='Cue góc quay/đạo cụ (JSON), VD: [{"at":0,"angle":"panel","cam":"pov"},{"at":0.3,"fx":"press","value":12}]'>${(b.cues && b.cues.length) ? esc(JSON.stringify(b.cues)) : ''}</textarea></div>`).join('')}
      <div class="beat"><button class="sm" data-do="addBeat">+ thêm câu</button></div></div>`;
  }).join('');
}
function setPath(o, path, val) { const ks = path.split('.'); let c = o; for (let i = 0; i < ks.length - 1; i++) c = c[ks[i]]; const k = ks[ks.length - 1]; c[k] = (typeof c[k] === 'number' && val !== '') ? +val : val; }
$('#title').oninput = (e) => { proj.story.title = e.target.value; };
$('#scenes').addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.emo !== undefined) { const bEl = t.closest('.beat'), sEl = t.closest('.scene'); const b = proj.story.scenes[+sEl.dataset.si].beats[+bEl.dataset.bi]; b.emotions = b.emotions || {}; if (t.value) b.emotions[t.dataset.emo] = t.value; else delete b.emotions[t.dataset.emo]; return; }
  if (t.dataset.do === 'addCast') { if (!t.value) return; const sc = proj.story.scenes[+t.closest('.scene').dataset.si]; sc.cast.push({ name: t.value, slot: 'center', facing: 'front', start: 'stand' }); renderStory(); return; }
  if (t.dataset.cues) { const sEl = t.closest('.scene'), bEl = t.closest('.beat'); const b = proj.story.scenes[+sEl.dataset.si].beats[+bEl.dataset.bi]; const v = t.value.trim(); if (!v) { delete b.cues; return; } try { const j = JSON.parse(v); if (!Array.isArray(j)) throw new Error('phải là mảng'); b.cues = j; toast('Đã lưu cue'); } catch (err) { toast('Cue JSON sai: ' + err.message, true); } return; }
  if (!t.dataset.p) return;
  if (/\.dur$/.test(t.dataset.p)) { const ks = t.dataset.p.split('.'), bb = proj.story.scenes[+ks[1]].beats[+ks[3]]; if (t.value === '') delete bb.dur; else bb.dur = Math.min(8, Math.max(0.4, +t.value || 1.5)); return; }
  setPath(proj.story, t.dataset.p, t.value);
  if (/\.set$/.test(t.dataset.p) && !t.value) delete proj.story.scenes[+t.dataset.p.split('.')[1]].set;
  if (t.dataset.stale) delete proj.audio[t.dataset.stale];
  if (/\.do$/.test(t.dataset.p) || /\.speaker$/.test(t.dataset.p)) renderStory();
});
$('#scenes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-do]'); if (!b || b.tagName === 'SELECT') return;
  const sEl = b.closest('.scene'), si = +sEl.dataset.si, sc = proj.story.scenes[si]; const bEl = b.closest('.beat'); const bi = bEl ? +bEl.dataset.bi : -1;
  switch (b.dataset.do) {
    case 'delScene': proj.story.scenes.splice(si, 1); proj.audio = {}; break;
    case 'delCast': sc.cast.splice(+b.dataset.ci, 1); break;
    case 'addBeat': sc.beats.push({ speaker: 'narrator', text: 'Câu mới…', emotions: {}, actions: [], pause_after: 0.25 }); proj.audio = {}; break;
    case 'delBeat': sc.beats.splice(bi, 1); proj.audio = {}; break;
    case 'addAct': sc.beats[bi].actions.push({ who: (sc.cast[0] || {}).name || '', do: 'nod', at: 0 }); break;
    case 'delAct': sc.beats[bi].actions.splice(+b.dataset.ai, 1); break;
    case 'copyBg': navigator.clipboard && navigator.clipboard.writeText(sc.bg_prompt); toast('Đã chép prompt nền'); return;
  }
  renderStory();
});
$('#addScene').onclick = () => { proj.story.scenes.push({ id: 's' + (proj.story.scenes.length + 1), title: 'Cảnh mới', background: 'plain_cream', camera: 'static', bg_prompt: '', cast: ST.chars[0] ? [{ name: ST.chars[0].name, slot: 'center', facing: 'front', start: 'stand' }] : [], beats: [{ speaker: 'narrator', text: 'Câu mới…', emotions: {}, actions: [], pause_after: 0.25 }] }); proj.audio = {}; renderStory(); };

/* ------------------------------------------------------------------ TAB NHÂN VẬT */
let selChar = null, pv = null;
function renderCharGrid() {
  $('#charGrid').innerHTML = ST.chars.map(c => { const v = c.rig.views.front; return `<div class="card ${selChar === c.slug ? 'on' : ''}" data-slug="${c.slug}"><img src="${c.base}${v ? v.full : ''}?v=${c.rev || 0}"><div class="nm">${esc(c.name)}</div><div class="tg">${c.gender === 'male' ? 'Nam' : 'Nữ'} · ${esc(c.age_group)}</div></div>`; }).join('') || '<p class="muted">Chưa có nhân vật.</p>';
}
$('#charGrid').onclick = (e) => { const c = e.target.closest('.card'); if (c) { selChar = c.dataset.slug; renderCharGrid(); openCharEditor(); } };
$('#cAdd').onclick = async () => {
  const f = $('#cFile').files[0], name = $('#cName').value.trim(); if (!f || !name) return toast('Cần tên và ảnh', 1);
  const fd = new FormData(); fd.append('name', name); fd.append('gender', $('#cGender').value); fd.append('age_group', $('#cAge').value); fd.append('file', f);
  $('#cAdd').disabled = true; $('#cMsg').textContent = 'Đang tách…';
  try {
    const c = await api('/api/characters', { method: 'POST', body: fd });
    const d = c.rig.detected; $('#cMsg').textContent = `✓ Phát hiện ${d.bodies} góc toàn thân, ${d.heads} đầu biểu cảm.`;
    await refresh(); selChar = c.slug; renderCharGrid(); openCharEditor();
  } catch (e) { $('#cMsg').textContent = '❌ ' + e.message; }
  $('#cAdd').disabled = false;
};

async function charAsset(c) { c.rev = c.rev || Date.now(); const A = await Stk.loadChar(c); ASSETS[c.name] = A; return A; }
async function openCharEditor() {
  const c = ST.chars.find(x => x.slug === selChar); if (!c) return;
  const A = await charAsset(c); const st = Stk.styleOf(A), d = c.rig.detected;
  const sl = (k, lab, min, max, step, val) => `<label><span>${lab}</span><input type="range" data-st="${k}" min="${min}" max="${max}" step="${step}" value="${val}"><b class="mono">${val}</b></label>`;
  $('#charEditor').innerHTML = `<div class="head"><h2>${esc(c.name)}</h2><button class="danger sm" id="cDel">Xoá nhân vật</button></div>
  <div class="edit"><div><canvas class="pv" id="pvCv" width="360" height="640"></canvas>
    <div class="tests" id="pvTests">${[['idle', 'Đứng'], ['walk', 'Đi'], ['run', 'Chạy'], ['sit', 'Ngồi'], ['fall', 'Ngã'], ['wave', 'Vẫy tay'], ['point', 'Chỉ'], ['cheer', 'Reo'], ['shrug', 'Nhún vai'], ['hands_on_head', 'Ôm đầu'], ['cover_face', 'Che mặt'], ['bow', 'Cúi'], ['jump', 'Nhảy'], ['shake_head', 'Lắc đầu']].map(([k, v]) => `<button class="sm" data-pv="${k}">${v}</button>`).join('')}</div>
    <label>Biểu cảm <select id="pvEmo">${ST.vocab.emotions.map(e => `<option value="${e}">${EMO_VI[e]}</option>`).join('')}</select></label></div>
  <div><div class="row2"><label>Tên <input data-m="name" value="${esc(c.name)}"></label><label>Chiều cao (so với nhân vật chuẩn) <input type="range" data-m="height" min="0.4" max="1.5" step="0.02" value="${c.height}"></label></div>
    <div class="row2"><label>Giới tính <select data-m="gender"><option value="male" ${c.gender === 'male' ? 'selected' : ''}>Nam</option><option value="female" ${c.gender === 'female' ? 'selected' : ''}>Nữ</option></select></label>
    <label>Độ tuổi <select data-m="age_group">${['child', 'teen', 'adult', 'middle', 'old'].map(a => `<option ${a === c.age_group ? 'selected' : ''}>${a}</option>`).join('')}</select></label></div>
    <label>Ghi chú cho AI viết truyện (tính cách, nghề…) <input data-m="note" value="${esc(c.note || '')}" placeholder="VD: nóng tính, thích đùa, là giáo viên"></label>
    <label>Mã giọng riêng (edge-tts, để trống = tự chọn) <input data-m="voice" value="${esc(c.voice || '')}" placeholder="vi-VN-HoaiMyNeural"></label>
    <h2 style="margin-top:14px">Tinh chỉnh rig</h2><div class="sliders">
      ${sl('stroke_mul', 'Độ dày nét tay chân', 0.5, 2.5, 0.05, st.stroke_mul)}${sl('arm_mul', 'Độ dài tay', 0.6, 1.6, 0.02, st.arm_mul)}${sl('leg_mul', 'Độ dài chân', 0.6, 1.6, 0.02, st.leg_mul)}
      ${sl('neck', 'Độ dài cổ', 0, 0.35, 0.01, st.neck)}${sl('mouth_dy', 'Vị trí miệng (cao)', 0.05, 0.5, 0.01, st.mouth_dy)}${sl('mouth_dx', 'Vị trí miệng (ngang)', -0.3, 0.3, 0.01, st.mouth_dx)}${sl('mouth_w', 'Độ rộng miệng', 0.06, 0.4, 0.01, st.mouth_w)}
      <label><span>Góc nghiêng nhìn về</span><select data-st="side_faces"><option value="right" ${st.side_faces === 'right' ? 'selected' : ''}>phải</option><option value="left" ${st.side_faces === 'left' ? 'selected' : ''}>trái</option></select></label></div>
    <h2 style="margin-top:14px">Kết quả tách tự động</h2>
    <p class="hint">${d.bodies} góc toàn thân (${d.body_names.join(', ')}) · ${d.heads} đầu (${d.head_names.join(', ')}). Chấm đỏ = hông, xanh dương = vai, xanh lá = cằm/cổ.</p>
    <img class="dbg" src="${c.base}debug.png?v=${Date.now()}">
    <details style="margin-top:10px"><summary class="hint">Gán lại thứ tự thành phần nếu tách sai</summary>
      <label>Thân (trái→phải) <input id="rpBodies" value="${esc(d.body_names.join(','))}"></label>
      <label>Đầu (trái→phải, trên→dưới; dùng skip để bỏ) <input id="rpHeads" value="${esc(d.head_names.join(','))}"></label>
      <button id="rpGo" class="sm">Tách lại</button></details></div></div>`;
  pvStart(A);
  $('#cDel').onclick = async () => { if (!confirm('Xoá nhân vật này?')) return; await api('/api/characters/' + c.slug, { method: 'DELETE' }); selChar = null; $('#charEditor').innerHTML = '<p class="muted">Đã xoá.</p>'; pvStop(); await refresh(); };
  $('#rpGo').onclick = async () => { try { await api(`/api/characters/${c.slug}/reparse`, { json: { assign: { bodies: $('#rpBodies').value.split(',').map(s => s.trim()), heads: $('#rpHeads').value.split(',').map(s => s.trim()) } } }); await refresh(); c.rev = Date.now(); openCharEditor(); toast('Đã tách lại'); } catch (e) { toast(e.message, 1); } };
  let t; const save = (body) => { clearTimeout(t); t = setTimeout(() => api('/api/characters/' + c.slug, { method: 'PATCH', json: body }).catch(e => toast(e.message, 1)), 400); };
  $('#charEditor').oninput = $('#charEditor').onchange = (e) => {
    const el = e.target;
    if (el.dataset.st) { const v = el.type === 'range' ? +el.value : el.value; (c.style = c.style || {})[el.dataset.st] = v; A.meta.style = c.style; if (el.nextElementSibling) el.nextElementSibling.textContent = v; save({ style: { [el.dataset.st]: v } }); }
    else if (el.dataset.m) { const v = el.type === 'range' ? +el.value : el.value; c[el.dataset.m] = v; A.meta[el.dataset.m] = v; save({ [el.dataset.m]: v }); if (el.dataset.m === 'name') { } }
    else if (el.id === 'pvEmo') pvSet(pvLast, el.value);
  };
  $('#pvTests').onclick = (e) => { const b = e.target.closest('button'); if (b) pvSet(b.dataset.pv, $('#pvEmo').value); };
}
let pvLast = 'idle', pvRaf = 0, pvPlayer = null, pvT0 = 0, pvA = null;
function pvStart(A) { pvA = A; pvSet('idle', 'neutral'); }
function pvSet(kind, emo) {
  pvLast = kind; if (!pvA) return; const n = pvA.name;
  const acts = { idle: [], walk: [{ who: n, do: 'walk_to', to: 'far_left', at: 0 }, { who: n, do: 'walk_to', to: 'far_right', at: 0.4 }, { who: n, do: 'walk_to', to: 'center', at: 0.8 }], run: [{ who: n, do: 'run_to', to: 'far_left', at: 0 }, { who: n, do: 'run_to', to: 'far_right', at: 0.35 }, { who: n, do: 'run_to', to: 'center', at: 0.7 }], sit: [{ who: n, do: 'sit', at: 0.05 }, { who: n, do: 'stand', at: 0.7 }], fall: [{ who: n, do: 'fall', at: 0.1, dir: 'right' }, { who: n, do: 'get_up', at: 0.65 }] }[kind] || [{ who: n, do: kind, at: 0.1 }];
  const project = { story: { scenes: [{ id: 'p', background: 'plain_cream', camera: 'static', cast: [{ name: n, slot: 'center', facing: 'front', start: 'stand' }], beats: [{ speaker: n, text: 'Đây là đoạn thử nghiệm chuyển động của nhân vật này trong video, xem có mượt không nhé.', emotions: { [n]: emo }, actions: acts, pause_after: 0.6 }] }] }, audio: {} };
  const cv = $('#pvCv'); if (!cv) return;
  pvPlayer = new Stk.Player(cv, project, { [n]: pvA }, {}, { subtitles: false });
  pvT0 = performance.now(); cancelAnimationFrame(pvRaf);
  const loop = () => { const dur = pvPlayer.duration - 0.8; let t = ((performance.now() - pvT0) / 1000) % dur; pvPlayer.render(t + 0.35); pvRaf = requestAnimationFrame(loop); };
  loop();
}
function pvStop() { cancelAnimationFrame(pvRaf); }
function pvResume() { if (pvA && $('#pvCv')) pvSet(pvLast, ($('#pvEmo') || {}).value || 'neutral'); }

/* ------------------------------------------------------------------ TAB NỀN */
function renderBgs() {
  $('#bgPresets').innerHTML = Object.entries(ST.vocab.bg_presets).map(([k, v]) => `<div class="card"><canvas data-bg="${k}" width="180" height="320"></canvas><div class="nm">${esc(v)}</div><div class="tg">${k}</div></div>`).join('');
  $$('#bgPresets canvas').forEach(cv => cv.getContext('2d').drawImage(Stk.makeBg(cv.dataset.bg, 180, 320), 0, 0));
  $('#bgUser').innerHTML = ST.backgrounds.map(b => `<div class="card"><img src="${b.url}"><div class="nm">${esc(b.name)}</div><button class="sm danger" data-del="${esc(b.name)}">Xoá</button></div>`).join('') || '<p class="muted">Chưa có ảnh nền nào.</p>';
}
$('#bgAdd').onclick = async () => {
  const f = $('#bgFile').files[0], n = $('#bgName').value.trim(); if (!f || !n) return toast('Cần tên và ảnh', 1);
  const fd = new FormData(); fd.append('name', n); fd.append('file', f);
  try { await api('/api/backgrounds', { method: 'POST', body: fd }); await refresh(); toast('Đã thêm nền'); } catch (e) { toast(e.message, 1); }
};
$('#bgUser').onclick = async (e) => { const b = e.target.closest('[data-del]'); if (b) { await api('/api/backgrounds/' + encodeURIComponent(b.dataset.del), { method: 'DELETE' }); await refresh(); } };

/* ------------------------------------------------------------------ TAB XEM & XUẤT */
let player = null, playing = false, startAt = 0, raf = 0, actx = null, srcs = [], bufs = {}, tPause = 0;
const stage = $('#stage');

async function ensureAssets() {
  const names = new Set(); proj.story.scenes.forEach(s => { s.cast.forEach(c => names.add(c.name)); });
  for (const n of names) if (!ASSETS[n]) { const c = ST.chars.find(x => x.name === n); if (c) await charAsset(c); }
  for (const b of ST.backgrounds) if (!BGIMG[b.name]) BGIMG[b.name] = await Stk.loadImg(b.url);
}
async function setupPlayer() {
  pausePlayer();
  if (!proj.story.scenes.length) { stage.width = 720; stage.height = 1280; const g = stage.getContext('2d'); g.fillStyle = '#222'; g.fillRect(0, 0, 720, 1280); g.fillStyle = '#888'; g.font = '30px sans-serif'; g.textAlign = 'center'; g.fillText('Chưa có kịch bản', 360, 640); player = null; return; }
  await ensureAssets();
  $('#orient').value = proj.orient || 'v'; $('#subOn').checked = proj.subOn !== false; $('#camAuto').checked = proj.autoCam !== false; $('#titleOn').value = proj.titleText || '';
  fillDirector();
  const land = proj.orient === 'h'; stage.width = land ? 1280 : 720; stage.height = land ? 720 : 1280;
  player = new Stk.Player(stage, proj, ASSETS, BGIMG, { subtitles: proj.subOn !== false, title: proj.titleText || '', titleSec: 5, autoCam: proj.autoCam !== false, look: proj.look || 'none', subStyle: proj.subStyle || 'bold' });
  tPause = 0; player.render(0); updateUI(0); renderSceneList(); loadAudio();
  const na = Object.keys(proj.audio || {}).length; $('#ttsInfo').textContent = na ? `Đã có giọng đọc cho ${na} câu · tổng ${fmt(player.duration)}` : `Chưa có giọng đọc (đang ước lượng thời lượng ${fmt(player.duration)}).`;
}
$('#orient').onchange = () => { proj.orient = $('#orient').value; setupPlayer(); };
$('#camAuto').onchange = () => { proj.autoCam = $('#camAuto').checked; if (player) { player.opts.autoCam = proj.autoCam; player.render(curT()); } };
$('#subOn').onchange = () => { proj.subOn = $('#subOn').checked; if (player) { player.opts.subtitles = proj.subOn; player.render(curT()); } };
$('#titleOn').oninput = () => { proj.titleText = $('#titleOn').value; if (player) { player.opts.title = proj.titleText; player.render(curT()); } };
function renderSceneList() { $('#sceneList').innerHTML = player.tl.scenes.map((S, i) => `<div data-t="${S.t0}"><span>${i + 1}. ${esc(S.sc.title || S.sc.background)}</span><span class="mono">${fmt(S.t0)}</span></div>`).join(''); }
$('#sceneList').onclick = (e) => { const d = e.target.closest('[data-t]'); if (d) seekTo(+d.dataset.t + 0.3); };

/* ---- phong cách / âm thanh ---- */
const D = () => ST.director || { styles: {}, looks: {}, moods: {}, sfx: {} };
const opt = (o, cur) => Object.entries(o).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(typeof v === 'string' ? v : v.name)}</option>`).join('');
function fillDirector() {
  const d = D(); $('#style').innerHTML = `<option value="auto">Tự chọn theo thể loại</option>` + opt(d.styles);
  $('#pStyle').innerHTML = `<option value="">Tuỳ chỉnh</option>` + opt(d.styles, proj.style); $('#look').innerHTML = opt(d.looks, proj.look || 'none');
  $('#sfxMode').innerHTML = opt(d.sfx, proj.sfx || 'calm'); $('#music').innerHTML = opt(d.moods, proj.music || 'auto'); $('#musicGain').value = proj.musicGain ?? 55;
}
function applyStyle(id) {
  const s = D().styles[id]; if (!s) return; proj.style = id; proj.look = s.look; proj.sfx = s.sfx; proj.music = s.mood; proj.subStyle = s.sub; fillDirector(); $('#pStyle').value = id; pushFxOpts();
}
function pushFxOpts() { if (!player) return; player.opts.look = proj.look || 'none'; player.opts.subStyle = proj.subStyle || 'bold'; player.rebuild(); player.render(curT()); loadAudio(); }
$('#pStyle').onchange = () => { if ($('#pStyle').value) applyStyle($('#pStyle').value); else proj.style = ''; };
$('#look').onchange = () => { proj.look = $('#look').value; proj.style = ''; $('#pStyle').value = ''; pushFxOpts(); };
$('#sfxMode').onchange = () => { proj.sfx = $('#sfxMode').value; pushFxOpts(); };
$('#music').onchange = () => { proj.music = $('#music').value; loadAudio(); };
$('#musicGain').oninput = () => { proj.musicGain = +$('#musicGain').value; };
const musicId = () => { const m = proj.music || 'auto'; return m === 'none' ? null : (m === 'auto' ? (proj.story && proj.story.mood) || 'warm' : m); };
const fxNeeded = () => { const ids = new Set(); if (player) { player.tl.sfx.forEach(e => ids.add('sfx/' + e.id)); player.tl.beds.forEach(e => ids.add('sfx/' + e.id)); } const m = musicId(); if (m) ids.add('music/' + m); return [...ids]; };
async function scheduleFx(t0) {
  if (!actx || !player) return; const A0 = actx.currentTime - t0;
  const put = (buf, when, gain, loop, off) => { const s = actx.createBufferSource(), g = actx.createGain(); s.buffer = buf; s.loop = !!loop; g.gain.value = gain; s.connect(g); g.connect(actx.destination); if (when >= actx.currentTime) s.start(when, off || 0); else s.start(0, (off || 0) + (actx.currentTime - when)); srcs.push(s); return s; };
  for (const e of player.tl.sfx) { const b = bufs['sfx/' + e.id]; if (b && A0 + e.t + 0.01 >= actx.currentTime - 0.05) put(b, A0 + e.t, e.g, false); }
  for (const e of player.tl.beds) { const b = bufs['sfx/' + e.id]; if (b && e.t1 > t0) { const s = put(b, A0 + Math.max(e.t0, t0), e.g, true); s.stop(A0 + e.t1); } }
  const m = musicId(), mb = m && bufs['music/' + m]; if (mb) put(mb, A0, ((proj.musicGain ?? 55) / 100) * 0.55 * 0.6, true);
}

async function loadAudio() {
  if (!player) return; if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  for (const k of fxNeeded()) if (!bufs[k]) { try { bufs[k] = await actx.decodeAudioData(await (await fetch('/assets/' + k + '.mp3')).arrayBuffer()); } catch (e) { } }
  for (const c of player.tl.clips) if (!bufs[c.file]) { try { const ab = await (await fetch('/data/audio/' + c.file)).arrayBuffer(); bufs[c.file] = await actx.decodeAudioData(ab); } catch (e) { } }
}
function curT() { return playing ? (actx.currentTime - startAt) : tPause; }
function updateUI(t) { $('#seek').value = Math.round(1000 * t / (player ? player.duration : 1)); $('#timeLbl').textContent = `${fmt(t)} / ${fmt(player ? player.duration : 0)}`; }
function stopSrcs() { srcs.forEach(s => { try { s.stop(); } catch (e) { } }); srcs = []; }
function startPlayer(t0) {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); actx.resume();
  stopSrcs(); startAt = actx.currentTime - t0; playing = true; $('#playBtn').textContent = '⏸ Dừng';
  for (const c of player.tl.clips) { const b = bufs[c.file]; if (!b) continue; const end = c.start + b.duration; if (end <= t0) continue; const s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); const when = startAt + c.start; if (when >= actx.currentTime) s.start(when); else s.start(0, t0 - c.start); srcs.push(s); }
  scheduleFx(t0);
  const loop = () => { if (!playing) return; const t = actx.currentTime - startAt; if (t >= player.duration) { pausePlayer(); tPause = 0; player.render(0); updateUI(0); return; } player.render(t); updateUI(t); raf = requestAnimationFrame(loop); };
  loop();
}
function pausePlayer() { if (playing) { tPause = curT(); } playing = false; cancelAnimationFrame(raf); stopSrcs(); const b = $('#playBtn'); if (b) b.textContent = '▶ Phát'; }
function seekTo(t) { if (!player) return; t = Math.max(0, Math.min(player.duration, t)); const was = playing; pausePlayer(); tPause = t; player.render(t); updateUI(t); if (was) startPlayer(t); }
$('#playBtn').onclick = () => { if (!player) return; if (playing) pausePlayer(); else startPlayer(tPause); };
$('#seek').oninput = (e) => seekTo(player ? player.duration * e.target.value / 1000 : 0);

$('#ttsBtn').onclick = async () => {
  if (!proj.story.scenes.length) return toast('Chưa có kịch bản', 1);
  const btn = $('#ttsBtn'); btn.disabled = true; setProg($('#ttsProg'), 0.01, 'Đang lưu dự án…');
  try {
    await saveProject(true);
    const { job } = await api(`/api/projects/${proj.id}/tts`, { method: 'POST' });
    const r = await pollJob(job, j => setProg($('#ttsProg'), j.progress, j.message));
    proj.audio = r.audio; await saveProject(true); bufs = {};
    await setupPlayer();
    if (r.failed) toast(`${r.failed} câu không tạo được giọng (đã thay bằng im lặng): ${r.last_error}`, 1);
    else toast('Đã tạo giọng đọc');
  } catch (e) { toast(e.message, 1); $('#ttsProg span').textContent = '❌ ' + e.message; }
  btn.disabled = false;
};

$('#expBtn').onclick = async () => {
  if (!player) return toast('Chưa có kịch bản', 1);
  pausePlayer(); const btn = $('#expBtn'); btn.disabled = true; $('#expOut').innerHTML = '';
  const fps = +$('#fps').value, N = Math.ceil(player.duration * fps);
  try {
    await saveProject(true);
    const { id } = await api('/api/export/start', { json: { fps, title: proj.story.title || 'video' } });
    for (let i = 0; i < N; i++) {
      player.render(i / fps);
      const blob = await new Promise(r => stage.toBlob(r, 'image/jpeg', 0.92));
      const res = await fetch(`/api/export/${id}/frame`, { method: 'POST', body: blob });
      if (!res.ok) throw new Error((await res.json()).detail || 'Lỗi gửi khung hình');
      if (i % 5 === 0) setProg($('#expProg'), i / N, `Khung ${i}/${N}`);
    }
    setProg($('#expProg'), 0.99, 'Ghép âm thanh…');
    const out = await api(`/api/export/${id}/finish`, { json: { clips: player.tl.clips, duration: player.duration, sfx: player.tl.sfx, beds: player.tl.beds, music: { id: musicId(), gain: (proj.musicGain ?? 55) / 100 } } });
    setProg($('#expProg'), 1, 'Xong');
    $('#expOut').innerHTML = `<a href="${out.url}" download><button class="primary big">⬇ Tải video (${fmt(player.duration)})</button></a><video src="${out.url}" controls style="width:100%;margin-top:8px;border-radius:8px"></video>` + (out.credit ? `<p class="hint">Dán vào mô tả video (bắt buộc với nhạc CC BY):<br><textarea readonly rows="3" style="width:100%">Music: ${esc(out.credit)}</textarea></p>` : '');
  } catch (e) { toast(e.message, 1); $('#expProg span').textContent = '❌ ' + e.message; }
  btn.disabled = false; player.render(0);
};

/* ------------------------------------------------------------------ cài đặt */
function fillSettings() {
  const s = ST.settings; $('#sProvider').value = s.provider; $('#sGemKey').placeholder = s.gemini_key || 'AIza...'; $('#sDsKey').placeholder = s.deepseek_key || 'sk-...';
  $('#sGemModel').value = s.gemini_model; $('#sDsModel').value = s.deepseek_model; $('#sNarr').value = s.narrator_gender; $('#sNarrVoice').value = s.narrator_voice;
}
$('#sSave').onclick = async () => {
  try { await api('/api/settings', { json: { provider: $('#sProvider').value, gemini_key: $('#sGemKey').value, deepseek_key: $('#sDsKey').value, gemini_model: $('#sGemModel').value, deepseek_model: $('#sDsModel').value, narrator_gender: $('#sNarr').value, narrator_voice: $('#sNarrVoice').value } }); $('#sGemKey').value = ''; $('#sDsKey').value = ''; await refresh(); toast('Đã lưu cài đặt'); } catch (e) { toast(e.message, 1); }
};

/* ------------------------------------------------------------------ khởi động */
(async function init() {
  await refresh();
  const last = localStorage.getItem('stk_proj');
  if (last && ST.projects.find(p => p.id === last)) { try { proj = await api('/api/projects/' + last); } catch (e) { } }
  renderProjSel(); renderStory();
  if (document.fonts && document.fonts.load) document.fonts.load('700 34px "Be Vietnam Pro"').catch(() => { });
})();
window.__stk = { ASSETS, get proj() { return proj; }, get player() { return player; }, setupPlayer, ST: () => ST };
