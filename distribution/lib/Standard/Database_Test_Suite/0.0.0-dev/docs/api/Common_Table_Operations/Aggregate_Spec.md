## Enso Signatures 1.0
## module Standard.Database_Test_Suite.Common_Table_Operations.Aggregate_Spec
- type Aggregate_Support
    - from_setup setup:Standard.Base.Any.Any -> Standard.Database_Test_Suite.Common_Table_Operations.Aggregate_Spec.Aggregate_Support
- type Data
    - Value ~data:Standard.Base.Any.Any
    - empty_table self -> Standard.Base.Any.Any
    - setup table_fn:Standard.Base.Any.Any empty_table_fn:Standard.Base.Any.Any -> Standard.Base.Any.Any
    - table self -> Standard.Base.Any.Any
- type Lazy_Ref
    - Value ~get:Standard.Base.Any.Any
- add_aggregate_specs suite_builder:Standard.Base.Any.Any setup:Standard.Base.Any.Any -> Standard.Base.Any.Any
- add_specs suite_builder:Standard.Base.Any.Any setup:Standard.Base.Any.Any -> Standard.Base.Any.Any
- main filter:Standard.Base.Any.Any= -> Standard.Base.Any.Any
