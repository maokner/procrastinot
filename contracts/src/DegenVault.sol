// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/access/Ownable.sol";

contract DegenVault is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    address public immutable procrastinot;
    address public oracle;

    mapping(address => uint256) public depositedBalances;

    event Deposited(address indexed user, uint256 indexed commitmentId, uint256 amount);
    event Released(address indexed user, uint256 amount);
    event ExcessCollected(address indexed to, uint256 amount);
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);

    error InvalidUSDC();
    error InvalidProcrastinot();
    error InvalidOracle();
    error NotProcrastinot();
    error NotOracle();
    error BadRecipient();
    error ZeroAmount();
    error InsufficientVaultBalance();

    constructor(address _usdc, address _procrastinot, address _oracle) Ownable(msg.sender) {
        if (_usdc == address(0)) revert InvalidUSDC();
        if (_procrastinot == address(0)) revert InvalidProcrastinot();
        if (_oracle == address(0)) revert InvalidOracle();

        usdc = IERC20(_usdc);
        procrastinot = _procrastinot;
        oracle = _oracle;
    }

    function depositFor(address user, uint256 commitmentId, uint256 amount) external nonReentrant {
        if (msg.sender != procrastinot) revert NotProcrastinot();
        if (user == address(0)) revert BadRecipient();
        if (amount == 0) revert ZeroAmount();

        depositedBalances[user] += amount;
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(user, commitmentId, amount);
    }

    function releaseFor(address user, uint256 amount) external nonReentrant {
        if (msg.sender != oracle) revert NotOracle();
        if (user == address(0)) revert BadRecipient();
        if (amount == 0) revert ZeroAmount();
        if (usdc.balanceOf(address(this)) < amount) revert InsufficientVaultBalance();

        emit Released(user, amount);
        usdc.safeTransfer(user, amount);
    }

    function collectExcess(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert BadRecipient();
        if (amount == 0) revert ZeroAmount();
        usdc.safeTransfer(to, amount);
        emit ExcessCollected(to, amount);
    }

    function setOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert InvalidOracle();
        emit OracleUpdated(oracle, newOracle);
        oracle = newOracle;
    }

    function totalHeld() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}
