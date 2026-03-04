#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/.."

if [ ! -d "node_modules" ]; then
  echo "node_modules not found, running npm install..."
  npm install
fi

# Browser settings
export BROWSER_TYPE=auto
export USE_MANUAL_LOGIN=false
export HEADLESS_BROWSER=false
export BROWSER_INSTANCE_COUNT=1

# Session settings
export SESSION_LOCK_TIMEOUT=180
export ENABLE_DETECTION=false
export ENABLE_AUTO_COOKIE_UPDATE=false
export SKIP_ACCOUNT_VALIDATION=false
export ENABLE_REQUEST_LIMIT=false
export ALLOW_NON_PRO=false

# Request behavior
export CUSTOM_END_MARKER="<CHAR_turn>"
export ENABLE_DELAY_LOGIC=false

# Proxy settings
export https_proxy=

# Server settings
export PASSWORD=REPLACE_WITH_STRONG_PASSWORD
export PORT=8080
export AI_MODEL=

# Mode settings
export USE_CUSTOM_MODE=false
export ENABLE_MODE_ROTATION=false
export INCOGNITO_MODE=false

# Upload/settings
export USE_BACKSPACE_PREFIX=false
export UPLOAD_FILE_FORMAT=txt
export CLEWD_ENABLED=false

# Garbled text settings
export ENABLE_GARBLED_START=false
export GARBLED_START_MIN_LENGTH=1000
export GARBLED_START_MAX_LENGTH=5000
export GARBLED_END_LENGTH=500
export ENABLE_GARBLED_END=false

node src/server/index.mjs
