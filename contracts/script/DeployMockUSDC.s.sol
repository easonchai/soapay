// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

/// @notice TESTNET ONLY (D-52): deploys MockUSDC on Base Sepolia. The broadcaster becomes the owner
///         (DEFAULT_ADMIN_ROLE); MINTER_ROLE goes to the API faucet/relayer key.
///
///   forge script script/DeployMockUSDC.s.sol --rpc-url base_sepolia \
///     --private-key $DEPLOYER_PRIVATE_KEY --broadcast [--verify]
///
///   MINTER=0x... overrides the minter (default: the API relayer 0x509aD63D73f41FA9DD7162F7FcD3876090C8157F).
contract DeployMockUSDC is Script {
    address internal constant DEFAULT_MINTER = 0x509aD63D73f41FA9DD7162F7FcD3876090C8157F;

    function run() external returns (MockUSDC token) {
        require(block.chainid == 84532 || block.chainid == 31337, "MockUSDC is testnet-only");
        address minter = vm.envOr("MINTER", DEFAULT_MINTER);
        vm.startBroadcast();
        (, address owner,) = vm.readCallers();
        token = new MockUSDC(owner, minter);
        vm.stopBroadcast();
        console.log("MockUSDC deployed at", address(token));
        console.log("owner (admin)", owner);
        console.log("minter", minter);
    }
}
