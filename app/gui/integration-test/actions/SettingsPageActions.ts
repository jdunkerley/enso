/** @file Actions for the "settings" page, which opens on its Local tab. */
import BaseSettingsTabActions from './BaseSettingsTabActions'
import { goToSettingsTabActions, type GoToSettingsTabActions } from './gotoSettingsTabActions'

/** Actions for the "settings" page, which opens on its Local tab. */
export default class SettingsPageActions<Context> extends BaseSettingsTabActions<Context> {
  /** Actions for navigating to a settings tab. */
  get goToSettingsTab(): GoToSettingsTabActions<Context> {
    return goToSettingsTabActions(this.step.bind(this))
  }
}
