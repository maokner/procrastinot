// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {DegenVault} from "../src/DegenVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract DegenVaultTest is Test {
    DegenVault internal vault;
    MockUSDC internal usdc;

    address internal procrastinot = makeAddr("procrastinot");
    address internal oracle = makeAddr("oracle");
    address internal user = makeAddr("user");
    address internal recipient = makeAddr("recipient");
    address internal rando = makeAddr("rando");

    uint256 internal constant AMOUNT = 100e6;

    event Deposited(address indexed user, uint256 indexed commitmentId, uint256 amount);
    event Released(address indexed user, uint256 amount);

    function setUp() public {
        usdc = new MockUSDC();
        vault = new DegenVault(address(usdc), procrastinot, oracle);

        usdc.mint(procrastinot, 1_000e6);
        vm.prank(procrastinot);
        usdc.approve(address(vault), type(uint256).max);
    }

    function testConstructorRejectsZeroUSDC() public {
        vm.expectRevert(DegenVault.InvalidUSDC.selector);
        new DegenVault(address(0), procrastinot, oracle);
    }

    function testConstructorRejectsZeroProcrastinot() public {
        vm.expectRevert(DegenVault.InvalidProcrastinot.selector);
        new DegenVault(address(usdc), address(0), oracle);
    }

    function testConstructorRejectsZeroOracle() public {
        vm.expectRevert(DegenVault.InvalidOracle.selector);
        new DegenVault(address(usdc), procrastinot, address(0));
    }

    function testDepositOnlyProcrastinot() public {
        vm.prank(rando);
        vm.expectRevert(DegenVault.NotProcrastinot.selector);
        vault.depositFor(user, 1, AMOUNT);
    }

    function testDepositRejectsZeroUser() public {
        vm.prank(procrastinot);
        vm.expectRevert(DegenVault.BadRecipient.selector);
        vault.depositFor(address(0), 1, AMOUNT);
    }

    function testDepositRejectsZeroAmount() public {
        vm.prank(procrastinot);
        vm.expectRevert(DegenVault.ZeroAmount.selector);
        vault.depositFor(user, 1, 0);
    }

    function testDepositCreditsUserAndPullsUSDC() public {
        uint256 procrastinotBefore = usdc.balanceOf(procrastinot);

        vm.expectEmit(true, true, false, true, address(vault));
        emit Deposited(user, 42, AMOUNT);

        vm.prank(procrastinot);
        vault.depositFor(user, 42, AMOUNT);

        assertEq(vault.depositedBalances(user), AMOUNT);
        assertEq(vault.totalHeld(), AMOUNT);
        assertEq(usdc.balanceOf(address(vault)), AMOUNT);
        assertEq(usdc.balanceOf(procrastinot), procrastinotBefore - AMOUNT);
    }

    function testReleaseOnlyOracle() public {
        vm.prank(rando);
        vm.expectRevert(DegenVault.NotOracle.selector);
        vault.releaseFor(recipient, AMOUNT);
    }

    function testReleaseSendsFunds() public {
        vm.prank(procrastinot);
        vault.depositFor(user, 42, AMOUNT);

        vm.expectEmit(true, true, false, true, address(vault));
        emit Released(recipient, AMOUNT);

        vm.prank(oracle);
        vault.releaseFor(recipient, AMOUNT);

        assertEq(vault.depositedBalances(user), AMOUNT);
        assertEq(usdc.balanceOf(recipient), AMOUNT);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function testReleaseRejectsZeroAmount() public {
        vm.prank(oracle);
        vm.expectRevert(DegenVault.ZeroAmount.selector);
        vault.releaseFor(recipient, 0);
    }

    function testReleaseRejectsZeroRecipient() public {
        vm.prank(procrastinot);
        vault.depositFor(user, 42, AMOUNT);

        vm.prank(oracle);
        vm.expectRevert(DegenVault.BadRecipient.selector);
        vault.releaseFor(address(0), AMOUNT);
    }

    function testReleaseRejectsInsufficientVaultBalance() public {
        vm.prank(oracle);
        vm.expectRevert(DegenVault.InsufficientVaultBalance.selector);
        vault.releaseFor(recipient, 1);
    }
}
