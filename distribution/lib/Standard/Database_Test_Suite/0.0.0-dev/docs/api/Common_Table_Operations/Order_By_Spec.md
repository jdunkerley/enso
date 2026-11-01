## Enso Signatures 1.0
## module Standard.Database_Test_Suite.Common_Table_Operations.Order_By_Spec
- type Data
    - Value ~data:Standard.Base.Any.Any
    - connection self -> Standard.Base.Any.Any
    - setup create_connection_fn:Standard.Base.Any.Any table_builder:Standard.Base.Any.Any -> Standard.Base.Any.Any
    - table self -> Standard.Base.Any.Any
    - teardown self -> Standard.Base.Any.Any
- type My_Type
    - Foo x:Standard.Base.Any.Any
- add_order_specs suite_builder:Standard.Base.Any.Any setup:Standard.Base.Any.Any -> Standard.Base.Any.Any
- add_specs suite_builder:Standard.Base.Any.Any setup:Standard.Base.Any.Any -> Standard.Base.Any.Any
- main filter:Standard.Base.Any.Any= -> Standard.Base.Any.Any
