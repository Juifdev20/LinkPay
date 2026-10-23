-- 073 — "Mes dépenses" usable without network.
-- An expense noted offline waits on the phone and is sent when the network comes back. It carries an id made on the
-- phone (client_ref): if the same note reaches the server twice (answer lost, app closed mid-send), the second one
-- returns the first instead of creating a duplicate. Re-runnable.

ALTER TABLE expense_entries ADD COLUMN IF NOT EXISTS client_ref UUID;

CREATE UNIQUE INDEX IF NOT EXISTS expense_entries_user_client_ref
  ON expense_entries (user_id, client_ref)
  WHERE client_ref IS NOT NULL;
