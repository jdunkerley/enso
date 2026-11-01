## Enso Signatures 1.0
## module Standard.Database_Test_Suite.Database.Common.Default_Ordering_Spec
- type Data
    - Value ~data:Standard.Base.Any.Any
    - connection self -> Standard.Base.Any.Any
    - db_table_with_key self -> Standard.Base.Any.Any
    - db_table_without_key self -> Standard.Base.Any.Any
    - setup create_connection_func:Standard.Base.Any.Any -> Standard.Base.Any.Any
    - teardown self -> Standard.Base.Any.Any
- add_specs suite_builder:Standard.Test.Suite.Suite_Builder prefix:Standard.Base.Data.Text.Text create_connection_fn:Standard.Base.Any.Any setup:Standard.Base.Any.Any -> Standard.Base.Any.Any
- main filter:Standard.Base.Any.Any= -> Standard.Base.Any.Any
