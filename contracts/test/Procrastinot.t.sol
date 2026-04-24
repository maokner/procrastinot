// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {DegenVault} from "../src/DegenVault.sol";
import {Procrastinot} from "../src/Procrastinot.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MaliciousToken} from "./mocks/MaliciousToken.sol";

contract ProcrastinotTest is Test {
    Procrastinot internal p;
    DegenVault internal vault;
    MockUSDC internal usdc;

    address internal user = makeAddr("user");
    address internal enemy = makeAddr("enemy");
    address internal oracle = makeAddr("oracle");
    address internal operator = makeAddr("operator");
    address internal rando = makeAddr("rando");

    uint128 internal constant STAKE = 100e6; // 100 USDC
    uint128 internal constant FEE = 3e6; // 3 USDC -> 1 USDC per attempt
    uint64 internal deadline;

    // Re-declared for vm.expectEmit matching.
    event CommitmentCreated(
        uint256 indexed id,
        address indexed user,
        address indexed enemy,
        uint128 stake,
        uint128 oracleFee,
        uint64 deadline,
        string task,
        string rubric
    );
    event VerdictRequested(uint256 indexed id, string evidenceURI, uint8 attemptNumber);
    event VerdictSubmitted(uint256 indexed id, bool passed, bytes32 reasonHash);
    event Completed(uint256 indexed id, address indexed user, uint128 refund);
    event Forfeited(uint256 indexed id, address indexed enemy, uint128 amount);
    event DegenVaultUpdated(address indexed oldVault, address indexed newVault);
    event SentToDegenVault(uint256 indexed id, address indexed user, address indexed vault, uint128 amount);

    function setUp() public {
        usdc = new MockUSDC();
        p = new Procrastinot(address(usdc), oracle, operator);
        vault = new DegenVault(address(usdc), address(p), oracle);
        p.setDegenVault(address(vault));

        deadline = uint64(block.timestamp + 7 days);

        usdc.mint(user, 1_000_000e6);
        vm.prank(user);
        usdc.approve(address(p), type(uint256).max);
    }

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    function _create(uint128 stake, uint128 fee, uint64 dl) internal returns (uint256 id) {
        vm.prank(user);
        id = p.create(enemy, stake, fee, dl, "write essay", "must be 500 words");
    }

    function _createDefault() internal returns (uint256) {
        return _create(STAKE, FEE, deadline);
    }

    // ---------------------------------------------------------------
    // 1. Create happy path
    // ---------------------------------------------------------------

    function testCreateHappyPath() public {
        uint256 userBalBefore = usdc.balanceOf(user);
        uint256 cBalBefore = usdc.balanceOf(address(p));

        vm.expectEmit(true, true, true, true, address(p));
        emit CommitmentCreated(0, user, enemy, STAKE, FEE, deadline, "write essay", "must be 500 words");

        uint256 id = _createDefault();
        assertEq(id, 0);

        Procrastinot.Commitment memory c = p.getCommitment(id);
        assertEq(c.user, user);
        assertEq(c.enemy, enemy);
        assertEq(c.stake, STAKE);
        assertEq(c.oracleFee, FEE);
        assertEq(c.initialOracleFee, FEE);
        assertEq(c.deadline, deadline);
        assertEq(c.attemptsUsed, 0);
        assertEq(uint8(c.status), uint8(Procrastinot.Status.Active));
        assertEq(c.taskHash, keccak256(abi.encode("write essay", "must be 500 words")));

        assertEq(usdc.balanceOf(user), userBalBefore - STAKE - FEE);
        assertEq(usdc.balanceOf(address(p)), cBalBefore + STAKE + FEE);
    }

    // ---------------------------------------------------------------
    // 2. Create validation reverts
    // ---------------------------------------------------------------

    function testCreateRejectsZeroStake() public {
        vm.prank(user);
        vm.expectRevert(Procrastinot.ZeroStake.selector);
        p.create(enemy, 0, FEE, deadline, "t", "r");
    }

    function testCreateRejectsPastDeadline() public {
        vm.prank(user);
        vm.expectRevert(Procrastinot.BadDeadline.selector);
        p.create(enemy, STAKE, FEE, uint64(block.timestamp), "t", "r");
    }

    function testCreateRejectsSelfAsEnemy() public {
        vm.prank(user);
        vm.expectRevert(Procrastinot.BadEnemy.selector);
        p.create(user, STAKE, FEE, deadline, "t", "r");
    }

    function testCreateRejectsZeroEnemy() public {
        vm.prank(user);
        vm.expectRevert(Procrastinot.BadEnemy.selector);
        p.create(address(0), STAKE, FEE, deadline, "t", "r");
    }

    // ---------------------------------------------------------------
    // 3. requestVerdict
    // ---------------------------------------------------------------

    function testRequestVerdictOnlyUser() public {
        uint256 id = _createDefault();
        vm.prank(rando);
        vm.expectRevert(Procrastinot.NotUser.selector);
        p.requestVerdict(id, "ipfs://evidence");
    }

    function testRequestVerdictDeductsFee() public {
        uint256 id = _createDefault();
        uint256 opBefore = usdc.balanceOf(operator);

        vm.expectEmit(true, false, false, true, address(p));
        emit VerdictRequested(id, "ipfs://evidence", 1);

        vm.prank(user);
        p.requestVerdict(id, "ipfs://evidence");

        uint128 perAttempt = FEE / 3; // 1e6
        assertEq(usdc.balanceOf(operator), opBefore + perAttempt);

        Procrastinot.Commitment memory c = p.getCommitment(id);
        assertEq(c.oracleFee, FEE - perAttempt);
        assertEq(c.attemptsUsed, 1);
    }

    function testRequestVerdictRespectsAttemptCap() public {
        uint256 id = _createDefault();
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(user);
            p.requestVerdict(id, "ipfs://evidence");
        }
        vm.prank(user);
        vm.expectRevert(Procrastinot.AttemptsExhausted.selector);
        p.requestVerdict(id, "ipfs://evidence");
    }

    function testRequestVerdictRejectsAfterDeadline() public {
        uint256 id = _createDefault();
        vm.warp(deadline);
        vm.prank(user);
        vm.expectRevert(Procrastinot.DeadlinePassed.selector);
        p.requestVerdict(id, "ipfs://evidence");
    }

    // ---------------------------------------------------------------
    // 4. submitVerdict
    // ---------------------------------------------------------------

    function testSubmitVerdictOnlyOracle() public {
        uint256 id = _createDefault();
        vm.prank(rando);
        vm.expectRevert(Procrastinot.NotOracle.selector);
        p.submitVerdict(id, true, bytes32(uint256(1)));
    }

    function testSubmitVerdictPassedPaysUserAndOperator() public {
        uint256 id = _createDefault();

        // burn one attempt first so there's an unspent-but-reduced oracleFee
        vm.prank(user);
        p.requestVerdict(id, "ipfs://e");

        uint256 userBefore = usdc.balanceOf(user);
        uint256 opBefore = usdc.balanceOf(operator);

        Procrastinot.Commitment memory cBefore = p.getCommitment(id);
        uint128 remainingFee = cBefore.oracleFee;

        vm.expectEmit(true, true, false, true, address(p));
        emit Completed(id, user, STAKE);

        vm.prank(oracle);
        p.submitVerdict(id, true, bytes32(uint256(0xBEEF)));

        assertEq(usdc.balanceOf(user), userBefore + STAKE);
        assertEq(usdc.balanceOf(operator), opBefore + remainingFee);

        Procrastinot.Commitment memory c = p.getCommitment(id);
        assertEq(uint8(c.status), uint8(Procrastinot.Status.Completed));
        assertEq(c.stake, 0);
        assertEq(c.oracleFee, 0);
    }

    function testSubmitVerdictFailedLeavesActive() public {
        uint256 id = _createDefault();
        uint256 userBefore = usdc.balanceOf(user);
        uint256 opBefore = usdc.balanceOf(operator);
        uint256 cBefore = usdc.balanceOf(address(p));

        vm.prank(oracle);
        p.submitVerdict(id, false, bytes32(uint256(0xDEAD)));

        Procrastinot.Commitment memory c = p.getCommitment(id);
        assertEq(uint8(c.status), uint8(Procrastinot.Status.Active));
        assertEq(c.stake, STAKE);
        assertEq(c.oracleFee, FEE);
        assertEq(usdc.balanceOf(user), userBefore);
        assertEq(usdc.balanceOf(operator), opBefore);
        assertEq(usdc.balanceOf(address(p)), cBefore);
    }

    function testSubmitVerdictToVaultOnlyOracle() public {
        uint256 id = _createDefault();
        vm.prank(rando);
        vm.expectRevert(Procrastinot.NotOracle.selector);
        p.submitVerdictToVault(id, bytes32(uint256(1)));
    }

    function testSubmitVerdictToVaultRequiresVault() public {
        Procrastinot p2 = new Procrastinot(address(usdc), oracle, operator);

        vm.prank(user);
        usdc.approve(address(p2), type(uint256).max);

        vm.prank(user);
        uint256 id = p2.create(enemy, STAKE, FEE, deadline, "write essay", "must be 500 words");

        vm.prank(oracle);
        vm.expectRevert(Procrastinot.DegenVaultNotSet.selector);
        p2.submitVerdictToVault(id, bytes32(uint256(1)));
    }

    function testSubmitVerdictToVaultRoutesStakeToVaultAndFeeToOperator() public {
        uint256 id = _createDefault();

        vm.prank(user);
        p.requestVerdict(id, "ipfs://e");

        uint256 userBefore = usdc.balanceOf(user);
        uint256 opBefore = usdc.balanceOf(operator);
        Procrastinot.Commitment memory cBefore = p.getCommitment(id);
        uint128 remainingFee = cBefore.oracleFee;

        vm.expectEmit(true, true, true, true, address(p));
        emit SentToDegenVault(id, user, address(vault), STAKE);
        vm.expectEmit(true, true, false, true, address(p));
        emit Completed(id, user, 0);

        vm.prank(oracle);
        p.submitVerdictToVault(id, bytes32(uint256(0xCAFE)));

        assertEq(usdc.balanceOf(user), userBefore);
        assertEq(usdc.balanceOf(operator), opBefore + remainingFee);
        assertEq(usdc.balanceOf(address(vault)), STAKE);
        assertEq(vault.depositedBalances(user), STAKE);
        assertEq(vault.totalHeld(), STAKE);
        assertEq(usdc.allowance(address(p), address(vault)), 0);

        Procrastinot.Commitment memory c = p.getCommitment(id);
        assertEq(uint8(c.status), uint8(Procrastinot.Status.Completed));
        assertEq(c.stake, 0);
        assertEq(c.oracleFee, 0);
    }

    function testSubmitVerdictToVaultThenOracleCanReleaseFromVault() public {
        uint256 id = _createDefault();

        vm.prank(oracle);
        p.submitVerdictToVault(id, bytes32(uint256(0xCAFE)));

        uint256 userBefore = usdc.balanceOf(user);

        vm.prank(oracle);
        vault.releaseFor(user, STAKE);

        assertEq(usdc.balanceOf(user), userBefore + STAKE);
        assertEq(vault.depositedBalances(user), STAKE);
    }

    // ---------------------------------------------------------------
    // 5. Double resolve
    // ---------------------------------------------------------------

    function testDoubleResolveReverts() public {
        uint256 id = _createDefault();
        vm.prank(oracle);
        p.submitVerdict(id, true, bytes32(0));

        vm.prank(oracle);
        vm.expectRevert(Procrastinot.NotActive.selector);
        p.submitVerdict(id, true, bytes32(0));

        vm.warp(deadline + 1);
        vm.expectRevert(Procrastinot.NotActive.selector);
        p.forfeit(id);
    }

    // ---------------------------------------------------------------
    // 6. forfeit
    // ---------------------------------------------------------------

    function testForfeitBeforeDeadlineReverts() public {
        uint256 id = _createDefault();
        vm.expectRevert(Procrastinot.DeadlineNotReached.selector);
        p.forfeit(id);
    }

    function testForfeitAfterDeadlineSplitsStakeAndFee() public {
        uint256 id = _createDefault();

        // burn one attempt first -> unspent oracleFee is FEE - perAttempt
        vm.prank(user);
        p.requestVerdict(id, "ipfs://e");

        Procrastinot.Commitment memory cBefore = p.getCommitment(id);
        uint128 expectedStake = cBefore.stake;
        uint128 expectedRemainingFee = cBefore.oracleFee;
        uint256 enemyBefore = usdc.balanceOf(enemy);
        uint256 opBefore = usdc.balanceOf(operator);

        vm.warp(deadline);

        // Forfeited event payload is stake-only (what the enemy receives).
        vm.expectEmit(true, true, false, true, address(p));
        emit Forfeited(id, enemy, expectedStake);

        p.forfeit(id);

        assertEq(usdc.balanceOf(enemy), enemyBefore + expectedStake);
        assertEq(usdc.balanceOf(operator), opBefore + expectedRemainingFee);

        Procrastinot.Commitment memory c = p.getCommitment(id);
        assertEq(uint8(c.status), uint8(Procrastinot.Status.Forfeited));
        assertEq(c.stake, 0);
        assertEq(c.oracleFee, 0);
    }

    function testForfeitAfterRequestVerdictSplitsRemainderToOperator() public {
        uint256 id = _createDefault();

        uint256 enemyBefore = usdc.balanceOf(enemy);
        uint256 opBefore = usdc.balanceOf(operator);

        // One requestVerdict burns exactly 1/3 of the initial oracle fee to operator.
        vm.prank(user);
        p.requestVerdict(id, "ipfs://e");

        uint128 perAttempt = FEE / 3;

        vm.warp(deadline + 1);
        p.forfeit(id);

        // Enemy got stake only.
        assertEq(usdc.balanceOf(enemy), enemyBefore + STAKE);
        // Operator got 1/3 from requestVerdict + remaining 2/3 from forfeit = full initial fee.
        assertEq(usdc.balanceOf(operator), opBefore + FEE);
        // Sanity: perAttempt + (FEE - perAttempt) == FEE
        assertEq(perAttempt + (FEE - perAttempt), FEE);
    }

    function testForfeitIsPermissionless() public {
        uint256 id = _createDefault();
        vm.warp(deadline + 1);
        vm.prank(rando);
        p.forfeit(id);

        Procrastinot.Commitment memory c = p.getCommitment(id);
        assertEq(uint8(c.status), uint8(Procrastinot.Status.Forfeited));
    }

    // ---------------------------------------------------------------
    // 7. Reentrancy
    // ---------------------------------------------------------------

    function testReentrancyGuard() public {
        MaliciousToken mal = new MaliciousToken();
        Procrastinot p2 = new Procrastinot(address(mal), oracle, operator);
        mal.setTarget(p2);

        mal.mint(user, 1_000_000e6);
        vm.prank(user);
        mal.approve(address(p2), type(uint256).max);

        uint64 dl = uint64(block.timestamp + 7 days);
        vm.prank(user);
        uint256 id = p2.create(enemy, STAKE, FEE, dl, "t", "r");

        // Arm: when safeTransfer fires inside forfeit (to enemy), the token
        // will try to re-call p2.forfeit(id). That reentrant call must revert.
        vm.warp(dl + 1);
        mal.armReentrancy(id);

        vm.expectRevert(); // ReentrancyGuardReentrantCall bubbles through SafeERC20
        p2.forfeit(id);
    }

    // ---------------------------------------------------------------
    // 8. Accounting invariant
    // ---------------------------------------------------------------

    // ---------------------------------------------------------------
    // 9. Owner-only setters: zero-address guards
    // ---------------------------------------------------------------

    function testSetOracleRejectsZeroAddress() public {
        vm.expectRevert(Procrastinot.InvalidOracle.selector);
        p.setOracle(address(0));
    }

    function testSetOperatorWalletRejectsZeroAddress() public {
        vm.expectRevert(Procrastinot.InvalidOperator.selector);
        p.setOperatorWallet(address(0));
    }

    function testSetOracleHappyPath() public {
        address newOracle = makeAddr("newOracle");
        p.setOracle(newOracle);
        assertEq(p.oracle(), newOracle);
    }

    function testSetOperatorWalletHappyPath() public {
        address newOperator = makeAddr("newOperator");
        p.setOperatorWallet(newOperator);
        assertEq(p.operatorWallet(), newOperator);
    }

    function testSetDegenVaultRejectsZeroAddress() public {
        vm.expectRevert(Procrastinot.InvalidDegenVault.selector);
        p.setDegenVault(address(0));
    }

    function testSetDegenVaultRejectsEOA() public {
        vm.expectRevert(Procrastinot.InvalidDegenVault.selector);
        p.setDegenVault(makeAddr("notVault"));
    }

    function testSetDegenVaultRejectsWrongProcrastinot() public {
        DegenVault wrongVault = new DegenVault(address(usdc), makeAddr("otherProcrastinot"), oracle);

        vm.expectRevert(Procrastinot.InvalidDegenVault.selector);
        p.setDegenVault(address(wrongVault));
    }

    function testSetDegenVaultHappyPath() public {
        DegenVault newVault = new DegenVault(address(usdc), address(p), oracle);

        vm.expectEmit(true, true, false, true, address(p));
        emit DegenVaultUpdated(address(vault), address(newVault));

        p.setDegenVault(address(newVault));
        assertEq(address(p.degenVault()), address(newVault));
    }

    // ---------------------------------------------------------------
    // 10. Two-step ownership handoff (Ownable2Step)
    // ---------------------------------------------------------------

    function testTwoStepOwnershipHandoff() public {
        address newOwner = makeAddr("newOwner");

        // Current owner (this test contract) starts the transfer.
        p.transferOwnership(newOwner);

        // Current owner is unchanged; pendingOwner is set.
        assertEq(p.owner(), address(this));
        assertEq(p.pendingOwner(), newOwner);

        // A random address cannot accept.
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, rando));
        p.acceptOwnership();

        // Even the old owner cannot accept on behalf of the pending owner.
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        p.acceptOwnership();

        // Pending owner accepts.
        vm.prank(newOwner);
        p.acceptOwnership();

        assertEq(p.owner(), newOwner);
        assertEq(p.pendingOwner(), address(0));

        // The old owner can no longer call onlyOwner functions.
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        p.setOracle(makeAddr("anotherOracle"));

        // The new owner can.
        address anotherOracle = makeAddr("anotherOracle");
        vm.prank(newOwner);
        p.setOracle(anotherOracle);
        assertEq(p.oracle(), anotherOracle);
    }

    function testAccountingInvariant() public {
        // Create three commitments.
        uint256 id0 = _create(STAKE, FEE, deadline);
        uint256 id1 = _create(50e6, 6e6, deadline);
        uint256 id2 = _create(200e6, 9e6, deadline);

        // id0: request one verdict (partially drains oracleFee to operator).
        vm.prank(user);
        p.requestVerdict(id0, "ipfs://e0");

        // id1: oracle passes it -> no longer active.
        vm.prank(oracle);
        p.submitVerdict(id1, true, bytes32(uint256(1)));

        // id2: warp + forfeit -> no longer active.
        vm.warp(deadline + 1);
        p.forfeit(id2);

        // Reset time so id0 still has a live view of its state (no further calls).
        // Now: only id0 is Active. Contract balance must equal id0.stake + id0.oracleFee.
        Procrastinot.Commitment memory c0 = p.getCommitment(id0);
        Procrastinot.Commitment memory c1 = p.getCommitment(id1);
        Procrastinot.Commitment memory c2 = p.getCommitment(id2);

        assertEq(uint8(c0.status), uint8(Procrastinot.Status.Active));
        assertEq(uint8(c1.status), uint8(Procrastinot.Status.Completed));
        assertEq(uint8(c2.status), uint8(Procrastinot.Status.Forfeited));

        uint256 sumActive;
        Procrastinot.Commitment[3] memory all = [c0, c1, c2];
        for (uint256 i = 0; i < 3; i++) {
            if (all[i].status == Procrastinot.Status.Active) {
                sumActive += uint256(all[i].stake) + uint256(all[i].oracleFee);
            }
        }
        assertEq(usdc.balanceOf(address(p)), sumActive);
    }
}
