## Enso Signatures 1.0
## module Standard.Database_Test_Suite.Common_Table_Operations.Date_Time_Spec
- type Data
    - Value ~data:Standard.Base.Any.Any
    - dates self -> Standard.Base.Any.Any
    - datetimes self -> Standard.Base.Any.Any
    - setup table_builder:Standard.Base.Any.Any -> Standard.Base.Any.Any
    - teardown self -> Standard.Base.Any.Any
    - times self -> Standard.Base.Any.Any
- type Lazy_Ref
    - Value ~get:Standard.Base.Any.Any
- add_specs suite_builder:Standard.Base.Any.Any setup:Standard.Base.Any.Any -> Standard.Base.Any.Any
- as_local_date_time_repr dt:Standard.Base.Any.Any -> Standard.Base.Any.Any
- main filter:Standard.Base.Any.Any= -> Standard.Base.Any.Any
