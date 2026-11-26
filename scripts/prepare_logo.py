"""Logo vorbereiten: weißen Hintergrund transparent machen und auf den Inhalt zuschneiden.

Aufruf:  python3 scripts/prepare_logo.py <logo-datei.png|jpg>
Ergebnis: src/assets/multivac_logo.png
"""
import sys
from PIL import Image

src = sys.argv[1]
img = Image.open(src).convert("RGBA")
px = img.load()
w, h = img.size
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        lum = min(r, g, b)
        if lum > 235:  # nahezu weiß → transparent, weicher Übergang an Kanten
            px[x, y] = (r, g, b, int(a * max(0, 255 - lum) / 20))
bbox = img.getbbox()
img.crop(bbox).save("src/assets/multivac_logo.png")
print("gespeichert: src/assets/multivac_logo.png", img.crop(bbox).size)
