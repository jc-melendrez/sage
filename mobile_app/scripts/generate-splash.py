#!/usr/bin/env python3
"""
Generate the SAGE splash wordmark assets.

Renders the word "Sage" in Montserrat ExtraBold -- the same family and weight the
app already loads at runtime (constants/theme.ts `fontFamily.extraBold`) -- and
writes it to:

  1. assets/images/splash-icon.png          (source of truth for `npx expo prebuild`)
  2. android/app/src/main/res/drawable-*/splashscreen_logo.png  (committed native
     drawables, used by `gradlew assembleRelease` without a prebuild)

Re-run this after changing the wordmark, the font, or the colours.

WHY THE ANDROID SIZE IS SMALLER THAN THE IOS SIZE
-------------------------------------------------
Android 12+ treats `windowSplashScreenAnimatedIcon` as an app icon: the drawable
is fitted into a 240dp window and then masked to a circle covering the inner
2/3 of that window (160dp). Android's own guidance is that nothing important
may sit outside that circle, because it gets clipped away.

The generated drawables keep the same 288dp-square canvas and the same
"centre a `imageWidth` box in it" composition that
@expo/prebuild-config's withAndroidSplashImages.js performs, so a future
`npx expo prebuild` stays consistent with what ships here. What differs is
`imageWidth`, which is derived below so the wordmark's corners stay inside that
160dp circle. `imageWidth` for Android therefore has to be ~169 rather than the
200 used on iOS, where no mask is applied.

Note that `prebuild` regenerates the native drawables with the *background
colour baked in* (it fills the 288dp canvas with backgroundColor before
compositing), which makes dark mode show a purple block behind the wordmark.
These assets deliberately keep a transparent background instead, so the wordmark
sits directly on the night-aware `windowSplashScreenBackground` colour. If you
ever re-run `prebuild`, re-run this script to restore the transparent version.

Requires Pillow: `pip install pillow`. Reads the font straight out of
node_modules, so there is no second copy of Montserrat in the repo.
"""

from __future__ import annotations

import math
import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # pragma: no cover - dependency guidance
    sys.exit("Pillow is required to generate the splash assets: pip install pillow")

HERE = os.path.dirname(os.path.abspath(__file__))
APP_ROOT = os.path.dirname(HERE)

FONT_PATH = os.path.join(
    APP_ROOT,
    "node_modules",
    "@expo-google-fonts",
    "montserrat",
    "800ExtraBold",
    "Montserrat_800ExtraBold.ttf",
)

WORDMARK = "Sage"
WORDMARK_COLOR = (255, 255, 255, 255)

# Render size of the source glyphs. Large enough that the downscale into the
# density buckets stays sharp without an absurd intermediate buffer.
RENDER_FONT_SIZE = 512

# Letter spacing as a fraction of the font size. Montserrat is a wide geometric
#sans; a hair of positive tracking makes the wordmark read as a logotype rather
# than as a line of UI text.
LETTER_SPACING_EM = 0.015

IOS_IMAGE_WIDTH = 200

# Android geometry, mirroring withAndroidSplashImages.js.
ANDROID_CANVAS_DP = 288          # square canvas the plugin draws
ANDROID_MASK_FRACTION = 2 / 3    # icon window masked to its inner 2/3 (160/240dp)

# Keep the wordmark off the edge of the mask circle rather than tangent to it.
ANDROID_MASK_MARGIN = 0.94

DENSITY_MULTIPLIERS = {
    "mdpi": 1,
    "hdpi": 1.5,
    "xhdpi": 2,
    "xxhdpi": 3,
    "xxxhdpi": 4,
}


def max_android_image_width(aspect: float) -> int:
    """Largest `imageWidth` whose wordmark corners stay inside the mask circle.

    The plugin fits the wordmark into an `imageWidth` square, so for a wordmark
    of aspect ratio `a` (width/height, > 1) the rendered size is
    (imageWidth, imageWidth / a). Requiring its corner
    distance from the canvas centre to fall within the mask radius r gives

        imageWidth / 2 * sqrt(1 + 1/a**2)  <=  r

    and r is 288dp * 2/3 / 2 = 96dp.
    """
    mask_radius_dp = ANDROID_CANVAS_DP * ANDROID_MASK_FRACTION / 2
    corner_factor = math.sqrt(1 + 1 / aspect**2)
    return int(mask_radius_dp * 2 / corner_factor * ANDROID_MASK_MARGIN)


def render_wordmark() -> Image.Image:
    """Render "Sage" with manual letter spacing and crop to its ink bounds."""
    if not os.path.exists(FONT_PATH):
        sys.exit(f"Font not found: {FONT_PATH}\nRun `npm install` in mobile_app first.")

    font = ImageFont.truetype(FONT_PATH, RENDER_FONT_SIZE)
    spacing = LETTER_SPACING_EM * RENDER_FONT_SIZE

    advances = [font.getlength(char) for char in WORDMARK]
    total_width = sum(advances) + spacing * (len(WORDMARK) - 1)

    ascent, descent = font.getmetrics()
    pad = math.ceil(spacing + RENDER_FONT_SIZE * 0.1)
    canvas = Image.new(
        "RGBA",
        (math.ceil(total_width) + pad * 2, ascent + descent + pad * 2),
        (0, 0, 0, 0),
    )
    draw = ImageDraw.Draw(canvas)

    # Draw on the alphabetic baseline so the 'g' descender is not clipped and
    # letters stay on one shared baseline.
    x = float(pad)
    for char, advance in zip(WORDMARK, advances):
        draw.text((x, pad + ascent), char, font=font, fill=WORDMARK_COLOR, anchor="ls")
        x += advance + spacing

    return canvas.crop(canvas.getbbox())


def main() -> None:
    wordmark = render_wordmark()
    width, height = wordmark.size
    aspect = width / height
    android_width = max_android_image_width(aspect)

    source_path = os.path.join(APP_ROOT, "assets", "images", "splash-icon.png")
    wordmark.save(source_path, "PNG", optimize=True)

    print(f"wordmark            {width}x{height}px  aspect {aspect:.3f}")
    print(f"source              {os.path.relpath(source_path, APP_ROOT)}")
    print(f"android imageWidth  {android_width}dp  (mask-limited)")
    print(f"ios     imageWidth  {IOS_IMAGE_WIDTH}dp")

    res_root = os.path.join(APP_ROOT, "android", "app", "src", "main", "res")

    for density, multiplier in DENSITY_MULTIPLIERS.items():
        canvas_size = round(ANDROID_CANVAS_DP * multiplier)
        logo_width = round(android_width * multiplier)
        logo_height = max(1, round(logo_width / aspect))

        # Transparent background: the theme's windowSplashScreenBackground
        # provides the (night-aware) colour behind the wordmark.
        canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
        resized = wordmark.resize((logo_width, logo_height), Image.LANCZOS)
        canvas.alpha_composite(
            resized,
            ((canvas_size - logo_width) // 2, (canvas_size - logo_height) // 2),
        )

        out_dir = os.path.join(res_root, f"drawable-{density}")
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, "splashscreen_logo.png")
        canvas.save(out_path, "PNG", optimize=True)
        print(
            f"  drawable-{density:<8} {canvas_size}x{canvas_size}px "
            f"(wordmark {logo_width}x{logo_height}px)"
        )

    print("\nDone. Next: npx expo prebuild  (or ./gradlew.bat assembleRelease)")


if __name__ == "__main__":
    main()