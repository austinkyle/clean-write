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
  echo "ClearWrite could not enter its application directory: $APP_DIR" >&2
  exit 1
fi

HOST="127.0.0.1"
PORT="${CLEARWRITE_PORT:-4317}"
RUNTIME_DIR="$APP_DIR/data/.runtime"
PID_FILE="$RUNTIME_DIR/app.pid"
PORT_FILE="$RUNTIME_DIR/app.port"
LOG_FILE="$RUNTIME_DIR/app.log"
BUILD_MARKER="$APP_DIR/.next/BUILD_ID"

mkdir -p "$RUNTIME_DIR"
chmod 700 "$RUNTIME_DIR"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "ClearWrite requires Node.js and npm. Install Node.js 20.9+ and try again." >&2
  exit 1
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 20 ]; then
  echo "ClearWrite requires Node.js 20.9+. Found $(node --version)." >&2
  exit 1
fi

load_local_env() {
  env_file="$APP_DIR/.env.local"
  [ -f "$env_file" ] || return 0

  while IFS= read -r env_line || [ -n "$env_line" ]; do
    case "$env_line" in
      OPENAI_API_KEY=*|OPENAI_REWRITE_MODEL=*|OPENAI_REVIEW_MODEL=*|WRITING_EDITOR_DB_PATH=*)
        env_key="${env_line%%=*}"
        env_value="${env_line#*=}"
        case "$env_value" in
          \"*\") env_value="${env_value#\"}"; env_value="${env_value%\"}" ;;
          \'*\') env_value="${env_value#\'}"; env_value="${env_value%\'}" ;;
        esac
        export "$env_key=$env_value"
        ;;
    esac
  done < "$env_file"
}

load_local_env

process_is_owned() {
  candidate_pid="$1"
  candidate_port="${2:-}"
  [ -n "$candidate_pid" ] || return 1
  kill -0 "$candidate_pid" 2>/dev/null || return 1

  command_line="$(ps -p "$candidate_pid" -o command= 2>/dev/null | sed 's/^[[:space:]]*//')"
  case "$command_line" in
    *"next start"*|*".next/standalone/server.js"*|*"next-server (v"* ) ;;
    *) return 1 ;;
  esac

  process_cwd="$(lsof -a -p "$candidate_pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
  case "$process_cwd" in
    "$APP_DIR"|"$APP_DIR"/*) ;;
    *) return 1 ;;
  esac

  if [ -n "$candidate_port" ] && ! lsof -a -p "$candidate_pid" -iTCP:"$candidate_port" -sTCP:LISTEN >/dev/null 2>&1; then
    return 1
  fi

  return 0
}

healthcheck() {
  health_port="$1"
  curl -fsS --max-time 1 "http://$HOST:$health_port/api/health" >/dev/null 2>&1
}

wait_for_health() {
  health_port="$1"
  attempt=1
  while [ "$attempt" -le 60 ]; do
    if healthcheck "$health_port"; then return 0; fi
    sleep 0.25
    attempt=$((attempt + 1))
  done
  return 1
}

clear_stale_runtime() {
  rm -f "$PID_FILE" "$PORT_FILE"
}

runtime_assets_ready() {
  [ -n "$(find "$APP_DIR/.next/standalone/.next/static" -type f -print -quit 2>/dev/null)" ]
}

prepare_runtime_assets() {
  standalone_next="$APP_DIR/.next/standalone/.next"
  if [ ! -d "$APP_DIR/.next/static" ]; then
    echo "ClearWrite build is missing client assets under .next/static." >&2
    return 1
  fi

  mkdir -p "$standalone_next/static"
  cp -R "$APP_DIR/.next/static/." "$standalone_next/static/"

  if [ -d "$APP_DIR/public" ]; then
    mkdir -p "$APP_DIR/.next/standalone/public"
    cp -R "$APP_DIR/public/." "$APP_DIR/.next/standalone/public/"
  fi
}

if [ -f "$PID_FILE" ]; then
  existing_pid="$(sed -n '1p' "$PID_FILE" 2>/dev/null)"
  existing_port="$PORT"
  [ -f "$PORT_FILE" ] && existing_port="$(sed -n '1p' "$PORT_FILE" 2>/dev/null)"

  if process_is_owned "$existing_pid" "$existing_port"; then
    if wait_for_health "$existing_port"; then
      if runtime_assets_ready; then
        echo "ClearWrite is already running at http://$HOST:$existing_port"
        open "http://$HOST:$existing_port" >/dev/null 2>&1 || echo "Open this URL in your browser: http://$HOST:$existing_port"
        exit 0
      fi
      echo "ClearWrite is running without its client assets; restarting it."
      kill "$existing_pid" 2>/dev/null || true
      shutdown_attempt=1
      while kill -0 "$existing_pid" 2>/dev/null && [ "$shutdown_attempt" -le 20 ]; do
        sleep 0.05
        shutdown_attempt=$((shutdown_attempt + 1))
      done
    else
      echo "ClearWrite has a live process that is not responding on port $existing_port." >&2
      echo "Inspect $LOG_FILE before starting another instance." >&2
      exit 1
    fi
  fi

  echo "Removing stale ClearWrite runtime state."
  clear_stale_runtime
fi

if [ ! -d node_modules ] || [ ! -f node_modules/.package-lock.json ] || [ package.json -nt node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "Installing ClearWrite dependencies..."
  if [ -f package-lock.json ]; then npm ci || { echo "Dependency installation failed." >&2; exit 1; }; else npm install || { echo "Dependency installation failed." >&2; exit 1; }; fi
fi

needs_build=0
if [ ! -f "$BUILD_MARKER" ]; then
  needs_build=1
elif [ -n "$(find src -type f -newer "$BUILD_MARKER" -print -quit 2>/dev/null)" ] || [ package.json -nt "$BUILD_MARKER" ] || [ next.config.ts -nt "$BUILD_MARKER" ]; then
  needs_build=1
fi

if [ "$needs_build" -eq 1 ]; then
  echo "Preparing the local ClearWrite build..."
  npm run build || { echo "Build failed. See the output above." >&2; exit 1; }
fi

prepare_runtime_assets || { echo "Could not prepare the standalone runtime assets." >&2; exit 1; }

echo "Starting ClearWrite on http://$HOST:$PORT..."
HOSTNAME="$HOST" PORT="$PORT" nohup node "$APP_DIR/.next/standalone/server.js" >>"$LOG_FILE" 2>&1 &
app_pid=$!
printf '%s\n' "$app_pid" > "$PID_FILE"
printf '%s\n' "$PORT" > "$PORT_FILE"

if wait_for_health "$PORT"; then
  echo "ClearWrite is ready at http://$HOST:$PORT"
  open "http://$HOST:$PORT" >/dev/null 2>&1 || echo "Open this URL in your browser: http://$HOST:$PORT"
  exit 0
fi

echo "ClearWrite did not become ready within 15 seconds." >&2
if process_is_owned "$app_pid" "$PORT"; then kill "$app_pid" 2>/dev/null || true; fi
clear_stale_runtime
echo "See $LOG_FILE for the server log." >&2
exit 1
