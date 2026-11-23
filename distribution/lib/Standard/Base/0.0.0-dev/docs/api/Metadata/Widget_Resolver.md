## Enso Signatures 1.0
## module Standard.Base.Metadata.Widget_Resolver
- type Resolver_Signature
    - Value subject:(Standard.Base.Data.Text.Text|Standard.Base.Nothing.Nothing) dependencies:(Standard.Base.Data.Vector.Vector Standard.Base.Data.Text.Text) searchable:Standard.Base.Data.Boolean.Boolean parameters:(Standard.Base.Data.Vector.Vector Standard.Base.Data.Text.Text)
    - to_json self -> Standard.Base.Data.Text.Text
- apply resolver:Standard.Base.Function.Function signature:Standard.Base.Metadata.Widget_Resolver.Resolver_Signature subject:Standard.Base.Any.Any value_of:(Standard.Base.Data.Text.Text -> Standard.Base.Any.Any) search:Standard.Base.Data.Text.Text -> Standard.Base.Any.Any
- check signature:Standard.Base.Metadata.Widget_Resolver.Resolver_Signature call_arguments:((Standard.Base.Data.Vector.Vector Standard.Base.Data.Text.Text)|Standard.Base.Nothing.Nothing) method_name:Standard.Base.Data.Text.Text -> (Standard.Base.Data.Text.Text|Standard.Base.Nothing.Nothing)
- max_parameters -> Standard.Base.Data.Numbers.Integer
- signature_of resolver:Standard.Base.Function.Function -> Standard.Base.Metadata.Widget_Resolver.Resolver_Signature
