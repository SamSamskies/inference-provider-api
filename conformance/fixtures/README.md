# Bounded speech fixtures

These files are test data, not recordings of provider responses. `speech.wav`
contains locally synthesized “The sky is blue.” using macOS Samantha; there is
no human recording or personal speech data. The other `speech` files encode
that same utterance. `speech.mp3` is also the deterministic byte fixture for
synthesis transport tests; mock providers replay its checked-in bytes.

| File | MIME / tracks | Purpose |
| --- | --- | --- |
| `speech.wav` | `audio/wav`, mono 16 kHz PCM | Common transcription input |
| `speech.mp3` | `audio/mpeg`, MP3 | Transcription and byte-exact synthesis transport |
| `speech.m4a` | `audio/mp4`, AAC | Audio-only MP4 container |
| `speech.webm` | `audio/webm`, Opus | Audio-only WebM container |
| `speech-blue.mp4`, `speech-red.mp4` | `video/mp4`, H.264 + identical AAC audio | Changed visual tracks must not influence transcription semantics |
| `speech-video.webm` | `video/webm`, VP9 + Opus | Supported video pass-through |
| `no-audio.mp4` | `video/mp4`, H.264 without audio | Clear `invalid_request`: no supported audio track |
| `silence.wav` | `audio/wav`, digital silence | Clear `invalid_request`: no transcribable speech |
| `corrupt.wav` | Invalid bytes labeled `audio/wav` | Clear decoder/invalid-media failure |

[`manifest.json`](./manifest.json) records exact SHA-256, sizes, and detected
audio/video tracks. Tests validate file integrity without ffmpeg. The optional
[`generate.py`](./generate.py) requires macOS `say`, ffmpeg, and ffprobe and
rewrites the fixtures/manifest. Encoded bytes may differ across tool versions;
normal tests always use the checked-in deterministic files.

Capability-driven providers need only accept their advertised combinations;
these fixtures do not impose a universal format allowlist. A route that does
not advertise a MIME/container/codec combination should fail before upload.
Provider-supported containers pass through unchanged. Unsupported codecs can
be tested by excluding a fixture's manifest codec from the implementation's
advertised constraints. Live semantic checks and exact provider/browser
versions belong in the [conformance report](../../docs/speech-conformance.md).
