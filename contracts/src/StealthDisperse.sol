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

    /// @notice Scheme 1 ephemeral keys are SEC1 compressed secp256k1 points.
    uint256 public constant EPHEMERAL_KEY_LENGTH = 33;

    /// @notice Function identifier written into metadata bytes 2-5. `transfer(address,uint256)` rather
    ///         than `transferFrom`: 0x23b872dd is shared with ERC-721, so a scanner could not tell
    ///         whether bytes 26-57 are an amount or a token id.
    bytes4 public constant METADATA_SELECTOR = IERC20.transfer.selector;

    struct Payment {
        address stealthAddress;
        uint256 amount;
        bytes ephemeralPubKey; // 33-byte compressed secp256k1 point
        bytes1 viewTag;
    }

    error NotAscending(uint256 index);
    error BadEphemeralKey(uint256 index);
    error ZeroAmount(uint256 index);
    error PermitFailed();

    /// @notice Transfer `payments[i].amount` of `token` from msg.sender to each stealth address and
    ///         announce it. Reverts the whole batch if any line is invalid or any transfer fails.
    /// @param payments Must be strictly ascending by stealthAddress (rejects duplicates and address(0)).
    function pay(IERC20 token, Payment[] calldata payments) public {
        address prev;
        for (uint256 i; i < payments.length; ++i) {
            Payment calldata p = payments[i];
            _validate(i, p, prev);
            prev = p.stealthAddress;

            token.safeTransferFrom(msg.sender, p.stealthAddress, p.amount);
            ANNOUNCER.announce(SCHEME_ID, p.stealthAddress, p.ephemeralPubKey, _metadata(token, p));
        }
    }

    /// @notice `pay` preceded by an EIP-2612 permit, for plain EOAs only. The permit is best-effort so a
    ///         front-run permit cannot block payment; afterwards the allowance must cover the batch total,
    ///         otherwise reverts `PermitFailed` instead of an opaque allowance error.
    /// @dev Smart accounts and 7702-delegated EOAs (permit goes through ERC-1271 on the delegate and often
    ///      fails on Base USDC) should instead approve + pay in one EIP-5792 atomic batch.
    function payWithPermit(
        IERC20 token,
        Payment[] calldata payments,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        try IERC20Permit(address(token)).permit(msg.sender, address(this), value, deadline, v, r, s) {} catch {}
        if (token.allowance(msg.sender, address(this)) < _total(payments)) revert PermitFailed();
        pay(token, payments);
    }

    function _validate(uint256 i, Payment calldata p, address prev) internal pure {
        // Ascending order: line order is independent of names, no duplicate lines, no address(0).
        if (p.stealthAddress <= prev) revert NotAscending(i);
        if (p.amount == 0) revert ZeroAmount(i);
        bytes calldata k = p.ephemeralPubKey;
        if (k.length != EPHEMERAL_KEY_LENGTH || (k[0] != 0x02 && k[0] != 0x03)) revert BadEphemeralKey(i);
    }

    /// @dev ERC-5564 token metadata viewTag(1) | selector(4) | token(20) | amount(32) (57 bytes), followed by
    ///      payer(20) = msg.sender, for 77 bytes total. Announcement.caller is always this contract, so the
    ///      payer suffix is what lets scanners filter spam by known employer. Scanners must still recompute
    ///      the stealth address and read the real token balance; metadata token/amount are untrusted.
    function _metadata(IERC20 token, Payment calldata p) internal view returns (bytes memory) {
        return abi.encodePacked(p.viewTag, METADATA_SELECTOR, address(token), p.amount, msg.sender);
    }

    function _total(Payment[] calldata payments) internal pure returns (uint256 total) {
        for (uint256 i; i < payments.length; ++i) {
            total += payments[i].amount;
        }
    }
}
