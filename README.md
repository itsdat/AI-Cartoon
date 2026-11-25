# Stickman Studio

Tool tạo video người que kể chuyện: AI viết truyện → nhân vật tự chuyển động theo truyện → giọng đọc + phụ đề → xuất MP4.

## Cài và chạy

Cần: Python 3.10+, **ffmpeg** (có trong PATH), Chrome/Edge.

- macOS/Linux: `./run.sh`
- Windows: bấm đúp `run.bat`

Mở http://localhost:8765. Lần đầu script tự tạo môi trường và cài thư viện.

## Quy trình

1. **Cài đặt** → chọn Gemini hoặc DeepSeek, dán API key (chế độ *Demo* chạy thử không cần key).
2. **Nhân vật** → nhập tên, giới tính, độ tuổi, tải ảnh sheet (4 góc toàn thân + các đầu biểu cảm). Tool tự tách đầu, thân, vai, hông; tay chân vẽ lại bằng code (nét que). Thử đi/chạy/ngồi/ngã/vẫy tay ngay trong tab, chỉnh độ dài tay chân và vị trí miệng bằng thanh trượt.
3. **Phông nền** (tuỳ chọn) → tải ảnh nền; có sẵn 12 phông vẽ bằng code. Mỗi cảnh AI còn viết sẵn "prompt nền" tiếng Anh để bạn gen ảnh.
4. **Truyện** → nhập ý tưởng, thể loại, số phút (1–15), chọn nhân vật → *Tạo cốt truyện*. Sửa tự do: lời, người nói, cảm xúc, hành động, nền, camera.
5. **Xem & Xuất** → *① Tạo giọng đọc* (Edge-TTS tiếng Việt, mỗi nhân vật một giọng theo giới tính/tuổi) → xem thử → *② Xuất MP4*. Xuất chạy trong trình duyệt: giữ tab mở.

## Phong cách & âm thanh (học từ stickman-video-director, MIT)

- **Phong cách dựng** (tab Truyện + tab Xem & Xuất): giấy tối giản, ấm áp, hài, TV cũ, hổ phách bí ẩn, hài đen nguyên thủy, thần thoại, cảm động. Mỗi phong cách = giọng viết cho AI + bộ lọc hình + loại hiệu ứng + nhạc + kiểu phụ đề.
- **Luật đạo diễn** (core/director.py): nhịp 5 bước giữ chân người xem, hook 5 giây, nghỉ nhịp sau câu đắt, đa dạng cỡ cảnh. Sau khi tạo truyện có hộp "Gợi ý của đạo diễn" (kịch bản thiếu hành động, câu quá dài, thiếu nhịp nghỉ…).
- **Hiệu ứng tự khớp hành động**: bước chân (theo nền: gỗ/cỏ/bê tông), ngã, nhảy, đóng/mở cửa, đổi cảnh; kiểu hoạt hình thêm boing/squeak. Nền môi trường theo phông (mưa, phố, chim, trong nhà).
- **Nhạc nền** 10 bản, tự nhỏ lại khi có giọng. Nhạc là CC BY 4.0: sau khi xuất tool đưa sẵn dòng ghi nguồn để dán vào mô tả video.
- Âm thanh lấy từ kho của kaomei/stickman-video-director (hiệu ứng CC0, nhạc Kevin MacLeod CC BY); xem assets/CREDITS.md.

## Truyện dài được viết thế nào

AI viết 2 bước: (1) dàn ý có hook, mâu thuẫn xuyên suốt, bước ngoặt, hình ảnh kết; (2) từng cảnh một theo dàn ý, kèm tóm tắt cảnh trước. Prompt có bộ quy tắc chống sáo rỗng (không "hóa ra là mơ", không nêu bài học bằng lời giáo huấn, kết bằng hình ảnh). Sửa ở `QUALITY_RULES` trong `core/llm.py`.

## Hành động nhân vật làm được

đi vào/ra mép màn hình, đi tới vị trí, chạy, quay mặt, vẫy tay, chỉ tay, nhún vai, gật/lắc đầu, nhảy, reo mừng, ôm đầu, che mặt, cúi chào, ngồi/đứng dậy, ngã/bò dậy. Cảm xúc: bình thường, vui, buồn, giận, ngạc nhiên, sợ (đổi đầu). Miệng mở/đóng theo lời đọc.
AI chỉ được dùng đúng danh sách này (lọc ở `core/story.py`), nên không bao giờ ra hành động engine không làm được.

## Giới hạn hiện tại

- Chỉ có biểu cảm ở góc chính diện; khi đi/ngồi/ngã nhân vật dùng góc nghiêng (mặt giữ nguyên, miệng không mấp máy).
- Chưa có: ôm nhau, bắt tay, cầm đồ vật, nhiều nhân vật tương tác vật lý.
- Ảnh nhân vật độ phân giải thấp sẽ bị mềm khi zoom: gen sheet ở 2K trở lên.
- Giọng Edge-TTS cần Internet; mất mạng thì tool dùng im lặng với thời lượng ước lượng.

## Cấu trúc

```
app.py              API (FastAPI)
core/sheet_parser   tách sheet nhân vật + dựng rig tự động
core/llm.py         Gemini / DeepSeek, truyện 2 giai đoạn
core/story.py       từ vựng hành động + làm sạch JSON
core/tts.py         Edge-TTS (+ cache)
static/engine.js    engine hoạt hình (tay chân IK, camera, phụ đề)
static/app.js       giao diện
data/               nhân vật, dự án, giọng đọc, video xuất (dữ liệu của bạn)
tests/              test_story.py, ảnh sheet mẫu
```

## Set có nhiều góc quay (cảnh phối hợp với nhân vật)
Cảnh có `set` (hiện có: `elevator` = thang máy) dùng đạo cụ chuyển động và các góc quay riêng.
- Góc quay (`cue.angle`, đổi góc = cắt cứng): `hall` (hành lang nhìn vào cửa thang), `panel` (POV bảng nút + bàn tay bấm), `inside` (trong thang nhìn ra cửa).
- Hiệu ứng (`cue.fx`): `door_open`, `door_close`, `press` (value = tầng), `ride_start` (value = tầng đích, camera rung không đều), `ride_stop`, `flicker`.
- Cỡ cảnh (`cue.cam`): wide, two, medium, close, push, pull, pov. `cue.at` = vị trí 0..1 trong câu.
- Câu không có lời: để `text` rỗng và đặt `dur` (giây).
- Hành động nhân vật mới: `step_in` (bước vào khoang, quay lưng), `step_out` (bước ra phía camera).
Sửa cue ngay trong tab Truyện (ô JSON dưới mỗi câu). Xem truyện demo, cảnh "Thang máy lên tầng 12".
