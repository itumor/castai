# Kimchi Voice Plugin — Design Document

## Goal

Add push-to-talk voice commands to the Kimchi coding agent CLI. A user holds a global hotkey, speaks a natural-language command, releases the key, and Kimchi receives the transcribed text and executes it. Optional text-to-speech reads the final response aloud.

## Scope

### Phase 1 — MVP Proof of Concept
A Kimchi Pi package that adds a `/voice` slash command. When invoked, it spawns a local audio recorder, captures speech until the user stops it, transcribes the audio, and injects the transcript into the active Kimchi session as a user message.

### Phase 2 — True Push-to-Talk
A background audio daemon handles global hotkey detection, recording, voice activity detection (VAD), and transcript injection. The Kimchi extension becomes a thin coordinator and configuration surface.

## Target Users

Kimchi CLI users who want to issue coding commands without typing, especially for quick instructions, long prompts, or hands-busy workflows.

## Components

### 1. `kimchi-voice` (Kimchi Pi Extension Package)

- TypeScript package using Kimchi's Pi extension API.
- Registers slash commands:
  - `/voice` — start a one-shot voice recording session.
  - `/voice config` — open or display voice settings.
  - `/voice status` — show STT/TTS/daemon health.
- Manages the lifecycle of the audio daemon in Phase 2.
- Receives transcripts from the daemon and forwards them into the Kimchi session.

### 2. `kimchi-voice-daemon` (Local Audio Daemon)

- Separate Node.js or Python process.
- Listens for a configurable global hotkey.
- Records microphone audio while the hotkey is held.
- Runs VAD to trim leading/trailing silence.
- Sends audio to the configured STT provider.
- Pushes the transcript back into the active Kimchi session.
- Optionally streams the agent's final response to a TTS provider.

## Architecture / Data Flow

```
┌─────────────────┐         ┌─────────────────────┐         ┌──────────────┐
│   User holds    │────────▶│  kimchi-voice-      │────────▶│   STT API    │
│   global hotkey │         │  daemon             │         │  (Whisper,   │
└─────────────────┘         │  (records + VAD)    │         │   Groq, etc) │
                            └─────────────────────┘         └──────────────┘
                                       │                            │
                                       │ transcript                 │
                                       ▼                            │
                            ┌─────────────────────┐                 │
                            │   kimchi-voice      │◀────────────────┘
                            │   Pi extension      │
                            │   (slash commands,  │
                            │    config)          │
                            └─────────────────────┘
                                       │
                                       │ inject user message
                                       ▼
                            ┌─────────────────────┐
                            │   Kimchi harness    │
                            │   (TUI / ACP)       │
                            └─────────────────────┘
                                       │
                                       │ final response
                                       ▼
                            ┌─────────────────────┐         ┌──────────────┐
                            │  TTS (optional)     │────────▶│   Speaker    │
                            └─────────────────────┘         └──────────────┘
```

## User Flow — Phase 2

1. User presses and holds the global hotkey (default: `Cmd+Shift+Space`).
2. Daemon starts recording; a small UI indicator appears in Kimchi's TUI.
3. User speaks the command.
4. User releases the hotkey.
5. Daemon stops recording, applies VAD, trims silence.
6. Daemon sends audio to the configured STT provider.
7. STT returns the transcript.
8. Daemon pushes the transcript into the active Kimchi session as a user message.
9. Kimchi processes the command and produces a response.
10. If TTS is enabled, the final response is spoken.

## User Flow — Phase 1 MVP

1. User types `/voice` in Kimchi and confirms.
2. Extension spawns a local audio recorder process.
3. User speaks; a "Recording..." indicator is shown.
4. User presses `Enter` (or a configured stop key) to finish.
5. Extension sends the recorded audio to the STT provider.
6. Extension injects the transcript as the next user message.

## Interfaces

### Daemon → Extension (local socket or stdio)

```json
{
  "type": "transcript",
  "text": "add error handling to the API routes",
  "confidence": 0.94,
  "durationMs": 3200
}
```

### Extension → Daemon

```json
{
  "type": "start_listening",
  "hotkey": "Cmd+Shift+Space"
}
```

### Error message

```json
{
  "type": "error",
  "code": "microphone_permission_denied",
  "message": "Microphone access was denied. Grant permission in System Settings."
}
```

## STT / TTS Providers

### Speech-to-Text (local only)

All transcription runs locally; no audio is sent to external APIs.

- **faster-whisper** — recommended default; OpenAI Whisper model running locally via CTranslate2, good speed/quality balance.
- **whisper.cpp** — very fast C++ implementation, especially good on Apple Silicon and CPUs without CUDA.
- **openai-whisper** — reference Python implementation; simplest setup but slower than the above.

### Text-to-Speech

- **OpenAI TTS** — simple, good quality.
- **ElevenLabs** — high quality, more voices.
- **macOS `say`** / **Windows SAPI** / **Linux espeak-ng** — free, offline, lower quality.

## Configuration

Stored in `~/.config/kimchi/voice/settings.json`:

```json
{
  "stt": {
    "provider": "faster-whisper",
    "model": "base",
    "device": "auto",
    "computeType": "int8"
  },
  "tts": {
    "enabled": true,
    "provider": "openai",
    "apiKey": "sk-...",
    "voice": "alloy"
  },
  "hotkey": "Cmd+Shift+Space",
  "daemon": {
    "autoStart": true,
    "vad": true,
    "sampleRate": 16000
  }
}
```

## Error Handling

| Scenario | Behavior |
|---|---|
| Microphone permission denied | Show OS-specific setup instructions, disable voice until fixed. |
| Daemon is not running | Extension attempts auto-start; if that fails, prompt user to start manually. |
| STT API fails | Log error, fall back to typed input with a message in the TUI. |
| No audio detected | Show "No speech detected" and allow retry. |
| TTS fails | Silently disable speaking for this turn; log warning. |

## Testing Strategy

- **Unit tests** for audio format conversion and silence trimming.
- **Mock STT/TTS providers** to test the daemon without network calls.
- **Integration test** that exercises the extension inside the Kimchi harness using a pre-recorded audio fixture.
- **Manual test matrix** for macOS, Linux, and Windows hotkey/audio behavior.

## Open Questions

1. What is the exact Pi extension API for registering slash commands and injecting user messages into the active session?
2. Does Kimchi expose a way for an extension to write a user message into the TUI/ACP session, or must the extension simulate stdin?
3. Which cross-platform global hotkey library is reliable inside a Node.js daemon (`iohook`, `node-global-key-listener`, `electron`)?
4. Should the daemon be written in TypeScript (consistent with Kimchi) or Python (richer audio/VAD ecosystem)?

## Risks

- **Cross-platform audio capture** differs significantly between macOS, Linux, and Windows.
- **Global hotkeys in terminals** may conflict with OS or terminal emulator shortcuts.
- **STT latency** can feel slow compared to typing short commands.
- **Privacy** — mitigated by local-only STT; no audio leaves the device.
- **Model size vs. accuracy** — smaller models load fast but transcribe poorly with accents or noisy environments; users can opt into larger models.

## Decision Log

- **Native Pi package vs MCP server**: Chose native Pi package for first-class slash-command UX; MCP server would make push-to-talk unnatural.
- **Push-to-talk via daemon vs inline recording**: Chose a daemon for Phase 2 to enable global hotkeys; Phase 1 uses inline `/voice` slash command as a proving ground.
- **STT default**: Local transcription only. Default to `faster-whisper` with the `base` model for fast startup; users can switch to `whisper.cpp` or larger models for better accuracy.
