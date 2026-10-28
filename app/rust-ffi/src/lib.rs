use wasm_bindgen::prelude::*;

use enso_parser::Parser;
use enso_parser::queries;

thread_local! {
    pub static PARSER: Parser = Parser::new();
}

#[wasm_bindgen]
pub fn parse_module(code: &str) -> Vec<u8> {
    let ast = PARSER.with(|parser| parser.parse_module(code));
    enso_parser::format::serialize(&ast).expect("Failed to serialize AST to binary format")
}

#[wasm_bindgen]
pub fn parse_block(code: &str) -> Vec<u8> {
    let ast = PARSER.with(|parser| parser.parse_block(code));
    enso_parser::format::serialize(&ast).expect("Failed to serialize AST to binary format")
}

/// See [`queries::is_ident_or_operator`]; the logic is shared with the JNI binding.
#[wasm_bindgen]
pub fn is_ident_or_operator(code: &str) -> u32 {
    queries::is_ident_or_operator(code)
}

/// See [`queries::self_arg_separator`]; the logic is shared with the JNI binding.
#[wasm_bindgen]
pub fn self_arg_separator(code: &str) -> i32 {
    queries::self_arg_separator(code)
}

/// See [`queries::is_numeric_literal`]; the logic is shared with the JNI binding.
#[wasm_bindgen]
pub fn is_numeric_literal(code: &str) -> bool {
    PARSER.with(|parser| queries::is_numeric_literal(parser, code))
}

#[wasm_bindgen(start)]
fn main() {
    console_error_panic_hook::set_once();
}
