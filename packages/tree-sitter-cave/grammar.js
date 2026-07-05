/**
 * Tree-sitter grammar for CAVE (spec §16, §3–§8).
 *
 * Line-oriented: newlines are structural (one claim per physical line), so
 * no external scanner is needed. Spaces and tabs are extras — indentation is
 * skipped, and qualifier/continuation lines are recognized by their leading
 * verb; parent attachment (spec §8) is left to consumers.
 *
 * Lexical disambiguation mirrors spec §4.3: `@` + space is confidence, `@` +
 * no space is context; `#` begins a tag; a trailing `:` turns a word into an
 * attribute; digit-led words are values. Verb-shaped words win over entities
 * by token precedence, so `CONTAINS REVERSE PART-OF` parses as a claim with
 * a verb-shaped subject; ties between that shape and a continuation line
 * (spec §8.3) go to the claim via dynamic precedence, matching the
 * @cavelang/parser tiebreak for lines like `API NEEDS auth`.
 */

const NL = /\r?\n/

module.exports = grammar({
  name: 'cave',

  extras: () => [/[ \t]/],

  rules: {
    document: $ => seq(optional($._line), repeat(seq(NL, optional($._line)))),

    _line: $ => choice(
      $.comment_line,
      $.qualifier_line,
      $.claim_line,
      $.continuation_line
    ),

    comment_line: $ => $.comment,

    claim_line: $ => seq(
      field('subject', choice($._term, alias($.verb, $.entity))),
      $._body
    ),

    // Bare relational verb; the subject is inherited from the parent (§8.3).
    continuation_line: $ => prec.dynamic(-1, $._body),

    _body: $ => choice(
      prec.right(seq(
        field('verb', $.verb),
        optional($.negation),
        field('payload', $._payload),
        repeat($._meta),
        optional($.comment)
      )),
      // Bare existence — the only payload-less shape (§16).
      prec.right(seq(
        field('verb', alias('EXISTS', $.verb)),
        optional($.negation),
        repeat($._meta),
        optional($.comment)
      ))
    ),

    qualifier_line: $ => seq(
      field('verb', $.qualifier_verb),
      optional($.negation),
      field('payload', $._qualifier_payload),
      repeat($._meta),
      optional($.comment)
    ),

    qualifier_verb: () => choice('WHEN', 'UNLESS', 'VIA', 'BECAUSE'),

    negation: () => 'NOT',

    // Payload (§16): attribute/value, metric value, or relational object.
    _payload: $ => choice($.attr_value, $.value, $.object),

    attr_value: $ => seq(
      field('attribute', $.attribute),
      field('value', choice($.value, $._term))
    ),

    // `20B USD/yr`, `30ms`, `~1000 req/s`, `2026-Q1` — number then unit (§7.1).
    value: $ => seq($.number, optional(alias($.entity, $.unit))),

    object: $ => choice(
      $.string,
      $.code,
      seq($.entity, repeat(choice($.entity, alias($.verb, $.entity)))),
      alias($.verb, $.entity)
    ),

    // Qualifier payload (§8.2): comparison, nested claim, or bare condition.
    _qualifier_payload: $ => choice(
      $.comparison,
      seq(field('subject', $._term), $._body),
      $._term
    ),

    comparison: $ => seq(
      field('left', $._term),
      field('operator', $.comparison_op),
      field('right', choice($.value, $._term))
    ),

    comparison_op: () => choice('>', '<', '>=', '<=', '=', '!='),

    _term: $ => choice($.entity, $.string, $.code),

    _meta: $ => choice(
      $.context,
      $.confidence,
      $.tag,
      $.uncertainty,
      $.sigma,
      $.importance
    ),

    // `+/- 2B USD/yr` — symmetric value uncertainty (§7.2).
    uncertainty: $ => seq('+/-', $.value),

    tag: $ => seq(
      '#',
      field('key', alias(token.immediate(/[^ \t\r\n;:]+/), $.tag_key)),
      optional(seq(
        token.immediate(':'),
        field('value', alias(token.immediate(/[^ \t\r\n;]+/), $.tag_value))
      ))
    ),

    // Declared before `entity` — the earlier rule wins the all-uppercase tie;
    // longer mixed-case words (`OpenAI`) still lex as entities by length, and
    // keywords (`NOT`, `WHEN`, …) win as strings over this regex.
    verb: () => /[A-Z][A-Z-]*/,

    entity: () => /[A-Za-z_][A-Za-z0-9_./-]*/,

    attribute: () => token(/[A-Za-z_][A-Za-z0-9_./-]*:/),

    number: () => /~?[0-9][0-9A-Za-z.,%_-]*/,

    string: () => token(seq('"', /[^"\r\n]*/, '"')),

    code: () => token(seq('`', /[^`\r\n]*/, '`')),

    context: () => token(/@[^ \t\r\n;]+/),

    confidence: () => token(/@[ \t]+[0-9]+(\.[0-9]+)?%/),

    sigma: () => token(/\([0-9]+(\.[0-9]+)?σ\)/),

    importance: () => '!',

    comment: () => token(/;[^\r\n]*/)
  }
})
