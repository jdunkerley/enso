## Enso Signatures 1.0
## module Standard.Fixed_Width.Errors
- type Fixed_Width_Line_Too_Long
    - handle_java_exception -> Standard.Base.Any.Any
    - to_display_text self -> Standard.Base.Data.Text.Text
    - to_js_object self -> Standard.Base.Any.Any
- type Inconsistent_Fixed_Width_Lengths
    - Error
    - to_display_text self -> Standard.Base.Any.Any
- type Invalid_Fixed_Width_Row
    - Error source_line_number:Standard.Base.Data.Numbers.Integer table_row_number:(Standard.Base.Data.Numbers.Integer|Standard.Base.Nothing.Nothing) line_length:(Standard.Base.Data.Numbers.Integer|Standard.Base.Nothing.Nothing) minimum_line_length:(Standard.Base.Data.Numbers.Integer|Standard.Base.Nothing.Nothing)
    - to_display_text self -> Standard.Base.Any.Any
