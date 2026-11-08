package org.enso.runner;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A strict reader for the standby argument line: JSON objects, arrays and strings only, which is
 * all the line holds (Note [Standby Mode] in {@code Standby}). Anything else is an {@link
 * IllegalArgumentException}. The runner has no JSON library, and must stay Native-Image friendly.
 *
 * <p>Errors name positions and keys only, never values: the line carries the channel token.
 */
final class StandbyJson {
  private final String text;
  private int pos;

  StandbyJson(String text) {
    this.text = text;
  }

  /** The one value the text holds. */
  Object document() {
    skipSpace();
    var value = value();
    skipSpace();
    if (pos != text.length()) {
      throw error("trailing characters");
    }
    return value;
  }

  private Object value() {
    if (pos >= text.length()) {
      throw error("unexpected end");
    }
    return switch (text.charAt(pos)) {
      case '{' -> object();
      case '[' -> array();
      case '"' -> string();
      default -> throw error("only objects, arrays and strings are allowed");
    };
  }

  private Map<String, Object> object() {
    expect('{');
    var map = new LinkedHashMap<String, Object>();
    skipSpace();
    if (peek('}')) {
      pos++;
      return map;
    }
    while (true) {
      skipSpace();
      var key = string();
      skipSpace();
      expect(':');
      skipSpace();
      if (map.put(key, value()) != null) {
        throw error("duplicate key " + key);
      }
      skipSpace();
      if (peek(',')) {
        pos++;
        continue;
      }
      expect('}');
      return map;
    }
  }

  private List<Object> array() {
    expect('[');
    var list = new ArrayList<Object>();
    skipSpace();
    if (peek(']')) {
      pos++;
      return list;
    }
    while (true) {
      skipSpace();
      list.add(value());
      skipSpace();
      if (peek(',')) {
        pos++;
        continue;
      }
      expect(']');
      return list;
    }
  }

  private String string() {
    expect('"');
    var sb = new StringBuilder();
    while (true) {
      if (pos >= text.length()) {
        throw error("unterminated string");
      }
      char c = text.charAt(pos++);
      if (c == '"') {
        return sb.toString();
      }
      if (c < 0x20) {
        throw error("control character in a string");
      }
      if (c != '\\') {
        sb.append(c);
        continue;
      }
      if (pos >= text.length()) {
        throw error("unterminated escape");
      }
      char e = text.charAt(pos++);
      switch (e) {
        case '"', '\\', '/' -> sb.append(e);
        case 'b' -> sb.append('\b');
        case 'f' -> sb.append('\f');
        case 'n' -> sb.append('\n');
        case 'r' -> sb.append('\r');
        case 't' -> sb.append('\t');
        case 'u' -> {
          if (pos + 4 > text.length()) {
            throw error("short \\u escape");
          }
          var code = 0;
          for (var i = 0; i < 4; i++) {
            // Not `Integer.parseInt`, which accepts a sign: "+041" would pass as four digits.
            var digit = Character.digit(text.charAt(pos + i), 16);
            if (digit < 0) {
              throw error("bad \\u escape");
            }
            code = code * 16 + digit;
          }
          sb.append((char) code);
          pos += 4;
        }
        default -> throw error("bad escape");
      }
    }
  }

  private void skipSpace() {
    while (pos < text.length() && " \t\r\n".indexOf(text.charAt(pos)) >= 0) {
      pos++;
    }
  }

  private boolean peek(char c) {
    return pos < text.length() && text.charAt(pos) == c;
  }

  private void expect(char c) {
    if (!peek(c)) {
      throw error("expected '" + c + "'");
    }
    pos++;
  }

  private IllegalArgumentException error(String what) {
    return new IllegalArgumentException(what + " at character " + pos + " of the argument line");
  }
}
