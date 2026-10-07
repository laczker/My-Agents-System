#!/bin/sh
# Checks that every bot's CLAUDE.md carries the two shared conventions from
# docs/META_BOT.md section 3: the Czech-language rule and the [TICHO] rule
# (no intermediate Telegram messages during cross-session turns).
# Read-only; exit 1 if any bot lacks one of them.
cd "$(dirname "$0")" || exit 2
rc=0
for f in personal/*/CLAUDE.md; do
  grep -q '^## Jazyk' "$f" || { echo "MISSING language section: $f"; rc=1; }
  grep -q '\[TICHO\]' "$f" || { echo "MISSING [TICHO] rule: $f"; rc=1; }
done
[ $rc -eq 0 ] && echo "OK: all bot CLAUDE.md files follow shared conventions"
exit $rc
