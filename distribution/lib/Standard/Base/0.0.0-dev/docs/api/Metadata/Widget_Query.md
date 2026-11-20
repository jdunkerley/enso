## Enso Signatures 1.0
## module Standard.Base.Metadata.Widget_Query
- type Argument_Result
    - Failed failure:Standard.Base.Metadata.Widget_Query.Widget_Failure
    - Resolved widget:(Standard.Base.Metadata.Widget|Standard.Base.Nothing.Nothing) json:Standard.Base.Data.Text.Text
    - to_json self -> Standard.Base.Data.Text.Text
- type Widget_Failure
    - Value method:Standard.Base.Metadata.Widget_Query.Widget_Method argument:Standard.Base.Data.Text.Text step:Standard.Base.Data.Text.Text message:Standard.Base.Data.Text.Text causes:(Standard.Base.Data.Vector.Vector Standard.Base.Data.Text.Text) stack:(Standard.Base.Data.Vector.Vector Standard.Base.Data.Text.Text)
    - log_text self -> Standard.Base.Data.Text.Text
    - to_json self -> Standard.Base.Data.Text.Text
- type Widget_Method
    - Value module_name:Standard.Base.Data.Text.Text type_name:Standard.Base.Data.Text.Text method_name:Standard.Base.Data.Text.Text
    - qualified_name self -> Standard.Base.Data.Text.Text
- log_failure failure:Standard.Base.Metadata.Widget_Query.Widget_Failure inputs:Standard.Base.Data.Text.Text -> Standard.Base.Data.Boolean.Boolean
- resolve_argument method:Standard.Base.Metadata.Widget_Query.Widget_Method argument:Standard.Base.Data.Text.Text subject:Standard.Base.Any.Any cache:Standard.Base.Function.Function -> Standard.Base.Metadata.Widget_Query.Argument_Result
- resolve_call value:Standard.Base.Any.Any module_name:Standard.Base.Data.Text.Text type_name:Standard.Base.Data.Text.Text method_name:Standard.Base.Data.Text.Text argument_names:(Standard.Base.Data.Vector.Vector Standard.Base.Data.Text.Text) uuids:Standard.Base.Data.Text.Text= subject_is_type:Standard.Base.Data.Boolean.Boolean= -> Standard.Base.Data.Text.Text
- resolve_type type_name:Standard.Base.Data.Text.Text -> Standard.Base.Data.Text.Text
- resolve_type_argument method:Standard.Base.Metadata.Widget_Query.Widget_Method type_name:Standard.Base.Data.Text.Text -> Standard.Base.Metadata.Widget_Query.Argument_Result
