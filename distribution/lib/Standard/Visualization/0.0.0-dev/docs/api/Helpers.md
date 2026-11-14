## Enso Signatures 1.0
## module Standard.Visualization.Helpers
- make_lazy_visualization_data text:Standard.Base.Any.Any text_window_position:Standard.Base.Any.Any text_window_size:Standard.Base.Any.Any chunk_size:Standard.Base.Any.Any -> Standard.Base.Any.Any
- render_vector object:Standard.Base.Any.Any depth:Standard.Base.Any.Any= max_depth:Standard.Base.Any.Any= max_length:Standard.Base.Any.Any= -> Standard.Base.Any.Any
- truncate message:Standard.Base.Any.Any max_length:Standard.Base.Any.Any= suffix:Standard.Base.Any.Any= -> Standard.Base.Any.Any
- Standard.Base.Any.Any.default_visualization self -> Standard.Base.Any.Any
- Standard.Base.Any.Any.to_default_visualization_data self -> Standard.Base.Any.Any
- Standard.Base.Any.Any.to_lazy_visualization_data self text_window_position:Standard.Base.Any.Any text_window_size:Standard.Base.Any.Any chunk_size:Standard.Base.Any.Any -> Standard.Base.Any.Any
- Standard.Base.Data.Array.Array.default_visualization self -> Standard.Base.Any.Any
- Standard.Base.Data.Array.Array.to_default_visualization_data self -> Standard.Base.Any.Any
- Standard.Base.Error.Error.to_default_visualization_data self -> Standard.Base.Any.Any
- Standard.Base.Data.Json.JS_Object.default_visualization self -> Standard.Base.Any.Any
- Standard.Base.Data.Json.JS_Object.to_default_visualization_data self -> Standard.Base.Data.Text.Text
- Standard.Base.Nothing.Nothing.to_default_visualization_data self -> Standard.Base.Any.Any
- Standard.Base.Data.Text.Text.to_default_visualization_data self -> Standard.Base.Any.Any
- Standard.Base.Data.Text.Text.to_lazy_visualization_data self text_window_position:Standard.Base.Any.Any text_window_size:Standard.Base.Any.Any chunk_size:Standard.Base.Any.Any -> Standard.Base.Any.Any
- Standard.Base.Data.Vector.Vector.default_visualization self -> Standard.Base.Any.Any
- Standard.Base.Data.Vector.Vector.to_default_visualization_data self -> Standard.Base.Any.Any
