// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {DegenVault} from "../src/DegenVault.sol";
import {Procrastinot} from "../src/Procrastinot.sol";

/// @notice Deploy Procrastinot to Sepolia (or any EVM chain).
/// @dev Reads:
///      - USDC_ADDRESS (optional, defaults to Sepolia USDC)
///      - ORACLE_ADDRESS (required)
///      - OPERATOR_ADDRESS (required)
///      - DEPLOYER_PRIVATE_KEY (required for broadcast; optional for dry run)
contract Deploy is Script {
    // Sepolia USDC (Circle v1, 6 decimals)
    address internal constant USDC_SEPOLIA_DEFAULT = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    function run() external returns (Procrastinot deployed, DegenVault vault) {
        address usdc = vm.envOr("USDC_ADDRESS", USDC_SEPOLIA_DEFAULT);
        address oracle = vm.envAddress("ORACLE_ADDRESS");
        address operator = vm.envAddress("OPERATOR_ADDRESS");

        uint256 pk = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        if (pk != 0) {
            vm.startBroadcast(pk);
        } else {
            vm.startBroadcast();
        }

        deployed = new Procrastinot(usdc, oracle, operator);
        vault = new DegenVault(usdc, address(deployed), oracle);
        deployed.setDegenVault(address(vault));

        vm.stopBroadcast();

        console2.log("USDC       :", usdc);
        console2.log("Oracle     :", oracle);
        console2.log("Operator   :", operator);
        console2.log("Procrastinot deployed at:", address(deployed));
        console2.log("DegenVault deployed at  :", address(vault));
    }
}
