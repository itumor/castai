#!/bin/bash
# CAST AI read-only fetch helper for ngm-kronos-eks analysis.
# GET requests ONLY. Never prints the API key value.
# Usage: fetch <output-filename> <path-with-query>
set -u
source /Users/eramadan/castai/.env
BASE="https://api.eu.cast.ai"
ORG="07aa3c29-3e1f-44bc-ad60-ceedb878d99a"
OUTDIR="/Users/eramadan/castai/cluster-cost-analysis/ngm-kronos-eks"
LOG="$OUTDIR/fetch-log.txt"

hdrs=(-H "X-API-Key: $CASTAI_API_KEY" -H "X-CastAI-Organization-Id: $ORG" -H "Accept: application/json")

do_curl() { # $1=url $2=outfile ; prints http code on stdout
  curl -sS --max-time 90 -o "$2" -w "%{http_code}" "${hdrs[@]}" "$1"
}

fetch() { # $1=filename $2=path
  local out="$OUTDIR/$1" tmp="$OUTDIR/.tmp.$1" path="$2" code
  code=$(do_curl "$BASE$path" "$tmp") || code="curl-error"
  if [ "$code" != "200" ]; then
    echo "$(date -u +%FT%TZ) attempt1 $code GET $path" >> "$LOG"
    if [ "$code" = "429" ]; then sleep 10; else sleep 5; fi
    code=$(do_curl "$BASE$path" "$tmp") || code="curl-error"
    echo "$(date -u +%FT%TZ) attempt2 $code GET $path" >> "$LOG"
  fi
  mv "$tmp" "$out"
  echo "$(date -u +%FT%TZ) FINAL $code GET $path -> $1 ($(wc -c < "$out" | tr -d ' ') bytes)" >> "$LOG"
  echo "$1: HTTP $code ($(wc -c < "$out" | tr -d ' ') bytes)"
}
