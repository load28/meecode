// Some protocol enum variants/fields are parsed for completeness but not all
// read yet (mirrors the upstream parser); `parse_str` is for callers/tests.
#[allow(dead_code)]
pub mod protocol;
pub mod spawn;
pub mod stdin_writer;
#[allow(dead_code)]
pub mod stdout_parser;
