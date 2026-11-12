package org.enso.interpreter.runtime.data;

import com.oracle.truffle.api.interop.InteropLibrary;
import com.oracle.truffle.api.interop.TruffleObject;
import com.oracle.truffle.api.library.ExportLibrary;
import com.oracle.truffle.api.library.ExportMessage;
import org.enso.common.LanguageInfo;

/** All non-primitive Enso types extends from {@code EnsoObject}. */
@ExportLibrary(InteropLibrary.class)
public abstract class EnsoObject implements TruffleObject {
  // Truffle 25.1 replaced `hasLanguage`/`getLanguage` (a language class) with these two (its id).
  // The deprecated pair still works for callers: InteropLibrary derives it from these.
  @ExportMessage
  public boolean hasLanguageId() {
    return true;
  }

  @ExportMessage
  public String getLanguageId() {
    return LanguageInfo.ID;
  }

  /**
   * This abstract method needs to be declared here with the annotation {@code @ExportMessage} so
   * that the Truffle DSL is satisfied.
   */
  @ExportMessage
  public abstract Object toDisplayString(boolean allowSideEffects);
}
