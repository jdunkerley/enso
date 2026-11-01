## Enso Signatures 1.0
## module Standard.Database_Test_Suite.Common_Table_Operations.Main
- type Test_Selection
    - Config supported_replace_params:Standard.Base.Any.Any= run_advanced_edge_case_tests_by_default:Standard.Base.Any.Any=
    - run_advanced_edge_case_tests self -> Standard.Base.Data.Boolean.Boolean
- type Test_Setup
    - Config prefix:Standard.Base.Any.Any table_fn:Standard.Base.Any.Any empty_table_fn:Standard.Base.Any.Any table_builder:(((Standard.Base.Data.Vector.Vector Standard.Base.Any.Any) -> (Standard.Base.Any.Any|Standard.Base.Nothing.Nothing)) -> Standard.Base.Any.Any) materialize:Standard.Base.Any.Any is_database:Standard.Base.Any.Any test_selection:Standard.Base.Any.Any is_aggregate_supported:Standard.Base.Any.Any create_connection_func:Standard.Base.Any.Any light_table_builder:Standard.Base.Any.Any is_integer_type:Standard.Base.Any.Any= is_feature_supported:Standard.Base.Any.Any flagged:Standard.Base.Any.Any is_operation_supported:Standard.Base.Any.Any backend:Standard.Base.Any.Any default_connection:Standard.Base.Any.Any
    - expect_integer_type self column:Standard.Base.Any.Any -> Standard.Base.Any.Any
    - has_known_issue self issue:Standard.Database_Test_Suite.Known_Issue.Known_Issue -> Standard.Base.Data.Boolean.Boolean
    - pending_for self issue:Standard.Database_Test_Suite.Known_Issue.Known_Issue -> (Standard.Base.Data.Text.Text|Standard.Base.Nothing.Nothing)
    - supports_custom_objects self -> Standard.Base.Any.Any
- add_specs suite_builder:Standard.Base.Any.Any setup:Standard.Base.Any.Any -> Standard.Base.Any.Any
- main filter:Standard.Base.Any.Any= -> Standard.Base.Any.Any
