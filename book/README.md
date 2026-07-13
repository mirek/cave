# CAVE book

`cave.typ` is the source for the checked-in website artifact at
`website/public/cave-book.pdf`.

The build is pinned to Typst 0.15.0:

```sh
sh book/build.sh
```

The PDF is intentionally committed so the GitHub Pages site can link to a stable
artifact without a runtime document build. Source and PDF must change together.
The build fixes `SOURCE_DATE_EPOCH`, so repeated builds from the same source are
byte-for-byte reproducible. The book workflow rebuilds and validates the PDF
whenever its source changes.
