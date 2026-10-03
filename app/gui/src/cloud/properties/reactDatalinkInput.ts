/**
 * @file The React datalink editor (`JSONSchemaInput` over the datalink schema), mounted in the
 * Properties tab through the framework bridge. `JSONSchemaInput` and its `FilePathInput` are
 * #92's to port, with the drive's datalink dialog that shares them; until then this is the one
 * place cloud code crosses into the React dashboard (see "Rulings from #183").
 */
import ReactDatalinkInput from '#/pages/dashboard/components/DatalinkInput'
import { reactComponent } from '$/utils/react'

export const DatalinkInput = reactComponent(ReactDatalinkInput)
