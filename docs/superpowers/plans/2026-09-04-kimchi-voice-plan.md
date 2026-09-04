# Kimchi Voice Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Kimchi Pi extension package (`kimchi-voice`) that adds a `/voice` slash command for local-only, push-to-talk style voice input, using `whisper.cpp` for transcription.

**Architecture:** A TypeScript Pi extension registers `/voice`. When invoked, it spawns a local audio recorder to capture a WAV file, then runs a configurable local STT command (`whisper.cpp` by default) to transcribe it, and injects the resulting text into the active Kimchi session as a user message. The project is intentionally standalone so it can be installed with `kimchi install /path/to/kimchi-voice`.

**Tech Stack:** TypeScript 5, Node.js 20+, Pi extension API (`@earendil-works/pi-coding-agent`), `typebox`, `whisper.cpp` CLI, `vitest`, `pnpm`.

---

## File Structure

```
/Users/eramadan/kimchi-voice/
├── package.json                 # Pi package manifest + deps
├── tsconfig.json                # TypeScript config
├── .gitignore
├── README.md                    # Install, config, usage
├── src/
│   ├── host/
│   │   └── extension.ts         # Pi extension entry point; registers /voice
│   ├── config.ts                # Settings loading + defaults
│   ├── recorder.ts              # Audio capture to WAV
│   ├── stt.ts                   # STT abstraction + whisper.cpp provider
│   └── whisper.ts               # whisper.cpp binary/model helpers
├── tests/
│   ├── config.test.ts
│   ├── recorder.test.ts
│   └── stt.test.ts
└── scripts/
    └── download-model.sh        # Download whisper.cpp + base model for current platform
```

---

## Task 1: Scaffold the project and validate the message injection API

**Files:**
- Create: `/Users/eramadan/kimchi-voice/package.json`
- Create: `/Users/eramadan/kimchi-voice/tsconfig.json`
- Create: `/Users/eramadan/kimchi-voice/.gitignore`
- Create: `/Users/eramadan/kimchi-voice/README.md` (initial)
- Create: `/Users/eramadan/kimchi-voice/src/host/extension.ts`

- [ ] **Step 1.1: Create project root and initialize git**

Run:
```bash
mkdir -p /Users/eramadan/kimchi-voice
cd /Users/eramadan/kimchi-voice
git init
git checkout -b main
```

Expected: fresh git repo on `main`.

- [ ] **Step 1.2: Confirm how to inject a user message from a Pi extension**

Look at the installed Kimchi source or `@earendil-works/pi-coding-agent` types for `ExtensionCommandContext.sendMessage`. The branch-command example uses:

```ts
await ctx.sendMessage(
  { customType: BRANCH_RESUME_CUSTOM_TYPE, content: "", display: true, details: { ... } },
  { triggerTurn: false }
)
```

For a plain text user message, verify the shape:

```ts
await ctx.sendMessage({
  role: "user",
  content: [{ type: "text", text: transcribedText }],
}, { triggerTurn: true })
```

If `sendMessage` does not accept a user role, document the fallback (write to a temp file and emit instructions for the user to paste it). Update this plan if the API differs.

- [ ] **Step 1.3: Write `package.json`**

```json
{
  "name": "kimchi-voice",
  "version": "0.1.0",
  "description": "Push-to-talk voice commands for Kimchi with local Whisper STT",
  "type": "module",
  "main": "./dist/host/extension.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "keywords": ["kimchi", "voice", "whisper", "pi-extension"],
  "license": "MIT",
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  },
  "dependencies": {
    "@earendil-works/pi-coding-agent": "^0.1.0"
  },
  "pi": {
    "extensions": [
      "./dist/host/extension.js"
    ]
  }
}
```

- [ ] **Step 1.4: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 1.5: Write `.gitignore`**

```gitignore
node_modules/
dist/
*.log
.DS_Store
.vscode/
.idea/
coverage/
models/
whisper.cpp/
*.wav
*.pcm
.env
```

- [ ] **Step 1.6: Write initial `README.md`**

```markdown
# kimchi-voice

Push-to-talk voice commands for [Kimchi](https://kimchi.dev/) using local Whisper STT.

## Install

```bash
kimchi install /Users/eramadan/kimchi-voice
```

## Setup

1. Install [whisper.cpp](https://github.com/ggerganov/whisper.cpp) and download a model (e.g. `ggml-base.bin`).
2. Configure `~/.config/kimchi/voice/settings.json`:

```json
{
  "stt": {
    "command": "whisper-cli",
    "modelPath": "~/models/ggml-base.bin"
  }
}
```

## Usage

In a Kimchi session:

```
/voice
```

Speak your command. Press `Enter` when done. The transcript is injected as your next message.
```

- [ ] **Step 1.7: Write the extension entry point**

`src/host/extension.ts`:

```ts
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent"
import { loadConfig } from "../config.js"
import { recordAudio } from "../recorder.js"
import { createSttProvider } from "../stt.js"

export default function voiceExtension(pi: ExtensionAPI): void {
  pi.registerCommand("voice", {
    description: "Record voice and transcribe it into a local Whisper command",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const config = await loadConfig()
      const hasUI = ctx.hasUI

      if (hasUI) {
        ctx.ui.notify("🎤 Recording... press Enter when done", "info")
      } else {
        console.log("🎤 Recording... press Enter when done")
      }

      const audioPath = await recordAudio({ stopOnEnter: true })

      if (hasUI) {
        ctx.ui.notify("Transcribing locally...", "info")
      } else {
        console.log("Transcribing locally...")
      }

      const provider = createSttProvider(config.stt)
      const transcript = await provider.transcribe(audioPath)

      if (!transcript.trim()) {
        if (hasUI) ctx.ui.notify("No speech detected. Try again.", "warning")
        else console.log("No speech detected.")
        return
      }

      await ctx.sendMessage(
        { role: "user", content: [{ type: "text", text: transcript }] },
        { triggerTurn: true }
      )
    },
  })
}
```

If `sendMessage` does not accept `role: "user"`, update the shape based on the API confirmed in Step 1.2.

- [ ] **Step 1.8: Commit**

```bash
cd /Users/eramadan/kimchi-voice
git add .
git commit -m "chore: scaffold kimchi-voice project"
```

---

## Task 2: Implement configuration loading

**Files:**
- Create: `/Users/eramadan/kimchi-voice/src/config.ts`
- Test: `/Users/eramadan/kimchi-voice/tests/config.test.ts`

- [ ] **Step 2.1: Write the failing test**

`tests/config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadConfig } from "../src/config.js"

describe("loadConfig", () => {
  let configDir: string

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "kimchi-voice-"))
    process.env.KIMCHI_VOICE_CONFIG_DIR = configDir
  })

  afterEach(() => {
    delete process.env.KIMCHI_VOICE_CONFIG_DIR
    rmSync(configDir, { recursive: true, force: true })
  })

  it("returns defaults when no config file exists", async () => {
    const config = await loadConfig()
    expect(config.stt.provider).toBe("whisper.cpp")
    expect(config.stt.modelPath).toContain("ggml-base.bin")
  })

  it("loads user overrides from settings.json", async () => {
    mkdirSync(join(configDir, "voice"), { recursive: true })
    writeFileSync(
      join(configDir, "voice", "settings.json"),
      JSON.stringify({ stt: { modelPath: "/custom/model.bin" } })
    )
    const config = await loadConfig()
    expect(config.stt.modelPath).toBe("/custom/model.bin")
  })
})
```

Run:
```bash
cd /Users/eramadan/kimchi-voice
pnpm exec vitest run tests/config.test.ts
```

Expected: FAIL with `loadConfig is not a function` or similar.

- [ ] **Step 2.2: Implement `src/config.ts`**

```ts
import { homedir } from "node:os"
import { join } from "node:path"
import { existsSync, readFileSync, mkdirSync } from "node:fs"

export interface SttConfig {
  provider: "whisper.cpp" | "command"
  command?: string
  modelPath: string
  language?: string
  args?: string[]
}

export interface VoiceConfig {
  stt: SttConfig
}

const DEFAULT_CONFIG: VoiceConfig = {
  stt: {
    provider: "whisper.cpp",
    modelPath: join(homedir(), ".cache", "kimchi-voice", "models", "ggml-base.bin"),
    language: "en",
  },
}

export function getConfigDir(): string {
  return process.env.KIMCHI_VOICE_CONFIG_DIR ?? join(homedir(), ".config", "kimchi")
}

export async function loadConfig(): Promise<VoiceConfig> {
  const configDir = getConfigDir()
  const settingsPath = join(configDir, "voice", "settings.json")

  let userConfig: Partial<VoiceConfig> = {}
  if (existsSync(settingsPath)) {
    try {
      const raw = readFileSync(settingsPath, "utf-8")
      userConfig = JSON.parse(raw) as Partial<VoiceConfig>
    } catch (error) {
      console.warn(`Failed to parse ${settingsPath}:`, error)
    }
  }

  return {
    stt: { ...DEFAULT_CONFIG.stt, ...userConfig.stt },
  }
}

export function ensureConfigDir(): void {
  const dir = join(getConfigDir(), "voice")
  mkdirSync(dir, { recursive: true })
}
```

- [ ] **Step 2.3: Run tests**

```bash
cd /Users/eramadan/kimchi-voice
pnpm exec vitest run tests/config.test.ts
```

Expected: PASS.

- [ ] **Step 2.4: Commit**

```bash
cd /Users/eramadan/kimchi-voice
git add src/config.ts tests/config.test.ts
git commit -m "feat: add voice configuration loader with defaults"
```

---

## Task 3: Implement audio recording

**Files:**
- Create: `/Users/eramadan/kimchi-voice/src/recorder.ts`
- Test: `/Users/eramadan/kimchi-voice/tests/recorder.test.ts`

- [ ] **Step 3.1: Write the failing test**

`tests/recorder.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { existsSync, statSync } from "node:fs"
import { recordAudio } from "../src/recorder.js"

describe("recordAudio", () => {
  it.skipIf(!process.env.RUN_AUDIO_TESTS)("records a short audio file", async () => {
    const path = await recordAudio({ durationMs: 500 })
    expect(existsSync(path)).toBe(true)
    expect(statSync(path).size).toBeGreaterThan(0)
  })

  it("returns a valid wav path for zero-duration test mode", async () => {
    const path = await recordAudio({ durationMs: 0, testMode: true })
    expect(path.endsWith(".wav")).toBe(true)
    expect(existsSync(path)).toBe(true)
  })
})
```

Run:
```bash
cd /Users/eramadan/kimchi-voice
pnpm exec vitest run tests/recorder.test.ts
```

Expected: FAIL.

- [ ] **Step 3.2: Implement `src/recorder.ts`**

```ts
import { spawn } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export interface RecordOptions {
  durationMs?: number
  stopOnEnter?: boolean
  testMode?: boolean
}

function findRecorder(): string {
  const platform = process.platform
  if (platform === "darwin") return "sox"
  if (platform === "linux") return "arecord"
  if (platform === "win32") return "sox"
  throw new Error(`Unsupported platform: ${platform}`)
}

function buildRecorderArgs(recorder: string, outputPath: string, durationMs?: number): string[] {
  if (recorder === "sox") {
    const args = ["-d", "-t", "wav", outputPath, "rate", "16k", "channels", "1"]
    if (durationMs) args.push("trim", "0", `${durationMs}ms`)
    return args
  }
  if (recorder === "arecord") {
    const args = ["-f", "S16_LE", "-r", "16000", "-c", "1", outputPath]
    if (durationMs) args.push("-d", String(Math.ceil(durationMs / 1000)))
    return args
  }
  throw new Error(`Unknown recorder: ${recorder}`)
}

export async function recordAudio(options: RecordOptions = {}): Promise<string> {
  const { durationMs, testMode } = options
  const tmpDir = mkdtempSync(join(tmpdir(), "kimchi-voice-"))
  const outputPath = join(tmpDir, "recording.wav")

  if (testMode) {
    // Minimal valid mono 16-bit 16kHz WAV header for offline tests
    const header = Buffer.alloc(44)
    header.write("RIFF", 0)
    header.writeUInt32LE(36, 4)
    header.write("WAVE", 8)
    header.write("fmt ", 12)
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)
    header.writeUInt16LE(1, 22)
    header.writeUInt32LE(16000, 24)
    header.writeUInt32LE(32000, 28)
    header.writeUInt16LE(2, 32)
    header.writeUInt16LE(16, 34)
    header.write("data", 36)
    header.writeUInt32LE(0, 40)
    writeFileSync(outputPath, header)
    return outputPath
  }

  const recorder = findRecorder()
  const args = buildRecorderArgs(recorder, outputPath, durationMs)

  return new Promise((resolve, reject) => {
    const proc = spawn(recorder, args, { stdio: "ignore" })
    proc.on("error", reject)
    proc.on("close", (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`${recorder} exited with code ${code}`))
      } else {
        resolve(outputPath)
      }
    })
  })
}
```

Note: `stopOnEnter` is declared but not implemented in Phase 1 because it requires TUI key event interception. Document this in the code comment and implement `durationMs` as the stop mechanism. Update the extension to pass `durationMs: 10000` (10s) by default.

- [ ] **Step 3.3: Run tests**

```bash
cd /Users/eramadan/kimchi-voice
pnpm exec vitest run tests/recorder.test.ts
```

Expected: PASS (test-mode path is exercised).

- [ ] **Step 3.4: Commit**

```bash
cd /Users/eramadan/kimchi-voice
git add src/recorder.ts tests/recorder.test.ts
git commit -m "feat: add platform-aware audio recorder"
```

---

## Task 4: Implement local STT provider

**Files:**
- Create: `/Users/eramadan/kimchi-voice/src/stt.ts`
- Create: `/Users/eramadan/kimchi-voice/src/whisper.ts`
- Test: `/Users/eramadan/kimchi-voice/tests/stt.test.ts`

- [ ] **Step 4.1: Write the failing test**

`tests/stt.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CommandSttProvider, createSttProvider } from "../src/stt.js"

describe("createSttProvider", () => {
  it("creates a whisper.cpp provider by default", () => {
    const provider = createSttProvider({ provider: "whisper.cpp", modelPath: "/dev/null" })
    expect(provider).toBeInstanceOf(CommandSttProvider)
  })

  it("uses a custom command provider when configured", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "stt-test-"))
    const audioPath = join(tmpDir, "audio.wav")
    writeFileSync(audioPath, "fake-wav")

    const provider = createSttProvider({
      provider: "command",
      command: "echo",
      args: ["hello world"],
    })

    const result = await provider.transcribe(audioPath)
    expect(result).toBe("hello world")

    rmSync(tmpDir, { recursive: true, force: true })
  })
})
```

Run:
```bash
cd /Users/eramadan/kimchi-voice
pnpm exec vitest run tests/stt.test.ts
```

Expected: FAIL.

- [ ] **Step 4.2: Implement `src/stt.ts`**

```ts
import { spawn } from "node:child_process"
import type { SttConfig } from "./config.js"

export interface SttProvider {
  transcribe(audioPath: string): Promise<string>
}

export class CommandSttProvider implements SttProvider {
  constructor(private config: SttConfig) {}

  async transcribe(audioPath: string): Promise<string> {
    const command = this.resolveCommand()
    const args = this.resolveArgs(audioPath)

    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })
      let stdout = ""
      let stderr = ""
      proc.stdout.on("data", (chunk) => { stdout += chunk.toString() })
      proc.stderr.on("data", (chunk) => { stderr += chunk.toString() })
      proc.on("error", reject)
      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`${command} failed (${code}): ${stderr || stdout}`))
        } else {
          resolve(this.parseOutput(stdout))
        }
      })
    })
  }

  private resolveCommand(): string {
    if (this.config.provider === "command") {
      if (!this.config.command) throw new Error("STT command is required when provider is 'command'")
      return this.config.command
    }
    return "whisper-cli"
  }

  private resolveArgs(audioPath: string): string[] {
    if (this.config.provider === "command") {
      return [...(this.config.args ?? []), audioPath]
    }

    const args = ["-f", audioPath, "--no-timestamps", "-np", "-nt"]
    if (this.config.modelPath) args.push("-m", this.config.modelPath)
    if (this.config.language) args.push("-l", this.config.language)
    return args
  }

  private parseOutput(output: string): string {
    return output.trim()
  }
}

export function createSttProvider(config: SttConfig): SttProvider {
  return new CommandSttProvider(config)
}
```

- [ ] **Step 4.3: Implement `src/whisper.ts` helper**

```ts
import { homedir } from "node:os"
import { join } from "node:path"
import { existsSync, mkdirSync } from "node:fs"

const DEFAULT_MODEL_URLS: Record<string, string> = {
  "ggml-base.bin": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
}

export function getWhisperCacheDir(): string {
  return join(homedir(), ".cache", "kimchi-voice")
}

export function getDefaultModelPath(modelName = "ggml-base.bin"): string {
  return join(getWhisperCacheDir(), "models", modelName)
}

export function ensureWhisperCacheDir(): void {
  mkdirSync(join(getWhisperCacheDir(), "models"), { recursive: true })
}

export function getModelDownloadUrl(modelName: string): string | undefined {
  return DEFAULT_MODEL_URLS[modelName]
}
```

- [ ] **Step 4.4: Run tests**

```bash
cd /Users/eramadan/kimchi-voice
pnpm exec vitest run tests/stt.test.ts
```

Expected: PASS.

- [ ] **Step 4.5: Commit**

```bash
cd /Users/eramadan/kimchi-voice
git add src/stt.ts src/whisper.ts tests/stt.test.ts
git commit -m "feat: add local STT provider abstraction for whisper.cpp"
```

---

## Task 5: Wire the `/voice` command and update the extension

**Files:**
- Modify: `/Users/eramadan/kimchi-voice/src/host/extension.ts`

- [ ] **Step 5.1: Update extension to use config, recorder, and STT**

```ts
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent"
import { loadConfig } from "../config.js"
import { recordAudio } from "../recorder.js"
import { createSttProvider } from "../stt.js"

const DEFAULT_RECORD_DURATION_MS = 10_000

export default function voiceExtension(pi: ExtensionAPI): void {
  pi.registerCommand("voice", {
    description: "Record voice and transcribe it into a Kimchi user message (local STT only)",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const config = await loadConfig()
      const hasUI = ctx.hasUI

      try {
        if (hasUI) {
          ctx.ui.notify("🎤 Recording for up to 10s...", "info")
        } else {
          console.log("🎤 Recording for up to 10s...")
        }

        const audioPath = await recordAudio({ durationMs: DEFAULT_RECORD_DURATION_MS })

        if (hasUI) ctx.ui.notify("Transcribing locally...", "info")
        else console.log("Transcribing locally...")

        const provider = createSttProvider(config.stt)
        const transcript = await provider.transcribe(audioPath)

        if (!transcript.trim()) {
          if (hasUI) ctx.ui.notify("No speech detected. Try again.", "warning")
          else console.log("No speech detected.")
          return
        }

        if (hasUI) ctx.ui.notify(`Transcript: ${transcript}`, "info")
        else console.log(`Transcript: ${transcript}`)

        await ctx.sendMessage(
          { role: "user", content: [{ type: "text", text: transcript }] },
          { triggerTurn: true }
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (hasUI) ctx.ui.notify(`Voice command failed: ${message}`, "error")
        else console.error(`Voice command failed: ${message}`)
      }
    },
  })
}
```

If the confirmed `sendMessage` API from Task 1 differs, update this shape.

- [ ] **Step 5.2: Build the extension**

```bash
cd /Users/eramadan/kimchi-voice
pnpm install
pnpm run build
```

Expected: TypeScript compiles without errors.

- [ ] **Step 5.3: Commit**

```bash
cd /Users/eramadan/kimchi-voice
git add src/host/extension.ts
git commit -m "feat: wire /voice slash command to recorder and local STT"
```

---

## Task 6: Add a model download helper

**Files:**
- Create: `/Users/eramadan/kimchi-voice/scripts/download-model.sh`
- Update: `/Users/eramadan/kimchi-voice/README.md`

- [ ] **Step 6.1: Write the download script**

```bash
#!/usr/bin/env bash
set -euo pipefail

MODEL_NAME="${1:-ggml-base.bin}"
CACHE_DIR="${HOME}/.cache/kimchi-voice/models"
mkdir -p "$CACHE_DIR"

DEST="$CACHE_DIR/$MODEL_NAME"

if [ -f "$DEST" ]; then
  echo "Model already exists: $DEST"
  exit 0
fi

case "$MODEL_NAME" in
  ggml-base.bin)
    URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
    ;;
  *)
    echo "Unknown model: $MODEL_NAME"
    exit 1
    ;;
esac

echo "Downloading $MODEL_NAME..."
curl -L --output "$DEST" "$URL"
echo "Saved to $DEST"
```

Make it executable:
```bash
chmod +x /Users/eramadan/kimchi-voice/scripts/download-model.sh
```

- [ ] **Step 6.2: Update README with setup steps**

Append to `README.md`:

```markdown
## Setup

1. Install whisper.cpp and make sure `whisper-cli` is on your `PATH`.
2. Download a model:

```bash
./scripts/download-model.sh ggml-base.bin
```

3. Configure Kimchi:

```bash
mkdir -p ~/.config/kimchi/voice
cat > ~/.config/kimchi/voice/settings.json <<EOF
{
  "stt": {
    "provider": "whisper.cpp",
    "modelPath": "${HOME}/.cache/kimchi-voice/models/ggml-base.bin"
  }
}
EOF
```
```

- [ ] **Step 6.3: Commit**

```bash
cd /Users/eramadan/kimchi-voice
git add scripts/download-model.sh README.md
git commit -m "docs: add whisper.cpp model download helper and setup instructions"
```

---

## Task 7: Run the full test suite and add a smoke test

**Files:**
- Test: `/Users/eramadan/kimchi-voice/tests/extension.test.ts`

- [ ] **Step 7.1: Write a smoke test for the extension**

`tests/extension.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import voiceExtension from "../src/host/extension.js"

describe("voiceExtension", () => {
  it("registers the /voice command", () => {
    const registerCommand = vi.fn()
    const pi = { registerCommand } as unknown as Parameters<typeof voiceExtension>[0]

    voiceExtension(pi)

    expect(registerCommand).toHaveBeenCalledWith(
      "voice",
      expect.objectContaining({
        description: expect.stringContaining("local STT"),
        handler: expect.any(Function),
      })
    )
  })
})
```

- [ ] **Step 7.2: Run all tests**

```bash
cd /Users/eramadan/kimchi-voice
pnpm exec vitest run
```

Expected: all tests PASS.

- [ ] **Step 7.3: Commit**

```bash
cd /Users/eramadan/kimchi-voice
git add tests/extension.test.ts
git commit -m "test: add extension smoke test and run full suite"
```

---

## Task 8: Manual end-to-end verification

- [ ] **Step 8.1: Build and install the package locally**

```bash
cd /Users/eramadan/kimchi-voice
pnpm install
pnpm run build
kimchi install -l /Users/eramadan/kimchi-voice
```

Expected: `kimchi` registers the package as a local plugin.

- [ ] **Step 8.2: Verify `/voice` appears in Kimchi**

Start Kimchi in the castai project and run `/help` or `/voice`.

Expected: `/voice` is listed and triggers recording.

- [ ] **Step 8.3: Test a spoken command**

With `whisper-cli` and the base model installed:

1. Run `/voice`.
2. Speak "list the files in the current directory".
3. Wait for the transcript to appear.

Expected: The transcript is injected and Kimchi executes the command.

- [ ] **Step 8.4: Document any deviations**

If the `sendMessage` API requires a different shape, or if Kimchi's local plugin loading behaves differently, update `src/host/extension.ts` and this plan.

---

## Spec Coverage Check

| Spec Section | Implementing Task |
|---|---|
| Native Kimchi Pi package | Task 1, 5 |
| `/voice` slash command | Task 5 |
| Local-only STT | Task 4 |
| Audio recording | Task 3 |
| Configuration file | Task 2 |
| Error handling | Tasks 2-5 (try/catch + validation) |
| Testing strategy | Tasks 2, 3, 4, 7 |
| Model download helper | Task 6 |

## Placeholder Scan

No placeholders remain. All file paths are absolute, all code blocks contain runnable TypeScript/Bash, and all test commands include expected outcomes.

## Open Issues to Resolve During Implementation

1. Exact `sendMessage` shape for injecting a user message — confirm in Task 1.2 and apply in Task 5.
2. Whether `ctx.hasUI` is the correct guard for TUI vs non-TUI sessions — adjust notifications if needed.
3. Push-to-talk hotkey and daemon are intentionally out of scope for Phase 1; they are covered in the design doc for Phase 2.
