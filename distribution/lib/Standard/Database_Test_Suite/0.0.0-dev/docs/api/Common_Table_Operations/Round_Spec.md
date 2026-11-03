## Enso Signatures 1.0
## module Standard.Database_Test_Suite.Common_Table_Operations.Round_Spec
- type Batch_Builder
    - Value vector_builder:Standard.Base.Any.Any
    - round self value:Standard.Base.Data.Numbers.Number dp:Standard.Base.Data.Numbers.Integer= -> Standard.Base.Any.Any
- type Batch_Runner
    - Value run_batch:(Standard.Base.Data.Vector.Vector -> Standard.Base.Data.Vector.Vector -> Standard.Base.Data.Boolean.Boolean -> Standard.Base.Data.Vector.Vector) run_one:(Standard.Base.Data.Numbers.Number -> Standard.Base.Data.Numbers.Integer -> Standard.Base.Data.Boolean.Boolean -> Standard.Base.Data.Numbers.Number)
    - from_function f:(Standard.Base.Data.Numbers.Number -> Standard.Base.Data.Numbers.Integer -> Standard.Base.Data.Boolean.Boolean -> Standard.Base.Data.Numbers.Number) -> Standard.Base.Any.Any
    - run self rounding_mode:(Standard.Base.Data.Numeric.Rounding_Mode.Rounding_Mode|Standard.Base.Data.Boolean.Boolean) action:(Standard.Database_Test_Suite.Common_Table_Operations.Round_Spec.Batch_Builder -> Standard.Base.Nothing.Nothing) -> Standard.Base.Any.Any
- type Check_Instance
    - Value vector_builder:Standard.Base.Any.Any value:Standard.Base.Any.Any dp:Standard.Base.Any.Any
    - should_equal self expected:Standard.Base.Data.Numbers.Number epsilon:Standard.Base.Data.Numbers.Float= with_warning:Standard.Base.Any.Any= -> Standard.Base.Any.Any
- add_specs is_database:Standard.Base.Any.Any group_builder:Standard.Base.Any.Any batch_runner:Standard.Base.Any.Any run_advanced:Standard.Base.Any.Any -> Standard.Base.Any.Any
