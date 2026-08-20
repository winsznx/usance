"use client";

import { ActionShell } from "@/components/action";
import { AddCollateralForm } from "@/components/action-forms";

/**
 * `/app/collateral/add` — deposit an asset Usance recognises.
 *
 * The form is shared with the overview's action panel (`components/action-forms`), so the
 * deep-linkable route and the inline panel can never show different versions of the same action.
 */
export default function AddCollateralPage() {
  return (
    <ActionShell
      title="Add collateral"
      intro="Deposit an admitted asset. It stays yours, and Usance tells you exactly how much of it it will stand behind."
    >
      <AddCollateralForm />
    </ActionShell>
  );
}
