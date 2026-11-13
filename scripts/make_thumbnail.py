#!/usr/bin/env python3
"""
Genera miniatura 1280x720 para YouTube usando ANTON con itálica artificial (shear),
igual que el pipeline de RecetaVideo. Usa Pillow para renderizar texto con:
- ANTON Regular (único peso disponible)
- Shear transform 0.20 para itálica artificial
- Stroke/outline negro
- Posicionamiento inteligente (arriba/abajo según detalle de imagen)
"""

import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps, ImageStat

# ─── Configuración de miniatura ──────────────────────────────────────────────
THUMB_W, THUMB_H = 1280, 720
THUMB_MARGIN_X = 56
THUMB_PADDING_Y = 32
THUMB_OUTLINE_RATIO = 0.12   # Contorno ~12% del tamaño de fuente
THUMB_ITALIC_SHEAR = 0.20    # Shear para itálica artificial (~11°)
THUMB_MAX_FONT = 240
THUMB_MIN_FONT = 16
THUMB_MIN_READABLE = 40


def _font(font_path: Path, size: int) -> ImageFont.FreeTypeFont:
    if font_path.exists():
        return ImageFont.truetype(str(font_path), size)
    # Fallbacks
    for candidate in (
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ):
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def _wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    words = re.sub(r"\s+", " ", text).strip().split()
    if not words:
        return [""]
    lines: list[str] = []
    current = ""
    for word in words:
        test = (current + " " + word).strip()
        if draw.textlength(test, font=font) <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def _fit_thumbnail_title(text: str, max_width: int, font_path: Path) -> tuple[ImageFont.FreeTypeFont, int, tuple[int, int, int, int]]:
    """Busca el mayor tamaño que quepa en una línea, contorno incluido."""
    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    for size in range(THUMB_MAX_FONT, THUMB_MIN_FONT - 1, -2):
        font = _font(font_path, size)
        stroke = max(2, round(size * THUMB_OUTLINE_RATIO))
        bbox = probe.textbbox((0, 0), text, font=font, stroke_width=stroke)
        width = bbox[2] - bbox[0]
        height = bbox[3] - bbox[1]
        # Considerar el shear en el ancho efectivo
        if width + THUMB_ITALIC_SHEAR * height <= max_width:
            return font, stroke, bbox
    font = _font(font_path, THUMB_MIN_FONT)
    stroke = max(2, round(THUMB_MIN_FONT * THUMB_OUTLINE_RATIO))
    return font, stroke, probe.textbbox((0, 0), text, font=font, stroke_width=stroke)


def _thumbnail_text_layer(text: str, font: ImageFont.FreeTypeFont, stroke: int) -> Image.Image:
    """Texto blanco con contorno negro, inclinado como una itálica (shear)."""
    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    bbox = probe.textbbox((0, 0), text, font=font, stroke_width=stroke)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    pad_y = stroke + 12
    height = text_h + pad_y * 2
    pad_x = int(THUMB_ITALIC_SHEAR * height) + stroke * 2 + 24
    width = text_w + pad_x * 2

    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.text(
        (pad_x - bbox[0], pad_y - bbox[1]),
        text,
        font=font,
        fill=(255, 255, 255, 255),
        stroke_width=stroke,
        stroke_fill=(0, 0, 0, 255),
    )
    # Aplicar shear (itálica artificial)
    layer = layer.transform(
        (width, height),
        Image.AFFINE,
        (1, THUMB_ITALIC_SHEAR, -THUMB_ITALIC_SHEAR * height, 0, 1, 0),
        resample=Image.Resampling.BICUBIC,
    )
    content = layer.getbbox()
    return layer.crop(content) if content else layer


def _thumbnail_detail(image: Image.Image, box: tuple[int, int, int, int]) -> float:
    """Cantidad de detalle (bordes) en una franja de la imagen."""
    band = image.crop(box).convert("L")
    band = band.resize((96, max(8, band.height // 6)), Image.Resampling.BILINEAR)
    edges = band.filter(ImageFilter.FIND_EDGES)
    return float(ImageStat.Stat(edges).mean[0])


def _thumbnail_y(image: Image.Image, text_height: int) -> int:
    """Coloca el título arriba o abajo según qué zona tenga menos detalle."""
    band_height = min(image.height, text_height + THUMB_PADDING_Y * 2)
    top_score = _thumbnail_detail(image, (0, 0, image.width, band_height))
    bottom_score = _thumbnail_detail(
        image, (0, image.height - band_height, image.width, image.height)
    )
    if bottom_score <= top_score:
        return image.height - THUMB_PADDING_Y - text_height
    return THUMB_PADDING_Y


def make_thumbnail(
    source_image_path: str,
    title: str,
    output_path: str,
    font_path: str,
    project_root: str,
) -> None:
    """Genera la miniatura final."""
    # Cargar y ajustar imagen a 1280x720
    with Image.open(source_image_path) as src:
        image = ImageOps.fit(
            src.convert("RGB"),
            (THUMB_W, THUMB_H),
            method=Image.Resampling.LANCZOS,
        )

    # Preparar título (mayúsculas, limpio)
    full_title = re.sub(r"\s+", " ", title).strip().upper()
    if not full_title:
        full_title = "RECETA"

    # Ajustar fuente para que quepa en una línea
    font_path_obj = Path(font_path)
    font, stroke, _ = _fit_thumbnail_title(full_title, THUMB_W - THUMB_MARGIN_X * 2, font_path_obj)

    # Si queda muy pequeño, intentar abreviar
    if font.size < THUMB_MIN_READABLE:
        short_candidates = [
            full_title.split(". ")[0].strip(),
            full_title.split(" (")[0].strip(),
        ]
        for candidate in short_candidates:
            if not candidate or candidate == full_title:
                continue
            f, s, _ = _fit_thumbnail_title(candidate, THUMB_W - THUMB_MARGIN_X * 2, font_path_obj)
            if f.size > font.size:
                full_title, font, stroke = candidate, f, s
            if font.size >= THUMB_MIN_READABLE:
                break

    # Crear capa de texto con itálica artificial
    layer = _thumbnail_text_layer(full_title, font, stroke)

    # Posicionar (arriba o abajo según detalle)
    y = _thumbnail_y(image, layer.height)
    x = (THUMB_W - layer.width) // 2

    # Componer
    image.paste(layer, (x, y), layer)

    # Guardar
    image.save(output_path, "JPEG", quality=93, optimize=True)
    print(f"✓ Miniatura generada: {output_path} ({THUMB_W}x{THUMB_H})")


if __name__ == "__main__":
    if len(sys.argv) < 6:
        print("Uso: python make_thumbnail.py <source_image> <title> <output> <font_path> <project_root>")
        sys.exit(1)

    source_image = sys.argv[1]
    title = sys.argv[2]
    output = sys.argv[3]
    font_path = sys.argv[4]
    project_root = sys.argv[5]

    make_thumbnail(source_image, title, output, font_path, project_root)