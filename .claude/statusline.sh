#!/bin/bash
input=$(cat)

# Model name from display_name, stripping any parenthetical like "(1M context)"
model_label=$(echo "$input" | jq -r '.model.display_name // "Unknown"' | sed -E 's/ *\([^)]*\)//')

effort=$(echo "$input" | jq -r '.effort.level // "default"')

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

format_pct() {
  local pct_int=$1
  if [ "$pct_int" -ge 80 ]; then
    printf '%s%s%%%s' "$bold" "$pct_int" "$reset"
  else
    printf '%s%%' "$pct_int"
  fi
}

format_reset() {
  local resets_at=$1
  local now
  now=$(date +%s)
  local diff=$((resets_at - now))
  if [ "$diff" -lt 0 ]; then diff=0; fi
  local days=$((diff / 86400))
  local hrs=$(((diff % 86400) / 3600))
  local mins=$(((diff % 3600) / 60))
  if [ "$days" -gt 0 ]; then
    printf '%dd %dh' "$days" "$hrs"
  elif [ "$hrs" -gt 0 ]; then
    printf '%dh %dm' "$hrs" "$mins"
  else
    printf '%dm' "$mins"
  fi
}

format_window() {
  local pct=$1
  local resets_at=$2
  if [ -z "$pct" ]; then
    return
  fi
  local pct_int
  pct_int=$(printf '%.0f' "$pct")
  local pct_str
  pct_str=$(format_pct "$pct_int")
  if [ -n "$resets_at" ]; then
    local reset_fmt
    reset_fmt=$(format_reset "$resets_at")
    printf '%s (%s)' "$pct_str" "$reset_fmt"
  else
    printf '%s' "$pct_str"
  fi
}

rate_pct_5h=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
resets_5h=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
rate_pct_7d=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
resets_7d=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')

base="$model_label ($effort) · $ctx_str of $size_fmt"

five_h_str=$(format_window "$rate_pct_5h" "$resets_5h")
seven_d_str=$(format_window "$rate_pct_7d" "$resets_7d")

if [ -n "$five_h_str" ] && [ -n "$seven_d_str" ]; then
  printf '%s · %s / %s' "$base" "$five_h_str" "$seven_d_str"
elif [ -n "$five_h_str" ]; then
  printf '%s · %s' "$base" "$five_h_str"
elif [ -n "$seven_d_str" ]; then
  printf '%s · %s' "$base" "$seven_d_str"
else
  printf '%s' "$base"
fi
