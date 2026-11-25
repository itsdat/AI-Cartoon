"""Đạo diễn: phong cách, luật dựng, kiểm tra kịch bản, chọn nhạc.

Rút kinh nghiệm từ kaomei/stickman-video-director (MIT): nhịp 5 bước giữ chân người xem,
đa dạng cỡ cảnh, nhịp nghỉ sau punchline, âm thanh có lý do (không bíp mọi cú cắt),
caption một dòng, nhạc nền luôn nhỏ hơn giọng.
"""
import re
from typing import Dict, List

# look: bộ lọc hình (engine.js applyLook) · mood: khoá nhạc · sfx: comic | calm | off · sub: kiểu phụ đề
STYLES: Dict[str, dict] = {
    "clean": {"name": "Nét tối giản trên giấy", "look": "paper", "mood": "chill", "sfx": "calm", "sub": "ink",
              "prompt": "Giọng kể gọn, thông minh như giải thích một ý tưởng bằng hình ảnh. Mỗi cảnh một ẩn dụ đồ vật rõ ràng; ít thoại, nhiều hành động nhỏ có chủ đích."},
    "cozy": {"name": "Ấm áp đời thường", "look": "cozy", "mood": "warm", "sfx": "calm", "sub": "bold",
             "prompt": "Những khoảnh khắc nhỏ khó gọi tên: tin nhắn chưa trả lời, buổi chiều dành cho mình. Nhịp chậm, cận cảnh cảm xúc, hành động tiết chế, không gồng bi kịch."},
    "comic": {"name": "Hài hước, biểu cảm mạnh", "look": "none", "mood": "quirky", "sfx": "comic", "sub": "bold",
              "prompt": "Hài tình huống: leo thang vô lý, phản ứng cường điệu, đảo ngược cuối cảnh. Mỗi cảnh có setup → hành động → phản ứng, nghỉ trọn nhịp sau punchline."},
    "retro": {"name": "TV cũ", "look": "retro", "mood": "chill", "sfx": "calm", "sub": "box",
              "prompt": "Như một bản tin/chương trình đêm khuya: giọng kể bình thản, chi tiết lạ dần, kết lửng. Câu ngắn, ít thoại."},
    "noir": {"name": "Bí ẩn, bóng tối hổ phách", "look": "noir", "mood": "suspense", "sfx": "calm", "sub": "bold",
             "prompt": "Bí ẩn tăng dần, lộ thông tin từng lớp, im lặng có chủ ý. Không hài bựa; hành động ít nhưng mỗi hành động có hệ quả."},
    "cave": {"name": "Hài đen thời nguyên thủy", "look": "cave", "mood": "caper", "sfx": "comic", "sub": "bold",
             "prompt": "Ném một vấn đề hiện đại (đi làm, hợp đồng, deadline) vào thế giới hang động. Châm biếm nhẹ, phản ứng to, nghỉ nhịp để người xem cười."},
    "epic": {"name": "Lịch sử / thần thoại", "look": "cozy", "mood": "epic", "sfx": "calm", "sub": "bold",
             "prompt": "Một chi tiết lịch sử/thần thoại biến thành việc nhân vật phải đối mặt. Quy mô lớn dần, kết bằng hình ảnh mạnh."},
    "drama": {"name": "Cảm động", "look": "cozy", "mood": "sad", "sfx": "calm", "sub": "bold",
              "prompt": "Cảm xúc đến từ chi tiết và im lặng, không từ lời giải thích. Nhịp chậm ở khoảnh khắc đau, kết bằng một hành động nhỏ."},
}
LOOKS = {"none": "Không lọc", "paper": "Giấy + lưới mờ", "cozy": "Ấm, hạt phim nhẹ", "retro": "TV cũ (đường quét)",
         "noir": "Hổ phách tối", "cave": "Đất nung, thô"}
MOODS = {"auto": "Tự chọn theo truyện", "none": "Không nhạc", "warm": "Ấm áp", "chill": "Nhẹ, thư giãn", "upbeat": "Vui tươi",
         "quirky": "Lém lỉnh", "comedy": "Hài", "caper": "Lén lút, hài hước", "sad": "Buồn", "suspense": "Hồi hộp",
         "epic": "Hùng tráng", "tales": "Kể chuyện cổ"}
SFX_MODES = {"comic": "Hoạt hình (có boing, squeak)", "calm": "Tự nhiên (bước chân, ngã, cửa)", "off": "Tắt hiệu ứng"}

DIRECTOR_RULES = """LUẬT ĐẠO DIỄN (giữ chân người xem, bắt buộc):
- 5 nhịp: (1) hook lạ trong 5 giây đầu; (2) nêu điều ai cũng tin rồi phá vỡ nó; (3) lộ một chi tiết/cơ chế chưa ai biết; (4) sự thật rõ ràng khiến người xem "à ra thế"; (5) kết bằng hình ảnh hoặc câu hỏi mở. Truyện dài lặp nhịp này cho từng chặng.
- Mỗi cảnh: dựng (setup) → hành động → phản ứng. Cứ khoảng 20 giây phải có một sự kiện hình ảnh mới (nhân vật vào/ra, ngã, chỉ tay, đổi cảm xúc, đổi phông).
- Sau câu đắt (punchline, tiết lộ, cú sốc) để pause_after 0.6–1.2 giây cho người xem thở. Đừng lấp kín mọi khoảng lặng.
- Đa dạng cỡ cảnh: không dùng cùng một camera quá 2 cảnh liền; xen cận cảnh ở khoảnh khắc cảm xúc, toàn cảnh khi nhân vật di chuyển.
- Hành động phải có tiếng hợp lý (đi, chạy, ngã, nhảy, đóng cửa); engine tự thêm âm thanh, nên ưu tiên hành động thật thay vì chỉ nói.
- Không lặp một mô-típ (cùng kiểu mở cảnh, cùng kiểu kết cảnh) ở các cảnh liền kề. Không giải thích điều hình ảnh đã cho thấy."""

_MOOD_WORDS = [
    ("suspense", ["kinh dị", "trinh thám", "bí ẩn", "ma", "án", "đêm khuya", "rượt"]),
    ("sad", ["bi kịch", "day dứt", "cảm động", "mất", "chia tay", "tiễn", "nhớ", "di chúc"]),
    ("caper", ["hài đen", "châm biếm", "lừa", "mưu"]),
    ("quirky", ["hài", "vui", "bựa", "troll"]),
    ("epic", ["lịch sử", "thần thoại", "chiến", "vua", "kỳ ảo", "anh hùng"]),
    ("warm", ["học trò", "tình cảm", "gia đình", "ấm", "tình yêu", "mẹ", "bà"]),
    ("chill", ["tâm lý", "thực tế", "ẩn dụ", "giải thích", "kiến thức"]),
]


def mood_for(genre: str = "", text: str = "", style: str = "") -> str:
    if style in STYLES:
        return STYLES[style]["mood"]
    blob = f"{genre} {text}".lower()
    for mood, words in _MOOD_WORDS:
        if any(w in blob for w in words):
            return mood
    return "warm"


def style_for(genre: str = "") -> str:
    g = (genre or "").lower()
    if "hài đen" in g or "châm biếm" in g:
        return "comic"
    if "kinh dị" in g or "trinh thám" in g or "bí ẩn" in g:
        return "noir"
    if "kỳ ảo" in g or "lịch sử" in g:
        return "epic"
    if "bi kịch" in g or "cảm động" in g:
        return "drama"
    if "học trò" in g or "tình cảm" in g:
        return "cozy"
    if "tâm lý" in g or "ẩn dụ" in g:
        return "clean"
    return "cozy"


def lint_story(story: dict) -> List[dict]:
    """Cảnh báo chất lượng dựng (không chặn, chỉ gợi ý sửa)."""
    out: List[dict] = []
    scenes = story.get("scenes") or []
    if not scenes:
        return out
    beats = [(si, bi, b) for si, s in enumerate(scenes) for bi, b in enumerate(s.get("beats") or [])]
    first = beats[0][2] if beats else None
    if first and len((first.get("text") or "").split()) > 22:
        out.append({"level": "warn", "scene": 0, "msg": "Câu mở đầu dài hơn 22 từ — hook nên ngắn, đập vào mắt trong 5 giây đầu."})
    with_text = [x for x in beats if (x[2].get("text") or "").strip()]
    if with_text:
        alive = sum(1 for _, _, b in with_text if b.get("actions") or b.get("emotions"))
        if alive / len(with_text) < 0.6:
            out.append({"level": "warn", "msg": f"Chỉ {alive}/{len(with_text)} câu có hành động hoặc đổi cảm xúc — video dễ bị đứng hình. Thêm hành động ở các câu còn trống."})
    long_b = [(si, bi) for si, bi, b in with_text if len((b.get("text") or "").split()) > 26]
    if long_b:
        out.append({"level": "warn", "scene": long_b[0][0], "msg": f"{len(long_b)} câu dài hơn 26 từ — phụ đề sẽ tràn; tách thành 2 câu."})
    if beats and not any((b.get("pause_after") or 0) >= 0.6 for _, _, b in beats):
        out.append({"level": "tip", "msg": "Chưa có nhịp nghỉ nào ≥ 0.6s sau câu đắt — thêm pause_after ở các câu tiết lộ/punchline."})
    run = 1
    for i in range(1, len(scenes)):
        if scenes[i].get("camera") == scenes[i - 1].get("camera") and scenes[i].get("background") == scenes[i - 1].get("background"):
            run += 1
            if run >= 3:
                out.append({"level": "tip", "scene": i, "msg": f"Cảnh {i-1}–{i+1} cùng phông và cùng camera — đổi phông hoặc camera để đỡ đơn điệu."})
                break
        else:
            run = 1
    empty = [i + 1 for i, s in enumerate(scenes) if not any(b.get("actions") for b in s.get("beats") or [])]
    if empty:
        out.append({"level": "tip", "scene": empty[0] - 1, "msg": "Cảnh " + ", ".join(map(str, empty[:6])) + " không có hành động nào — nhân vật chỉ đứng nói."})
    return out
