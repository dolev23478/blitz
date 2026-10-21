"""Run with the project's radio Python; uses real PyAV frames and in-memory WAV."""
import importlib.util
import io
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import sys
from threading import Event, Thread
import unittest
from unittest.mock import patch
import wave

sys.dont_write_bytecode = True
import av
import numpy as np

spec = importlib.util.spec_from_file_location("radio_worker", "src/radio/local_worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class Source:
    def __init__(self, count): self.count = count
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def decode(self, **kwargs):
        frame = av.AudioFrame.from_ndarray(np.zeros((1, self.count), dtype=np.int16), format="s16", layout="mono")
        frame.sample_rate = 16000
        yield frame


class MemoryWorkerTests(unittest.TestCase):
    def test_slow_but_responsive_http_stream_can_open_without_disk_output(self):
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(16000)
            wav.writeframes(b"\0\0" * 32000)
        payload = buffer.getvalue()
        stop = Event()

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if stop.wait(11): return
                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            def log_message(self, *args): pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch.object(Path, "open", side_effect=AssertionError("Disk output forbidden")):
                _, _, duration, audio = worker.capture(f"http://127.0.0.1:{server.server_port}/live.wav", 1)
            self.assertEqual(duration, 1)
            self.assertIsInstance(audio, io.BytesIO)
            audio.close()
        finally:
            stop.set()
            server.shutdown()
            server.server_close()
            thread.join()

    def test_capture_is_bounded_wav_without_opening_any_output_file(self):
        with patch.object(worker.av, "open", return_value=Source(32000)), patch.object(Path, "open", side_effect=AssertionError("Disk output forbidden")):
            started, ended, duration, audio = worker.capture("https://example.com/live", 1)
        self.assertIsInstance(audio, io.BytesIO)
        self.assertEqual(duration, 1)
        self.assertLessEqual(started, ended)
        with wave.open(audio, "rb") as wav:
            self.assertEqual((wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getnframes()), (1, 2, 16000, 16000))
        audio.close()

    def test_short_stream_is_rejected(self):
        with patch.object(worker.av, "open", return_value=Source(10)):
            with self.assertRaisesRegex(ValueError, "enough audio"):
                worker.capture("https://example.com/live", 1)

    def test_missing_model_fails_without_triggering_a_download(self):
        with patch("faster_whisper.WhisperModel") as model:
            with self.assertRaisesRegex(RuntimeError, "Local Whisper model is missing"):
                worker.transcribe(io.BytesIO(), {"modelDirectory": ".tmp/missing-model-test", "model": "tiny"}, 1)
            model.assert_not_called()


if __name__ == "__main__":
    unittest.main()
