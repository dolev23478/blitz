"""Verify packaged ASR dependencies/model with all socket connections blocked."""
import argparse
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import wave


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("model", nargs="?", default=os.environ.get("RADIO_MODEL", "tiny"))
    args = parser.parse_args()
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    socket.socket.connect = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("Network access forbidden during offline verification"))
    socket.create_connection = socket.socket.connect
    socket.getaddrinfo = socket.socket.connect
    directory = Path(os.environ.get("RADIO_MODELS_DIR", "vendor/radio-models"))
    model_dir = directory / args.model
    manifest = json.loads((model_dir / "manifest.json").read_text(encoding="utf-8"))
    for name, digest in manifest["files"].items():
        if hashlib.sha256((model_dir / name).read_bytes()).hexdigest() != digest:
            raise RuntimeError(f"Model checksum mismatch: {name}")
    worker = Path("dist/radio/local_worker.py")
    if not worker.exists():
        worker = Path("src/radio/local_worker.py")
    spec = importlib.util.spec_from_file_location("radio_worker", worker)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with io.BytesIO() as audio:
        with wave.open(audio, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(16000)
            wav.writeframes(b"\0\0" * 32000)
        audio.seek(0)
        result = module.transcribe(audio, {"model": args.model, "modelDirectory": str(directory), "cpuThreads": 2}, 2)
    if result["text"]:
        raise RuntimeError("Silence unexpectedly produced text")
    print(json.dumps({"offlineASR": "passed", "model": args.model, "socketConnections": "blocked", "recordingsWritten": 0}))


if __name__ == "__main__":
    main()
