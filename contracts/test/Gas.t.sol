// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console} from "forge-std/Test.sol";
import {StealthDisperse} from "../src/StealthDisperse.sol";
import {Fixtures, MockERC20} from "./utils/Fixtures.sol";

/// @notice Gas per payroll line. Recipients are fresh (zero balance), as in production.
///         Run: forge test --match-contract GasTest -vv
contract GasTest is Fixtures {
    MockERC20 internal token;
    address internal employer = makeAddr("employer");

    function setUp() public {
        _etchAnnouncer();
        disperse = new StealthDisperse();
        token = new MockERC20();
        token.mint(employer, 1e30);
        vm.prank(employer);
        token.approve(address(disperse), type(uint256).max);
    }

    function test_gas_10() public {
        _measure(10);
    }

    function test_gas_100() public {
        _measure(100);
    }

    function test_gas_300() public {
        _measure(300);
    }

    function _measure(uint256 n) internal {
        (StealthDisperse.Payment[] memory ps,) = _batch(n, n, 0);
        bytes memory data = abi.encodeCall(StealthDisperse.pay, (token, ps));
        uint256 calldataGas = _calldataGas(data);

        vm.prank(employer);
        uint256 g0 = gasleft();
        disperse.pay(token, ps);
        uint256 exec = g0 - gasleft();

        uint256 txGas = 21_000 + calldataGas + exec;
        console.log("lines", n);
        console.log("  execution gas          ", exec);
        console.log("  calldata gas (EIP-2028)", calldataGas);
        console.log("  tx gas (approx)        ", txGas);
        console.log("  tx gas per line        ", txGas / n);
        console.log("  calldata bytes per line", data.length / n);
    }

    function _calldataGas(bytes memory data) internal pure returns (uint256 g) {
        for (uint256 i; i < data.length; ++i) {
            g += data[i] == 0 ? 4 : 16;
        }
    }
}
