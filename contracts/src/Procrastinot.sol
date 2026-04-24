// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/access/Ownable2Step.sol";

interface IDegenVault {
    function usdc() external view returns (IERC20);
    function procrastinot() external view returns (address);
    function depositFor(address user, uint256 commitmentId, uint256 amount) external;
}

/// @title Procrastinot
/// @notice On-chain commitment contract. A user stakes USDC against a deadline;
///         an oracle verifies whether the task was done. On success the user gets
///         their stake back; on failure (or on missed deadline) the stake goes to
///         the nominated "enemy".
contract Procrastinot is ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum Status {
        Active, // 0
        Completed, // 1
        Forfeited // 2
    }

    struct Commitment {
        address user;
        address enemy;
        uint128 stake; // USDC, 6 decimals
        uint128 oracleFee; // remaining fee budget, USDC 6 dec
        uint128 initialOracleFee; // original oracleFee, for fee/attempt math
        uint64 deadline; // unix seconds
        uint8 attemptsUsed; // 0..ATTEMPT_CAP
        Status status;
        bool verdictPending; // true after a valid pre-deadline submission until oracle answers
        bytes32 taskHash; // keccak256(abi.encode(task, rubric))
    }

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    uint8 public constant ATTEMPT_CAP = 3;

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    IERC20 public immutable usdc;
    address public oracle;
    address public operatorWallet;
    IDegenVault public degenVault;

    uint256 public nextId;
    mapping(uint256 => Commitment) private _commitments;

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error NotUser();
    error NotOracle();
    error DeadlinePassed();
    error DeadlineNotReached();
    error NotActive();
    error AttemptsExhausted();
    error ZeroStake();
    error BadDeadline();
    error BadEnemy();
    error InvalidOracle();
    error InvalidOperator();
    error InvalidDegenVault();
    error DegenVaultNotSet();
    error VerdictPending();

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

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

    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event OperatorWalletUpdated(address indexed oldOperator, address indexed newOperator);

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(address _usdc, address _oracle, address _operatorWallet) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        oracle = _oracle;
        operatorWallet = _operatorWallet;
    }

    // ---------------------------------------------------------------------
    // External: user flow
    // ---------------------------------------------------------------------

    /// @notice Create a new commitment. Caller must approve `stake + oracleFee` to this contract first.
    function create(
        address enemy,
        uint128 stake,
        uint128 oracleFee,
        uint64 deadline,
        string calldata task,
        string calldata rubric
    ) external nonReentrant returns (uint256 id) {
        if (stake == 0 || oracleFee == 0) revert ZeroStake();
        if (deadline <= block.timestamp + 60) revert BadDeadline();
        if (enemy == msg.sender || enemy == address(0)) revert BadEnemy();

        id = nextId++;
        _commitments[id] = Commitment({
            user: msg.sender,
            enemy: enemy,
            stake: stake,
            oracleFee: oracleFee,
            initialOracleFee: oracleFee,
            deadline: deadline,
            attemptsUsed: 0,
            status: Status.Active,
            verdictPending: false,
            taskHash: keccak256(abi.encode(task, rubric))
        });

        // Pull funds (stake + oracleFee) in a single transferFrom.
        usdc.safeTransferFrom(msg.sender, address(this), uint256(stake) + uint256(oracleFee));

        emit CommitmentCreated(id, msg.sender, enemy, stake, oracleFee, deadline, task, rubric);
    }

    /// @notice Request an oracle verdict for a commitment. Pays per-attempt operator fee.
    function requestVerdict(uint256 id, string calldata evidenceURI) external nonReentrant {
        Commitment storage c = _commitments[id];
        if (c.user != msg.sender) revert NotUser();
        if (c.status != Status.Active) revert NotActive();
        if (block.timestamp >= c.deadline) revert DeadlinePassed();
        if (c.verdictPending) revert VerdictPending();
        if (c.attemptsUsed >= ATTEMPT_CAP) revert AttemptsExhausted();

        uint128 feePerAttempt = c.initialOracleFee / ATTEMPT_CAP;
        // Guard: feePerAttempt may be larger than remaining oracleFee on the final
        // attempt only due to integer-division rounding (initialOracleFee % ATTEMPT_CAP != 0).
        // In that case the pool has less than feePerAttempt left; just pay what remains.
        uint128 pay = feePerAttempt <= c.oracleFee ? feePerAttempt : c.oracleFee;
        c.oracleFee -= pay;
        c.attemptsUsed += 1;
        c.verdictPending = true;

        if (pay > 0) {
            usdc.safeTransfer(operatorWallet, pay);
        }

        emit VerdictRequested(id, evidenceURI, c.attemptsUsed);
    }

    /// @notice Oracle submits a verdict. On pass: stake -> user, remaining oracleFee -> operator.
    ///         On fail: no fund movement (user may retry until ATTEMPT_CAP).
    function submitVerdict(uint256 id, bool passed, bytes32 reasonHash) external nonReentrant {
        if (msg.sender != oracle) revert NotOracle();
        Commitment storage c = _commitments[id];
        if (c.status != Status.Active) revert NotActive();

        emit VerdictSubmitted(id, passed, reasonHash);
        c.verdictPending = false;

        if (passed) {
            uint128 refund = c.stake;
            uint128 remainingFee = c.oracleFee;
            address user = c.user;

            c.stake = 0;
            c.oracleFee = 0;
            c.status = Status.Completed;

            if (remainingFee > 0) {
                usdc.safeTransfer(operatorWallet, remainingFee);
            }
            if (refund > 0) {
                usdc.safeTransfer(user, refund);
            }

            emit Completed(id, user, refund);
        }
    }

    /// @notice Oracle submits a passing verdict and sends the stake to the DegenVault.
    ///         Remaining oracleFee still goes to the operator wallet.
    function submitVerdictToVault(uint256 id, bytes32 reasonHash) external nonReentrant {
        if (msg.sender != oracle) revert NotOracle();

        IDegenVault vault = degenVault;
        address vaultAddress = address(vault);
        if (vaultAddress == address(0)) revert DegenVaultNotSet();

        Commitment storage c = _commitments[id];
        if (c.status != Status.Active) revert NotActive();

        uint128 stakeAmount = c.stake;
        uint128 remainingFee = c.oracleFee;
        address user = c.user;

        c.stake = 0;
        c.oracleFee = 0;
        c.status = Status.Completed;
        c.verdictPending = false;

        emit VerdictSubmitted(id, true, reasonHash);

        if (remainingFee > 0) {
            usdc.safeTransfer(operatorWallet, remainingFee);
        }
        if (stakeAmount > 0) {
            usdc.forceApprove(vaultAddress, stakeAmount);
            vault.depositFor(user, id, stakeAmount);
            usdc.forceApprove(vaultAddress, 0);
        }

        emit SentToDegenVault(id, user, vaultAddress, stakeAmount);
        emit Completed(id, user, 0);
    }

    /// @notice Permissionless forfeit after the deadline. Sends the stake to
    ///         the enemy; any unspent oracleFee goes to the operator wallet
    ///         (the oracle budget is never meant to reward the enemy).
    function forfeit(uint256 id) external nonReentrant {
        Commitment storage c = _commitments[id];
        if (c.status != Status.Active) revert NotActive();
        if (block.timestamp < c.deadline) revert DeadlineNotReached();
        if (c.verdictPending) revert VerdictPending();

        uint128 stakeAmount = c.stake;
        uint128 remainingFee = c.oracleFee;
        address enemy = c.enemy;

        c.stake = 0;
        c.oracleFee = 0;
        c.status = Status.Forfeited;

        if (remainingFee > 0) {
            usdc.safeTransfer(operatorWallet, remainingFee);
        }
        if (stakeAmount > 0) {
            usdc.safeTransfer(enemy, stakeAmount);
        }

        emit Forfeited(id, enemy, stakeAmount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getCommitment(uint256 id) external view returns (Commitment memory) {
        return _commitments[id];
    }

    // ---------------------------------------------------------------------
    // Owner-only: key rotation (no escape hatch for active commitments)
    // ---------------------------------------------------------------------

    function setOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert InvalidOracle();
        emit OracleUpdated(oracle, newOracle);
        oracle = newOracle;
    }

    function setOperatorWallet(address newOperator) external onlyOwner {
        if (newOperator == address(0)) revert InvalidOperator();
        emit OperatorWalletUpdated(operatorWallet, newOperator);
        operatorWallet = newOperator;
    }

    function setDegenVault(address newVault) external onlyOwner {
        _validateDegenVault(newVault);
        emit DegenVaultUpdated(address(degenVault), newVault);
        degenVault = IDegenVault(newVault);
    }

    function _validateDegenVault(address newVault) private view {
        if (newVault == address(0) || newVault.code.length == 0) revert InvalidDegenVault();

        IDegenVault vault = IDegenVault(newVault);
        try vault.usdc() returns (IERC20 vaultUsdc) {
            if (address(vaultUsdc) != address(usdc)) revert InvalidDegenVault();
        } catch {
            revert InvalidDegenVault();
        }

        try vault.procrastinot() returns (address vaultProcrastinot) {
            if (vaultProcrastinot != address(this)) revert InvalidDegenVault();
        } catch {
            revert InvalidDegenVault();
        }
    }
}
