"""
Exit code 3 if this process's %LOCALAPPDATA% writes are being redirected by Windows into a packaged app's
private store (happens when started from inside an MSIX app such as some AI/desktop tools). 0 = normal.
Detection is direct: write a marker file and see where it actually lands.
"""
import glob
import os
import sys
import uuid

base = os.path.join(os.environ["LOCALAPPDATA"], "MyLaptopActivityMonitor")
os.makedirs(base, exist_ok=True)
name = f".redirect-probe-{uuid.uuid4().hex}"
marker = os.path.join(base, name)
open(marker, "w").close()
try:
    hits = glob.glob(os.path.join(os.environ["LOCALAPPDATA"], "Packages", "*", "LocalCache", "Local", "MyLaptopActivityMonitor", name))
finally:
    try:
        os.remove(marker)
    except OSError:
        pass
if hits:
    print("AppData is redirected into " + hits[0].split("LocalCache")[0] + " - refusing. Run this from File Explorer (double-click), not from inside another app.")
    sys.exit(3)
sys.exit(0)
