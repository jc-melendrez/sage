#!/usr/bin/env python3
"""
Generate the Android themed-icon (monochrome) layer from the adaptive foreground.

Android 13+ lets the user pick a themed app icon. The system takes the
`monochromeImage` from app.config.js `android.adaptiveIcon`, recolours it with the
user's wallpaper accent, and paints it over a flat themed background. Only the
*alpha* channel of that drawable matters -- every pixel is overwritten by the
tint. So the layer has to be a single-colour silhouette: feeding it the
full-colour foreground instead (which is what this file replaces) works, but the
tint then lands on anti-aliased edges between the sheep's cream, peach and blue
and the result reads as a dirty smear rather than a clean shape.

This script writes:

  assets/images/android-icon-monochrome.png

The source of truth for the silhouette is the foreground's alpha channel:

  assets/images/android-icon-foreground.png

The output is RGBA with every opaque pixel pure white, keeping the foreground's
exact alpha so prebuild's density downscaling produces the same soft edges in
every mipmap bucket.

Re-run this after changing the foreground:

    python scripts/generate-icon-monochrome.py

Requires Pillow: `pip install pillow`.

Native drawables are NOT written by this script. `npx expo prebuild` regenerates
the mipmap buckets from this PNG; re-run prebuild afterwards for it to take
effect (unlike the splash wordmark, the monochrome layer has no transparent-
background problem that needs undoing -- see scripts/generate-splash.py).
"""

from __future__ import annotations

import os
import sys

try:
    from PIL import Image
except ImportError:  # pragma: no cover - dependency guidance
    sys.exit("Pillow is required to generate the monochrome layer: pip install pillow")

HERE = os.path.dirname(os.path.abspath(__file__))
APP_ROOT = os.path.dirname(HERE)
IMAGES_DIR = os.path.join(APP_ROOT, "assets", "images")

SOURCE = os.path.join(IMAGES_DIR, "android-icon-foreground.png")
OUTPUT = os.path.join(IMAGES_DIR, "android-icon-monochrome.png")

# The tint colour is irrelevant to the system (it recolours every pixel), so pure
# white is used: it is the documented convention and keeps the file honest about
# carrying no colour information at all.
TINT = (255, 255, 255, 255)


def main() -> None:
    if not os.path.exists(SOURCE):
        sys.exit(f"Foreground not found: {SOURCE}\nRun `npx expo prebuild` first.")

    foreground = Image.open(SOURCE)
    if foreground.mode != "RGBA":
        foreground = foreground.convert("RGBA")

    # Keep the source alpha verbatim; only the colour channels are replaced.
    silhouette = Image.new("RGBA", foreground.size, TINT)
    silhouette.putalpha(foreground.getchannel("A"))

    silhouette.save(OUTPUT, "PNG", optimize=True)

    alpha = foreground.getchannel("A")
    bbox = alpha.getbbox()
    covered = sum(1 for value in alpha.getdata() if value > 0)
    total = foreground.size[0] * foreground.size[1]

    print(f"foreground  {foreground.size[0]}x{foreground.size[1]}px")
    print(f"silhouette  {os.path.relpath(OUTPUT, APP_ROOT)}")
    print(f"ink coverage {covered}/{total} = {covered / total:.1%}")
    print(f"ink bbox      {bbox}")
    print("\nDone. Next: npx expo prebuild --platform android")


if __name__ == "__main__":
    main()