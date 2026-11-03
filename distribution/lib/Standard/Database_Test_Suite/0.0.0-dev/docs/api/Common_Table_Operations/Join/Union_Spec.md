## Enso Signatures 1.0
## module Standard.Database_Test_Suite.Common_Table_Operations.Join.Union_Spec
- type Lazy_Ref
    - Value ~get:Standard.Base.Any.Any
- type My_Type
    - Value x:Standard.Base.Any.Any y:Standard.Base.Any.Any
- add_specs suite_builder:Standard.Base.Any.Any setup:Standard.Base.Any.Any -> Standard.Base.Any.Any
- add_union_specs suite_builder:Standard.Base.Any.Any setup:Standard.Base.Any.Any -> Standard.Base.Any.Any
- call_member_union tables:Standard.Base.Any.Any -> Standard.Base.Any.Any
- call_static_union tables:Standard.Base.Any.Any -> Standard.Base.Any.Any
- main filter:Standard.Base.Any.Any= -> Standard.Base.Any.Any
- run_union_tests group_builder:Standard.Base.Any.Any setup:Standard.Base.Any.Any call_union:Standard.Base.Any.Any -> Standard.Base.Any.Any
