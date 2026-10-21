"""Bounded public HTTP audio capture + local ASR. JSON stdin/stdout; errors on stderr."""
import io
import json
import sys
import wave
from datetime import datetime, timezone
from urllib.parse import urlsplit

import av

SAMPLE_RATE = 16000


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def capture(url, seconds):
    remaining = seconds * SAMPLE_RATE
    written = 0
    started = None
    resampler = av.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)
    audio = io.BytesIO()
    with wave.open(audio, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)

        def write_frames(frames):
            nonlocal remaining, written, started
            for mono in frames:
                samples = mono.to_ndarray().reshape(-1)[:remaining]
                if samples.size and started is None:
                    started = utc_now()
                output.writeframes(samples.astype("<i2").tobytes())
                written += samples.size
                remaining -= samples.size
                if remaining <= 0:
                    break

        # HLS probing and TLS handshakes can exceed 10s on otherwise healthy feeds.
        # Keep opening bounded separately from stalled reads and the whole job.
        with av.open(url, timeout=(20, 15), options={
            "protocol_whitelist": "http,https,tcp,tls,crypto,httpproxy",
            "rw_timeout": "15000000",
            "user_agent": "BlitzRadio/1.0",
        }) as source:
            for frame in source.decode(audio=0):
                write_frames(resampler.resample(frame))
                if remaining <= 0:
                    break
            if remaining > 0:
                write_frames(resampler.resample(None))
    if written < SAMPLE_RATE // 10:
        raise ValueError("Stream did not provide enough audio")
    audio.seek(0)
    return started, utc_now(), written / SAMPLE_RATE, audio


def transcribe(audio, request, duration):
    from faster_whisper import WhisperModel
    from faster_whisper.utils import download_model
    from huggingface_hub.errors import LocalEntryNotFoundError

    # An already downloaded model must work without contacting the model hub.
    try:
        model_path = download_model(request["model"], cache_dir=request["modelCache"], local_files_only=True)
    except LocalEntryNotFoundError:
        model_path = download_model(request["model"], cache_dir=request["modelCache"])
    model = WhisperModel(model_path, device="cpu", compute_type="int8", cpu_threads=request["cpuThreads"])
    segments, info = model.transcribe(
        audio, language=request.get("language"), task="transcribe",
        vad_filter=True, condition_on_previous_text=False, beam_size=5,
    )
    transcript = []
    for segment in segments:
        text = segment.text.strip()
        start, end = max(0, segment.start), min(duration, segment.end)
        if text and start < end:
            transcript.append({"start": start, "end": end, "text": text})
        if len(transcript) > 1000:
            raise ValueError("Too many transcription segments")
    return {
        "text": " ".join(segment["text"] for segment in transcript),
        "language": info.language if transcript else "unknown",
        "segments": transcript,
    }


def main():
    request = json.loads(sys.stdin.read(65536))
    seconds = request["seconds"]
    if type(seconds) is not int or not 1 <= seconds <= 300:
        raise ValueError("Invalid capture duration")
    url = urlsplit(request["streamUrl"])
    if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password:
        raise ValueError("Only public HTTP(S) audio streams are accepted")
    if type(request["cpuThreads"]) is not int or not 1 <= request["cpuThreads"] <= 16:
        raise ValueError("Invalid CPU thread count")
    started, ended, duration, audio = capture(request["streamUrl"], seconds)
    try:
        result = transcribe(audio, request, duration)
    finally:
        audio.close()
    print(json.dumps({
        "startedAt": started, "endedAt": ended, "durationSeconds": duration, **result,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
