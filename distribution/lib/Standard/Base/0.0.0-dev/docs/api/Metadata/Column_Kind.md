## Enso Signatures 1.0
## module Standard.Base.Metadata.Column_Kind
- type Column_Kind
    - Date_And_Time
    - Date_Only
    - Logical
    - Numeric
    - Other
    - Textual
    - Time_Only
    - of_value value:Standard.Base.Any.Any -> Standard.Base.Metadata.Column_Kind.Column_Kind
    - to_json self -> Standard.Base.Data.Text.Text
