#!/usr/bin/env python3
"""Puente entre el pipeline Node y edge-tts.

Sintetiza un texto con la voz indicada y devuelve audio MP3 más los límites de
palabra reales que emite el servicio (offset y duración en unidades de 100 ns).
"""

import argparse
import asyncio
import json
import sys

import edge_tts


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sintetiza texto con edge-tts y exporta word boundaries.")
    parser.add_argument("--text-file", required=True)
    parser.add_argument("--voice", required=True)
    parser.add_argument("--out", required=True, help="Ruta del MP3 de salida")
    parser.add_argument("--words", required=True, help="Ruta del JSON de word boundaries")
    parser.add_argument("--rate", default="+0%")
    parser.add_argument("--pitch", default="+0Hz")
    parser.add_argument("--volume", default="+0%")
    return parser.parse_args()


async def synthesize(args: argparse.Namespace) -> int:
    with open(args.text_file, encoding="utf-8") as handle:
        text = handle.read().strip()
    if not text:
        print("Texto vacío", file=sys.stderr)
        return 2

    communicate = edge_tts.Communicate(
        text,
        args.voice,
        rate=args.rate,
        pitch=args.pitch,
        volume=args.volume,
        boundary="WordBoundary",
    )

    words: list[dict] = []
    with open(args.out, "wb") as audio:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                words.append(
                    {
                        "text": chunk["text"],
                        "offset": chunk["offset"],
                        "duration": chunk["duration"],
                    }
                )

    with open(args.words, "w", encoding="utf-8") as handle:
        json.dump(words, handle, ensure_ascii=False)
    return 0


def main() -> int:
    args = parse_args()
    try:
        return asyncio.run(synthesize(args))
    except Exception as error:  # noqa: BLE001 - se reporta tal cual al pipeline
        print(f"edge-tts: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
