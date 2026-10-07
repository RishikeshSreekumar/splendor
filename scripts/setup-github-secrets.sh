#!/usr/bin/env bash
# Stores the Deploy workflow's secrets in GitHub without printing them. Modal credentials come
# from .env.local; the database URL and Vercel token are asked for (input hidden).
#   SUPABASE_DB_URL  Supabase → Connect → Session pooler URI, with the database password filled in
#   VERCEL_TOKEN     vercel.com/account/tokens, scoped to the sudip-mondals-projects team
set -euo pipefail
REPO=sudip-mondal-2002/splendor
cd "$(dirname "$0")/.."

from_env() { grep -E "^$1=" .env.local | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
put() {
  [ -n "$2" ] || { echo "Missing $1" >&2; exit 1; }
  printf '%s' "$2" | gh secret set "$1" --repo "$REPO"
}

put MODAL_TOKEN_ID "$(from_env MODAL_TOKEN_ID)"
put MODAL_TOKEN_SECRET "$(from_env MODAL_TOKEN_SECRET)"
for name in SUPABASE_DB_URL VERCEL_TOKEN; do
  read -rsp "$name: " value
  echo
  put "$name" "$value"
done
gh secret list --repo "$REPO"
