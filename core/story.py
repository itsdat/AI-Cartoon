"""Định nghĩa 'từ vựng' mà engine hoạt hình hiểu được + làm sạch JSON truyện do AI sinh ra."""
import re
from typing import Dict, List

EMOTIONS = ["neutral", "happy", "sad", "angry", "surprised", "scared"]
SLOTS = {"far_left": 0.16, "left": 0.3, "center": 0.5, "right": 0.7, "far_right": 0.84}
FACINGS = ["front", "left", "right", "back"]
# hành động engine thực sự làm được (không thêm cái nào engine chưa có)
ACTIONS = {
    "enter_left": "đi vào từ mép trái màn hình tới vị trí của mình",
    "enter_right": "đi vào từ mép phải màn hình",
    "exit_left": "đi ra khỏi màn hình về bên trái",
    "exit_right": "đi ra khỏi màn hình về bên phải",
    "walk_to": "đi bộ tới vị trí 'to' (far_left/left/center/right/far_right)",
    "run_to": "chạy tới vị trí 'to'",
    "face": "quay mặt: 'to' = front/left/right/back",
    "wave": "vẫy tay", "point": "chỉ tay về phía trước", "shrug": "nhún vai/dang tay bất lực",
    "nod": "gật đầu", "shake_head": "lắc đầu", "jump": "nhảy lên", "cheer": "giơ hai tay reo mừng",
    "hands_on_head": "ôm đầu (hoảng, bất lực)", "cover_face": "che mặt (khóc, xấu hổ)",
    "bow": "cúi chào/cúi đầu", "sit": "ngồi xuống đất", "stand": "đứng dậy từ chỗ ngồi",
    "fall": "ngã xuống (nằm yên tới khi get_up)", "get_up": "bò dậy sau khi ngã",
    "step_in": "(chỉ cảnh có 'set') bước vào sâu trong khung, quay lưng về phía camera, ví dụ bước vào thang máy",
    "step_out": "(chỉ cảnh có 'set') bước ra phía camera, mặt hướng về camera, ví dụ bước ra khỏi thang máy",
}
# cỡ cảnh cho cue 'cam'
SHOT_CAMS = ["wide", "two", "medium", "close", "push", "pull", "pov"]
# "set" = bối cảnh có nhiều góc quay + đạo cụ chuyển động (cửa, nút bấm, số tầng...)
SETS = {
    "elevator": {
        "desc": "thang máy trong chung cư",
        "angles": {
            "hall": "đứng ở hành lang nhìn thẳng vào cửa thang máy (cửa đóng/mở, nhân vật vào/ra thang máy; có đèn báo tầng phía trên cửa)",
            "panel": "góc nhìn của người trong thang máy: cận bảng nút bấm, thấy bàn tay bấm nút (không thấy nhân vật), số tầng nhảy",
            "inside": "trong thang máy nhìn từ phía sau lưng nhân vật hướng ra cửa thang máy (nhân vật quay lưng, đèn báo tầng phía trên cửa)",
        },
        "default_angle": "hall",
        "fx": {
            "door_open": "cửa thang máy mở ra",
            "door_close": "cửa thang máy đóng lại",
            "press": "bàn tay bấm nút tầng 'value' (cần góc panel để thấy)",
            "ride_start": "thang máy bắt đầu chạy lên/xuống tới tầng 'value': camera rung nhẹ không đều, số tầng nhảy dần",
            "ride_stop": "thang máy dừng (giật nhẹ một cái); sau đó thường là door_open",
            "flicker": "đèn nhấp nháy",
        },
    },
}
CAMERAS = ["static", "push_in", "pull_out", "pan_left", "pan_right", "close_up"]
BG_PRESETS = {
    "school_gate": "cổng trường buổi sáng", "classroom": "lớp học", "home_evening": "trong nhà buổi tối",
    "street_day": "đường phố ban ngày", "street_night": "đường phố ban đêm", "park": "công viên",
    "village_sunset": "làng quê hoàng hôn", "rain_gloom": "trời mưa u ám", "hospital": "bệnh viện, tường sáng",
    "office": "văn phòng", "river_dawn": "bờ sông lúc bình minh", "plain_cream": "nền trơn màu kem (cảnh cận mặt, hồi tưởng)",
}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def sanitize_story(story: dict, char_names: List[str], bg_names: List[str] = None) -> dict:
    """Ép JSON của AI về đúng schema; bỏ hành động lạ; map tên nhân vật về thư viện."""
    bg_names = bg_names or []
    lib = {_norm(n): n for n in char_names}

    def mapname(n):
        k = _norm(n)
        if k in ("narrator", "người kể", "nguoi ke", "người dẫn", ""):
            return "narrator"
        if k in lib:
            return lib[k]
        for lk, lv in lib.items():  # khớp gần đúng ("Nam chính" ~ "nam chinh")
            if k in lk or lk in k:
                return lv
        return None

    out = {"title": str(story.get("title") or "Chưa đặt tên")[:120],
           "logline": str(story.get("logline") or "")[:400], "scenes": []}
    valid_bg = set(BG_PRESETS) | set(bg_names)
    for si, sc in enumerate(story.get("scenes") or []):
        cast = []
        seen = set()
        for c in sc.get("cast") or []:
            nm = mapname(c.get("name") if isinstance(c, dict) else c)
            if not nm or nm == "narrator" or nm in seen:
                continue
            seen.add(nm)
            slot = c.get("slot") if isinstance(c, dict) else None
            facing = c.get("facing") if isinstance(c, dict) else None
            start = c.get("start") if isinstance(c, dict) else None
            cast.append({"name": nm, "slot": slot if slot in SLOTS else "center",
                         "facing": facing if facing in FACINGS else "front",
                         "start": start if start in ("stand", "sit", "offscreen_left", "offscreen_right") else "stand"})
        beats = []
        for b in sc.get("beats") or []:
            text = str(b.get("text") or "").strip()
            set_name = sc.get("set") if sc.get("set") in SETS else None
            has_stage = bool(b.get("cues") or b.get("actions"))
            if not text and not has_stage:
                continue
            sp = mapname(b.get("speaker") or "narrator") or "narrator"
            if not text:
                sp = "narrator"
            if sp != "narrator" and sp not in seen:  # người nói mà chưa có trong cảnh → thêm vào
                seen.add(sp); cast.append({"name": sp, "slot": "center", "facing": "front", "start": "stand"})
            emo = {}
            for k, v in (b.get("emotions") or {}).items():
                nm = mapname(k)
                if nm and nm != "narrator" and v in EMOTIONS:
                    emo[nm] = v
            acts = []
            for a in b.get("actions") or []:
                nm = mapname(a.get("who"))
                do = a.get("do")
                if not nm or nm == "narrator" or do not in ACTIONS:
                    continue
                if nm not in seen:
                    seen.add(nm); cast.append({"name": nm, "slot": "center", "facing": "front", "start": "stand"})
                item = {"who": nm, "do": do}
                if do in ("walk_to", "run_to"):
                    item["to"] = a.get("to") if a.get("to") in SLOTS else "center"
                if do == "face":
                    item["to"] = a.get("to") if a.get("to") in FACINGS else "front"
                try:
                    item["at"] = min(0.9, max(0.0, float(a.get("at", 0))))
                except Exception:
                    item["at"] = 0.0
                if do == "fall":
                    item["dir"] = a.get("dir") if a.get("dir") in ("left", "right") else "right"
                acts.append(item)
            # cue: đổi góc quay / cỡ cảnh / hiệu ứng đạo cụ tại thời điểm 'at' (0..1) trong beat
            cues = []
            sdef = SETS.get(set_name) if set_name else None
            for c in b.get("cues") or []:
                if not isinstance(c, dict):
                    continue
                try:
                    at = min(1.0, max(0.0, float(c.get("at", 0))))
                except Exception:
                    at = 0.0
                cu = {"at": at}
                if sdef and c.get("angle") in sdef["angles"]:
                    cu["angle"] = c["angle"]
                if c.get("cam") in SHOT_CAMS:
                    cu["cam"] = c["cam"]
                if sdef and c.get("fx") in sdef["fx"]:
                    cu["fx"] = c["fx"]
                    if c.get("value") is not None:
                        try:
                            cu["value"] = int(float(c["value"]))
                        except Exception:
                            pass
                if c.get("who") is not None:
                    nm = mapname(c.get("who"))
                    if nm and nm != "narrator":
                        cu["who"] = nm
                if len(cu) > 1:
                    cues.append(cu)
            beat = {"speaker": sp, "text": text, "emotions": emo, "actions": acts,
                    "pause_after": min(2.0, max(0.0, float(b.get("pause_after") or 0.25)))}
            if cues:
                beat["cues"] = sorted(cues, key=lambda x: x["at"])
            if b.get("dur") is not None:
                try:
                    beat["dur"] = min(8.0, max(0.4, float(b["dur"])))
                except Exception:
                    pass
            elif not text:
                beat["dur"] = 1.5
            beats.append(beat)
        if not beats:
            continue
        bg = sc.get("background")
        if bg not in valid_bg:
            bg = "plain_cream"
        cam = sc.get("camera") if sc.get("camera") in CAMERAS else "static"
        scene = {"id": str(sc.get("id") or f"s{si+1}"), "title": str(sc.get("title") or "")[:100],
                 "background": bg, "bg_prompt": str(sc.get("bg_prompt") or "")[:400],
                 "camera": cam, "cast": cast, "beats": beats}
        if sc.get("set") in SETS:
            scene["set"] = sc["set"]
            try:
                scene["floor_start"] = int(sc.get("floor_start") or 1)
            except Exception:
                scene["floor_start"] = 1
        out["scenes"].append(scene)
    return out


def word_count(story: dict) -> int:
    return sum(len((b.get("text") or "").split()) for s in story["scenes"] for b in s["beats"])


def demo_story(char_names: List[str]) -> dict:
    """Truyện mẫu ngắn để chạy thử toàn bộ pipeline mà không cần API key."""
    a = char_names[0] if char_names else "Nam chính"
    b = char_names[1] if len(char_names) > 1 else None
    cast2 = [{"name": a, "slot": "left", "facing": "right"}] + ([{"name": b, "slot": "right", "facing": "left", "start": "offscreen_right"}] if b else [])
    sc = [
        {"id": "s1", "title": "Chuyến xe cuối", "background": "street_night", "camera": "push_in",
         "bg_prompt": "empty bus stop at night, soft ink wash, muted teal and ochre, anime background, no people",
         "cast": [{"name": a, "slot": "center", "facing": "front"}],
         "beats": [
             {"speaker": "narrator", "text": "Tối hôm đó, tôi đứng ở trạm xe buýt cuối cùng với đúng một tờ năm chục nghìn trong túi.", "emotions": {a: "neutral"}, "actions": [{"who": a, "do": "enter_left"}]},
             {"speaker": "narrator", "text": "Chuyến xe về quê chỉ còn một chuyến. Và tôi đang đứng đây, chưa dám mua vé.", "emotions": {a: "sad"}, "actions": []},
             {"speaker": a, "text": "Về làm sao nói với mẹ đây... mình bỏ ngang trường rồi.", "emotions": {a: "sad"}, "actions": [{"who": a, "do": "cover_face", "at": 0.3}]}]},
        {"id": "s2", "title": "Người lạ", "background": "street_night", "camera": "static",
         "cast": cast2,
         "beats": [
             {"speaker": "narrator", "text": "Có tiếng bước chân sau lưng. Một người lạ dừng lại, nhìn tôi hồi lâu.", "emotions": {a: "surprised"}, "actions": ([{"who": b, "do": "enter_right"}] if b else []) + [{"who": a, "do": "face", "to": "right"}]},
             {"speaker": b or "narrator", "text": "Cậu đứng đó một tiếng rồi. Lên xe đi, tôi trả tiền vé cho.", "emotions": ({b: "happy"} if b else {}), "actions": ([{"who": b, "do": "wave"}] if b else [])},
             {"speaker": a, "text": "Dạ... cháu không dám nhận đâu ạ.", "emotions": {a: "scared"}, "actions": [{"who": a, "do": "shake_head"}]}]},
        {"id": "s2b", "title": "Thang máy lên tầng 12", "background": "plain_cream", "set": "elevator", "floor_start": 1,
         "cast": [{"name": a, "slot": "far_left", "facing": "right", "start": "offscreen_left"}],
         "beats": [
             {"speaker": "narrator", "text": "Đêm nào anh bảo vệ cũng làm đúng một việc ấy.", "emotions": {a: "neutral"},
              "actions": [{"who": a, "do": "enter_left", "at": 0.0}, {"who": a, "do": "walk_to", "to": "center", "at": 0.1}, {"who": a, "do": "step_in", "at": 0.7}],
              "cues": [{"at": 0.0, "angle": "hall", "cam": "wide"}, {"at": 0.75, "cam": "medium", "who": a}]},
             {"speaker": "narrator", "text": "", "dur": 4.2, "emotions": {},
              "actions": [{"who": a, "do": "face", "to": "back", "at": 0.0}],
              "cues": [{"at": 0.0, "angle": "panel", "cam": "pov"}, {"at": 0.12, "fx": "press", "value": 12},
                       {"at": 0.45, "fx": "door_close"}, {"at": 0.62, "fx": "ride_start", "value": 12}]},
             {"speaker": "narrator", "text": "Tầng mười hai, căn hộ không có ai ở.", "emotions": {a: "sad"},
              "actions": [{"who": a, "do": "step_out", "at": 0.5}],
              "cues": [{"at": 0.0, "fx": "ride_stop"}, {"at": 0.12, "angle": "hall", "cam": "wide", "fx": "door_open"}, {"at": 0.6, "cam": "medium", "who": a}]}]},
        {"id": "s3", "title": "Chuyến xe", "background": "village_sunset", "camera": "pan_right",
         "cast": [{"name": a, "slot": "left", "facing": "right"}],
         "beats": [
             {"speaker": "narrator", "text": "Hôm sau xe tới đầu làng lúc hoàng hôn. Mẹ đang đứng đợi, chẳng hỏi gì cả.", "emotions": {a: "neutral"}, "actions": [{"who": a, "do": "walk_to", "to": "right"}]},
             {"speaker": "narrator", "text": "Bà chỉ đưa cho tôi cái nón, bảo: về ăn cơm. Ngày mai tính tiếp.", "emotions": {a: "happy"}, "actions": [{"who": a, "do": "bow", "at": 0.5}]}]},
    ]
    return {"title": "Chuyến xe cuối (truyện mẫu)", "logline": "Một người trẻ bỏ học, đứng ở trạm xe và được cho một cơ hội về nhà.", "scenes": sc}
