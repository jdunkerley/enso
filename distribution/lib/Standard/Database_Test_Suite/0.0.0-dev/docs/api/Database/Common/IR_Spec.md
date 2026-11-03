## Enso Signatures 1.0
## module Standard.Database_Test_Suite.Database.Common.IR_Spec
- type Data
    - Value ~data:Standard.Base.Any.Any
    - connection self -> Standard.Base.Any.Any
    - setup ~connection:Standard.Base.Any.Any -> Standard.Base.Any.Any
    - t1 self -> Standard.Base.Any.Any
    - teardown self -> Standard.Base.Any.Any
- add_specs suite_builder:Standard.Test.Suite.Suite_Builder setup:Standard.Base.Any.Any prefix:Standard.Base.Data.Text.Text default_connection:Standard.Base.Any.Any -> Standard.Base.Any.Any
- count_nodes col:Standard.Base.Any.Any -> Standard.Base.Any.Any
- drop_table connection:Standard.Base.Any.Any name:Standard.Base.Any.Any -> Standard.Base.Any.Any
- rebuild col:Standard.Base.Any.Any -> Standard.Base.Any.Any
- upload connection:Standard.Base.Any.Any prefix:Standard.Base.Any.Any data:Standard.Base.Any.Any temporary:Standard.Base.Any.Any= -> Standard.Base.Any.Any
