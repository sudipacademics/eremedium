#!/usr/bin/env python3
import sys
from pathlib import Path
for p in map(Path, sys.argv[1:]):
    data = p.read_bytes().replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    p.write_bytes(data)
    print(f"lf_ok:{p}")
