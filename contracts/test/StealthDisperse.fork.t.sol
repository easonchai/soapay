// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {StealthDisperse, IERC5564Announcer} from "../src/StealthDisperse.sol";
import {Fixtures} from "./utils/Fixtures.sol";

/// @notice Base mainnet fork against real USDC and the real ERC5564Announcer.
///         Skipped unless BASE_RPC_URL is set:  BASE_RPC_URL=... forge test --match-contract Fork -vv
contract StealthDisperseForkTest is Fixtures {
    /// @dev Native USDC on Base (Circle FiatToken proxy), symbol "USDC", 6 decimals.
    IERC20 internal constant USDC = IERC20(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);
    address internal employer = makeAddr("employer");

    function setUp() public {
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        assertEq(block.chainid, 8453, "not Base mainnet");
        assertGt(ANNOUNCER_ADDR.code.length, 0, "announcer not deployed");
        disperse = new StealthDisperse();
        deal(address(USDC), employer, 1_000_000e6);
        vm.prank(employer);
        USDC.approve(address(disperse), type(uint256).max);
    }

    function test_fork_announcerBytecodeMatchesFixture() public view {
        assertEq(ANNOUNCER_ADDR.code, ANNOUNCER_RUNTIME);
    }

    function test_fork_payUSDC() public {
        (StealthDisperse.Payment[] memory ps, uint256 total) = _batch(5, 42, 1_000e6);
        for (uint256 i; i < ps.length; ++i) {
            vm.expectEmit(true, true, true, true, ANNOUNCER_ADDR);
            emit IERC5564Announcer.Announcement(
                1,
                ps[i].stealthAddress,
                address(disperse),
                ps[i].ephemeralPubKey,
                _expectedMetadata(address(USDC), ps[i], employer)
            );
        }
        uint256 before = USDC.balanceOf(employer);
        vm.prank(employer);
        disperse.pay(USDC, ps);
        assertEq(before - USDC.balanceOf(employer), total);
        for (uint256 i; i < ps.length; ++i) {
            assertEq(USDC.balanceOf(ps[i].stealthAddress), 1_000e6);
        }
    }

    /// @dev H1: Base USDC (FiatToken v2.2) validates permits via ERC-1271 when the owner has code, as a
    ///      7702-delegated EOA does. An EOA ECDSA permit then fails; payWithPermit must say so clearly.
    function test_fork_permitFromAccountWithCodeRevertsPermitFailed() public {
        uint256 pk = 0xA11CE;
        address owner = vm.addr(pk);
        deal(address(USDC), owner, 10_000e6);
        (StealthDisperse.Payment[] memory ps, uint256 total) = _batch(2, 77, 100e6);
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                owner,
                address(disperse),
                total,
                IERC20Permit(address(USDC)).nonces(owner),
                block.timestamp
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(
            pk, keccak256(abi.encodePacked("\x19\x01", IERC20Permit(address(USDC)).DOMAIN_SEPARATOR(), structHash))
        );
        // 7702 delegation designator: 0xef0100 || delegate (delegate without isValidSignature)
        vm.etch(owner, abi.encodePacked(hex"ef0100", address(disperse)));
        vm.expectRevert(StealthDisperse.PermitFailed.selector);
        vm.prank(owner);
        disperse.payWithPermit(USDC, ps, total, block.timestamp, v, r, s);
    }

    function test_fork_gasPerLineUSDC() public {
        uint256[3] memory sizes = [uint256(10), 100, 300];
        for (uint256 k; k < 3; ++k) {
            (StealthDisperse.Payment[] memory ps,) = _batch(sizes[k], 1000 + k, 100e6);
            vm.prank(employer);
            uint256 g0 = gasleft();
            disperse.pay(USDC, ps);
            uint256 exec = g0 - gasleft();
            console.log("USDC lines", sizes[k], "exec gas/line", exec / sizes[k]);
        }
    }
}
