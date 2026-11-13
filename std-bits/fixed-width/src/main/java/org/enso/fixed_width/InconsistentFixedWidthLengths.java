package org.enso.fixed_width;

import org.enso.base.polyglot.EnsoMeta;
import org.enso.table.problems.Problem;
import org.graalvm.polyglot.Value;

/** A problem indicating that a fixed-width file had lines of different lengths. */
public record InconsistentFixedWidthLengths() implements Problem {
  @Override
  public Value asEnsoValue() {
    return EnsoMeta.makeInstance(
        "Standard.Fixed_Width.Errors", "Inconsistent_Fixed_Width_Lengths", "Error");
  }
}
