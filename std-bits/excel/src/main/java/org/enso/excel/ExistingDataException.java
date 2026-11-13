package org.enso.excel;

public class ExistingDataException extends Exception {
  public ExistingDataException(String errorMessage) {
    super(errorMessage);
  }
}
