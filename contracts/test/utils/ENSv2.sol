// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal interfaces for the live ENSv2 Sepolia deployment (ensdomains/contracts-v2 @ 71a3b73,
///         "deploy a fresh v2 migration set", 2026-09-15). Addresses and role ids are documented in
///         contracts/ENSV2.md. Nothing here is a mock: tests call the deployed contracts on a fork.

struct Grant {
    address account;
    uint256 roleBitmap;
}

interface IRegistryV2 {
    enum Status {
        AVAILABLE,
        RESERVED,
        REGISTERED
    }

    struct State {
        Status status;
        uint64 expiry;
        address latestOwner;
        uint256 tokenId;
        uint256 resource;
    }

    function register(
        string calldata label,
        address owner,
        address registry,
        address resolver,
        uint256 roleBitmap,
        uint64 expiry
    ) external returns (uint256 tokenId);
    function unregister(uint256 anyId) external;
    function setSubregistry(uint256 anyId, address registry) external;
    function setResolver(uint256 anyId, address resolver) external;
    function setParent(address parent, string calldata label) external;
    function getSubregistry(string calldata label) external view returns (address);
    function getResolver(string calldata label) external view returns (address);
    function getParent() external view returns (address parent, string memory label);
    function getState(uint256 anyId) external view returns (State memory);
    function grantRootRoles(uint256 roleBitmap, address account) external returns (bool);
    function roles(uint256 resource, address account) external view returns (uint256);
    function hasRootRoles(uint256 roleBitmap, address account) external view returns (bool);
    function ownerOf(uint256 tokenId) external view returns (address);
    function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes calldata data)
        external;
    function unsafeTransfer(address to, uint256 tokenId, bytes calldata data) external;
}

interface IPermissionedResolverV2 {
    function initialize(Grant[] calldata grants, bytes[] calldata calls) external;
    function setText(bytes calldata name, string calldata key, string calldata value) external;
    function setAddress(bytes calldata name, uint256 coinType, bytes calldata addressBytes) external;
    function grantSetterRoles(bytes calldata setter, address account) external returns (bool);
    function revokeRoles(uint256 resource, uint256 roleBitmap, address account) external returns (bool);
    function revokeRootRoles(uint256 roleBitmap, address account) external returns (bool);
    function roles(uint256 resource, address account) external view returns (uint256);
}

interface IVerifiableFactory {
    function deployProxy(address implementation, uint256 salt, bytes calldata data)
        external
        returns (address proxy);
    function proxyLogic() external view returns (address);
    function verifyContract(address proxy) external view returns (address implementation);
}

interface IUserRegistryInit {
    function initialize(Grant[] calldata grants) external;
}

interface IETHRegistrarV2 {
    function MIN_COMMITMENT_AGE() external view returns (uint64);
    function MIN_REGISTER_DURATION() external view returns (uint64);
    function isAvailable(string calldata label) external view returns (bool);
    function commit(bytes32 commitment) external;
    function makeCommitment(
        string calldata label,
        address owner,
        bytes32 secret,
        address subregistry,
        address resolver,
        uint64 duration,
        bytes32 referrer
    ) external pure returns (bytes32);
    function getRegisterPrice(string calldata label, uint64 duration, address paymentToken)
        external
        view
        returns (uint256 base, uint256 premium);
    function register(
        string calldata label,
        address owner,
        bytes32 secret,
        address subregistry,
        address resolver,
        uint64 duration,
        address paymentToken,
        bytes32 referrer
    ) external returns (uint256 tokenId);
}

interface IUniversalResolverV2 {
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        returns (bytes memory result, address resolver);
    function findResolver(bytes calldata name)
        external
        view
        returns (address resolver, bytes32 node, uint256 offset);
}

interface ITextResolver {
    function text(bytes32 node, string calldata key) external view returns (string memory);
}

interface IAddrResolver {
    function addr(bytes32 node) external view returns (address);
}

interface IMintableERC20 {
    function mint(address to, uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
}

library ENSv2Sepolia {
    // ---- deployment (docs.ens.domains/learn/deployments "Sepolia (ENSv2 Beta)") ----
    address internal constant ROOT_REGISTRY = 0x9703DBD26dAB89504490994138cF2c575251a9cE;
    address internal constant ETH_REGISTRY = 0x657eA849311d3D5823348ddEd7C2AaAFb3EDE09E;
    address internal constant ETH_REGISTRAR = 0xAbe76F6C8DFcEd81AA5A2bB8034202A7136b94ca;
    address internal constant VERIFIABLE_FACTORY = 0x9e726Eb570beb6BCEb495AB8cdA7df517d4e841C;
    address internal constant USER_REGISTRY_IMPL = 0xA80338aAA8D23831cEa25E858D1774534aBb0263;
    address internal constant PERMISSIONED_RESOLVER_IMPL = 0x14F09Fd05d4585759e54844DC9B00147131Cf243;
    address internal constant UNIVERSAL_RESOLVER = 0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe;
    address internal constant MOCK_USDC = 0x16f95D91DBa7dA3Aca778Ec053dF0FF6C6A8aA8e;

    // ---- EAC (EnhancedAccessControl) ----
    uint256 internal constant ALL_ROLES =
        0x1111111111111111111111111111111111111111111111111111111111111111;
    // PermissionedRegistry (RegistryRolesLib)
    uint256 internal constant ROLE_REGISTRAR = 1 << 0;
    uint256 internal constant ROLE_UNREGISTER = 1 << 12;
    uint256 internal constant ROLE_SET_RESOLVER = 1 << 24;
    uint256 internal constant ROLE_CAN_TRANSFER_ADMIN = (1 << 28) << 128;
    // PermissionedResolver (PermissionedResolverLib)
    uint256 internal constant ROLE_SET_ADDRESS = 1 << 0;
    uint256 internal constant ROLE_SET_TEXT = 1 << 4;
    uint256 internal constant ROLE_SET_TEXT_ADMIN = ROLE_SET_TEXT << 128;

    // ---- name helpers ----
    function dnsEncode(string memory a, string memory b, string memory c)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodePacked(
            uint8(bytes(a).length), a, uint8(bytes(b).length), b, uint8(bytes(c).length), c, uint8(0)
        );
    }

    function namehash3(string memory a, string memory b, string memory c) internal pure returns (bytes32 n) {
        n = keccak256(abi.encode(bytes32(0), keccak256(bytes(c))));
        n = keccak256(abi.encode(n, keccak256(bytes(b))));
        n = keccak256(abi.encode(n, keccak256(bytes(a))));
    }

    function namehash2(string memory b, string memory c) internal pure returns (bytes32 n) {
        n = keccak256(abi.encode(bytes32(0), keccak256(bytes(c))));
        n = keccak256(abi.encode(n, keccak256(bytes(b))));
    }

    /// @dev EAC resource for a single `setText(key)` on a PermissionedResolver: keccak256(bytes(key)).
    function textResource(string memory key) internal pure returns (uint256) {
        return uint256(keccak256(bytes(key)));
    }
}
