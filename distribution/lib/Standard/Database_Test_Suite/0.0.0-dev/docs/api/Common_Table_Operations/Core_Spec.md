## Enso Signatures 1.0
## module Standard.Database_Test_Suite.Common_Table_Operations.Core_Spec
- type Data
    - Value ~table:Standard.Base.Any.Any
    - setup table_builder:Standard.Base.Any.Any -> Standard.Base.Any.Any
- type Read_Data
    - Value ~data:Standard.Base.Any.Any
    - setup table_builder:Standard.Base.Any.Any -> Standard.Base.Any.Any
    - t_big self -> Standard.Base.Any.Any
    - t_small self -> Standard.Base.Any.Any
- type Rows_Data
    - Value ~table:Standard.Base.Any.Any
    - setup table_builder:Standard.Base.Any.Any -> Standard.Base.Any.Any
- add_core_specs suite_builder:Standard.Base.Any.Any setup:Standard.Base.Any.Any -> Standard.Base.Any.Any
- add_specs suite_builder:Standard.Base.Any.Any setup:Standard.Base.Any.Any -> Standard.Base.Any.Any
- main filter:Standard.Base.Any.Any= -> Standard.Base.Any.Any
- weird_names -> Standard.Base.Any.Any
