"""Generate 2 synthetic 'photographed' paper stock registers (PIL) + ground-truth extraction JSON.
Run:  python3 scripts/generate_registers.py     (deterministic, seed 42)"""
import json, math, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

random.seed(42)
W, H = 900, 1180
ROW_H, TOP, LEFT = 74, 250, 50
COLS = [("Medicine", 50, 330), ("Opening", 330, 480), ("Received", 480, 630), ("Issued", 630, 760), ("Balance", 760, 860)]
ANGLE = {"register_1": -2.6, "register_2": 3.1}

REGS = [
    {"id": "register_1", "phc": "D4-P2", "title": "Shivgarh PHC-2  |  Stock Register  |  June",
     "rows": [("Paracetamol", 180, 0, 118, 62), ("ORS", 140, 0, 104, 36), ("Amoxicillin", 260, 100, 218, 142),
              ("Insulin", 20, 0, 9, 11), ("Iron+Folic", 400, 0, 190, 210)]},
    {"id": "register_2", "phc": "D7-P3", "title": "Jalgaon Khas PHC-3  |  Stock Register  |  June",
     "rows": [("Paracetamol", 150, 90, 160, 80), ("ORS", 100, 60, 70, 90), ("Antimalarial", 60, 0, 34, 26),
              ("Azithromycin", 90, 0, 41, 49), ("Oxytocin", 12, 0, 5, 7)]},
]
MED_ID = {"Paracetamol": "Paracetamol", "ORS": "ORS", "Amoxicillin": "Amoxicillin", "Insulin": "Insulin",
          "Iron+Folic": "Iron+folic acid", "Antimalarial": "Antimalarial", "Azithromycin": "Azithromycin", "Oxytocin": "Oxytocin"}

def font(sz):
    try:
        return ImageFont.load_default(size=sz)
    except TypeError:
        return ImageFont.load_default()

def make(reg):
    img = Image.new("RGB", (W, H), (236, 228, 206))
    px = img.load()
    for _ in range(90000):  # paper grain
        x, y = random.randrange(W), random.randrange(H)
        v = random.randint(-14, 8)
        r, g, b = px[x, y]
        px[x, y] = (r + v, g + v, b + v)
    d = ImageDraw.Draw(img)
    d.text((LEFT, 60), reg["title"], fill=(30, 30, 90), font=font(30))
    d.text((LEFT, 110), "Govt. of Demo Pradesh - Dept of Health & Family Welfare", fill=(90, 90, 110), font=font(18))
    d.line([(LEFT, 150), (W - LEFT, 150)], fill=(40, 40, 110), width=3)
    for name, x0, x1 in COLS:
        d.text((x0 + 8, TOP - 48), name, fill=(20, 20, 80), font=font(24))
    n = len(reg["rows"])
    y_end = TOP + n * ROW_H
    for r in range(n + 1):
        y = TOP + r * ROW_H + random.randint(-2, 2)
        d.line([(LEFT, y), (W - 40, y + random.randint(-3, 3))], fill=(70, 70, 150), width=2)
    for name, x0, x1 in COLS + [("", 860, 860)]:
        d.line([(x0 - 6, TOP - 60), (x0 - 6 + random.randint(-2, 2), y_end)], fill=(70, 70, 150), width=2)
    rows_out = []
    for i, (med, op, rc, iss, bal) in enumerate(reg["rows"]):
        y = TOP + i * ROW_H
        vals = [med, str(op), str(rc) if rc else "-", str(iss), str(bal)]
        for (name, x0, x1), v in zip(COLS, vals):
            d.text((x0 + 8 + random.randint(-3, 3), y + 18 + random.randint(-4, 4)), v, fill=(25, 25, 60), font=font(32))
        rows_out.append({"medicine": MED_ID[med], "opening": op, "received": rc, "issued": iss, "balance": bal, "_rect": (LEFT, y, W - 40, y + ROW_H)})
    d.text((LEFT, y_end + 40), "Verified: M.O. i/c ______   Date: __/06", fill=(60, 60, 100), font=font(22))
    # desk background + rotation (photographed at an angle)
    ang = ANGLE[reg["id"]]
    rot = img.rotate(ang, expand=True, resample=Image.BICUBIC, fillcolor=(58, 52, 48))
    RW, RH = rot.size
    th = math.radians(ang)
    def tf(x, y):
        cx, cy, ncx, ncy = W / 2, H / 2, RW / 2, RH / 2
        return (ncx + (x - cx) * math.cos(th) + (y - cy) * math.sin(th), ncy - (x - cx) * math.sin(th) + (y - cy) * math.cos(th))
    for row in rows_out:
        x0, y0, x1, y1 = row.pop("_rect")
        pts = [tf(x0, y0), tf(x1, y0), tf(x1, y1), tf(x0, y1)]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        row["bbox"] = [round(100 * min(xs) / RW, 2), round(100 * min(ys) / RH, 2), round(100 * (max(xs) - min(xs)) / RW, 2), round(100 * (max(ys) - min(ys)) / RH, 2)]
    # vignette + blur + noise
    vign = Image.new("L", rot.size, 0)
    vd = ImageDraw.Draw(vign)
    for k in range(60):
        vd.ellipse([k * 6 - 200, k * 8 - 250, RW + 200 - k * 6, RH + 250 - k * 8], outline=int(k * 1.3))
    rot = Image.composite(rot, Image.new("RGB", rot.size, (20, 18, 16)), vign.filter(ImageFilter.GaussianBlur(40)).point(lambda v: 150 + v * 0.4))
    rot = rot.filter(ImageFilter.GaussianBlur(0.7))
    rot.save(f"public/registers/{reg['id']}.png")
    return {"id": reg["id"], "phc": reg["phc"], "title": reg["title"], "image": f"/registers/{reg['id']}.png", "rows": rows_out}

json.dump([make(r) for r in REGS], open("src/data/registers.json", "w"), indent=1)
print("ok")
