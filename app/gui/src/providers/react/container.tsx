import { useContainerData as useContainerDataVue, type ContainerData } from '$/providers/container'
import { useInReactFunction } from '$/providers/react/common'
import {
  useRightPanelData as useRightPanelDataVue,
  type RightPanelData,
} from '$/providers/rightPanel'
import { reactComponent } from '$/utils/react'
import * as react from 'react'

const RightPanelDataContext = react.createContext<RightPanelData | null>(null)
export const useRightPanelData = useInReactFunction(RightPanelDataContext)

const ContainerDataContext = react.createContext<ContainerData | null>(null)
export const useContainerData = useInReactFunction(ContainerDataContext)

/**
 * Gives the React content under the app container (the modals the React shim renders) the
 * container's data and the right panel's. The drive's location had its own context too, for the
 * React drive, which went with it (#91).
 */
export const ContainerProviderForReact = reactComponent(
  ({
    container,
    rightPanel,
    children,
  }: react.PropsWithChildren<{
    container: ContainerData
    rightPanel: RightPanelData
  }>) => {
    return (
      <ContainerDataContext.Provider value={container}>
        <RightPanelDataContext.Provider value={rightPanel}>
          {children}
        </RightPanelDataContext.Provider>
      </ContainerDataContext.Provider>
    )
  },
  {
    useInjectPropsFromWrapper: () => {
      const result = {
        container: useContainerDataVue(),
        rightPanel: useRightPanelDataVue(),
      }
      // Avoid annoying warning about __veauryInjectedProps__ property by returning a function.
      return () => result
    },
  },
) as any
