; CAVE highlighting (spec §3–§8). Capture names follow the common
; nvim/helix vocabulary; one capture per node so query order does not
; matter across editors.

(comment) @comment

(verb) @keyword
(qualifier_verb) @keyword
(negation) @keyword.operator

(entity) @variable
(unit) @type

(attribute) @property

(number) @number
(string) @string
(code) @string.special

(context) @label
(confidence) @constant
(sigma) @constant

(comparison_op) @operator
(importance) @operator
(uncertainty "+/-" @operator)
(value "->" @operator)

(tag "#" @punctuation.special)
(tag ":" @punctuation.delimiter)
(tag_key) @tag
(tag_value) @constant
