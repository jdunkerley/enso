## Enso Signatures 1.0
## module Standard.Database.Connection.Credentials
- type Credentials
    - Username_And_Password username:(Standard.Base.Data.Text.Text|Standard.Base.Enso_Cloud.Enso_Secret.Enso_Secret)= password:(Standard.Base.Data.Text.Text|Standard.Base.Enso_Cloud.Enso_Secret.Enso_Secret)=
    - to_display_text self -> Standard.Base.Data.Text.Text
    - to_text self -> Standard.Base.Any.Any
- Standard.Base.Metadata.Widget.from that:Standard.Database.Connection.Credentials.Credentials.type include_nothing:Standard.Base.Data.Boolean.Boolean= -> Standard.Base.Metadata.Widget
