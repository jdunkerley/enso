import { AssetProperties as ReactAssetProperties } from '#/layouts/AssetPanel/components/AssetProperties'
import { ProjectExecutionsCalendar as ReactProjectExecutionsCalendar } from '#/layouts/AssetPanel/components/ProjectExecutionsCalendar'
import { Drive as ReactDrive } from '#/layouts/Drive'
import ReactSettings from '#/layouts/Settings'
import { suspendedReactComponent } from '$/utils/react'

export const Drive = suspendedReactComponent(ReactDrive)
export const Settings = suspendedReactComponent(ReactSettings)
export const AssetProperties = suspendedReactComponent(ReactAssetProperties)
export const ProjectExecutionsCalendar = suspendedReactComponent(ReactProjectExecutionsCalendar)
