## Enso Signatures 1.0
## module Standard.Base.Data.Text.Case
- type Case
    - Lower
    - Proper
    - Title
    - Upper
    - to_java self -> Standard.Base.Data.Text.Case.Java_Case
    - to_text self -> Standard.Base.Data.Text.Text
- Standard.Base.Metadata.Widget.from that:Standard.Base.Data.Text.Case.Case.type -> Standard.Base.Metadata.Widget
