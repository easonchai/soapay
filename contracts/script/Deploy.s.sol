// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {StealthDisperse} from "../src/StealthDisperse.sol";

/// @notice Deterministic CREATE2 deploy (via the standard 0x4e59...956C deployer), so StealthDisperse
///         lands at the same address on every chain for a given salt and bytecode.
///
///   forge script script/Deploy.s.sol --rpc-url base --account <keystore> --broadcast --verify
///
///   Override the salt with SALT=0x... in the environment.
contract Deploy is Script {
    address internal constant ANNOUNCER = 0x55649E01B5Df198D18D95b5cc5051630cfD45564;

    function run() external returns (StealthDisperse d) {
        require(ANNOUNCER.code.length > 0, "ERC5564Announcer missing on this chain");
        bytes32 salt = vm.envOr("SALT", keccak256("soapay.StealthDisperse.v1"));

        address predicted = vm.computeCreate2Address(salt, keccak256(type(StealthDisperse).creationCode));
        if (predicted.code.length > 0) {
            console.log("already deployed at", predicted);
            return StealthDisperse(predicted);
        }

        vm.startBroadcast();
        d = new StealthDisperse{salt: salt}();
        vm.stopBroadcast();

        require(address(d) == predicted, "unexpected address");
        console.log("StealthDisperse deployed at", address(d));
    }
}
