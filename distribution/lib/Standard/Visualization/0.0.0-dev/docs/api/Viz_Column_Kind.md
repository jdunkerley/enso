## Enso Signatures 1.0
## module Standard.Visualization.Viz_Column_Kind
- type Viz_Column_Kind
    - Value kind:Standard.Base.Metadata.Column_Kind.Column_Kind display_name:Standard.Base.Data.Text.Text
    - infer values:Standard.Base.Data.Vector.Vector -> Standard.Visualization.Viz_Column_Kind.Viz_Column_Kind
    - is_date_or_time self -> Standard.Base.Data.Boolean.Boolean
    - is_numeric self -> Standard.Base.Data.Boolean.Boolean
