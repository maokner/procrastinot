import { parseAbiItem } from 'viem';

// Explicit event signatures so we can index events even while the shared ABI
// stub is still empty. These match `00-shared-interface.md` exactly.
// TODO(phase-b): once `@procrastinot/abi` exports the real ABI, these can be
// derived from it, but decoupling them is also fine — the signatures are
// stable by definition.

export const commitmentCreatedEvent = parseAbiItem(
  'event CommitmentCreated(uint256 indexed id, address indexed user, address indexed enemy, uint128 stake, uint128 oracleFee, uint64 deadline, string task, string rubric)',
);

export const verdictRequestedEvent = parseAbiItem(
  'event VerdictRequested(uint256 indexed id, string evidenceURI, uint8 attemptNumber)',
);
