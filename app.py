import io
import json
import os
import re
import shutil
import subprocess
import threading
import time
import unicodedata
import uuid
import wave
from typing import Dict, Optional

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image

from core import tts as tts_mod
from core.director import LOOKS, MOODS, SFX_MODES, STYLES, lint_story
from core.llm import LLM, generate_story
from core.sheet_parser import parse_sheet
from core.story import ACTIONS, BG_PRESETS, EMOTIONS, SETS, SHOT_CAMS, SLOTS, sanitize_story, word_count

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
CHARS, PROJ, AUDIO, BGS, EXPORTS = (os.path.join(DATA, d) for d in ("characters", "projects", "audio", "backgrounds", "exports"))
for d in (CHARS, PROJ, AUDIO, BGS, EXPORTS):
    os.makedirs(d, exist_ok=True)

app = FastAPI(title="Stickman Studio")
JOBS: Dict[str, dict] = {}
EXPORT_JOBS: Dict[str, dict] = {}


# ------------------------------------------------------------------ tiện ích
def slugify(s: str) -> str:
    s = unicodedata.normalize("NFD", s.replace("đ", "d").replace("Đ", "D"))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-") or "nhan-vat"


def jload(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def jsave(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def settings_get() -> dict:
    d = {"provider": "demo", "gemini_key": "", "deepseek_key": "", "gemini_model": "gemini-2.5-flash",
         "deepseek_model": "deepseek-chat", "narrator_gender": "male", "narrator_voice": ""}
    d.update(jload(os.path.join(DATA, "settings.json"), {}))
    return d


def char_list():
    out = []
    for slug in sorted(os.listdir(CHARS)):
        base = os.path.join(CHARS, slug)
        meta = jload(os.path.join(base, "meta.json"))
        rig = jload(os.path.join(base, "rig.json"))
        if not meta or not rig:
            continue
        out.append({"slug": slug, **meta, "rig": rig, "base": f"/data/characters/{slug}/"})
    return out


def bg_list():
    return jload(os.path.join(BGS, "index.json"), [])


def run_job(fn):
    jid = uuid.uuid4().hex[:10]
    JOBS[jid] = {"status": "running", "progress": 0.0, "message": "Bắt đầu", "result": None, "error": None}

    def prog(msg, p):
        JOBS[jid].update(message=msg, progress=p)

    def worker():
        try:
            JOBS[jid]["result"] = fn(prog)
            JOBS[jid].update(status="done", progress=1.0)
        except Exception as e:
            JOBS[jid].update(status="error", error=str(e))

    threading.Thread(target=worker, daemon=True).start()
    return jid


# ------------------------------------------------------------------ trạng thái chung
@app.get("/api/state")
def state():
    s = settings_get()
    masked = {**s, "gemini_key": ("•••" + s["gemini_key"][-4:]) if s["gemini_key"] else "",
              "deepseek_key": ("•••" + s["deepseek_key"][-4:]) if s["deepseek_key"] else ""}
    projects = []
    for fn in sorted(os.listdir(PROJ), reverse=True):
        if fn.endswith(".json"):
            p = jload(os.path.join(PROJ, fn))
            if p:
                projects.append({"id": p["id"], "title": p.get("title", ""), "updated": p.get("updated", 0)})
    return {"characters": char_list(), "backgrounds": bg_list(), "settings": masked, "projects": projects,
            "vocab": {"actions": ACTIONS, "emotions": EMOTIONS, "slots": SLOTS, "bg_presets": BG_PRESETS, "sets": SETS, "shot_cams": SHOT_CAMS},
            "director": {"styles": {k: {"name": v["name"], "look": v["look"], "mood": v["mood"], "sfx": v["sfx"], "sub": v["sub"]} for k, v in STYLES.items()}, "looks": LOOKS, "moods": MOODS, "sfx": SFX_MODES}}


@app.post("/api/settings")
async def save_settings(req: Request):
    body = await req.json()
    cur = settings_get()
    for k, v in body.items():
        if k in cur:
            if k.endswith("_key") and (not v or v.startswith("•••")):
                continue  # giữ khoá cũ nếu ô để trống/đã che
            cur[k] = v
    jsave(os.path.join(DATA, "settings.json"), cur)
    return {"ok": True}


# ------------------------------------------------------------------ nhân vật
def _save_char(slug, name, gender, age, file_bytes, assign=None, meta_extra=None):
    base = os.path.join(CHARS, slug)
    os.makedirs(base, exist_ok=True)
    sheet = os.path.join(base, "sheet.png")
    if file_bytes is not None:
        Image.open(io.BytesIO(file_bytes)).convert("RGB").save(sheet)
    rig = parse_sheet(Image.open(sheet), base, assign)
    meta = jload(os.path.join(base, "meta.json"), {}) or {}
    meta.update({"name": name, "gender": gender, "age_group": age})
    meta.setdefault("height", {"child": 0.62, "teen": 0.92, "old": 0.9}.get(age, 1.0))
    meta.setdefault("note", ""); meta.setdefault("voice", ""); meta.setdefault("style", {})
    if meta_extra:
        meta.update(meta_extra)
    jsave(os.path.join(base, "meta.json"), meta)
    return rig


@app.post("/api/characters")
async def add_character(name: str = Form(...), gender: str = Form("male"), age_group: str = Form("adult"), file: UploadFile = File(...)):
    slug = slugify(name)
    data = await file.read()
    try:
        _save_char(slug, name.strip(), gender, age_group, data)
    except Exception as e:
        shutil.rmtree(os.path.join(CHARS, slug), ignore_errors=True)
        raise HTTPException(400, f"Không đọc được ảnh nhân vật: {e}")
    return next(c for c in char_list() if c["slug"] == slug)


@app.post("/api/characters/{slug}/reparse")
async def reparse(slug: str, req: Request):
    body = await req.json()
    meta = jload(os.path.join(CHARS, slug, "meta.json"))
    if not meta:
        raise HTTPException(404, "Không có nhân vật")
    try:
        _save_char(slug, meta["name"], meta["gender"], meta["age_group"], None, body.get("assign"))
    except Exception as e:
        raise HTTPException(400, str(e))
    return next(c for c in char_list() if c["slug"] == slug)


@app.patch("/api/characters/{slug}")
async def patch_character(slug: str, req: Request):
    body = await req.json()
    path = os.path.join(CHARS, slug, "meta.json")
    meta = jload(path)
    if not meta:
        raise HTTPException(404, "Không có nhân vật")
    for k in ("name", "gender", "age_group", "height", "note", "voice"):
        if k in body:
            meta[k] = body[k]
    if "style" in body:
        meta["style"] = {**meta.get("style", {}), **body["style"]}
    jsave(path, meta)
    return next(c for c in char_list() if c["slug"] == slug)


@app.delete("/api/characters/{slug}")
def del_character(slug: str):
    shutil.rmtree(os.path.join(CHARS, slug), ignore_errors=True)
    return {"ok": True}


# ------------------------------------------------------------------ phông nền
@app.post("/api/backgrounds")
async def add_bg(name: str = Form(...), file: UploadFile = File(...)):
    slug = slugify(name)
    fn = f"{slug}.jpg"
    Image.open(io.BytesIO(await file.read())).convert("RGB").save(os.path.join(BGS, fn), quality=90)
    idx = [b for b in bg_list() if b["name"] != name]
    idx.append({"name": name, "file": fn, "url": f"/data/backgrounds/{fn}"})
    jsave(os.path.join(BGS, "index.json"), idx)
    return idx


@app.delete("/api/backgrounds/{name}")
def del_bg(name: str):
    idx = [b for b in bg_list() if b["name"] != name]
    jsave(os.path.join(BGS, "index.json"), idx)
    return idx


# ------------------------------------------------------------------ truyện
@app.post("/api/story/generate")
async def story_generate(req: Request):
    body = await req.json()
    s = settings_get()
    provider = body.get("provider") or s["provider"]
    chars = [c for c in char_list() if not body.get("characters") or c["name"] in body["characters"]]
    if not chars:
        raise HTTPException(400, "Chưa có nhân vật nào. Hãy thêm nhân vật ở tab Nhân vật trước.")
    key = s.get(f"{provider}_key", "") if provider != "demo" else ""
    if provider != "demo" and not key:
        raise HTTPException(400, f"Chưa nhập API key cho {provider} (tab Cài đặt).")
    llm = LLM(provider, key, s.get(f"{provider}_model", ""))
    cinfo = [{"name": c["name"], "gender": c["gender"], "age_group": c["age_group"], "note": c.get("note", "")} for c in chars]
    bgn = [b["name"] for b in bg_list()]

    def job(prog):
        story = generate_story(body.get("idea", ""), body.get("genre", "cảm động, bất ngờ"), float(body.get("minutes", 5)),
                               body.get("pov", "first"), cinfo, bgn, llm, prog, body.get("style", "auto"))
        story["words"] = word_count(story)
        story["lint"] = lint_story(story)
        return story

    return {"job": run_job(job)}


@app.get("/api/jobs/{jid}")
def job_status(jid: str):
    j = JOBS.get(jid)
    if not j:
        raise HTTPException(404, "Không có tác vụ")
    return j


@app.post("/api/story/sanitize")
async def story_sanitize(req: Request):
    body = await req.json()
    return sanitize_story(body, [c["name"] for c in char_list()], [b["name"] for b in bg_list()])


# ------------------------------------------------------------------ dự án
@app.post("/api/projects")
async def save_project(req: Request):
    body = await req.json()
    pid = body.get("id") or uuid.uuid4().hex[:8]
    body["id"] = pid
    body["updated"] = int(time.time())
    jsave(os.path.join(PROJ, pid + ".json"), body)
    return {"id": pid}


@app.get("/api/projects/{pid}")
def get_project(pid: str):
    p = jload(os.path.join(PROJ, pid + ".json"))
    if not p:
        raise HTTPException(404, "Không có dự án")
    return p


@app.delete("/api/projects/{pid}")
def del_project(pid: str):
    try:
        os.remove(os.path.join(PROJ, pid + ".json"))
    except FileNotFoundError:
        pass
    return {"ok": True}


@app.post("/api/projects/{pid}/tts")
def project_tts(pid: str):
    path = os.path.join(PROJ, pid + ".json")
    p = jload(path)
    if not p:
        raise HTTPException(404, "Không có dự án")
    s = settings_get()
    chars = {c["name"]: c for c in char_list()}

    def job(prog):
        beats = [(si, bi, b) for si, sc in enumerate(p["story"]["scenes"]) for bi, b in enumerate(sc["beats"])]
        audio, fail = {}, 0
        for n, (si, bi, b) in enumerate(beats):
            prog(f"Giọng đọc {n+1}/{len(beats)}", n / max(1, len(beats)))
            if b["speaker"] == "narrator" or b["speaker"] not in chars:
                v = tts_mod.voice_params(s["narrator_gender"], "adult", s["narrator_voice"])
            else:
                c = chars[b["speaker"]]
                v = tts_mod.voice_params(c["gender"], c["age_group"], c.get("voice", ""))
            if not (b.get("text") or "").strip():
                continue
            r = tts_mod.synth(b["text"], *v, AUDIO)
            fail += 0 if r["tts"] else 1
            audio[f"{si}:{bi}"] = r
        p["audio"] = audio
        p["updated"] = int(time.time())
        jsave(path, p)
        return {"audio": audio, "failed": fail, "last_error": next((a["error"] for a in audio.values() if a["error"]), "")}

    return {"job": run_job(job)}


# ------------------------------------------------------------------ xuất video
@app.post("/api/export/start")
async def export_start(req: Request):
    b = await req.json()
    jid = uuid.uuid4().hex[:8]
    tmp = os.path.join(EXPORTS, f"{jid}.video.mp4.part")
    fps = int(b.get("fps", 30))
    proc = subprocess.Popen(
        ["ffmpeg", "-y", "-v", "error", "-f", "image2pipe", "-framerate", str(fps), "-c:v", "mjpeg", "-i", "-",
         "-c:v", "libx264", "-crf", "19", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-f", "mp4", tmp],
        stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    EXPORT_JOBS[jid] = {"proc": proc, "tmp": tmp, "fps": fps, "title": b.get("title", "video"), "frames": 0}
    return {"id": jid}


@app.post("/api/export/{jid}/frame")
async def export_frame(jid: str, req: Request):
    j = EXPORT_JOBS.get(jid)
    if not j:
        raise HTTPException(404, "Không có tác vụ xuất")
    data = await req.body()
    try:
        j["proc"].stdin.write(data)
        j["frames"] += 1
    except BrokenPipeError:
        raise HTTPException(500, "ffmpeg đã dừng: " + j["proc"].stderr.read().decode(errors="ignore")[-400:])
    return {"n": j["frames"]}


ASSETS_DIR = os.path.join(ROOT, "assets")
_SND_CACHE: Dict[str, np.ndarray] = {}


def _load_snd(path, sr, stereo=False):
    key = f"{path}|{sr}|{stereo}"
    if key in _SND_CACHE:
        return _SND_CACHE[key]
    ch = 2 if stereo else 1
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "s16le", "-ac", str(ch), "-ar", str(sr), "-"], capture_output=True).stdout
    a = np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0
    if stereo:
        a = a.reshape(-1, 2).mean(axis=1)
    if len(_SND_CACHE) > 80:
        _SND_CACHE.clear()
    _SND_CACHE[key] = a
    return a


def _add(buf, a, start, gain):
    s = int(start * SR_MIX)
    if s < 0:
        a = a[-s:]; s = 0
    e = min(len(buf), s + len(a))
    if s < len(buf) and e > s:
        buf[s:e] += a[: e - s] * gain


SR_MIX = 24000


def _mix_audio(clips, duration, out_wav, sr=24000, sfx=None, beds=None, music=None):
    """Giọng + hiệu ứng theo hành động + nền môi trường + nhạc (tự hạ khi có giọng)."""
    global SR_MIX
    SR_MIX = sr
    total = int((duration + 0.5) * sr)
    voice = np.zeros(total, np.float32)
    speech = np.zeros(total, np.float32)
    for c in clips or []:
        path = os.path.join(AUDIO, c["file"])
        if not os.path.exists(path):
            continue
        a = _load_snd(path, sr)
        _add(voice, a, c["start"], float(c.get("gain", 1.0)))
        s = int(c["start"] * sr); e = min(total, s + len(a))
        if s < total:
            speech[s:e] = 1.0
    fx = np.zeros(total, np.float32)
    for ev in sfx or []:
        p = os.path.join(ASSETS_DIR, "sfx", os.path.basename(str(ev.get("id"))) + ".mp3")
        if os.path.exists(p):
            _add(fx, _load_snd(p, sr), float(ev["t"]), float(ev.get("g", 0.4)))
    for bd in beds or []:
        p = os.path.join(ASSETS_DIR, "sfx", os.path.basename(str(bd.get("id"))) + ".mp3")
        if not os.path.exists(p):
            continue
        a = _load_snd(p, sr)
        t0, t1 = float(bd["t0"]), min(float(bd["t1"]), duration + 0.5)
        n = int((t1 - t0) * sr)
        if n <= 0 or len(a) < sr:
            continue
        xf = min(int(1.0 * sr), len(a) // 3)
        seg = np.zeros(n, np.float32); pos = 0
        while pos < n:  # lặp có crossfade để không nghe thấy mối nối
            chunk = a[: min(len(a), n - pos)].copy()
            if pos > 0 and len(chunk) > xf:
                chunk[:xf] *= np.linspace(0, 1, xf)
            if len(chunk) > xf and pos + len(a) < n:
                chunk[-xf:] *= np.linspace(1, 0, xf)
            seg[pos: pos + len(chunk)] += chunk
            pos += len(a) - xf
        fi = min(int(0.8 * sr), n // 2)
        seg[:fi] *= np.linspace(0, 1, fi); seg[-fi:] *= np.linspace(1, 0, fi)
        _add(fx, seg, t0, float(bd.get("g", 0.12)))
    mus = np.zeros(total, np.float32)
    credit = ""
    if music and music.get("id") and music["id"] != "none":
        p = os.path.join(ASSETS_DIR, "music", os.path.basename(str(music["id"])) + ".mp3")
        if os.path.exists(p):
            a = _load_snd(p, sr, stereo=True)
            xf = min(int(3 * sr), len(a) // 3)
            pos = 0
            while pos < total:
                chunk = a.copy()
                if pos > 0:
                    chunk[:xf] *= np.linspace(0, 1, xf)
                if pos + len(a) < total:
                    chunk[-xf:] *= np.linspace(1, 0, xf)
                e = min(total, pos + len(chunk))
                mus[pos:e] += chunk[: e - pos]
                pos += len(a) - xf
            # hạ nhạc khi có giọng (mượt ~0.35s), lên lại khi im
            k = int(0.35 * sr)
            sm = np.convolve(speech, np.ones(k, np.float32) / k, mode="same")
            gain = float(music.get("gain", 0.5))
            env = (1.0 - 0.62 * np.clip(sm, 0, 1)) * gain * 0.55
            fi = min(int(2 * sr), total // 2)
            env[:fi] *= np.linspace(0, 1, fi)
            fo = min(int(2.5 * sr), total // 2)
            env[-fo:] *= np.linspace(1, 0, fo)
            mus *= env
            try:
                credit = json.load(open(os.path.join(ASSETS_DIR, "music", "meta.json"), encoding="utf-8")).get(music["id"], {}).get("credit", "")
            except Exception:
                credit = ""
    # hiệu ứng cũng nhường giọng một chút để lời luôn rõ
    fx_env = 1.0 - 0.25 * np.clip(np.convolve(speech, np.ones(int(0.2 * sr), np.float32) / int(0.2 * sr), mode="same"), 0, 1)
    buf = voice * 1.0 + fx * fx_env + mus
    peak = float(np.max(np.abs(buf))) if len(buf) else 0.0
    if peak > 0.95:
        buf = buf * (0.95 / peak)
    with wave.open(out_wav, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((np.clip(buf, -1, 1) * 32767).astype(np.int16).tobytes())
    return credit


@app.post("/api/export/{jid}/finish")
async def export_finish(jid: str, req: Request):
    j = EXPORT_JOBS.get(jid)
    if not j:
        raise HTTPException(404, "Không có tác vụ xuất")
    body = await req.json()
    j["proc"].stdin.close()
    if j["proc"].wait() != 0:
        raise HTTPException(500, "ffmpeg lỗi: " + j["proc"].stderr.read().decode(errors="ignore")[-500:])
    name = slugify(j["title"]) + "-" + jid + ".mp4"
    out = os.path.join(EXPORTS, name)
    wav = os.path.join(EXPORTS, jid + ".wav")
    clips = body.get("clips") or []
    credit = ""
    if clips or body.get("sfx") or body.get("beds") or (body.get("music") or {}).get("id"):
        credit = _mix_audio(clips, float(body.get("duration", 0)), wav, sfx=body.get("sfx"), beds=body.get("beds"), music=body.get("music"))
        cmd = ["ffmpeg", "-y", "-v", "error", "-i", j["tmp"], "-i", wav, "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", out]
    else:
        cmd = ["ffmpeg", "-y", "-v", "error", "-i", j["tmp"], "-c:v", "copy", "-movflags", "+faststart", out]
    r = subprocess.run(cmd, capture_output=True, text=True)
    for f in (j["tmp"], wav):
        try:
            os.remove(f)
        except OSError:
            pass
    if r.returncode != 0:
        raise HTTPException(500, "Ghép âm thanh lỗi: " + r.stderr[-400:])
    EXPORT_JOBS.pop(jid, None)
    return {"url": f"/data/exports/{name}", "frames": j["frames"], "credit": credit}


@app.get("/")
def index():
    return FileResponse(os.path.join(ROOT, "static", "index.html"))


app.mount("/static", StaticFiles(directory=os.path.join(ROOT, "static")), name="static")
app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")
app.mount("/data", StaticFiles(directory=DATA), name="data")
