## Enso Signatures 1.0
## module Standard.Base.Network.Email.Email_Provider
- type Email_Provider
    - send self email:Standard.Base.Any.Any -> Standard.Base.Any.Any
- type Email_Provider_SPI
    - new typ:Standard.Base.Any.Any -> Standard.Base.Network.Email.Email_Provider.Email_Provider_SPI
- make_email_provider label:Standard.Base.Data.Text.Text implementation:Standard.Base.Any.Any -> Standard.Base.Network.Email.Email_Provider.Email_Provider
- Standard.Base.Metadata.Widget.from that:Standard.Base.Network.Email.Email_Provider.Email_Provider.type -> Standard.Base.Metadata.Widget
