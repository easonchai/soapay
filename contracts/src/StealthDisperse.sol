// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Canonical ERC-5564 singleton announcer (ScopeLift/stealth-address-erc-contracts).
interface IERC5564Announcer {
    event Announcement(
        uint256 indexed schemeId,
        address indexed stealthAddress,
        address indexed caller,
        bytes ephemeralPubKey,
        bytes metadata
    );

    function announce(uint256 schemeId, address stealthAddress, bytes memory ephemeralPubKey, bytes memory metadata)
        external;
}

/// @title StealthDisperse
/// @notice Pays a batch of ERC-5564 stealth addresses from msg.sender and announces each one in the
///         same transaction. Holds no funds, keeps no state, has no owner.
/// @dev Threat model: the adversary is a coworker in the same batch. Strict ascending order by stealth
///      address guards against bugs in the employer's app and dedupes lines within a batch; it is not a
///      privacy guarantee on its own (see PLAN.md client invariants).
contract StealthDisperse {
    using SafeERC20 for IERC20;

    /// @notice Canonical ERC5564Announcer, same address on every supported chain incl. Base.
    IERC5564Announcer public constant ANNOUNCER = IERC5564Announcer(0x55649E01B5Df198D18D95b5cc5051630cfD45564);

    /// @notice ERC-5564 scheme 1: secp256k1 with view tags.
    uint256 public constant SCHEME_ID = 1;

    /// @notice Function identifier written into metadata bytes 2-5. `transfer(address,uint256)` rather
    ///         than `transferFrom`: 0x23b872dd is shared with ERC-721, so a scanner could not tell
    ///         whether bytes 26-57 are an amount or a token id.
    bytes4 public constant METADATA_SELECTOR = IERC20.transfer.selector;

    /// @notice One payroll line in two words (64 bytes of calldata).
    /// @dev `head` = stealthAddress(160) | amount(uint80) | viewTag(8) | keyPrefix(8), big-endian:
    ///      `(uint160(stealth) << 96) | (amount << 16) | (viewTag << 8) | keyPrefix`.
    ///      `keyX` is the x-coordinate of the compressed ephemeral key; `keyPrefix` (0x02/0x03) is its
    ///      first byte. Clients must reject amounts >= 2^80 before encoding.
    struct PackedPayment {
        uint256 head;
        bytes32 keyX;
    }

    error NotAscending(uint256 index);
    error BadEphemeralKey(uint256 index);
    error ZeroAmount(uint256 index);
    error PermitFailed();

    /// @notice Transfer each line's amount of `token` from msg.sender to its stealth address and announce
    ///         it. Reverts the whole batch if any line is invalid or any transfer fails.
    /// @param lines Must be strictly ascending by stealth address (rejects duplicates and address(0)).
    function pay(IERC20 token, PackedPayment[] calldata lines) public {
        address prev;
        for (uint256 i; i < lines.length; ++i) {
            (address stealth, uint256 amount, bytes1 viewTag, bytes1 keyPrefix) = decodeHead(lines[i].head);
            _validate(i, stealth, amount, keyPrefix, prev);
            prev = stealth;

            token.safeTransferFrom(msg.sender, stealth, amount);
            ANNOUNCER.announce(
                SCHEME_ID, stealth, abi.encodePacked(keyPrefix, lines[i].keyX), _metadata(token, viewTag, amount)
            );
        }
    }

    /// @notice `pay` preceded by an EIP-2612 permit, for plain EOAs only. The permit is best-effort so a
    ///         front-run permit cannot block payment; afterwards the allowance must cover the batch total,
    ///         otherwise reverts `PermitFailed` instead of an opaque allowance error.
    /// @dev Smart accounts and 7702-delegated EOAs (permit goes through ERC-1271 on the delegate and often
    ///      fails on Base USDC) should instead approve + pay in one EIP-5792 atomic batch.
    function payWithPermit(
        IERC20 token,
        PackedPayment[] calldata lines,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        try IERC20Permit(address(token)).permit(msg.sender, address(this), value, deadline, v, r, s) {} catch {}
        if (token.allowance(msg.sender, address(this)) < _total(lines)) revert PermitFailed();
        pay(token, lines);
    }

    /// @notice Splits a packed head into its fields. Lossless for every uint256; no validation.
    function decodeHead(uint256 head)
        public
        pure
        returns (address stealthAddress, uint256 amount, bytes1 viewTag, bytes1 keyPrefix)
    {
        stealthAddress = address(uint160(head >> 96));
        amount = uint80(head >> 16);
        viewTag = bytes1(uint8(head >> 8));
        keyPrefix = bytes1(uint8(head));
    }

    function _validate(uint256 i, address stealth, uint256 amount, bytes1 keyPrefix, address prev) internal pure {
        // Ascending order: line order is independent of names, no duplicate lines, no address(0).
        if (stealth <= prev) revert NotAscending(i);
        if (amount == 0) revert ZeroAmount(i);
        // Scheme 1 keys are 33-byte SEC1 compressed points; the length is fixed by the encoding.
        if (keyPrefix != 0x02 && keyPrefix != 0x03) revert BadEphemeralKey(i);
    }

    /// @dev ERC-5564 token metadata viewTag(1) | selector(4) | token(20) | amount(32) (57 bytes), followed by
    ///      payer(20) = msg.sender, for 77 bytes total. Announcement.caller is always this contract, so the
    ///      payer suffix is what lets scanners filter spam by known employer. Scanners must still recompute
    ///      the stealth address and read the real token balance; metadata token/amount are untrusted.
    function _metadata(IERC20 token, bytes1 viewTag, uint256 amount) internal view returns (bytes memory) {
        return abi.encodePacked(viewTag, METADATA_SELECTOR, address(token), amount, msg.sender);
    }

    function _total(PackedPayment[] calldata lines) internal pure returns (uint256 total) {
        for (uint256 i; i < lines.length; ++i) {
            total += uint80(lines[i].head >> 16);
        }
    }
}
