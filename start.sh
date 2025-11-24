#!/bin/bash

# MJPEG Stream + CBS Control Server
cd "$(dirname "$0")"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js not installed"
    echo "Install with: sudo apt install nodejs npm"
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
    echo ""
fi

# Start server
node server.js
