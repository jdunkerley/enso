/** @file A list of previous versions of an asset. */
import { ErrorBoundary } from '#/components/ErrorBoundary'
import { Result } from '#/components/Result'
import { Scroller } from '#/components/Scroller'
import { AssetPanelPlaceholder } from '#/layouts/AssetPanel/components/AssetPanelPlaceholder'
import { useBackends, useText } from '$/providers/react'
import { useVueValue } from '$/providers/react/common'
import { useRightPanelData, useRightPanelFocusedAsset } from '$/providers/react/container'
import type { SessionsProject } from '$/providers/rightPanel'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { Backend } from 'enso-common/src/services/Backend'
import { AssetType } from 'enso-common/src/services/Backend'
import { useCallback } from 'react'
import { ProjectSession } from './ProjectSession'

/** A list of previous versions of an asset. */
export function ProjectSessions() {
  const { getText } = useText()
  const rightPanel = useRightPanelData()
  const focusedAsset = useRightPanelFocusedAsset()
  const project = useVueValue(useCallback(() => rightPanel.sessionsProject, [rightPanel]))
  const { backendForType } = useBackends()

  if (project == null) {
    const isOtherAsset = focusedAsset != null && focusedAsset.type !== AssetType.project
    const title =
      isOtherAsset ?
        getText('assetProjectSessions.notProjectAsset')
      : getText('assetProjectSessions.notSelected')
    return <AssetPanelPlaceholder title={title} />
  }

  return (
    <ErrorBoundary>
      <AssetProjectSessionsInternal backend={backendForType(project.backendType)} item={project} />
    </ErrorBoundary>
  )
}

/** Props for a {@link AssetProjectSessionsInternal}. */
interface AssetProjectSessionsInternalProps {
  readonly backend: Backend
  readonly item: SessionsProject
}

/** A list of previous versions of an asset. */
function AssetProjectSessionsInternal(props: AssetProjectSessionsInternalProps) {
  const { backend, item } = props
  const { getText } = useText()

  const projectSessionsQuery = useSuspenseQuery({
    queryKey: ['getProjectSessions', item.id, item.title],
    queryFn: async () => {
      const sessions = await backend.listProjectSessions(item.id, item.title)
      return [...sessions].reverse()
    },
  })

  return projectSessionsQuery.data.length === 0 ?
      <Result status="info" centered title={getText('assetProjectSessions.noSessions')} />
    : <div className="flex min-h-0 w-full flex-col justify-start">
        <Scroller scrollbar orientation="vertical" background="white" className="h-full">
          {projectSessionsQuery.data.map((session, i) => (
            <ProjectSession
              key={session.projectSessionId}
              backend={backend}
              project={item}
              projectSession={session}
              index={projectSessionsQuery.data.length - i}
            />
          ))}
        </Scroller>
      </div>
}
