/**
 * @file The agreements gate, contributed by `registerCloud` to the protected layout: the user's
 * agreement state (`./userAgreements.ts`) and the dialog that asks for it (`./AgreementsModal.vue`),
 * loaded together the first time the layout needs them.
 */
import { contributeAgreementsGate } from '$/providers/layoutContributions'

/** Give the protected layout its agreements gate. */
export function registerAgreementsGate() {
  contributeAgreementsGate(async () => {
    const [{ useUserAgreements }, { default: AgreementsModal }] = await Promise.all([
      import('./userAgreements'),
      import('./AgreementsModal.vue'),
    ])
    return { useUserAgreements, AgreementsModal }
  })
}
