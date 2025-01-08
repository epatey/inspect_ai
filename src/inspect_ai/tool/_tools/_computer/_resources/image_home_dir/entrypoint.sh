#!/bin/bash
set -e

export DISPLAY=:${DISPLAY_NUM}
./xvfb_startup.sh

echo "Starting Fluxbox..."
sudo fluxbox 2>/tmp/fluxbox_stderr.log &

# # ./tint2_startup.sh
# # ./mutter_startup.sh
./x11vnc_startup.sh

# Keep the container running
tail -f /dev/null
