## Enso Signatures 1.0
## module Standard.Database_Test_Suite.Internal.Setups
- type Dummy_Connection
    - Value
    - close self -> Standard.Base.Any.Any
    - drop_table self table:Standard.Base.Any.Any -> Standard.Base.Any.Any
- type Lazy_Ref
    - Value ~get:Standard.Base.Any.Any
- add_specs suite_builder:Standard.Base.Any.Any backend:Standard.Database_Test_Suite.Backend.Backend -> Standard.Database_Test_Suite.Common_Table_Operations.Main.Test_Setup
- data_csv -> Standard.Base.System.File.File
- database_setup backend:Standard.Database_Test_Suite.Backend.Backend -> Standard.Database_Test_Suite.Common_Table_Operations.Main.Test_Setup
- in_memory_setup -> Standard.Database_Test_Suite.Common_Table_Operations.Main.Test_Setup
