# Kimchi local benchmark — extended (7 tasks)

| model | arith | wordprob | json | pycode | bugfix | regex | summary | total |
|---|---|---|---|---|---|---|---|---|
| deepseek-v4-flash | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | **4/7** |
| deepseek-v4-flash-0731 | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | **4/7** |
| glm-5.2-fp8 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **7/7** |
| glm-5.3 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **7/7** |
| glm-5.3-flash | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **7/7** |
| kimi-k2.7 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | **6/7** |
| kimi-k3 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | **6/7** |
| minimax-m3 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | **6/7** |
| nemotron-3-ultra-fp4 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **7/7** |

## Speed & cost

| model | total time (s) | avg tok/s | prompt tok | completion tok | reasoning tok | est. cost $ |
|---|---|---|---|---|---|---|
| deepseek-v4-flash | 4.8 | 68 | 886 | 329 | 0 | 0.00014 |
| deepseek-v4-flash-0731 | 5.1 | 64 | 886 | 329 | 0 | 0.00011 |
| glm-5.2-fp8 | 75.0 | 57 | 936 | 4294 | 3935 | 0.02020 |
| glm-5.3 | 62.6 | 57 | 936 | 3536 | 3193 | 0.01527 |
| glm-5.3-flash | 35.3 | 79 | 936 | 2784 | 2500 | 0.00153 |
| kimi-k2.7 | 43.1 | 96 | 903 | 4147 | 3955 | 0.01471 |
| kimi-k3 | 22.9 | 168 | 1442 | 3855 | 3607 | 0.05904 |
| minimax-m3 | 46.5 | 95 | 2054 | 4425 | 4223 | 0.00472 |
| nemotron-3-ultra-fp4 | 12.6 | 334 | 1012 | 4213 | 0 | 0.00977 |

## Failure notes

- `deepseek-v4-flash` / arith: 1287
- `deepseek-v4-flash` / wordprob: 120
- `deepseek-v4-flash` / summarize: 24 words
- `deepseek-v4-flash-0731` / arith: 1287
- `deepseek-v4-flash-0731` / wordprob: 120
- `deepseek-v4-flash-0731` / summarize: 24 words
- `kimi-k2.7` / regex: EMPTY CONTENT
- `kimi-k3` / regex: EMPTY CONTENT
- `minimax-m3` / regex: EMPTY CONTENT
