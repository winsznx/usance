"use client";

import { ActionShell } from "@/components/action";
import { BorrowForm } from "@/components/action-forms";

/**
 * `/app/borrow` — get cash against recognised collateral.
 *
 * The form is shared with the overview's action panel (`components/action-forms`).
 */
export default function BorrowPage() {
  return (
    <ActionShell
      title="Get cash"
      intro="Borrow against the collateral Usance already recognises. Your assets stay yours."
    >
      <BorrowForm />
    </ActionShell>
  );
}
