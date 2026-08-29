Record each article as one `news/<date>/<slug>` entity: `IS news`, a
`HAS headline:` attribute with the exact headline, and one `AFFECTS` claim per
theme it moves, tagged `#direction:up` or `#direction:down` with your
confidence. Use only the themes already declared in the store
(`?t IS theme`): `theme/ai-capex`, `theme/export-controls`,
`theme/datacenter-power`. Do not write claims about companies — rules derive
those from theme exposure.
