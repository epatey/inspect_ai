#!/bin/bash
set -e

./start_all.sh

python http_server.py > /tmp/server_logs.txt 2>&1 &

# Keep the container running
tail -f /dev/null
