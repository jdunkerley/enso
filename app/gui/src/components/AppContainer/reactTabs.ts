import { AssetProperties as ReactAssetProperties } from '#/layouts/AssetPanel/components/AssetProperties'
import { ProjectExecutionsCalendar as ReactProjectExecutionsCalendar } from '#/layouts/AssetPanel/components/ProjectExecutionsCalendar'
import { Drive as ReactDrive } from '#/layouts/Drive'
import { suspendedReactComponent } from '$/utils/react'

export const Drive = suspendedReactComponent(ReactDrive)
export const AssetProperties = suspendedReactComponent(ReactAssetProperties)
export const ProjectExecutionsCalendar = suspendedReactComponent(ReactProjectExecutionsCalendar)
