-- Scope indexed commitment rows/events by contract deployment.
--
-- Procrastinot ids restart from 0 on every fresh contract deploy. Without the
-- contract address in the indexed data, `/c/2` can resolve to a stale row from
-- an older deployment and show unrelated verdict history.

ALTER TABLE commitments
  ADD COLUMN IF NOT EXISTS contract_address CITEXT;

ALTER TABLE verdict_events
  ADD COLUMN IF NOT EXISTS commitment_contract_address CITEXT;

-- Existing rows predate this column and belong to the previous canonical v2
-- deployment unless/until the indexer replays the new deployment and overwrites
-- the id with the current contract address.
UPDATE commitments
   SET contract_address = '0x25df2268051203cf73beb8cd9cd55c313370fb26'
 WHERE contract_address IS NULL;

UPDATE verdict_events
   SET commitment_contract_address = '0x25df2268051203cf73beb8cd9cd55c313370fb26'
 WHERE commitment_contract_address IS NULL;

ALTER TABLE commitments
  ALTER COLUMN contract_address SET NOT NULL;

CREATE INDEX IF NOT EXISTS commitments_contract_id_idx
  ON commitments (contract_address, id);

CREATE INDEX IF NOT EXISTS verdict_events_contract_commitment_idx
  ON verdict_events (commitment_contract_address, commitment_id);
