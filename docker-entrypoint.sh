#!/bin/sh

# Docker entrypoint script for Claude Code Proxy
# Starts both the Go proxy server and Remix frontend

set -e

echo "🚀 Starting Claude Code Proxy services..."
echo "========================================="

# Function to handle graceful shutdown
cleanup() {
    echo ""
    echo "🛑 Shutting down services..."
    kill $PROXY_PID $WEB_PID 2>/dev/null || true
    exit 0
}

# Trap signals for graceful shutdown
trap cleanup SIGTERM SIGINT

echo "📊 Configuration:"
echo "   - Proxy Server: http://0.0.0.0:${PORT}"
echo "   - Web Dashboard: http://0.0.0.0:${WEB_PORT}"
echo "   - Database: ${DB_PATH}"
echo "   - Anthropic API: ${ANTHROPIC_FORWARD_URL}"
echo "========================================="

# Start proxy server
echo "🔄 Starting proxy server..."
HOST=0.0.0.0 \
PORT=${PORT} \
READ_TIMEOUT=${READ_TIMEOUT}s \
WRITE_TIMEOUT=${WRITE_TIMEOUT}s \
IDLE_TIMEOUT=${IDLE_TIMEOUT}s \
ANTHROPIC_FORWARD_URL=${ANTHROPIC_FORWARD_URL} \
ANTHROPIC_VERSION=${ANTHROPIC_VERSION} \
ANTHROPIC_MAX_RETRIES=${ANTHROPIC_MAX_RETRIES} \
DB_PATH=${DB_PATH} \
./bin/proxy &
PROXY_PID=$!

# Wait for proxy to start
sleep 3

# Start web server
echo "🔄 Starting web server..."
cd web
PORT=${WEB_PORT} HOST=0.0.0.0 NODE_ENV=production npx remix-serve build/server/index.js &
WEB_PID=$!
cd ..

echo ""
echo "✨ All services started successfully!"
echo "========================================="
echo "📊 Web Dashboard: http://localhost:${WEB_PORT}"
echo "🔌 API Proxy: http://localhost:${PORT}"
echo "💚 Health Check: http://localhost:${PORT}/health"
echo "========================================="
echo "💡 To use with Claude Code, set: ANTHROPIC_BASE_URL=http://localhost:${PORT}"
echo ""

# Wait for processes to finish
wait