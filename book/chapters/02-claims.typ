#import "../style.typ": note, file, recap

= Claims

This chapter introduces the roastery that the rest of the book follows, and
uses it to explain exactly what a claim line may contain: names, the two
payload shapes, literals, and comments.

== The roastery

A small roastery buys green coffee from cooperatives, roasts it into blends
and single origins, and sells those to a few cafes. Here is that world in
CAVE, the file every later chapter starts from:

#file("roastery.cave")
```cave
; the roastery: what we buy, what we roast, who we sell to

SUPPLIES IS verb ; supplier X sells us green coffee lot Y
SUPPLIES REVERSE SUPPLIED-BY
STOCKS IS verb ; cafe X keeps coffee Y on its menu
STOCKS REVERSE STOCKED-BY

kaffa-coop IS supplier
la-cima IS supplier
kaffa-coop HAS country: ethiopia
la-cima HAS country: colombia

lot/yirgacheffe-26 IS lot
lot/huila-26 IS lot
lot/santa-ana-26 IS lot
kaffa-coop SUPPLIES lot/yirgacheffe-26
la-cima SUPPLIES lot/huila-26
la-cima SUPPLIES lot/santa-ana-26

lot/yirgacheffe-26 HAS
  process: washed
  price: 9.40 USD/kg
  score: 87 @src:cupping/june
lot/huila-26 HAS
  process: natural
  price: 7.80 USD/kg
  score: 84 @src:cupping/june
lot/santa-ana-26 HAS
  process: washed
  price: 8.10 USD/kg
  score: 85 @src:cupping/june ; clean, but nothing remarkable

coffee/morning-blend IS coffee
coffee/morning-blend USES lot/huila-26
coffee/morning-blend USES lot/santa-ana-26
coffee/yirgacheffe IS coffee
coffee/yirgacheffe USES lot/yirgacheffe-26

cafe/north IS cafe
cafe/harbour IS cafe
cafe/north STOCKS coffee/morning-blend
cafe/north STOCKS coffee/yirgacheffe
cafe/harbour STOCKS coffee/morning-blend
```

Read it top to bottom and it tells a story: two suppliers, three lots with a
price and a cupping score each, two coffees made from those lots, and two
cafes that stock them. The first four lines declare two verbs of our own and
their reverse readings; Chapter 3 explains them. The indented blocks under
`HAS` are a shorthand for repeating the prefix; Chapter 6 explains that. For
now, lint the file and load it:

```sh
$ cave parse roastery.cave
ok: 1 comment, 7 blank, 33 claim, 3 prefix

$ cave add --db roastery.db roastery.cave
added 33 claim(s), 0 edge(s)
```

== Two shapes of payload

A claim is a subject, a verb, and a *payload*. The payload comes in two
shapes, and the difference is one colon.

A *relation* connects two things:

```cave
la-cima SUPPLIES lot/huila-26
cafe/north STOCKS coffee/yirgacheffe
```

An *attribute* gives a thing a named property with a value:

```cave
la-cima HAS country: colombia
lot/huila-26 HAS price: 7.80 USD/kg
```

The colon is not decoration. Without it, `lot/huila-26 HAS price 7.80 USD/kg`
could mean an object called `price 7.80 USD/kg` or an attribute `price` with a
value; a query engine has to know which. So attribute claims always use
`attribute: value`, and the parser only reads a colon that way in payload
position. There is a third, minor shape for a bare measurement, the *metric*
claim, which is `IS` with a value and no attribute name:

```cave
roaster/temperature IS 205 C
```

Most of the time you will want `HAS attribute: value` instead, because it
names what is being measured.

== Names

A name is a compact, lowercase, kebab-case token. A slash scopes it, and up to
three segments read naturally as `domain/entity/aspect`:

```text
lot/huila-26
cafe/north
roaster/drum/temperature
```

Proper nouns keep their capitals (`PostgreSQL`, `Colombia`), but the roastery
file writes `colombia` because it is a value, not an entity anyone will query
by name. The single most valuable habit in CAVE is spelling the same thing the
same way every time. `la-cima` and `La Cima` and `lacima` are three entities to
a store until you tell it otherwise (Chapter 12 shows how), and no amount of
metadata makes up for a name that drifts.

Two characters do double duty and are worth a moment. A slash inside a name
means scope; a slash after a number means "per", as in `USD/kg`. A colon in a
payload separates attribute from value; a colon inside a `#tag` splits key
from value (Chapter 4). In both cases the position decides, and the
disambiguation is one character of lookahead.

== Literals

Sometimes the object is not a name but a piece of exact text. Backticks keep
code-like text exactly as written, and double quotes hold natural language:

```cave
grinder/harbour LOGS `E_BURR_TEMP`
step/1 IS "rest the beans for three days"
```

Inside either kind of literal nothing is special: a `;` or `@` or `#` is just
a character. Use literals when a name would be a lie, and names everywhere
else, because names are what queries join on.

== Comments

A semicolon starts a comment, and the comment is *part of the claim*: it is
stored with the row, exported with it, and searchable.

```cave
lot/santa-ana-26 HAS score: 85 @src:cupping/june ; clean, but nothing remarkable
```

A comment can be longer than one line. A block of `;` lines directly above a
claim is part of that claim's comment, and the trailing `; note` on the claim
line, if there is one, is its last line:

#file("cupping-notes.cave")
```cave
; the June cupping, scored by two of us and averaged

; the santa-ana lot cupped clean, but the finish
; was flat by the third cup
lot/santa-ana-26 HAS score: 85 @src:cupping/june ; averaged from two scores
```

The first line is separated from the claim by a blank line, so it stays a
note about the file. The block under it belongs to the claim, and it comes
back with the claim wherever the claim is printed:

```sh
$ cave add --db notes.db cupping-notes.cave
added 1 claim(s), 0 edge(s)

$ cave query --db notes.db 'lot/santa-ana-26 HAS score: ?s'
; the santa-ana lot cupped clean, but the finish
; was flat by the third cup
?s = 85  ; averaged from two scores
```

A comment with nothing but a blank line between it and the next claim is
documentation for the file and is not stored, which is what the first line of
`roastery.cave` is. Comments are the escape hatch for nuance that does not
fit a triple, and the file above uses them sparingly on purpose. When you
catch yourself writing a paragraph after a semicolon, the paragraph probably
contains three more claims.

== Lint before you load

`cave parse` reads text and reports what it found: how many claims, blank
lines, comments, and prefix headers. When a line is malformed it prints the
problem with its line number and exits with status 1, which makes it a cheap
pre-commit check for hand-written files.

```sh
$ printf 'la-cima SUPPLIES\n' | cave parse
1 invalid, 1 blank
line 1: missing object after SUPPLIES (the minimum line is "entity VERB object", spec §2.2)
[exit 1]
```

`cave add` is lenient by default: valid lines land, problems go to standard
error. `cave add --strict` refuses the whole file if anything is wrong, which
is the right setting for files that other people review.

#recap[A claim is `subject VERB object` or `subject HAS attribute: value`.
Names are lowercase and slash-scoped; spell each entity the same way
everywhere. Backticks and quotes hold exact text; `;` starts a comment that
is stored with the claim. `cave parse` lints, `cave add` loads.]
