#!/bin/bash
set -e

export DISPLAY=:${DISPLAY_NUM}

# remove marker files
rm -f /tmp/.X${DISPLAY_NUM}-lock 
rm -f /tmp/mutter_started

/opt/inspect/entrypoint/xvfb_startup.sh
/opt/inspect/entrypoint/mutter_startup.sh
/opt/inspect/entrypoint/tint2_startup.sh
/opt/inspect/entrypoint/x11vnc_startup.sh
/opt/inspect/entrypoint/novnc_startup.sh

# Run CMD if provided
echo "Executing CMD from derived Dockerfile: $@"
exec "$@"

# Keep the container running
tail -f /dev/null
