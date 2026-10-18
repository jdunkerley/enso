/** @file Actions for the "account" tab of the "settings" page. */
import BaseSettingsTabActions from './BaseSettingsTabActions'
import { goToSettingsTabActions, type GoToSettingsTabActions } from './gotoSettingsTabActions'

/** Actions for the "account" tab of the "settings" page. */
export default class SettingsAccountTabActions<Context> extends BaseSettingsTabActions<Context> {
  /** Actions for navigating to another settings tab. */
  get goToSettingsTab(): Omit<GoToSettingsTabActions<Context>, 'account'> {
    return goToSettingsTabActions(this.step.bind(this))
  }
}
