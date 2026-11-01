## Enso Signatures 1.0
## module Standard.Database_Test_Suite.Common_Table_Operations.Join.Join_Spec
- type Data
    - Value ~data:Standard.Base.Any.Any
    - setup table_builder:Standard.Base.Any.Any -> Standard.Base.Any.Any
    - t1 self -> Standard.Base.Any.Any
    - t2 self -> Standard.Base.Any.Any
    - t3 self -> Standard.Base.Any.Any
    - t4 self -> Standard.Base.Any.Any
- type My_Type
    - Value x:Standard.Base.Any.Any y:Standard.Base.Any.Any
- type My_Type_Comparator
    - compare my_1:Standard.Base.Any.Any my_2:Standard.Base.Any.Any -> Standard.Base.Any.Any
    - hash my_type:Standard.Base.Any.Any -> Standard.Base.Any.Any
- add_join_specs suite_builder:Standard.Base.Any.Any setup:Standard.Base.Any.Any -> Standard.Base.Any.Any
- add_specs suite_builder:Standard.Base.Any.Any setup:Standard.Base.Any.Any -> Standard.Base.Any.Any
- main filter:Standard.Base.Any.Any= -> Standard.Base.Any.Any
- Standard.Base.Data.Ordering.Comparable.from that:Standard.Database_Test_Suite.Common_Table_Operations.Join.Join_Spec.My_Type -> Standard.Base.Data.Ordering.Comparable
