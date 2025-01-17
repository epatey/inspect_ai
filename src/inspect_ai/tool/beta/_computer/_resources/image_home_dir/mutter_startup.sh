echo "starting mutter"

mkdir -p /var/run/dbus
dbus-daemon --system --fork

sleep 2


export XDG_SESSION_TYPE=x11
export GDM_SESSION=gnome-xorg
gnome-session --session=ubuntu-xorg &

echo "started gnome-session"

touch /tmp/mutter_started

echo "touched mutter_started"

rm /tmp/mutter_stderr.log

echo "removed mutter_stderr.log"
