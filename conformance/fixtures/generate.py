"""Optional fixture regeneration on macOS with Samantha, ffmpeg, and ffprobe.

Tests use the checked-in files and do not require these tools. Encoders/voices
can differ across versions; the checked-in bytes and manifest are authoritative.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parent


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *map(str, args)], check=True)


with tempfile.TemporaryDirectory() as tmp:
    source = Path(tmp) / "source.aiff"
    subprocess.run(["say", "-v", "Samantha", "-o", str(source), "The sky is blue."], check=True)
    ffmpeg("-i", source, "-ar", "16000", "-ac", "1", "-map_metadata", "-1", root / "speech.wav")

ffmpeg("-i", root / "speech.wav", "-c:a", "libmp3lame", "-b:a", "32k", "-write_xing", "0", "-id3v2_version", "0", "-map_metadata", "-1", root / "speech.mp3")
ffmpeg("-i", root / "speech.wav", "-c:a", "aac", "-b:a", "32k", "-map_metadata", "-1", root / "speech.m4a")
ffmpeg("-i", root / "speech.wav", "-c:a", "libopus", "-b:a", "24k", "-map_metadata", "-1", root / "speech.webm")
for color in ("blue", "red"):
    ffmpeg("-i", root / "speech.m4a", "-f", "lavfi", "-i", f"color=c={color}:s=64x64:r=10", "-map", "1:v", "-map", "0:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "copy", "-shortest", "-map_metadata", "-1", root / f"speech-{color}.mp4")
ffmpeg("-i", root / "speech.webm", "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=10", "-map", "1:v", "-map", "0:a", "-c:v", "libvpx-vp9", "-c:a", "copy", "-shortest", "-map_metadata", "-1", root / "speech-video.webm")
ffmpeg("-f", "lavfi", "-i", "color=c=blue:s=64x64:r=10", "-t", "1", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", root / "no-audio.mp4")
ffmpeg("-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "1", root / "silence.wav")
(root / "corrupt.wav").write_bytes(b"Not a decodable audio track.\n")

media_types = {".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".mp4": "video/mp4", ".webm": "video/webm"}
entries = []
for path in sorted(root.iterdir()):
    if path.suffix not in media_types:
        continue
    result = subprocess.run(["ffprobe", "-v", "quiet", "-show_entries", "stream=codec_type,codec_name", "-of", "json", str(path)], capture_output=True, text=True)
    streams = json.loads(result.stdout).get("streams", []) if result.returncode == 0 else []
    entries.append({
        "file": path.name,
        "mediaType": "audio/webm" if path.name == "speech.webm" else media_types[path.suffix],
        "audioCodecs": [s["codec_name"] for s in streams if s["codec_type"] == "audio"],
        "hasVideo": any(s["codec_type"] == "video" for s in streams),
        "byteLength": path.stat().st_size,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    })
(root / "manifest.json").write_text(json.dumps(entries, indent=2) + "\n")
