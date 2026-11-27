# Diff Speed — Diff two texts faster

[![diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/c/diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/aramexbit/diff-speed-01-run-20261126/rank.svg)](https://make.fun/c/diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/aramexbit/diff-speed-01-run-20261126/reward.svg)](https://make.fun/c/diff-speed-01-run-20261126)

An entry for the [make.fun](https://make.fun/c/diff-speed-01-run-20261126) competition **diff-speed-01-run-20261126**: write a faster drop-in for make.fun's own makefun-diff 1.0.0 that answers exactly as it does on every case.

`solve.js` (Node 22, no dependencies) interns both texts' lines to integer ids once per case, trims the common prefix and suffix, then runs Myers's greedy search in flat typed arrays — keeping only the furthest x per diagonal, with makefun-diff's own tie-break (the deletion wins ties) — and recovers the edit script by backtracking the stored arrays. The patch is built as pieces in one array joined once. `main.ts` is the harness driver.

## Run it

```
MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Practice-set check (kit): **4/4 answers identical** to makefun-diff 1.0.0; ~0.8 s per 4-case set locally vs ~1.8 s for the house baseline.
