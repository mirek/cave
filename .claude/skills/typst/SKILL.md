---
name: typst
description: Typst 0.15.0 authoring and PDF production guide. Use when creating or editing .typ sources, building books or technical documents, validating generated PDFs, or updating Typst-specific syntax. Version-pinned to the latest stable Typst release verified on 2026-07-12.
---

# Typst 0.15.0

This skill is the repository's version-pinned guide for authoring and reviewing Typst documents. The current stable release is **Typst 0.15.0** (released 2026-06-15). Re-check the upstream release page before changing the pinned version.

## Required workflow

1. Confirm the compiler version before editing or building:

   ```sh
   typst --version
   # expected: typst 0.15.0
   ```

2. Keep documents package-free unless a package provides material value. Local templates and fonts make CI and offline builds reproducible.
3. Compile from the repository root so project-relative paths resolve consistently:

   ```sh
   typst compile --root . book/cave.typ website/public/cave-book.pdf
   ```

4. For iterative work:

   ```sh
   typst watch --root . book/cave.typ website/public/cave-book.pdf
   ```

5. Validate the output, not only the source:

   ```sh
   pdfinfo website/public/cave-book.pdf
   pdftotext website/public/cave-book.pdf - | head
   python /home/oai/skills/pdfs/scripts/render_pdf.py \
     website/public/cave-book.pdf --out_dir /tmp/cave-book-render --dpi 160
   ```

   Inspect rendered pages for clipped text, broken glyphs, overfull code blocks, accidental blank pages, and inconsistent headings.

## Typst 0.15 changes to account for

- Project paths use forward slashes; backslashes in imported or image paths are invalid.
- The file `path` type can cross module and package boundaries while retaining its original resolution base.
- Variable fonts are supported. Refer to a family without `Variable`, `Var`, or `VF` suffixes.
- A document can contain multiple bibliographies.
- PDF export can target multiple PDF standards.
- HTML export emits equations as MathML.
- Experimental bundle export can produce multiple documents and assets.
- `typst eval` supersedes the older `typst query` CLI workflow.
- `within` selectors simplify ancestor-scoped introspection.
- `divider` is the semantic thematic-break element.

Do not use new 0.15 APIs solely for novelty. Prefer stable markup and library features when they produce the same result.

## Book structure

For long technical documents:

- Set page, text, paragraph, and heading defaults near the top of the root file.
- Use one level-1 heading per chapter and let `outline()` derive the table of contents.
- Keep code in raw blocks with a readable monospace fallback stack.
- Prefer ordinary tables, lists, figures, and callout functions over manual placement.
- Use `pagebreak(weak: true)` for chapter transitions where a preceding explicit break may already exist.
- Keep body text between 9.5pt and 11pt on A4 with approximately 22-25mm margins.
- Avoid dense full-width tables; split them or use concise cells.
- Use ASCII punctuation in source that must survive constrained renderers or text-only repository APIs.

## Reproducibility contract

The checked-in PDF is a release artifact, not the only source of truth. Every PDF change must include the corresponding `.typ` source change. The build must not depend on network-fetched images or unpinned remote packages. A reviewer with Typst 0.15.0 must be able to regenerate the same content from the repository root.

## Review checklist

- Compiler is exactly the pinned version or the version pin is intentionally updated.
- No warnings are ignored without an explanatory source comment.
- Table of contents entries and PDF bookmarks match chapter headings.
- Code lines fit the page or wrap intentionally.
- Page headers and footers do not collide with content.
- PDF metadata has a useful title and author.
- `pdfinfo`, text extraction, and rendered-page inspection succeed.
- The website link points to the checked-in output path.
