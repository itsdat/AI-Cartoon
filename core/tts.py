"""Giọng đọc bằng edge-tts (miễn phí, có giọng Việt). Lưu cache theo nội dung. Nếu edge-tts không dùng được
(mất mạng...) sẽ tạo file im lặng với thời lượng ước lượng để vẫn dựng/xuất được video."""
import asyncio
import hashlib
import os
import subprocess
from typing import Dict, List

VOICES = {"male": "vi-VN-NamMinhNeural", "female": "vi-VN-HoaiMyNeural"}
# tinh chỉnh theo độ tuổi để các nhân vật không giống hệt nhau
AGE_TUNE = {"child": ("+5%", "+35Hz"), "teen": ("+3%", "+12Hz"), "adult": ("+0%", "+0Hz"),
            "middle": ("-2%", "-4Hz"), "old": ("-10%", "-14Hz")}


def voice_params(gender: str, age: str, voice: str = "", rate: str = "", pitch: str = ""):
    v = voice or VOICES.get(gender, VOICES["male"])
    r, p = AGE_TUNE.get(age, AGE_TUNE["adult"])
    return v, rate or r, pitch or p


def _duration(path: str) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True).stdout.strip()
    try:
        return float(out)
    except Exception:
        return 0.0


def _silent(path: str, seconds: float):
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", f"{seconds:.2f}",
                    "-c:a", "libmp3lame", "-q:a", "7", path], check=True)


async def _edge(text, voice, rate, pitch, path):
    import edge_tts
    try:
        com = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, boundary="WordBoundary")
    except TypeError:
        com = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    words, audio = [], bytearray()
    async for ch in com.stream():
        if ch["type"] == "audio":
            audio += ch["data"]
        elif ch["type"] in ("WordBoundary", "SentenceBoundary"):
            t0 = ch["offset"] / 1e7
            words.append({"t0": t0, "t1": t0 + ch["duration"] / 1e7, "text": ch["text"], "kind": ch["type"]})
    if not audio:
        raise RuntimeError("edge-tts không trả về âm thanh")
    with open(path, "wb") as f:
        f.write(audio)
    return words


def synth(text: str, voice: str, rate: str, pitch: str, out_dir: str) -> Dict:
    os.makedirs(out_dir, exist_ok=True)
    key = hashlib.sha1(f"{voice}|{rate}|{pitch}|{text}".encode()).hexdigest()[:16]
    path = os.path.join(out_dir, key + ".mp3")
    meta = path + ".json"
    import json
    if os.path.exists(path) and os.path.exists(meta):
        return json.load(open(meta))
    est = max(1.2, len(text.split()) * 0.36)
    ok, words, err = True, [], ""
    try:
        words = asyncio.run(_edge(text, voice, rate, pitch, path))
    except Exception as e:
        ok, err = False, str(e)[:200]
        _silent(path, est)
    dur = _duration(path) or est
    res = {"file": os.path.basename(path), "duration": dur, "words": words, "tts": ok, "error": err}
    json.dump(res, open(meta, "w"), ensure_ascii=False)
    return res
