package org.enso.runner;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.enso.common.ProcessEnvironment;

/**
 * The line a standby engine reads from stdin (Note [Standby Mode] in {@code Standby}): the
 * arguments {@code project/open} would have passed, and the open's own environment variables, as
 * {@code {"args":["--server",...],"env":{"LANGUAGE_SERVER_CHANNEL_TOKEN":"..."}}}.
 *
 * @param args the arguments, as if they had been on the command line
 * @param env the open's variables; only the names below are accepted
 */
record StandbyRequest(List<String> args, Map<String, String> env) {
  /** The variables the Language Server reads through its configuration, and their properties. */
  static final Map<String, String> CONFIG_PROPERTIES =
      Map.of("LANGUAGE_SERVER_CHANNEL_TOKEN", "language-server.channel-token");

  /** The variables read through {@link ProcessEnvironment}. */
  static final Set<String> PROCESS_VARIABLES =
      Set.of("ENSO_LOCAL_PROJECT_ID", "ENSO_LOCAL_PROJECT_SESSION_ID");

  /**
   * @param line the line, without its newline
   * @return the request it holds
   * @throws IllegalArgumentException when it is not a valid line
   */
  static StandbyRequest parse(String line) {
    if (!(new StandbyJson(line).document() instanceof Map<?, ?> object)) {
      throw new IllegalArgumentException("the argument line is not a JSON object");
    }
    for (var key : object.keySet()) {
      if (!"args".equals(key) && !"env".equals(key)) {
        throw new IllegalArgumentException("unknown key " + key + " in the argument line");
      }
    }
    if (!(object.get("args") instanceof List<?> list)) {
      throw new IllegalArgumentException("\"args\" must be an array of strings");
    }
    var args = new ArrayList<String>();
    for (var arg : list) {
      if (!(arg instanceof String text)) {
        throw new IllegalArgumentException("\"args\" must be an array of strings");
      }
      args.add(text);
    }
    var env = new LinkedHashMap<String, String>();
    var rawEnv = object.get("env");
    if (rawEnv != null) {
      if (!(rawEnv instanceof Map<?, ?> map)) {
        throw new IllegalArgumentException("\"env\" must be an object of strings");
      }
      for (var entry : map.entrySet()) {
        var name = (String) entry.getKey();
        if (!(entry.getValue() instanceof String value)) {
          throw new IllegalArgumentException("\"env\" must be an object of strings");
        }
        if (!CONFIG_PROPERTIES.containsKey(name) && !PROCESS_VARIABLES.contains(name)) {
          throw new IllegalArgumentException("cannot apply the environment variable " + name);
        }
        env.put(name, value);
      }
    }
    return new StandbyRequest(List.copyOf(args), Collections.unmodifiableMap(env));
  }

  /**
   * Set each variable as the property it is read through, and drop the configuration library's
   * cached view of the properties, which the warm-up or the logging may already have taken.
   */
  void applyEnvironment() {
    for (var entry : env.entrySet()) {
      var property = CONFIG_PROPERTIES.get(entry.getKey());
      System.setProperty(
          property != null ? property : ProcessEnvironment.PROPERTY_PREFIX + entry.getKey(),
          entry.getValue());
    }
    com.typesafe.config.ConfigFactory.invalidateCaches();
  }
}
