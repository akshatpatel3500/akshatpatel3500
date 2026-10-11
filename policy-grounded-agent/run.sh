#!/usr/bin/env sh
# Run the agent on the bundled data, then the locked expectation tests.
set -e
cd "$(dirname "$0")"
python3 run.py "$@"
echo
python3 -m unittest discover -s tests
