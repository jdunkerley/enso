## Enso Signatures 1.0
## module Standard.Database_Test_Suite.Database.Transaction_Spec
- type Data
    - Value ~data:Standard.Base.Any.Any
    - connection self -> Standard.Base.Any.Any
    - setup create_connection_func:Standard.Base.Any.Any -> Standard.Base.Any.Any
    - simple_table_structure self -> Standard.Base.Any.Any
    - teardown self -> Standard.Base.Any.Any
- type My_Error
    - Error
- add_specs suite_builder:Standard.Base.Any.Any create_connection_func:Standard.Base.Any.Any prefix:Standard.Base.Any.Any -> Standard.Base.Any.Any
