echo "starting osworld server"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 "$SCRIPT_DIR/main.py" > /tmp/osworld.log 2> /tmp/osworld.err