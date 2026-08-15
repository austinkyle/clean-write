#!/bin/bash

set -u

SCRIPT_PATH="${BASH_SOURCE[0]}"
while [ -h "$SCRIPT_PATH" ]; do
  SCRIPT_DIR="$(cd -P "$(dirname "$SCRIPT_PATH")" >/dev/null 2>&1 && pwd)"
  SCRIPT_PATH="$(readlink "$SCRIPT_PATH")"
  case "$SCRIPT_PATH" in
    /*) ;;
    *) SCRIPT_PATH="$SCRIPT_DIR/$SCRIPT_PATH" ;;
  esac
done

APP_DIR="$(cd -P "$(dirname "$SCRIPT_PATH")" >/dev/null 2>&1 && pwd)"
if ! cd "$APP_DIR"; then
  echo "CleanWrite could not enter its application directory: $APP_DIR" >&2
  exit 1
fi

RUNTIME_DIR="$APP_DIR/data/.runtime"
PID_FILE="$RUNTIME_DIR/app.pid"
PORT_FILE="$RUNTIME_DIR/app.port"

if [ ! -f "$PID_FILE" ]; then
  echo "CleanWrite is already stopped."
  exit 0
fi

pid="$(sed -n '1p' "$PID_FILE" 2>/dev/null)"
port=""
[ -f "$PORT_FILE" ] && port="$(sed -n '1p' "$PORT_FILE" 2>/dev/null)"
command_line="$(ps -p "$pid" -o command= 2>/dev/null | sed 's/^[[:space:]]*//')"
process_cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"

owned=0
case "$command_line" in
  *"next start"*|*".next/standalone/server.js"*|*"next-server (v"*)
    case "$process_cwd" in
      "$APP_DIR"|"$APP_DIR"/*)
        if [ -z "$port" ] || lsof -a -p "$pid" -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then owned=1; fi
        ;;
    esac
    ;;
esac

if [ "$owned" -ne 1 ]; then
  echo "CleanWrite runtime state was stale; no matching application process was terminated."
  rm -f "$PID_FILE" "$PORT_FILE"
  exit 0
fi

echo "Stopping CleanWrite (PID $pid)..."
kill -TERM "$pid" 2>/dev/null || true
attempt=1
while kill -0 "$pid" 2>/dev/null && [ "$attempt" -le 20 ]; do
  sleep 0.25
  attempt=$((attempt + 1))
done

if kill -0 "$pid" 2>/dev/null; then
  echo "CleanWrite did not stop gracefully; ending the verified process."
  kill -KILL "$pid" 2>/dev/null || true
fi

rm -f "$PID_FILE" "$PORT_FILE"
echo "CleanWrite stopped."
