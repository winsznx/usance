"use client";

import { ActionShell } from "@/components/action";
import { RepayForm } from "@/components/action-forms";

/**
 * `/app/repay` — pay down debt.
 *
 * The form is shared with the overview's action panel (`components/action-forms`).
 */
export default function RepayPage() {
  return (
    <ActionShell title="Repay" intro="Pay down what you owe. This always works, whatever state your account is in.">
      <RepayForm />
    </ActionShell>
  );
}
