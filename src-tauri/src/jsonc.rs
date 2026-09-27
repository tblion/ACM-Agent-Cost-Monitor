pub fn strip_comments(text: &str) -> String {
    let c: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let (mut in_str, mut in_line, mut in_block) = (false, false, false);
    let mut i = 0;
    while i < c.len() {
        let ch = c[i];
        let next = c.get(i + 1).copied().unwrap_or('\0');
        if in_line {
            if ch == '\n' {
                in_line = false;
                out.push(ch);
            }
            i += 1;
        } else if in_block {
            if ch == '*' && next == '/' {
                in_block = false;
                i += 2;
            } else {
                i += 1;
            }
        } else if in_str {
            out.push(ch);
            if ch == '\\' && i + 1 < c.len() {
                out.push(c[i + 1]);
                i += 2;
            } else {
                if ch == '"' {
                    in_str = false;
                }
                i += 1;
            }
        } else {
            match (ch, next) {
                ('"', _) => {
                    in_str = true;
                    out.push(ch);
                    i += 1;
                }
                ('/', '/') => {
                    in_line = true;
                    i += 2;
                }
                ('/', '*') => {
                    in_block = true;
                    i += 2;
                }
                _ => {
                    out.push(ch);
                    i += 1;
                }
            }
        }
    }
    out
}

/// Remove trailing commas (before `}` or `]`) while respecting strings.
/// Call AFTER strip_comments: a comma before a comment is only detectable
/// as trailing once the comment has been removed.
pub fn strip_trailing_commas(text: &str) -> String {
    let c: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut in_str = false;
    let mut i = 0;
    while i < c.len() {
        let ch = c[i];
        if in_str {
            out.push(ch);
            if ch == '\\' && i + 1 < c.len() {
                out.push(c[i + 1]);
                i += 2;
            } else {
                if ch == '"' {
                    in_str = false;
                }
                i += 1;
            }
        } else {
            match ch {
                '"' => {
                    in_str = true;
                    out.push(ch);
                    i += 1;
                }
                ',' => {
                    let mut j = i + 1;
                    while j < c.len()
                        && (c[j] == ' ' || c[j] == '\t' || c[j] == '\n' || c[j] == '\r')
                    {
                        j += 1;
                    }
                    if j < c.len() && (c[j] == '}' || c[j] == ']') {
                        i += 1; // Skip the trailing comma.
                    } else {
                        out.push(ch);
                        i += 1;
                    }
                }
                _ => {
                    out.push(ch);
                    i += 1;
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strips_line_and_block() {
        let out = strip_comments("{ // ligne\n\"a\": 1 /* bloc */ }");
        assert!(out.contains("\"a\": 1"));
        assert!(!out.contains("ligne"));
        assert!(!out.contains("bloc"));
    }
    #[test]
    fn keeps_slash_in_string() {
        let out = strip_comments("{ \"url\": \"https://x.com\" }");
        assert!(out.contains("https://x.com"));
    }
    #[test]
    fn keeps_escaped_quote() {
        let out = strip_comments("{ \"s\": \"a\\\"b\" } // c");
        assert!(out.contains("a\\\"b"));
        assert!(!out.contains("// c"));
    }
    #[test]
    fn strips_trailing_comma_obj_and_arr() {
        let out = strip_trailing_commas("{ \"a\": 1, }");
        assert_eq!(out, "{ \"a\": 1 }");
        let out = strip_trailing_commas("[1, 2,]");
        assert_eq!(out, "[1, 2]");
    }
    #[test]
    fn keeps_comma_in_string_and_before_value() {
        let out = strip_trailing_commas("{ \"url\": \"a,b\", \"x\": 1 }");
        assert_eq!(out, "{ \"url\": \"a,b\", \"x\": 1 }");
    }
    #[test]
    fn trailing_comma_after_comment_removal() {
        // Real case: comma, then comment, then }.
        let text = "{ \"a\": 1,\n// commenté\n}";
        let out = strip_trailing_commas(&strip_comments(text));
        // The trailing comma is removed; line breaks around the comment remain.
        assert_eq!(out, "{ \"a\": 1\n\n}");
        // The result is valid strict JSON.
        assert!(serde_json::from_str::<serde_json::Value>(&out).is_ok());
    }
}
