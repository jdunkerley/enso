## Enso Signatures 1.0
## module Standard.Database_Test_Suite.Database.Upload_Spec
- type Data
    - Value ~data:Standard.Base.Any.Any
    - connection self -> Standard.Base.Any.Any
    - in_memory_table self -> Standard.Base.Any.Any
    - setup create_connection_func:Standard.Base.Any.Any -> Standard.Base.Any.Any
- add_specs suite_builder:Standard.Base.Any.Any setup:Standard.Base.Any.Any make_new_connection:Standard.Base.Any.Any persistent_connector:Standard.Base.Any.Any= -> Standard.Base.Any.Any
- cleanup_sentinel ref:Standard.Base.Any.Any _:Standard.Base.Any.Any -> Standard.Base.Any.Any
- database_table_builder name_prefix:Standard.Base.Any.Any args:Standard.Base.Any.Any primary_key:Standard.Base.Any.Any= connection:Standard.Base.Any.Any -> Standard.Base.Any.Any
- in_memory_table_builder args:Standard.Base.Any.Any primary_key:Standard.Base.Any.Any= connection:Standard.Base.Any.Any -> Standard.Base.Any.Any
- make_mock_column name:Standard.Base.Any.Any values:Standard.Base.Any.Any exploding_index:Standard.Base.Any.Any -> Standard.Base.Any.Any
- test_table_append setup:Standard.Base.Any.Any group_builder:Standard.Base.Any.Any data:Standard.Database_Test_Suite.Database.Upload_Spec.Data source_table_builder:Standard.Base.Any.Any target_table_builder:Standard.Base.Any.Any -> Standard.Base.Any.Any
- test_table_delete group_builder:Standard.Base.Any.Any data:Standard.Database_Test_Suite.Database.Upload_Spec.Data source_table_builder:Standard.Base.Any.Any target_table_builder:Standard.Base.Any.Any -> Standard.Base.Any.Any
- tests group_builder:Standard.Base.Any.Any data:Standard.Database_Test_Suite.Database.Upload_Spec.Data make_new_connection:Standard.Base.Any.Any source_table_builder:Standard.Base.Any.Any suffix:Standard.Base.Data.Text.Text persistent_connector:Standard.Base.Any.Any -> Standard.Base.Any.Any
- wait_until_temporary_table_is_deleted_after_closing_connection connection:Standard.Base.Any.Any table_name:Standard.Base.Any.Any -> Standard.Base.Any.Any
