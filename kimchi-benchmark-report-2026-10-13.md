# Kimchi model benchmark — 2026-10-13 (fresh run)

7 deterministic tasks × all live chat models, temperature 0, max_tokens 4096.
Probe of all 43 served model IDs with reasoning-aware retry (2048-token budget).
EIS provider (qwen/gpt-oss models) skipped: `EIS_API_KEY` not set in this environment.
Raw data: `scratch/kimchi-bench-2026-10-13.json`.

## Quality

| model | arith | wordprob | json | pycode | bugfix | regex | summary | total |
|---|---|---|---|---|---|---|---|---|
| kimi-k3 🥇 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **7/7** |
| nemotron-3-ultra-fp4 🥈 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **7/7** |
| kimi-k2.7 🥉 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **7/7** |
| minimax-m3 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **7/7** |
| gemini-robotics-er-2-preview | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **7/7** |
| glm-5.3-flash | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **7/7** |
| glm-5.3 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **7/7** |
| gemma-4-31b | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **6/7** |
| deepseek-v4-flash-0731 | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **6/7** |
| gemini-3-flash-preview | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | **6/7** |
| deepseek-v4.1-flash | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | **4/7** |
| gemini-3.5-flash-lite | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | **4/7** |
| gemini-3.1-flash-lite | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ | **3/7** |
| gemini-flash-lite-latest | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | **2/7** |

## Speed & cost

| model | suite time (s) | avg tok/s | prompt tok | completion tok | reasoning tok | est. cost $ |
|---|---|---|---|---|---|---|
| kimi-k3 | 10.5 | 254 | 984 | 2679 | 2361 | $0.04093 |
| nemotron-3-ultra-fp4 | 12.4 | 217 | 523 | 2695 | 2442 | $0.00619 |
| kimi-k2.7 | 16.7 | 86 | 445 | 1433 | 1173 | $0.00507 |
| minimax-m3 | 24.3 | 77 | 1597 | 1878 | 1627 | $0.00212 |
| gemini-robotics-er-2-preview | 26.3 | 188 | 419 | 4937 | 4655 | n/a |
| glm-5.3-flash | 34.7 | 69 | 476 | 2392 | 2147 | $0.00124 |
| glm-5.3 | 64.8 | 54 | 476 | 3514 | 3271 | $0.01444 |
| gemma-4-31b | 3.4 | 67 | 503 | 229 | 0 | n/a |
| deepseek-v4-flash-0731 | 4.2 | 69 | 422 | 285 | 0 | $0.00006 |
| gemini-3-flash-preview | 196.5 | 32 | 388 | 6239 | 6071 | n/a |
| deepseek-v4.1-flash | 5.0 | 52 | 422 | 262 | 0 | $0.00006 |
| gemini-3.5-flash-lite | 6.8 | 46 | 419 | 309 | 0 | n/a |
| gemini-3.1-flash-lite | 20.8 | 8 | 388 | 165 | 0 | n/a |
| gemini-flash-lite-latest | 3.2 | 66 | 231 | 215 | 0 | $0.00011 |

Cost = prompt/completion tokens × public per-1M rates (in/out). `n/a` = rate unknown — token counts shown.

## Dead / unreachable model IDs (live probe)

| model | status | API truth |
|---|---|---|
| deepseek-v4-flash | 410 | Model "deepseek-v4-flash" is no longer available. Use "deepseek-v4-flash-0731" instead. |
| gemini-2.5-computer-use-preview-10-2025 | 429 | {"error":{"type":"rate_limit_error","message":"{\n \"error\": {\n \"code\": 429,\n \"message\": \"You exceeded your current quota, |
| gemini-2.5-flash | 404 | 404 Not Found 404 Not Found nginx |
| gemini-2.5-flash-lite | 404 | 404 Not Found 404 Not Found nginx |
| gemini-2.5-flash-native-audio-latest | 400 | no registered providers found for the requested model |
| gemini-2.5-flash-native-audio-preview-09-2025 | 400 | no registered providers found for the requested model |
| gemini-2.5-flash-native-audio-preview-12-2025 | 400 | no registered providers found for the requested model |
| gemini-2.5-pro | 404 | 404 Not Found 404 Not Found nginx |
| gemini-2.5-pro-preview-tts | 429 | {"error":{"type":"rate_limit_error","message":"{\n \"error\": {\n \"code\": 429,\n \"message\": \"You exceeded your current quota, |
| gemini-3.1-flash-live-preview | 400 | no registered providers found for the requested model |
| gemini-3.1-pro-preview | 429 | {"error":{"type":"rate_limit_error","message":"{\n \"error\": {\n \"code\": 429,\n \"message\": \"You exceeded your current quota, |
| gemini-3.1-pro-preview-customtools | 429 | {"error":{"type":"rate_limit_error","message":"{\n \"error\": {\n \"code\": 429,\n \"message\": \"You exceeded your current quota, |
| gemini-3.5-flash | 0 | TimeoutError: The read operation timed out |
| gemini-3.6-flash | 503 | 503 Service Temporarily Unavailable 503 Service Temporarily Unavailable nginx |
| gemini-embedding-001 | 400 | no registered providers found for the requested model |
| gemini-embedding-2 | 400 | no registered providers found for the requested model |
| gemini-flash-latest | 400 | https://docs.litellm.ai/docs/providers |
| gemini-omni-flash-preview | 429 | {"error":{"type":"rate_limit_error","message":"{\n \"error\": {\n \"code\": 429,\n \"message\": \"You exceeded your current quota, |
| gemini-pro-latest | 400 | https://docs.litellm.ai/docs/providers |
| gemini-robotics-er-1.6-preview | 400 | no registered providers found for the requested model |
| gemini-robotics-er-2-streaming-preview | 400 | {"error":{"type":"invalid_request_error","message":"{\n \"error\": {\n \"code\": 400,\n \"message\": \"models/gemini-robotics-er-2 |
| glm-5.2-fp8 | 410 | Model "glm-5.2-fp8" is no longer available. Use "glm-5.3" instead. |
| kimi-k2.5 | 400 | no registered providers found for the requested model |
| kimi-k2.6 | 400 | no registered providers found for the requested model |
| lyria-3-clip-preview | 429 | {"error":{"type":"rate_limit_error","message":"{\n \"error\": {\n \"code\": 429,\n \"message\": \"You exceeded your current quota, |
| lyria-3-pro-preview | 429 | {"error":{"type":"rate_limit_error","message":"{\n \"error\": {\n \"code\": 429,\n \"message\": \"You exceeded your current quota, |
| minimax-m2.5 | 400 | no registered providers found for the requested model |
| minimax-m2.7 | 400 | no registered providers found for the requested model |
| nemotron-3-super-fp4 | 400 | no registered providers found for the requested model |

## Failure notes

Infra flakes during the run (NOT quality failures): `gemini-3-flash-preview`/pycode and
`gemini-3.1-flash-lite`/pycode returned HTTP 503; `gemini-flash-lite-latest` had intermittent
HTTP 400s on 3 tasks. Re-run on a quieter window to separate flake from true capability.

- `gemma-4-31b` / arith: wrong: 1233
- `deepseek-v4-flash-0731` / arith: wrong: 137 × 8 = 1096 945 ÷ 15 = 63 1096 − 63 = 1033 1033 + 202 = 1
- `gemini-3-flash-preview` / pycode: http 503: <html>
<head><title>503 Service Temporarily Unavailable</title></head>
<body>
<center><h1>503 Service Temporarily Una
- `deepseek-v4.1-flash` / arith: wrong: 1291
- `deepseek-v4.1-flash` / wordprob: wrong: 19
- `deepseek-v4.1-flash` / summary: wrong: Karpenter watches unplaceable pods, computes needed capacity
- `gemini-3.5-flash-lite` / arith: wrong: 1293
- `gemini-3.5-flash-lite` / wordprob: wrong: 21
- `gemini-3.5-flash-lite` / summary: wrong: Karpenter monitors unplaced pods, calculates required capaci
- `gemini-3.1-flash-lite` / arith: wrong: 1253
- `gemini-3.1-flash-lite` / wordprob: wrong: 19
- `gemini-3.1-flash-lite` / pycode: http 503: <html>
<head><title>503 Service Temporarily Unavailable</title></head>
<body>
<center><h1>503 Service Temporarily Una
- `gemini-3.1-flash-lite` / summary: wrong: Karpenter optimizes Kubernetes clusters by monitoring pendin
- `gemini-flash-lite-latest` / arith: wrong: 1289
- `gemini-flash-lite-latest` / wordprob: http 400: {"error":{"type":"invalid_request_error","message":"https://docs.litellm.ai/docs/providers","retryable":false}}
- `gemini-flash-lite-latest` / json: http 400: {"error":{"type":"invalid_request_error","message":"https://docs.litellm.ai/docs/providers","retryable":false}}
- `gemini-flash-lite-latest` / bugfix: http 400: {"error":{"type":"invalid_request_error","message":"https://docs.litellm.ai/docs/providers","retryable":false}}
- `gemini-flash-lite-latest` / summary: wrong: Karpenter monitors unplaced Kubernetes pods, instantly launc
