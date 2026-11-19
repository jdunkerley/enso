//! Small questions about a snippet of code that the GUI asks the parser.
//!
//! Both bindings of the parser expose these: the WASM one (`app/rust-ffi`) for the GUI, and the JNI
//! one (`lib/rust/parser/jni`) for the ydoc server running inside the JVM. Keeping the logic here
//! means the two cannot drift apart.

use crate::Parser;
use crate::syntax::token;
use crate::syntax::token::TokenOperatorProperties;
use crate::syntax::tree;

/// Determine whether the input is a single identifier or operator token.
///
/// Returns:
/// * 1 - if the input is a single identifier.
/// * 2 - if the input is a single operator.
/// * 0 - otherwise.
pub fn is_ident_or_operator(code: &str) -> u32 {
    let parsed = crate::lexer::run(code);
    if parsed.internal_error.is_some() {
        return 0;
    }
    let token = match &parsed.value[..] {
        [token] => token,
        _ => return 0,
    };
    match &token.variant {
        token::Variant::Ident(_) => 1,
        token::Variant::Operator(_) => 2,
        _ => 0,
    }
}

/// The binary infix precedence and associativity of a single operator token.
///
/// Returns:
/// * 0 - if the input is not exactly one (non-syntactic) operator with a binary infix precedence.
/// * otherwise - bits 0-7 hold [`token::Precedence::into_u8`], and bit 8 is set for a
///   right-associative operator.
///
/// The GUI uses it to draw operator chains (`app/gui/src/project-view/util/operatorChain.ts`).
pub fn binary_operator_info(code: &str) -> u32 {
    let parsed = crate::lexer::run(code);
    if parsed.internal_error.is_some() {
        return 0;
    }
    let [token] = &parsed.value[..] else { return 0 };
    if !matches!(token.variant, token::Variant::Operator(_)) {
        return 0;
    }
    let Some(properties) = token.operator_properties() else { return 0 };
    let Some(precedence) = properties.binary_infix_precedence() else { return 0 };
    let right = properties.associativity() == token::Associativity::Right;
    precedence.into_u8() as u32 | (right as u32) << 8
}

/// What should separate this expression from self argument applied to it.
///
/// See `selfArgSeparator` docs in `app/ydoc-shared/src/ast/token.ts`.
///
/// Returns:
/// * -1 - if `self` should be joined with dot.
/// * non-negative integer - if `self` should be joined with returned number of spaces.
pub fn self_arg_separator(code: &str) -> i32 {
    let parsed = crate::lexer::run(code);
    if parsed.internal_error.is_some() {
        return 0;
    }
    let (token, right_spacing) = match &parsed.value[..] {
        [token, next_token, ..] => (token, next_token.left_offset.visible.width_in_spaces),
        [token] => (token, 1),
        [] => return -1,
    };
    if token.operator_properties().is_some() { right_spacing as i32 } else { -1 }
}

/// Determine whether the input is a single numeric literal, optionally negated with a unary minus.
pub fn is_numeric_literal(parser: &Parser, code: &str) -> bool {
    let parsed = parser.parse_block(code);
    let tree::Variant::BodyBlock(body) = parsed.variant else { return false };
    let [stmt] = &body.statements[..] else { return false };
    let Some(stmt) = &stmt.expression else { return false };
    let tree::Variant::ExpressionStatement(stmt) = &stmt.variant else {
        return false;
    };
    match &stmt.expression.variant {
        tree::Variant::Number(_) => true,
        tree::Variant::UnaryOprApp(app) => {
            app.opr.code == "-" && matches!(&app.rhs.variant, tree::Variant::Number(_))
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_numeric_literal() {
        let parser = Parser::new();
        let is_numeric_literal = |code| is_numeric_literal(&parser, code);
        assert!(is_numeric_literal("1234"));
        assert!(is_numeric_literal("-1234"));
        assert!(!is_numeric_literal(""));
        assert!(!is_numeric_literal("-"));
        assert!(!is_numeric_literal("1-234"));
        assert!(!is_numeric_literal("1234!"));
        assert!(!is_numeric_literal("1234e5"));
    }

    #[test]
    fn test_is_ident_or_operator() {
        assert_eq!(is_ident_or_operator("abc"), 1);
        assert_eq!(is_ident_or_operator("Abc"), 1);
        assert_eq!(is_ident_or_operator("abc 14"), 0);
        assert_eq!(is_ident_or_operator("+"), 2);
        assert_eq!(is_ident_or_operator("+ 2"), 0);
        assert_eq!(is_ident_or_operator("[]"), 0);
    }

    #[test]
    fn test_self_arg_separator() {
        assert_eq!(self_arg_separator("abc"), -1);
        assert_eq!(self_arg_separator("abc 14"), -1);
        assert_eq!(self_arg_separator("+"), 1);
        assert_eq!(self_arg_separator("+ 2"), 1);
        assert_eq!(self_arg_separator("+2"), 0);
        assert_eq!(self_arg_separator("- 2"), 1);
        assert_eq!(self_arg_separator("-2"), 0);
        assert_eq!(self_arg_separator("[]"), -1);
    }

    fn operator_info(code: &str) -> Option<(u8, bool)> {
        match binary_operator_info(code) {
            0 => None,
            v => Some(((v & 0xff) as u8, v & 0x100 != 0)),
        }
    }

    #[test]
    fn test_binary_operator_info() {
        use token::Precedence;
        assert_eq!(operator_info("+"), Some((Precedence::Addition.into_u8(), false)));
        assert_eq!(operator_info("-"), Some((Precedence::Addition.into_u8(), false)));
        assert_eq!(operator_info("*"), Some((Precedence::Multiplication.into_u8(), false)));
        assert_eq!(operator_info("&&"), Some((Precedence::Logical.into_u8(), false)));
        assert_eq!(operator_info("=="), Some((Precedence::Equality.into_u8(), false)));
        assert_eq!(operator_info(">"), Some((Precedence::Inequality.into_u8(), false)));
        assert_eq!(operator_info("<|"), Some((Precedence::Functional.into_u8(), true)));
        assert_eq!(operator_info("^"), Some((Precedence::Exponentiation.into_u8(), false)));
    }

    #[test]
    fn test_binary_operator_info_rejects_non_operators() {
        for code in ["", "a", ".", "=", "->", ",", ":", "..", "+ +", "1"] {
            assert_eq!(binary_operator_info(code), 0, "{code:?}");
        }
    }
}
