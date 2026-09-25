// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {StealthDisperse} from "../../src/StealthDisperse.sol";

contract MockERC20 is ERC20Permit {
    constructor() ERC20("Mock USD", "mUSD") ERC20Permit("Mock USD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

/// @dev Non-reverting token that returns false for transfers to one blocked address.
contract FalseReturningERC20 is ERC20 {
    address public blocked;

    constructor(address blocked_) ERC20("False", "FLS") {
        blocked = blocked_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (to == blocked) return false;
        return super.transferFrom(from, to, amount);
    }
}

abstract contract Fixtures is Test {
    /// @dev Runtime bytecode of the canonical ERC5564Announcer, read from Base mainnet
    ///      (`cast code 0x55649E01B5Df198D18D95b5cc5051630cfD45564 --rpc-url https://mainnet.base.org`).
    bytes internal constant ANNOUNCER_RUNTIME =
        hex"608060405234801561001057600080fd5b506004361061002b5760003560e01c80634d1f958314610030575b600080fd5b61004361003e36600461018d565b610045565b005b3373ffffffffffffffffffffffffffffffffffffffff168373ffffffffffffffffffffffffffffffffffffffff16857f5f0eab8057630ba7676c49b4f21a0231414e79474595be8e4c432fbf6bf0f4e785856040516100a592919061028a565b60405180910390a450505050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b600082601f8301126100f357600080fd5b813567ffffffffffffffff8082111561010e5761010e6100b3565b604051601f83017fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0908116603f01168101908282118183101715610154576101546100b3565b8160405283815286602085880101111561016d57600080fd5b836020870160208301376000602085830101528094505050505092915050565b600080600080608085870312156101a357600080fd5b84359350602085013573ffffffffffffffffffffffffffffffffffffffff811681146101ce57600080fd5b9250604085013567ffffffffffffffff808211156101eb57600080fd5b6101f7888389016100e2565b9350606087013591508082111561020d57600080fd5b5061021a878288016100e2565b91505092959194509250565b6000815180845260005b8181101561024c57602081850181015186830182015201610230565b5060006020828601015260207fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0601f83011685010191505092915050565b60408152600061029d6040830185610226565b82810360208401526102af8185610226565b9594505050505056fea164736f6c6343000817000a";

    address internal constant ANNOUNCER_ADDR = 0x55649E01B5Df198D18D95b5cc5051630cfD45564;
    bytes32 internal constant ANNOUNCEMENT_TOPIC = keccak256("Announcement(uint256,address,address,bytes,bytes)");

    StealthDisperse internal disperse;

    function _etchAnnouncer() internal {
        vm.etch(ANNOUNCER_ADDR, ANNOUNCER_RUNTIME);
    }

    /// @dev `n` distinct, strictly ascending, nonzero pseudo-random addresses.
    function _sortedAddresses(uint256 n, uint256 seed) internal pure returns (address[] memory a) {
        a = new address[](n);
        for (uint256 i; i < n; ++i) {
            a[i] = address(uint160(uint256(keccak256(abi.encode(seed, i)))));
        }
        // insertion sort
        for (uint256 i = 1; i < n; ++i) {
            address x = a[i];
            uint256 j = i;
            while (j > 0 && a[j - 1] > x) {
                a[j] = a[j - 1];
                --j;
            }
            a[j] = x;
        }
    }

    function _ephemeralKey(uint256 seed) internal pure returns (bytes memory) {
        bytes32 x = keccak256(abi.encode("eph", seed));
        return abi.encodePacked(seed % 2 == 0 ? bytes1(0x02) : bytes1(0x03), x);
    }

    function _viewTag(uint256 seed) internal pure returns (bytes1) {
        return bytes1(uint8(uint256(keccak256(abi.encode("tag", seed)))));
    }

    function _batch(uint256 n, uint256 seed, uint256 amountEach)
        internal
        pure
        returns (StealthDisperse.Payment[] memory ps, uint256 total)
    {
        address[] memory addrs = _sortedAddresses(n, seed);
        ps = new StealthDisperse.Payment[](n);
        for (uint256 i; i < n; ++i) {
            uint256 amt = amountEach == 0 ? 1 + (uint256(keccak256(abi.encode("amt", seed, i))) % 1e12) : amountEach;
            uint256 lineSeed = uint256(keccak256(abi.encode(seed, i)));
            ps[i] = StealthDisperse.Payment(addrs[i], amt, _ephemeralKey(lineSeed), _viewTag(lineSeed));
            total += amt;
        }
    }

    function _expectedMetadata(address token, StealthDisperse.Payment memory p, address payer)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodePacked(p.viewTag, bytes4(0xa9059cbb), token, p.amount, payer);
    }
}
