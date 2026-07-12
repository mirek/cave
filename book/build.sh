#!/usr/bin/env sh
set -eu

expected="typst 0.15.0"
actual="$(typst --version)"
if [ "$actual" != "$expected" ]; then
  echo "expected $expected, got $actual" >&2
  exit 1
fi

mkdir -p website/public
typst compile --root . book/cave.typ website/public/cave-book.pdf
pdfinfo website/public/cave-book.pdf >/dev/null
pdftotext website/public/cave-book.pdf - | grep -q "Compressed Atomic Verb Expressions"
