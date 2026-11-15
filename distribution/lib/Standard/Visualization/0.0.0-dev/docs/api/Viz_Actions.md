## Enso Signatures 1.0
## module Standard.Visualization.Viz_Actions
- type Viz_Actions
    - Value actions:(Standard.Base.Data.Vector.Vector Standard.Visualization.Viz_Action.Viz_Action)
    - add_to_json self json_text:Standard.Base.Data.Text.Text -> Standard.Base.Data.Text.Text
    - for value:Standard.Base.Any.Any -> Standard.Visualization.Viz_Actions.Viz_Actions
    - none -> Standard.Visualization.Viz_Actions.Viz_Actions
    - to_json_text self -> Standard.Base.Data.Text.Text
- remove_warnings_action -> Standard.Visualization.Viz_Action.Viz_Action
- Standard.Visualization.Viz_Actions.Viz_Actions.from that:Standard.Base.Any.Any -> Standard.Visualization.Viz_Actions.Viz_Actions
- Standard.Visualization.Viz_Actions.Viz_Actions.from that:Standard.Base.Data.Vector.Vector -> Standard.Visualization.Viz_Actions.Viz_Actions
- Standard.Visualization.Viz_Actions.Viz_Actions.from that:Standard.Base.Data.Array.Array -> Standard.Visualization.Viz_Actions.Viz_Actions
