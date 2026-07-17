#!/usr/bin/env python3
"""Free local speech-to-text adapter. Emits JSON only; never invents text."""
import argparse
import json
import os

os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

try:
    from faster_whisper import WhisperModel
except ImportError:
    WhisperModel = None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", nargs="?")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--language", default="auto")
    parser.add_argument("--model", default=os.getenv("WHISPER_MODEL", "tiny"))
    args = parser.parse_args()
    if args.check:
        if WhisperModel is None:
            raise SystemExit(1)
        return
    if WhisperModel is None:
        print(json.dumps({"status": "unavailable", "reason": "faster-whisper no está instalado"}, ensure_ascii=False))
        return
    if not args.audio:
        print(json.dumps({"status": "unavailable", "reason": "falta el archivo de audio"}, ensure_ascii=False))
        return
    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    kwargs = {"vad_filter": True, "beam_size": 5}
    if args.language != "auto":
        kwargs["language"] = args.language
    segments, info = model.transcribe(args.audio, **kwargs)
    rows = []
    for segment in segments:
        text = segment.text.strip()
        if text:
            rows.append({"start": round(segment.start, 2), "end": round(segment.end, 2), "text": text})
    text = " ".join(row["text"] for row in rows).strip()
    print(json.dumps({"status": "available" if text else "empty", "text": text or None, "language": getattr(info, "language", None), "model": args.model, "segments": rows}, ensure_ascii=False))


if __name__ == "__main__":
    main()
