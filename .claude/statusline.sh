#!/bin/bash
input=$(cat)

# Model name from display_name, stripping any parenthetical like "(1M context)"
model_label=$(echo "$input" | jq -r '.model.display_name // "Unknown"' | sed -E 's/ *\([^)]*\)//')

# Effort level from settings.json
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
effort=$(jq -r '.effortLevel // "default"' "$SCRIPT_DIR/settings.json" 2>/dev/null)

# Context window
size=$(echo "$input" | jq -r '.context_window.context_window_size // 0')
if [ "$size" -ge 1000000 ] 2>/dev/null; then
  size_fmt='1M'
else
  size_fmt="$((size / 1000))k"
fi
ctx_pct=$(echo "$input" | jq -r '.context_window.used_percentage // 0')
ctx_int=$(printf '%.0f' "$ctx_pct")
bold=$'\033[1m'
reset=$'\033[0m'
if [ "$ctx_int" -ge 80 ]; then
  ctx_str="${bold}${ctx_int}%${reset}"
else
  ctx_str="${ctx_int}%"
fi

# Rate limits
rate_pct=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
if [ -n "$rate_pct" ]; then
  rate_int=$(printf '%.0f' "$rate_pct")
  if [ "$rate_int" -ge 80 ]; then
    rate_str="${bold}${rate_int}%${reset}"
  else
    rate_str="${rate_int}%"
  fi
  resets_at=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
  if [ -n "$resets_at" ]; then
    now=$(date +%s)
    diff=$((resets_at - now))
    if [ "$diff" -lt 0 ]; then diff=0; fi
    hrs=$((diff / 3600))
    mins=$(((diff % 3600) / 60))
    if [ "$hrs" -gt 0 ]; then
      reset_fmt="${hrs}h${mins}m"
    else
      reset_fmt="${mins}m"
    fi
    printf '%s (%s) · %s of %s context · %s of 5h limit (resets in %s)' \
      "$model_label" "$effort" "$ctx_str" "$size_fmt" "$rate_str" "$reset_fmt"
  else
    printf '%s (%s) · %s of %s context · %s of 5h limit' \
      "$model_label" "$effort" "$ctx_str" "$size_fmt" "$rate_str"
  fi
else
  printf '%s (%s) · %s of %s context' "$model_label" "$effort" "$ctx_str" "$size_fmt"
fi
