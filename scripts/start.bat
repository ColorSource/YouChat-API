@echo off
setlocal
cd /d "%~dp0.."

if not exist "node_modules" (
    echo node_modules not found, running npm install...
    call npm install
)

REM Avoid loading stale injected modules from environment
set NODE_OPTIONS=

REM Browser settings
set BROWSER_TYPE=auto
set USE_MANUAL_LOGIN=false
set HEADLESS_BROWSER=false
set BROWSER_INSTANCE_COUNT=1

REM Session settings
set SESSION_LOCK_TIMEOUT=180
set ENABLE_DETECTION=false
set ENABLE_AUTO_COOKIE_UPDATE=false
set SKIP_ACCOUNT_VALIDATION=false
set ENABLE_REQUEST_LIMIT=false
set ALLOW_NON_PRO=false

REM Request behavior
set CUSTOM_END_MARKER="<CHAR_turn>"
set ENABLE_DELAY_LOGIC=false

REM Proxy settings
set https_proxy=

REM Server settings
set PASSWORD=REPLACE_WITH_STRONG_PASSWORD
set PORT=8080
set AI_MODEL=

REM Mode settings
set USE_CUSTOM_MODE=false
set ENABLE_MODE_ROTATION=false
set INCOGNITO_MODE=false

REM Upload/settings
set USE_BACKSPACE_PREFIX=false
set UPLOAD_FILE_FORMAT=txt
set CLEWD_ENABLED=false

REM Garbled text settings
set ENABLE_GARBLED_START=false
set GARBLED_START_MIN_LENGTH=1000
set GARBLED_START_MAX_LENGTH=5000
set GARBLED_END_LENGTH=500
set ENABLE_GARBLED_END=false

node src/server/index.mjs
pause
