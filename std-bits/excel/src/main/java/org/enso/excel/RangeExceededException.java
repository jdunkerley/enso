package org.enso.excel;

public class RangeExceededException extends Exception {
  public RangeExceededException(String errorMessage) {
    super(errorMessage);
  }
}
