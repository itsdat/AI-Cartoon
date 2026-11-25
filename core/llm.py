"""Tạo cốt truyện bằng Gemini / DeepSeek (hoặc 'demo' không cần API). Truyện dài sinh 2 giai đoạn:
1) dàn ý (hook, mâu thuẫn, bước ngoặt, cảnh)  2) viết từng cảnh theo dàn ý để giữ chất lượng khi dài 5–15 phút."""
import json
import re
import time
from typing import Callable, Dict, List, Optional

import httpx

from .director import DIRECTOR_RULES, STYLES, mood_for, style_for
from .story import ACTIONS, BG_PRESETS, CAMERAS, EMOTIONS, SETS, SHOT_CAMS, SLOTS, demo_story, sanitize_story, word_count

WPM = 150  # từ/phút khi đọc (đã tính nghỉ)

QUALITY_RULES = """QUY TẮC CHẤT LƯỢNG (bắt buộc):
- Mở bằng một HOOK cụ thể trong 15 giây đầu (một khoảnh khắc lạ, một câu hỏi chưa có lời đáp, hoặc một hậu quả) — không mở bằng "Ngày xửa ngày xưa", không giới thiệu dài dòng.
- Một ý tưởng trung tâm, một mong muốn rõ ràng của nhân vật chính, một điểm yếu thật sự, và cái giá phải trả. Mâu thuẫn leo thang qua từng cảnh, có BƯỚC NGOẶT bất ngờ nhưng hợp lý.
- Tả bằng chi tiết đời thường, cụ thể (đồ vật, con số, mùi, âm thanh) thay cho tính từ chung chung. Show, don't tell.
- TUYỆT ĐỐI tránh sáo rỗng: "hóa ra tất cả chỉ là một giấc mơ", "cuộc đời là một chuỗi những lựa chọn", "tôi nhận ra giá trị của gia đình", kết thúc có bài học đạo lý nói thẳng ra, nhân vật độc thoại giải thích cảm xúc, phản diện xấu vô cớ.
- Ý nghĩa phải để người xem TỰ cảm thấy qua hành động và hình ảnh cuối truyện, không nêu bài học bằng câu giáo huấn.
- Lời thoại ngắn, tự nhiên như người Việt nói thật; mỗi người nói một giọng. Câu kể ngắn gọn, nhịp thay đổi.
- Kết bằng một hình ảnh hoặc hành động cụ thể, gợi dư âm, không tóm tắt."""


def _extract_json(text: str):
    text = (text or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.S)
    try:
        return json.loads(text)
    except Exception:
        a, b = text.find("{"), text.rfind("}")
        if a >= 0 and b > a:
            return json.loads(text[a:b + 1])
        raise


class LLM:
    def __init__(self, provider: str, api_key: str = "", model: str = ""):
        self.provider, self.key, self.model = provider, api_key, model
        if provider == "gemini":
            self.model = model or "gemini-2.5-flash"
        elif provider == "deepseek":
            self.model = model or "deepseek-chat"

    def complete_json(self, system: str, user: str, temperature: float = 0.9, retries: int = 2):
        last = None
        for attempt in range(retries + 1):
            try:
                raw = self._call(system, user, temperature)
                return _extract_json(raw)
            except Exception as e:  # lỗi mạng hoặc JSON hỏng → thử lại
                last = e
                time.sleep(1.5 * (attempt + 1))
        raise RuntimeError(f"AI trả về lỗi hoặc JSON không hợp lệ: {last}")

    def _pick_gemini_model(self):
        r = httpx.get("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
                      headers={"x-goog-api-key": self.key}, timeout=30)
        if r.status_code >= 400:
            raise RuntimeError(f"Không lấy được danh sách model Gemini ({r.status_code}): {r.text[:200]}")
        names = [m["name"].split("/")[-1] for m in r.json().get("models", [])
                 if "generateContent" in m.get("supportedGenerationMethods", [])]
        bad = ("image", "tts", "live", "audio", "embed", "thinking", "robotics", "computer", "lite", "preview-", "exp")
        def score(n):
            if any(b in n for b in bad): return -1
            sc = 0
            if "flash" in n: sc += 10
            elif "pro" in n: sc += 6
            if n.endswith("-latest"): sc += 3
            import re
            m = re.search(r"gemini-(\d+(?:\.\d+)?)", n)
            if m: sc += float(m.group(1)) * 2
            return sc
        ranked = sorted((n for n in names if score(n) > 0), key=score, reverse=True)
        return ranked[0] if ranked else None

    def _call(self, system: str, user: str, temperature: float) -> str:
        if self.provider == "gemini":
            def go():
                return httpx.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent",
                    headers={"x-goog-api-key": self.key, "Content-Type": "application/json"},
                    json={"systemInstruction": {"parts": [{"text": system}]},
                          "contents": [{"role": "user", "parts": [{"text": user}]}],
                          "generationConfig": {"temperature": temperature, "responseMimeType": "application/json", "maxOutputTokens": 16000}},
                    timeout=240)
            r = go()
            if r.status_code == 404:
                # model bị gỡ/đổi tên → hỏi Google danh sách model còn dùng được và tự chọn
                picked = self._pick_gemini_model()
                if picked and picked != self.model:
                    self.model = picked
                    r = go()
            if r.status_code >= 400:
                raise RuntimeError(f"Gemini {r.status_code} (model {self.model}): {r.text[:300]}")
            d = r.json()
            return "".join(p.get("text", "") for p in d["candidates"][0]["content"]["parts"])
        if self.provider == "deepseek":
            r = httpx.post(
                "https://api.deepseek.com/chat/completions",
                headers={"Authorization": f"Bearer {self.key}"},
                json={"model": self.model, "temperature": min(1.3, temperature + 0.2), "max_tokens": 8000,
                      "response_format": {"type": "json_object"},
                      "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]},
                timeout=240)
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]
        raise RuntimeError("Nhà cung cấp AI không hợp lệ")


def _char_lines(chars: List[dict]) -> str:
    return "\n".join(f'- "{c["name"]}": {c.get("gender","")}, {c.get("age_group","")}{(" — " + c["note"]) if c.get("note") else ""}' for c in chars)


def _bg_lines(bg_names: List[str]) -> str:
    lines = [f'- "{k}": {v}' for k, v in BG_PRESETS.items()]
    lines += [f'- "{n}": (ảnh nền do người dùng tải lên)' for n in bg_names]
    return "\n".join(lines)


def _set_catalog() -> str:
    return "\n".join(f'- "{k}": {v["desc"]}' for k, v in SETS.items())


def _set_guide(name: str) -> str:
    d = SETS[name]
    angles = "\n".join(f'  • "{k}": {v}' for k, v in d["angles"].items())
    fx = "\n".join(f'  • "{k}": {v}' for k, v in d["fx"].items())
    return f'''CẢNH NÀY DÙNG SET "{name}" ({d["desc"]}): đây là cảnh phối hợp NHỊP NHÀNG giữa góc quay, đạo cụ và nhân vật.
Góc quay (cue.angle, đổi góc = CẮT CỨNG):
{angles}
Hiệu ứng đạo cụ (cue.fx):
{fx}
Cỡ cảnh (cue.cam): {", ".join(SHOT_CAMS)}. Cue.who = nhân vật cần lấy nét.
Mỗi beat có thể có "cues": [{{"at": 0..1, ...}}] — 'at' là vị trí trong beat. Một beat KHÔNG CÓ LỜI (text rỗng "") + "dur" (giây, 2–5) dùng để diễn một chuỗi hành động thuần hình ảnh: đây là cách làm các khoảnh khắc như bấm nút, cửa đóng, thang máy chạy. Hành động nhân vật: step_in (bước vào khoang, quay lưng), step_out (bước ra phía camera) cùng 'face'.
Hãy dựng chuỗi như một đạo diễn: cảnh toàn → nhân vật vào → CẮT sang góc người trong thang (panel) → bàn tay bấm nút → cửa đóng → rung (ride_start) → dừng (ride_stop) → CẮT sang góc đối diện (hall) cửa mở → nhân vật bước ra. Mỗi mốc 1–2 giây, không để một góc quay đứng quá 5 giây.
Ví dụ beats (rút gọn): [{{"speaker":"narrator","text":"Đêm nào anh bảo vệ cũng làm đúng một việc ấy.","actions":[{{"who":"A","do":"enter_left","at":0}},{{"who":"A","do":"walk_to","to":"center","at":0.1}},{{"who":"A","do":"step_in","at":0.7}}],"cues":[{{"at":0,"angle":"hall","cam":"wide"}}]}},{{"speaker":"narrator","text":"","dur":4.2,"actions":[],"cues":[{{"at":0,"angle":"panel","cam":"pov"}},{{"at":0.12,"fx":"press","value":12}},{{"at":0.45,"fx":"door_close"}},{{"at":0.62,"fx":"ride_start","value":12}}]}},{{"speaker":"narrator","text":"Tầng mười hai.","actions":[{{"who":"A","do":"step_out","at":0.5}}],"cues":[{{"at":0,"fx":"ride_stop"}},{{"at":0.12,"angle":"hall","cam":"wide","fx":"door_open"}}]}}]
Cảnh có "set" thì thêm trường "set" và (nếu là thang máy) "floor_start" (tầng bắt đầu) vào JSON.'''


def generate_story(idea: str, genre: str, minutes: float, pov: str, chars: List[dict], bg_names: List[str],
                   llm: LLM, progress: Optional[Callable[[str, float], None]] = None, style: str = "auto") -> dict:
    if style not in STYLES:
        style = style_for(genre)
    style_txt = "PHONG CÁCH: " + STYLES[style]["name"] + ". " + STYLES[style]["prompt"]
    prog = progress or (lambda m, p: None)
    names = [c["name"] for c in chars]
    if llm.provider == "demo":
        prog("Tạo truyện mẫu", 0.5)
        s = sanitize_story(demo_story(names), names, bg_names)
        s["style"] = style; s["mood"] = STYLES[style]["mood"]
        prog("Xong", 1.0)
        return s

    target_words = int(minutes * WPM)
    n_scenes = max(4, min(24, round(minutes * 1.6)))
    pov_txt = {"first": "ngôi thứ nhất (người kể xưng 'tôi')", "third": "ngôi thứ ba"}.get(pov, "ngôi thứ nhất (người kể xưng 'tôi')")

    prog("Lên dàn ý", 0.05)
    sys1 = "Bạn là biên kịch truyện kể ngắn tiếng Việt cho video hoạt hình người que, nổi tiếng vì cốt truyện sắc, bất ngờ, giàu cảm xúc. Luôn trả về JSON hợp lệ, không giải thích."
    usr1 = f"""Ý tưởng/chủ đề: {idea or '(tự do, hãy nghĩ một ý tưởng hay)'}
Thể loại/giọng điệu: {genre}
Độ dài mục tiêu: khoảng {minutes} phút ≈ {target_words} từ lời đọc, chia {n_scenes} cảnh.
Ngôi kể: {pov_txt}
{style_txt}
Thư viện nhân vật có sẵn (CHỈ được dùng đúng các tên này; nhân vật quần chúng không mặt dùng khi cần đám đông):
{_char_lines(chars)}
Phông nền có thể dùng:
{_bg_lines(bg_names)}
Set (bối cảnh nhiều góc quay + đạo cụ chuyển động, dùng khi truyện có khoảnh khắc như đi thang máy; chỉ dùng khi thực sự cần, tối đa 1–2 cảnh):
{_set_catalog()}

{QUALITY_RULES}
{DIRECTOR_RULES}

Hãy viết DÀN Ý dưới dạng JSON:
{{"title": "...", "logline": "một câu", "hook": "khoảnh khắc mở đầu cụ thể",
 "central_question": "câu hỏi/mâu thuẫn xuyên suốt", "twist": "bước ngoặt", "ending_image": "hình ảnh/hành động kết",
 "characters": [{{"name": "tên trong thư viện", "role": "...", "want": "...", "flaw": "..."}}],
 "scenes": [{{"id": "s1", "title": "...", "background": "một khóa phông nền ở trên", "set": "(tuỳ chọn) khóa set bên dưới nếu cảnh cần chuỗi hành động có đạo cụ chuyển động", "summary": "chuyện gì xảy ra, chi tiết cụ thể",
   "emotional_turn": "cảm xúc đổi từ ... sang ...", "target_words": {target_words // n_scenes}}}]}}
Đúng {n_scenes} cảnh (±2)."""
    outline = llm.complete_json(sys1, usr1, 1.0)
    scenes_plan = outline.get("scenes") or []
    if not scenes_plan:
        raise RuntimeError("AI không trả về dàn ý")

    sys2 = "Bạn là biên kịch + đạo diễn hoạt hình người que. Bạn viết lời kể và chỉ đạo hành động cho TỪNG CẢNH. Luôn trả về JSON hợp lệ, không giải thích."
    vocab = "\n".join(f'- "{k}": {v}' for k, v in ACTIONS.items())
    scenes, recap = [], ""
    total = len(scenes_plan)
    for i, sp in enumerate(scenes_plan):
        prog(f"Viết cảnh {i+1}/{total}: {sp.get('title','')}", 0.12 + 0.85 * i / total)
        usr2 = f"""DÀN Ý TOÀN TRUYỆN: {json.dumps({k: outline.get(k) for k in ('title','logline','hook','central_question','twist','ending_image','characters')}, ensure_ascii=False)}
TÓM TẮT CÁC CẢNH TRƯỚC: {recap or '(đây là cảnh đầu tiên)'}
CẢNH CẦN VIẾT ({i+1}/{total}): {json.dumps(sp, ensure_ascii=False)}
Ngôi kể: {pov_txt}. Số từ lời đọc của cảnh này: khoảng {sp.get('target_words', target_words // total)} từ (±15%).
{'Đây là CẢNH CUỐI: kết bằng hình ảnh/hành động cụ thể, không rút bài học.' if i == total - 1 else ''}
{'Đây là CẢNH ĐẦU: mở bằng hook trong 2 beat đầu.' if i == 0 else ''}

Nhân vật dùng được: {', '.join(names)}.
Hành động hợp lệ (chỉ dùng các khóa này):
{vocab}
Vị trí (slot): {', '.join(SLOTS)}. Cảm xúc: {', '.join(EMOTIONS)}. Camera: {', '.join(CAMERAS)}.

{QUALITY_RULES}
{DIRECTOR_RULES}
{style_txt}
{_set_guide(sp['set']) if sp.get('set') in SETS else 'Cue tuỳ chọn: mỗi beat có thể thêm "cues": [{"at": 0..1, "cam": "' + '|'.join(SHOT_CAMS) + '", "who": "Tên"}] để ép cỡ cảnh ở khoảnh khắc quan trọng (nếu bỏ trống, engine tự đạo diễn).'}

Mỗi 'beat' là 1–2 câu NGẮN (≤ 22 từ), là một dòng phụ đề. 'speaker' là "narrator" hoặc tên nhân vật đang nói thoại; xen kẽ lời kể và thoại để cảnh có nhịp, thoại qua lại giữa các nhân vật.
NHỊP HÌNH ẢNH (rất quan trọng, video không được đứng yên): hầu như beat nào cũng phải có ít nhất 1 hành động (đi/chạy/chỉ/nhún vai/gật/lắc đầu/ôm đầu/che mặt/ngã...) hoặc 1 đổi cảm xúc khớp với lời; những câu then chốt dùng cảm xúc mạnh (surprised, scared, angry, sad) để engine zoom cận mặt. Engine tự đạo diễn camera, tự quay mặt nhìn nhau khi thoại, tự thêm cử chỉ khi nói, nên bạn chỉ cần lo hành động và cảm xúc có nghĩa. Nên có chuyển động trong cảnh (nhân vật bước vào/ra, chạy, ngồi xuống, đứng dậy, ngã). 'at' (0..1) là thời điểm trong beat. Nhân vật cần có trong 'cast' trước khi dùng. Hành động 'enter_*' dùng khi nhân vật mới xuất hiện (cast.start = offscreen_left/right).

JSON trả về:
{{"id": "{sp.get('id', f's{i+1}')}", "title": "...", "background": "{sp.get('background', 'plain_cream')}", "bg_prompt": "prompt tiếng Anh để vẽ ảnh nền anime, không có người",
 "camera": "...", {('"set": "' + sp['set'] + '", "floor_start": 1, ') if sp.get('set') in SETS else ''}"cast": [{{"name": "...", "slot": "...", "facing": "front|left|right|back", "start": "stand|sit|offscreen_left|offscreen_right"}}],
 "beats": [{{"speaker": "narrator", "text": "...", "emotions": {{"Tên": "sad"}}, "actions": [{{"who": "Tên", "do": "wave", "at": 0.2}}], "cues": [], "pause_after": 0.3}}]}}"""
        scene = llm.complete_json(sys2, usr2, 0.9)
        scenes.append(scene)
        txt = " ".join(b.get("text", "") for b in scene.get("beats", []))
        recap += f" [{i+1}] {sp.get('summary','')} (kết cảnh: {txt[-160:]})"
    story = {"title": outline.get("title"), "logline": outline.get("logline"), "scenes": scenes}
    out = sanitize_story(story, names, bg_names)
    out["style"] = style
    out["mood"] = mood_for(genre, (outline.get("logline") or "") + " " + (outline.get("title") or ""), style)
    out["outline"] = {k: outline.get(k) for k in ("hook", "central_question", "twist", "ending_image", "characters")}
    out["words"] = word_count(out)
    prog("Xong", 1.0)
    return out
