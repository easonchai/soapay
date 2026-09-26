// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {StealthDisperse} from "../src/StealthDisperse.sol";
import {Fixtures} from "./utils/Fixtures.sol";

contract MockUSDCTest is Test {
    MockUSDC internal token;
    address internal owner = makeAddr("owner");
    address internal minter = makeAddr("minter");
    address internal stranger = makeAddr("stranger");
    uint256 internal holderPk = 0xA11CE;
    address internal holder;

    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    function setUp() public {
        token = new MockUSDC(owner, minter);
        holder = vm.addr(holderPk);
    }

    function test_metadata() public view {
        assertEq(token.name(), "USD Coin (Soapay test)");
        assertEq(token.symbol(), "USDC");
        assertEq(token.decimals(), 6);
        assertEq(token.version(), "1");
        assertTrue(token.hasRole(token.DEFAULT_ADMIN_ROLE(), owner));
        assertTrue(token.hasRole(token.MINTER_ROLE(), minter));
        assertFalse(token.hasRole(token.MINTER_ROLE(), owner));
    }

    function test_minterMints() public {
        vm.prank(minter);
        token.mint(holder, 1_000_000e6);
        assertEq(token.balanceOf(holder), 1_000_000e6);
        assertEq(token.totalSupply(), 1_000_000e6);
    }

    function test_strangerCannotMint() public {
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, token.MINTER_ROLE()));
        vm.prank(stranger);
        token.mint(stranger, 1);
    }

    function test_ownerCannotMintWithoutRole() public {
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, owner, token.MINTER_ROLE()));
        vm.prank(owner);
        token.mint(owner, 1);
    }

    function test_ownerGrantsAndRevokesMinter() public {
        bytes32 role = token.MINTER_ROLE();
        vm.prank(owner);
        token.grantRole(role, owner);
        vm.prank(owner);
        token.mint(owner, 5);
        vm.prank(owner);
        token.revokeRole(role, owner);
        vm.expectRevert();
        vm.prank(owner);
        token.mint(owner, 5);
        assertEq(token.balanceOf(owner), 5);
    }

    function test_minterCannotGrantRoles() public {
        bytes32 role = token.MINTER_ROLE();
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, minter, token.DEFAULT_ADMIN_ROLE()));
        vm.prank(minter);
        token.grantRole(role, stranger);
    }

    function test_zeroMinterSkipsRole() public {
        MockUSDC t = new MockUSDC(owner, address(0));
        assertFalse(t.hasRole(t.MINTER_ROLE(), address(0)));
    }

    function _permitDigest(address spender, uint256 value, uint256 nonce, uint256 deadline) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, holder, spender, value, nonce, deadline));
        return keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
    }

    function test_permitSetsAllowanceAndNonce() public {
        address spender = makeAddr("spender");
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(holderPk, _permitDigest(spender, 123e6, 0, deadline));
        token.permit(holder, spender, 123e6, deadline, v, r, s);
        assertEq(token.allowance(holder, spender), 123e6);
        assertEq(token.nonces(holder), 1);

        vm.prank(minter);
        token.mint(holder, 200e6);
        vm.prank(spender);
        token.transferFrom(holder, spender, 123e6);
        assertEq(token.balanceOf(spender), 123e6);
    }

    function test_permitDomainMatchesEip712() public view {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("USD Coin (Soapay test)")),
                keccak256(bytes("1")),
                block.chainid,
                address(token)
            )
        );
        assertEq(token.DOMAIN_SEPARATOR(), expected);
    }

    function test_permitReplayReverts() public {
        address spender = makeAddr("spender");
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(holderPk, _permitDigest(spender, 1, 0, deadline));
        token.permit(holder, spender, 1, deadline, v, r, s);
        vm.expectRevert();
        token.permit(holder, spender, 1, deadline, v, r, s);
    }

    function test_expiredPermitReverts() public {
        address spender = makeAddr("spender");
        uint256 deadline = block.timestamp;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(holderPk, _permitDigest(spender, 1, 0, deadline));
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(ERC20Permit.ERC2612ExpiredSignature.selector, deadline));
        token.permit(holder, spender, 1, deadline, v, r, s);
    }

    function test_wrongSignerPermitReverts() public {
        address spender = makeAddr("spender");
        uint256 deadline = block.timestamp + 1;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xB0B, _permitDigest(spender, 1, 0, deadline));
        vm.expectRevert();
        token.permit(holder, spender, 1, deadline, v, r, s);
    }
}

/// StealthDisperse is token-agnostic: a pay run with the mock token and a permit works unchanged.
contract MockUSDCDisperseTest is Fixtures {
    MockUSDC internal token;
    uint256 internal employerPk = 0xE4B10E7;
    address internal employer;

    function setUp() public {
        _etchAnnouncer();
        disperse = new StealthDisperse();
        token = new MockUSDC(address(this), address(this));
        employer = vm.addr(employerPk);
        token.mint(employer, 1e18);
    }

    function test_payWithPermit_mockUsdc() public {
        (Line[] memory ls, uint256 total) = _lines(3, 7, 0);
        StealthDisperse.PackedPayment[] memory ps = _pack(ls);
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                employer,
                address(disperse),
                total,
                token.nonces(employer),
                block.timestamp
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(employerPk, keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash)));
        vm.prank(employer);
        disperse.payWithPermit(token, ps, total, block.timestamp, v, r, s);
        for (uint256 i; i < ls.length; ++i) {
            assertEq(token.balanceOf(ls[i].stealthAddress), ls[i].amount);
        }
        assertEq(token.allowance(employer, address(disperse)), 0);
    }
}
