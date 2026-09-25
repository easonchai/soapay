// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {
    ENSv2Sepolia as E,
    Grant,
    IRegistryV2,
    IPermissionedResolverV2,
    IVerifiableFactory,
    IUserRegistryInit,
    IETHRegistrarV2,
    IUniversalResolverV2,
    ITextResolver,
    IAddrResolver,
    IMintableERC20
} from "./utils/ENSv2.sol";

/// @notice Soapay names on the LIVE ENSv2 Sepolia deployment (docs/mvp-spec.md §2, contracts/ENSV2.md).
///
/// Every contract touched here is the real deployed ENSv2 contract on a Sepolia fork: the .eth
/// parent is bought through the real ETHRegistrar (commit/reveal, paid in the testnet MockUSDC
/// the registrar accepts), the subname registry and every resolver are proxies of the real
/// implementations deployed through the real VerifiableFactory, and resolution goes through the
/// real Universal Resolver proxy that viem uses on Sepolia. No ENS contract is mocked.
///
/// Skipped unless SEPOLIA_RPC_URL is set:
///   SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com forge test --match-contract ENSv2NamesFork -vv
contract ENSv2NamesForkTest is Test {
    error EACUnauthorizedAccountRoles(uint256 resource, uint256 roleBitmap, address account);
    error TransferDisallowed(uint256 tokenId, address from);
    error TransferUnsafeUntilRegistryIsEmancipated();

    string internal constant STEALTH = "stealth";
    string internal constant REGISTRANT_KEY = "soapay:registrant";
    string internal constant META_1 =
        "st:eth:0x02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa03bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    string internal constant META_2 =
        "st:eth:0x02cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc03dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

    IRegistryV2 internal constant ETH = IRegistryV2(E.ETH_REGISTRY);
    IVerifiableFactory internal constant FACTORY = IVerifiableFactory(E.VERIFIABLE_FACTORY);
    IUniversalResolverV2 internal constant UR = IUniversalResolverV2(E.UNIVERSAL_RESOLVER);

    address internal owner = makeAddr("soapay.eth owner");
    address internal issuer = makeAddr("api issuer");
    address internal registrant = makeAddr("alice registrant");
    address internal mallory = makeAddr("mallory coworker");
    address internal guard = makeAddr("SoapayNameGuard");

    string internal parent; // parent label, e.g. "soapay" if still available on Sepolia
    IRegistryV2 internal subnames;

    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        assertEq(block.chainid, 11155111, "not Sepolia");
        assertGt(E.ETH_REGISTRY.code.length, 0, "ETHRegistry missing");
        // The Universal Resolver proxy viem uses must route to the ENSv2 root.
        (, bytes32 ethNode,) = UR.findResolver(hex"0365746800");
        assertEq(ethNode, keccak256(abi.encode(bytes32(0), keccak256("eth"))));

        IETHRegistrarV2 registrar = IETHRegistrarV2(E.ETH_REGISTRAR);
        parent = registrar.isAvailable("soapay")
            ? "soapay"
            : string.concat("soapay-fork-", vm.toString(block.number));
        _buyParentThroughRealRegistrar(registrar);
        subnames = _setupParent();
    }

    // ------------------------------------------------------------------
    // The full lifecycle
    // ------------------------------------------------------------------

    function test_fork_fullLifecycle() public {
        bytes memory dns = E.dnsEncode("alice", parent, "eth");
        bytes32 node = E.namehash3("alice", parent, "eth");

        // Issuer holds exactly ROLE_REGISTRAR on the subname registry, nothing else.
        assertEq(subnames.roles(0, issuer), E.ROLE_REGISTRAR, "issuer roles");

        // (c) issue alice.<parent>.eth with its own resolver, records and EAC roles.
        address resolver = _issue("alice", registrant, registrant, META_1);
        IPermissionedResolverV2 r = IPermissionedResolverV2(resolver);
        assertEq(FACTORY.verifyContract(resolver), E.PERMISSIONED_RESOLVER_IMPL, "not a factory resolver");
        assertEq(subnames.getResolver("alice"), resolver);

        // Roles on the per-name resolver.
        assertEq(r.roles(0, owner), E.ALL_ROLES, "parent admin keeps every resolver role");
        assertEq(r.roles(0, issuer), 0, "issuer has no resolver role");
        assertEq(r.roles(0, E.VERIFIABLE_FACTORY), 0, "factory bootstrap role revoked");
        assertEq(r.roles(0, registrant), 0, "registrant has no root role");
        assertEq(r.roles(E.textResource(STEALTH), registrant), E.ROLE_SET_TEXT, "registrant: stealth only");

        // Registry token: owned by registrant, zero roles => cannot transfer, set resolver, unregister.
        IRegistryV2.State memory st = subnames.getState(uint256(keccak256("alice")));
        assertEq(uint8(st.status), uint8(IRegistryV2.Status.REGISTERED));
        assertEq(st.expiry, type(uint64).max);
        assertEq(subnames.ownerOf(st.tokenId), registrant);
        assertEq(subnames.roles(st.resource, registrant), 0, "token carries no roles");

        // (f) resolution through the real Universal Resolver.
        assertEq(_resolveText(dns, node, STEALTH), META_1);
        assertEq(_resolveText(dns, node, REGISTRANT_KEY), vm.toString(registrant));
        (bytes memory addrRes,) = UR.resolve(dns, abi.encodeCall(IAddrResolver.addr, (node)));
        assertEq(abi.decode(addrRes, (address)), address(0), "addr must be unset");

        // (d) registrant rotates the stealth meta-address.
        vm.prank(registrant);
        r.setText(dns, STEALTH, META_2);
        assertEq(_resolveText(dns, node, STEALTH), META_2);

        // A coworker can't touch the stealth record, nor can the issuer.
        vm.prank(mallory);
        vm.expectRevert(_unauthorized(E.textResource(STEALTH), E.ROLE_SET_TEXT, mallory));
        r.setText(dns, STEALTH, META_1);
        vm.prank(issuer);
        vm.expectRevert(_unauthorized(E.textResource(STEALTH), E.ROLE_SET_TEXT, issuer));
        r.setText(dns, STEALTH, META_1);

        // Nobody but the parent can touch other records, including the registrant.
        vm.startPrank(registrant);
        vm.expectRevert(_unauthorized(E.textResource(REGISTRANT_KEY), E.ROLE_SET_TEXT, registrant));
        r.setText(dns, REGISTRANT_KEY, vm.toString(mallory));
        vm.expectRevert(_unauthorized(E.textResource("url"), E.ROLE_SET_TEXT, registrant));
        r.setText(dns, "url", "https://evil.example");
        vm.expectRevert(_unauthorized(uint256(keccak256(abi.encodePacked(uint256(60)))), E.ROLE_SET_ADDRESS, registrant));
        r.setAddress(dns, 60, abi.encodePacked(registrant));
        vm.stopPrank();
        vm.startPrank(mallory);
        vm.expectRevert();
        r.setText(dns, REGISTRANT_KEY, vm.toString(mallory));
        vm.expectRevert();
        r.setAddress(dns, 60, abi.encodePacked(mallory));
        vm.stopPrank();
        assertEq(_resolveText(dns, node, REGISTRANT_KEY), vm.toString(registrant));
        (addrRes,) = UR.resolve(dns, abi.encodeCall(IAddrResolver.addr, (node)));
        assertEq(abi.decode(addrRes, (address)), address(0), "addr still unset");

        // Non-transferable: both the ERC1155 safe path and the unsafe path revert.
        vm.startPrank(registrant);
        // Safe transfers are refused outright while the parent keeps revocation rights ("unemancipated")...
        vm.expectRevert(TransferUnsafeUntilRegistryIsEmancipated.selector);
        subnames.safeTransferFrom(registrant, mallory, st.tokenId, 1, "");
        // ...and the explicit unsafe path fails because the token lacks ROLE_CAN_TRANSFER_ADMIN.
        vm.expectRevert(abi.encodeWithSelector(TransferDisallowed.selector, st.tokenId, registrant));
        subnames.unsafeTransfer(mallory, st.tokenId, "");
        vm.expectRevert();
        subnames.setResolver(st.tokenId, mallory);
        vm.stopPrank();

        // The issuer can't revoke or re-point names, and can't re-register a live name.
        vm.startPrank(issuer);
        vm.expectRevert(_unauthorized(st.resource, E.ROLE_UNREGISTER, issuer));
        subnames.unregister(st.tokenId);
        vm.expectRevert();
        subnames.setResolver(st.tokenId, mallory);
        vm.expectRevert();
        subnames.register("alice", mallory, address(0), mallory, 0, type(uint64).max);
        vm.expectRevert();
        subnames.grantRootRoles(E.ROLE_REGISTRAR, mallory);
        vm.stopPrank();

        // (e) the parent revokes: the name disappears from resolution.
        vm.prank(owner);
        subnames.unregister(uint256(keccak256("alice")));
        assertEq(subnames.getResolver("alice"), address(0));
        vm.expectRevert();
        UR.resolve(dns, abi.encodeCall(ITextResolver.text, (node, STEALTH)));
    }

    /// Option A rotation (docs/mvp-spec.md §2.1): after issuance the REGISTRANT rewrites `stealth` with
    /// its own key (gas sponsored by the API) and resolution returns the new meta-address each time.
    function test_fork_registrantRotatesStealthAfterIssuance() public {
        bytes memory dns = E.dnsEncode("erin", parent, "eth");
        bytes32 node = E.namehash3("erin", parent, "eth");
        address resolver = _issue("erin", registrant, registrant, META_1); // default writer = registrant
        IPermissionedResolverV2 r = IPermissionedResolverV2(resolver);
        assertEq(_resolveText(dns, node, STEALTH), META_1);

        // Rotation 1: exactly the call buildSetStealthRecordCall() encodes, sent by the registrant.
        vm.prank(registrant);
        (bool ok,) = resolver.call(abi.encodeCall(IPermissionedResolverV2.setText, (dns, STEALTH, META_2)));
        assertTrue(ok, "registrant rotation");
        assertEq(_resolveText(dns, node, STEALTH), META_2, "resolves to rotated meta");

        // Rotation 2 (e.g. another key loss): still the registrant, still only `stealth`.
        vm.prank(registrant);
        r.setText(dns, STEALTH, META_1);
        assertEq(_resolveText(dns, node, STEALTH), META_1, "resolves to second rotation");

        // Nothing else moved: registrant record unchanged, addr unset, token unchanged.
        assertEq(_resolveText(dns, node, REGISTRANT_KEY), vm.toString(registrant));
        (bytes memory addrRes,) = UR.resolve(dns, abi.encodeCall(IAddrResolver.addr, (node)));
        assertEq(abi.decode(addrRes, (address)), address(0));
        assertEq(subnames.ownerOf(subnames.getState(uint256(keccak256("erin"))).tokenId), registrant);

        // A coworker can't rotate it.
        vm.prank(mallory);
        vm.expectRevert(_unauthorized(E.textResource(STEALTH), E.ROLE_SET_TEXT, mallory));
        r.setText(dns, STEALTH, META_2);
    }

    /// Fixed vector shared with packages/sdk/test/ensv2.test.ts (predictProxyAddress).
    function test_fork_predictProxyAddressVector() public {
        address deployer = 0x000000000000000000000000000000000000dEaD;
        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant(owner, E.ALL_ROLES);
        vm.prank(deployer);
        address proxy = FACTORY.deployProxy(
            E.PERMISSIONED_RESOLVER_IMPL,
            42,
            abi.encodeCall(IPermissionedResolverV2.initialize, (grants, new bytes[](0)))
        );
        assertEq(proxy, _predictProxy(deployer, 42));
        assertEq(FACTORY.proxyLogic(), 0xC6dbA04e7c6264e85A459Dd592a6CBC2D2a6Ad8E, "proxyLogic");
        emit log_named_address("vector proxy (deployer 0xdead, salt 42)", proxy);
    }

    /// World ID gate: the stealth-writer role goes to a guard, and the registrant can't bypass it.
    function test_fork_stealthWriterGuard() public {
        bytes memory dns = E.dnsEncode("bob", parent, "eth");
        bytes32 node = E.namehash3("bob", parent, "eth");
        address resolver = _issue("bob", registrant, guard, META_1);
        IPermissionedResolverV2 r = IPermissionedResolverV2(resolver);

        assertEq(r.roles(E.textResource(STEALTH), guard), E.ROLE_SET_TEXT);
        assertEq(r.roles(E.textResource(STEALTH), registrant), 0);

        vm.prank(registrant);
        vm.expectRevert(_unauthorized(E.textResource(STEALTH), E.ROLE_SET_TEXT, registrant));
        r.setText(dns, STEALTH, META_2);

        vm.prank(guard);
        r.setText(dns, STEALTH, META_2);
        assertEq(_resolveText(dns, node, STEALTH), META_2);

        // The guard only got `stealth`.
        vm.prank(guard);
        vm.expectRevert();
        r.setText(dns, REGISTRANT_KEY, vm.toString(guard));

        // The parent admin swaps the writer: revoke the guard, grant the registrant.
        vm.startPrank(owner);
        r.revokeRoles(E.textResource(STEALTH), E.ROLE_SET_TEXT, guard);
        r.grantSetterRoles(abi.encodeCall(IPermissionedResolverV2.setText, (dns, STEALTH, "")), registrant);
        vm.stopPrank();

        vm.prank(guard);
        vm.expectRevert();
        r.setText(dns, STEALTH, META_1);
        vm.prank(registrant);
        r.setText(dns, STEALTH, META_1);
        assertEq(_resolveText(dns, node, STEALTH), META_1);
    }

    /// Per-employee resolvers: one employee's writer role does not reach another employee's name.
    function test_fork_rolesDoNotCrossNames() public {
        address rA = _issue("carol", registrant, registrant, META_1);
        address rB = _issue("dave", mallory, mallory, META_2);
        assertTrue(rA != rB, "each name has its own resolver");
        bytes memory dnsB = E.dnsEncode("dave", parent, "eth");
        vm.prank(registrant);
        vm.expectRevert();
        IPermissionedResolverV2(rB).setText(dnsB, STEALTH, META_1);
        assertEq(_resolveText(dnsB, E.namehash3("dave", parent, "eth"), STEALTH), META_2);
    }

    // ------------------------------------------------------------------
    // Flow helpers (mirror packages/sdk/src/ensv2.ts)
    // ------------------------------------------------------------------

    function _buyParentThroughRealRegistrar(IETHRegistrarV2 registrar) internal {
        uint64 duration = 365 days;
        if (duration < registrar.MIN_REGISTER_DURATION()) duration = registrar.MIN_REGISTER_DURATION();
        bytes32 secret = keccak256("soapay fork secret");
        bytes32 commitment =
            registrar.makeCommitment(parent, owner, secret, address(0), address(0), duration, bytes32(0));
        (uint256 base, uint256 premium) = registrar.getRegisterPrice(parent, duration, E.MOCK_USDC);
        vm.startPrank(owner);
        IMintableERC20(E.MOCK_USDC).mint(owner, base + premium);
        IMintableERC20(E.MOCK_USDC).approve(E.ETH_REGISTRAR, base + premium);
        registrar.commit(commitment);
        vm.warp(block.timestamp + registrar.MIN_COMMITMENT_AGE() + 1);
        registrar.register(parent, owner, secret, address(0), address(0), duration, E.MOCK_USDC, bytes32(0));
        vm.stopPrank();
        assertEq(uint8(ETH.getState(uint256(keccak256(bytes(parent)))).status), uint8(IRegistryV2.Status.REGISTERED));
    }

    /// (a) + (b): the soapay.eth owner deploys a UserRegistry, links it, and grants the issuer ROLE_REGISTRAR.
    function _setupParent() internal returns (IRegistryV2 reg) {
        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant(owner, E.ALL_ROLES);
        uint256 salt = uint256(
            keccak256(abi.encode(keccak256("UserRegistry"), E.namehash2(parent, "eth"), uint256(0)))
        );
        vm.startPrank(owner);
        reg = IRegistryV2(
            FACTORY.deployProxy(E.USER_REGISTRY_IMPL, salt, abi.encodeCall(IUserRegistryInit.initialize, (grants)))
        );
        ETH.setSubregistry(uint256(keccak256(bytes(parent))), address(reg));
        reg.setParent(E.ETH_REGISTRY, parent);
        reg.grantRootRoles(E.ROLE_REGISTRAR, issuer);
        vm.stopPrank();
        assertEq(ETH.getSubregistry(parent), address(reg));
        assertEq(FACTORY.verifyContract(address(reg)), E.USER_REGISTRY_IMPL);
    }

    /// (c): deploy the name's own PermissionedResolver (records + stealth-writer role set atomically
    /// in `initialize`), then register the non-transferable subname pointing at it.
    function _issue(string memory label, address registrant_, address stealthWriter, string memory meta)
        internal
        returns (address resolver)
    {
        bytes memory dns = E.dnsEncode(label, parent, "eth");
        bytes32 node = E.namehash3(label, parent, "eth");

        Grant[] memory grants = new Grant[](2);
        grants[0] = Grant(owner, E.ALL_ROLES); // the parent admin controls the resolver
        grants[1] = Grant(E.VERIFIABLE_FACTORY, E.ROLE_SET_TEXT_ADMIN); // bootstrap only, revoked below
        bytes[] memory calls = new bytes[](4);
        calls[0] = abi.encodeCall(IPermissionedResolverV2.setText, (dns, STEALTH, meta));
        calls[1] = abi.encodeCall(IPermissionedResolverV2.setText, (dns, REGISTRANT_KEY, vm.toString(registrant_)));
        calls[2] = abi.encodeCall(
            IPermissionedResolverV2.grantSetterRoles,
            (abi.encodeCall(IPermissionedResolverV2.setText, (dns, STEALTH, "")), stealthWriter)
        );
        calls[3] = abi.encodeCall(IPermissionedResolverV2.revokeRootRoles, (E.ROLE_SET_TEXT_ADMIN, E.VERIFIABLE_FACTORY));

        // Same salt as the SDK's nameResolverSalt(): name, registrant, writer, meta, pre-issue resource.
        uint256 preIssueResource = subnames.getState(uint256(keccak256(bytes(label)))).resource;
        uint256 salt = uint256(
            keccak256(
                abi.encode(
                    keccak256("SoapayNameResolver"),
                    node,
                    registrant_,
                    stealthWriter,
                    keccak256(bytes(meta)),
                    preIssueResource
                )
            )
        );
        address predicted = _predictProxy(issuer, salt);
        vm.startPrank(issuer);
        resolver = FACTORY.deployProxy(
            E.PERMISSIONED_RESOLVER_IMPL, salt, abi.encodeCall(IPermissionedResolverV2.initialize, (grants, calls))
        );
        assertEq(resolver, predicted, "SDK predictProxyAddress formula");
        subnames.register(label, registrant_, address(0), resolver, 0, type(uint64).max);
        vm.stopPrank();
        assertEq(_resolveText(dns, node, STEALTH), meta);
    }

    /// CREATE2 address of `deployProxy(_, salt, _)` sent by `deployer`; mirrors the SDK's predictProxyAddress().
    function _predictProxy(address deployer, uint256 salt) internal view returns (address) {
        bytes32 outerSalt = keccak256(abi.encode(deployer, salt));
        bytes memory code = abi.encodePacked(
            hex"3d604d80600a3d3981f3363d3d373d3d3d363d73",
            FACTORY.proxyLogic(),
            hex"5af43d82803e903d91602b57fd5bf3",
            outerSalt
        );
        return vm.computeCreate2Address(outerSalt, keccak256(code), E.VERIFIABLE_FACTORY);
    }

    function _unauthorized(uint256 resource, uint256 roleBitmap, address account)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeWithSelector(EACUnauthorizedAccountRoles.selector, resource, roleBitmap, account);
    }

    function _resolveText(bytes memory dns, bytes32 node, string memory key) internal view returns (string memory) {
        (bytes memory res,) = UR.resolve(dns, abi.encodeCall(ITextResolver.text, (node, key)));
        return abi.decode(res, (string));
    }
}
