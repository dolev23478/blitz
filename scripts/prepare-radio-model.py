"""Run on the connected build machine; runtime never downloads models."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("model", nargs="?", default="tiny", choices=["tiny", "base", "small", "medium", "large-v3", "turbo"])
    args = parser.parse_args()
    root = Path.cwd().resolve()
    target = root / "vendor" / "radio-models" / args.model
    cache = root / ".radio" / "models"
    os.environ["HF_HOME"] = str(cache)
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    from faster_whisper.utils import download_model
    from huggingface_hub.errors import LocalEntryNotFoundError

    try:
        source = Path(download_model(args.model, cache_dir=str(cache), local_files_only=True))
        shutil.copytree(source, target, dirs_exist_ok=True, symlinks=False)
    except LocalEntryNotFoundError:
        download_model(args.model, output_dir=str(target), cache_dir=str(cache))
    required = ("model.bin", "config.json", "tokenizer.json", "vocabulary.txt")
    if not all((target / name).is_file() for name in required):
        raise RuntimeError("Downloaded model is incomplete; do not deploy this bundle.")
    manifest = {
        "model": args.model,
        "files": {name: hashlib.sha256((target / name).read_bytes()).hexdigest() for name in required},
    }
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Prepared local model: {target}")


if __name__ == "__main__":
    main()
