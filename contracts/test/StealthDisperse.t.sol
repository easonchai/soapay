// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {StealthDisperse, IERC5564Announcer} from "../src/StealthDisperse.sol";
import {Fixtures, MockERC20, FalseReturningERC20} from "./utils/Fixtures.sol";

contract StealthDisperseTest is Fixtures {
    MockERC20 internal token;
    uint256 internal employerPk = 0xE4B10E7;
    address internal employer;
    address internal coworker = makeAddr("coworker");

    function setUp() public {
        _etchAnnouncer();
        disperse = new StealthDisperse();
        token = new MockERC20();
        employer = vm.addr(employerPk);
        token.mint(employer, 1e30);
        vm.prank(employer);
        token.approve(address(disperse), type(uint256).max);
    }

    // ---------------------------------------------------------------- happy path

    function test_constants() public view {
        assertEq(address(disperse.ANNOUNCER()), ANNOUNCER_ADDR);
        assertEq(disperse.SCHEME_ID(), 1);
        assertEq(disperse.METADATA_SELECTOR(), bytes4(0xa9059cbb));
    }

    function test_pay_emitsAnnouncementPerLine() public {
        (StealthDisperse.Payment[] memory ps, uint256 total) = _batch(5, 1, 0);
        for (uint256 i; i < ps.length; ++i) {
            vm.expectEmit(true, true, true, true, ANNOUNCER_ADDR);
            emit IERC5564Announcer.Announcement(
                1,
                ps[i].stealthAddress,
                address(disperse),
                ps[i].ephemeralPubKey,
                _expectedMetadata(address(token), ps[i], employer)
            );
        }
        uint256 before = token.balanceOf(employer);
        vm.prank(employer);
        disperse.pay(token, ps);

        assertEq(before - token.balanceOf(employer), total);
        for (uint256 i; i < ps.length; ++i) {
            assertEq(token.balanceOf(ps[i].stealthAddress), ps[i].amount);
        }
        assertEq(token.balanceOf(address(disperse)), 0, "holds no funds");
    }

    function test_pay_metadataDecodesPerSpec() public {
        (StealthDisperse.Payment[] memory ps,) = _batch(3, 7, 0);
        vm.recordLogs();
        vm.prank(employer);
        disperse.pay(token, ps);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 seen;
        for (uint256 l; l < logs.length; ++l) {
            if (logs[l].emitter != ANNOUNCER_ADDR) continue;
            StealthDisperse.Payment memory p = ps[seen];
            assertEq(logs[l].topics[0], ANNOUNCEMENT_TOPIC);
            assertEq(uint256(logs[l].topics[1]), 1, "schemeId");
            assertEq(address(uint160(uint256(logs[l].topics[2]))), p.stealthAddress, "stealthAddress");
            assertEq(address(uint160(uint256(logs[l].topics[3]))), address(disperse), "caller");
            (bytes memory eph, bytes memory md) = abi.decode(logs[l].data, (bytes, bytes));
            assertEq(eph, p.ephemeralPubKey);
            // byte 1 view tag | bytes 2-5 selector | bytes 6-25 token | bytes 26-57 amount
            assertEq(md.length, 77);
            assertEq(md[0], p.viewTag, "viewTag");
            assertEq(bytes4(_slice(md, 1, 4)), bytes4(0xa9059cbb), "selector");
            assertEq(address(bytes20(_slice(md, 5, 20))), address(token), "token");
            assertEq(uint256(bytes32(_slice(md, 25, 32))), p.amount, "amount");
            // Soapay extension: bytes 58-77 payer (msg.sender of pay)
            assertEq(address(bytes20(_slice(md, 57, 20))), employer, "payer");
            ++seen;
        }
        assertEq(seen, ps.length);
    }

    function test_pay_emptyBatchIsNoop() public {
        StealthDisperse.Payment[] memory ps;
        vm.prank(employer);
        disperse.pay(token, ps);
    }

    /// @dev Lines produced by tools/derive.ts (ScopeLift SDK, scheme 1) with a recipient-side self-check.
    function test_pay_sdkDerivedVectors() public {
        StealthDisperse.Payment[] memory ps = new StealthDisperse.Payment[](3);
        ps[0] = StealthDisperse.Payment(
            0x320Ea225F1022f09e9fad52227E35f3006CfCEe1,
            1000e6,
            hex"03af241a561b7b361c7e4361ce6f1e442937de4e972220c5b249b812dbbd227d8e",
            0xe1
        );
        ps[1] = StealthDisperse.Payment(
            0x8425d6Ef91098FC4b35480297A1558Fa6f333A14,
            1001e6,
            hex"0388105b7df8faf26c35b21157ba127296072873ed4a19a05c43a37c094752b747",
            0x4c
        );
        ps[2] = StealthDisperse.Payment(
            0xE59d5dC83861e5A443A0007b9DD486e8a928287E,
            1002e6,
            hex"02df30a6c82fde0aee7e395dd3fb5abbba9be4874140c4b3524a9e613517963e5a",
            0xd2
        );
        for (uint256 i; i < 3; ++i) {
            vm.expectEmit(true, true, true, true, ANNOUNCER_ADDR);
            emit IERC5564Announcer.Announcement(
                1,
                ps[i].stealthAddress,
                address(disperse),
                ps[i].ephemeralPubKey,
                _expectedMetadata(address(token), ps[i], employer)
            );
        }
        vm.prank(employer);
        disperse.pay(token, ps);
        assertEq(token.balanceOf(0xE59d5dC83861e5A443A0007b9DD486e8a928287E), 1002e6);
    }

    // ---------------------------------------------------------------- validation

    function test_revert_notAscending() public {
        (StealthDisperse.Payment[] memory ps,) = _batch(4, 2, 0);
        (ps[1], ps[2]) = (ps[2], ps[1]);
        vm.expectRevert(abi.encodeWithSelector(StealthDisperse.NotAscending.selector, 2));
        vm.prank(employer);
        disperse.pay(token, ps);
    }

    function test_revert_duplicateAddress() public {
        (StealthDisperse.Payment[] memory ps,) = _batch(4, 3, 0);
        ps[3].stealthAddress = ps[2].stealthAddress;
        vm.expectRevert(abi.encodeWithSelector(StealthDisperse.NotAscending.selector, 3));
        vm.prank(employer);
        disperse.pay(token, ps);
    }

    function test_revert_zeroAddress() public {
        (StealthDisperse.Payment[] memory ps,) = _batch(2, 4, 0);
        ps[0].stealthAddress = address(0);
        vm.expectRevert(abi.encodeWithSelector(StealthDisperse.NotAscending.selector, 0));
        vm.prank(employer);
        disperse.pay(token, ps);
    }

    function test_revert_zeroAmount() public {
        (StealthDisperse.Payment[] memory ps,) = _batch(3, 5, 0);
        ps[1].amount = 0;
        vm.expectRevert(abi.encodeWithSelector(StealthDisperse.ZeroAmount.selector, 1));
        vm.prank(employer);
        disperse.pay(token, ps);
    }

    function test_revert_badEphemeralKeyLength() public {
        (StealthDisperse.Payment[] memory ps,) = _batch(3, 6, 0);
        ps[2].ephemeralPubKey = abi.encodePacked(bytes1(0x02), bytes31(0)); // 32 bytes
        vm.expectRevert(abi.encodeWithSelector(StealthDisperse.BadEphemeralKey.selector, 2));
        vm.prank(employer);
        disperse.pay(token, ps);

        ps[2].ephemeralPubKey = abi.encodePacked(bytes1(0x04), bytes32(0), bytes32(0)); // 65-byte uncompressed
        vm.expectRevert(abi.encodeWithSelector(StealthDisperse.BadEphemeralKey.selector, 2));
        vm.prank(employer);
        disperse.pay(token, ps);

        ps[2].ephemeralPubKey = "";
        vm.expectRevert(abi.encodeWithSelector(StealthDisperse.BadEphemeralKey.selector, 2));
        vm.prank(employer);
        disperse.pay(token, ps);
    }

    function test_revert_badEphemeralKeyPrefix() public {
        (StealthDisperse.Payment[] memory ps,) = _batch(2, 8, 0);
        ps[0].ephemeralPubKey = abi.encodePacked(bytes1(0x04), bytes32(uint256(1)));
        vm.expectRevert(abi.encodeWithSelector(StealthDisperse.BadEphemeralKey.selector, 0));
        vm.prank(employer);
        disperse.pay(token, ps);
    }

    // ---------------------------------------------------------------- atomicity

    function test_failingTransfer_revertsWholeBatch_noEvents() public {
        (StealthDisperse.Payment[] memory ps, uint256 total) = _batch(5, 9, 0);
        address poorEmployer = makeAddr("poor");
        token.mint(poorEmployer, total - 1); // last line cannot be covered
        vm.prank(poorEmployer);
        token.approve(address(disperse), type(uint256).max);

        // Lines 0-3 emit Transfer + Announcement before line 4 fails. The EVM discards logs of a
        // reverted frame, so a top-level revert leaves no Announcement on-chain. (forge's
        // vm.recordLogs also captures logs from reverted frames, so we assert on the revert itself,
        // on state, and on the fact that the failing frame is the whole pay() call.)
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientBalance.selector, poorEmployer, ps[4].amount - 1, ps[4].amount
            )
        );
        vm.prank(poorEmployer);
        disperse.pay(token, ps);
        assertEq(token.balanceOf(poorEmployer), total - 1);
        for (uint256 i; i < ps.length; ++i) {
            assertEq(token.balanceOf(ps[i].stealthAddress), 0);
        }
    }

    function test_falseReturningToken_revertsWholeBatch() public {
        (StealthDisperse.Payment[] memory ps,) = _batch(4, 10, 0);
        FalseReturningERC20 bad = new FalseReturningERC20(ps[3].stealthAddress);
        bad.mint(employer, 1e30);
        vm.prank(employer);
        bad.approve(address(disperse), type(uint256).max);

        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(bad)));
        vm.prank(employer);
        disperse.pay(IERC20(address(bad)), ps);
        for (uint256 i; i < 3; ++i) {
            assertEq(bad.balanceOf(ps[i].stealthAddress), 0, "earlier lines rolled back");
        }
    }

    function test_revert_tokenWithoutCode() public {
        (StealthDisperse.Payment[] memory ps,) = _batch(1, 11, 0);
        address eoa = makeAddr("notAToken");
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, eoa));
        vm.prank(employer);
        disperse.pay(IERC20(eoa), ps);
    }

    // ---------------------------------------------------------------- authorization

    function test_thirdPartyCannotSpendEmployerAllowance() public {
        (StealthDisperse.Payment[] memory ps,) = _batch(3, 12, 0);
        uint256 before = token.balanceOf(employer);
        // coworker has no balance and no allowance: pay pulls from msg.sender only
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(disperse), 0, ps[0].amount)
        );
        vm.prank(coworker);
        disperse.pay(token, ps);
        assertEq(token.balanceOf(employer), before);
    }

    function test_thirdPartyWithOwnFundsDoesNotTouchEmployer() public {
        (StealthDisperse.Payment[] memory ps, uint256 total) = _batch(3, 13, 0);
        token.mint(coworker, total);
        vm.prank(coworker);
        token.approve(address(disperse), total);
        uint256 before = token.balanceOf(employer);
        vm.prank(coworker);
        disperse.pay(token, ps);
        assertEq(token.balanceOf(employer), before);
        assertEq(token.balanceOf(coworker), 0);
    }

    // ---------------------------------------------------------------- permit

    function _permitSig(address owner_, uint256 pk, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                owner_,
                address(disperse),
                value,
                token.nonces(owner_),
                deadline
            )
        );
        return vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash)));
    }

    function test_payWithPermit() public {
        vm.prank(employer);
        token.approve(address(disperse), 0);
        (StealthDisperse.Payment[] memory ps, uint256 total) = _batch(3, 14, 0);
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(employer, employerPk, total, block.timestamp);
        vm.prank(employer);
        disperse.payWithPermit(token, ps, total, block.timestamp, v, r, s);
        assertEq(token.balanceOf(ps[2].stealthAddress), ps[2].amount);
        assertEq(token.allowance(employer, address(disperse)), 0);
    }

    function test_payWithPermit_frontRunPermitStillPays() public {
        vm.prank(employer);
        token.approve(address(disperse), 0);
        (StealthDisperse.Payment[] memory ps, uint256 total) = _batch(3, 15, 0);
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(employer, employerPk, total, block.timestamp);

        // griefer lifts the signature from the mempool and submits it first
        vm.prank(coworker);
        token.permit(employer, address(disperse), total, block.timestamp, v, r, s);

        vm.prank(employer);
        disperse.payWithPermit(token, ps, total, block.timestamp, v, r, s);
        assertEq(token.balanceOf(ps[0].stealthAddress), ps[0].amount);
    }

    function test_payWithPermit_badSigWithoutAllowanceReverts() public {
        vm.prank(employer);
        token.approve(address(disperse), 0);
        (StealthDisperse.Payment[] memory ps, uint256 total) = _batch(2, 16, 0);
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(employer, 0xBAD, total, block.timestamp);
        vm.expectRevert(StealthDisperse.PermitFailed.selector);
        vm.prank(employer);
        disperse.payWithPermit(token, ps, total, block.timestamp, v, r, s);
    }

    function test_payWithPermit_permitBelowTotalReverts() public {
        vm.prank(employer);
        token.approve(address(disperse), 0);
        (StealthDisperse.Payment[] memory ps, uint256 total) = _batch(3, 18, 0);
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(employer, employerPk, total - 1, block.timestamp);
        vm.expectRevert(StealthDisperse.PermitFailed.selector);
        vm.prank(employer);
        disperse.payWithPermit(token, ps, total - 1, block.timestamp, v, r, s);
    }

    function test_payWithPermit_failedPermitButExistingAllowancePays() public {
        (StealthDisperse.Payment[] memory ps,) = _batch(2, 19, 0); // setUp gave max allowance
        vm.prank(employer);
        disperse.payWithPermit(token, ps, 0, 0, 0, bytes32(0), bytes32(0));
        assertEq(token.balanceOf(ps[1].stealthAddress), ps[1].amount);
    }

    function test_payWithPermit_coworkerCannotReplayEmployerPermit() public {
        vm.prank(employer);
        token.approve(address(disperse), 0);
        (StealthDisperse.Payment[] memory ps, uint256 total) = _batch(2, 17, 0);
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(employer, employerPk, total, block.timestamp);
        // permit is verified against msg.sender (coworker), so it fails and coworker has no allowance
        vm.expectRevert(StealthDisperse.PermitFailed.selector);
        vm.prank(coworker);
        disperse.payWithPermit(token, ps, total, block.timestamp, v, r, s);
        assertEq(token.allowance(employer, address(disperse)), 0);
    }

    // ---------------------------------------------------------------- fuzz

    function testFuzz_pay(uint8 n, uint256 seed) public {
        n = uint8(bound(n, 1, 64));
        (StealthDisperse.Payment[] memory ps, uint256 total) = _batch(n, seed, 0);
        uint256 before = token.balanceOf(employer);
        vm.recordLogs();
        vm.prank(employer);
        disperse.pay(token, ps);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(before - token.balanceOf(employer), total);
        uint256 announcements;
        for (uint256 l; l < logs.length; ++l) {
            if (logs[l].emitter == ANNOUNCER_ADDR) {
                (, bytes memory md) = abi.decode(logs[l].data, (bytes, bytes));
                assertEq(md, _expectedMetadata(address(token), ps[announcements], employer));
                ++announcements;
            }
        }
        assertEq(announcements, n);
        assertEq(logs.length, 2 * uint256(n)); // one Transfer + one Announcement per line
    }

    function testFuzz_unsortedReverts(uint8 n, uint256 seed, uint8 swapAt) public {
        n = uint8(bound(n, 2, 32));
        uint256 k = bound(swapAt, 1, n - 1);
        (StealthDisperse.Payment[] memory ps,) = _batch(n, seed, 0);
        (ps[k - 1], ps[k]) = (ps[k], ps[k - 1]);
        vm.expectRevert(abi.encodeWithSelector(StealthDisperse.NotAscending.selector, k));
        vm.prank(employer);
        disperse.pay(token, ps);
    }

    // ---------------------------------------------------------------- helpers

    function _slice(bytes memory b, uint256 start, uint256 len) internal pure returns (bytes memory out) {
        out = new bytes(len);
        for (uint256 i; i < len; ++i) {
            out[i] = b[start + i];
        }
    }
}
