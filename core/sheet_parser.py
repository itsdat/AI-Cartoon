"""Tách một sheet nhân vật (ảnh) thành: đầu biểu cảm, thân từng góc nhìn (đã bỏ tay chân) và
rig tự động (vai, hông, độ dài tay chân, nét vẽ). Mọi ngưỡng đều theo tỉ lệ nên chạy được với
ảnh độ phân giải bất kỳ."""
import json
import os
from typing import Dict, List, Optional

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

VIEWS = ["front", "three", "side", "back"]
EXPR = ["neutral", "happy", "sad", "angry", "surprised", "scared", "side", "back"]


# ------------------------------------------------------------------ helpers
def _paper_color(rgb: np.ndarray) -> np.ndarray:
    light = rgb[rgb.min(axis=2) > 170]
    if len(light) == 0:
        return np.array([255, 255, 255])
    q = (light // 8).astype(np.int32)
    keys, counts = np.unique(q, axis=0, return_counts=True)
    return keys[counts.argmax()] * 8 + 4


def _largest(mask: np.ndarray) -> np.ndarray:
    lab, n = ndi.label(mask)
    if n == 0:
        return mask
    sizes = ndi.sum(mask, lab, range(1, n + 1))
    return lab == (1 + int(np.argmax(sizes)))


def _disk(d: int) -> np.ndarray:
    d = max(3, int(d) | 1)
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (d, d))


def _open(mask: np.ndarray, d: int) -> np.ndarray:
    return cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_OPEN, _disk(d)).astype(bool)


def _dilate(mask: np.ndarray, d: int) -> np.ndarray:
    return cv2.dilate(mask.astype(np.uint8), _disk(d)).astype(bool)


def _bbox(mask: np.ndarray):
    ys, xs = np.where(mask)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


# ------------------------------------------------------------------ components
def find_components(img: Image.Image) -> dict:
    rgb = np.array(img.convert("RGB")).astype(np.int16)
    bg = _paper_color(rgb)
    dist = np.abs(rgb - bg[None, None, :]).max(axis=2)
    paper = dist < 26
    # tờ giấy = vùng nền lớn nhất (bỏ viền tối của ảnh chụp màn hình)
    lab, n = ndi.label(paper)
    sizes = ndi.sum(paper, lab, range(1, n + 1))
    big = lab == (1 + int(np.argmax(sizes)))
    x0, y0, x1, y1 = _bbox(big)
    inset = max(4, int(0.012 * min(rgb.shape[:2])))
    x0, y0, x1, y1 = x0 + inset, y0 + inset, x1 - inset, y1 - inset
    area = np.zeros(paper.shape, bool)
    area[y0:y1, x0:x1] = True
    fg0 = (~paper) & area
    g = max(2, int(round(0.008 * min(rgb.shape[:2]))))
    lab, n = ndi.label(_dilate(fg0, 2 * g + 1))
    comps = []
    for i, sl in enumerate(ndi.find_objects(lab)):
        m = (lab[sl] == i + 1) & fg0[sl]
        if m.sum() < 20:
            continue
        h, w = m.shape
        ys0, xs0 = sl[0].start, sl[1].start
        # bỏ mảnh chạm mép vùng giấy (viền, góc bo)
        if xs0 <= x0 + 1 or ys0 <= y0 + 1 or xs0 + w >= x1 - 1 or ys0 + h >= y1 - 1:
            continue
        comps.append({"bbox": (xs0, ys0, xs0 + w, ys0 + h), "sl": sl, "lab": i + 1})
    # mảnh nằm gọn bên trong bbox của mảnh lớn hơn (mắt, miệng, giọt nước mắt) → gộp vào mảnh đó
    comps.sort(key=lambda c: -((c["bbox"][2] - c["bbox"][0]) * (c["bbox"][3] - c["bbox"][1])))
    top_level = []
    for c in comps:
        x0, y0, x1, y1 = c["bbox"]
        host = next((q for q in top_level if x0 >= q["bbox"][0] - 2 and y0 >= q["bbox"][1] - 2 and x1 <= q["bbox"][2] + 2 and y1 <= q["bbox"][3] + 2), None)
        if host:
            lab[lab == c["lab"]] = host["lab"]
        else:
            top_level.append(c)
    return {"rgb": rgb, "bg": bg, "dist": dist, "fg0": fg0, "lab": lab, "comps": top_level}


def cut_component(info: dict, comp: dict, pad: int = 4):
    """trả về (RGBA uint8, mask đã lấp lỗ) của một thành phần, cắt có đệm"""
    rgb, dist, fg0, lab = info["rgb"], info["dist"], info["fg0"], info["lab"]
    H, W = lab.shape
    x0, y0, x1, y1 = comp["bbox"]
    x0, y0, x1, y1 = max(0, x0 - pad), max(0, y0 - pad), min(W, x1 + pad), min(H, y1 + pad)
    own = (lab[y0:y1, x0:x1] == comp["lab"]) & fg0[y0:y1, x0:x1]
    filled = ndi.binary_fill_holes(own)
    ring = _dilate(filled, 3) & ~filled
    a = np.zeros(filled.shape, np.uint8)
    a[filled] = 255
    a[ring] = np.clip(dist[y0:y1, x0:x1][ring] * 255 / 70, 0, 255).astype(np.uint8)
    out = np.dstack([rgb[y0:y1, x0:x1].astype(np.uint8), a])
    return out, filled


# ------------------------------------------------------------------ phân tích thân
def _stroke_width(mask: np.ndarray) -> float:
    h = mask.shape[0]
    runs = []
    for y in range(int(h * 0.68), int(h * 0.86)):
        row = mask[y].astype(np.int8)
        d = np.diff(np.concatenate([[0], row, [0]]))
        s, e = np.where(d == 1)[0], np.where(d == -1)[0]
        runs += list(e - s)
    return float(np.median(runs)) if runs else 3.0


def _strip_inner_arm(rgba, mask, keep, fig_h, t, D):
    """Góc nghiêng: tay vẽ thành nét dọc nằm TRONG áo. Tìm nét đó + bàn tay, xoá khỏi sprite."""
    interior = cv2.erode(keep.astype(np.uint8), _disk(int(t * 2.2) + 3)).astype(bool)
    ink = (rgba[:, :, :3].astype(int).sum(axis=2) < 200) & (rgba[:, :, 3] > 128)
    cand = ink & interior
    lab, n = ndi.label(cand, structure=np.ones((3, 3)))
    best, bh = None, 0
    for i in range(1, n + 1):
        m = lab == i
        x0, y0, x1, y1 = _bbox(m)
        h, w = y1 - y0, x1 - x0
        if h > 0.16 * fig_h and h > 3.5 * w and h > bh:
            best, bh = m, h
    if best is None:
        return None
    x0, y0, x1, y1 = _bbox(best)
    sx = float(np.where(best[y0])[0].mean())
    # bàn tay: vòng tròn dày nhất quanh đáy nét
    dt = ndi.distance_transform_edt(mask & ~_dilate(keep, 3))
    reg = np.zeros_like(mask)
    ya, yb = max(0, y1 - int(0.1 * fig_h)), min(mask.shape[0], y1 + int(0.12 * fig_h))
    xa, xb = max(0, int(sx) - int(0.12 * fig_h)), min(mask.shape[1], int(sx) + int(0.12 * fig_h))
    reg[ya:yb, xa:xb] = True
    d2 = np.where(reg & mask, dt, 0)
    hy, hx = np.unravel_index(int(np.argmax(d2)), d2.shape)
    hr = float(d2.max())
    fix = _dilate(best, 3)
    yy, xx = np.mgrid[:mask.shape[0], :mask.shape[1]]
    fix |= (xx - hx) ** 2 + (yy - hy) ** 2 <= (hr + 1.5) ** 2
    return {"shoulder": [sx, float(y0)], "hand": [float(hx), float(hy)], "hand_r": hr, "fix": fix}


def analyze_body(rgba: np.ndarray, mask: np.ndarray, view: str, hand_d: float = None) -> dict:
    H, W = mask.shape
    fx0, fy0, fx1, fy1 = _bbox(mask)
    fig_h = fy1 - fy0
    t = max(1.5, _stroke_width(mask[fy0:fy1]))
    D = int(t * 1.3) + 2
    inset = 2
    M = _open(mask, D)
    lab, n = ndi.label(M)
    total = M.sum()
    keep = np.zeros_like(M)
    for i in range(1, n + 1):
        if (lab == i).sum() > 0.04 * max(1, total):
            keep |= lab == i
    if not keep.any():
        keep = _largest(M) if M.any() else mask.copy()
    if view in ("side", "three") and hand_d:
        # bàn tay (vòng tròn) dính vào thân qua nét tay: cắt phần nằm dưới gấu áo
        big = _open(keep, int(hand_d) + 3)
        if big.any():
            keep = keep.copy(); keep[_bbox(big)[3]:] = False
    rows = np.where(keep.any(axis=1))[0]
    top = int(rows.min())
    w = keep.sum(axis=1).astype(float)
    ws = np.convolve(w, np.ones(3) / 3, mode="same")
    lo, hi = top + int(0.12 * fig_h), top + int(0.36 * fig_h)
    band = np.arange(lo, min(hi, H))
    cand = band[ws[band] == ws[band].min()]
    neck_y = int(cand[len(cand) // 2])
    head_m = keep.copy(); head_m[neck_y:] = False
    torso_m = keep.copy(); torso_m[:neck_y] = False
    if not torso_m.any():
        torso_m = keep
    tb = _bbox(torso_m)
    tcx = (tb[0] + tb[2]) / 2
    torso_h = tb[3] - tb[1]
    keep_d = _dilate(keep, 3) & mask
    upper = rgba.copy(); upper[~keep_d, 3] = 0
    # cổ: nét mảnh giữa đáy đầu/tóc và đỉnh áo bị phép mở loại cùng tay chân → giữ lại ở vùng giữa thân
    hb = int(np.where(head_m.any(axis=1))[0].max()) + 1 if head_m.any() else neck_y
    zone = np.zeros_like(mask)
    zy0, zy1 = max(0, hb - 2), min(H, tb[1] + 3)
    if zy1 > zy0:
        zone[zy0:zy1, max(0, int(tcx - 0.22 * (tb[2] - tb[0]))):int(tcx + 0.22 * (tb[2] - tb[0]))] = True
    neck_pix = zone & mask
    upper[neck_pix, 3] = rgba[neck_pix, 3]

    work = mask.copy()
    inner = None
    if view in ("side", "three"):
        inner = _strip_inner_arm(upper, mask, keep, fig_h, t, D)
        if inner is not None:
            fix = inner["fix"]
            inside = fix & _dilate(torso_m, 1)
            # tô lại màu áo ở chỗ xoá, còn ngoài áo thì trong suốt
            bgr = cv2.cvtColor(upper[:, :, :3], cv2.COLOR_RGB2BGR)
            inp = cv2.inpaint(bgr, (inside * 255).astype(np.uint8), 3, cv2.INPAINT_TELEA)
            upper[:, :, :3] = cv2.cvtColor(inp, cv2.COLOR_BGR2RGB)
            upper[fix & ~inside, 3] = 0
            work = mask & ~fix
    torso_only = upper.copy()
    torso_only[:zy0, :, 3] = 0
    if neck_y > zy0:
        band_ = torso_only[zy0:neck_y]
        band_[~zone[zy0:neck_y], 3] = 0

    has_neck, neck_top, neck_box = False, None, None
    if view == "front":
        # cổ thật trong ảnh gốc: khối da (sáng) hẹp nằm giữa cằm và cổ áo, bị tóc/đầu nuốt vào phần đầu
        lum = rgba[:, :, :3].astype(int).sum(axis=2) / 3.0
        sat = rgba[:, :, :3].max(axis=2).astype(int) - rgba[:, :, :3].min(axis=2).astype(int)
        light = mask & (lum > 195) & (sat < 40)
        cx = int(tcx)

        def run(y):
            if not light[y, cx]:
                return None
            l = r = cx
            while l > 0 and light[y, l - 1]: l -= 1
            while r < W - 1 and light[y, r + 1]: r += 1
            return l, r
        W = mask.shape[1]
        tw = max(1, tb[2] - tb[0])
        rng = range(max(1, neck_y - int(0.18 * fig_h)), min(H - 1, neck_y + int(0.18 * fig_h)))
        rows_ = []
        for y in rng:
            r_ = run(y)
            if r_ is not None and (r_[1] - r_[0] + 1) < 0.4 * tw:
                rows_.append((y, r_))
        # nhóm các hàng liên tiếp, lấy nhóm dài nhất = cổ
        groups, cur = [], []
        for y, r_ in rows_:
            if cur and y - cur[-1][0] > 2:
                groups.append(cur); cur = []
            cur.append((y, r_))
        if cur: groups.append(cur)
        if groups:
            g = max(groups, key=len)
            if len(g) >= 0.02 * fig_h:
                wb = float(np.median([r_[1] - r_[0] + 1 for _, r_ in g]))
                ytop, ybot = g[0][0], g[-1][0]
                neck_top = ytop - 2
                half = max(wb / 2 + t * 2 + 2, 0.12 * tw)
                x0n, x1n = int(cx - half), int(cx + half)
                yb = max(neck_y, int(ybot + t * 1.5 + 2))
                reg = np.zeros_like(mask)
                reg[neck_top:yb, x0n:x1n] = True
                sel = reg & mask
                torso_only[sel, 3] = rgba[sel, 3]
                has_neck = True
                neck_box = [float(cx - wb / 2 - t * 1.5 - 2), float(neck_top), float(cx + wb / 2 + t * 1.5 + 2), float(ybot + t * 1.5 + 2)]
    limbs = work & ~_dilate(keep, 3)
    lab, n = ndi.label(limbs, structure=np.ones((3, 3)))
    arms, legs = [], []
    for i in range(1, n + 1):
        m = lab == i
        if m.sum() < 8:
            continue
        x0, y0, x1, y1 = _bbox(m)
        cx = float(np.where(m)[1].mean())
        dt = ndi.distance_transform_edt(np.pad(m, 1))[1:-1, 1:-1]
        iy, ix = np.unravel_index(int(np.argmax(dt)), dt.shape)
        top_rows = np.where(m[y0])[0]
        item = {"top": (float(top_rows.mean()), float(y0)), "bottom": (cx, float(y1)), "cx": cx,
                "bbox": (x0, y0, x1, y1), "maxdt": float(dt.max()), "dtpos": (float(ix), float(iy)), "mask": m}
        if y1 >= fy0 + 0.86 * fig_h and y0 >= tb[1] + 0.4 * torso_h:
            legs.append(item)
        elif y0 >= neck_y - 1 and y1 < fy0 + 0.86 * fig_h and (y1 - y0) > 0.07 * fig_h:
            arms.append(item)
    arms.sort(key=lambda a: a["cx"]); legs.sort(key=lambda a: a["cx"])

    sh_y = tb[1] + 0.2 * torso_h
    shoulders, hands, hand_r = [], [], []
    for a in arms:
        cx_, cy_ = a["top"]
        side = -1 if cx_ < tcx else 1
        sx = cx_ - side * min(0.12 * (tb[2] - tb[0]), 0.25 * abs(cx_ - tcx) + 1) if view != "side" else cx_
        shoulders.append([sx, sh_y]); hands.append(list(a["dtpos"])); hand_r.append(a["maxdt"])
    if inner is not None:
        shoulders.append([inner["shoulder"][0], max(inner["shoulder"][1], sh_y)])
        hands.append(inner["hand"]); hand_r.append(inner["hand_r"])
    if not shoulders:
        xs = [tb[0] + t, tb[2] - t] if view in ("front", "back") else [tcx]
        for sx in xs:
            shoulders.append([sx, sh_y]); hands.append([sx, sh_y + 0.8 * torso_h]); hand_r.append(t * 1.6)
    arm_len = [float(np.hypot(h[0] - s[0], h[1] - s[1])) for s, h in zip(shoulders, hands)]

    hips, feet, shoe, leg_len = [], [], [], []
    for l in legs:
        hx, hy = l["top"]; hy = min(hy - inset, tb[3] - 2)
        x0, y0, x1, y1 = l["bbox"]
        band = l["mask"][max(y0, y1 - max(2, int(0.1 * (y1 - y0)))):y1]
        bxs = np.where(band.any(axis=0))[0]
        shoe_w = float(bxs.max() - bxs.min() + 1) if len(bxs) else t * 3
        shoe_cx = float(bxs.mean()) if len(bxs) else l["cx"]
        shoe_h = max(2.0, float(band.shape[0]))
        hips.append([hx, hy]); feet.append([shoe_cx, y1 - shoe_h * 0.5])
        leg_len.append(float(np.hypot(shoe_cx - hx, y1 - shoe_h * 0.5 - hy)))
        shoe.append({"w": shoe_w, "h": shoe_h, "dx": shoe_cx - l["bottom"][0]})
    if not hips:
        xs = [tcx - 0.2 * (tb[2] - tb[0]), tcx + 0.2 * (tb[2] - tb[0])] if view in ("front", "back") else [tcx]
        for hx in xs:
            hips.append([hx, tb[3] - 3]); feet.append([hx, fy1 - t]); leg_len.append(fy1 - tb[3]); shoe.append({"w": t * 4, "h": t * 2, "dx": 0})
    pix = rgba[limbs][:, :3] if limbs.any() else rgba[mask][:, :3]
    dark = pix[np.argsort(pix.sum(axis=1))[: max(1, len(pix) // 3)]]
    col = np.median(dark, axis=0).astype(int)
    head_b = _bbox(head_m) if head_m.any() else (tb[0], fy0, tb[2], neck_y)
    hm_rows = np.where(head_m.any(axis=1))[0]
    chin_y = int(hm_rows.max()) + 1 if len(hm_rows) else neck_y
    last = head_m[max(0, chin_y - max(2, int(0.08 * (chin_y - fy0)))):chin_y]
    chin_x = float(np.where(last)[1].mean()) if last.any() else (head_b[0] + head_b[2]) / 2
    return {
        "upper_full": upper, "torso_only": torso_only, "t": t, "fig": (fx0, fy0, fx1, fy1), "neck_y": neck_y,
        "head_w": float(head_b[2] - head_b[0]), "head_h": float(chin_y - head_b[1]), "chin": [chin_x, float(chin_y)],
        "torso_bbox": tb, "has_neck": has_neck, "neck_top": neck_top, "neck_box": neck_box, "shoulders": shoulders, "hands": hands, "arm_len": arm_len, "hand_r": hand_r,
        "hips": hips, "feet": feet, "leg_len": leg_len, "shoe": shoe, "line_color": "#%02x%02x%02x" % tuple(col),
        "n_arms": len(shoulders), "n_legs": len(hips),
    }


def analyze_head(rgba: np.ndarray, mask: np.ndarray, t: float) -> dict:
    M = _open(mask, int(t * 1.3) + 2)
    M = _largest(M) if M.any() else mask
    x0, y0, x1, y1 = _bbox(M)
    last = M[max(0, y1 - max(2, int(0.08 * (y1 - y0)))):y1]
    cx = float(np.where(last)[1].mean()) if last.any() else (x0 + x1) / 2
    return {"w": float(x1 - x0), "h": float(y1 - y0), "chin": [cx, float(y1)]}


# ------------------------------------------------------------------ chính
def classify(info: dict) -> dict:
    comps = info["comps"]
    if not comps:
        return {"bodies": [], "heads": []}
    hmax = max(c["bbox"][3] - c["bbox"][1] for c in comps)
    bodies, heads = [], []
    for c in comps:
        h = c["bbox"][3] - c["bbox"][1]
        if h >= 0.62 * hmax:
            bodies.append(c)
        elif h >= 0.12 * hmax:
            heads.append(c)
    bodies.sort(key=lambda c: c["bbox"][0])
    # đầu: gom theo hàng rồi sắp theo x
    heads.sort(key=lambda c: c["bbox"][1])
    rows, cur = [], []
    for c in heads:
        if cur and c["bbox"][1] > cur[-1]["bbox"][1] + 0.5 * (cur[-1]["bbox"][3] - cur[-1]["bbox"][1]):
            rows.append(cur); cur = []
        cur.append(c)
    if cur:
        rows.append(cur)
    heads = [c for r in rows for c in sorted(r, key=lambda c: c["bbox"][0])]
    return {"bodies": bodies, "heads": heads}


def parse_sheet(img: Image.Image, out_dir: str, assign: Optional[dict] = None) -> dict:
    """assign (tuỳ chọn): {"bodies": ["front","three","side","back"], "heads": ["neutral",...]}
    theo thứ tự đã phát hiện (trái→phải, trên→dưới). 'skip' để bỏ qua một thành phần."""
    os.makedirs(out_dir, exist_ok=True)
    info = find_components(img)
    cl = classify(info)
    b_names = (assign or {}).get("bodies") or (VIEWS if len(cl["bodies"]) == 4 else VIEWS[: len(cl["bodies"])])
    h_names = (assign or {}).get("heads") or EXPR[: len(cl["heads"])]
    if len(cl["bodies"]) == 3 and not (assign or {}).get("bodies"):
        b_names = ["front", "side", "back"]
    views, heads = {}, {}
    ref_t, front_info = None, None
    scale_ref_h = None
    analysis = {}
    for c, name in zip(cl["bodies"], b_names):
        if name == "skip":
            continue
        rgba, mask = cut_component(info, c)
        hd = None
        if "front" in analysis and analysis["front"][2]["hand_r"]:
            hd = 2 * float(np.mean(analysis["front"][2]["hand_r"]))
        a = analyze_body(rgba, mask, name, hd)
        analysis[name] = (rgba, mask, a)
    if "front" not in analysis and analysis:
        first = next(iter(analysis))
        analysis["front"] = analysis[first]
    if "front" not in analysis:
        raise ValueError("Không tìm thấy thân nhân vật trong ảnh. Cần ảnh có toàn thân (ít nhất góc chính diện).")
    fa = analysis["front"][2]
    ref_t = fa["t"]
    front_h = fa["fig"][3] - fa["fig"][1]
    for name, (rgba, mask, a) in analysis.items():
        fh = a["fig"][3] - a["fig"][1]
        scale = front_h / fh if fh else 1.0
        up = f"{name}_full.png"
        Image.fromarray(a["upper_full"]).save(os.path.join(out_dir, up))
        v = {"full": up, "w": rgba.shape[1], "h": rgba.shape[0], "scale": scale,
             "shoulders": a["shoulders"], "hands": a["hands"], "arm_len": a["arm_len"], "hand_r": a["hand_r"],
             "hips": a["hips"], "feet": a["feet"], "leg_len": a["leg_len"], "shoe": a["shoe"],
             "neck_y": a["neck_y"], "torso_top": float(a["neck_top"] if a["neck_top"] is not None else a["torso_bbox"][1]), "has_neck": bool(a["has_neck"]), "neck_box": a["neck_box"], "chin": a["chin"], "head_w": a["head_w"], "head_h": a["head_h"],
             "feet_y": float(a["fig"][3]), "top_y": float(a["fig"][1]), "n_arms": a["n_arms"], "n_legs": a["n_legs"]}
        if name == "front":
            Image.fromarray(a["torso_only"]).save(os.path.join(out_dir, "front_torso.png"))
            v["torso"] = "front_torso.png"
        views[name] = v
    for c, name in zip(cl["heads"], h_names):
        if name == "skip":
            continue
        rgba, mask = cut_component(info, c)
        h = analyze_head(rgba, mask, ref_t)
        fn = f"head_{name}.png"
        Image.fromarray(rgba).save(os.path.join(out_dir, fn))
        heads[name] = {"img": fn, "w": rgba.shape[1], "h": rgba.shape[0], **h}
    # tỉ lệ đầu biểu cảm → đầu trên thân
    head_scale = None
    if "neutral" in heads and fa["head_w"] > 0:
        head_scale = fa["head_w"] / heads["neutral"]["w"]
    elif heads:
        k = next(iter(heads))
        head_scale = fa["head_w"] / heads[k]["w"]
    rig = {
        "views": views, "heads": heads, "head_scale": head_scale,
        "style": {"stroke": ref_t, "line_color": fa["line_color"], "hand_fill": "#ffffff",
                  "shoe_color": "#141414", "side_faces": "right"},
        "ref_height": float(front_h),
        "detected": {"bodies": len(cl["bodies"]), "heads": len(cl["heads"]),
                     "body_names": b_names, "head_names": h_names},
    }
    with open(os.path.join(out_dir, "rig.json"), "w") as f:
        json.dump(rig, f, ensure_ascii=False, indent=1)
    _debug_overlay(out_dir, rig)
    return rig


def _debug_overlay(out_dir: str, rig: dict):
    tiles = []
    for name, v in rig["views"].items():
        im = Image.open(os.path.join(out_dir, v["full"])).convert("RGBA")
        bg = Image.new("RGBA", im.size, (235, 235, 235, 255))
        bg.alpha_composite(im)
        a = np.array(bg.convert("RGB"))
        s = 3
        a = cv2.resize(a, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC)
        for p in v["shoulders"]:
            cv2.circle(a, (int(p[0] * s), int(p[1] * s)), 5, (0, 0, 255), -1)
        for p in v["hips"]:
            cv2.circle(a, (int(p[0] * s), int(p[1] * s)), 5, (255, 0, 0), -1)
        cv2.circle(a, (int(v["chin"][0] * s), int(v["chin"][1] * s)), 5, (0, 160, 0), -1)
        cv2.line(a, (0, int(v["neck_y"] * s)), (a.shape[1], int(v["neck_y"] * s)), (0, 160, 0), 1)
        tiles.append(a)
    if tiles:
        h = max(t.shape[0] for t in tiles)
        canvas = np.full((h, sum(t.shape[1] for t in tiles), 3), 255, np.uint8)
        x = 0
        for t in tiles:
            canvas[: t.shape[0], x:x + t.shape[1]] = t
            x += t.shape[1]
        Image.fromarray(canvas).save(os.path.join(out_dir, "debug.png"))
