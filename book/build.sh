#!/usr/bin/env sh
set -eu

actual="$(typst --version)"
case "$actual" in
  "typst 0.15.0"*) ;;
  *)
    echo "expected Typst 0.15.0, got $actual" >&2
    exit 1
    ;;
esac

mkdir -p website/public
typst compile --root . book/cave.typ website/public/cave-book.pdf
pdfinfo website/public/cave-book.pdf >/dev/null
pdftotext website/public/cave-book.pdf - | grep -q "Compressed Atomic Verb Expressions"
