"use client";

import { ActionShell } from "@/components/action";
import { WithdrawForm } from "@/components/action-forms";

/**
 * `/app/withdraw` — take collateral back out.
 *
 * The form is shared with the overview's action panel (`components/action-forms`).
 */
export default function WithdrawPage() {
  return (
    <ActionShell
      title="Withdraw collateral"
      intro="Take your assets back out. What you can withdraw depends on what you still owe."
    >
      <WithdrawForm />
    </ActionShell>
  );
}
