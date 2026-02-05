#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="$PWD/.anthropic-proxy"
PROXY_BIN="$SCRIPT_DIR/bin/proxy"
WEB_DIR="$SCRIPT_DIR/web"

die() { echo "Error: $1" >&2; exit 1; }

find_free_port() {
  local port
  while true; do
    port=$((RANDOM % 10000 + 10000))  # 10000-19999
    if ! lsof -i:$port >/dev/null 2>&1; then
      echo $port
      return
    fi
  done
}

ensure_data_dir() {
  mkdir -p "$DATA_DIR"
}

is_running() {
  local pid_file="$DATA_DIR/$1.pid"
  [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null
}

get_pid() {
  cat "$DATA_DIR/$1.pid" 2>/dev/null || echo ""
}

cmd_create() {
  local do_start=false
  local proxy_port=""
  local ui_port=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --start) do_start=true; shift ;;
      --proxy-port) proxy_port="$2"; shift 2 ;;
      --ui-port) ui_port="$2"; shift 2 ;;
      *) die "Unknown option: $1" ;;
    esac
  done

  ensure_data_dir

  if [[ ! -f "$DATA_DIR/.env" ]]; then
    proxy_port="${proxy_port:-$(find_free_port)}"
    ui_port="${ui_port:-$(find_free_port)}"

    cat > "$DATA_DIR/.env" <<EOF
PROXY_PORT=$proxy_port
UI_PORT=$ui_port
EOF
    echo "Created $DATA_DIR/.env (proxy: $proxy_port, ui: $ui_port)"
  else
    echo "Config already exists at $DATA_DIR/.env"
  fi

  if $do_start; then
    cmd_start
  fi
}

cmd_start() {
  local use_stdout=false
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --stdout) use_stdout=true; shift ;;
      *) die "Unknown option: $1" ;;
    esac
  done

  ensure_data_dir

  [[ -f "$DATA_DIR/.env" ]] && source "$DATA_DIR/.env"
  PROXY_PORT="${PROXY_PORT:-3001}"
  UI_PORT="${UI_PORT:-5173}"

  if is_running proxy; then
    echo "Proxy already running (PID $(get_pid proxy))"
    return 1
  fi

  [[ -x "$PROXY_BIN" ]] || die "Proxy binary not found at $PROXY_BIN. Run 'make build-proxy' first."
  [[ -d "$WEB_DIR/node_modules" ]] || die "Web dependencies not installed. Run 'make install' first."

  if $use_stdout; then
    cleanup() {
      echo ""
      echo "Shutting down services..."
      kill "$(get_pid proxy)" "$(get_pid web)" 2>/dev/null || true
      rm -f "$DATA_DIR/proxy.pid" "$DATA_DIR/web.pid"
      # Reset terminal: clear attributes, show cursor, reset line settings
      printf '\e[0m\e[?25h'
      stty sane 2>/dev/null || true
      exit
    }
    trap cleanup EXIT INT TERM

    echo "Starting proxy on port $PROXY_PORT..."
    PORT=$PROXY_PORT DB_PATH="$DATA_DIR/requests.db" "$PROXY_BIN" &
    echo $! > "$DATA_DIR/proxy.pid"

    sleep 1

    echo "Starting web UI on port $UI_PORT..."
    cd "$WEB_DIR"
    VITE_API_URL="http://localhost:$PROXY_PORT" npm run dev -- --port "$UI_PORT" &
    echo $! > "$DATA_DIR/web.pid"
    cd - >/dev/null

    echo ""
    echo "Services started:"
    echo "  Proxy: http://localhost:$PROXY_PORT"
    echo "  Web UI: http://localhost:$UI_PORT"
    echo ""
    echo "Set ANTHROPIC_BASE_URL=http://localhost:$PROXY_PORT to use with Claude Code"
    echo ""
    echo "Press Ctrl+C to stop all services"

    wait
  else
    echo "Starting proxy on port $PROXY_PORT..."
    PORT=$PROXY_PORT DB_PATH="$DATA_DIR/requests.db" \
      node "$SCRIPT_DIR/rotate.mjs" "$DATA_DIR/proxy.log" "$PROXY_BIN" &
    echo $! > "$DATA_DIR/proxy.pid"

    sleep 1

    echo "Starting web UI on port $UI_PORT..."
    cd "$WEB_DIR"
    VITE_API_URL="http://localhost:$PROXY_PORT" \
      node "$SCRIPT_DIR/rotate.mjs" "$DATA_DIR/web.log" npm run dev -- --port "$UI_PORT" &
    echo $! > "$DATA_DIR/web.pid"
    cd - >/dev/null

    echo ""
    echo "Services started:"
    echo "  Proxy: http://localhost:$PROXY_PORT"
    echo "  Web UI: http://localhost:$UI_PORT"
    echo ""
    echo "Set ANTHROPIC_BASE_URL=http://localhost:$PROXY_PORT to use with Claude Code"
    echo ""
    echo "Recent proxy log:"
    tail -5 "$DATA_DIR/proxy.log" 2>/dev/null || echo "  (no logs yet)"
  fi
}

cmd_stop() {
  echo "Stopping services..."
  for service in proxy web; do
    pid_file="$DATA_DIR/$service.pid"
    if [[ -f "$pid_file" ]]; then
      pid=$(cat "$pid_file")
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
        echo "Stopped $service (PID $pid)"
      fi
      rm -f "$pid_file"
    fi
  done
}

cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start "$@"
}

cmd_status() {
  [[ -f "$DATA_DIR/.env" ]] && source "$DATA_DIR/.env"
  PROXY_PORT="${PROXY_PORT:-3001}"
  UI_PORT="${UI_PORT:-5173}"

  echo "anthropic-proxy status"
  echo ""
  echo "Data directory: $DATA_DIR"
  echo ""

  echo "Services:"
  for service in proxy web; do
    if is_running "$service"; then
      echo "  $service: running (PID $(get_pid $service))"
    else
      echo "  $service: stopped"
    fi
  done

  if is_running proxy; then
    echo ""
    echo "Proxy:  export ANTHROPIC_BASE_URL=http://localhost:$PROXY_PORT"
  fi
  if is_running web; then
    echo "Web UI: http://localhost:$UI_PORT"
  fi
}

case "${1:-}" in
  create)  shift; cmd_create "$@" ;;
  start)   shift; cmd_start "$@" ;;
  stop)    cmd_stop ;;
  restart) shift; cmd_restart "$@" ;;
  status)  cmd_status ;;
  *)
    echo "Usage: anthropic-proxy.sh {create|start|stop|restart|status}"
    echo ""
    echo "Commands:"
    echo "  create [--start] [--proxy-port PORT] [--ui-port PORT]"
    echo "                        Create .anthropic-proxy/ directory and config"
    echo "  start [--stdout]      Start proxy and web UI"
    echo "  stop                  Stop services"
    echo "  restart [--stdout]    Restart services"
    echo "  status                Show service status and URLs"
    ;;
esac
