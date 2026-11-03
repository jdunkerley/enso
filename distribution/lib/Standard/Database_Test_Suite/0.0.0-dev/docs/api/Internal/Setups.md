## Enso Signatures 1.0
## module Standard.Database_Test_Suite.Internal.Setups
- type Dummy_Connection
    - Value
    - close self -> Standard.Base.Any.Any
    - drop_table self table:Standard.Base.Any.Any -> Standard.Base.Any.Any
- type Lazy_Ref
    - Value ~get:Standard.Base.Any.Any
- add_specs real_builder:Standard.Base.Any.Any backend:Standard.Database_Test_Suite.Backend.Backend -> Standard.Database_Test_Suite.Common_Table_Operations.Main.Test_Setup
- data_csv -> Standard.Base.System.File.File
- database_setup backend:Standard.Database_Test_Suite.Backend.Backend -> Standard.Database_Test_Suite.Common_Table_Operations.Main.Test_Setup
- flag_answer dialect:Standard.Base.Any.Any flag:Standard.Database.Dialects.Dialect_Flag.Dialect_Flag -> Standard.Base.Data.Boolean.Boolean
- in_memory_setup -> Standard.Database_Test_Suite.Common_Table_Operations.Main.Test_Setup
- pending_override entries:Standard.Base.Data.Vector.Vector group_prefix:Standard.Base.Data.Text.Text matched:Standard.Base.Runtime.Ref.Ref group:Standard.Base.Data.Text.Text spec:(Standard.Base.Data.Text.Text|Standard.Base.Nothing.Nothing) -> (Standard.Base.Data.Text.Text|Standard.Base.Nothing.Nothing)
- report_unmatched suite_builder:Standard.Base.Any.Any backend:Standard.Database_Test_Suite.Backend.Backend entries:Standard.Base.Data.Vector.Vector matched:Standard.Base.Data.Vector.Vector -> Standard.Base.Nothing.Nothing
