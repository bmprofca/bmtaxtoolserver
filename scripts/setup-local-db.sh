#!/usr/bin/env bash
# Local MySQL for development when Hostinger Remote MySQL is blocked.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_NAME="${DB_NAME:-u278432002_tool}"
ENV_LOCAL="$ROOT/.env.local"

echo "==> Installing MySQL (Homebrew) if needed..."
if ! brew list mysql@8.0 &>/dev/null; then
  brew install mysql@8.0
fi

MYSQL_BIN="$(brew --prefix mysql@8.0)/bin"
export PATH="$MYSQL_BIN:$PATH"

echo "==> Starting MySQL service..."
brew services start mysql@8.0 >/dev/null 2>&1 || true
sleep 2

echo "==> Creating database $DB_NAME..."
"$MYSQL_BIN/mysql" -u root -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

cat >"$ENV_LOCAL" <<EOF
# Local development database (overrides server/.env — gitignored)
# Run: npm run db:local  then  npm run dev
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=$DB_NAME
DB_USER=root
DB_PASSWORD=
DB_CONNECT_TIMEOUT_MS=3000
EOF

echo ""
echo "Wrote $ENV_LOCAL"
echo "Database ready at 127.0.0.1:3306 / $DB_NAME (user root, no password)"
echo ""
echo "Next: cd .. && npm run dev"
echo "Tables are created automatically on first API start."
