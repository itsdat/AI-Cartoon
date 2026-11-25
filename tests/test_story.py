"""Chạy: python tests/test_story.py  — kiểm tra luồng 2 giai đoạn + bộ làm sạch với LLM giả."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core.llm import LLM, generate_story
from core.story import sanitize_story


class Fake(LLM):
    def __init__(self):
        super().__init__("fake")
        self.calls = []

    def complete_json(self, system, user, temperature=0.9, retries=2):
        self.calls.append(user[:60])
        if "CẢNH CẦN VIẾT" not in user:  # giai đoạn 1
            return {"title": "T", "logline": "L", "hook": "h", "central_question": "q", "twist": "t", "ending_image": "e",
                    "characters": [], "scenes": [{"id": "s1", "title": "A", "background": "park", "summary": "x", "target_words": 50},
                                                 {"id": "s2", "title": "B", "background": "khong_ton_tai", "summary": "y", "target_words": 50}]}
        return {"id": "x", "title": "cảnh", "background": "park", "camera": "bay_len_troi",
                "cast": [{"name": "nam chinh", "slot": "left"}, {"name": "Ma Cà Rồng"}],
                "beats": [{"speaker": "narrator", "text": "Một câu.", "emotions": {"Nam chính": "sad", "X": "happy"},
                           "actions": [{"who": "Nam chính", "do": "wave"}, {"who": "Nam chính", "do": "bay_len"},
                                       {"who": "Nam chính", "do": "walk_to", "to": "nowhere"}]},
                          {"speaker": "Nam chính", "text": "Thoại.", "actions": []}, {"speaker": "narrator", "text": "  "}]}


chars = [{"name": "Nam chính", "gender": "male", "age_group": "adult"}]
f = Fake(); prog = []
s = generate_story("ý", "g", 1, "first", chars, [], f, lambda m, p: prog.append(m))
assert len(s["scenes"]) == 2 and len(f.calls) == 3, (len(s["scenes"]), f.calls)
sc = s["scenes"][0]
assert sc["camera"] == "static" and [c["name"] for c in sc["cast"]] == ["Nam chính"], sc["cast"]
assert [a["do"] for a in sc["beats"][0]["actions"]] == ["wave", "walk_to"] and sc["beats"][0]["actions"][1]["to"] == "center"
assert len(sc["beats"]) == 2 and sc["beats"][0]["emotions"] == {"Nam chính": "sad"}
assert s["scenes"][1]["background"] == "park"
d = generate_story("", "g", 3, "first", chars, [], LLM("demo"))
assert d["scenes"] and d["scenes"][0]["beats"]
print("OK", len(prog), "bước tiến trình; demo:", len(d["scenes"]), "cảnh")
