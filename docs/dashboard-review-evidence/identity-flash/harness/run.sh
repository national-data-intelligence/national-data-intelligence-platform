#!/bin/bash
# Identity-flash harness runner. Usage: run.sh [--host h1,h2|all] [--scenario s1,s2|all] [--tag x]
# Needs DEMO_PW in the environment (never written anywhere). Exit code = harness exit code.
W=$(cd "$(dirname "$0")" && pwd)
O=${FLASH_OUT:-$PWD/flash-out}
mkdir -p "$O"
docker run --rm --network host -e DEMO_PW -e FLASH_HOSTBASE -v "$W":/w:ro -v "$O":/out \
  mcr.microsoft.com/playwright/python:v1.49.0-noble \
  bash -c "pip install -q playwright==1.49.0 >/dev/null 2>&1; python -u /w/flash.py --out /out $*"
