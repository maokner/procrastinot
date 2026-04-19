// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/token/ERC20/ERC20.sol";
import {Procrastinot} from "../../src/Procrastinot.sol";

/// @notice An ERC20 that re-enters the Procrastinot contract during `transfer`.
///         Used to verify that `nonReentrant` blocks reentrancy via the token
///         callback path. The reentrant call is expected to revert due to the
///         reentrancy guard (or, if guard ever fails, would corrupt state).
contract MaliciousToken is ERC20 {
    Procrastinot public target;
    uint256 public reentrantId;
    bool public attackOnTransfer;

    constructor() ERC20("Malicious", "MAL") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setTarget(Procrastinot _target) external {
        target = _target;
    }

    function armReentrancy(uint256 id) external {
        reentrantId = id;
        attackOnTransfer = true;
    }

    function disarm() external {
        attackOnTransfer = false;
    }

    /// @dev Hook into `_update` (covers transfer + transferFrom in OZ v5).
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (attackOnTransfer && address(target) != address(0) && to != address(target)) {
            // Reenter: try to forfeit the same id while the outer call holds the lock.
            attackOnTransfer = false;
            target.forfeit(reentrantId);
        }
    }
}
