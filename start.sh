#!/bin/bash
cd ~/crate

# Start Python backend in background
source src-python/venv/bin/activate
uvicorn src-python.crate.main:app --port 8000 &
BACKEND_PID=$!

echo "Backend started (PID $BACKEND_PID)"

# Wait for backend to be ready
echo "Waiting for backend..."
until curl -s http://localhost:8000/health > /dev/null 2>&1; do sleep 0.3; done
echo "Backend ready"

# Start Vite dev server in background
npm run dev &
VITE_PID=$!

echo "Vite started (PID $VITE_PID)"

# Wait for Vite to be ready
echo "Waiting for Vite..."
until curl -s http://localhost:1420 > /dev/null 2>&1; do sleep 0.3; done
echo "Vite ready"

# Start Electron
NODE_ENV=development npx electron electron/main.js

# Cleanup when Electron closes
kill $VITE_PID
kill $BACKEND_PID
