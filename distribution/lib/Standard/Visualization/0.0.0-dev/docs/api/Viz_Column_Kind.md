## Enso Signatures 1.0
## module Standard.Visualization.Viz_Column_Kind
- type Viz_Column_Kind
    - Value kind:Standard.Visualization.Viz_Column_Kind.Viz_Kind display_name:Standard.Base.Data.Text.Text
    - infer values:Standard.Base.Data.Vector.Vector -> Standard.Visualization.Viz_Column_Kind.Viz_Column_Kind
    - is_date_or_time self -> Standard.Base.Data.Boolean.Boolean
    - is_numeric self -> Standard.Base.Data.Boolean.Boolean
- type Viz_Kind
    - Date_And_Time
    - Date_Only
    - Logical
    - Numeric
    - Other
    - Textual
    - Time_Only
