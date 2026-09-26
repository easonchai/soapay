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

    function _pay(address from, Line[] memory ls) internal {
        StealthDisperse.PackedPayment[] memory ps = _pack(ls);
        vm.prank(from);
        disperse.pay(token, ps);
    }

    function _expectAnnouncements(address token_, Line[] memory ls, address payer) internal {
        for (uint256 i; i < ls.length; ++i) {
            vm.expectEmit(true, true, true, true, ANNOUNCER_ADDR);
            emit IERC5564Announcer.Announcement(
                1,
                ls[i].stealthAddress,
                address(disperse),
                _ephemeralKey(ls[i]),
                _expectedMetadata(token_, ls[i], payer)
            );
        }
    }

    // ---------------------------------------------------------------- happy path

    function test_constants() public view {
        assertEq(address(disperse.ANNOUNCER()), ANNOUNCER_ADDR);
        assertEq(disperse.SCHEME_ID(), 1);
        assertEq(disperse.METADATA_SELECTOR(), bytes4(0xa9059cbb));
    }

    function test_pay_emitsAnnouncementPerLine() public {
        (Line[] memory ls, uint256 total) = _lines(5, 1, 0);
        _expectAnnouncements(address(token), ls, employer);
        uint256 before = token.balanceOf(employer);
        _pay(employer, ls);

        assertEq(before - token.balanceOf(employer), total);
        for (uint256 i; i < ls.length; ++i) {
            assertEq(token.balanceOf(ls[i].stealthAddress), ls[i].amount);
        }
        assertEq(token.balanceOf(address(disperse)), 0, "holds no funds");
    }

    function test_pay_metadataDecodesPerSpec() public {
        (Line[] memory ls,) = _lines(3, 7, 0);
        vm.recordLogs();
        _pay(employer, ls);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 seen;
        for (uint256 l; l < logs.length; ++l) {
            if (logs[l].emitter != ANNOUNCER_ADDR) continue;
            Line memory p = ls[seen];
            assertEq(logs[l].topics[0], ANNOUNCEMENT_TOPIC);
            assertEq(uint256(logs[l].topics[1]), 1, "schemeId");
            assertEq(address(uint160(uint256(logs[l].topics[2]))), p.stealthAddress, "stealthAddress");
            assertEq(address(uint160(uint256(logs[l].topics[3]))), address(disperse), "caller");
            (bytes memory eph, bytes memory md) = abi.decode(logs[l].data, (bytes, bytes));
            // ephemeral key rebuilt from prefix | keyX: 33 bytes
            assertEq(eph.length, 33);
            assertEq(eph[0], p.keyPrefix, "key prefix");
            assertEq(bytes32(_slice(eph, 1, 32)), p.keyX, "keyX");
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
        assertEq(seen, ls.length);
    }

    function test_pay_emptyBatchIsNoop() public {
        StealthDisperse.PackedPayment[] memory ps;
        vm.prank(employer);
        disperse.pay(token, ps);
    }

    // ---------------------------------------------------------------- packed encoding

    /// @dev Fixed vectors for the SDK's encodeHead/decodeHead (documented in PLAN.md). The heads are
    ///      literals produced by the TypeScript encoder in tools/derive.ts, not by the Solidity fixture.
    function test_decodeHead_fixedVectors() public view {
        (address a, uint256 amt, bytes1 tag, bytes1 prefix) =
            disperse.decodeHead(0x320ea225f1022f09e9fad52227e35f3006cfcee10000000000003b9aca00e103);
        assertEq(a, 0x320Ea225F1022f09e9fad52227E35f3006CfCEe1);
        assertEq(amt, 1000e6);
        assertEq(tag, bytes1(0xe1));
        assertEq(prefix, bytes1(0x03));

        // every bit set except the prefix: address and amount must not bleed into each other
        (a, amt, tag, prefix) = disperse.decodeHead(0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff02);
        assertEq(a, 0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF);
        assertEq(amt, 2 ** 80 - 1);
        assertEq(tag, bytes1(0xff));
        assertEq(prefix, bytes1(0x02));

        (a, amt, tag, prefix) = disperse.decodeHead(0x0000000000000000000000000000000000000001000000000000000000010003);
        assertEq(a, address(1));
        assertEq(amt, 1);
        assertEq(tag, bytes1(0x00));
        assertEq(prefix, bytes1(0x03));
    }

    /// @dev Lines produced by tools/derive.ts (ScopeLift SDK, scheme 1) with a recipient-side self-check,
    ///      passed exactly as the SDK would encode them.
    function test_pay_sdkEncodedVectors() public {
        StealthDisperse.PackedPayment[] memory ps = new StealthDisperse.PackedPayment[](3);
        ps[0] = StealthDisperse.PackedPayment(
            0x320ea225f1022f09e9fad52227e35f3006cfcee10000000000003b9aca00e103,
            0xaf241a561b7b361c7e4361ce6f1e442937de4e972220c5b249b812dbbd227d8e
        );
        ps[1] = StealthDisperse.PackedPayment(
            0x8425d6ef91098fc4b35480297a1558fa6f333a140000000000003baa0c404c03,
            0x88105b7df8faf26c35b21157ba127296072873ed4a19a05c43a37c094752b747
        );
        ps[2] = StealthDisperse.PackedPayment(
            0xe59d5dc83861e5a443a0007b9dd486e8a928287e0000000000003bb94e80d202,
            0xdf30a6c82fde0aee7e395dd3fb5abbba9be4874140c4b3524a9e613517963e5a
        );
        Line[] memory ls = new Line[](3);
        ls[0] = Line(0x320Ea225F1022f09e9fad52227E35f3006CfCEe1, 1000e6, 0xe1, 0x03, ps[0].keyX);
        ls[1] = Line(0x8425d6Ef91098FC4b35480297A1558Fa6f333A14, 1001e6, 0x4c, 0x03, ps[1].keyX);
        ls[2] = Line(0xE59d5dC83861e5A443A0007b9DD486e8a928287E, 1002e6, 0xd2, 0x02, ps[2].keyX);

        // the SDK-produced key is exactly prefix | keyX
        assertEq(
            _ephemeralKey(ls[0]), hex"03af241a561b7b361c7e4361ce6f1e442937de4e972220c5b249b812dbbd227d8e", "eph key 0"
        );
        for (uint256 i; i < 3; ++i) {
            assertEq(_pack(ls[i]).head, ps[i].head, "Solidity encoder == TS encoder");
        }

        _expectAnnouncements(address(token), ls, employer);
        vm.prank(employer);
        disperse.pay(token, ps);
        assertEq(token.balanceOf(0xE59d5dC83861e5A443A0007b9DD486e8a928287E), 1002e6);
    }

    function test_pay_maxAmountPerLine() public {
        (Line[] memory ls,) = _lines(2, 20, 0);
        ls[1].amount = 2 ** 80 - 1;
        _expectAnnouncements(address(token), ls, employer);
        _pay(employer, ls);
        assertEq(token.balanceOf(ls[1].stealthAddress), 2 ** 80 - 1);
    }

    // ---------------------------------------------------------------- validation

    function test_revert_notAscending() public {
        (Line[] memory ls,) = _lines(4, 2, 0);
        (ls[1], ls[2]) = (ls[2], ls[1]);
        vm.expectRevert(abi.encodeWithSelector(StealthDisperse.NotAscending.selector, 2));
        _pay(employer, ls);
    }

    function test_revert_duplicateAddress() public {
        (Line[] memory ls,) = _lines(4, 3, 0);
        ls[3].stealthAddress = ls[2].stealthAddress;
        vm.expectRevert(abi.encodeWithSelector(StealthDisperse.NotAscending.selector, 3));
        _pay(employer, ls);
    }

    function test_revert_zeroAddress() public {
        (Line[] memory ls,) = _lines(2, 4, 0);
        ls[0].stealthAddress = address(0);
        vm.expectRevert(abi.encodeWithSelector(StealthDisperse.NotAscending.selector, 0));
        _pay(employer, ls);
    }

    function test_revert_zeroAmount() public {
        (Line[] memory ls,) = _lines(3, 5, 0);
        ls[1].amount = 0;
        vm.expectRevert(abi.encodeWithSelector(StealthDisperse.ZeroAmount.selector, 1));
        _pay(employer, ls);
    }

    function test_revert_badEphemeralKeyPrefix() public {
        bytes1[4] memory bad = [bytes1(0x04), bytes1(0x00), bytes1(0x01), bytes1(0xff)];
        for (uint256 k; k < bad.length; ++k) {
            (Line[] memory ls,) = _lines(3, 6, 0);
            ls[2].keyPrefix = bad[k];
            vm.expectRevert(abi.encodeWithSelector(StealthDisperse.BadEphemeralKey.selector, 2));
            _pay(employer, ls);
        }
    }

    /// @dev Several faults on one line: order wins over amount, amount wins over key.
    function test_validationOrder() public {
        (Line[] memory ls,) = _lines(2, 8, 0);
        ls[1].amount = 0;
        ls[1].keyPrefix = 0x04;
        vm.expectRevert(abi.encodeWithSelector(StealthDisperse.ZeroAmount.selector, 1));
        _pay(employer, ls);

        ls[1].stealthAddress = ls[0].stealthAddress;
        vm.expectRevert(abi.encodeWithSelector(StealthDisperse.NotAscending.selector, 1));
        _pay(employer, ls);
    }

    // ---------------------------------------------------------------- atomicity

    function test_failingTransfer_revertsWholeBatch_noEvents() public {
        (Line[] memory ls, uint256 total) = _lines(5, 9, 0);
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
                IERC20Errors.ERC20InsufficientBalance.selector, poorEmployer, ls[4].amount - 1, ls[4].amount
            )
        );
        _pay(poorEmployer, ls);
        assertEq(token.balanceOf(poorEmployer), total - 1);
        for (uint256 i; i < ls.length; ++i) {
            assertEq(token.balanceOf(ls[i].stealthAddress), 0);
        }
    }

    function test_falseReturningToken_revertsWholeBatch() public {
        (Line[] memory ls,) = _lines(4, 10, 0);
        StealthDisperse.PackedPayment[] memory ps = _pack(ls);
        FalseReturningERC20 bad = new FalseReturningERC20(ls[3].stealthAddress);
        bad.mint(employer, 1e30);
        vm.prank(employer);
        bad.approve(address(disperse), type(uint256).max);

        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(bad)));
        vm.prank(employer);
        disperse.pay(IERC20(address(bad)), ps);
        for (uint256 i; i < 3; ++i) {
            assertEq(bad.balanceOf(ls[i].stealthAddress), 0, "earlier lines rolled back");
        }
    }

    function test_revert_tokenWithoutCode() public {
        (StealthDisperse.PackedPayment[] memory ps,) = _batch(1, 11, 0);
        address eoa = makeAddr("notAToken");
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, eoa));
        vm.prank(employer);
        disperse.pay(IERC20(eoa), ps);
    }

    // ---------------------------------------------------------------- authorization

    function test_thirdPartyCannotSpendEmployerAllowance() public {
        (Line[] memory ls,) = _lines(3, 12, 0);
        uint256 before = token.balanceOf(employer);
        // coworker has no balance and no allowance: pay pulls from msg.sender only
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(disperse), 0, ls[0].amount)
        );
        _pay(coworker, ls);
        assertEq(token.balanceOf(employer), before);
    }

    function test_thirdPartyWithOwnFundsDoesNotTouchEmployer() public {
        (Line[] memory ls, uint256 total) = _lines(3, 13, 0);
        token.mint(coworker, total);
        vm.prank(coworker);
        token.approve(address(disperse), total);
        uint256 before = token.balanceOf(employer);
        _expectAnnouncements(address(token), ls, coworker); // payer suffix names the coworker
        _pay(coworker, ls);
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
        (Line[] memory ls, uint256 total) = _lines(3, 14, 0);
        StealthDisperse.PackedPayment[] memory ps = _pack(ls);
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(employer, employerPk, total, block.timestamp);
        _expectAnnouncements(address(token), ls, employer);
        vm.prank(employer);
        disperse.payWithPermit(token, ps, total, block.timestamp, v, r, s);
        assertEq(token.balanceOf(ls[2].stealthAddress), ls[2].amount);
        assertEq(token.allowance(employer, address(disperse)), 0);
    }

    function test_payWithPermit_frontRunPermitStillPays() public {
        vm.prank(employer);
        token.approve(address(disperse), 0);
        (Line[] memory ls, uint256 total) = _lines(3, 15, 0);
        StealthDisperse.PackedPayment[] memory ps = _pack(ls);
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(employer, employerPk, total, block.timestamp);

        // griefer lifts the signature from the mempool and submits it first
        vm.prank(coworker);
        token.permit(employer, address(disperse), total, block.timestamp, v, r, s);

        vm.prank(employer);
        disperse.payWithPermit(token, ps, total, block.timestamp, v, r, s);
        assertEq(token.balanceOf(ls[0].stealthAddress), ls[0].amount);
    }

    function test_payWithPermit_badSigWithoutAllowanceReverts() public {
        vm.prank(employer);
        token.approve(address(disperse), 0);
        (StealthDisperse.PackedPayment[] memory ps, uint256 total) = _batch(2, 16, 0);
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(employer, 0xBAD, total, block.timestamp);
        vm.expectRevert(StealthDisperse.PermitFailed.selector);
        vm.prank(employer);
        disperse.payWithPermit(token, ps, total, block.timestamp, v, r, s);
    }

    function test_payWithPermit_permitBelowTotalReverts() public {
        vm.prank(employer);
        token.approve(address(disperse), 0);
        (StealthDisperse.PackedPayment[] memory ps, uint256 total) = _batch(3, 18, 0);
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(employer, employerPk, total - 1, block.timestamp);
        vm.expectRevert(StealthDisperse.PermitFailed.selector);
        vm.prank(employer);
        disperse.payWithPermit(token, ps, total - 1, block.timestamp, v, r, s);
    }

    function test_payWithPermit_failedPermitButExistingAllowancePays() public {
        (Line[] memory ls,) = _lines(2, 19, 0); // setUp gave max allowance
        StealthDisperse.PackedPayment[] memory ps = _pack(ls);
        vm.prank(employer);
        disperse.payWithPermit(token, ps, 0, 0, 0, bytes32(0), bytes32(0));
        assertEq(token.balanceOf(ls[1].stealthAddress), ls[1].amount);
    }

    function test_payWithPermit_coworkerCannotReplayEmployerPermit() public {
        vm.prank(employer);
        token.approve(address(disperse), 0);
        (StealthDisperse.PackedPayment[] memory ps, uint256 total) = _batch(2, 17, 0);
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
        (Line[] memory ls, uint256 total) = _lines(n, seed, 0);
        uint256 before = token.balanceOf(employer);
        vm.recordLogs();
        _pay(employer, ls);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(before - token.balanceOf(employer), total);
        uint256 announcements;
        for (uint256 l; l < logs.length; ++l) {
            if (logs[l].emitter == ANNOUNCER_ADDR) {
                Line memory p = ls[announcements];
                assertEq(address(uint160(uint256(logs[l].topics[2]))), p.stealthAddress);
                (bytes memory eph, bytes memory md) = abi.decode(logs[l].data, (bytes, bytes));
                assertEq(eph, _ephemeralKey(p));
                assertEq(md, _expectedMetadata(address(token), p, employer));
                ++announcements;
            }
        }
        assertEq(announcements, n);
        assertEq(logs.length, 2 * uint256(n)); // one Transfer + one Announcement per line
    }

    function testFuzz_unsortedReverts(uint8 n, uint256 seed, uint8 swapAt) public {
        n = uint8(bound(n, 2, 32));
        uint256 k = bound(swapAt, 1, n - 1);
        (Line[] memory ls,) = _lines(n, seed, 0);
        (ls[k - 1], ls[k]) = (ls[k], ls[k - 1]);
        vm.expectRevert(abi.encodeWithSelector(StealthDisperse.NotAscending.selector, k));
        _pay(employer, ls);
    }

    /// @dev encode -> decode is lossless for every field when amount < 2^80.
    function testFuzz_headRoundTrip(address stealth, uint80 amount, bytes1 viewTag, bytes1 keyPrefix) public view {
        uint256 head = _encodeHead(stealth, amount, viewTag, keyPrefix);
        (address a, uint256 amt, bytes1 tag, bytes1 prefix) = disperse.decodeHead(head);
        assertEq(a, stealth);
        assertEq(amt, amount);
        assertEq(tag, viewTag);
        assertEq(prefix, keyPrefix);
    }

    /// @dev decode -> encode is the identity on every uint256, so a head has exactly one meaning.
    function testFuzz_headIsBijective(uint256 head) public view {
        (address a, uint256 amt, bytes1 tag, bytes1 prefix) = disperse.decodeHead(head);
        assertEq(_encodeHead(a, amt, tag, prefix), head);
    }

    // ---------------------------------------------------------------- helpers

    function _slice(bytes memory b, uint256 start, uint256 len) internal pure returns (bytes memory out) {
        out = new bytes(len);
        for (uint256 i; i < len; ++i) {
            out[i] = b[start + i];
        }
    }
}
