## Enso Signatures 1.0
## module Standard.Database_Test_Suite.Util
- type Test_Failure_Error
    - Error message:Standard.Base.Any.Any
    - to_display_text self -> Standard.Base.Any.Any
- column_should_equal_impl actual:Standard.Base.Any.Any expected:Standard.Base.Any.Any should_display:Standard.Base.Data.Boolean.Boolean= -> Standard.Base.Any.Any
- display_loc should_display:Standard.Base.Data.Boolean.Boolean -> Standard.Base.Any.Any
- normalize_lines string:Standard.Base.Any.Any line_separator:Standard.Base.Any.Any= newline_at_end:Standard.Base.Any.Any= -> Standard.Base.Any.Any
- report_fail actual:Standard.Base.Any.Any expected:Standard.Base.Any.Any should_display:Standard.Base.Any.Any -> Standard.Base.Any.Any
- rhs_error_check that:Standard.Base.Any.Any -> Standard.Base.Any.Any
- run_with_and_without_output ~action:Standard.Base.Any.Any -> Standard.Base.Any.Any
- table_should_equal_impl actual_table:Standard.Base.Any.Any expected_table:Standard.Base.Any.Any ignore_order:Standard.Base.Any.Any -> Standard.Base.Any.Any
- values_not_equal a:Standard.Base.Any.Any e:Standard.Base.Any.Any -> Standard.Base.Any.Any
- values_not_equal_with_epsilon a:Standard.Base.Any.Any e:Standard.Base.Any.Any epsilon:Standard.Base.Any.Any -> Standard.Base.Any.Any
- Standard.Base.Any.Any.should_have_relative_ordering self example:Standard.Base.Data.Vector.Vector -> Standard.Base.Any.Any
- Standard.Table.Column.Column.should_equal self expected:Standard.Base.Any.Any -> Standard.Base.Any.Any
- Standard.Base.Error.Error.should_have_relative_ordering self example:Standard.Base.Any.Any -> Standard.Base.Any.Any
- Standard.Table.Refined_Types.Numeric_Column.Numeric_Column.should_equal self expected:Standard.Base.Data.Vector.Vector epsilon:Standard.Base.Data.Numbers.Number= -> Standard.Base.Any.Any
- Standard.Table.Table.Table.should_equal self expected:Standard.Base.Any.Any ignore_order:Standard.Base.Any.Any= -> Standard.Base.Any.Any
